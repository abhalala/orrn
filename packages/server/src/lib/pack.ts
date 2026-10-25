/**
 * Pack helpers for `bundle.createReceipt` (FP-PK-01/02/07/14, spec §E6 "createReceipt batch").
 *
 * - `scaleConfigured`: a typed weight needs a reason while the plant's edge node reports a scale
 *   (`spool_deployment.scale_configured`, added by W1-SPOOL). Until that column exists the answer is
 *   false, so packing keeps working on a branch without it.
 * - Trolley draw (W3-AG-S): `ageingRowId` names a released trolley row (`ageing_row`, 0038). Remaining
 *   = pcs − packed − scrap − rework, read before the batch (`assertAgeingDraw`) and enforced again
 *   inside it with the row's status and source (`drawAgeingRowStatements` + `packAbort`), so an
 *   over-draw or a draw from a row held meanwhile never lands.
 * - Rejects at pack (`pack_reject`): one row per reject line; a weighed one posts `pack_reject`
 *   (+kg) at the plant-scrap location against the PLANT-SCRAP return stream (C10).
 */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { ageingDrawGate, ageingRowRemaining, bundleQrUrl } from "@orrn/domain";
import { ageingBatch, ageingRow, type AgeingRowSource, type AgeingRowStatus } from "@orrn/db/schema/ageing";
import { cast as castTable, returnStream } from "@orrn/db/schema/foundry";
import { bundle } from "@orrn/db/schema/inventory";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { reasonCode } from "@orrn/db/schema/reasons";
import { stockLedger } from "@orrn/db/schema/stock";
import { company } from "@orrn/db/schema/tenant";

import { closeEmptyStatements, remainingOf } from "./ageing";
import { ageingRefusal } from "./ageingRefusals";
import { mapInChunks, type OrrnDb, type SqliteBatchItem } from "./atomic";
import { buildPackLabelVariables, type PackLabelVariables } from "./bundle-label";
import { sqlUuid } from "./ledger";
import { batchAbortUnless, isBatchAbort } from "./orders";
import { nameKey } from "./purchase";
import { ensureDefaultReasonCodes } from "./reasonCodes";
import { webBaseUrl } from "./webUrl";

