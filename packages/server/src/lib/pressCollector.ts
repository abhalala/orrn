/**
 * Press collector ingest (FP-PR-21) and threshold alerts (FP-PR-22). Contract: orrn-spool
 * `docs/press-collector.md`. Route: `POST /collector/press/frames` (apps/server collector-routes).
 *
 * Rules (never bent):
 * - Read-only towards the press: the collector never writes the PLC, and this file never writes a
 *   press run's figures. It stores frames, keeps one annotation row per run (`press_run_collector`)
 *   and opens / extends / ends alerts.
 * - Run binding is a rule, not a stored fact: a frame belongs to the run that was on its line when
 *   it was sampled (started_at ≤ sampled_at ≤ stopped_at; a running run is open-ended; where two
 *   windows overlap the later-started run wins). The rule is applied when a run is evaluated
 *   (`refreshRunCollector`: on ingest, by the sweep of changed runs, and on every `runSummary`
 *   read), so a run entered late, re-timed or voided after its frames arrived is still right.
 *   `press_collector_frame.press_run_id` is only a cache of that rule, re-stamped on evaluation.
 * - Retention (m-6): simulated frames are kept 24 h and real frames 90 days
 *   ({@link COLLECTOR_FRAME_RETENTION}), purged by the daily cron (`purgeCollectorFrames`). A run's
 *   annotation outlives its frames.
 * - Idempotent on (node, seq): a replayed frame is a duplicate and changes nothing.
 * - Q-09: collector-derived billet kg within 2 % of the run's typed input kg is accepted; beyond
 *   2 % the annotation says `collector_variance`. The run itself is untouched.
 * - Every row carries `simulated` as the node said it; nothing upgrades a simulator to a device.
 */
import { and, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, not, or, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";

import type { OrrnDb } from "@orrn/db";
import { chunk, IN_LIST_CHUNK, mapInChunks } from "@orrn/db/chunk";
import {
  pressAlert,
  pressAlertThreshold,
  pressCollectorFrame,
  pressCollectorStates,
  pressRunCollector,
  type PressAlertMetric,
  type PressAlertRow,
} from "@orrn/db/schema/collector";
import { pressBilletUse, pressLine, pressRun } from "@orrn/db/schema/press";

import { atomicBatch, pushChunkedInserts } from "./atomic";
import type { CollectorNode } from "./collectorNode";
import { createId } from "./id";

export const PRESS_FRAMES_PATH = "/collector/press/frames";
/** Frames per POST (the node batches its backlog in pages of this size). */
export const PRESS_FRAMES_MAX = 100;
/** A frame sampled further ahead of ORRN's clock than this is refused (node clock wrong). */
export const FRAME_CLOCK_AHEAD_MS = 5 * 60_000;
/** Q-09: accept within 2 %. */
export const COLLECTOR_VARIANCE_ACCEPT_BP = 200;
/** An open alert with no out-of-band frame for this long is ended at its last frame. */
export const ALERT_GAP_MS = 5 * 60_000;
/** Run states a frame may bind to (a queued or die-issued run has not started; a voided one never ran). */
const BINDABLE_RUN_STATUSES = ["running", "stopped", "counting", "logged"] as const;
/** The sweep on ingest re-evaluates runs changed within this long (older ones are evaluated on read). */
const SWEEP_CHANGED_WITHIN_MS = 7 * 86_400_000;
/**
 * Frame retention (m-6; the real period is owner-only, this is the documented default). Simulated
 * frames are demo data and go after a day; real frames after 90 days. Run annotations stay.
 */
export const COLLECTOR_FRAME_RETENTION = { simulatedMs: 86_400_000, realMs: 90 * 86_400_000 } as const;

const num = (min: number, max: number) => z.number().finite().min(min).max(max).nullable().optional();

export const pressFrameSchema = z.object({
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  line: z.string().trim().min(1).max(32),
  at: z.string().datetime({ offset: true }),
  simulated: z.boolean().optional(),
  state: z.enum(pressCollectorStates).optional(),
  ramSpeedMmS: num(0, 1000),
  billetTempC: num(-50, 1000),
  exitTempC: num(-50, 1000),
  containerTempC: num(-50, 1000),
  pressureBar: num(0, 5000),
  outletPressureBar: num(0, 5000),
  extrusionMs: z.number().int().min(0).max(24 * 3_600_000).nullable().optional(),
  billetsTotal: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  billetGTotal: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  fault: z.string().trim().max(64).nullable().optional(),
});
export type PressFrameInput = z.infer<typeof pressFrameSchema>;

/** The page is checked as a whole only for its shape; each frame is checked on its own (m-2). */
export const pressFramesBodySchema = z.object({
  instance_id: z.string().min(1).max(128),
  frames: z.array(z.unknown()).min(1).max(PRESS_FRAMES_MAX),
});

/**
 * Check each frame on its own: one out-of-range reading (an unscaled register, say) refuses that
 * frame as `invalid`, not the page, so the node's other 99 frames are kept.
 */
export function parseFrames(raw: readonly unknown[]): { frames: PressFrameInput[]; rejected: FrameRejection[] } {
  const frames: PressFrameInput[] = [];
  const rejected: FrameRejection[] = [];
  for (const r of raw) {
    const p = pressFrameSchema.safeParse(r);
    if (p.success) {
      frames.push(p.data);
      continue;
    }
    const seq = (r as { seq?: unknown } | null)?.seq;
    rejected.push({ seq: typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 0 ? seq : -1, reason: "invalid" });
  }
  return { frames, rejected };
}

const x10 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10));

