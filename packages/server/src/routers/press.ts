/**
 * Press (FP-PR, Wave 2), mounted as `press` (module `press`):
 * - `press.lines.*`    press lines master (FP-PR-01; masters.publish to write).
 * - `press.queue.*`    the queue of one line (FP-PR-02) and its changes after release (FP-PR-25,
 *                      `press.queue`: reorder queued / die_issued runs, urgent, pull one cut length
 *                      back to planable; one audit row per change).
 * - `press.runs.*`     the station (routers/pressRun.ts).
 * - `press.downtime.*` downtime rows with reason codes (FP-PR-12): server start / stop, one open
 *                      per line.
 * - `press.report`     17 columns + CSV (FP-PR-17), `press.summary` (FP-PR-18).
 * - `press.reasons`    active reason codes of a kind for the station pickers (W2-PR-W).
 * Audit: press_line.create / update / retire / restore, press_run.queue_move, press_run.urgent,
 * press_plan_line.pull_back, press_downtime.start / stop.
 */
import { moveInQueue, PRESS_QUEUE_REORDERABLE, REASON_CODE_KINDS } from "@orrn/domain";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dieInstance } from "@orrn/db/schema/dies";
import { pressDowntime, pressLine, pressPlanDie, pressPlanLine, pressRun } from "@orrn/db/schema/press";
import { reasonCode } from "@orrn/db/schema/reasons";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import { atomicBatch, mapInChunks, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert, auditInsertGuarded } from "../lib/audit";
import { now as clockNow } from "../lib/clock";
import { productionDayWindow } from "../lib/dayWindow";
import { companySettings, isPressAbort, LIVE_RUN_STATUSES, lineQueue, pressAbortUnless, pressErrorText } from "../lib/press";
import { ensureDefaultReasonCodes, hasStandardWording } from "../lib/reasonCodes";
import { pressDaySummary, pressReport, pressReportCsv } from "../lib/pressReport";
import { nextCompanySeq } from "../lib/sequence";
import { pressRunRouter } from "./pressRun";
import { pressCollectorRouter } from "./pressCollector";

const id = z.string().min(1).max(64);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Day as YYYY-MM-DD");
const code = z
  .string()
  .trim()
  .min(1)
  .max(12)
  .regex(/^[A-Za-z0-9-]+$/, "Code like P1 (letters, digits, dashes)");

const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};