export function errorText(e: unknown): string {
  let text = "";
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    text += ` ${cur instanceof Error ? cur.message : String(cur)}`;
    cur = (cur as { cause?: unknown }).cause;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

/** True when an active edge node of the company reports a scale (W1-SPOOL heartbeat column). */
export async function scaleConfigured(db: OrrnDb, companyId: string): Promise<boolean> {
  try {
    const rows = await db.all<{ one: number }>(
      sql`select 1 as one from spool_deployment where company_id = ${companyId} and status = 'active' and scale_configured = 1 limit 1`,
    );
    return rows.length > 0;
  } catch (e) {
    if (errorText(e).includes("no such column")) return false;
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Batch abort
// ---------------------------------------------------------------------------

/**
 * A statement that fails the whole batch when `failWhen` holds at write time: `batchAbortUnless`
 * (lib/orders.ts) on `pack_reject`, so pack's aborts are told apart from the order-line one in the
 * same batch. Catch with `isPackAbort`.
 */
function packAbort(db: OrrnDb, failWhen: SQL): SqliteBatchItem {
  return batchAbortUnless(db, "pack_reject", sql`not (${failWhen})`);
}

export function isPackAbort(e: unknown): boolean {
  return isBatchAbort(e, "pack_reject");
}

// ---------------------------------------------------------------------------
// Trolley draw (W3-AG-S; ageing tables ship in 0038)
// ---------------------------------------------------------------------------

export async function ageingTablesExist(db: OrrnDb): Promise<boolean> {
  const rows = await db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name = 'ageing_row'`);
  return rows.length > 0;
}

export type AgeingRowRead = {
  id: string;
  batchId: string;
  dieId: string;
  lengthMm: number;
  pcs: number;
  remaining: number;
  status: AgeingRowStatus;
  source: AgeingRowSource;
  castId: string | null;
};

/** The trolley row a receipt draws from, with its server remaining pieces, status and source. */
export async function readAgeingRow(db: OrrnDb, companyId: string, id: string): Promise<AgeingRowRead> {
  const [row] = await db
    .select({
      id: ageingRow.id,
      batchId: ageingRow.batchId,
      dieId: ageingRow.dieId,
      lengthMm: ageingRow.lengthMm,
      pcs: ageingRow.pcs,
      packedPcs: ageingRow.packedPcs,
      scrapPcs: ageingRow.scrapPcs,
      reworkPcs: ageingRow.reworkPcs,
      status: ageingRow.status,
      source: ageingRow.source,
      castId: ageingRow.castId,
    })
    .from(ageingRow)
    .where(and(eq(ageingRow.id, id), eq(ageingRow.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Trolley row not found" });
  return {
    id: row.id,
    batchId: row.batchId,
    dieId: row.dieId,
    lengthMm: Number(row.lengthMm),
    pcs: Number(row.pcs),
    remaining: ageingRowRemaining({ pcs: Number(row.pcs), packedPcs: Number(row.packedPcs), scrapPcs: Number(row.scrapPcs), reworkPcs: Number(row.reworkPcs) }),
    status: row.status,
    source: row.source,
    castId: row.castId,
  };
}

/**
 * Refuse a draw before the batch (spec §4): a void row (`row_void`); a row that is not released or is
 * a whole-bundle row (`not_released`); more pieces than remain (`draw_over`); a bundle cast other than
 * the row's (`cast_mismatch`).
 */
export function assertAgeingDraw(row: AgeingRowRead, drawPcs: number, castId: string | null): void {
  if (row.status === "void") throw ageingRefusal("row_void");
  const gate = ageingDrawGate({ rowStatus: row.status, remainingPcs: row.remaining, pcs: drawPcs, source: row.source });
  if (gate) throw ageingRefusal(gate, { n: row.remaining });
  if (row.castId && castId && row.castId !== castId) throw ageingRefusal("cast_mismatch", { cast: row.castId });
}

/** The refusal for a draw the batch rolled back (the row changed between the read and the write). */
export async function ageingDrawRaceRefusal(db: OrrnDb, companyId: string, rowId: string): Promise<TRPCError> {
  const now = await readAgeingRow(db, companyId, rowId);
  if (now.status === "void") return ageingRefusal("row_void");
  if (now.status !== "released" || now.source === "bundle") return ageingRefusal("not_released");
  return ageingRefusal("draw_over", { n: now.remaining });
}

/**
 * Every piece leaving the trolley through pack (good and rejected) counts as packed (C11). The row
 * must still be a released trolley row INSIDE the batch (review I6): the abort checks status and
 * source after the write, so a hold, void or rework between the read and the write fails the receipt
 * whole. A row with nothing left then closes, and its batch with it (Q58: the trolley is free).
 */
export function drawAgeingRowStatements(
  db: OrrnDb,
  companyId: string,
  rowId: string,
  pcs: number,
  opts: { batchId?: string; seq?: number; userId?: string | null } = {},
): SqliteBatchItem[] {
  const out: SqliteBatchItem[] = [
    db
      .update(ageingRow)
      .set({ packedPcs: sql`${ageingRow.packedPcs} + ${pcs}` })
      .where(and(eq(ageingRow.id, rowId), eq(ageingRow.companyId, companyId), eq(ageingRow.status, "released"), ne(ageingRow.source, "bundle"))),
    packAbort(
      db,
      sql`not exists (select 1 from ageing_row ar where ar.id = ${rowId} and ar.company_id = ${companyId}
            and ar.status = 'released' and ar.source <> 'bundle'
            and ar.packed_pcs + ar.scrap_pcs + ar.rework_pcs <= ar.pcs)`,
    ),
  ];
  if (opts.batchId) out.push(...closeEmptyStatements(db, companyId, opts.batchId, opts.userId ?? null, opts.seq ?? 0));
  return out;
}

/**
 * D6 `restoreAgeingRow`: a bundle packed from a trolley row gives its pieces back when voided and
 * takes them again when restored, in the status change's own batch. Lands only when the bundle
 * write beside it landed (`server_seq = seq` and the new status). A whole-bundle row (`source =
 * 'bundle'`, the bundle's own row) never moves (review I3). Pieces given back reopen a closed row and
 * its closed batch (`closed → released`); restoring past what the row has left fails the batch
 * (`packAbort`), and a row emptied again closes again.
 */
export function restoreAgeingRowStatements(
  db: OrrnDb,
  input: { companyId: string; bundleId: string; ageingRowId: string; seq: number; to: "void" | "available"; userId?: string | null },
): SqliteBatchItem[] {
  const sign = input.to === "void" ? sql`-` : sql`+`;
  const landed = sql`exists (select 1 from ${bundle} b where b.id = ${input.bundleId} and b.company_id = ${input.companyId}
            and b.server_seq = ${input.seq} and b.status = ${input.to})`;
  const rowWhere = and(eq(ageingRow.id, input.ageingRowId), eq(ageingRow.companyId, input.companyId), ne(ageingRow.source, "bundle"));
  const batchOfRow = sql`(select r.batch_id from ageing_row r where r.id = ${input.ageingRowId} and r.company_id = ${input.companyId})`;
  const out: SqliteBatchItem[] = [
    db
      .update(ageingRow)
      .set({
        packedPcs: sql`${ageingRow.packedPcs} ${sign} (select b.quantity from ${bundle} b
          where b.id = ${input.bundleId} and b.company_id = ${input.companyId} and b.server_seq = ${input.seq} and b.status = ${input.to})`,
        serverSeq: input.seq,
      })
      .where(and(rowWhere, ne(ageingRow.status, "void"), landed)),
  ];
  if (input.to === "void") {
    out.push(
      db
        .update(ageingRow)
        .set({ status: "released", serverSeq: input.seq })
        .where(and(rowWhere, eq(ageingRow.status, "closed"), sql`${remainingOf("ageing_row")} > 0`, landed)),
      db
        .update(ageingBatch)
        .set({ status: "released", closedBy: null, serverSeq: input.seq })
        .where(
          and(
            eq(ageingBatch.companyId, input.companyId),
            sql`${ageingBatch.id} = ${batchOfRow}`,
            eq(ageingBatch.status, "closed"),
            sql`exists (select 1 from ageing_row r where r.company_id = ${input.companyId} and r.batch_id = ${ageingBatch.id} and r.status = 'released' and ${remainingOf("r")} > 0)`,
          ),
        ),
    );
  } else {
    out.push(
      packAbort(
        db,
        sql`exists (select 1 from ageing_row ar where ar.id = ${input.ageingRowId} and ar.company_id = ${input.companyId}
              and ar.packed_pcs + ar.scrap_pcs + ar.rework_pcs > ar.pcs)`,
      ),
      db
        .update(ageingRow)
        .set({ status: "closed", serverSeq: input.seq })
        .where(and(rowWhere, eq(ageingRow.status, "released"), sql`${remainingOf("ageing_row")} <= 0`, landed)),
      db
        .update(ageingBatch)
        .set({ status: "closed", closedBy: input.userId ?? null, serverSeq: input.seq })
        .where(
          and(
            eq(ageingBatch.companyId, input.companyId),
            sql`${ageingBatch.id} = ${batchOfRow}`,
            eq(ageingBatch.status, "released"),
            sql`not exists (select 1 from ageing_row r where r.company_id = ${input.companyId} and r.batch_id = ${ageingBatch.id} and r.status <> 'void' and ${remainingOf("r")} > 0)`,
          ),
        ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rejects at pack (FP-PK-14)
// ---------------------------------------------------------------------------

export type RejectInput = { pcs: number; weightG?: number | null; reasonCode: string; note?: string | null };

/** The stored reason: the qc_reject code, with the note after it when one was given. */
export async function rejectReasons(db: OrrnDb, companyId: string, rejects: readonly RejectInput[]): Promise<string[]> {
  if (rejects.length === 0) return [];
  await ensureDefaultReasonCodes(db, companyId);
  const rows = await db
    .select({ code: reasonCode.code, requiresNote: reasonCode.requiresNote, active: reasonCode.active })
    .from(reasonCode)
    .where(and(eq(reasonCode.companyId, companyId), eq(reasonCode.kind, "qc_reject")));
  const known = new Map<string, { requiresNote: boolean; active: boolean }>(
    rows.map((r) => [
      r.code,
      { requiresNote: Boolean(r.requiresNote), active: Boolean(r.active) },
    ]),
  );
  return rejects.map((r) => {
    const code = known.get(r.reasonCode);
    if (!code || !code.active) throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown reject reason ${r.reasonCode}` });
    const note = r.note?.trim() || null;
    if ((code.requiresNote || r.reasonCode === "other") && !note) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Write a note for the reject reason" });
    }
    return note ? `${r.reasonCode}: ${note}` : r.reasonCode;
  });
}