export type FrameRejection = { seq: number; reason: "invalid" | "unknown_line" | "clock_ahead" | "duplicate_in_batch" };

export type IngestResult = {
  accepted: number;
  duplicates: number;
  rejected: FrameRejection[];
  bound: number;
  unbound: number;
  alertsOpened: number;
  alertsEnded: number;
  runsEvaluated: string[];
};

type FrameRow = typeof pressCollectorFrame.$inferInsert & {
  id: string;
  companyId: string;
  nodeId: string;
  seq: number;
  pressLineId: string;
  sampledAt: Date;
};

type CandidateRun = { id: string; pressLineId: string; startedAt: Date; stoppedAt: Date | null; status: string };

/**
 * The run a frame sampled at `atMs` on a line belongs to: the latest-started run whose window covers
 * it (a start-time tie goes to the larger id, as in {@link frameInRunWindow}).
 */
export function bindRun(runs: readonly CandidateRun[], lineId: string, atMs: number): string | null {
  let best: CandidateRun | null = null;
  for (const r of runs) {
    if (r.pressLineId !== lineId) continue;
    const start = r.startedAt.getTime();
    if (start > atMs) continue;
    if (r.stoppedAt) {
      if (atMs > r.stoppedAt.getTime()) continue;
    } else if (r.status !== "running") {
      continue; // a stopped run with no stop time has no window
    }
    if (!best || start > best.startedAt.getTime() || (start === best.startedAt.getTime() && r.id > best.id)) best = r;
  }
  return best?.id ?? null;
}

/**
 * Q-09 variance between collector-derived kg and typed kg. Accepted at exactly 2 %; flagged above.
 * Returns null when either side is missing or the typed figure is not positive.
 */
export function collectorVariance(collectorG: number | null, typedG: number | null): { varianceBp: number; flagged: boolean } | null {
  if (collectorG == null || typedG == null || typedG <= 0) return null;
  const diff = Math.abs(collectorG - typedG);
  return { varianceBp: Math.round((diff * 10_000) / typedG), flagged: diff * 10_000 > COLLECTOR_VARIANCE_ACCEPT_BP * typedG };
}

const METRIC_FIELD: Record<PressAlertMetric, keyof Pick<FrameRow, "ramSpeedX10" | "billetTempX10" | "exitTempX10" | "containerTempX10" | "pressureX10">> = {
  ram_speed: "ramSpeedX10",
  billet_temp: "billetTempX10",
  exit_temp: "exitTempX10",
  container_temp: "containerTempX10",
  pressure: "pressureX10",
};

type Band = { minX10: number | null; maxX10: number | null };

/** Which side of the band a value is on (null = inside). Bounds are inclusive. */
export function outOfBand(value: number, band: Band): { direction: "low" | "high"; limitX10: number } | null {
  if (band.minX10 != null && value < band.minX10) return { direction: "low", limitX10: band.minX10 };
  if (band.maxX10 != null && value > band.maxX10) return { direction: "high", limitX10: band.maxX10 };
  return null;
}

/** Alerts only judge frames where the press is pushing (or the source cannot say). */
const judged = (state: string | null | undefined) => state === "extruding" || state === "unknown" || state == null;