async function loadLine(db: Parameters<typeof companySettings>[0], companyId: string, lineId: string) {
  const [row] = await db
    .select()
    .from(pressLine)
    .where(and(eq(pressLine.id, lineId), eq(pressLine.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Press line not found" });
  return row;
}

const linesRouter = router({
  list: companyProcedure
    .input(z.object({ includeRetired: z.boolean().default(false) }).default({ includeRetired: false }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: pressLine.id,
          code: pressLine.code,
          name: pressLine.name,
          tonnageT: pressLine.tonnageT,
          status: pressLine.status,
          sortOrder: pressLine.sortOrder,
          running: sql<string | null>`(select r.number from press_run r where r.company_id = "press_line"."company_id" and r.press_line_id = "press_line"."id" and r.status = 'running' limit 1)`,
          queued: sql<number>`(select count(*) from press_run r where r.company_id = "press_line"."company_id" and r.press_line_id = "press_line"."id" and r.status in ('queued', 'die_issued'))`,
          openDowntime: sql<number>`(select count(*) from press_downtime d where d.company_id = "press_line"."company_id" and d.press_line_id = "press_line"."id" and d.stopped_at is null)`,
        })
        .from(pressLine)
        .where(and(eq(pressLine.companyId, ctx.companyId), input.includeRetired ? undefined : eq(pressLine.status, "active")))
        .orderBy(asc(pressLine.sortOrder), asc(pressLine.code));
      return rows.map((r) => ({ ...r, queued: Number(r.queued), openDowntime: Number(r.openDowntime) > 0 }));
    }),

  create: actionProcedure("masters.publish")
    .input(z.object({ code, name: z.string().trim().min(1).max(60), tonnageT: z.number().int().min(1).max(20_000).nullable().optional(), sortOrder: z.number().int().min(0).max(999).optional() }))
    .mutation(async ({ ctx, input }) => {
      const lineId = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(pressLine).values({
            id: lineId,
            companyId: ctx.companyId,
            serverSeq: seq,
            code: input.code.toUpperCase(),
            name: input.name,
            tonnageT: input.tonnageT ?? null,
            sortOrder: input.sortOrder ?? 0,
            createdBy: ctx.session.user.id,
          }),
          auditInsert(ctx, { action: "press_line.create", subjectType: "press_line", subjectId: lineId, meta: { code: input.code.toUpperCase(), name: input.name } }),
        ]);
      } catch (e) {
        if (pressErrorText(e).includes("press_line.company_id, press_line.code")) {
          throw new TRPCError({ code: "CONFLICT", message: `There is already a press ${input.code.toUpperCase()}` });
        }
        throw e;
      }
      return { id: lineId };
    }),

  update: actionProcedure("masters.publish")
    .input(z.object({ id, name: z.string().trim().min(1).max(60).optional(), tonnageT: z.number().int().min(1).max(20_000).nullable().optional(), sortOrder: z.number().int().min(0).max(999).optional() }))
    .mutation(async ({ ctx, input }) => {
      const line = await loadLine(ctx.db, ctx.companyId, input.id);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const set = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.tonnageT !== undefined ? { tonnageT: input.tonnageT } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      };
      await atomicBatch(ctx.db, [
        ctx.db.update(pressLine).set({ ...set, serverSeq: seq }).where(and(eq(pressLine.id, line.id), eq(pressLine.companyId, ctx.companyId))),
        auditInsert(ctx, { action: "press_line.update", subjectType: "press_line", subjectId: line.id, meta: { code: line.code, ...set } }),
      ]);
      return { success: true };
    }),

  /** Retire: refused while a run on the line is open (queued … counting) or downtime is open. */
  retire: actionProcedure("masters.publish")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const line = await loadLine(ctx.db, ctx.companyId, input.id);
      if (line.status === "retired") return { success: true };
      const [open] = await ctx.db
        .select({ number: pressRun.number })
        .from(pressRun)
        .where(and(eq(pressRun.companyId, ctx.companyId), eq(pressRun.pressLineId, line.id), inArray(pressRun.status, [...LIVE_RUN_STATUSES])))
        .limit(1);
      if (open) bad(`${open.number} is still open on ${line.code}; finish or void it first`);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db
            .update(pressLine)
            .set({ status: "retired", serverSeq: seq })
            .where(
              and(
                eq(pressLine.id, line.id),
                eq(pressLine.companyId, ctx.companyId),
                sql`not exists (select 1 from press_run r where r.company_id = ${ctx.companyId} and r.press_line_id = ${line.id} and r.status in ('queued', 'die_issued', 'running', 'stopped', 'counting'))`,
              ),
            ),
          pressAbortUnless(ctx.db, sql`exists (select 1 from press_line l where l.id = ${line.id} and l.status = 'retired' and l.server_seq = ${seq})`),
          auditInsert(ctx, { action: "press_line.retire", subjectType: "press_line", subjectId: line.id, meta: { code: line.code } }),
        ]);
      } catch (e) {
        if (isPressAbort(e)) throw new TRPCError({ code: "CONFLICT", message: `A run was put on ${line.code} meanwhile` });
        throw e;
      }
      return { success: true };
    }),

  restore: actionProcedure("masters.publish")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const line = await loadLine(ctx.db, ctx.companyId, input.id);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db.update(pressLine).set({ status: "active", serverSeq: seq }).where(and(eq(pressLine.id, line.id), eq(pressLine.companyId, ctx.companyId))),
        auditInsert(ctx, { action: "press_line.restore", subjectType: "press_line", subjectId: line.id, meta: { code: line.code } }),
      ]);
      return { success: true };
    }),
});