/**
 * The return stream weighed pack rejects post to (m-5), resolved BEFORE the batch: the PLANT-SCRAP
 * stream, else a stream already named "Plant scrap" under another code (its name key is unique, so
 * a new PLANT-SCRAP could never be inserted beside it). Null = none yet: the batch creates it.
 */
export async function plantScrapStreamId(db: OrrnDb, companyId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: returnStream.id })
    .from(returnStream)
    .where(and(eq(returnStream.companyId, companyId), or(eq(returnStream.code, "PLANT-SCRAP"), eq(returnStream.nameKey, nameKey("Plant scrap")))))
    .orderBy(sql`${returnStream.code} = 'PLANT-SCRAP' desc`)
    .limit(1);
  return row?.id ?? null;
}

/**
 * Statements that make sure the stream `id` exists (create PLANT-SCRAP when `existing` is null) and
 * fail the whole batch if it does not after that (a concurrent create took the code or the name),
 * so reject kg is never silently left off the ledger.
 */
export function plantScrapStreamStatements(
  db: OrrnDb,
  companyId: string,
  opts: { id: string; existing: boolean; userId: string | null; seq: number },
): SqliteBatchItem[] {
  const out: SqliteBatchItem[] = [];
  if (!opts.existing) {
    out.push(
      db
        .insert(returnStream)
        .values({
          id: opts.id,
          companyId,
          serverSeq: opts.seq,
          code: "PLANT-SCRAP",
          name: "Plant scrap",
          nameKey: nameKey("Plant scrap"),
          kind: "charge",
          active: true,
          sortOrder: 2,
          createdBy: opts.userId,
        })
        .onConflictDoNothing(),
    );
  }
  out.push(packAbort(db, sql`not exists (select 1 from ${returnStream} rs where rs.company_id = ${companyId} and rs.id = ${opts.id})`));
  return out;
}