export async function ingestPressFrames(
  db: OrrnDb,
  node: CollectorNode,
  frames: readonly PressFrameInput[],
  nowMs: number = Date.now(),
  invalid: readonly FrameRejection[] = [],
): Promise<IngestResult> {
  const companyId = node.companyId;
  const rejected: FrameRejection[] = [...invalid];

  // 1. Line codes -> ids (this company only). Every IN-list here is chunked (m-1: ≤ 100 params).
  const codes = [...new Set(frames.map((f) => f.line))];
  const lines = await mapInChunks(codes, (part) =>
    db
      .select({ id: pressLine.id, code: pressLine.code })
      .from(pressLine)
      .where(and(eq(pressLine.companyId, companyId), inArray(pressLine.code, part))),
  );
  const lineByCode = new Map(lines.map((l) => [l.code, l.id]));

  // 2. Shape rows; drop bad lines, clocks ahead, duplicate seqs inside the batch.
  const seen = new Set<number>();
  const candidates: FrameRow[] = [];
  for (const f of frames) {
    const lineId = lineByCode.get(f.line);
    const atMs = Date.parse(f.at);
    if (seen.has(f.seq)) {
      rejected.push({ seq: f.seq, reason: "duplicate_in_batch" });
      continue;
    }
    seen.add(f.seq);
    if (!lineId) {
      rejected.push({ seq: f.seq, reason: "unknown_line" });
      continue;
    }
    if (atMs > nowMs + FRAME_CLOCK_AHEAD_MS) {
      rejected.push({ seq: f.seq, reason: "clock_ahead" });
      continue;
    }
    candidates.push({
      id: createId(atMs),
      companyId,
      nodeId: node.id,
      seq: f.seq,
      pressLineId: lineId,
      pressRunId: null,
      sampledAt: new Date(atMs),
      simulated: f.simulated === true,
      state: f.state ?? "unknown",
      ramSpeedX10: x10(f.ramSpeedMmS),
      billetTempX10: x10(f.billetTempC),
      exitTempX10: x10(f.exitTempC),
      containerTempX10: x10(f.containerTempC),
      pressureX10: x10(f.pressureBar),
      outletPressureX10: x10(f.outletPressureBar),
      extrusionMs: f.extrusionMs ?? null,
      billetsTotal: f.billetsTotal ?? null,
      billetGTotal: f.billetGTotal ?? null,
      faultCode: f.fault ?? null,
    });
  }

  // 3. Idempotency: seqs this node already delivered.
  const existing = new Set<number>();
  for (const part of chunk(
    candidates.map((c) => c.seq),
    IN_LIST_CHUNK,
  )) {
    const rows = await db
      .select({ seq: pressCollectorFrame.seq })
      .from(pressCollectorFrame)
      .where(and(eq(pressCollectorFrame.nodeId, node.id), inArray(pressCollectorFrame.seq, part)));
    for (const r of rows) existing.add(r.seq);
  }
  const fresh = candidates.filter((c) => !existing.has(c.seq)).sort((a, b) => a.sampledAt.getTime() - b.sampledAt.getTime() || a.seq - b.seq);
  const duplicates = candidates.length - fresh.length;

  const result: IngestResult = {
    accepted: fresh.length,
    duplicates,
    rejected,
    bound: 0,
    unbound: 0,
    alertsOpened: 0,
    alertsEnded: 0,
    runsEvaluated: [],
  };
  const lineIds = [...new Set(candidates.map((c) => c.pressLineId))];
  if (fresh.length === 0) {
    result.runsEvaluated = await refreshStaleRuns(db, companyId, lineIds, []);
    return result;
  }

  // 4. Bind to runs by window.
  const minAt = fresh[0]!.sampledAt;
  const maxAt = fresh[fresh.length - 1]!.sampledAt;
  const runs = (await mapInChunks(lineIds, (part) =>
    db
      .select({
        id: pressRun.id,
        pressLineId: pressRun.pressLineId,
        startedAt: pressRun.startedAt,
        stoppedAt: pressRun.stoppedAt,
        status: pressRun.status,
      })
      .from(pressRun)
      .where(
        and(
          eq(pressRun.companyId, companyId),
          inArray(pressRun.pressLineId, part),
          inArray(pressRun.status, [...BINDABLE_RUN_STATUSES]),
          lte(pressRun.startedAt, maxAt),
          or(isNull(pressRun.stoppedAt), gte(pressRun.stoppedAt, minAt)),
        ),
      ),
  )) as CandidateRun[];
  for (const f of fresh) {
    f.pressRunId = bindRun(runs, f.pressLineId, f.sampledAt.getTime());
    if (f.pressRunId) result.bound += 1;
    else result.unbound += 1;
  }

  // 5. Alerts on the fresh frames (open / extend / end), then write frames + alerts together.
  const alertWrites = await evaluateAlerts(db, companyId, node.id, fresh);
  result.alertsOpened = alertWrites.opened;
  result.alertsEnded = alertWrites.ended;

  const stmts: BatchItem<"sqlite">[] = [];
  pushChunkedInserts(stmts, (rows) => db.insert(pressCollectorFrame).values(rows).onConflictDoNothing(), fresh);
  stmts.push(...alertWrites.statements);
  await atomicBatch(db, stmts);

  // 6. Annotations: every run these frames touched, plus logged runs on these lines whose
  // summary predates the log (the typed kg arrived after the last frame).
  const touched = [...new Set(fresh.map((f) => f.pressRunId).filter((x): x is string => !!x))];
  result.runsEvaluated = await refreshStaleRuns(db, companyId, lineIds, touched);
  return result;
}

