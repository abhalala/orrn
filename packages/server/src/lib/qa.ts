/**
 * Quality gates other modules call (XE parity lane QA): the dispatch scan refuses a bundle on quality
 * hold (row 29), pack waits for a run's first piece (row 24, plant setting), a melt cannot charge a lot
 * that waits for inspection or failed it (row 22, plant setting). Each gate does nothing when the `qa`
 * module is off for the plant, so a plant that did not buy quality sees no change. Reads only; the
 * refusal sentences are in `lib/qaRefusals.ts`.
 */
import { and, desc, eq, getTableColumns, inArray, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm";

import { ageingRow } from "@orrn/db/schema/ageing";
import { bundle } from "@orrn/db/schema/inventory";
import { pressRun } from "@orrn/db/schema/press";
import { qaCheck, qaHold } from "@orrn/db/schema/qa";
import { company } from "@orrn/db/schema/tenant";
import { firstPieceRefusal, isModuleOn, lotChargeRefusal, readQaSettings, type QaCheckKind, type QaResult, type QaSettings, type QaSubjectType } from "@orrn/domain";

import { chunk, IN_LIST_CHUNK, mapInChunks, type OrrnDb, type SqliteBatchItem } from "./atomic";
import { companyTimezone, zonedYmd } from "./dayWindow";
import { qaRefusal } from "./qaRefusals";

export type QaPlant = { on: boolean; settings: QaSettings; timezone: string; raw: Record<string, unknown> };

/** Whether `qa` is on, the plant's quality settings and its timezone, in one read. */
export async function readQaPlant(db: OrrnDb, companyId: string): Promise<QaPlant> {
  const [row] = await db.select({ modules: company.modules, settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  const raw = (row?.settings ?? {}) as Record<string, unknown>;
  const modules = Array.isArray(row?.modules) ? row.modules : [];
  return { on: isModuleOn(modules, "qa"), settings: readQaSettings(raw), timezone: companyTimezone(raw), raw };
}

/** The company day (`YYYY-MM-DD`) of an instant on the plant's wall clock. */
export function companyDay(timezone: string, ms: number): string {
  const y = zonedYmd(timezone, ms);
  return `${y.year}-${String(y.month).padStart(2, "0")}-${String(y.day).padStart(2, "0")}`;
}

/** The latest result of one check kind per subject (newest `checked_at` wins), chunked under the D1 limit. */
export async function latestResults(db: OrrnDb, companyId: string, kind: QaCheckKind, subjectType: QaSubjectType, ids: readonly string[]): Promise<Map<string, { result: QaResult; checkedAt: Date; id: string }>> {
  const out = new Map<string, { result: QaResult; checkedAt: Date; id: string }>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const rows = await mapInChunks(unique, (part) =>
    db
      .select({ id: qaCheck.id, subjectId: qaCheck.subjectId, result: qaCheck.result, checkedAt: qaCheck.checkedAt })
      .from(qaCheck)
      .where(and(eq(qaCheck.companyId, companyId), eq(qaCheck.kind, kind), eq(qaCheck.subjectType, subjectType), inArray(qaCheck.subjectId, part)))
      .orderBy(desc(qaCheck.checkedAt), desc(qaCheck.id)),
  );
  for (const r of rows) {
    const had = out.get(r.subjectId);
    if (!had || r.checkedAt.getTime() > had.checkedAt.getTime()) out.set(r.subjectId, { result: r.result, checkedAt: r.checkedAt, id: r.id });
  }
  return out;
}

/** Open quality holds of these bundles, keyed by bundle id (company scoped, chunked). */
export async function openHolds(db: OrrnDb, companyId: string, bundleIds: readonly string[]): Promise<Map<string, { id: string; reason: string; heldAt: Date }>> {
  const unique = [...new Set(bundleIds)];
  if (unique.length === 0) return new Map();
  const rows = await mapInChunks(unique, (part) =>
    db
      .select({ id: qaHold.id, bundleId: qaHold.bundleId, reason: qaHold.reason, heldAt: qaHold.heldAt })
      .from(qaHold)
      .where(and(eq(qaHold.companyId, companyId), inArray(qaHold.bundleId, part), isNull(qaHold.releasedAt))),
  );
  return new Map(rows.map((r) => [r.bundleId, { id: r.id, reason: r.reason, heldAt: r.heldAt }]));
}

/**
 * Row 29: the dispatch scan (and the office's add by serial, the same path) refuses a bundle on quality
 * hold. Throws the first held bundle by its serial. No-op with `qa` off.
 */
export async function assertNoQaHold(db: OrrnDb, companyId: string, bundleIds: readonly string[]): Promise<void> {
  if (bundleIds.length === 0) return;
  const plant = await readQaPlant(db, companyId);
  if (!plant.on) return;
  const held = await openHolds(db, companyId, bundleIds);
  if (held.size === 0) return;
  const firstId = bundleIds.find((id) => held.has(id))!;
  const [b] = await db.select({ serial: bundle.serial }).from(bundle).where(and(eq(bundle.companyId, companyId), eq(bundle.id, firstId))).limit(1);
  throw qaRefusal("bundle_on_qa_hold", { serial: b?.serial ?? "" });
}

/**
 * A batch statement that fails the whole batch unless `landed` holds: it inserts an all-NULL row into
 * `qa_hold` (NOT NULL on id). Catch with `isQaAbort`. Same pattern as `batchAbortUnless`.
 */
export function qaAbortUnless(db: OrrnDb, landed: SQL): SqliteBatchItem {
  const nulls = Object.fromEntries(Object.entries(getTableColumns(qaHold)).map(([key, column]) => [key, sql`null`.as(column.name)]));
  const from = db.select({ one: sql`1` }).from(company).limit(1).as("qa_abort_src");
  return db.insert(qaHold).select(db.select(nulls).from(from).where(sql`not (${landed})`) as never);
}

export function isQaAbort(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    if ((cur instanceof Error ? cur.message : String(cur)).includes("NOT NULL constraint failed: qa_hold.id")) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Row 29, write time (review B1): none of these bundles has an open quality hold when the dispatch
 * write runs. A hold placed between the read and the write fails the batch whole (`isQaAbort`);
 * the caller reads again and refuses by name (`assertNoQaHold`). Empty with `qa` off.
 */
export async function qaHoldGuardStatements(db: OrrnDb, companyId: string, bundleIds: readonly string[]): Promise<SqliteBatchItem[]> {
  if (bundleIds.length === 0) return [];
  if (!(await readQaPlant(db, companyId)).on) return [];
  return chunk([...new Set(bundleIds)], IN_LIST_CHUNK - 5).map((ids) =>
    qaAbortUnless(
      db,
      sql`not exists (select 1 from qa_hold h where h.company_id = ${companyId} and h.released_at is null
        and h.bundle_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}))`,
    ),
  );
}

/**
 * The run a pack draws from, for the first-piece gate: the trolley row's run when the pack draws from
 * one, else the newest started run of the die copy (the run on the press, or the last one that ran).
 * Review B2: a pack that names no copy gates on the section's newest started run (its copy came from
 * its die issue, so that run is the newest of its copy too). Null only when the section never ran
 * under orrn.
 */
export async function packRun(
  db: OrrnDb,
  companyId: string,
  o: { sectionId: string; dieInstanceId: string | null; ageingRowId: string | null },
): Promise<{ id: string; number: string; startedAt: Date } | null> {
  if (o.ageingRowId) {
    const [r] = await db
      .select({ id: pressRun.id, number: pressRun.number, startedAt: pressRun.startedAt })
      .from(ageingRow)
      .innerJoin(pressRun, and(eq(pressRun.id, ageingRow.pressRunId), eq(pressRun.companyId, ageingRow.companyId)))
      .where(and(eq(ageingRow.companyId, companyId), eq(ageingRow.id, o.ageingRowId)))
      .limit(1);
    if (r?.startedAt) return { id: r.id, number: r.number, startedAt: r.startedAt };
  }
  const [r] = await db
    .select({ id: pressRun.id, number: pressRun.number, startedAt: pressRun.startedAt })
    .from(pressRun)
    .where(
      and(
        eq(pressRun.companyId, companyId),
        o.dieInstanceId ? eq(pressRun.dieInstanceId, o.dieInstanceId) : eq(pressRun.sectionId, o.sectionId),
        isNotNull(pressRun.startedAt),
        ne(pressRun.status, "voided"),
      ),
    )
    .orderBy(desc(pressRun.startedAt))
    .limit(1);
  return r?.startedAt ? { id: r.id, number: r.number, startedAt: r.startedAt } : null;
}

/** Row 24: pack waits until the run's first piece passed, when the plant setting is on. No-op with `qa` off. */
export async function assertFirstPiece(db: OrrnDb, companyId: string, o: { sectionId: string; dieInstanceId: string | null; ageingRowId: string | null }): Promise<void> {
  const plant = await readQaPlant(db, companyId);
  if (!plant.on || !plant.settings.firstPieceBlocksPack) return;
  const run = await packRun(db, companyId, o);
  const latest = run ? ((await latestResults(db, companyId, "first_piece", "press_run", [run.id])).get(run.id)?.result ?? null) : null;
  const code = firstPieceRefusal({
    required: true,
    since: plant.settings.firstPieceSince,
    run: run ? { startedDay: companyDay(plant.timezone, run.startedAt.getTime()), latest } : null,
  });
  if (code) throw qaRefusal(code, { run: run!.number });
}

/**
 * Row 22: a melt cannot charge a lot that is waiting for inspection or failed it, when the plant setting
 * is on (lots received before the switch day are exempt). No-op with `qa` off.
 */
export async function assertLotsInspected(db: OrrnDb, companyId: string, lots: readonly { id: string; number: string; lotDate: string }[]): Promise<void> {
  if (lots.length === 0) return;
  const plant = await readQaPlant(db, companyId);
  if (!plant.on || !plant.settings.requireLotInspection) return;
  const latest = await latestResults(db, companyId, "incoming", "purchase_lot", lots.map((l) => l.id));
  for (const lot of lots) {
    const code = lotChargeRefusal({ required: true, since: plant.settings.lotInspectionSince, receivedDay: lot.lotDate, latest: latest.get(lot.id)?.result ?? null });
    if (code) throw qaRefusal(code, { lot: lot.number });
  }
}

/** A UNIQUE failure on one of the quality tables (`table` = `qa_hold`, `qa_temper` ...), however deep the cause chain. */
export function isQaUnique(e: unknown, table: string): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    const m = cur instanceof Error ? cur.message : String(cur);
    if (m.includes("UNIQUE constraint failed") && m.includes(`${table}.`)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Row 22, write time (review N4): every gated lot's newest incoming check is still a pass when the melt
 * write runs. A fail recorded between the read and the write fails the batch whole (`isQaAbort`); the
 * caller reads again (`assertLotsInspected`) and refuses by name. Empty when the gate is off.
 */
export async function lotsInspectedGuardStatements(db: OrrnDb, companyId: string, lots: readonly { id: string; lotDate: string }[]): Promise<SqliteBatchItem[]> {
  if (lots.length === 0) return [];
  const plant = await readQaPlant(db, companyId);
  if (!plant.on || !plant.settings.requireLotInspection) return [];
  const since = plant.settings.lotInspectionSince;
  const gated = [...new Set(lots.filter((l) => !since || l.lotDate >= since).map((l) => l.id))];
  return chunk(gated, 30).map((ids) =>
    qaAbortUnless(
      db,
      sql.join(
        ids.map(
          (lotId) =>
            sql`coalesce((select c.result from qa_check c where c.company_id = ${companyId} and c.kind = 'incoming' and c.subject_type = 'purchase_lot' and c.subject_id = ${lotId} order by c.checked_at desc, c.id desc limit 1), '') = 'pass'`,
        ),
        sql` and `,
      ),
    ),
  );
}
