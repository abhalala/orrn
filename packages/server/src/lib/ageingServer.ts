/**
 * Ageing server reads and shared writes (W3-AG-S): the row and batch views the router answers with,
 * the soak verdict from the log, hardness summaries, the reading feed (typed, telemetry, simulator)
 * and the release of whole-bundle rows. Every query is company scoped; IN lists are chunked
 * (IN_LIST_CHUNK) and inserts go through `pushChunkedInserts` with every column named (≤ 100 bound
 * parameters per statement).
 */
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import { approval } from "@orrn/db/schema/approval";
import { ageingBatch, ageingRecipe, ageingRow, ageingTempLog, type AgeingBatchRow } from "@orrn/db/schema/ageing";
import { bundle } from "@orrn/db/schema/inventory";
import { reasonCode } from "@orrn/db/schema/reasons";
import {
  AGEING_READING_HOLD_MAX_MIN,
  ageingBatchPhase,
  ageingBatchTotals,
  ageingCapacity,
  ageingInBand,
  ageingReadingGates,
  ageingRowRemaining,
  hardnessSummary,
  soakCompliance,
  type AgeingRefusalCode,
  type AgeingRowStatus,
  type HardnessRule,
  type HardnessSample,
  type HardnessSummary,
} from "@orrn/domain";