/** At most this many changed runs are swept per post (the rest on the next post or on read). */
const SWEEP_LIMIT = 20;

/**
 * Recompute the touched runs, plus runs on `lineIds` changed since they were last evaluated (or
 * never evaluated): a run entered late, re-timed, logged or voided after its frames arrived (I-1).
 * Changed means `press_run.updated_at` (real clock) is newer than the annotation's `evaluated_at`.
 */
async function refreshStaleRuns(db: OrrnDb, companyId: string, lineIds: string[], touched: string[]): Promise<string[]> {
  const ids = new Set(touched);
  const changedSince = new Date(Date.now() - SWEEP_CHANGED_WITHIN_MS);
  for (const part of chunk(lineIds, IN_LIST_CHUNK)) {
    if (ids.size >= touched.length + SWEEP_LIMIT) break;
    const stale = await db
      .select({ id: pressRun.id })
      .from(pressRun)
      .leftJoin(pressRunCollector, eq(pressRunCollector.pressRunId, pressRun.id))
      .where(
        and(
          eq(pressRun.companyId, companyId),
          inArray(pressRun.pressLineId, part),
          gte(pressRun.updatedAt, changedSince),
          or(
            and(isNull(pressRunCollector.pressRunId), inArray(pressRun.status, [...BINDABLE_RUN_STATUSES])),
            and(isNotNull(pressRunCollector.pressRunId), sql`${pressRun.updatedAt} > ${pressRunCollector.evaluatedAt}`),
          ),
        ),
      )
      .orderBy(sql`${pressRun.updatedAt} desc`)
      .limit(SWEEP_LIMIT);
    for (const r of stale) ids.add(r.id);
  }
  for (const id of ids) await refreshRunCollector(db, companyId, id);
  return [...ids];
}

type WindowRun = { id: string; pressLineId: string; status: string; startedAt: Date | null; stoppedAt: Date | null };

/** The run's window, or null when no frame can belong to it (not started, voided, no stop time). */
function runWindow(run: WindowRun): { start: Date; stop: Date | null } | null {
  if (!run.startedAt || !(BINDABLE_RUN_STATUSES as readonly string[]).includes(run.status)) return null;
  if (!run.stoppedAt && run.status !== "running") return null;
  return { start: run.startedAt, stop: run.stoppedAt };
}

/**
 * The binding rule as SQL over `press_collector_frame` (I-1): on the run's line, inside its window,
 * and not inside the window of a later-started bindable run on the same line (a start-time tie goes
 * to the larger id, as in {@link bindRun}). ~10 bound parameters.
 */