/**
 * `pack_reject` ledger row: + kg at the plant-scrap location, item = the plant scrap stream
 * (`streamId`, resolved before the batch), voucher = the reject row. Keys in stock_ledger column
 * order (insert-select rule).
 */
export function packRejectLedgerRow(
  db: OrrnDb,
  input: {
    companyId: string;
    seq: number;
    rejectId: string;
    weightG: number;
    plantScrapId: string;
    streamId: string;
    userId: string | null;
    postedAt: Date;
  },
): SqliteBatchItem {
  return db.insert(stockLedger).select(
    db
      .select({
        id: sqlUuid.as("id"),
        companyId: sql<string>`${input.companyId}`.as("company_id"),
        serverSeq: sql<number>`${input.seq}`.as("server_seq"),
        voucherType: sql<"pack_reject">`'pack_reject'`.as("voucher_type"),
        voucherId: sql<string>`${input.rejectId}`.as("voucher_id"),
        line: sql<number>`1`.as("line"),
        itemKind: sql<"return_stream">`'return_stream'`.as("item_kind"),
        itemRef: sql<string>`${returnStream.id}`.as("item_ref"),
        locationId: sql<string>`${input.plantScrapId}`.as("location_id"),
        qtyG: sql<number>`${input.weightG}`.as("qty_g"),
        postedAt: sql<number>`${input.postedAt.getTime()}`.as("posted_at"),
        reversalOf: sql<string | null>`null`.as("reversal_of"),
        reason: sql<string | null>`null`.as("reason"),
        createdBy: sql<string | null>`${input.userId}`.as("created_by"),
        createdAt: sql<number>`${Date.now()}`.as("created_at"),
      })
      .from(returnStream)
      .where(and(eq(returnStream.companyId, input.companyId), eq(returnStream.id, input.streamId)))
      .limit(1),
  );
}

