/**
 * XE-BILL row 13: a tax invoice is built from frozen packing list revisions of ONE customer (what was loaded
 * on the truck), never from a live order. One invoice line per packing list group (an order line, or a
 * section for bundles on no line): weight = the group's frozen subtotal, rate = the order line's `rate_paise`
 * (the final rate per kg, CONTRACTS item 1), else a rate typed on the draft. Charges (finish, components,
 * packing) are typed lines. PRICE's `priceBreakup` is optional and only printed when present.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";

import { gstHsn, gstSectionHsn } from "@orrn/db/schema/billing";
import { die } from "@orrn/db/schema/catalog";
import { dispatch } from "@orrn/db/schema/dispatch";
import { packingList, packingListDispatch } from "@orrn/db/schema/packing";
import { salesOrderLine } from "@orrn/db/schema/sales";
import type { InvoiceLineInput } from "@orrn/domain";

import { mapInChunks, type OrrnDb } from "../atomic";
import { plSnapshotV2Schema, type PlSnapshotV2 } from "../packingListSnapshot";

/** SQL: packing list `p` is the current revision (nothing supersedes it) and not folded into a combined list. */
export function plIsCurrentSql(companyId: string, plIdSql: ReturnType<typeof sql>) {
  return sql`not exists (select 1 from packing_list p2 where p2.company_id = ${companyId} and p2.supersedes_id = ${plIdSql})
    and exists (select 1 from packing_list p3 where p3.company_id = ${companyId} and p3.id = ${plIdSql} and p3.combined_into_id is null)`;
}

export type LineRef = {
  plCode: string;
  plRevision: number;
  groupKey: string;
  orderNumber: string | null;
  lineNo: number | null;
  sectionCode: string;
  bundles: number;
  pcs: number;
  rateSource: "order" | "typed" | "charge";
  poNumber: string | null;
};

export type DraftSource = { packingListId: string; plCode: string; plRevision: number; dispatchIds: string[]; dispatchCodes: string[]; vehicleNo: string | null };

export type DraftBuild = {
  customerId: string;
  sources: DraftSource[];
  lines: InvoiceLineInput[];
  refs: LineRef[];
  vehicleNo: string | null;
  /** Group keys that need a typed rate (no order line, or the line has no rate). */
  missingRates: { key: string; label: string }[];
};

export type ChargeInput = { label: string; amountPaise: number; hsnId?: string | null };

/** Every packing list id the dispatch set belongs to (a plain list: its own dispatch; a combined list: all of them). */
async function dispatchIdsOf(db: OrrnDb, companyId: string, plIds: string[]): Promise<Map<string, string[]>> {
  const rows = await mapInChunks(plIds, (ids) =>
    db
      .select({ plId: packingListDispatch.packingListId, dispatchId: packingListDispatch.dispatchId })
      .from(packingListDispatch)
      .where(and(eq(packingListDispatch.companyId, companyId), inArray(packingListDispatch.packingListId, ids))),
  );
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.plId, [...(out.get(r.plId) ?? []), r.dispatchId]);
  return out;
}