function frameInRunWindow(companyId: string, run: WindowRun, w: { start: Date; stop: Date | null }): SQL {
  const f = pressCollectorFrame;
  const startMs = w.start.getTime();
  return and(
    eq(f.companyId, companyId),
    eq(f.pressLineId, run.pressLineId),
    gte(f.sampledAt, w.start),
    w.stop ? lte(f.sampledAt, w.stop) : undefined,
    sql`not exists (select 1 from press_run r2 where r2.company_id = ${companyId} and r2.press_line_id = ${run.pressLineId} and r2.id <> ${run.id}
      and r2.status in ('running', 'stopped', 'counting', 'logged')
      and (r2.started_at > ${startMs} or (r2.started_at = ${startMs} and r2.id > ${run.id}))
      and r2.started_at <= ${f.sampledAt}
      and ((r2.stopped_at is not null and r2.stopped_at >= ${f.sampledAt}) or (r2.stopped_at is null and r2.status = 'running')))`,
  )!;
}

/**
 * Recompute one run's annotation from the frames its window holds now (the binding rule, I-1), and
 * re-stamp the cached `press_run_id` of those frames (a frame-only write; the run is never written).
 * Billet counters are cumulative on the node: the run's count is the sum of positive steps from the
 * last frame before the run (baseline) through its last frame; a step down is a counter reset and
 * counts the new value. Q-09 is checked on weight and on count; either beyond 2 % flags (m-9).
 *
 * A run with no frames gets a `frames = 0` row (so the sweep does not pick it again); `runSummary`
 * shows null for it. Once the retention purge has removed a run's frames the stored annotation is
 * the record and is returned unchanged.
 */
