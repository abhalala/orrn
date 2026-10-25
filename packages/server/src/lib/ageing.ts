/**
 * Ageing server helpers (W3-AG-C contracts; the router and the pack draw/restore land with W3-AG-S).
 *
 * - `ageingReopenBlocker`: `press.runs.reopen` is refused while a non-void ageing row points at the run
 *   (spec §6 "Pieces"). Not registered here: `routers/ageing.ts` calls
 *   `registerReopenBlocker(ageingReopenBlocker)` at module load so every worker has it.
 * - `openBundleRows`: the bundle rows on unfinished batches, for the derived bundle ageing state that
 *   dispatch reads (`bundleAgeingState` / `dispatchAgeingRefusal` in `@orrn/domain`).
 */
import { and, eq, getTableColumns, inArray, ne, sql, type SQL } from "drizzle-orm";

import { chunk, IN_LIST_CHUNK } from "@orrn/db/chunk";
import { AGEING_OPEN_BATCH_STATUSES, ageingBatch, ageingHardness, ageingRow, type AgeingRowStatus } from "@orrn/db/schema/ageing";
import { bundle } from "@orrn/db/schema/inventory";
import { company } from "@orrn/db/schema/tenant";
import { bundleAgeingState, dispatchAgeingRefusal, readFloorSettings } from "@orrn/domain";

import type { OrrnDb, SqliteBatchItem } from "./atomic";
import { ageingRefusal } from "./ageingRefusals";
import { companyTimezone, zonedYmd } from "./dayWindow";
import type { ApprovalApplier } from "./approvalApply";
import type { ReopenBlocker } from "./press/reopenBlockers";

/** The press-console sentence when a run's pieces are on an ageing batch. */
export const ageingReopenSentence = (batchNumber: string) => `Pieces of this run are on ageing batch ${batchNumber}; void that batch first`;

export const ageingReopenBlocker: ReopenBlocker = async (db, companyId, runId) => {
  const [hit] = await db
    .select({ number: ageingBatch.number })
    .from(ageingRow)
    .innerJoin(ageingBatch, and(eq(ageingBatch.id, ageingRow.batchId), eq(ageingBatch.companyId, ageingRow.companyId)))
    .where(and(eq(ageingRow.companyId, companyId), eq(ageingRow.pressRunId, runId), ne(ageingRow.status, "void"), ne(ageingBatch.status, "void")))
    .limit(1);
  return hit ? ageingReopenSentence(hit.number) : null;
};

export type OpenBundleRow = { bundleId: string; rowId: string; status: AgeingRowStatus; batchId: string; batchNumber: string };