import type {
  AgeingBatchDetail,
  AgeingBatchSummary,
  AgeingRowView,
} from "./ageingContracts";
import { closeEmptyStatements } from "./ageing";
import { ageingRefusal } from "./ageingRefusals";
import { chunk, IN_LIST_CHUNK, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "./atomic";

const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));
const ms = (v: Date | number | null | undefined) => (v == null ? null : v instanceof Date ? v.getTime() : Number(v));
const list = (ids: readonly string[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

export const sectionLabel = (r: { name: string | null; series: string | null; sectionCode: string | null }) =>
  r.name?.trim() ? r.name : `${r.series ?? ""} ${r.sectionCode ?? ""}`.trim();

// ---------------------------------------------------------------------------
// Reads: batch, rows, readings, hardness
// ---------------------------------------------------------------------------

export async function readBatch(db: OrrnDb, companyId: string, batchId: string): Promise<AgeingBatchRow> {
  const [b] = await db
    .select()
    .from(ageingBatch)
    .where(and(eq(ageingBatch.companyId, companyId), eq(ageingBatch.id, batchId)))
    .limit(1);
  if (!b) throw ageingRefusal("batch_not_found");
  return b;
}

/** The hardness rule of a batch's snapshot (null before start). */
export function ruleOf(b: AgeingBatchRow): HardnessRule | null {
  if (b.hardnessMethod == null || b.hardnessMinX10 == null) return null;
  return { method: b.hardnessMethod, minX10: b.hardnessMinX10, maxX10: b.hardnessMaxX10, sampleCount: b.sampleCount ?? 1 };
}

export type RowRead = AgeingRowView & { holdKind: "ageing_hold" | "ageing_reject" | null; holdCode: string | null; sortOrder: number; isReworkSuccessor: boolean };

type RowSql = {
  id: string;
  batch_id: string;
  source: AgeingRowView["source"];
  status: AgeingRowStatus;
  press_run_id: string | null;
  press_run_number: string | null;
  press_run_line_id: string | null;
  bundle_id: string | null;
  bundle_serial: string | null;
  die_id: string;
  die_name: string | null;
  series: string | null;
  section_code: string | null;
  die_instance_id: string | null;
  die_instance_code: string | null;
  cast_id: string | null;
  cast_code: string | null;
  sales_order_id: string | null;
  sales_order_line_id: string | null;
  sales_order_number: string | null;
  customer_name: string | null;
  customer_po: string | null;
  length_mm: number;
  pcs: number;
  kg_g: number;
  packed_pcs: number;
  scrap_pcs: number;
  rework_pcs: number;
  hold_reason_code_id: string | null;
  hold_note: string | null;
  hold_kind: string | null;
  hold_code: string | null;
  hardness_method: AgeingRowView["hardnessMethod"];
  hardness_reading_x10: number | null;
  hardness_pass: number | null;
  sort_order: number;
  is_successor: number;
};

/** Rows of these batches with their names (press run, bundle, section, copy, cast, order, customer, hold kind). */
export async function readRows(db: OrrnDb, companyId: string, batchIds: readonly string[]): Promise<RowRead[]> {
  const out: RowRead[] = [];
  for (const ids of chunk([...new Set(batchIds)], IN_LIST_CHUNK)) {
    const rows = await db.all<RowSql>(sql`
      select r.id, r.batch_id, r.source, r.status, r.press_run_id, pr.number as press_run_number, r.press_run_line_id,
        r.bundle_id, b.serial as bundle_serial, r.die_id, d.name as die_name, d.series, d.section_code,
        r.die_instance_id, di.code as die_instance_code, r.cast_id, c.number as cast_code,
        coalesce(r.sales_order_id, sol.sales_order_id) as sales_order_id, r.sales_order_line_id, so.number as sales_order_number,
        cu.name as customer_name, r.customer_po, r.length_mm, r.pcs, r.kg_g, r.packed_pcs, r.scrap_pcs, r.rework_pcs,
        r.hold_reason_code_id, r.hold_note, rc.kind as hold_kind, rc.code as hold_code,
        r.hardness_method, r.hardness_reading_x10, r.hardness_pass, r.sort_order,
        exists (select 1 from ageing_row o where o.company_id = r.company_id and o.rework_row_id = r.id) as is_successor
      from ageing_row r
      join die d on d.id = r.die_id and d.company_id = r.company_id
      left join press_run pr on pr.id = r.press_run_id and pr.company_id = r.company_id
      left join bundle b on b.id = r.bundle_id and b.company_id = r.company_id
      left join die_instance di on di.id = r.die_instance_id and di.company_id = r.company_id
      left join cast c on c.id = r.cast_id and c.company_id = r.company_id
      left join sales_order_line sol on sol.id = r.sales_order_line_id and sol.company_id = r.company_id
      left join sales_order so on so.id = coalesce(r.sales_order_id, sol.sales_order_id) and so.company_id = r.company_id
      left join customer cu on cu.id = so.customer_id and cu.company_id = r.company_id
      left join reason_code rc on rc.id = r.hold_reason_code_id and rc.company_id = r.company_id
      where r.company_id = ${companyId} and r.batch_id in (${list(ids)})
      order by r.sort_order, r.created_at, r.id`);
    for (const r of rows) {
      const counts = { pcs: num(r.pcs), packedPcs: num(r.packed_pcs), scrapPcs: num(r.scrap_pcs), reworkPcs: num(r.rework_pcs) };
      const remaining = r.status === "void" ? 0 : ageingRowRemaining(counts);
      out.push({
        id: r.id,
        batchId: r.batch_id,
        source: r.source,
        status: r.status,
        pressRunId: r.press_run_id,
        pressRunNumber: r.press_run_number,
        pressRunLineId: r.press_run_line_id,
        bundleId: r.bundle_id,
        bundleSerial: r.bundle_serial,
        dieId: r.die_id,
        sectionLabel: sectionLabel({ name: r.die_name, series: r.series, sectionCode: r.section_code }),
        dieInstanceId: r.die_instance_id,
        dieInstanceCode: r.die_instance_code,
        castId: r.cast_id,
        castCode: r.cast_code,
        salesOrderId: r.sales_order_id,
        salesOrderLineId: r.sales_order_line_id,
        salesOrderNumber: r.sales_order_number,
        customerName: r.customer_name,
        customerPo: r.customer_po,
        lengthMm: num(r.length_mm),
        ...counts,
        kgG: num(r.kg_g),
        remainingPcs: remaining,
        theoreticalRemainingKgG: counts.pcs > 0 ? Math.floor((num(r.kg_g) * remaining) / counts.pcs) : 0,
        holdReasonCodeId: r.hold_reason_code_id,
        holdNote: r.hold_note,
        hardnessMethod: r.hardness_method,
        hardnessReadingX10: numOrNull(r.hardness_reading_x10),
        hardnessPass: r.hardness_pass == null ? null : Boolean(Number(r.hardness_pass)),
        holdKind: r.hold_kind === "ageing_hold" || r.hold_kind === "ageing_reject" ? r.hold_kind : null,
        holdCode: r.hold_code,
        sortOrder: num(r.sort_order),
        isReworkSuccessor: Boolean(Number(r.is_successor)),
      });
    }
  }
  return out;
}

export const publicRow = (r: RowRead): AgeingRowView => {
  const { holdKind: _k, holdCode: _c, sortOrder: _s, isReworkSuccessor: _r, ...view } = r;
  return view;
};

export async function readReadings(db: OrrnDb, companyId: string, batchId: string) {
  return db
    .select({ id: ageingTempLog.id, at: ageingTempLog.at, tempCX10: ageingTempLog.tempCX10, source: ageingTempLog.source, note: ageingTempLog.note })
    .from(ageingTempLog)
    .where(and(eq(ageingTempLog.companyId, companyId), eq(ageingTempLog.batchId, batchId)))
    .orderBy(ageingTempLog.at, ageingTempLog.id);
}

/** Samples per row (chunked). */
export async function readSamples(db: OrrnDb, companyId: string, rowIds: readonly string[]) {
  const out = new Map<string, { id: string; rowId: string; method: HardnessSample["method"]; readingX10: number; pass: boolean; testedAt: number }[]>();
  for (const ids of chunk([...new Set(rowIds)], IN_LIST_CHUNK)) {
    const rows = await db.all<{ id: string; row_id: string; method: HardnessSample["method"]; reading_x10: number; pass: number; tested_at: number }>(
      sql`select id, row_id, method, reading_x10, pass, tested_at from ageing_hardness
          where company_id = ${companyId} and row_id in (${list(ids)}) order by tested_at, id`,
    );
    for (const r of rows) {
      const arr = out.get(r.row_id) ?? [];
      arr.push({ id: r.id, rowId: r.row_id, method: r.method, readingX10: num(r.reading_x10), pass: Boolean(Number(r.pass)), testedAt: num(r.tested_at) });
      out.set(r.row_id, arr);
    }
  }
  return out;
}

export function rowHardness(samples: readonly HardnessSample[] | undefined, rule: HardnessRule | null): Pick<HardnessSummary, "pass" | "reason"> & Partial<HardnessSummary> {
  if (!rule) return { pass: null, reason: "untested" };
  return hardnessSummary(samples ?? [], rule);
}

// ---------------------------------------------------------------------------
// Soak
// ---------------------------------------------------------------------------

export function soakOf(b: AgeingBatchRow, readings: readonly { at: Date | number; tempCX10: number }[], nowMs: number) {
  if (b.targetTempX10 == null || b.toleranceX10 == null || b.soakMin == null || b.inAt == null) return null;
  return soakCompliance({
    readings: readings.map((r) => ({ at: ms(r.at)!, tempCX10: r.tempCX10 })),
    snapshot: { targetTempX10: b.targetTempX10, toleranceX10: b.toleranceX10, soakMin: b.soakMin, maxSoakMin: b.maxSoakMin },
    inAt: ms(b.inAt)!,
    outAt: ms(b.outAt),
    now: nowMs,
    holdMaxMin: AGEING_READING_HOLD_MAX_MIN,
  });
}

/** SQL: the batch's soak start = its first in-band reading at or after in_at (recomputed on every reading). */
export function soakStartStatement(db: OrrnDb, companyId: string, batchId: string, seq: number): SqliteBatchItem {
  return db
    .update(ageingBatch)
    .set({
      soakStartedAt: sql`(select min(t.at) from ageing_temp_log t where t.company_id = ${companyId} and t.batch_id = ${batchId}
        and t.at >= ageing_batch.in_at and t.temp_c_x10 between ageing_batch.target_temp_x10 - ageing_batch.tolerance_x10
        and ageing_batch.target_temp_x10 + ageing_batch.tolerance_x10)`,
      serverSeq: seq,
    })
    .where(and(eq(ageingBatch.companyId, companyId), eq(ageingBatch.id, batchId)));
}

// ---------------------------------------------------------------------------
// Board and detail views
// ---------------------------------------------------------------------------

type BatchNames = { trolleyCode: string; trolleyCapacityG: number | null; ovenCode: string | null; ovenCapacityG: number | null; recipeKind: string | null; recipeAlloy: string | null; recipeTemper: string | null };

export async function batchNames(db: OrrnDb, companyId: string, batches: readonly AgeingBatchRow[]): Promise<Map<string, BatchNames & { lastTempCX10: number | null }>> {
  const out = new Map<string, BatchNames & { lastTempCX10: number | null }>();
  for (const part of chunk(batches, IN_LIST_CHUNK)) {
    const ids = part.map((b) => b.id);
    const rows = await db.all<{
      id: string;
      trolley_code: string;
      trolley_capacity_g: number | null;
      oven_code: string | null;
      oven_capacity_g: number | null;
      recipe_kind: string | null;
      recipe_alloy: string | null;
      recipe_temper: string | null;
      last_temp: number | null;
    }>(sql`
      select b.id, t.code as trolley_code, t.capacity_g as trolley_capacity_g, o.code as oven_code, o.capacity_g as oven_capacity_g,
        rc.kind as recipe_kind, rc.alloy as recipe_alloy, rc.temper as recipe_temper,
        (select l.temp_c_x10 from ageing_temp_log l where l.company_id = b.company_id and l.batch_id = b.id order by l.at desc, l.id desc limit 1) as last_temp
      from ageing_batch b
      join trolley t on t.id = b.trolley_id and t.company_id = b.company_id
      left join ageing_oven o on o.id = b.oven_id and o.company_id = b.company_id
      left join ageing_recipe rc on rc.id = b.recipe_id and rc.company_id = b.company_id
      where b.company_id = ${companyId} and b.id in (${list(ids)})`);
    for (const r of rows) {
      out.set(r.id, {
        trolleyCode: r.trolley_code,
        trolleyCapacityG: numOrNull(r.trolley_capacity_g),
        ovenCode: r.oven_code,
        ovenCapacityG: numOrNull(r.oven_capacity_g),
        recipeKind: r.recipe_kind,
        recipeAlloy: r.recipe_alloy,
        recipeTemper: r.recipe_temper,
        lastTempCX10: numOrNull(r.last_temp),
      });
    }
  }
  return out;
}

export function recipeLabelOf(b: AgeingBatchRow, n: BatchNames | undefined): string | null {
  const alloy = b.alloy ?? n?.recipeAlloy ?? null;
  const temper = b.temper ?? n?.recipeTemper ?? null;
  if (!alloy || !temper) return null;
  return `${alloy} ${temper}${n?.recipeKind === "top_up" ? " top-up" : ""}`;
}

export function summaryOf(b: AgeingBatchRow, rows: readonly RowRead[], n: (BatchNames & { lastTempCX10: number | null }) | undefined): AgeingBatchSummary {
  const totals = ageingBatchTotals(rows);
  const capacityG = n?.ovenCapacityG ?? n?.trolleyCapacityG ?? null;
  return {
    id: b.id,
    number: b.number,
    status: b.status,
    phase: ageingBatchPhase(b),
    trolleyId: b.trolleyId,
    trolleyCode: n?.trolleyCode ?? "",
    ovenId: b.ovenId,
    ovenCode: n?.ovenCode ?? null,
    recipeLabel: recipeLabelOf(b, n),
    shiftId: b.shiftId,
    productionDay: b.productionDay,
    inAt: ms(b.inAt),
    outAt: ms(b.outAt),
    soakStartedAt: ms(b.soakStartedAt),
    soakMin: b.soakMin,
    lastTempCX10: n?.lastTempCX10 ?? null,
    capacity: ageingCapacity(totals.loadedKgG, capacityG),
    totals,
  };
}

export async function batchDetail(db: OrrnDb, companyId: string, b: AgeingBatchRow, opts: { nowMs: number; simulator: boolean }): Promise<AgeingBatchDetail> {
  const rows = await readRows(db, companyId, [b.id]);
  const names = await batchNames(db, companyId, [b]);
  const readings = await readReadings(db, companyId, b.id);
  const samples = await readSamples(db, companyId, rows.map((r) => r.id));
  const [pending] = await db
    .select({ id: approval.id })
    .from(approval)
    .where(and(eq(approval.companyId, companyId), eq(approval.kind, "ageing_override"), eq(approval.subjectId, b.id), eq(approval.status, "pending")))
    .limit(1);
  const [successor] = await db
    .select({ id: ageingBatch.id })
    .from(ageingBatch)
    .where(and(eq(ageingBatch.companyId, companyId), eq(ageingBatch.reworkOfBatchId, b.id)))
    .limit(1);
  const soak = soakOf(b, readings, opts.nowMs);
  const snapshot =
    b.targetTempX10 == null
      ? null
      : {
          alloy: b.alloy ?? "",
          temper: b.temper ?? "",
          targetTempX10: b.targetTempX10,
          toleranceX10: b.toleranceX10 ?? 0,
          soakMin: b.soakMin ?? 0,
          maxSoakMin: b.maxSoakMin,
          hardnessMethod: b.hardnessMethod ?? "webster",
          hardnessMinX10: b.hardnessMinX10 ?? 0,
          hardnessMaxX10: b.hardnessMaxX10,
          sampleCount: b.sampleCount ?? 1,
        };
  return {
    ...summaryOf(b, rows, names.get(b.id)),
    snapshot,
    gasStartMilli: b.gasStartMilli,
    gasEndMilli: b.gasEndMilli,
    gasUsedMilli: b.gasStartMilli != null && b.gasEndMilli != null && b.gasEndMilli >= b.gasStartMilli ? b.gasEndMilli - b.gasStartMilli : null,
    meterReset: Boolean(b.meterReset),
    soak: soak
      ? {
          verdict: soak.verdict,
          soakStartedAt: soak.soakStartedAt,
          inBandMin: soak.inBandMin,
          aboveBandMin: soak.aboveBandMin,
          belowBandMin: soak.belowBandMin,
          unknownMin: soak.unknownMin,
          soakElapsedMin: soak.soakElapsedMin,
          minX10: soak.minX10,
          maxX10: soak.maxX10,
          readingCount: soak.readingCount,
          met: soak.met,
        }
      : null,
    qcVerdict: b.qcVerdict,
    releasedAt: ms(b.releasedAt),
    overrideApprovalId: b.overrideApprovalId,
    pendingOverrideId: pending?.id ?? null,
    reworkOfBatchId: b.reworkOfBatchId,
    successorBatchId: successor?.id ?? null,
    disposition: b.disposition,
    voidReason: b.voidReason,
    rows: rows.map(publicRow),
    readings: readings.map((r) => ({
      id: r.id,
      at: ms(r.at)!,
      tempCX10: r.tempCX10,
      source: r.source,
      note: r.note,
      inBand: b.targetTempX10 != null && b.toleranceX10 != null ? ageingInBand(r.tempCX10, { targetTempX10: b.targetTempX10, toleranceX10: b.toleranceX10 }) : false,
    })),
    hardness: [...samples.values()].flat().map((s) => ({ id: s.id, rowId: s.rowId, method: s.method, readingX10: s.readingX10, pass: s.pass, testedAt: s.testedAt })),
    simulator: opts.simulator,
  };
}

// ---------------------------------------------------------------------------
// Reason codes
// ---------------------------------------------------------------------------

export async function reasonOfKind(db: OrrnDb, companyId: string, id: string, kind: string): Promise<{ id: string; code: string; label: string; requiresNote: boolean }> {
  const [r] = await db
    .select({ id: reasonCode.id, code: reasonCode.code, label: reasonCode.label, kind: reasonCode.kind, requiresNote: reasonCode.requiresNote, active: reasonCode.active })
    .from(reasonCode)
    .where(and(eq(reasonCode.companyId, companyId), eq(reasonCode.id, id)))
    .limit(1);
  if (!r || r.kind !== kind || !r.active) throw ageingRefusal("reason_wrong_kind");
  return { id: r.id, code: r.code, label: r.label, requiresNote: Boolean(r.requiresNote) };
}

/** `ageing_reject` reason ids by code (seeded with the defaults). */
export async function rejectReasonIds(db: OrrnDb, companyId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: reasonCode.id, code: reasonCode.code })
    .from(reasonCode)
    .where(and(eq(reasonCode.companyId, companyId), eq(reasonCode.kind, "ageing_reject")));
  return new Map(rows.map((r) => [r.code, r.id]));
}