export async function refreshRunCollector(db: OrrnDb, companyId: string, runId: string) {
  const run = await db
    .select({
      id: pressRun.id,
      pressLineId: pressRun.pressLineId,
      status: pressRun.status,
      inputG: pressRun.inputG,
      startedAt: pressRun.startedAt,
      stoppedAt: pressRun.stoppedAt,
    })
    .from(pressRun)
    .where(and(eq(pressRun.id, runId), eq(pressRun.companyId, companyId)))
    .get();
  if (!run || !run.pressLineId) return null;
  const lineId = run.pressLineId;
  const f = pressCollectorFrame;

  const existing = await db.select().from(pressRunCollector).where(eq(pressRunCollector.pressRunId, runId)).get();
  if (existing && existing.frames > 0 && existing.firstFrameAt) {
    // Purged: the oldest frame of its kind left on the line is newer than the run's first frame.
    const [o] = await db
      .select({ oldest: sql<number | null>`min(${f.sampledAt})` })
      .from(f)
      .where(and(eq(f.companyId, companyId), eq(f.pressLineId, lineId), eq(f.simulated, existing.simulated)));
    const oldest = o?.oldest == null ? null : Number(o.oldest);
    if (oldest == null || oldest > existing.firstFrameAt.getTime()) return existing;
  }

  const wr: WindowRun = { ...run, pressLineId: lineId };
  const w = runWindow(wr);
  const inWindow = w ? frameInRunWindow(companyId, wr, w) : null;
  const release = db
    .update(f)
    .set({ pressRunId: null })
    .where(and(eq(f.companyId, companyId), eq(f.pressRunId, runId), inWindow ? not(inWindow) : undefined));

  const [agg] = inWindow
    ? await db
        .select({
          frames: sql<number>`count(*)`,
          simulated: sql<number>`coalesce(max(${f.simulated}), 0)`,
          firstAt: sql<number | null>`min(${f.sampledAt})`,
          lastAt: sql<number | null>`max(${f.sampledAt})`,
          extruding: sql<number>`coalesce(sum(case when ${f.state} = 'extruding' then 1 else 0 end), 0)`,
          ramAvg: sql<number | null>`avg(case when ${f.state} = 'extruding' then ${f.ramSpeedX10} end)`,
          ramMax: sql<number | null>`max(case when ${f.state} = 'extruding' then ${f.ramSpeedX10} end)`,
          billetTempAvg: sql<number | null>`avg(case when ${f.state} = 'extruding' then ${f.billetTempX10} end)`,
          exitTempMax: sql<number | null>`max(${f.exitTempX10})`,
          pressureMax: sql<number | null>`max(${f.pressureX10})`,
        })
        .from(f)
        .where(inWindow)
    : [];
  const frames = Number(agg?.frames ?? 0);
  // Real clock: compared with press_run.updated_at, which drizzle stamps with the real clock.
  const evaluatedAt = new Date();
  if (!inWindow || frames === 0) {
    const empty = {
      pressRunId: runId,
      companyId,
      pressLineId: lineId,
      frames: 0,
      simulated: false,
      firstFrameAt: null,
      lastFrameAt: null,
      extrudingFrames: 0,
      ramSpeedAvgX10: null,
      ramSpeedMaxX10: null,
      billetTempAvgX10: null,
      exitTempMaxX10: null,
      pressureMaxX10: null,
      billetsCounted: null,
      collectorInputG: null,
      typedInputG: null,
      varianceBasis: null,
      varianceBp: null,
      collectorVariance: false,
      evaluatedAt,
    };
    const { pressRunId: _pk, ...set } = empty;
    await atomicBatch(db, [release, db.insert(pressRunCollector).values(empty).onConflictDoUpdate({ target: pressRunCollector.pressRunId, set })]);
    return null;
  }
  const firstAt = Number(agg!.firstAt);

  const counted = async (col: "billets_total" | "billet_g_total") => {
    const rows = await db.all<{ total: number | null; n: number }>(sql`
      with f as (
        select sampled_at, seq, ${sql.raw(col)} as v from press_collector_frame
        where ${inWindow} and ${sql.raw(col)} is not null
        union all
        select * from (
          select sampled_at, seq, ${sql.raw(col)} as v from press_collector_frame
          where company_id = ${companyId} and press_line_id = ${lineId} and sampled_at < ${firstAt}
            and ${sql.raw(col)} is not null
          order by sampled_at desc, seq desc limit 1
        )
      ), d as (
        select v, v - lag(v) over (order by sampled_at, seq) as dv from f
      )
      select sum(case when dv is null then 0 when dv >= 0 then dv else v end) as total, count(*) as n from d`);
    const r = rows[0];
    return r && Number(r.n) > 0 ? Number(r.total ?? 0) : null;
  };
  const billetsCounted = await counted("billets_total");
  const billetGrams = await counted("billet_g_total");

  // Typed side: only a logged run has an input kg. Q-09 on both bases (m-9).
  const typedInputG = run.status === "logged" && run.inputG != null ? run.inputG : null;
  const checks: { basis: "weight" | "count"; collectorG: number; v: ReturnType<typeof collectorVariance> }[] = [];
  if (billetGrams != null && billetGrams > 0) checks.push({ basis: "weight", collectorG: billetGrams, v: collectorVariance(billetGrams, typedInputG) });
  if (billetsCounted != null && billetsCounted > 0 && typedInputG != null) {
    const [typed] = await db
      .select({ n: sql<number>`coalesce(sum(${pressBilletUse.count}), 0)` })
      .from(pressBilletUse)
      .where(and(eq(pressBilletUse.companyId, companyId), eq(pressBilletUse.pressRunId, runId)));
    const typedCount = Number(typed?.n ?? 0);
    if (typedCount > 0) {
      const collectorG = Math.round((billetsCounted * typedInputG) / typedCount);
      checks.push({ basis: "count", collectorG, v: collectorVariance(collectorG, typedInputG) });
    }
  }
  // Report the worse basis (weight first on a tie); flag when either is beyond 2 %.
  const judgedChecks = checks.filter((c) => c.v);
  const worst = judgedChecks.reduce<(typeof checks)[number] | null>((a, c) => (!a || c.v!.varianceBp > a.v!.varianceBp ? c : a), null);
  const shown = worst ?? checks[0] ?? null;
  const round = (n: number | null | undefined) => (n == null ? null : Math.round(Number(n)));
  const values = {
    pressRunId: runId,
    companyId,
    pressLineId: lineId,
    frames,
    simulated: Number(agg!.simulated) > 0,
    firstFrameAt: new Date(firstAt),
    lastFrameAt: new Date(Number(agg!.lastAt)),
    extrudingFrames: Number(agg!.extruding),
    ramSpeedAvgX10: round(agg!.ramAvg),
    ramSpeedMaxX10: round(agg!.ramMax),
    billetTempAvgX10: round(agg!.billetTempAvg),
    exitTempMaxX10: round(agg!.exitTempMax),
    pressureMaxX10: round(agg!.pressureMax),
    billetsCounted,
    collectorInputG: shown?.collectorG ?? null,
    typedInputG,
    varianceBasis: worst ? worst.basis : null,
    varianceBp: worst?.v?.varianceBp ?? null,
    collectorVariance: judgedChecks.some((c) => c.v!.flagged),
    evaluatedAt,
  };
  const { pressRunId: _pk, ...update } = values;
  await atomicBatch(db, [
    release,
    db
      .update(f)
      .set({ pressRunId: runId })
      .where(and(inWindow, or(isNull(f.pressRunId), ne(f.pressRunId, runId)))),
    db.insert(pressRunCollector).values(values).onConflictDoUpdate({ target: pressRunCollector.pressRunId, set: update }),
  ]);
  return values;
}