const queueRouter = router({
  /**
   * One line's job cards (FP-PR-02, rank 31/44): the running / stopped / counting runs first, then
   * the queue in order (urgent first, queue position, number). One card per die across parties:
   * SO numbers (never nicknames) with cut length, pcs and kg per line, totals, copy, bolster,
   * progress (logged good kg already on those order lines). Filters: section, sales order, copy.
   */
  list: companyProcedure
    .input(z.object({ pressLineId: id, sectionId: id.optional(), salesOrderId: id.optional(), dieInstanceId: id.optional() }))
    .query(async ({ ctx, input }) => {
      const line = await loadLine(ctx.db, ctx.companyId, input.pressLineId);
      const queue = await lineQueue(ctx.db, ctx.companyId, line.id);
      const active = await ctx.db
        .select({ id: pressRun.id, number: pressRun.number, status: pressRun.status, sectionId: pressRun.sectionId, dieInstanceId: pressRun.dieInstanceId, pressPlanDieId: pressRun.pressPlanDieId, queuePos: pressRun.queuePos })
        .from(pressRun)
        .where(and(eq(pressRun.companyId, ctx.companyId), eq(pressRun.pressLineId, line.id), inArray(pressRun.status, ["running", "stopped", "counting"])))
        .orderBy(asc(pressRun.startedAt));
      const ordered = [
        ...active.map((r) => ({ ...r, urgent: false, purpose: "production" })),
        ...queue,
      ];
      const runIds = ordered.map((r) => r.id);
      const planDieIds = ordered.map((r) => r.pressPlanDieId).filter((x): x is string => Boolean(x));
      const details = await mapInChunks(runIds, (part) =>
        ctx.db
          .select({
            id: pressRun.id,
            sectionCode: die.sectionCode,
            sectionName: die.name,
            copyCode: dieInstance.code,
            bolster: dieInstance.bolster,
            startedAt: pressRun.startedAt,
            planId: pressRun.planId,
            purpose: sql<string | null>`(select p.purpose from press_plan p where p.id = ${pressRun.planId})`,
            urgent: sql<number>`coalesce((select d.urgent from press_plan_die d where d.id = ${pressRun.pressPlanDieId}), 0)`,
          })
          .from(pressRun)
          .innerJoin(die, and(eq(die.id, pressRun.sectionId), eq(die.companyId, pressRun.companyId)))
          .leftJoin(dieInstance, and(eq(dieInstance.id, pressRun.dieInstanceId), eq(dieInstance.companyId, pressRun.companyId)))
          .where(and(eq(pressRun.companyId, ctx.companyId), inArray(pressRun.id, part))),
      );
      const planLines = await mapInChunks(planDieIds, (part) =>
        ctx.db
          .select({
            id: pressPlanLine.id,
            pressPlanDieId: pressPlanLine.pressPlanDieId,
            salesOrderLineId: pressPlanLine.salesOrderLineId,
            orderId: salesOrder.id,
            orderNumber: salesOrder.number,
            customerId: salesOrder.customerId,
            customerName: customer.name,
            cutLengthMm: pressPlanLine.cutLengthMm,
            pcs: pressPlanLine.pcs,
            kgG: pressPlanLine.kgG,
            preferredDieInstanceId: pressPlanLine.preferredDieInstanceId,
            pressedG: sql<number>`(select coalesce(sum(rl.good_g), 0) from press_run_line rl join press_run lr on lr.id = rl.press_run_id and lr.company_id = rl.company_id where rl.company_id = ${pressPlanLine.companyId} and rl.sales_order_line_id = ${pressPlanLine.salesOrderLineId} and lr.status = 'logged')`,
          })
          .from(pressPlanLine)
          .innerJoin(salesOrderLine, and(eq(salesOrderLine.id, pressPlanLine.salesOrderLineId), eq(salesOrderLine.companyId, pressPlanLine.companyId)))
          .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, salesOrderLine.companyId)))
          .innerJoin(customer, and(eq(customer.id, salesOrder.customerId), eq(customer.companyId, salesOrder.companyId)))
          .where(and(eq(pressPlanLine.companyId, ctx.companyId), inArray(pressPlanLine.pressPlanDieId, part)))
          .orderBy(asc(salesOrder.number), asc(pressPlanLine.cutLengthMm)),
      );
      const detailBy = new Map(details.map((d) => [d.id, d]));
      const cards = ordered
        .map((r, i) => {
          const d = detailBy.get(r.id);
          const lines = planLines.filter((l) => l.pressPlanDieId === r.pressPlanDieId).map((l) => ({ ...l, pressedG: Number(l.pressedG) }));
          return {
            id: r.id,
            number: r.number,
            status: r.status,
            position: i + 1,
            queuePos: r.queuePos,
            urgent: Boolean(d?.urgent),
            purpose: d?.purpose ?? "production",
            planId: d?.planId ?? null,
            pressPlanDieId: r.pressPlanDieId,
            sectionId: r.sectionId,
            sectionCode: d?.sectionCode ?? "",
            sectionName: d?.sectionName ?? "",
            dieInstanceId: r.dieInstanceId,
            copyCode: d?.copyCode ?? null,
            bolster: d?.bolster ?? null,
            startedAt: d?.startedAt ?? null,
            reorderable: (PRESS_QUEUE_REORDERABLE as readonly string[]).includes(r.status),
            orders: [...new Set(lines.map((l) => l.orderNumber))],
            lines,
            totals: { pcs: lines.reduce((s, l) => s + l.pcs, 0), kgG: lines.reduce((s, l) => s + l.kgG, 0), pressedG: lines.reduce((s, l) => s + l.pressedG, 0) },
          };
        })
        .filter(
          (c) =>
            (!input.sectionId || c.sectionId === input.sectionId) &&
            (!input.dieInstanceId || c.dieInstanceId === input.dieInstanceId) &&
            (!input.salesOrderId || c.lines.some((l) => l.orderId === input.salesOrderId)),
        );
      return { line: { id: line.id, code: line.code, name: line.name, status: line.status }, cards };
    }),

  /** Move one queued / die_issued run to `toIndex` (0-based) of the line's queue (FP-PR-25). */
  move: actionProcedure("press.queue")
    .input(z.object({ runId: id, toIndex: z.number().int().min(0).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const [run] = await ctx.db
        .select({ id: pressRun.id, number: pressRun.number, status: pressRun.status, pressLineId: pressRun.pressLineId })
        .from(pressRun)
        .where(and(eq(pressRun.id, input.runId), eq(pressRun.companyId, ctx.companyId)))
        .limit(1);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Press run not found" });
      if (!(PRESS_QUEUE_REORDERABLE as readonly string[]).includes(run.status) || !run.pressLineId) {
        bad(`${run.number} has started; only queued runs move`);
      }
      const queue = await lineQueue(ctx.db, ctx.companyId, run.pressLineId!);
      const ids = queue.map((r) => r.id);
      const from = ids.indexOf(run.id);
      const next = moveInQueue(ids, run.id, input.toIndex);
      // m-7: the queue shows urgent runs first, so a move may not cross that boundary.
      const urgentOf = new Map(queue.map((r) => [r.id, r.urgent]));
      const firstNormal = next.findIndex((n) => !urgentOf.get(n.id));
      if (firstNormal >= 0 && next.slice(firstNormal).some((n) => urgentOf.get(n.id))) {
        bad(urgentOf.get(run.id) ? `${run.number} is urgent; it stays above the other runs` : `Urgent runs stay at the top; mark ${run.number} urgent to move it there`);
      }
      const was = new Map(queue.map((r) => [r.id, r.queuePos]));
      const changed = next.filter((n) => was.get(n.id) !== n.queuePos);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const statements: SqliteBatchItem[] = changed.map((n) =>
        ctx.db
          .update(pressRun)
          .set({ queuePos: n.queuePos, serverSeq: seq })
          .where(and(eq(pressRun.id, n.id), eq(pressRun.companyId, ctx.companyId), inArray(pressRun.status, [...PRESS_QUEUE_REORDERABLE]))),
      );
      statements.push(
        pressAbortUnless(ctx.db, sql`exists (select 1 from press_run m where m.id = ${run.id} and m.status in ('queued', 'die_issued'))`),
        auditInsert(ctx, {
          action: "press_run.queue_move",
          subjectType: "press_run",
          subjectId: run.id,
          meta: { number: run.number, pressLineId: run.pressLineId, from, to: next.findIndex((n) => n.id === run.id), order: next.map((n) => n.id) },
        }),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isPressAbort(e)) throw new TRPCError({ code: "CONFLICT", message: `${run.number} started meanwhile; it can't move` });
        throw e;
      }
      return { order: next };
    }),

  /** Urgent first (the plan die's flag). */
  urgent: actionProcedure("press.queue")
    .input(z.object({ runId: id, urgent: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [run] = await ctx.db
        .select({ id: pressRun.id, number: pressRun.number, status: pressRun.status, pressPlanDieId: pressRun.pressPlanDieId })
        .from(pressRun)
        .where(and(eq(pressRun.id, input.runId), eq(pressRun.companyId, ctx.companyId)))
        .limit(1);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Press run not found" });
      if (!(PRESS_QUEUE_REORDERABLE as readonly string[]).includes(run.status)) bad(`${run.number} has started`);
      if (!run.pressPlanDieId) bad(`${run.number} is not from a plan`);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db.update(pressPlanDie).set({ urgent: input.urgent, serverSeq: seq }).where(and(eq(pressPlanDie.id, run.pressPlanDieId!), eq(pressPlanDie.companyId, ctx.companyId))),
        auditInsert(ctx, { action: "press_run.urgent", subjectType: "press_run", subjectId: run.id, meta: { number: run.number, urgent: input.urgent } }),
      ]);
      return { success: true };
    }),

  /**
   * Pull one cut length (a plan line) off a queued / die_issued run, back to planable (FP-PR-25).
   * The run keeps at least one line (void the run to drop the last one).
   */
  pullBack: actionProcedure("press.queue")
    .input(z.object({ pressPlanLineId: id, reason: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const [pl] = await ctx.db
        .select({ id: pressPlanLine.id, pressPlanDieId: pressPlanLine.pressPlanDieId, salesOrderLineId: pressPlanLine.salesOrderLineId, kgG: pressPlanLine.kgG, pcs: pressPlanLine.pcs, cutLengthMm: pressPlanLine.cutLengthMm, orderNumber: salesOrder.number })
        .from(pressPlanLine)
        .innerJoin(salesOrderLine, and(eq(salesOrderLine.id, pressPlanLine.salesOrderLineId), eq(salesOrderLine.companyId, pressPlanLine.companyId)))
        .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, salesOrderLine.companyId)))
        .where(and(eq(pressPlanLine.id, input.pressPlanLineId), eq(pressPlanLine.companyId, ctx.companyId)))
        .limit(1);
      if (!pl) throw new TRPCError({ code: "NOT_FOUND", message: "Plan line not found" });
      const [run] = await ctx.db
        .select({ id: pressRun.id, number: pressRun.number, status: pressRun.status })
        .from(pressRun)
        .where(and(eq(pressRun.companyId, ctx.companyId), eq(pressRun.pressPlanDieId, pl.pressPlanDieId), sql`${pressRun.status} <> 'voided'`))
        .limit(1);
      if (!run) bad("This plan is not released yet; edit the plan instead");
      if (!(PRESS_QUEUE_REORDERABLE as readonly string[]).includes(run!.status)) bad(`${run!.number} has started; its lines can't be pulled back`);
      const [{ n } = { n: 0 }] = await ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(pressPlanLine)
        .where(and(eq(pressPlanLine.companyId, ctx.companyId), eq(pressPlanLine.pressPlanDieId, pl.pressPlanDieId)));
      if (Number(n) <= 1) bad(`This is ${run!.number}'s only line; void the run instead`);
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          // m-8: the run's sequence moves only while the line is still there, so of two concurrent
          // pull backs one lands (and is audited); the other aborts.
          ctx.db
            .update(pressRun)
            .set({ serverSeq: seq })
            .where(
              and(
                eq(pressRun.id, run!.id),
                eq(pressRun.companyId, ctx.companyId),
                inArray(pressRun.status, [...PRESS_QUEUE_REORDERABLE]),
                sql`exists (select 1 from press_plan_line g where g.id = ${pl.id})`,
              ),
            ),
          pressAbortUnless(ctx.db, sql`exists (select 1 from press_run sr where sr.id = ${run!.id} and sr.server_seq = ${seq})`),
          ctx.db
            .delete(pressPlanLine)
            .where(
              and(
                eq(pressPlanLine.id, pl.id),
                eq(pressPlanLine.companyId, ctx.companyId),
                sql`exists (select 1 from press_run r where r.id = ${run!.id} and r.status in ('queued', 'die_issued'))`,
                sql`(select count(*) from press_plan_line x where x.company_id = ${ctx.companyId} and x.press_plan_die_id = ${pl.pressPlanDieId}) > 1`,
              ),
            ),
          pressAbortUnless(ctx.db, sql`not exists (select 1 from press_plan_line g where g.id = ${pl.id})`),
          auditInsertGuarded(
            ctx,
            {
              action: "press_plan_line.pull_back",
              subjectType: "press_run",
              subjectId: run!.id,
              meta: { number: run!.number, pressPlanLineId: pl.id, salesOrderLineId: pl.salesOrderLineId, orderNumber: pl.orderNumber, kgG: pl.kgG, pcs: pl.pcs, cutLengthMm: pl.cutLengthMm, reason: input.reason ?? null },
            },
            { from: pressRun, where: and(eq(pressRun.id, run!.id), eq(pressRun.serverSeq, seq), sql`not exists (select 1 from press_plan_line g where g.id = ${pl.id})`) },
          ),
        ]);
      } catch (e) {
        if (isPressAbort(e)) throw new TRPCError({ code: "CONFLICT", message: `${run!.number} changed meanwhile; nothing was pulled back` });
        throw e;
      }
      return { success: true, salesOrderLineId: pl.salesOrderLineId, kgG: pl.kgG };
    }),
});