// ---------------------------------------------------------------------------
// Whole-bundle rows: release marks the bundle aged (review I3)
// ---------------------------------------------------------------------------

/**
 * A released whole-bundle row: packed_pcs = pcs (the pieces are the bundle), the row closes, and
 * `bundle.ageing_row_id` names it so the bundle stays `aged` after its batch closes.
 */
export function releaseBundleRowStatements(db: OrrnDb, companyId: string, rowIds: readonly string[], seq: number): SqliteBatchItem[] {
  if (rowIds.length === 0) return [];
  const out: SqliteBatchItem[] = [];
  for (const ids of chunk([...rowIds], IN_LIST_CHUNK)) {
    out.push(
      db
        .update(bundle)
        .set({
          ageingRowId: sql`(select r.id from ageing_row r where r.company_id = ${companyId} and r.bundle_id = bundle.id and r.id in (${list(ids)}) and r.status = 'released' limit 1)`,
          serverSeq: seq,
        })
        .where(
          and(
            eq(bundle.companyId, companyId),
            sql`exists (select 1 from ageing_row r where r.company_id = ${companyId} and r.bundle_id = bundle.id and r.id in (${list(ids)}) and r.status = 'released')`,
          ),
        ),
      db
        .update(ageingRow)
        .set({ packedPcs: sql`${ageingRow.pcs} - ${ageingRow.scrapPcs} - ${ageingRow.reworkPcs}`, status: "closed", serverSeq: seq })
        .where(and(eq(ageingRow.companyId, companyId), inArray(ageingRow.id, ids), eq(ageingRow.source, "bundle"), eq(ageingRow.status, "released"))),
    );
  }
  return out;
}

