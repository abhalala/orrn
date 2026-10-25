/**
 * Pack helpers for `bundle.createReceipt` (FP-PK-01/02/07/14, spec §E6 "createReceipt batch").
 *
 * - `scaleConfigured`: a typed weight needs a reason while the plant's edge node reports a scale
 *   (`spool_deployment.scale_configured`, added by W1-SPOOL). Until that column exists the answer is
 *   false, so packing keeps working on a branch without it.
 * - Ageing seam (C32: the trolley slice is Next): `ageingRowId` is accepted and validated only when
 *   an `ageing_row` table exists (columns `id, company_id, die_id, length_mm, pcs, packed_pcs,
 *   scrap_pcs, rework_pcs`). Remaining = pcs − packed − scrap − rework, read before the batch and
 *   enforced again inside it (`drawAgeingRowStatements` + `packAbort`), so an over-draw never lands.
 * - Rejects at pack (`pack_reject`): one row per reject line; a weighed one posts `pack_reject`
 *   (+kg) at the plant-scrap location against the PLANT-SCRAP return stream (C10).
 */
import { TRPCError } from "@trpc/server";
import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { bundleQrUrl } from "@orrn/domain";
import { cast as castTable, returnStream } from "@orrn/db/schema/foundry";
import { bundle } from "@orrn/db/schema/inventory";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { reasonCode } from "@orrn/db/schema/reasons";
import { stockLedger } from "@orrn/db/schema/stock";
import { company } from "@orrn/db/schema/tenant";

import type { OrrnDb, SqliteBatchItem } from "./atomic";
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

/**
 * The trolley row as the ageing slice will ship it (C32), declared here only so the draw can be a
 * query builder statement inside a D1 batch. Not in the schema and not migrated: every use is
 * behind `ageingTablesExist`.
 */
const ageingRowSeam = sqliteTable("ageing_row", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull(),
  pcs: integer("pcs").notNull(),
  packedPcs: integer("packed_pcs").notNull(),
});

export function isPackAbort(e: unknown): boolean {
  return isBatchAbort(e, "pack_reject");
}

// ---------------------------------------------------------------------------
// Ageing seam (Next: trolley slice)
// ---------------------------------------------------------------------------

export async function ageingTablesExist(db: OrrnDb): Promise<boolean> {
  const rows = await db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table' and name = 'ageing_row'`);
  return rows.length > 0;
}

export type AgeingRowRead = { id: string; dieId: string; lengthMm: number; pcs: number; remaining: number };

/** The trolley row a receipt draws from, with its server remaining pieces. */
export async function readAgeingRow(db: OrrnDb, companyId: string, id: string): Promise<AgeingRowRead> {
  if (!(await ageingTablesExist(db))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Packing from a trolley is not on yet; pack by hand" });
  }
  const [row] = await db.all<{
    id: string;
    die_id: string;
    length_mm: number;
    pcs: number;
    packed_pcs: number;
    scrap_pcs: number;
    rework_pcs: number;
  }>(
    sql`select id, die_id, length_mm, pcs, coalesce(packed_pcs, 0) as packed_pcs, coalesce(scrap_pcs, 0) as scrap_pcs,
          coalesce(rework_pcs, 0) as rework_pcs
        from ageing_row where id = ${id} and company_id = ${companyId} limit 1`,
  );
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Trolley row not found" });
  const pcs = Number(row.pcs);
  return {
    id: row.id,
    dieId: row.die_id,
    lengthMm: Number(row.length_mm),
    pcs,
    remaining: pcs - Number(row.packed_pcs) - Number(row.scrap_pcs) - Number(row.rework_pcs),
  };
}

/** Every piece leaving the trolley through pack (good and rejected) counts as packed (C11). */
export function drawAgeingRowStatements(db: OrrnDb, companyId: string, rowId: string, pcs: number): SqliteBatchItem[] {
  return [
    db
      .update(ageingRowSeam)
      .set({ packedPcs: sql`coalesce(${ageingRowSeam.packedPcs}, 0) + ${pcs}` })
      .where(and(eq(ageingRowSeam.id, rowId), eq(ageingRowSeam.companyId, companyId))),
    packAbort(
      db,
      sql`not exists (select 1 from ageing_row ar where ar.id = ${rowId} and ar.company_id = ${companyId}
            and coalesce(ar.packed_pcs, 0) + coalesce(ar.scrap_pcs, 0) + coalesce(ar.rework_pcs, 0) <= ar.pcs)`,
    ),
  ];
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
  const [co] = await db.select({ slug: company.slug }).from(company).where(eq(company.id, companyId)).limit(1);
  const [castRow] = bundleRow.castId
    ? await db
        .select({ number: castTable.number })
        .from(castTable)
        .where(and(eq(castTable.id, bundleRow.castId), eq(castTable.companyId, companyId)))
        .limit(1)
    : [];
  const lineId = bundleRow.packedSalesOrderLineId ?? bundleRow.salesOrderLineId;
  const [lineRow] = lineId
    ? await db
        .select({ number: salesOrder.number, lineNo: salesOrderLine.lineNo })
        .from(salesOrderLine)
        .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, companyId)))
        .where(and(eq(salesOrderLine.id, lineId), eq(salesOrderLine.companyId, companyId)))
        .limit(1)
    : [];
  return buildPackLabelVariables({
    bundleRow,
    qrUrl: bundleQrUrl({ origin: webBaseUrl(), number: bundleRow.serial, companySlug: co?.slug ?? "" }),
    castNumber: castRow?.number ?? null,
    salesOrderCode: lineRow ? salesOrderLineCode(lineRow.number, Number(lineRow.lineNo)) : null,
  });
}

/** `SO-12/1`: an order line as the label and the packing list print it. */
export function salesOrderLineCode(orderNumber: string, lineNo: number): string {
  return `${orderNumber}/${lineNo}`;
}

/**
 * D6 `restoreAgeingRow`: a bundle packed from a trolley row gives its pieces back when voided and
 * takes them again when restored, in the status change's own batch. Lands only when the bundle
 * write beside it landed (`server_seq = seq` and the new status). Restoring past what the row has
 * left fails the batch (`packAbort`). No-op until ageing tables exist (the caller checks).
 */
export function restoreAgeingRowStatements(
  db: OrrnDb,
  input: { companyId: string; bundleId: string; ageingRowId: string; seq: number; to: "void" | "available" },
): SqliteBatchItem[] {
  const sign = input.to === "void" ? sql`-` : sql`+`;
  const out: SqliteBatchItem[] = [
    db
      .update(ageingRowSeam)
      .set({
        packedPcs: sql`coalesce(${ageingRowSeam.packedPcs}, 0) ${sign} (select b.quantity from ${bundle} b
          where b.id = ${input.bundleId} and b.company_id = ${input.companyId} and b.server_seq = ${input.seq} and b.status = ${input.to})`,
      })
      .where(
        and(
          eq(ageingRowSeam.id, input.ageingRowId),
          eq(ageingRowSeam.companyId, input.companyId),
          sql`exists (select 1 from ${bundle} b where b.id = ${input.bundleId} and b.company_id = ${input.companyId}
            and b.server_seq = ${input.seq} and b.status = ${input.to})`,
        ),
      ),
  ];
  if (input.to === "available") {
    out.push(
      packAbort(
        db,
        sql`exists (select 1 from ageing_row ar where ar.id = ${input.ageingRowId} and ar.company_id = ${input.companyId}
              and coalesce(ar.packed_pcs, 0) + coalesce(ar.scrap_pcs, 0) + coalesce(ar.rework_pcs, 0) > ar.pcs)`,
      ),
    );
  }
  return out;
}