/** Bundle rows on unfinished batches for these bundles (chunked IN lists, ≤ 100 params). */
export async function openBundleRows(db: OrrnDb, companyId: string, bundleIds: readonly string[]): Promise<Map<string, OpenBundleRow>> {
  const out = new Map<string, OpenBundleRow>();
  for (const ids of chunk([...new Set(bundleIds)], IN_LIST_CHUNK)) {
    const rows = await db
      .select({ bundleId: ageingRow.bundleId, rowId: ageingRow.id, status: ageingRow.status, batchId: ageingBatch.id, batchNumber: ageingBatch.number })
      .from(ageingRow)
      .innerJoin(ageingBatch, and(eq(ageingBatch.id, ageingRow.batchId), eq(ageingBatch.companyId, ageingRow.companyId)))
      .where(
        and(
          eq(ageingRow.companyId, companyId),
          eq(ageingRow.source, "bundle"),
          inArray(ageingRow.bundleId, ids),
          ne(ageingRow.status, "void"),
          inArray(ageingBatch.status, [...AGEING_OPEN_BATCH_STATUSES]),
        ),
      );
    for (const r of rows) if (r.bundleId) out.set(r.bundleId, { ...r, bundleId: r.bundleId });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Batch abort (W3-AG-S): a statement that fails the whole atomicBatch when a write-time guard does
// not hold (D1 has no transactions). Inserts an all-NULL row into ageing_hardness, whose id is NOT NULL.
// ---------------------------------------------------------------------------

export function ageingAbortUnless(db: OrrnDb, landed: SQL): SqliteBatchItem {
  const nulls = Object.fromEntries(Object.entries(getTableColumns(ageingHardness)).map(([key, column]) => [key, sql`null`.as(column.name)]));
  const from = db.select({ one: sql`1` }).from(company).limit(1).as("ageing_abort_src");
  return db.insert(ageingHardness).select(db.select(nulls).from(from).where(sql`not (${landed})`) as never);
}

export function isAgeingAbort(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    if ((cur instanceof Error ? cur.message : String(cur)).includes("NOT NULL constraint failed: ageing_hardness.id")) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

export function isUniqueOn(e: unknown, index: string): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    const m = cur instanceof Error ? cur.message : String(cur);
    if (m.includes("UNIQUE constraint failed") && m.includes(index)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** SQL: remaining pieces of the ageing_row alias `r` (pcs − packed − scrap − rework). */
export const remainingOf = (r: string) => sql.raw(`(${r}.pcs - ${r}.packed_pcs - ${r}.scrap_pcs - ${r}.rework_pcs)`);

// ---------------------------------------------------------------------------
// Close rows and batches that have nothing left (pack draw, discard, rework)
// ---------------------------------------------------------------------------

/**
 * Released or held rows of a batch with no pieces left become `closed`, then the batch closes when
 * no live row has pieces left (spec §4 draw; Q58: the trolley is free from that moment). A batch that
 * is still `loading`, `in_oven` or `out` is never closed here.
 */
export function closeEmptyStatements(db: OrrnDb, companyId: string, batchId: string, userId: string | null, seq: number): SqliteBatchItem[] {
  return [
    db
      .update(ageingRow)
      .set({ status: "closed", serverSeq: seq })
      .where(and(eq(ageingRow.companyId, companyId), eq(ageingRow.batchId, batchId), inArray(ageingRow.status, ["released", "held"]), sql`${remainingOf("ageing_row")} <= 0`)),
    db
      .update(ageingBatch)
      .set({ status: "closed", closedBy: userId, serverSeq: seq })
      .where(
        and(
          eq(ageingBatch.companyId, companyId),
          eq(ageingBatch.id, batchId),
          inArray(ageingBatch.status, ["released", "held"]),
          sql`exists (select 1 from ageing_row r where r.company_id = ${companyId} and r.batch_id = ${batchId} and r.status <> 'void')`,
          sql`not exists (select 1 from ageing_row r where r.company_id = ${companyId} and r.batch_id = ${batchId} and r.status <> 'void' and ${remainingOf("r")} > 0)`,
        ),
      ),
  ];
}

// ---------------------------------------------------------------------------
// What a press line already gave to trolleys (`pressLineLoaded`, review I4)
// ---------------------------------------------------------------------------

/** SQL true when the ageing_row alias `r` is a rework successor (another row's rework_row_id names it). */
export const isReworkSuccessorSql = (r: string) =>
  sql.raw(`exists (select 1 from ageing_row o where o.company_id = ${r}.company_id and o.rework_row_id = ${r}.id)`);

/**
 * SQL: pieces of the press line alias `l` on live trolley rows, in the LINE's cut-length units (review
 * I1): a split row keeps `press_run_line_id` but carries other lengths, so pieces count as
 * round(Σ (pcs − rework_pcs) × length_mm / cut_length_mm), in integers (half rounds up). 40 pcs @3658
 * split into 40 @1829 + 20 @3658 is still 40 of the line's pieces.
 */
export const lineLoadedPcsSql = (l: string) =>
  sql.raw(`((select coalesce(sum((ar.pcs - ar.rework_pcs) * ar.length_mm), 0) from ageing_row ar
      join ageing_batch ab on ab.id = ar.batch_id and ab.company_id = ar.company_id
      where ar.company_id = ${l}.company_id and ar.press_run_line_id = ${l}.id and ar.status <> 'void' and ab.status <> 'void')
    + ${l}.cut_length_mm / 2) / max(${l}.cut_length_mm, 1)`);

/** Loaded pieces (in the line's own cut-length units, review I1) and grams per press line over live rows (chunked IN lists). */
export async function pressLinesLoaded(db: OrrnDb, companyId: string, lineIds: readonly string[]): Promise<Map<string, { pcs: number; kgG: number }>> {
  const out = new Map<string, { pcs: number; kgG: number }>();
  for (const ids of chunk([...new Set(lineIds)], IN_LIST_CHUNK)) {
    const rows = await db.all<{ line_id: string; pcs: number; kg: number }>(
      sql`select l.id as line_id, ${lineLoadedPcsSql("l")} as pcs,
            (select coalesce(sum(case when ${isReworkSuccessorSql("r")} then 0 else r.kg_g end), 0)
              from ageing_row r join ageing_batch b on b.id = r.batch_id and b.company_id = r.company_id
              where r.company_id = l.company_id and r.press_run_line_id = l.id and r.status <> 'void' and b.status <> 'void') as kg
          from press_run_line l
          where l.company_id = ${companyId} and l.id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`,
    );
    for (const r of rows) if (Number(r.pcs) > 0 || Number(r.kg) > 0) out.set(r.line_id, { pcs: Number(r.pcs), kgG: Number(r.kg) });
  }
  return out;
}

/**
 * Write-time guard for a load: no press line among `lineIds` has more pieces on live rows than it
 * made, counted in its own cut-length units (a concurrent load of the same line fails this batch whole).
 */
export function pressLinesNotOverloadedSql(companyId: string, lineIds: readonly string[]): SQL {
  return sql`not exists (select 1 from press_run_line l where l.company_id = ${companyId} and l.id in (${sql.join(lineIds.map((i) => sql`${i}`), sql`, `)})
    and l.pcs < ${lineLoadedPcsSql("l")})`;
}

// ---------------------------------------------------------------------------
// The order strip's agedG (AG-15): theoretical grams still on trolleys for the outer order line
// ---------------------------------------------------------------------------

/**
 * Correlated on the outer `sales_order_line` (table-qualified, no parameter): every live trolley row
 * of the line, kg_g prorated by its remaining pieces (floored per row). Whole-bundle rows are already
 * bundles (in produced) and never count.
 */
export const agedExpr = sql<number>`(select coalesce(sum(case when ar.pcs > 0 then (ar.kg_g * max(0, ${remainingOf("ar")})) / ar.pcs else 0 end), 0)
  from ageing_row ar join ageing_batch ab on ab.id = ar.batch_id and ab.company_id = ar.company_id
  where ar.company_id = "sales_order_line"."company_id" and ar.sales_order_line_id = "sales_order_line"."id"
    and ar.status <> 'void' and ab.status <> 'void' and ar.source <> 'bundle')`;

// ---------------------------------------------------------------------------
// Dispatch (scan, add, reserve, complete): a bundle in the oven or held there never leaves
// ---------------------------------------------------------------------------

/**
 * Throws the first `dispatchAgeingRefusal` among these bundles (`ageingRefusal`, sentence and code):
 * a bundle in the oven or held there, always; one never aged when `settings.ageing.requireAgeing` is
 * on and it was packed on or after `requireAgeingSince` (company day). Reads chunked.
 */
export async function assertDispatchAgeing(db: OrrnDb, companyId: string, bundleIds: readonly string[]): Promise<void> {
  if (bundleIds.length === 0) return;
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  const settings = (co?.settings ?? {}) as Record<string, unknown>;
  const { ageing } = readFloorSettings(settings);
  const open = await openBundleRows(db, companyId, bundleIds);
  if (open.size === 0 && !ageing.requireAgeing) return;
  const tz = companyTimezone(settings);
  for (const ids of chunk([...new Set(bundleIds)], IN_LIST_CHUNK)) {
    const rows = await db
      .select({ id: bundle.id, serial: bundle.serial, ageingRowId: bundle.ageingRowId, createdAt: bundle.createdAt })
      .from(bundle)
      .where(and(eq(bundle.companyId, companyId), inArray(bundle.id, ids)));
    for (const b of rows) {
      const openRow = open.get(b.id) ?? null;
      const state = bundleAgeingState({ ageingRowId: b.ageingRowId, openRow });
      const ymd = zonedYmd(tz, b.createdAt ? new Date(b.createdAt).getTime() : Date.now());
      const packedDay = `${ymd.year}-${String(ymd.month).padStart(2, "0")}-${String(ymd.day).padStart(2, "0")}`;
      const code = dispatchAgeingRefusal({ state, requireAgeing: ageing.requireAgeing, requireAgeingSince: ageing.requireAgeingSince, packedDay });
      if (code) throw ageingRefusal(code, { serial: b.serial, batch: openRow?.batchNumber ?? "" });
    }
  }
}

/**
 * Review m6: the write-time half of `assertDispatchAgeing` for a dispatch write: none of these bundles
 * sits on an unfinished batch in the oven or held there (its own row pending or held). A load that
 * landed between the dispatch's read and its write fails the dispatch batch whole (`isAgeingAbort`);
 * the caller reads again and refuses by name.
 */
export function dispatchAgeingGuardStatements(db: OrrnDb, companyId: string, bundleIds: readonly string[]): SqliteBatchItem[] {
  return chunk([...new Set(bundleIds)], IN_LIST_CHUNK - 5).map((ids) =>
    ageingAbortUnless(
      db,
      sql`not exists (select 1 from ageing_row r join ageing_batch b on b.id = r.batch_id and b.company_id = r.company_id
        where r.company_id = ${companyId} and r.source = 'bundle' and r.status in ('pending', 'held')
          and b.status in ('loading', 'in_oven', 'out', 'released', 'held')
          and r.bundle_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}))`,
    ),
  );
}

// ---------------------------------------------------------------------------
// Approval applier (ageing_override): approving stamps the batch; the supervisor then releases
// ---------------------------------------------------------------------------

/**
 * Spec §4: approving does not itself release. The approved request's id goes on the batch
 * (`override_approval_id`), and the next `ageing.batches.release` / `unhold` sees it. Guarded by the
 * decision landing on the approval row and by the batch still being open; a rejection changes nothing.
 */
export const ageingOverrideDecision: ApprovalApplier = (ctx, row, decision) => {
  if (decision !== "approved") return [];
  return [
    ctx.db
      .update(ageingBatch)
      .set({ overrideApprovalId: row.id, serverSeq: ctx.seq })
      .where(
        and(
          eq(ageingBatch.companyId, ctx.companyId),
          eq(ageingBatch.id, row.subjectId),
          inArray(ageingBatch.status, ["out", "released", "held"]),
          sql`exists (select 1 from approval a where a.id = ${row.id} and a.company_id = ${ctx.companyId} and a.server_seq = ${ctx.seq} and a.status = 'approved')`,
        ),
      ),
  ];
};
