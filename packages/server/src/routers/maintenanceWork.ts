/**
 * Maintenance work orders and their spares (XE parity lane MAINT, rows 65 and 66), mounted as
 * `maint.workOrders` and `maint.spares` by `routers/maintenance.ts`.
 *
 * - A work order is breakdown or preventive, made by hand, from a press downtime entry with the
 *   breakdown reason (`fromDowntime`, one tap on the press station), from a preventive plan, or from an
 *   out-of-limit reading. Each of those sources makes at most one work order (partial unique indexes);
 *   a second tap returns the first (`replayed: true`) and takes no second number.
 * - Status moves only through `maintWoNext` (`@orrn/domain`). Every write is guarded by the row's
 *   `server_seq` read by the caller, so a save over a newer version is a CONFLICT with no audit row.
 *   Done needs the work done; cancel needs a reason. A preventive work order done resets its plan in
 *   the same batch, guarded on the move landing.
 * - Spares: the store keeps the issue (MRS, purpose `maintenance`, issued with `store.issue` from the
 *   work order screen, refId = the work order id); `spares.link` records which work order used it.
 *   Value per entry waits for the store rate helper (TODO(xe-store2) `storeIssueValuePaise`); until then
 *   the screens show quantities only.
 */
import {
  isMaintWoLive,
  maintWoMoves,
  maintWoNext,
  priorityFromCriticality,
  type MaintPriority,
  type MaintWoKind,
  type MaintWoStatus,
} from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { user } from "@orrn/db/schema/auth";
import {
  maintAsset,
  maintPlan,
  maintPriorities,
  maintReading,
  maintWoKinds,
  maintWoSpare,
  maintWoStatuses,
  maintWorkOrder,
  type MaintWorkOrderRow,
} from "@orrn/db/schema/maintenance";
import { pressDowntime, pressLine } from "@orrn/db/schema/press";
import { reasonCode } from "@orrn/db/schema/reasons";
import { storeItem, storeTxn } from "@orrn/db/schema/store";
import { membership } from "@orrn/db/schema/tenant";