export async function buildDraft(
  db: OrrnDb,
  companyId: string,
  input: { packingListIds: string[]; rates: Record<string, number>; charges: ChargeInput[] },
): Promise<DraftBuild> {
  const ids = [...new Set(input.packingListIds)];
  const pls = await mapInChunks(ids, (chunkIds) =>
    db
      .select({
        id: packingList.id,
        code: packingList.code,
        revision: packingList.revision,
        snapshot: packingList.snapshot,
        dispatchId: packingList.dispatchId,
        combinedIntoId: packingList.combinedIntoId,
        customerId: dispatch.customerId,
        status: dispatch.status,
        current: sql<number>`not exists (select 1 from packing_list p2 where p2.company_id = ${companyId} and p2.supersedes_id = ${packingList.id})`,
      })
      .from(packingList)
      .innerJoin(dispatch, and(eq(dispatch.id, packingList.dispatchId), eq(dispatch.companyId, packingList.companyId)))
      .where(and(eq(packingList.companyId, companyId), inArray(packingList.id, chunkIds))),
  );
  if (pls.length !== ids.length) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
  const customers = new Set(pls.map((p) => p.customerId));
  if (customers.size !== 1) throw new TRPCError({ code: "BAD_REQUEST", message: "One invoice is for one customer: these packing lists are for different customers" });
  for (const p of pls) {
    if (!p.current || p.combinedIntoId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Packing list ${p.code} has a newer revision or was combined: bill the current one` });
    }
    if (p.status !== "completed") throw new TRPCError({ code: "BAD_REQUEST", message: `Packing list ${p.code} is not for a completed dispatch` });
  }
  const linked = await dispatchIdsOf(db, companyId, ids);
  // Review S3: a dispatch already invoiced in Tally (a typed number on the dispatch) is not billed again.
  // While the draft holds the dispatch nothing else can type a number on it (dispatch.update refuses), and
  // issue re-checks inside its batch.
  const allDispatchIds = [...new Set(pls.flatMap((p) => [p.dispatchId, ...(linked.get(p.id) ?? [])]))];
  const tally = await mapInChunks(allDispatchIds, (chunkIds) =>
    db
      .select({ code: dispatch.code, invoiceNumber: dispatch.invoiceNumber })
      .from(dispatch)
      .where(and(eq(dispatch.companyId, companyId), inArray(dispatch.id, chunkIds), sql`trim(coalesce(${dispatch.invoiceNumber}, '')) <> ''`)),
  );
  if (tally.length > 0) {
    const t = tally[0]!;
    throw new TRPCError({ code: "BAD_REQUEST", message: `Dispatch ${t.code} is already invoiced (${t.invoiceNumber}): it is not billed again` });
  }
  const sources: DraftSource[] = [];
  const snaps: { pl: (typeof pls)[number]; snap: PlSnapshotV2 }[] = [];
  for (const p of pls) {
    const parsed = plSnapshotV2Schema.safeParse(p.snapshot);
    if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: `Packing list ${p.code} is an old format and cannot be billed` });
    const dispatchIds = [...new Set([p.dispatchId, ...(linked.get(p.id) ?? [])])];
    sources.push({
      packingListId: p.id,
      plCode: p.code,
      plRevision: p.revision,
      dispatchIds,
      dispatchCodes: parsed.data.issue?.dispatchCodes ?? [parsed.data.header.dispatchCode],
      vehicleNo: parsed.data.header.vehicleNo,
    });
    snaps.push({ pl: p, snap: parsed.data as PlSnapshotV2 });
  }

  // Order lines (rate, section, alloy, temper) for linked groups.
  const lineIds = [...new Set(snaps.flatMap(({ snap }) => snap.groups.map((g) => g.salesOrderLineId).filter((x): x is string => !!x)))];
  const orderLines = await mapInChunks(lineIds, (chunkIds) =>
    db
      .select({ id: salesOrderLine.id, ratePaise: salesOrderLine.ratePaise, dieId: salesOrderLine.dieId, alloy: salesOrderLine.alloy, temper: salesOrderLine.temper })
      .from(salesOrderLine)
      .where(and(eq(salesOrderLine.companyId, companyId), inArray(salesOrderLine.id, chunkIds))),
  );
  const lineById = new Map(orderLines.map((l) => [l.id, l]));
  const dieIdOf = (g: PlSnapshotV2["groups"][number]) =>
    g.salesOrderLineId ? (lineById.get(g.salesOrderLineId)?.dieId ?? null) : g.key.startsWith("section:") ? g.key.slice(8) : null;

  // HSN: the section's own, else the plant default.
  const dieIds = [...new Set(snaps.flatMap(({ snap }) => snap.groups.map(dieIdOf).filter((x): x is string => !!x)))];
  const sectionHsn = await mapInChunks(dieIds, (chunkIds) =>
    db
      .select({ dieId: gstSectionHsn.dieId, code: gstHsn.code, rateBp: gstHsn.rateBp, uqc: gstHsn.uqc, active: gstHsn.active })
      .from(gstSectionHsn)
      .innerJoin(gstHsn, and(eq(gstHsn.id, gstSectionHsn.hsnId), eq(gstHsn.companyId, gstSectionHsn.companyId)))
      .where(and(eq(gstSectionHsn.companyId, companyId), inArray(gstSectionHsn.dieId, chunkIds))),
  );
  const hsnByDie = new Map(sectionHsn.filter((h) => h.active).map((h) => [h.dieId, h]));
  const hsnRows = await db.select().from(gstHsn).where(and(eq(gstHsn.companyId, companyId), eq(gstHsn.active, true)));
  const fallback = hsnRows.find((h) => h.isDefault) ?? null;
  const dieRows = await mapInChunks(dieIds, (chunkIds) =>
    db.select({ id: die.id, alloy: die.alloy, temper: die.temper }).from(die).where(and(eq(die.companyId, companyId), inArray(die.id, chunkIds))),
  );
  const dieById = new Map(dieRows.map((d) => [d.id, d]));

  const lines: InvoiceLineInput[] = [];
  const refs: LineRef[] = [];
  const missingRates: DraftBuild["missingRates"] = [];
  for (const { pl, snap } of snaps) {
    for (const g of snap.groups) {
      const key = `${pl.code}|${g.key}`;
      const line = g.salesOrderLineId ? lineById.get(g.salesOrderLineId) : undefined;
      const dieId = dieIdOf(g);
      const hsn = (dieId ? hsnByDie.get(dieId) : undefined) ?? fallback;
      if (!hsn) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Billing details missing: hsn" });
      const typed = input.rates[key] ?? input.rates[g.key];
      const ratePaise = line?.ratePaise ?? typed ?? null;
      const label = g.orderNumber ? `${g.orderNumber}/${g.lineNo} ${g.sectionCode}` : g.sectionCode;
      if (ratePaise == null) {
        missingRates.push({ key, label });
        continue;
      }
      const alloy = line?.alloy ?? (dieId ? dieById.get(dieId)?.alloy : null) ?? null;
      const temper = line?.temper ?? (dieId ? dieById.get(dieId)?.temper : null) ?? null;
      const finish = g.finish && g.finish !== "none" ? g.finish : null;
      const description = [
        `Aluminium section ${g.sectionCode}${g.item && g.item !== g.sectionCode ? ` ${g.item}` : ""}`,
        [alloy, temper].filter(Boolean).join(" ") || null,
        finish,
      ]
        .filter(Boolean)
        .join(", ");
      lines.push({ key, description, hsn: hsn.code, uqc: hsn.uqc, gstRateBp: hsn.rateBp, kind: "weight", weightG: g.subtotal.weightG, ratePaise });
      refs.push({
        plCode: pl.code,
        plRevision: pl.revision,
        groupKey: g.key,
        orderNumber: g.orderNumber,
        lineNo: g.lineNo,
        sectionCode: g.sectionCode,
        bundles: g.subtotal.bundles,
        pcs: g.subtotal.pcs,
        rateSource: line?.ratePaise != null ? "order" : "typed",
        poNumber: g.poNumber,
      });
    }
  }
  input.charges.forEach((c, i) => {
    const hsn = (c.hsnId ? hsnRows.find((h) => h.id === c.hsnId) : null) ?? fallback;
    if (!hsn) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Billing details missing: hsn" });
    lines.push({ key: `charge|${i}`, description: c.label, hsn: hsn.code, uqc: "OTH", gstRateBp: hsn.rateBp, kind: "charge", amountPaise: c.amountPaise });
    refs.push({ plCode: "", plRevision: 0, groupKey: `charge|${i}`, orderNumber: null, lineNo: null, sectionCode: "", bundles: 0, pcs: 0, rateSource: "charge", poNumber: null });
  });
  return {
    customerId: pls[0]!.customerId,
    sources,
    lines,
    refs,
    vehicleNo: sources.find((s) => s.vehicleNo)?.vehicleNo ?? null,
    missingRates,
  };
}
