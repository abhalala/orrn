/**
 * Press collector ingest (FP-PR-21) and threshold alerts (FP-PR-22). Contract: orrn-spool
 * `docs/press-collector.md`. Route: `POST /collector/press/frames` (apps/server collector-routes).
 *
 * Rules (never bent):
 * - Read-only towards the press: the collector never writes the PLC, and this file never writes a
 *   press run's figures. It stores frames, binds each to the run that was on the line when it was
 *   sampled (started_at ≤ sampled_at ≤ stopped_at; a running run is open-ended), keeps one
 *   annotation row per run (`press_run_collector`) and opens / extends / ends alerts.
 * - Idempotent on (node, seq): a replayed frame is a duplicate and changes nothing.
 * - Q-09: collector-derived billet kg within 2 % of the run's typed input kg is accepted; beyond
 *   2 % the annotation says `collector_variance`. The run itself is untouched.
 * - Every row carries `simulated` as the node said it; nothing upgrades a simulator to a device.
 */
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { z } from "zod";

import type { OrrnDb } from "@orrn/db";
import { chunk, IN_LIST_CHUNK } from "@orrn/db/chunk";
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
/** Run states a frame may bind to (a queued or die-issued run has not started). */
const BINDABLE_RUN_STATUSES = ["running", "stopped", "counting", "logged"] as const;

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

export const pressFramesBodySchema = z.object({
  instance_id: z.string().min(1).max(128),
  frames: z.array(pressFrameSchema).min(1).max(PRESS_FRAMES_MAX),
});

const x10 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10));

export type FrameRejection = { seq: number; reason: "unknown_line" | "clock_ahead" | "duplicate_in_batch" };

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