/** Released bundle rows of a batch close, then the batch closes when nothing is left. */
export function afterReleaseStatements(db: OrrnDb, companyId: string, batchId: string, bundleRowIds: readonly string[], seq: number, userId: string | null): SqliteBatchItem[] {
  return [...releaseBundleRowStatements(db, companyId, bundleRowIds, seq), ...closeEmptyStatements(db, companyId, batchId, userId, seq)];
}

// ---------------------------------------------------------------------------
// The reading feed (typed, collector, simulator)
// ---------------------------------------------------------------------------

export type FeedResult = { inserted: number; refused: { at: number; code: AgeingRefusalCode }[] };

/**
 * Insert telemetry or simulator readings for a batch (FP-AG-17). Gated reading by reading
 * (`ageingReadingGates` with the feed's 2 min future slack); a replay of a reading of the same batch,
 * source, device and instant adds nothing (`ageing_temp_log_feed_device_unique`, insert-or-ignore).
 * The soak start is recomputed in the same batch.
 */
export async function ingestAgeingReadings(
  db: OrrnDb,
  companyId: string,
  input: { batchId: string; source: "telemetry" | "simulator"; deviceId: string; readings: readonly { at: number; tempCX10: number }[] },
  opts: { userId: string | null; nowMs: number; seq: number },
): Promise<FeedResult> {
  const b = await readBatch(db, companyId, input.batchId);
  const refused: FeedResult["refused"] = [];
  const good: { at: number; tempCX10: number }[] = [];
  for (const r of input.readings) {
    const gates = ageingReadingGates({ batchStatus: b.status, inAt: ms(b.inAt), outAt: ms(b.outAt), at: r.at, now: opts.nowMs, source: input.source });
    if (gates.length > 0) refused.push({ at: r.at, code: gates[0]! });
    else good.push(r);
  }
  if (good.length === 0) return { inserted: 0, refused };
  const before = await db.all<{ n: number }>(sql`select count(*) as n from ageing_temp_log where company_id = ${companyId} and batch_id = ${b.id}`);
  const statements: SqliteBatchItem[] = [];
  pushChunkedInserts(
    statements,
    (rows) => db.insert(ageingTempLog).values(rows).onConflictDoNothing(),
    good.map((r) => ({
      id: crypto.randomUUID(),
      companyId,
      serverSeq: opts.seq,
      batchId: b.id,
      at: new Date(r.at),
      tempCX10: r.tempCX10,
      source: input.source,
      deviceId: input.deviceId,
      note: null,
      clientMutationId: null,
      createdBy: opts.userId,
    })),
  );
  statements.push(soakStartStatement(db, companyId, b.id, opts.seq));
  await db.batch(statements as never);
  const after = await db.all<{ n: number }>(sql`select count(*) as n from ageing_temp_log where company_id = ${companyId} and batch_id = ${b.id}`);
  return { inserted: num(after[0]?.n) - num(before[0]?.n), refused };
}