// ---------------------------------------------------------------------------
// Label variables (FP-PK-04/05)
// ---------------------------------------------------------------------------

/** Read what the pack label prints beyond the base variables; every lookup scoped by company. */
export async function loadPackLabelVariables(
  db: OrrnDb,
  companyId: string,
  bundleRow: typeof bundle.$inferSelect,
): Promise<PackLabelVariables> {
  return (await loadPackLabelVariablesMany(db, companyId, [bundleRow]))[0]!;
}

/**
 * The label variables of many bundles in a few queries (company, casts, order lines; ids chunked),
 * in the order of `rows`. The A4 sheet prints up to 200 at once (review m-4).
 */
export async function loadPackLabelVariablesMany(
  db: OrrnDb,
  companyId: string,
  rows: readonly (typeof bundle.$inferSelect)[],
): Promise<PackLabelVariables[]> {
  if (rows.length === 0) return [];
  const [co] = await db.select({ slug: company.slug }).from(company).where(eq(company.id, companyId)).limit(1);
  const castIds = [...new Set(rows.flatMap((b) => (b.castId ? [b.castId] : [])))];
  const lineIds = [...new Set(rows.flatMap((b) => { const l = b.packedSalesOrderLineId ?? b.salesOrderLineId; return l ? [l] : []; }))];
  const casts = await mapInChunks(castIds, (ids) =>
    db
      .select({ id: castTable.id, number: castTable.number })
      .from(castTable)
      .where(and(eq(castTable.companyId, companyId), inArray(castTable.id, ids))),
  );
  const lines = await mapInChunks(lineIds, (ids) =>
    db
      .select({ id: salesOrderLine.id, number: salesOrder.number, lineNo: salesOrderLine.lineNo })
      .from(salesOrderLine)
      .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, companyId)))
      .where(and(eq(salesOrderLine.companyId, companyId), inArray(salesOrderLine.id, ids))),
  );
  const castById = new Map(casts.map((c) => [c.id, c.number]));
  const lineById = new Map(lines.map((l) => [l.id, l]));
  return rows.map((bundleRow) => {
    const lineRow = lineById.get(bundleRow.packedSalesOrderLineId ?? bundleRow.salesOrderLineId ?? "");
    return buildPackLabelVariables({
      bundleRow,
      qrUrl: bundleQrUrl({ origin: webBaseUrl(), number: bundleRow.serial, companySlug: co?.slug ?? "" }),
      castNumber: bundleRow.castId ? (castById.get(bundleRow.castId) ?? null) : null,
      salesOrderCode: lineRow ? salesOrderLineCode(lineRow.number, Number(lineRow.lineNo)) : null,
    });
  });
}

/** `SO-12/1`: an order line as the label and the packing list print it. */
export function salesOrderLineCode(orderNumber: string, lineNo: number): string {
  return `${orderNumber}/${lineNo}`;
}