/**
 * Threshold evaluation for fresh frames (in time order). Per (line, metric): an out-of-band frame
 * opens an alert or extends the open one; an in-band frame ends it; any frame on the line (idle
 * ones included, I-3) more than ALERT_GAP_MS after an open alert's last out-of-band frame ends it
 * at that frame. Returns the statements to run in the same batch as the frame insert.
 */
async function evaluateAlerts(db: OrrnDb, companyId: string, nodeId: string, fresh: readonly FrameRow[]) {
  const statements: BatchItem<"sqlite">[] = [];
  const out = { statements, opened: 0, ended: 0 };
  const thresholds = await db
    .select()
    .from(pressAlertThreshold)
    .where(and(eq(pressAlertThreshold.companyId, companyId), eq(pressAlertThreshold.active, true)));
  const band = (lineId: string, metric: PressAlertMetric): Band | null => {
    const own = thresholds.find((t) => t.pressLineId === lineId && t.metric === metric);
    const all = thresholds.find((t) => t.pressLineId == null && t.metric === metric);
    const t = own ?? all;
    return t && (t.minX10 != null || t.maxX10 != null) ? { minX10: t.minX10, maxX10: t.maxX10 } : null;
  };
  const lineIds = [...new Set(fresh.map((f) => f.pressLineId))];
  const openRows = await mapInChunks(lineIds, (part) =>
    db
      .select()
      .from(pressAlert)
      .where(and(eq(pressAlert.companyId, companyId), inArray(pressAlert.pressLineId, part), isNull(pressAlert.endedAt))),
  );
  if (thresholds.length === 0 && openRows.length === 0) return out;
  const metrics = Object.keys(METRIC_FIELD) as PressAlertMetric[];

  type Open = PressAlertRow & { isNew: boolean; dirty: boolean };
  const open = new Map<string, Open>();
  for (const r of openRows) open.set(`${r.pressLineId}|${r.metric}`, { ...r, isNew: false, dirty: false });
  const ended: Open[] = [];

  const end = (key: string, a: Open, at: Date) => {
    a.endedAt = at;
    a.dirty = true;
    ended.push(a);
    open.delete(key);
  };

  for (const f of fresh) {
    // The gap rule first, on every frame of the line whatever the press is doing.
    for (const metric of metrics) {
      const key = `${f.pressLineId}|${metric}`;
      const current = open.get(key);
      if (current && f.sampledAt.getTime() - current.lastAt.getTime() > ALERT_GAP_MS) end(key, current, current.lastAt);
    }
    if (!judged(f.state)) continue;
    for (const metric of metrics) {
      const value = f[METRIC_FIELD[metric]] as number | null | undefined;
      if (value == null) continue;
      const b = band(f.pressLineId, metric);
      const key = `${f.pressLineId}|${metric}`;
      const current = open.get(key);
      if (current && f.sampledAt.getTime() < current.lastAt.getTime()) continue; // older than what we know
      const o = b ? outOfBand(value, b) : null;
      if (o) {
        if (current && current.direction === o.direction) {
          current.lastAt = f.sampledAt;
          current.frames += 1;
          current.peakX10 = o.direction === "high" ? Math.max(current.peakX10, value) : Math.min(current.peakX10, value);
          current.dirty = true;
        } else {
          if (current) end(key, current, f.sampledAt);
          open.set(key, {
            id: createId(f.sampledAt.getTime()),
            companyId,
            pressLineId: f.pressLineId,
            pressRunId: f.pressRunId ?? null,
            nodeId,
            metric,
            direction: o.direction,
            limitX10: o.limitX10,
            peakX10: value,
            frames: 1,
            simulated: f.simulated === true,
            startedAt: f.sampledAt,
            lastAt: f.sampledAt,
            endedAt: null,
            acknowledgedAt: null,
            acknowledgedBy: null,
            createdAt: new Date(),
            isNew: true,
            dirty: true,
          });
          out.opened += 1;
        }
      } else if (current) {
        end(key, current, f.sampledAt);
      }
    }
  }

  // Ends first (frees the one-open-per-(line, metric) slot), then inserts, then extensions.
  const toRow = ({ isNew: _n, dirty: _d, createdAt: _c, ...row }: Open) => row;
  for (const a of ended) {
    if (a.isNew) {
      statements.push(db.insert(pressAlert).values(toRow(a)));
    } else {
      statements.push(
        db.update(pressAlert).set({ endedAt: a.endedAt, lastAt: a.lastAt, frames: a.frames, peakX10: a.peakX10 }).where(eq(pressAlert.id, a.id)),
      );
    }
    out.ended += 1;
  }
  for (const a of open.values()) {
    if (!a.dirty) continue;
    if (a.isNew) statements.push(db.insert(pressAlert).values(toRow(a)));
    else statements.push(db.update(pressAlert).set({ lastAt: a.lastAt, frames: a.frames, peakX10: a.peakX10 }).where(eq(pressAlert.id, a.id)));
  }
  return out;
}