const downtimeRouter = router({
  /** Start downtime on a line (server time). With no run named, the line's running run (if any). */
  start: actionProcedure("press.run")
    .input(z.object({ pressLineId: id, reasonCodeId: id, pressRunId: id.optional(), note: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const line = await loadLine(ctx.db, ctx.companyId, input.pressLineId);
      if (line.status !== "active") bad(`${line.code} is retired`);
      const [rc] = await ctx.db
        .select({ id: reasonCode.id, code: reasonCode.code, requiresNote: reasonCode.requiresNote })
        .from(reasonCode)
        .where(and(eq(reasonCode.id, input.reasonCodeId), eq(reasonCode.companyId, ctx.companyId), eq(reasonCode.kind, "downtime"), eq(reasonCode.active, true)))
        .limit(1);
      if (!rc) bad("Pick a downtime reason from the list");
      if ((rc!.requiresNote || rc!.code === "other") && !input.note) bad("Add a note for Other");
      let runId = input.pressRunId ?? null;
      if (runId) {
        const [r] = await ctx.db
          .select({ id: pressRun.id, pressLineId: pressRun.pressLineId, status: pressRun.status })
          .from(pressRun)
          .where(and(eq(pressRun.id, runId), eq(pressRun.companyId, ctx.companyId)))
          .limit(1);
        if (!r) throw new TRPCError({ code: "NOT_FOUND", message: "Press run not found" });
        if (r.pressLineId !== line.id) bad("That run is on another press");
        if (r.status === "logged" || r.status === "voided") bad("That run is closed");
      } else {
        const [r] = await ctx.db
          .select({ id: pressRun.id })
          .from(pressRun)
          .where(and(eq(pressRun.companyId, ctx.companyId), eq(pressRun.pressLineId, line.id), inArray(pressRun.status, ["running", "stopped"])))
          .orderBy(desc(pressRun.startedAt))
          .limit(1);
        runId = r?.id ?? null;
      }
      const dtId = crypto.randomUUID();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const at = clockNow();
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(pressDowntime).values({
            id: dtId,
            companyId: ctx.companyId,
            serverSeq: seq,
            pressLineId: line.id,
            pressRunId: runId,
            reasonCodeId: rc!.id,
            note: input.note ?? null,
            startedAt: at,
            stoppedAt: null,
            startedBy: ctx.session.user.id,
            stoppedBy: null,
            createdAt: at,
            updatedAt: at,
          }),
          auditInsert(ctx, { action: "press_downtime.start", subjectType: "press_downtime", subjectId: dtId, meta: { pressLineId: line.id, pressRunId: runId, reason: rc!.code } }),
        ]);
      } catch (e) {
        if (pressErrorText(e).includes("press_downtime.press_line_id")) {
          throw new TRPCError({ code: "CONFLICT", message: `${line.code} already has downtime running; stop it first` });
        }
        throw e;
      }
      return { id: dtId, pressRunId: runId, startedAt: at };
    }),

  stop: actionProcedure("press.run")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ id: pressDowntime.id, stoppedAt: pressDowntime.stoppedAt, startedAt: pressDowntime.startedAt })
        .from(pressDowntime)
        .where(and(eq(pressDowntime.id, input.id), eq(pressDowntime.companyId, ctx.companyId)))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Downtime not found" });
      if (row.stoppedAt) return { id: row.id, stoppedAt: row.stoppedAt, minutes: Math.round((row.stoppedAt.getTime() - row.startedAt.getTime()) / 60_000) };
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      await atomicBatch(ctx.db, [
        ctx.db
          .update(pressDowntime)
          .set({ stoppedAt: at, stoppedBy: ctx.session.user.id, serverSeq: seq, updatedAt: at })
          .where(and(eq(pressDowntime.id, row.id), eq(pressDowntime.companyId, ctx.companyId), isNull(pressDowntime.stoppedAt))),
        // m-8: audited only by the request whose stop landed.
        auditInsertGuarded(
          ctx,
          { action: "press_downtime.stop", subjectType: "press_downtime", subjectId: row.id, meta: { minutes: Math.round((at.getTime() - row.startedAt.getTime()) / 60_000) } },
          { from: pressDowntime, where: and(eq(pressDowntime.id, row.id), eq(pressDowntime.serverSeq, seq)) },
        ),
      ]);
      return { id: row.id, stoppedAt: at, minutes: Math.max(0, Math.round((at.getTime() - row.startedAt.getTime()) / 60_000)) };
    }),

  list: companyProcedure
    .input(z.object({ pressLineId: id.optional(), pressRunId: id.optional(), openOnly: z.boolean().optional(), limit: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({
          id: pressDowntime.id,
          pressLineId: pressDowntime.pressLineId,
          pressRunId: pressDowntime.pressRunId,
          reasonCodeId: pressDowntime.reasonCodeId,
          reasonCode: reasonCode.code,
          reasonLabel: reasonCode.label,
          // I-2: the station shows the reason in the reader's language (typed wording, else built-in).
          labelHi: reasonCode.labelHi,
          labelGu: reasonCode.labelGu,
          note: pressDowntime.note,
          startedAt: pressDowntime.startedAt,
          stoppedAt: pressDowntime.stoppedAt,
        })
        .from(pressDowntime)
        .innerJoin(reasonCode, and(eq(reasonCode.id, pressDowntime.reasonCodeId), eq(reasonCode.companyId, pressDowntime.companyId)))
        .where(
          and(
            eq(pressDowntime.companyId, ctx.companyId),
            input.pressLineId ? eq(pressDowntime.pressLineId, input.pressLineId) : undefined,
            input.pressRunId ? eq(pressDowntime.pressRunId, input.pressRunId) : undefined,
            input.openOnly ? isNull(pressDowntime.stoppedAt) : undefined,
          ),
        )
        .orderBy(desc(pressDowntime.startedAt))
        .limit(input.limit);
      return rows.map((r) => ({ ...r, standard: hasStandardWording("downtime", r.reasonCode, r.reasonLabel) }));
    }),
});