/** The run a frame sampled at `atMs` on a line belongs to: the latest-started run whose window covers it. */
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
    if (!best || start > best.startedAt.getTime()) best = r;
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
): Promise<IngestResult> {
  const companyId = node.companyId;
  const rejected: FrameRejection[] = [];

  // 1. Line codes -> ids (this company only).
  const codes = [...new Set(frames.map((f) => f.line))];
  const lines = await db
    .select({ id: pressLine.id, code: pressLine.code })
    .from(pressLine)
    .where(and(eq(pressLine.companyId, companyId), inArray(pressLine.code, codes)));
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
  const runs = (await db
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
        inArray(pressRun.pressLineId, lineIds),
        inArray(pressRun.status, [...BINDABLE_RUN_STATUSES]),
        lte(pressRun.startedAt, maxAt),
        or(isNull(pressRun.stoppedAt), gte(pressRun.stoppedAt, minAt)),
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

/** Recompute the touched runs and any logged run on `lineIds` whose annotation is older than the run. */
async function refreshStaleRuns(db: OrrnDb, companyId: string, lineIds: string[], touched: string[]): Promise<string[]> {
  const ids = new Set(touched);
  if (lineIds.length > 0) {
    const stale = await db
      .select({ id: pressRun.id })
      .from(pressRun)
      .innerJoin(pressRunCollector, eq(pressRunCollector.pressRunId, pressRun.id))
      .where(
        and(
          eq(pressRun.companyId, companyId),
          inArray(pressRun.pressLineId, lineIds),
          eq(pressRun.status, "logged"),
          sql`${pressRun.updatedAt} > ${pressRunCollector.evaluatedAt}`,
        ),
      )
      .limit(20);
    for (const r of stale) ids.add(r.id);
  }
  for (const id of ids) await refreshRunCollector(db, companyId, id);
  return [...ids];
}

/**
 * Recompute one run's annotation from its frames. Billet counters are cumulative on the node: the
 * run's count is the sum of positive steps from the last frame before the run (baseline) through its
 * last frame; a step down is a counter reset and counts the new value.
 */
export async function refreshRunCollector(db: OrrnDb, companyId: string, runId: string) {
  const run = await db
    .select({ id: pressRun.id, pressLineId: pressRun.pressLineId, status: pressRun.status, inputG: pressRun.inputG, startedAt: pressRun.startedAt })
    .from(pressRun)
    .where(and(eq(pressRun.id, runId), eq(pressRun.companyId, companyId)))
    .get();
  if (!run || !run.pressLineId) return null;

  const [agg] = await db
    .select({
      frames: sql<number>`count(*)`,
      simulated: sql<number>`coalesce(max(${pressCollectorFrame.simulated}), 0)`,
      firstAt: sql<number | null>`min(${pressCollectorFrame.sampledAt})`,
      lastAt: sql<number | null>`max(${pressCollectorFrame.sampledAt})`,
      extruding: sql<number>`coalesce(sum(case when ${pressCollectorFrame.state} = 'extruding' then 1 else 0 end), 0)`,
      ramAvg: sql<number | null>`avg(case when ${pressCollectorFrame.state} = 'extruding' then ${pressCollectorFrame.ramSpeedX10} end)`,
      ramMax: sql<number | null>`max(case when ${pressCollectorFrame.state} = 'extruding' then ${pressCollectorFrame.ramSpeedX10} end)`,
      billetTempAvg: sql<number | null>`avg(case when ${pressCollectorFrame.state} = 'extruding' then ${pressCollectorFrame.billetTempX10} end)`,
      exitTempMax: sql<number | null>`max(${pressCollectorFrame.exitTempX10})`,
      pressureMax: sql<number | null>`max(${pressCollectorFrame.pressureX10})`,
    })
    .from(pressCollectorFrame)
    .where(and(eq(pressCollectorFrame.companyId, companyId), eq(pressCollectorFrame.pressRunId, runId)));
  const frames = Number(agg?.frames ?? 0);
  if (frames === 0) return null;
  const firstAt = Number(agg!.firstAt);

  const counted = async (col: "billets_total" | "billet_g_total") => {
    const rows = await db.all<{ total: number | null; n: number }>(sql`
      with f as (
        select sampled_at, seq, ${sql.raw(col)} as v from press_collector_frame
        where company_id = ${companyId} and press_run_id = ${runId} and ${sql.raw(col)} is not null
        union all
        select * from (
          select sampled_at, seq, ${sql.raw(col)} as v from press_collector_frame
          where company_id = ${companyId} and press_line_id = ${run.pressLineId} and sampled_at < ${firstAt}
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

  // Typed side: only a logged run has an input kg.
  const typedInputG = run.status === "logged" && run.inputG != null ? run.inputG : null;
  let basis: "weight" | "count" | null = null;
  let collectorInputG: number | null = null;
  if (billetGrams != null && billetGrams > 0) {
    basis = "weight";
    collectorInputG = billetGrams;
  } else if (billetsCounted != null && billetsCounted > 0 && typedInputG != null) {
    const [typed] = await db
      .select({ n: sql<number>`coalesce(sum(${pressBilletUse.count}), 0)` })
      .from(pressBilletUse)
      .where(and(eq(pressBilletUse.companyId, companyId), eq(pressBilletUse.pressRunId, runId)));
    const typedCount = Number(typed?.n ?? 0);
    if (typedCount > 0) {
      basis = "count";
      collectorInputG = Math.round((billetsCounted * typedInputG) / typedCount);
    }
  }
  const v = collectorVariance(collectorInputG, typedInputG);
  const round = (n: number | null | undefined) => (n == null ? null : Math.round(Number(n)));
  const values = {
    pressRunId: runId,
    companyId,
    pressLineId: run.pressLineId,
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
    collectorInputG: basis ? collectorInputG : null,
    typedInputG,
    varianceBasis: v ? basis : null,
    varianceBp: v?.varianceBp ?? null,
    collectorVariance: v?.flagged ?? false,
    // Real clock: compared with press_run.updated_at, which drizzle stamps with the real clock.
    evaluatedAt: new Date(),
  };
  const { pressRunId: _pk, ...update } = values;
  await db.insert(pressRunCollector).values(values).onConflictDoUpdate({ target: pressRunCollector.pressRunId, set: update });
  return values;
}

/**
 * Threshold evaluation for fresh frames (in time order). Per (line, metric): an out-of-band frame
 * opens an alert or extends the open one; an in-band frame ends it; a gap over ALERT_GAP_MS ends
 * the old one at its last frame before a new one opens. Returns the statements to run in the same
 * batch as the frame insert.
 */
async function evaluateAlerts(db: OrrnDb, companyId: string, nodeId: string, fresh: readonly FrameRow[]) {
  const statements: BatchItem<"sqlite">[] = [];
  const out = { statements, opened: 0, ended: 0 };
  const thresholds = await db
    .select()
    .from(pressAlertThreshold)
    .where(and(eq(pressAlertThreshold.companyId, companyId), eq(pressAlertThreshold.active, true)));
  if (thresholds.length === 0) return out;
  const band = (lineId: string, metric: PressAlertMetric): Band | null => {
    const own = thresholds.find((t) => t.pressLineId === lineId && t.metric === metric);
    const all = thresholds.find((t) => t.pressLineId == null && t.metric === metric);
    const t = own ?? all;
    return t && (t.minX10 != null || t.maxX10 != null) ? { minX10: t.minX10, maxX10: t.maxX10 } : null;
  };
  const lineIds = [...new Set(fresh.map((f) => f.pressLineId))];
  const openRows = await db
    .select()
    .from(pressAlert)
    .where(and(eq(pressAlert.companyId, companyId), inArray(pressAlert.pressLineId, lineIds), isNull(pressAlert.endedAt)))
    .orderBy(asc(pressAlert.startedAt));

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
    if (!judged(f.state)) continue;
    for (const metric of Object.keys(METRIC_FIELD) as PressAlertMetric[]) {
      const value = f[METRIC_FIELD[metric]] as number | null | undefined;
      if (value == null) continue;
      const b = band(f.pressLineId, metric);
      const key = `${f.pressLineId}|${metric}`;
      let current = open.get(key);
      if (current && f.sampledAt.getTime() < current.lastAt.getTime()) continue; // older than what we know
      if (current && f.sampledAt.getTime() - current.lastAt.getTime() > ALERT_GAP_MS) {
        end(key, current, current.lastAt);
        current = undefined;
      }
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
 * Today's chip (`dashboard.today.pressAlerts`): alerts still open, alerts that started since the
 * production day began, and whether any of them came from a simulator. Null when there are none,
 * so a plant without a collector sees nothing.
 */
export async function pressAlertsToday(db: OrrnDb, companyId: string, sinceMs: number) {
  const [r] = await db
    .select({
      open: sql<number>`coalesce(sum(case when ${pressAlert.endedAt} is null then 1 else 0 end), 0)`,
      today: sql<number>`coalesce(sum(case when ${pressAlert.startedAt} >= ${sinceMs} then 1 else 0 end), 0)`,
      simulated: sql<number>`coalesce(max(${pressAlert.simulated}), 0)`,
    })
    .from(pressAlert)
    .where(and(eq(pressAlert.companyId, companyId), or(isNull(pressAlert.endedAt), gte(pressAlert.startedAt, new Date(sinceMs)))));
  const open = Number(r?.open ?? 0);
  const today = Number(r?.today ?? 0);
  if (open === 0 && today === 0) return null;
  return { open, today, simulated: Number(r?.simulated ?? 0) > 0 };
}
