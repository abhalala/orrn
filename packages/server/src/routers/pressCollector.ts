/**
 * `press.collector.*` (FP-PR-21 / FP-PR-22): what people do with collector data. Frames themselves
 * arrive only through the node-signed `POST /collector/press/frames` (lib/pressCollector.ts); no
 * procedure here takes frames, so no member role can post them.
 *
 * - thresholds / setThreshold (masters.publish): the band per metric, per line or for every line.
 * - alerts (any member) / acknowledgeAlert (press.close): alert rows; no notification beyond the
 *   Today chip (`dashboard.today.pressAlerts`).
 * - runSummary (any member): the run's annotation (frames, ram speed, temperatures, billets
 *   counted, Q-09 variance). Ram speed stays off the press report until a real collector exists.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import {
  pressAlert,
  pressAlertMetrics,
  pressAlertThreshold,
  pressRunCollector,
} from "@orrn/db/schema/collector";
import { pressLine, pressRun } from "@orrn/db/schema/press";

import { actionProcedure, companyProcedure, router } from "../index";
import { auditInsert } from "../lib/audit";
import { atomicBatch } from "../lib/atomic";
import { createId } from "../lib/id";
import { refreshRunCollector } from "../lib/pressCollector";

const id = z.string().min(1).max(64);
const bound = z.number().finite().min(-50).max(5000).nullable();
const x10 = (v: number | null) => (v == null ? null : Math.round(v * 10));
const un10 = (v: number | null) => (v == null ? null : v / 10);

export const pressCollectorRouter = router({
  thresholds: companyProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: pressAlertThreshold.id,
        pressLineId: pressAlertThreshold.pressLineId,
        lineCode: pressLine.code,
        metric: pressAlertThreshold.metric,
        minX10: pressAlertThreshold.minX10,
        maxX10: pressAlertThreshold.maxX10,
        active: pressAlertThreshold.active,
        updatedAt: pressAlertThreshold.updatedAt,
      })
      .from(pressAlertThreshold)
      .leftJoin(pressLine, eq(pressLine.id, pressAlertThreshold.pressLineId))
      .where(eq(pressAlertThreshold.companyId, ctx.companyId));
    return rows.map(({ minX10, maxX10, ...r }) => ({ ...r, min: un10(minX10), max: un10(maxX10) }));
  }),

  /** Set (insert or replace) one metric's band. Units: mm/s, °C, bar. Either side may be open. */
  setThreshold: actionProcedure("masters.publish")
    .input(
      z.object({
        pressLineId: id.nullable(),
        metric: z.enum(pressAlertMetrics),
        min: bound,
        max: bound,
        active: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.min == null && input.max == null) throw new TRPCError({ code: "BAD_REQUEST", message: "Give a lower or an upper limit" });
      if (input.min != null && input.max != null && input.min > input.max) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The lower limit is above the upper limit" });
      }
      if (input.pressLineId) {
        const line = await ctx.db
          .select({ id: pressLine.id })
          .from(pressLine)
          .where(and(eq(pressLine.id, input.pressLineId), eq(pressLine.companyId, ctx.companyId)))
          .get();
        if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "Press line not found" });
      }
      const existing = await ctx.db
        .select({ id: pressAlertThreshold.id })
        .from(pressAlertThreshold)
        .where(
          and(
            eq(pressAlertThreshold.companyId, ctx.companyId),
            eq(pressAlertThreshold.metric, input.metric),
            input.pressLineId ? eq(pressAlertThreshold.pressLineId, input.pressLineId) : isNull(pressAlertThreshold.pressLineId),
          ),
        )
        .get();
      const values = { minX10: x10(input.min), maxX10: x10(input.max), active: input.active, updatedBy: ctx.session.user.id };
      const rowId = existing?.id ?? createId();
      await atomicBatch(ctx.db, [
        existing
          ? ctx.db.update(pressAlertThreshold).set(values).where(eq(pressAlertThreshold.id, rowId))
          : ctx.db.insert(pressAlertThreshold).values({ id: rowId, companyId: ctx.companyId, pressLineId: input.pressLineId, metric: input.metric, ...values }),
        auditInsert(ctx, {
          action: "press.alert.threshold",
          subjectType: "press_alert_threshold",
          subjectId: rowId,
          meta: { pressLineId: input.pressLineId, metric: input.metric, min: input.min, max: input.max, active: input.active },
        }),
      ]);
      return { id: rowId };
    }),

  alerts: companyProcedure
    .input(z.object({ openOnly: z.boolean().default(false), limit: z.number().int().min(1).max(200).default(50) }).default({ openOnly: false, limit: 50 }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: pressAlert.id,
          pressLineId: pressAlert.pressLineId,
          lineCode: pressLine.code,
          pressRunId: pressAlert.pressRunId,
          runNumber: pressRun.number,
          metric: pressAlert.metric,
          direction: pressAlert.direction,
          limitX10: pressAlert.limitX10,
          peakX10: pressAlert.peakX10,
          frames: pressAlert.frames,
          simulated: pressAlert.simulated,
          startedAt: pressAlert.startedAt,
          lastAt: pressAlert.lastAt,
          endedAt: pressAlert.endedAt,
          acknowledgedAt: pressAlert.acknowledgedAt,
        })
        .from(pressAlert)
        .innerJoin(pressLine, eq(pressLine.id, pressAlert.pressLineId))
        .leftJoin(pressRun, eq(pressRun.id, pressAlert.pressRunId))
        .where(and(eq(pressAlert.companyId, ctx.companyId), input.openOnly ? isNull(pressAlert.endedAt) : undefined))
        .orderBy(desc(pressAlert.startedAt))
        .limit(input.limit);
      return rows.map(({ limitX10, peakX10, ...r }) => ({ ...r, limit: limitX10 / 10, peak: peakX10 / 10 }));
    }),

  acknowledgeAlert: actionProcedure("press.close")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select({ id: pressAlert.id, acknowledgedAt: pressAlert.acknowledgedAt })
        .from(pressAlert)
        .where(and(eq(pressAlert.id, input.id), eq(pressAlert.companyId, ctx.companyId)))
        .get();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Alert not found" });
      if (row.acknowledgedAt) return { id: row.id, already: true };
      await atomicBatch(ctx.db, [
        ctx.db
          .update(pressAlert)
          .set({ acknowledgedAt: new Date(), acknowledgedBy: ctx.session.user.id })
          .where(and(eq(pressAlert.id, row.id), isNull(pressAlert.acknowledgedAt))),
        auditInsert(ctx, { action: "press.alert.ack", subjectType: "press_alert", subjectId: row.id }),
      ]);
      return { id: row.id, already: false };
    }),

  /**
   * The collector's annotation of one run (null when no frame was bound to it). A run logged after
   * its last frame is re-evaluated here so the Q-09 variance appears even when the line went quiet.
   */
  runSummary: companyProcedure.input(z.object({ runId: id })).query(async ({ ctx, input }) => {
    const run = await ctx.db
      .select({ id: pressRun.id, status: pressRun.status, updatedAt: pressRun.updatedAt })
      .from(pressRun)
      .where(and(eq(pressRun.id, input.runId), eq(pressRun.companyId, ctx.companyId)))
      .get();
    if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
    let row = await ctx.db
      .select()
      .from(pressRunCollector)
      .where(and(eq(pressRunCollector.pressRunId, run.id), eq(pressRunCollector.companyId, ctx.companyId)))
      .get();
    if (row && run.status === "logged" && run.updatedAt.getTime() > row.evaluatedAt.getTime()) {
      await refreshRunCollector(ctx.db, ctx.companyId, run.id);
      row = await ctx.db.select().from(pressRunCollector).where(eq(pressRunCollector.pressRunId, run.id)).get();
    }
    if (!row) return null;
    return {
      runId: row.pressRunId,
      frames: row.frames,
      simulated: row.simulated,
      firstFrameAt: row.firstFrameAt,
      lastFrameAt: row.lastFrameAt,
      extrudingFrames: row.extrudingFrames,
      ramSpeedAvgMmS: un10(row.ramSpeedAvgX10),
      ramSpeedMaxMmS: un10(row.ramSpeedMaxX10),
      billetTempAvgC: un10(row.billetTempAvgX10),
      exitTempMaxC: un10(row.exitTempMaxX10),
      pressureMaxBar: un10(row.pressureMaxX10),
      billetsCounted: row.billetsCounted,
      collectorInputG: row.collectorInputG,
      typedInputG: row.typedInputG,
      varianceBasis: row.varianceBasis,
      varianceBp: row.varianceBp,
      collectorVariance: row.collectorVariance,
      evaluatedAt: row.evaluatedAt,
    };
  }),

  /** Open alert count for a chip (any member). */
  openAlertCount: companyProcedure.query(async ({ ctx }) => {
    const [r] = await ctx.db
      .select({ n: sql<number>`count(*)`, sim: sql<number>`coalesce(max(${pressAlert.simulated}), 0)` })
      .from(pressAlert)
      .where(and(eq(pressAlert.companyId, ctx.companyId), isNull(pressAlert.endedAt)));
    return { open: Number(r?.n ?? 0), simulated: Number(r?.sim ?? 0) > 0 };
  }),
});