/**
 * Whether an alert is open as of `nowMs` (I-3): not ended, and its last out-of-band frame is within
 * ALERT_GAP_MS. An alert whose collector went quiet reads as ended at its last frame, even before a
 * later frame (or nothing at all) closes it in the table.
 */
export function alertOpenSql(nowMs: number): SQL {
  return and(isNull(pressAlert.endedAt), gte(pressAlert.lastAt, new Date(nowMs - ALERT_GAP_MS)))!;
}

/** The end shown for an alert as of `nowMs`: the stored end, or its last frame once the gap passed. */
export function alertEndedAt(row: { endedAt: Date | null; lastAt: Date }, nowMs: number): Date | null {
  if (row.endedAt) return row.endedAt;
  return row.lastAt.getTime() < nowMs - ALERT_GAP_MS ? row.lastAt : null;
}

/**
 * Today's chip (`dashboard.today.pressAlerts`): alerts open now (see {@link alertOpenSql}), alerts
 * that started since the production day began, and whether any of them came from a simulator. Null
 * when there are none, so a plant without a collector sees nothing.
 */
export async function pressAlertsToday(db: OrrnDb, companyId: string, sinceMs: number, nowMs: number = Date.now()) {
  const [r] = await db
    .select({
      open: sql<number>`coalesce(sum(case when ${alertOpenSql(nowMs)} then 1 else 0 end), 0)`,
      today: sql<number>`coalesce(sum(case when ${pressAlert.startedAt} >= ${sinceMs} then 1 else 0 end), 0)`,
      simulated: sql<number>`coalesce(max(${pressAlert.simulated}), 0)`,
    })
    .from(pressAlert)
    .where(and(eq(pressAlert.companyId, companyId), or(alertOpenSql(nowMs), gte(pressAlert.startedAt, new Date(sinceMs)))));
  const open = Number(r?.open ?? 0);
  const today = Number(r?.today ?? 0);
  if (open === 0 && today === 0) return null;
  return { open, today, simulated: Number(r?.simulated ?? 0) > 0 };
}

/** Rows deleted per statement by the purge (keeps each D1 statement short). */
const PURGE_BATCH = 2_000;

/**
 * Daily retention purge (m-6), run from the backup cron: simulated frames older than 24 h and real
 * frames older than 90 days ({@link COLLECTOR_FRAME_RETENTION}), every company. Run annotations and
 * alerts stay. Returns how many frames of each kind were deleted.
 */
export async function purgeCollectorFrames(db: OrrnDb, nowMs: number = Date.now()) {
  const out = { simulated: 0, real: 0 };
  const passes = [
    { key: "simulated" as const, simulated: true, before: new Date(nowMs - COLLECTOR_FRAME_RETENTION.simulatedMs) },
    { key: "real" as const, simulated: false, before: new Date(nowMs - COLLECTOR_FRAME_RETENTION.realMs) },
  ];
  for (const p of passes) {
    for (;;) {
      const victims = db
        .select({ id: pressCollectorFrame.id })
        .from(pressCollectorFrame)
        .where(and(eq(pressCollectorFrame.simulated, p.simulated), lt(pressCollectorFrame.sampledAt, p.before)))
        .limit(PURGE_BATCH);
      const gone = await db.delete(pressCollectorFrame).where(inArray(pressCollectorFrame.id, victims)).returning({ id: pressCollectorFrame.id });
      out[p.key] += gone.length;
      if (gone.length < PURGE_BATCH) break;
    }
  }
  return out;
}