/** Active recipe of an alloy/temper/kind (rework picks the top-up one when none is named). */
export async function activeRecipe(db: OrrnDb, companyId: string, alloy: string, temper: string, kind: "full" | "top_up") {
  const [r] = await db
    .select()
    .from(ageingRecipe)
    .where(and(eq(ageingRecipe.companyId, companyId), eq(ageingRecipe.alloy, alloy), eq(ageingRecipe.temper, temper), eq(ageingRecipe.kind, kind), eq(ageingRecipe.status, "active")))
    .limit(1);
  return r ?? null;
}

// ---------------------------------------------------------------------------
// reports.ageing (spec §5): one row per ageing row whose batch went in during [from, to]
// ---------------------------------------------------------------------------

export const AGEING_REPORT_COLUMNS = [
  "Batch",
  "Oven",
  "Trolley",
  "Shift",
  "In",
  "Out",
  "Soak min",
  "Recipe soak min",
  "Set °C",
  "Min °C",
  "Max °C",
  "Press run",
  "Order",
  "Customer",
  "Customer PO",
  "Cast",
  "Die copy",
  "Section",
  "Length mm",
  "Loaded pcs",
  "Taken by pack pcs",
  "On bundles pcs",
  "Remaining pcs",
  "Held",
  "Source",
  "Hardness method",
  "Samples",
  "Median",
  "Pass",
] as const;