import { actionProcedure, router } from "../index";
import { atomicBatch, atomicBatchLast, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { auditInsertGuarded } from "../lib/audit";
import { now } from "../lib/clock";
import { docNumberInBatch, isDocNumberStale } from "../lib/docNumber";
import { batchAbortUnlessOn, isBatchAbortOn } from "../lib/orders";
import { assertMember, loadAsset, notFound } from "../lib/maintenance";
import { assertModule } from "../lib/moduleGate";
import { nextCompanySeq } from "../lib/sequence";

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().min(1).max(max);

export const WO_CHANGED = "This work order changed since you opened it. Open it again.";
export const WO_FINAL = "This work order is closed";
export const WO_NUMBER_BUSY = "Others are raising work orders at the same moment. Try again.";
export const WO_BAD_MOVE = "A work order cannot move to that status from here";
export const WO_NEEDS_WORK_DONE = "Write what was done before marking the work order done";
export const WO_NEEDS_REASON = "Say why the work order is cancelled";
export const WO_FINISH_BEFORE_START = "The finish time is before the start time";
export const WO_TIME_FUTURE = "A start or finish time cannot be in the future";
export const WO_DONE_KEEPS_TIMES = "A done work order keeps its start and finish times";
export const DOWNTIME_NOT_BREAKDOWN = "Only a downtime entry with the breakdown reason makes a work order";
export const DOWNTIME_NO_ASSET = "No asset points at this press yet. Add it to the asset register first";
export const SPARE_NOT_MAINTENANCE = "Only a store issue for maintenance can be linked";
export const SPARE_CANCELLED = "That store issue was cancelled";
export const SPARE_TAKEN = "That store issue is already on a work order";
export const SPARE_NOT_LINKED = "That store issue is not on this work order";

type Ctx = { db: OrrnDb; companyId: string };
type WriteCtx = Parameters<typeof auditInsertGuarded>[0] & { companyId: string; session: { user: { id: string } } };

const viewProcedure = actionProcedure("maint.view");
const workProcedure = actionProcedure("maint.workorder");

async function loadWo(ctx: Ctx, woId: string): Promise<MaintWorkOrderRow> {
  const [row] = await ctx.db.select().from(maintWorkOrder).where(and(eq(maintWorkOrder.companyId, ctx.companyId), eq(maintWorkOrder.id, woId))).limit(1);
  if (!row) throw notFound();
  return row;
}

function uniqueHit(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    if (/UNIQUE constraint failed: maint_work_order/.test(cur instanceof Error ? cur.message : String(cur))) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

type NewWo = {
  assetId: string;
  kind: MaintWoKind;
  source: "manual" | "downtime" | "plan" | "reading";
  title: string;
  priority: MaintPriority;
  assignedTo?: string | null;
  planId?: string | null;
  downtimeId?: string | null;
  readingId?: string | null;
};

/**
 * Insert one work order with its number and audit row. When the source already has one (a unique index
 * on downtime, reading or live plan), the existing row comes back with `replayed: true`. `existing`
 * re-reads that row after a lost race. The WO number is reserved inside the same batch
 * (`docNumberInBatch`), so a lost race takes no number and the series has no gap; when another work
 * order took the predicted number first, it reads again and retries (at most 5 times, then CONFLICT).
 */
export async function insertWorkOrder(ctx: WriteCtx, input: NewWo, existing: () => Promise<MaintWorkOrderRow | null>) {
  const prior = await existing();
  if (prior) return { id: prior.id, number: prior.number, replayed: true as const };
  const at = now();
  const userId = ctx.session.user.id;
  const seq = await nextCompanySeq(ctx, ctx.companyId);
  for (let attempt = 0; ; attempt += 1) {
    const doc = await docNumberInBatch(ctx.db, ctx.companyId, "maint_wo", at, userId);
    const woId = crypto.randomUUID();
    const statements = [
      ...doc.statements,
      ctx.db.insert(maintWorkOrder).values({
        id: woId,
        companyId: ctx.companyId,
        serverSeq: seq,
        number: doc.number,
        period: doc.period,
        assetId: input.assetId,
        kind: input.kind,
        source: input.source,
        planId: input.planId ?? null,
        downtimeId: input.downtimeId ?? null,
        readingId: input.readingId ?? null,
        priority: input.priority,
        status: "open",
        title: input.title,
        assignedTo: input.assignedTo ?? null,
        createdBy: userId,
        createdAt: at,
        updatedAt: at,
      }),
      auditInsertGuarded(
        ctx,
        {
          action: "maint.workorder.create",
          subjectType: "maint_work_order",
          subjectId: woId,
          meta: { number: doc.number, kind: input.kind, source: input.source, assetId: input.assetId, priority: input.priority },
        },
        { from: maintWorkOrder, where: and(eq(maintWorkOrder.companyId, ctx.companyId), eq(maintWorkOrder.id, woId)) },
      ),
    ];
    if (input.readingId) {
      statements.push(
        ctx.db
          .update(maintReading)
          .set({ workOrderId: woId })
          .where(and(eq(maintReading.companyId, ctx.companyId), eq(maintReading.id, input.readingId), isNull(maintReading.workOrderId))),
      );
    }
    try {
      await atomicBatch(ctx.db, statements as never);
      return { id: woId, number: doc.number, replayed: false as const };
    } catch (e) {
      if (uniqueHit(e)) {
        const won = await existing();
        if (won) return { id: won.id, number: won.number, replayed: true as const };
      }
      if (isDocNumberStale(e)) {
        if (attempt < 4) continue;
        // Five numbers taken under us in a row: a plain refusal, never the raw database error.
        throw new TRPCError({ code: "CONFLICT", message: WO_NUMBER_BUSY });
      }
      throw e;
    }
  }
}

/** One guarded UPDATE + its audit row, both landing only on the caller's `server_seq`. */
async function guardedWrite(
  ctx: WriteCtx,
  row: MaintWorkOrderRow,
  serverSeq: number,
  set: Partial<typeof maintWorkOrder.$inferInsert>,
  audit: { action: string; meta: Record<string, unknown>; /** Extra meta only when `when` holds at write time (after `after` ran). */ when?: { sql: SQL; meta: Record<string, unknown> } },
  after: (landedSql: SQL) => SqliteBatchItem[] = () => [],
) {
  const seq = await nextCompanySeq(ctx, ctx.companyId);
  const where = (s: number) => and(eq(maintWorkOrder.companyId, ctx.companyId), eq(maintWorkOrder.id, row.id), eq(maintWorkOrder.serverSeq, s))!;
  const landedSql = sql`exists (select 1 from maint_work_order w where w.company_id = ${ctx.companyId} and w.id = ${row.id} and w.server_seq = ${seq})`;
  const landed = await atomicBatchLast<{ id: string }>(ctx.db, [
    ctx.db.update(maintWorkOrder).set({ ...set, serverSeq: seq, updatedAt: now() }).where(where(serverSeq)),
    ...after(landedSql),
    ...(audit.when
      ? [
          auditInsertGuarded(
            ctx,
            { action: audit.action, subjectType: "maint_work_order", subjectId: row.id, meta: { number: row.number, ...audit.meta, ...audit.when.meta } },
            { from: maintWorkOrder, where: and(where(seq), audit.when.sql) },
          ),
          auditInsertGuarded(
            ctx,
            { action: audit.action, subjectType: "maint_work_order", subjectId: row.id, meta: { number: row.number, ...audit.meta } },
            { from: maintWorkOrder, where: and(where(seq), sql`not (${audit.when.sql})`) },
          ),
        ]
      : [
          auditInsertGuarded(
            ctx,
            { action: audit.action, subjectType: "maint_work_order", subjectId: row.id, meta: { number: row.number, ...audit.meta } },
            { from: maintWorkOrder, where: where(seq) },
          ),
        ]),
    ctx.db.select({ id: maintWorkOrder.id }).from(maintWorkOrder).where(where(seq)),
  ]);
  if (landed.length === 0) throw new TRPCError({ code: "CONFLICT", message: WO_CHANGED });
}

function assertSeq(row: MaintWorkOrderRow, serverSeq: number) {
  if (row.serverSeq !== serverSeq) throw new TRPCError({ code: "CONFLICT", message: WO_CHANGED });
}

async function peopleNames(ctx: Ctx, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const want = [...new Set(ids.filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (want.length === 0) return names;
  const rows = await ctx.db
    .select({ id: user.id, name: user.name })
    .from(user)
    .innerJoin(membership, and(eq(membership.userId, user.id), eq(membership.companyId, ctx.companyId)))
    .where(inArray(user.id, want.slice(0, 90)));
  for (const r of rows) names.set(r.id, r.name);
  return names;
}

/** Spares linked to a work order (or every work order of an asset), newest first, with the store entry. */
export async function sparesFor(ctx: Ctx, by: { workOrderId: string } | { assetId: string }, limit = 200) {
  const where =
    "workOrderId" in by
      ? and(eq(maintWoSpare.companyId, ctx.companyId), eq(maintWoSpare.workOrderId, by.workOrderId))
      : and(eq(maintWoSpare.companyId, ctx.companyId), eq(maintWorkOrder.assetId, by.assetId));
  const rows = await ctx.db
    .select({
      linkId: maintWoSpare.id,
      workOrderId: maintWoSpare.workOrderId,
      workOrderNumber: maintWorkOrder.number,
      storeTxnId: storeTxn.id,
      number: storeTxn.number,
      itemId: storeItem.id,
      itemName: storeItem.name,
      unit: storeItem.unit,
      qtyMilli: storeTxn.qtyMilli,
      issuedAt: storeTxn.createdAt,
      cancelledAt: storeTxn.cancelledAt,
    })
    .from(maintWoSpare)
    .innerJoin(maintWorkOrder, and(eq(maintWorkOrder.id, maintWoSpare.workOrderId), eq(maintWorkOrder.companyId, maintWoSpare.companyId)))
    .innerJoin(storeTxn, and(eq(storeTxn.id, maintWoSpare.storeTxnId), eq(storeTxn.companyId, maintWoSpare.companyId)))
    .innerJoin(storeItem, and(eq(storeItem.id, storeTxn.itemId), eq(storeItem.companyId, storeTxn.companyId)))
    .where(where)
    .orderBy(desc(storeTxn.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    issuedAt: r.issuedAt.getTime(),
    cancelledAt: r.cancelledAt?.getTime() ?? null,
    // TODO(xe-store2): value through `storeIssueValuePaise(companyId, storeTxnId)` once lib/storeValue.ts lands.
    valuePaise: null as number | null,
  }));
}

const listInput = z
  .object({
    status: z.enum(["live", "all", ...maintWoStatuses]).default("live"),
    assetId: id.optional(),
    kind: z.enum(maintWoKinds).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    /** Opaque cursor: `<createdAtMs>:<id>` of the last row of the previous page. */
    cursor: z.string().max(100).optional(),
  })
  .default({ status: "live", limit: 50 });

const ms = z.number().int().min(0).max(8_640_000_000_000);
/** A typed time may run ahead of the server clock by this much (a phone clock a little fast). */
const FUTURE_SKEW_MS = 5 * 60_000;

/** A work order on a source (downtime entry, reading) that is not cancelled: a cancelled one never blocks a new one. */
const notCancelled = sql`${maintWorkOrder.status} <> 'cancelled'`;

export const workOrdersRouter = router({
  list: viewProcedure.input(listInput).query(async ({ ctx, input }) => {
    await assertModule(ctx, "maintenance");
    const where: (SQL | undefined)[] = [eq(maintWorkOrder.companyId, ctx.companyId)];
    if (input.status === "live") where.push(inArray(maintWorkOrder.status, ["open", "in_progress", "waiting_spares"]));
    else if (input.status !== "all") where.push(eq(maintWorkOrder.status, input.status));
    if (input.assetId) where.push(eq(maintWorkOrder.assetId, input.assetId));
    if (input.kind) where.push(eq(maintWorkOrder.kind, input.kind));
    if (input.cursor) {
      const [msPart, cid] = input.cursor.split(":");
      const at = new Date(Number(msPart));
      if (cid && Number.isFinite(at.getTime())) where.push(or(lt(maintWorkOrder.createdAt, at), and(eq(maintWorkOrder.createdAt, at), lt(maintWorkOrder.id, cid))));
    }
    const rows = await ctx.db
      .select({
        id: maintWorkOrder.id,
        number: maintWorkOrder.number,
        kind: maintWorkOrder.kind,
        source: maintWorkOrder.source,
        status: maintWorkOrder.status,
        priority: maintWorkOrder.priority,
        title: maintWorkOrder.title,
        assetId: maintWorkOrder.assetId,
        assetCode: maintAsset.code,
        assetName: maintAsset.name,
        assignedTo: maintWorkOrder.assignedTo,
        assignedName: user.name,
        createdAt: maintWorkOrder.createdAt,
        finishedAt: maintWorkOrder.finishedAt,
      })
      .from(maintWorkOrder)
      .innerJoin(maintAsset, and(eq(maintAsset.id, maintWorkOrder.assetId), eq(maintAsset.companyId, maintWorkOrder.companyId)))
      .leftJoin(user, eq(user.id, maintWorkOrder.assignedTo))
      .where(and(...where))
      .orderBy(desc(maintWorkOrder.createdAt), desc(maintWorkOrder.id))
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({ ...r, createdAt: r.createdAt.getTime(), finishedAt: r.finishedAt?.getTime() ?? null })),
      nextCursor: rows.length > input.limit && last ? `${last.createdAt.getTime()}:${last.id}` : null,
    };
  }),

  get: viewProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    await assertModule(ctx, "maintenance");
    const row = await loadWo(ctx, input.id);
    const asset = await loadAsset(ctx, row.assetId);
    const names = await peopleNames(ctx, [row.assignedTo, row.createdBy]);
    const [downtime] = row.downtimeId
      ? await ctx.db
          .select({ startedAt: pressDowntime.startedAt, stoppedAt: pressDowntime.stoppedAt, note: pressDowntime.note, lineCode: pressLine.code })
          .from(pressDowntime)
          .innerJoin(pressLine, and(eq(pressLine.id, pressDowntime.pressLineId), eq(pressLine.companyId, pressDowntime.companyId)))
          .where(and(eq(pressDowntime.companyId, ctx.companyId), eq(pressDowntime.id, row.downtimeId)))
          .limit(1)
      : [];
    const [plan] = row.planId
      ? await ctx.db.select({ id: maintPlan.id, title: maintPlan.title, steps: maintPlan.steps }).from(maintPlan).where(and(eq(maintPlan.companyId, ctx.companyId), eq(maintPlan.id, row.planId))).limit(1)
      : [];
    return {
      ...row,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      startedAt: row.startedAt?.getTime() ?? null,
      finishedAt: row.finishedAt?.getTime() ?? null,
      asset: { id: asset.id, code: asset.code, name: asset.name, kind: asset.kind, criticality: asset.criticality },
      assignedName: row.assignedTo ? (names.get(row.assignedTo) ?? null) : null,
      createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
      downtime: downtime
        ? { startedAt: downtime.startedAt.getTime(), stoppedAt: downtime.stoppedAt?.getTime() ?? null, note: downtime.note, lineCode: downtime.lineCode }
        : null,
      plan: plan ?? null,
      moves: maintWoMoves(row.status),
      spares: await sparesFor(ctx, { workOrderId: row.id }),
    };
  }),

  /** People of this plant a work order can be given to (name order, at most 200). */
  people: viewProcedure.query(async ({ ctx }) => {
    await assertModule(ctx, "maintenance");
    return ctx.db
      .select({ id: user.id, name: user.name, role: membership.role })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(eq(membership.companyId, ctx.companyId))
      .orderBy(sql`lower(${user.name})`)
      .limit(200);
  }),

  create: workProcedure
    .input(
      z.object({
        assetId: id,
        kind: z.enum(maintWoKinds),
        title: text(300),
        priority: z.enum(maintPriorities).optional(),
        assignedTo: id.nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const asset = await loadAsset(ctx, input.assetId);
      if (input.assignedTo) await assertMember(ctx, input.assignedTo);
      return insertWorkOrder(
        ctx,
        {
          assetId: asset.id,
          kind: input.kind,
          source: "manual",
          title: input.title,
          priority: input.priority ?? priorityFromCriticality(asset.criticality),
          assignedTo: input.assignedTo ?? null,
        },
        async () => null,
      );
    }),

  /**
   * One tap from a press downtime entry with the breakdown reason: a breakdown work order on the asset
   * that points at that press. A second tap (or a race) returns the first work order.
   */
  fromDowntime: workProcedure.input(z.object({ downtimeId: id })).mutation(async ({ ctx, input }) => {
    const [d] = await ctx.db
      .select({ id: pressDowntime.id, lineId: pressDowntime.pressLineId, note: pressDowntime.note, code: reasonCode.code, lineCode: pressLine.code })
      .from(pressDowntime)
      .innerJoin(reasonCode, and(eq(reasonCode.id, pressDowntime.reasonCodeId), eq(reasonCode.companyId, pressDowntime.companyId)))
      .innerJoin(pressLine, and(eq(pressLine.id, pressDowntime.pressLineId), eq(pressLine.companyId, pressDowntime.companyId)))
      .where(and(eq(pressDowntime.companyId, ctx.companyId), eq(pressDowntime.id, input.downtimeId)))
      .limit(1);
    if (!d) throw notFound();
    const existing = async () => {
      const [w] = await ctx.db.select().from(maintWorkOrder).where(and(eq(maintWorkOrder.companyId, ctx.companyId), eq(maintWorkOrder.downtimeId, d.id), notCancelled)).limit(1);
      return w ?? null;
    };
    const prior = await existing();
    if (prior) return { id: prior.id, number: prior.number, replayed: true as const };
    if (d.code !== "breakdown") throw new TRPCError({ code: "BAD_REQUEST", message: DOWNTIME_NOT_BREAKDOWN });
    const [asset] = await ctx.db
      .select()
      .from(maintAsset)
      .where(and(eq(maintAsset.companyId, ctx.companyId), eq(maintAsset.linkKind, "press"), eq(maintAsset.linkId, d.lineId)))
      .limit(1);
    if (!asset) throw new TRPCError({ code: "BAD_REQUEST", message: DOWNTIME_NO_ASSET });
    return insertWorkOrder(
      ctx,
      {
        assetId: asset.id,
        kind: "breakdown",
        source: "downtime",
        downtimeId: d.id,
        title: d.note?.trim() ? d.note.trim().slice(0, 300) : `Breakdown on ${d.lineCode}`,
        priority: priorityFromCriticality(asset.criticality),
      },
      existing,
    );
  }),

  /**
   * Press downtime entries with the breakdown reason in the last 30 days, and the live or done work
   * order made from each (a cancelled one is left out, so the entry can make a new one). `hasAssets` is
   * false while the register is empty: the press station then shows nothing new at all.
   */
  breakdowns: viewProcedure.query(async ({ ctx }) => {
    await assertModule(ctx, "maintenance");
    const since = new Date(now().getTime() - 30 * 86_400_000);
    const [anyAsset] = await ctx.db.select({ id: maintAsset.id }).from(maintAsset).where(eq(maintAsset.companyId, ctx.companyId)).limit(1);
    if (!anyAsset) return { hasAssets: false, items: [] };
    const rows = await ctx.db
      .select({
        id: pressDowntime.id,
        lineId: pressDowntime.pressLineId,
        lineCode: pressLine.code,
        note: pressDowntime.note,
        startedAt: pressDowntime.startedAt,
        stoppedAt: pressDowntime.stoppedAt,
        workOrderId: maintWorkOrder.id,
        workOrderNumber: maintWorkOrder.number,
        assetId: maintAsset.id,
      })
      .from(pressDowntime)
      .innerJoin(reasonCode, and(eq(reasonCode.id, pressDowntime.reasonCodeId), eq(reasonCode.companyId, pressDowntime.companyId)))
      .innerJoin(pressLine, and(eq(pressLine.id, pressDowntime.pressLineId), eq(pressLine.companyId, pressDowntime.companyId)))
      .leftJoin(maintWorkOrder, and(eq(maintWorkOrder.companyId, pressDowntime.companyId), eq(maintWorkOrder.downtimeId, pressDowntime.id), notCancelled))
      .leftJoin(
        maintAsset,
        and(eq(maintAsset.companyId, pressDowntime.companyId), eq(maintAsset.linkKind, "press"), eq(maintAsset.linkId, pressDowntime.pressLineId)),
      )
      .where(and(eq(pressDowntime.companyId, ctx.companyId), eq(reasonCode.code, "breakdown"), sql`${pressDowntime.startedAt} >= ${since.getTime()}`))
      .orderBy(desc(pressDowntime.startedAt))
      .limit(100);
    return { hasAssets: true, items: rows.map((r) => ({ ...r, startedAt: r.startedAt.getTime(), stoppedAt: r.stoppedAt?.getTime() ?? null })) };
  }),

  update: workProcedure
    .input(
      z.object({
        id,
        serverSeq: z.number().int(),
        title: text(300).optional(),
        priority: z.enum(maintPriorities).optional(),
        assignedTo: id.nullish(),
        cause: z.string().trim().max(2000).nullish(),
        workDone: z.string().trim().max(4000).nullish(),
        labourMin: z.number().int().min(0).max(100_000).optional(),
        startedAt: ms.nullish(),
        finishedAt: ms.nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await loadWo(ctx, input.id);
      assertSeq(row, input.serverSeq);
      if (row.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: WO_FINAL });
      if (input.assignedTo) await assertMember(ctx, input.assignedTo);
      const set: Partial<typeof maintWorkOrder.$inferInsert> = {};
      const changed: string[] = [];
      const put = <K extends keyof typeof set>(k: K, v: (typeof set)[K] | undefined) => {
        if (v === undefined) return;
        set[k] = v;
        changed.push(k as string);
      };
      put("title", input.title);
      put("priority", input.priority);
      put("assignedTo", input.assignedTo === undefined ? undefined : (input.assignedTo ?? null));
      put("cause", input.cause === undefined ? undefined : input.cause || null);
      put("workDone", input.workDone === undefined ? undefined : input.workDone || null);
      put("labourMin", input.labourMin);
      put("startedAt", input.startedAt === undefined ? undefined : input.startedAt == null ? null : new Date(input.startedAt));
      put("finishedAt", input.finishedAt === undefined ? undefined : input.finishedAt == null ? null : new Date(input.finishedAt));
      const start = set.startedAt !== undefined ? set.startedAt : row.startedAt;
      const finish = set.finishedAt !== undefined ? set.finishedAt : row.finishedAt;
      const latest = now().getTime() + FUTURE_SKEW_MS;
      if ((set.startedAt && set.startedAt.getTime() > latest) || (set.finishedAt && set.finishedAt.getTime() > latest)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: WO_TIME_FUTURE });
      }
      if (start && finish && finish.getTime() < start.getTime()) throw new TRPCError({ code: "BAD_REQUEST", message: WO_FINISH_BEFORE_START });
      if (row.status === "done" && set.workDone === null) throw new TRPCError({ code: "BAD_REQUEST", message: WO_NEEDS_WORK_DONE });
      if (row.status === "done" && (set.startedAt === null || set.finishedAt === null)) throw new TRPCError({ code: "BAD_REQUEST", message: WO_DONE_KEEPS_TIMES });
      if (changed.length === 0) return { id: row.id };
      // A done preventive work order that its plan last reset from: a new finish time moves the reset point.
      const movesPlan = row.status === "done" && row.kind === "preventive" && row.planId && set.finishedAt && set.finishedAt.getTime() !== row.finishedAt?.getTime();
      // planReset is written only when the plan really moved: this work order is still its last one.
      const planMoved = movesPlan
        ? sql`exists (select 1 from maint_plan pp where pp.company_id = ${ctx.companyId} and pp.id = ${row.planId} and pp.last_work_order_id = ${row.id})`
        : undefined;
      await guardedWrite(
        ctx,
        row,
        input.serverSeq,
        set,
        { action: "maint.workorder.update", meta: { fields: changed }, ...(planMoved ? { when: { sql: planMoved, meta: { planReset: true } } } : {}) },
        (landedSql) =>
        movesPlan
          ? [
              ctx.db
                .update(maintPlan)
                .set({ baseAt: set.finishedAt!, updatedAt: now() })
                .where(and(eq(maintPlan.companyId, ctx.companyId), eq(maintPlan.id, row.planId!), eq(maintPlan.lastWorkOrderId, row.id), landedSql)),
            ]
          : [],
      );
      return { id: row.id };
    }),

  move: workProcedure
    .input(
      z.object({
        id,
        serverSeq: z.number().int(),
        to: z.enum(maintWoStatuses),
        /** Required to cancel. */
        reason: z.string().trim().max(500).optional(),
        /** May be given with done instead of a separate save. */
        workDone: z.string().trim().max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await loadWo(ctx, input.id);
      assertSeq(row, input.serverSeq);
      const from = row.status as MaintWoStatus;
      if (!isMaintWoLive(from)) throw new TRPCError({ code: "BAD_REQUEST", message: WO_FINAL });
      if (!maintWoNext(from, input.to)) throw new TRPCError({ code: "BAD_REQUEST", message: WO_BAD_MOVE });
      const at = now();
      const set: Partial<typeof maintWorkOrder.$inferInsert> = { status: input.to };
      if (input.to === "in_progress" && !row.startedAt) set.startedAt = at;
      if (input.to === "done") {
        const work = input.workDone?.trim() || row.workDone;
        if (!work) throw new TRPCError({ code: "BAD_REQUEST", message: WO_NEEDS_WORK_DONE });
        const latest = at.getTime() + FUTURE_SKEW_MS;
        if ((row.startedAt && row.startedAt.getTime() > latest) || (row.finishedAt && row.finishedAt.getTime() > latest)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: WO_TIME_FUTURE });
        }
        set.workDone = work;
        set.startedAt = row.startedAt ?? row.createdAt;
        set.finishedAt = row.finishedAt ?? at;
      }
      if (input.to !== "cancelled") {
        // The times the move would leave, defaults included, must still run start then finish.
        const start = set.startedAt !== undefined ? set.startedAt : row.startedAt;
        const finish = set.finishedAt !== undefined ? set.finishedAt : row.finishedAt;
        if (start && finish && finish.getTime() < start.getTime()) throw new TRPCError({ code: "BAD_REQUEST", message: WO_FINISH_BEFORE_START });
      }
      if (input.to === "cancelled") {
        if (!input.reason) throw new TRPCError({ code: "BAD_REQUEST", message: WO_NEEDS_REASON });
        set.cancelReason = input.reason;
      }
      const resetsPlan = input.to === "done" && row.kind === "preventive" && row.planId;
      await guardedWrite(
        ctx,
        row,
        input.serverSeq,
        set,
        { action: "maint.workorder.move", meta: { from, to: input.to, ...(input.reason ? { reason: input.reason } : {}), ...(resetsPlan ? { planReset: true } : {}) } },
        (landedSql) => [
          ...(resetsPlan
            ? [
                ctx.db
                  .update(maintPlan)
                  .set({ baseAt: set.finishedAt!, lastWorkOrderId: row.id, updatedAt: at })
                  .where(and(eq(maintPlan.companyId, ctx.companyId), eq(maintPlan.id, row.planId!), landedSql)),
              ]
            : []),
          // A cancelled work order frees its reading: it shows as not handled again and can make a new one.
          ...(input.to === "cancelled" && row.readingId
            ? [
                ctx.db
                  .update(maintReading)
                  .set({ workOrderId: null })
                  .where(and(eq(maintReading.companyId, ctx.companyId), eq(maintReading.id, row.readingId), eq(maintReading.workOrderId, row.id), landedSql)),
              ]
            : []),
        ],
      );
      return { id: row.id, status: input.to };
    }),
});