export const pressRouter = router({
  lines: linesRouter,
  queue: queueRouter,
  runs: pressRunRouter,
  downtime: downtimeRouter,
  /** W4-COLLECTORS: thresholds, alerts, run annotation (frames arrive node-signed, not here). */
  collector: pressCollectorRouter,

  /**
   * Reason codes of one kind for the pickers (downtime, qc_reject, void, reprint, ...). The first
   * read of a plant that has none (or only some) adds the standard codes it is missing, so no
   * plant starts with an empty list (rank 30); renamed or retired codes are left alone. Any member
   * (D26): the station's pickers and the void dialog read it; a retired code simply drops out.
   */
  reasons: companyProcedure
    .input(z.object({ kind: z.enum(REASON_CODE_KINDS), includeInactive: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      await ensureDefaultReasonCodes(ctx.db, ctx.companyId);
      const rows = await ctx.db
        .select({
          id: reasonCode.id,
          kind: reasonCode.kind,
          code: reasonCode.code,
          label: reasonCode.label,
          labelHi: reasonCode.labelHi,
          labelGu: reasonCode.labelGu,
          requiresNote: reasonCode.requiresNote,
          active: reasonCode.active,
          sortOrder: reasonCode.sortOrder,
        })
        .from(reasonCode)
        .where(and(eq(reasonCode.companyId, ctx.companyId), eq(reasonCode.kind, input.kind), input.includeInactive ? undefined : eq(reasonCode.active, true)))
        .orderBy(asc(reasonCode.sortOrder), asc(reasonCode.code));
      return rows.map((r) => ({ ...r, standard: hasStandardWording(r.kind, r.code, r.label) }));
    }),

  /** Press report (FP-PR-17): 17 columns, logged runs by production day; `csv` when asked. */
  report: actionProcedure("reports.read")
    .input(
      z.object({
        from: day,
        to: day,
        shiftSeq: z.number().int().min(1).max(4).optional(),
        pressLineId: id.optional(),
        planId: id.optional(),
        format: z.enum(["json", "csv"]).default("json"),
        limit: z.number().int().min(1).max(2000).default(500),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.to < input.from) bad("The period must end after it starts");
      const out = await pressReport(ctx.db, ctx.companyId, input, clockNow().getTime());
      return { ...out, csv: input.format === "csv" ? pressReportCsv(out.rows) : null };
    }),

  /** Daily press summary (FP-PR-18); press role sees it too (today's floor figures). */
  summary: anyActionProcedure("reports.read", "press.run")
    .input(z.object({ productionDay: day.optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const nowMs = clockNow().getTime();
      const dayKey = input.productionDay ?? productionDayWindow(await companySettings(ctx.db, ctx.companyId), nowMs).productionDay;
      return pressDaySummary(ctx.db, ctx.companyId, dayKey, nowMs);
    }),
});