export async function ageingReport(
  db: OrrnDb,
  companyId: string,
  input: { fromMs: number; toMs: number; shiftId?: string; ovenId?: string; dieId?: string; customerId?: string; castId?: string; status?: string; limit: number; offset: number },
  shifts: readonly { id: string; name: string }[],
): Promise<{ rows: import("./ageingContracts").AgeingReportRow[]; total: number }> {
  const conds: SQL[] = [sql`b.company_id = ${companyId}`, sql`b.in_at >= ${input.fromMs}`, sql`b.in_at < ${input.toMs}`, sql`r.status <> 'void'`];
  if (input.shiftId) conds.push(sql`b.shift_id = ${input.shiftId}`);
  if (input.ovenId) conds.push(sql`b.oven_id = ${input.ovenId}`);
  if (input.dieId) conds.push(sql`r.die_id = ${input.dieId}`);
  if (input.castId) conds.push(sql`r.cast_id = ${input.castId}`);
  if (input.status) conds.push(sql`b.status = ${input.status}`);
  if (input.customerId) conds.push(sql`so.customer_id = ${input.customerId}`);
  const where = sql.join(conds, sql` and `);
  const from = sql`from ageing_row r join ageing_batch b on b.id = r.batch_id and b.company_id = r.company_id
    left join sales_order_line sol on sol.id = r.sales_order_line_id and sol.company_id = r.company_id
    left join sales_order so on so.id = coalesce(r.sales_order_id, sol.sales_order_id) and so.company_id = r.company_id`;
  const [total] = await db.all<{ n: number }>(sql`select count(*) as n ${from} where ${where}`);
  const ids = await db.all<{ id: string; batch_id: string }>(sql`select r.id, r.batch_id ${from} where ${where} order by b.in_at, b.number, r.sort_order limit ${input.limit} offset ${input.offset}`);
  if (ids.length === 0) return { rows: [], total: num(total?.n) };
  const batchIds = [...new Set(ids.map((r) => r.batch_id))];
  const rows = (await readRows(db, companyId, batchIds)).filter((r) => ids.some((x) => x.id === r.id));
  const batches: AgeingBatchRow[] = [];
  for (const part of chunk(batchIds, IN_LIST_CHUNK)) batches.push(...(await db.select().from(ageingBatch).where(and(eq(ageingBatch.companyId, companyId), inArray(ageingBatch.id, part)))));
  const byBatch = new Map(batches.map((b) => [b.id, b]));
  const names = await batchNames(db, companyId, batches);
  const temps = new Map<string, { min: number | null; max: number | null }>();
  for (const part of chunk(batchIds, IN_LIST_CHUNK)) {
    const t = await db.all<{ batch_id: string; mn: number | null; mx: number | null }>(
      sql`select batch_id, min(temp_c_x10) as mn, max(temp_c_x10) as mx from ageing_temp_log where company_id = ${companyId} and batch_id in (${list(part)}) group by batch_id`,
    );
    for (const x of t) temps.set(x.batch_id, { min: numOrNull(x.mn), max: numOrNull(x.mx) });
  }
  const samples = await readSamples(db, companyId, rows.map((r) => r.id));
  // Pieces on live bundles packed from each row (packed_pcs also counts pack-time rejects).
  const onBundles = new Map<string, number>();
  for (const part of chunk(rows.map((r) => r.id), IN_LIST_CHUNK)) {
    const t = await db.all<{ row_id: string; n: number }>(
      sql`select ageing_row_id as row_id, coalesce(sum(quantity), 0) as n from bundle where company_id = ${companyId} and status <> 'void' and ageing_row_id in (${list(part)}) group by ageing_row_id`,
    );
    for (const x of t) onBundles.set(x.row_id, num(x.n));
  }
  const order = new Map(ids.map((r, i) => [r.id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return {
    total: num(total?.n),
    rows: rows.map((r) => {
      const b = byBatch.get(r.batchId)!;
      const n = names.get(b.id);
      const rule = ruleOf(b);
      const mine = (samples.get(r.id) ?? []).filter((s) => !rule || s.method === rule.method);
      const h = rule ? hardnessSummary(mine, rule) : null;
      const soakMin = b.soakStartedAt && b.outAt ? Math.max(0, Math.round((ms(b.outAt)! - ms(b.soakStartedAt)!) / 60_000)) : null;
      return {
        batchNumber: b.number,
        ovenCode: n?.ovenCode ?? null,
        trolleyCode: n?.trolleyCode ?? "",
        shiftName: shifts.find((s) => s.id === b.shiftId)?.name ?? null,
        inAt: ms(b.inAt),
        outAt: ms(b.outAt),
        soakMin: b.soakInBandMin ?? soakMin,
        recipeSoakMin: b.soakMin,
        setTempCX10: b.targetTempX10,
        actualMinX10: temps.get(b.id)?.min ?? null,
        actualMaxX10: temps.get(b.id)?.max ?? null,
        pressRunNumber: r.pressRunNumber,
        salesOrderNumber: r.salesOrderNumber,
        customerName: r.customerName,
        customerPo: r.customerPo,
        castCode: r.castCode,
        dieInstanceCode: r.dieInstanceCode,
        sectionLabel: r.sectionLabel,
        lengthMm: r.lengthMm,
        loadedPcs: r.pcs,
        takenByPackPcs: r.packedPcs,
        onBundlesPcs: onBundles.get(r.id) ?? 0,
        remainingPcs: r.remainingPcs,
        held: r.status === "held",
        source: r.source,
        hardnessMethod: rule?.method ?? null,
        sampleCount: mine.length,
        medianX10: h?.medianX10 ?? null,
        pass: h?.pass ?? null,
      };
    }),
  };
}