// ---------------------------------------------------------------------------
// Spares (row 66)
// ---------------------------------------------------------------------------

/** In-batch guard: the work order is still not cancelled when the spare write lands (a cancel may commit first). */
function woNotCancelled(ctx: Ctx, woId: string): SQL {
  return sql`exists (select 1 from maint_work_order w where w.company_id = ${ctx.companyId} and w.id = ${woId} and w.status <> 'cancelled')`;
}

async function loadMrs(ctx: Ctx, storeTxnId: string) {
  const [txn] = await ctx.db.select().from(storeTxn).where(and(eq(storeTxn.companyId, ctx.companyId), eq(storeTxn.id, storeTxnId))).limit(1);
  if (!txn) throw notFound();
  return txn;
}

export const sparesRouter = router({
  /**
   * Store issues for maintenance not yet on a work order, last 90 days, newest first; those issued with
   * this work order's id as the reference come first.
   */
  candidates: viewProcedure.input(z.object({ workOrderId: id })).query(async ({ ctx, input }) => {
    await assertModule(ctx, "maintenance");
    const wo = await loadWo(ctx, input.workOrderId);
    const since = now().getTime() - 90 * 86_400_000;
    const rows = await ctx.db
      .select({
        storeTxnId: storeTxn.id,
        number: storeTxn.number,
        itemName: storeItem.name,
        unit: storeItem.unit,
        qtyMilli: storeTxn.qtyMilli,
        refId: storeTxn.refId,
        note: storeTxn.note,
        issuedAt: storeTxn.createdAt,
      })
      .from(storeTxn)
      .innerJoin(storeItem, and(eq(storeItem.id, storeTxn.itemId), eq(storeItem.companyId, storeTxn.companyId)))
      .where(
        and(
          eq(storeTxn.companyId, ctx.companyId),
          eq(storeTxn.kind, "mrs"),
          eq(storeTxn.purpose, "maintenance"),
          isNull(storeTxn.cancelledAt),
          sql`${storeTxn.createdAt} >= ${since}`,
          sql`not exists (select 1 from maint_wo_spare s where s.company_id = ${ctx.companyId} and s.store_txn_id = ${storeTxn.id})`,
        ),
      )
      // Issues made for this work order first IN SQL, so the limit never drops one of them.
      .orderBy(sql`(${storeTxn.refId} = ${wo.id}) desc`, desc(storeTxn.createdAt))
      .limit(100);
    return rows.map((r) => ({ ...r, issuedAt: r.issuedAt.getTime(), forThis: r.refId === wo.id }));
  }),

  link: workProcedure.input(z.object({ workOrderId: id, storeTxnId: id })).mutation(async ({ ctx, input }) => {
    await assertModule(ctx, "store");
    const wo = await loadWo(ctx, input.workOrderId);
    if (wo.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: WO_FINAL });
    const txn = await loadMrs(ctx, input.storeTxnId);
    if (txn.kind !== "mrs" || txn.purpose !== "maintenance") throw new TRPCError({ code: "BAD_REQUEST", message: SPARE_NOT_MAINTENANCE });
    if (txn.cancelledAt) throw new TRPCError({ code: "BAD_REQUEST", message: SPARE_CANCELLED });
    const [taken] = await ctx.db
      .select({ wo: maintWoSpare.workOrderId })
      .from(maintWoSpare)
      .where(and(eq(maintWoSpare.companyId, ctx.companyId), eq(maintWoSpare.storeTxnId, txn.id)))
      .limit(1);
    if (taken) {
      if (taken.wo === wo.id) return { linked: true, replayed: true };
      throw new TRPCError({ code: "CONFLICT", message: SPARE_TAKEN });
    }
    const linkId = crypto.randomUUID();
    try {
      await atomicBatch(ctx.db, [
        batchAbortUnlessOn(ctx.db, maintWoSpare, woNotCancelled(ctx, wo.id)),
        ctx.db.insert(maintWoSpare).values({ id: linkId, companyId: ctx.companyId, workOrderId: wo.id, storeTxnId: txn.id, createdBy: ctx.session.user.id }),
        auditInsertGuarded(
          ctx,
          { action: "maint.spare.link", subjectType: "maint_work_order", subjectId: wo.id, meta: { number: wo.number, storeTxnId: txn.id, mrs: txn.number, qtyMilli: txn.qtyMilli } },
          { from: maintWoSpare, where: and(eq(maintWoSpare.companyId, ctx.companyId), eq(maintWoSpare.id, linkId)) },
        ),
      ]);
    } catch (e) {
      if (isBatchAbortOn(e, "maint_wo_spare")) throw new TRPCError({ code: "BAD_REQUEST", message: WO_FINAL });
      if (/UNIQUE constraint failed: maint_wo_spare/.test(String((e as Error)?.message ?? e)) || /UNIQUE constraint failed: maint_wo_spare/.test(String((e as { cause?: Error })?.cause?.message ?? ""))) {
        throw new TRPCError({ code: "CONFLICT", message: SPARE_TAKEN });
      }
      throw e;
    }
    return { linked: true, replayed: false };
  }),

  unlink: workProcedure.input(z.object({ workOrderId: id, storeTxnId: id })).mutation(async ({ ctx, input }) => {
    const wo = await loadWo(ctx, input.workOrderId);
    if (wo.status === "cancelled") throw new TRPCError({ code: "BAD_REQUEST", message: WO_FINAL });
    const [link] = await ctx.db
      .select({ id: maintWoSpare.id, mrs: storeTxn.number })
      .from(maintWoSpare)
      .innerJoin(storeTxn, and(eq(storeTxn.id, maintWoSpare.storeTxnId), eq(storeTxn.companyId, maintWoSpare.companyId)))
      .where(and(eq(maintWoSpare.companyId, ctx.companyId), eq(maintWoSpare.workOrderId, wo.id), eq(maintWoSpare.storeTxnId, input.storeTxnId)))
      .limit(1);
    if (!link) throw new TRPCError({ code: "BAD_REQUEST", message: SPARE_NOT_LINKED });
    await atomicBatch(ctx.db, [
      batchAbortUnlessOn(ctx.db, maintWoSpare, woNotCancelled(ctx, wo.id)),
      auditInsertGuarded(
        ctx,
        { action: "maint.spare.unlink", subjectType: "maint_work_order", subjectId: wo.id, meta: { number: wo.number, storeTxnId: input.storeTxnId, mrs: link.mrs } },
        { from: maintWoSpare, where: and(eq(maintWoSpare.companyId, ctx.companyId), eq(maintWoSpare.id, link.id)) },
      ),
      ctx.db.delete(maintWoSpare).where(and(eq(maintWoSpare.companyId, ctx.companyId), eq(maintWoSpare.id, link.id))),
    ]).catch((e: unknown) => {
      if (isBatchAbortOn(e, "maint_wo_spare")) throw new TRPCError({ code: "BAD_REQUEST", message: WO_FINAL });
      throw e;
    });
    return { unlinked: true };
  }),
});
