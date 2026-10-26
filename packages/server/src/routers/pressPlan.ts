/**
 * Press plans (FP-OP-11/12/13/15/16; specs §E2 "Press plan"; ledger D6: release lands in Wave 1 so
 * the press queue has rows). Mounted as `plans`.
 *
 * draft → released (`plans.release`) | cancelled; released → closed (every run logged or voided)
 * | cancelled (every run still queued; the queued runs are voided with it).
 *
 * Release, in one batch: window ≤ 24 h; every line ≤ what is still planable for it (its own plan
 * quantity left out); the owner check on the preferred copy (an owned die with no pinned copy is
 * refused); one `queued` press run per plan die with a `PR-{n}` number, `die_instance_id` null
 * until the die room issues a copy (C7: the only insert of a queued run). Other customers' open
 * lines on the same die come back as warnings (FP-OP-15), never as a refusal.
 *
 * Writes need `order.plan` (office, manager); reads are open to members (the press reads released
 * plans). Audit: plan.create / plan.release / plan.cancel / plan.close.
 */
import { canReleasePlan, orderGrams, orderPieces, planNextOnRuns, PRESS_PLAN_MAX_WINDOW_MS, type PressRunStatus } from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { die } from "@orrn/db/schema/catalog";
import { dieInstance } from "@orrn/db/schema/dies";
import { customer } from "@orrn/db/schema/customers";
import { pressLine, pressPlan, pressPlanDie, pressPlanLine, pressPlanPurposes, pressPlanStatuses, pressRun } from "@orrn/db/schema/press";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";

import { actionProcedure, anyActionProcedure, companyProcedure, router } from "../index";
import { auditInsert } from "../lib/audit";
import { atomicBatch, chunk, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { now as clockNow } from "../lib/clock";
import { productionDayWindow } from "../lib/dayWindow";
import { allocateDocNumbers, nextDocNumber } from "../lib/docNumber";
import { assertDieAllowed, checkDieAllowed } from "../lib/dieOwner";
import { companyFloor } from "../lib/orderLines";
import { batchAbortUnless, isBatchAbort, kgText, lineBalancePage, lineBalances, type LineBalance } from "../lib/orders";
import { lineStrips, planOverPlannedSql, type LineStrip } from "../lib/orderStrip";
import { companySettings } from "../lib/press";
import { nextCompanySeq } from "../lib/sequence";
import { planPhoneView } from "../lib/planPhoneView";
import { pressDaySummary } from "../lib/pressReport";

const id = z.string().min(1).max(64);
const MAX_DIES = 30;
const MAX_LINES = 100;

const planLineInput = z.object({
  salesOrderLineId: id,
  /** Kg to press for the line; omitted = pieces (via the line's basis), else all that is planable. */
  kgG: z.number().int().min(1).max(1_000_000_000).optional(),
  pcs: z.number().int().min(1).max(10_000_000).optional(),
});

const createInput = z.object({
  /** Null / omitted = the plant's only active press line (release refuses when there are two). */
  pressLineId: id.nullable().optional(),
  /** Window as epoch ms; at most 24 h (Q-OP-11). */
  windowStart: z.number().int().positive(),
  windowEnd: z.number().int().positive(),
  note: z.string().trim().max(500).nullable().optional(),
  /**
   * FP-PR-23: production (default) presses for order lines; die_trial / sample / other need no
   * order line (and take none), never move baki, and show as their own rows on the press report.
   */
  purpose: z.enum(pressPlanPurposes).default("production"),
  dies: z
    .array(
      z.object({
        sectionId: id,
        urgent: z.boolean().optional(),
        lines: z.array(planLineInput).max(MAX_LINES).default([]),
      }),
    )
    .min(1, "Add at least one die")
    .max(MAX_DIES, `At most ${MAX_DIES} dies on a plan`),
});

const PLANABLE_STATUSES = ["confirmed", "dispatching"] as const;

function windowError(): never {
  throw new TRPCError({ code: "BAD_REQUEST", message: "The plan window must end after it starts and be at most 24 hours" });
}

async function loadPlan(db: OrrnDb, companyId: string, planId: string) {
  const [row] = await db
    .select()
    .from(pressPlan)
    .where(and(eq(pressPlan.id, planId), eq(pressPlan.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Press plan not found" });
  return row;
}

async function planParts(db: OrrnDb, companyId: string, planId: string) {
  const dies = await db
    .select({
      id: pressPlanDie.id,
      sectionId: pressPlanDie.sectionId,
      sectionCode: die.sectionCode,
      sectionName: die.name,
      sortOrder: pressPlanDie.sortOrder,
      urgent: pressPlanDie.urgent,
    })
    .from(pressPlanDie)
    .innerJoin(die, and(eq(die.id, pressPlanDie.sectionId), eq(die.companyId, companyId)))
    .where(and(eq(pressPlanDie.companyId, companyId), eq(pressPlanDie.pressPlanId, planId)))
    .orderBy(asc(pressPlanDie.sortOrder));
  const lines = await db
    .select({
      id: pressPlanLine.id,
      pressPlanDieId: pressPlanLine.pressPlanDieId,
      salesOrderLineId: pressPlanLine.salesOrderLineId,
      cutLengthMm: pressPlanLine.cutLengthMm,
      pcs: pressPlanLine.pcs,
      kgG: pressPlanLine.kgG,
      preferredDieInstanceId: pressPlanLine.preferredDieInstanceId,
      orderId: salesOrder.id,
      orderNumber: salesOrder.number,
      orderPeriod: salesOrder.period,
      poNumber: salesOrder.poNumber,
      customerId: salesOrder.customerId,
      customerName: customer.name,
      lineNo: salesOrderLine.lineNo,
    })
    .from(pressPlanLine)
    .innerJoin(salesOrderLine, and(eq(salesOrderLine.id, pressPlanLine.salesOrderLineId), eq(salesOrderLine.companyId, companyId)))
    .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, companyId)))
    .innerJoin(customer, and(eq(customer.id, salesOrder.customerId), eq(customer.companyId, companyId)))
    .where(and(eq(pressPlanLine.companyId, companyId), eq(pressPlanLine.pressPlanId, planId)))
    .orderBy(asc(salesOrder.orderDate), asc(salesOrder.number), asc(salesOrderLine.lineNo));
  const runs = await db
    .select({
      id: pressRun.id,
      number: pressRun.number,
      status: pressRun.status,
      pressPlanDieId: pressRun.pressPlanDieId,
      sectionId: pressRun.sectionId,
      pressLineId: pressRun.pressLineId,
      dieInstanceId: pressRun.dieInstanceId,
    })
    .from(pressRun)
    .where(and(eq(pressRun.companyId, companyId), eq(pressRun.planId, planId)))
    .orderBy(asc(pressRun.createdAt));
  return { dies, lines, runs };
}

/** The press line a plan runs on: its own, else the only active one. */
async function resolvePressLine(db: OrrnDb, companyId: string, pressLineId: string | null): Promise<string> {
  if (pressLineId) {
    const [row] = await db
      .select({ id: pressLine.id, status: pressLine.status })
      .from(pressLine)
      .where(and(eq(pressLine.id, pressLineId), eq(pressLine.companyId, companyId)))
      .limit(1);
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Press line not found" });
    if (row.status !== "active") throw new TRPCError({ code: "BAD_REQUEST", message: "That press line is retired" });
    return row.id;
  }
  const active = await db
    .select({ id: pressLine.id })
    .from(pressLine)
    .where(and(eq(pressLine.companyId, companyId), eq(pressLine.status, "active")))
    .limit(2);
  if (active.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Add a press line first" });
  if (active.length > 1) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the press line for this plan" });
  return active[0]!.id;
}

/** Kg / pieces of one plan line from what was typed (server-side maths, FP-OP-03). */
function planQty(
  input: z.infer<typeof planLineInput>,
  line: LineBalance & { basisMilli: number | null },
  strip: LineStrip,
  unit: "mm" | "inch",
): { kgG: number; pcs: number } {
  const basis = line.basisMilli;
  let kgG = input.kgG ?? null;
  if (kgG == null && input.pcs != null) {
    if (!basis) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Line ${line.lineNo} of ${line.orderNumber} has no kg/12ft; enter the kg` });
    }
    kgG = orderGrams(input.pcs, line.cutLengthMm, basis, unit);
  }
  if (kgG == null) kgG = strip.planableG;
  if (!(kgG > 0)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Nothing is left to plan on ${line.orderNumber} line ${line.lineNo}` });
  }
  const pcs =
    input.pcs ??
    (basis
      ? orderPieces(kgG, line.cutLengthMm, basis, unit)
      : line.orderedPcs && line.orderedG > 0
        ? Math.round((line.orderedPcs * kgG) / line.orderedG)
        : 0);
  return { kgG, pcs };
}

function overPlanable(line: LineBalance, kgG: number, strip: LineStrip): never {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `${line.orderNumber} line ${line.lineNo}: ${kgText(kgG)} kg asked, only ${kgText(strip.planableG)} kg is left to plan`,
  });
}

/** Ordered lines with their basis (kg/12ft) for a set of order line ids, keyed by id. */
async function linesById(db: OrrnDb, companyId: string, ids: readonly string[]) {
  const balances = await lineBalances(db, companyId, { lineIds: [...ids] });
  const extra = new Map<string, { basis: number | null; dieInstanceId: string | null }>();
  for (const part of chunk([...new Set(ids)], 80)) {
    const rows = await db
      .select({ id: salesOrderLine.id, basis: salesOrderLine.kgPer12ftMilli, dieInstanceId: salesOrderLine.dieInstanceId })
      .from(salesOrderLine)
      .where(and(eq(salesOrderLine.companyId, companyId), inArray(salesOrderLine.id, part)));
    for (const r of rows) extra.set(r.id, { basis: r.basis, dieInstanceId: r.dieInstanceId });
  }
  return new Map(
    balances.map((l) => [l.lineId, { ...l, basisMilli: extra.get(l.lineId)?.basis ?? null, dieInstanceId: extra.get(l.lineId)?.dieInstanceId ?? null }]),
  );
}

/** Who owns the die a line would be pressed on, and whether that keeps the line off a plan. */
export type LineOwner = { ownerCustomerId: string | null; ownerName: string | null; ownerBlocked: boolean };

/**
 * The owner gate (FP-OP-16) for order lines, read in bulk: owner = the pinned copy's owner, else the
 * section's. A line of another party is blocked unless its pinned copy has a live override for that
 * customer (`checkDieAllowed`, run only for those few lines). A section with owned copies but no
 * owner and no pin is left to release ("Pick the die copy").
 */
async function lineOwners(
  db: OrrnDb,
  companyId: string,
  lines: readonly { lineId: string; customerId: string; sectionId: string }[],
): Promise<Map<string, LineOwner>> {
  const out = new Map<string, LineOwner>();
  const rows: { id: string; pin: string | null; sectionOwner: string | null; copyOwner: string | null }[] = [];
  for (const part of chunk([...new Set(lines.map((l) => l.lineId))], 80)) {
    rows.push(
      ...(await db
        .select({
          id: salesOrderLine.id,
          pin: salesOrderLine.dieInstanceId,
          sectionOwner: die.ownerCustomerId,
          copyOwner: dieInstance.ownerCustomerId,
        })
        .from(salesOrderLine)
        .innerJoin(die, and(eq(die.id, salesOrderLine.dieId), eq(die.companyId, companyId)))
        .leftJoin(dieInstance, and(eq(dieInstance.id, salesOrderLine.dieInstanceId), eq(dieInstance.companyId, companyId)))
        .where(and(eq(salesOrderLine.companyId, companyId), inArray(salesOrderLine.id, part)))),
    );
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ownerIds = new Set<string>();
  const pending: { lineId: string; owner: string | null; blocked: boolean }[] = [];
  for (const l of lines) {
    const r = byId.get(l.lineId);
    const owner = r ? (r.pin ? (r.copyOwner ?? r.sectionOwner) : r.sectionOwner) : null;
    let blocked = false;
    if (owner && owner !== l.customerId) {
      if (r?.pin) {
        const check = await checkDieAllowed(db, companyId, { dieId: l.sectionId, dieInstanceId: r.pin, customerId: l.customerId, purpose: "plan" });
        blocked = !check.ok && check.block === "owned";
      } else {
        blocked = true;
      }
    }
    if (owner) ownerIds.add(owner);
    pending.push({ lineId: l.lineId, owner, blocked });
  }
  const names = new Map<string, string>();
  for (const part of chunk([...ownerIds], 80)) {
    // A soft-deleted customer still owns its dies (C2): no deleted_at filter.
    const cs = await db
      .select({ id: customer.id, name: customer.name })
      .from(customer)
      .where(and(eq(customer.companyId, companyId), inArray(customer.id, part)));
    for (const c of cs) names.set(c.id, c.name);
  }
  for (const p of pending) {
    out.set(p.lineId, { ownerCustomerId: p.owner, ownerName: p.owner ? (names.get(p.owner) ?? null) : null, ownerBlocked: p.blocked });
  }
  return out;
}

/** SO period per order id (an SO number repeats every FY; screens show the period beside it). */
async function orderPeriods(db: OrrnDb, companyId: string, orderIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const part of chunk([...new Set(orderIds)], 80)) {
    const rows = await db
      .select({ id: salesOrder.id, period: salesOrder.period })
      .from(salesOrder)
      .where(and(eq(salesOrder.companyId, companyId), inArray(salesOrder.id, part)));
    for (const r of rows) out.set(r.id, r.period);
  }
  return out;
}

/** Pieces in `kgG` of a line: through its basis, else in proportion to the ordered pieces. */
function piecesOf(l: LineBalance, kgG: number, unit: "mm" | "inch"): number | null {
  if (l.kgPer12ftMilli) return orderPieces(kgG, l.cutLengthMm, l.kgPer12ftMilli, unit);
  if (l.orderedPcs && l.orderedG > 0) return Math.round((l.orderedPcs * kgG) / l.orderedG);
  return null;
}

/** One open line on a die that could go on a plan (FP-OP-15, BACKLOG rank 30). */
export type OpenDieLine = LineOwner & {
  lineId: string;
  lineNo: number;
  orderId: string;
  orderNumber: string;
  orderPeriod: string;
  poNumber: string | null;
  customerId: string;
  customerName: string;
  sectionId: string;
  sectionCode: string;
  cutLengthMm: number;
  planableG: number;
  planablePcs: number | null;
};

const OPEN_DIE_LINES_LIMIT = 200;

/**
 * Open lines (confirmed / dispatching, baki left) on these dies that still have planable kg and are
 * not in `skip`, oldest order first. `more` = rows past the limit (never cut silently).
 */
async function openDieLines(
  db: OrrnDb,
  companyId: string,
  sectionIds: readonly string[],
  skip: ReadonlySet<string>,
): Promise<{ lines: OpenDieLine[]; more: boolean }> {
  if (sectionIds.length === 0) return { lines: [], more: false };
  const { lines, nextOffset } = await lineBalancePage(
    db,
    companyId,
    { dieIds: [...new Set(sectionIds)].slice(0, 80), statuses: PLANABLE_STATUSES, withBaki: true },
    { limit: OPEN_DIE_LINES_LIMIT },
  );
  const candidates = lines.filter((l) => !skip.has(l.lineId));
  const strips = await lineStrips(db, companyId, candidates.map((l) => l.lineId));
  const open = candidates.filter((l) => (strips.get(l.lineId)?.planableG ?? 0) > 0);
  const [owners, periods, floor] = await Promise.all([
    lineOwners(db, companyId, open),
    orderPeriods(db, companyId, open.map((l) => l.orderId)),
    companyFloor(db, companyId),
  ]);
  return {
    more: nextOffset !== null,
    lines: open.map((l) => {
      const planableG = strips.get(l.lineId)!.planableG;
      return {
        lineId: l.lineId,
        lineNo: l.lineNo,
        orderId: l.orderId,
        orderNumber: l.orderNumber,
        orderPeriod: periods.get(l.orderId) ?? "",
        poNumber: l.poNumber,
        customerId: l.customerId,
        customerName: l.customerName,
        sectionId: l.sectionId,
        sectionCode: l.sectionCode,
        cutLengthMm: l.cutLengthMm,
        planableG,
        planablePcs: piecesOf(l, planableG, floor.unit),
        ...(owners.get(l.lineId) ?? { ownerCustomerId: null, ownerName: null, ownerBlocked: false }),
      };
    }),
  };
}

/**
 * FP-OP-15: open lines of OTHER customers on the plan's dies that still have planable kg and are
 * not on this plan. Non-blocking (the planner may add them, or not).
 */
async function otherPartyWarnings(
  db: OrrnDb,
  companyId: string,
  plan: { sectionIds: string[]; lineIds: Set<string>; customersBySection: Map<string, Set<string>> },
) {
  const { lines } = await openDieLines(db, companyId, plan.sectionIds, plan.lineIds);
  return lines
    .filter((l) => !(plan.customersBySection.get(l.sectionId)?.has(l.customerId) ?? false))
    .map((l) => ({ kind: "other_party_open_line" as const, ...l }));
}

type QueuedRunRow = Omit<typeof pressRun.$inferInsert, "timeUnconfirmed" | "source">;

/**
 * The INSERTs of a release's queued runs (review round 1 I-3). Drizzle binds a JS-side column
 * default (`time_unconfirmed`, `source`) as a parameter when a row leaves it out, so the chunk size
 * is computed from rows that carry every bound column explicitly: 15 per row, 6 rows (90
 * parameters) per statement, under D1's 100.
 */
export function pressRunInserts(db: OrrnDb, runs: readonly QueuedRunRow[]): SqliteBatchItem[] {
  const out: SqliteBatchItem[] = [];
  pushChunkedInserts(
    out,
    (rows) => db.insert(pressRun).values(rows),
    runs.map((r) => ({ ...r, timeUnconfirmed: false, source: "typed" as const })),
  );
  return out;
}

export const pressPlanRouter = router({
  create: actionProcedure("order.plan")
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      const span = input.windowEnd - input.windowStart;
      if (!(span > 0) || span > PRESS_PLAN_MAX_WINDOW_MS) windowError();
      if (input.pressLineId) await resolvePressLine(ctx.db, ctx.companyId, input.pressLineId);
      const production = input.purpose === "production";
      for (const d of input.dies) {
        if (production && d.lines.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Add at least one order line" });
        if (!production && d.lines.length > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only a production plan takes order lines" });
        }
      }
      const sectionIds = input.dies.map((d) => d.sectionId);
      if (new Set(sectionIds).size !== sectionIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A die is on the plan twice; put its lines under one die" });
      }
      const lineIds = input.dies.flatMap((d) => d.lines.map((l) => l.salesOrderLineId));
      if (new Set(lineIds).size !== lineIds.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "An order line is on the plan twice" });
      }
      if (lineIds.length > MAX_LINES) throw new TRPCError({ code: "BAD_REQUEST", message: `At most ${MAX_LINES} order lines on a plan` });
      const lines = await linesById(ctx.db, ctx.companyId, lineIds);
      if (lines.size !== lineIds.length) throw new TRPCError({ code: "NOT_FOUND", message: "Order line not found" });
      const strips = await lineStrips(ctx.db, ctx.companyId, lineIds);
      const floor = await companyFloor(ctx.db, ctx.companyId);

      const at = clockNow();
      const userId = ctx.session.user.id;
      const planId = crypto.randomUUID();
      const dieRows: (typeof pressPlanDie.$inferInsert)[] = [];
      const lineRows: (typeof pressPlanLine.$inferInsert)[] = [];
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      for (const [i, d] of input.dies.entries()) {
        const dieId = crypto.randomUUID();
        dieRows.push({
          id: dieId,
          companyId: ctx.companyId,
          serverSeq: seq,
          pressPlanId: planId,
          sectionId: d.sectionId,
          sortOrder: i + 1,
          urgent: d.urgent ?? false,
          createdBy: userId,
          createdAt: at,
        });
        for (const pl of d.lines) {
          const line = lines.get(pl.salesOrderLineId)!;
          if (!(PLANABLE_STATUSES as readonly string[]).includes(line.orderStatus)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `${line.orderNumber} is ${line.orderStatus}; confirm it before planning` });
          }
          if (line.sectionId !== d.sectionId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `${line.orderNumber} line ${line.lineNo} is another die` });
          }
          const strip = strips.get(line.lineId)!;
          const qty = planQty(pl, line, strip, floor.unit);
          if (qty.kgG > strip.planableG) overPlanable(line, qty.kgG, strip);
          lineRows.push({
            id: crypto.randomUUID(),
            companyId: ctx.companyId,
            serverSeq: seq,
            pressPlanId: planId,
            pressPlanDieId: dieId,
            salesOrderLineId: line.lineId,
            cutLengthMm: line.cutLengthMm,
            pcs: qty.pcs,
            kgG: qty.kgG,
            preferredDieInstanceId: line.dieInstanceId,
            createdBy: userId,
            createdAt: at,
          });
        }
      }
      const { number, period } = await nextDocNumber(ctx.db, ctx.companyId, "press_plan", at, userId);
      const statements: SqliteBatchItem[] = [
        ctx.db.insert(pressPlan).values({
          id: planId,
          companyId: ctx.companyId,
          serverSeq: seq,
          number,
          period,
          status: "draft",
          purpose: input.purpose,
          pressLineId: input.pressLineId ?? null,
          windowStart: new Date(input.windowStart),
          windowEnd: new Date(input.windowEnd),
          note: input.note?.trim() || null,
          createdBy: userId,
          createdAt: at,
        }),
      ];
      pushChunkedInserts(statements, (rows) => ctx.db.insert(pressPlanDie).values(rows), dieRows);
      pushChunkedInserts(statements, (rows) => ctx.db.insert(pressPlanLine).values(rows), lineRows);
      // Write time (review round 1 I-2): another plan, a pack or a dispatch that landed after the
      // read must not leave a line planned past what is left for it.
      statements.push(batchAbortUnless(ctx.db, "sales_order_line", sql`not ${planOverPlannedSql(ctx.companyId, planId)}`));
      const orderIds = [...new Set([...lines.values()].map((l) => l.orderId))];
      statements.push(
        auditInsert(ctx, {
          action: "plan.create",
          subjectType: "press_plan",
          subjectId: planId,
          meta: { number, period, purpose: input.purpose, dies: dieRows.length, lines: lineRows.length, kgG: lineRows.reduce((s, r) => s + r.kgG, 0), orderIds },
        }),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isBatchAbort(e, "sales_order_line")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "An order line on this plan was planned, packed or dispatched meanwhile. Reload and try again.",
          });
        }
        throw e;
      }
      return { id: planId, number, period, status: "draft" as const };
    }),

  release: actionProcedure("order.plan")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const plan = await loadPlan(ctx.db, ctx.companyId, input.id);
      const parts = await planParts(ctx.db, ctx.companyId, plan.id);
      const ok = canReleasePlan({
        status: plan.status,
        windowStartMs: plan.windowStart.getTime(),
        windowEndMs: plan.windowEnd.getTime(),
        dieCount: parts.dies.length,
        // FP-PR-23: a trial / sample plan has dies and no order lines.
        lineCount: plan.purpose === "production" ? parts.lines.length : parts.dies.length,
      });
      if (!ok.ok) {
        if (ok.refusal === "window") windowError();
        if (ok.refusal === "empty") throw new TRPCError({ code: "BAD_REQUEST", message: "Add at least one die and order line" });
        throw new TRPCError({ code: "BAD_REQUEST", message: `Only a draft plan can be released (this plan is ${plan.status})` });
      }
      const pressLineId = await resolvePressLine(ctx.db, ctx.companyId, plan.pressLineId);

      // Each line ≤ planable with this plan's own quantity left out (OP §4).
      const lineIds = parts.lines.map((l) => l.salesOrderLineId);
      const strips = await lineStrips(ctx.db, ctx.companyId, lineIds, { excludePlanId: plan.id });
      const balances = await linesById(ctx.db, ctx.companyId, lineIds);
      const asked = new Map<string, number>();
      for (const l of parts.lines) asked.set(l.salesOrderLineId, (asked.get(l.salesOrderLineId) ?? 0) + l.kgG);
      for (const [lineId, kgG] of asked) {
        const strip = strips.get(lineId)!;
        const line = balances.get(lineId)!;
        if (!(PLANABLE_STATUSES as readonly string[]).includes(line.orderStatus)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${line.orderNumber} is ${line.orderStatus}; it can't go to the press` });
        }
        if (kgG > strip.planableG) overPlanable(line, kgG, strip);
      }

      // Owner check on the preferred copy (FP-OP-16, C34): an owned die needs the owner's order or a
      // live override; an owned section with no pinned copy is refused ("Pick the die copy").
      const sectionOf = new Map(parts.dies.map((d) => [d.id, d.sectionId]));
      for (const l of parts.lines) {
        await assertDieAllowed(ctx.db, ctx.companyId, {
          dieId: sectionOf.get(l.pressPlanDieId)!,
          dieInstanceId: l.preferredDieInstanceId,
          customerId: l.customerId,
          purpose: "plan",
        });
      }

      const customersBySection = new Map<string, Set<string>>();
      for (const l of parts.lines) {
        const s = sectionOf.get(l.pressPlanDieId)!;
        const set = customersBySection.get(s) ?? new Set<string>();
        set.add(l.customerId);
        customersBySection.set(s, set);
      }
      const warnings = plan.purpose !== "production" ? [] : await otherPartyWarnings(ctx.db, ctx.companyId, {
        sectionIds: parts.dies.map((d) => d.sectionId),
        lineIds: new Set(lineIds),
        customersBySection,
      });

      const at = clockNow();
      const userId = ctx.session.user.id;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const block = await allocateDocNumbers(ctx.db, ctx.companyId, "press_run", at, parts.dies.length, userId);
      const runs = parts.dies.map((d, i) => ({
        id: crypto.randomUUID(),
        companyId: ctx.companyId,
        serverSeq: seq,
        number: block.numbers[i]!,
        period: block.period,
        status: "queued" as const,
        planId: plan.id,
        pressPlanDieId: d.id,
        pressLineId,
        sectionId: d.sectionId,
        dieInstanceId: null,
        createdBy: userId,
        createdAt: at,
      }));
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(pressPlan)
          .set({ status: "released", releasedAt: at, releasedBy: userId, pressLineId, serverSeq: seq, updatedAt: at })
          .where(
            and(
              eq(pressPlan.id, plan.id),
              eq(pressPlan.companyId, ctx.companyId),
              eq(pressPlan.status, "draft"),
              eq(pressPlan.serverSeq, plan.serverSeq),
            ),
          ),
        batchAbortUnless(
          ctx.db,
          "sales_order_line",
          sql`exists (select 1 from press_plan p where p.id = ${plan.id} and p.company_id = ${ctx.companyId} and p.status = 'released' and p.server_seq = ${seq})`,
        ),
      ];
      statements.push(...pressRunInserts(ctx.db, runs));
      // Write time (I-2): every line of the plan still fits now that it counts as planned.
      statements.push(batchAbortUnless(ctx.db, "sales_order_line", sql`not ${planOverPlannedSql(ctx.companyId, plan.id)}`));
      statements.push(
        auditInsert(ctx, {
          action: "plan.release",
          subjectType: "press_plan",
          subjectId: plan.id,
          meta: {
            number: plan.number,
            runs: runs.map((r) => r.number),
            pressLineId,
            orderIds: [...new Set(parts.lines.map((l) => l.orderId))],
            warnings: warnings.length,
          },
        }),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isBatchAbort(e, "sales_order_line")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This plan, or an order line on it (planned, packed or dispatched), changed meanwhile. Reload and try again.",
          });
        }
        throw e;
      }
      return {
        id: plan.id,
        status: "released" as const,
        runs: runs.map((r) => ({ id: r.id, number: r.number, sectionId: r.sectionId, pressPlanDieId: r.pressPlanDieId })),
        warnings,
      };
    }),

  cancel: actionProcedure("order.plan")
    .input(z.object({ id, reason: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const plan = await loadPlan(ctx.db, ctx.companyId, input.id);
      const parts = await planParts(ctx.db, ctx.companyId, plan.id);
      const next = planNextOnRuns(plan.status, parts.runs.map((r) => r.status as PressRunStatus), "cancel");
      if (!next.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            next.refusal === "runs_started"
              ? "A run of this plan has its die issued or has started; it can't be cancelled"
              : `A ${plan.status} plan can't be cancelled`,
        });
      }
      const at = clockNow();
      const userId = ctx.session.user.id;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(pressPlan)
          .set({ status: "cancelled", cancelledAt: at, cancelledBy: userId, serverSeq: seq, updatedAt: at })
          .where(and(eq(pressPlan.id, plan.id), eq(pressPlan.companyId, ctx.companyId), eq(pressPlan.status, plan.status))),
        batchAbortUnless(
          ctx.db,
          "sales_order_line",
          sql`exists (select 1 from press_plan p where p.id = ${plan.id} and p.company_id = ${ctx.companyId} and p.status = 'cancelled' and p.server_seq = ${seq})`,
        ),
        // Its queued runs go with it; a run issued meanwhile fails the whole cancel.
        ctx.db
          .update(pressRun)
          .set({ status: "voided", voidedAt: at, voidNote: "Plan cancelled", serverSeq: seq, updatedAt: at })
          .where(and(eq(pressRun.companyId, ctx.companyId), eq(pressRun.planId, plan.id), eq(pressRun.status, "queued"))),
        batchAbortUnless(
          ctx.db,
          "sales_order_line",
          sql`not exists (select 1 from press_run r where r.company_id = ${ctx.companyId} and r.plan_id = ${plan.id} and r.status <> 'voided')`,
        ),
        auditInsert(ctx, {
          action: "plan.cancel",
          subjectType: "press_plan",
          subjectId: plan.id,
          meta: {
            number: plan.number,
            from: plan.status,
            reason: input.reason?.trim() || null,
            orderIds: [...new Set(parts.lines.map((l) => l.orderId))],
          },
        }),
      ];
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isBatchAbort(e, "sales_order_line")) {
          throw new TRPCError({ code: "CONFLICT", message: "A run of this plan moved meanwhile. Reload and try again." });
        }
        throw e;
      }
      return { id: plan.id, status: "cancelled" as const };
    }),

  close: actionProcedure("order.plan")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const plan = await loadPlan(ctx.db, ctx.companyId, input.id);
      const parts = await planParts(ctx.db, ctx.companyId, plan.id);
      const next = planNextOnRuns(plan.status, parts.runs.map((r) => r.status as PressRunStatus), "close");
      if (!next.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: next.refusal === "runs_open" ? "Some runs of this plan are not logged or voided yet" : `A ${plan.status} plan can't be closed`,
        });
      }
      const at = clockNow();
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db
            .update(pressPlan)
            .set({ status: "closed", closedAt: at, serverSeq: seq, updatedAt: at })
            .where(
              and(
                eq(pressPlan.id, plan.id),
                eq(pressPlan.companyId, ctx.companyId),
                eq(pressPlan.status, "released"),
                sql`not exists (select 1 from press_run r where r.company_id = ${ctx.companyId} and r.plan_id = ${plan.id} and r.status not in ('logged', 'voided'))`,
              ),
            ),
          batchAbortUnless(
            ctx.db,
            "sales_order_line",
            sql`exists (select 1 from press_plan p where p.id = ${plan.id} and p.company_id = ${ctx.companyId} and p.status = 'closed' and p.server_seq = ${seq})`,
          ),
          auditInsert(ctx, {
            action: "plan.close",
            subjectType: "press_plan",
            subjectId: plan.id,
            meta: { number: plan.number, orderIds: [...new Set(parts.lines.map((l) => l.orderId))] },
          }),
        ]);
      } catch (e) {
        if (isBatchAbort(e, "sales_order_line")) {
          throw new TRPCError({ code: "CONFLICT", message: "A run of this plan moved meanwhile. Reload and try again." });
        }
        throw e;
      }
      return { id: plan.id, status: "closed" as const };
    }),

  /**
   * Add / remove order lines on a DRAFT plan (FP-OP-15 "add in one tap", BACKLOG rank 30). Added
   * lines go under their own die (a new plan die at the end when the plan has none); a die left
   * with no line goes too. Each added line ≤ its planable kg; the owner gate refuses another
   * party's line on an owned die ("This die belongs to {name}"). Refused once the plan is released.
   * `serverSeq` (from `plans.get`) refuses a save over a newer version. One batch, audited
   * `plan.update`; the plan's lines are checked against planable again at write time.
   */
  update: actionProcedure("order.plan")
    .input(
      z.object({
        id,
        serverSeq: z.number().int().optional(),
        add: z.array(planLineInput).max(MAX_LINES).default([]),
        /** Order line ids (`salesOrderLineId`) to take off the plan. */
        remove: z.array(id).max(MAX_LINES).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const plan = await loadPlan(ctx.db, ctx.companyId, input.id);
      if (plan.status !== "draft") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Only a draft plan can change (this plan is ${plan.status})` });
      }
      if (input.serverSeq !== undefined && input.serverSeq !== plan.serverSeq) {
        throw new TRPCError({ code: "CONFLICT", message: "This plan changed meanwhile. Reload and try again." });
      }
      if (input.add.length === 0 && input.remove.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to change" });
      }
      // FP-PR-23 (BACKLOG 41): only a production plan carries order lines (die trial, sample, other: dies only).
      if (plan.purpose !== "production" && input.add.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Only a production plan takes order lines" });
      }
      const parts = await planParts(ctx.db, ctx.companyId, plan.id);
      const onPlan = new Set(parts.lines.map((l) => l.salesOrderLineId));
      const addIds = input.add.map((a) => a.salesOrderLineId);
      if (new Set(addIds).size !== addIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "An order line is on the plan twice" });
      const removeIds = [...new Set(input.remove)];
      for (const r of removeIds) {
        if (!onPlan.has(r)) throw new TRPCError({ code: "BAD_REQUEST", message: "That order line is not on this plan" });
      }

      const lines = await linesById(ctx.db, ctx.companyId, addIds);
      if (lines.size !== addIds.length) throw new TRPCError({ code: "NOT_FOUND", message: "Order line not found" });
      for (const a of input.add) {
        const line = lines.get(a.salesOrderLineId)!;
        if (onPlan.has(line.lineId) && !removeIds.includes(line.lineId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${line.orderNumber} line ${line.lineNo} is already on this plan` });
        }
        if (!(PLANABLE_STATUSES as readonly string[]).includes(line.orderStatus)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${line.orderNumber} is ${line.orderStatus}; confirm it before planning` });
        }
      }
      const keptLines = parts.lines.filter((l) => !removeIds.includes(l.salesOrderLineId));
      if (keptLines.length + input.add.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A plan needs at least one order line; cancel the plan instead" });
      }
      if (keptLines.length + input.add.length > MAX_LINES) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `At most ${MAX_LINES} order lines on a plan` });
      }

      // Owner gate (FP-OP-16) on every added line, before any maths.
      const owners = await lineOwners(ctx.db, ctx.companyId, [...lines.values()]);
      for (const line of lines.values()) {
        const o = owners.get(line.lineId);
        if (o?.ownerBlocked) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: o.ownerName ? `This die belongs to ${o.ownerName}` : "This die belongs to another customer",
          });
        }
      }

      const strips = await lineStrips(ctx.db, ctx.companyId, addIds);
      const floor = await companyFloor(ctx.db, ctx.companyId);
      const at = clockNow();
      const userId = ctx.session.user.id;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);

      // Dies: those that keep a line, plus new ones for added lines on other dies.
      const keptDieIds = new Set(keptLines.map((l) => l.pressPlanDieId));
      const dieBySection = new Map(parts.dies.filter((d) => keptDieIds.has(d.id)).map((d) => [d.sectionId, d.id]));
      const droppedDies = parts.dies.filter((d) => !keptDieIds.has(d.id));
      let sort = parts.dies.reduce((m, d) => Math.max(m, d.sortOrder), 0);
      const dieRows: (typeof pressPlanDie.$inferInsert)[] = [];
      const lineRows: (typeof pressPlanLine.$inferInsert)[] = [];
      for (const a of input.add) {
        const line = lines.get(a.salesOrderLineId)!;
        let dieId = dieBySection.get(line.sectionId);
        if (!dieId) {
          // A dropped die of the same section is deleted first in the batch, so a new row is fine.
          dieId = crypto.randomUUID();
          sort += 1;
          dieBySection.set(line.sectionId, dieId);
          dieRows.push({
            id: dieId,
            companyId: ctx.companyId,
            serverSeq: seq,
            pressPlanId: plan.id,
            sectionId: line.sectionId,
            sortOrder: sort,
            urgent: false,
            createdBy: userId,
            createdAt: at,
          });
        }
        const strip = strips.get(line.lineId)!;
        const qty = planQty(a, line, strip, floor.unit);
        if (qty.kgG > strip.planableG) overPlanable(line, qty.kgG, strip);
        lineRows.push({
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          serverSeq: seq,
          pressPlanId: plan.id,
          pressPlanDieId: dieId,
          salesOrderLineId: line.lineId,
          cutLengthMm: line.cutLengthMm,
          pcs: qty.pcs,
          kgG: qty.kgG,
          preferredDieInstanceId: line.dieInstanceId,
          createdBy: userId,
          createdAt: at,
        });
      }
      if (dieBySection.size > MAX_DIES) throw new TRPCError({ code: "BAD_REQUEST", message: `At most ${MAX_DIES} dies on a plan` });

      const statements: SqliteBatchItem[] = [
        ctx.db
          .update(pressPlan)
          .set({ serverSeq: seq, updatedAt: at })
          .where(
            and(
              eq(pressPlan.id, plan.id),
              eq(pressPlan.companyId, ctx.companyId),
              eq(pressPlan.status, "draft"),
              eq(pressPlan.serverSeq, plan.serverSeq),
            ),
          ),
        batchAbortUnless(
          ctx.db,
          "sales_order_line",
          sql`exists (select 1 from press_plan p where p.id = ${plan.id} and p.company_id = ${ctx.companyId} and p.status = 'draft' and p.server_seq = ${seq})`,
        ),
      ];
      for (const part of chunk(removeIds, 80)) {
        statements.push(
          ctx.db
            .delete(pressPlanLine)
            .where(
              and(
                eq(pressPlanLine.companyId, ctx.companyId),
                eq(pressPlanLine.pressPlanId, plan.id),
                inArray(pressPlanLine.salesOrderLineId, part),
              ),
            ),
        );
      }
      for (const part of chunk(droppedDies.map((d) => d.id), 80)) {
        statements.push(
          ctx.db
            .delete(pressPlanDie)
            .where(and(eq(pressPlanDie.companyId, ctx.companyId), eq(pressPlanDie.pressPlanId, plan.id), inArray(pressPlanDie.id, part))),
        );
      }
      pushChunkedInserts(statements, (rows) => ctx.db.insert(pressPlanDie).values(rows), dieRows);
      pushChunkedInserts(statements, (rows) => ctx.db.insert(pressPlanLine).values(rows), lineRows);
      if (lineRows.length > 0) {
        statements.push(batchAbortUnless(ctx.db, "sales_order_line", sql`not ${planOverPlannedSql(ctx.companyId, plan.id)}`));
      }
      statements.push(
        auditInsert(ctx, {
          action: "plan.update",
          subjectType: "press_plan",
          subjectId: plan.id,
          meta: {
            number: plan.number,
            added: [...addIds].sort(),
            removed: [...removeIds].sort(),
            kgG: lineRows.reduce((s, r) => s + r.kgG, 0),
            orderIds: [...new Set([...[...lines.values()].map((l) => l.orderId), ...parts.lines.filter((l) => removeIds.includes(l.salesOrderLineId)).map((l) => l.orderId)])],
          },
        }),
      );
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isBatchAbort(e, "sales_order_line")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This plan, or an order line on it (planned, packed or dispatched), changed meanwhile. Reload and try again.",
          });
        }
        throw e;
      }
      return { id: plan.id, status: "draft" as const, added: lineRows.length, removed: removeIds.length };
    }),

  /**
   * FP-OP-21 (W4-NEXTROWS): the press plan and the day's press summary on the owner's phone,
   * read-only. Released plans (or one `planId`) with per-die lengths, planned vs pressed pcs/kg and
   * a run-state chip; the summary is FP-PR-18's. No rates, no 17-column grid.
   */
  phone: anyActionProcedure("reports.read", "order.plan")
    .input(z.object({ planId: id.optional(), productionDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const nowMs = clockNow().getTime();
      const day = input.productionDay ?? productionDayWindow(await companySettings(ctx.db, ctx.companyId), nowMs).productionDay;
      const [plans, summary] = await Promise.all([
        planPhoneView(ctx.db, ctx.companyId, { ...(input.planId ? { planId: input.planId } : {}), nowMs }),
        pressDaySummary(ctx.db, ctx.companyId, day, nowMs),
      ]);
      return {
        plans,
        summary: {
          productionDay: summary.productionDay,
          runs: summary.runs,
          kgG: summary.kgG,
          pcs: summary.pcs,
          recoveryBp: summary.recoveryBp,
          downtimeMin: summary.downtimeMin,
          lateRuns: summary.lateRuns,
          byLine: summary.byLine.map((l) => ({ pressLineId: l.pressLineId, code: l.code, name: l.name, runs: l.runs, kgG: l.kgG, pcs: l.pcs, recoveryBp: l.recoveryBp, downtimeMin: l.downtimeMin })),
          byShift: summary.byShift.map((s) => ({ shiftSeq: s.shiftSeq, shiftName: s.shiftName, runs: s.runs, kgG: s.kgG, recoveryBp: s.recoveryBp })),
          downtimeByReason: summary.downtimeByReason,
        },
      };
    }),

  /** Active press lines, for the plan's press pick (a plant with two needs one before release). */
  /**
   * The plan form's default window (BACKLOG 51): the current production day in the company's time
   * zone (shift 1's start to the next, or midnight with no shifts; specs §E7), on the server's
   * clock. The form never takes the browser's clock or zone.
   */
  defaultWindow: companyProcedure.query(async ({ ctx }) => {
    const w = productionDayWindow(await companySettings(ctx.db, ctx.companyId), clockNow().getTime());
    return { productionDay: w.productionDay, startMs: w.startMs, endMs: w.endMs, timezone: w.timezone };
  }),

  pressLines: companyProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({ id: pressLine.id, code: pressLine.code, name: pressLine.name })
      .from(pressLine)
      .where(and(eq(pressLine.companyId, ctx.companyId), eq(pressLine.status, "active")))
      .orderBy(asc(pressLine.code))
      .limit(50);
  }),

  /**
   * Every other open line on these dies (FP-OP-15, BACKLOG rank 30): confirmed / dispatching lines
   * with planable kg, with party, SO number and period, PO, cut length, planable kg and pieces and
   * the owner gate (`ownerBlocked` + `ownerName`: an owned die keeps another party's line off the
   * plan). `planId` leaves that plan's lines out; `excludeLineIds` leaves out a client draft's.
   */
  openLinesForDies: companyProcedure
    .input(
      z.object({
        dieIds: z.array(id).min(1).max(80),
        planId: id.optional(),
        excludeLineIds: z.array(id).max(MAX_LINES).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const skip = new Set(input.excludeLineIds ?? []);
      if (input.planId) {
        const plan = await loadPlan(ctx.db, ctx.companyId, input.planId);
        const rows = await ctx.db
          .select({ lineId: pressPlanLine.salesOrderLineId })
          .from(pressPlanLine)
          .where(and(eq(pressPlanLine.companyId, ctx.companyId), eq(pressPlanLine.pressPlanId, plan.id)));
        for (const r of rows) skip.add(r.lineId);
      }
      return openDieLines(ctx.db, ctx.companyId, input.dieIds, skip);
    }),

  get: companyProcedure.input(z.object({ id })).query(async ({ ctx, input }) => {
    const plan = await loadPlan(ctx.db, ctx.companyId, input.id);
    const parts = await planParts(ctx.db, ctx.companyId, plan.id);
    return { plan, ...parts };
  }),

  list: companyProcedure
    .input(
      z.object({
        status: z.enum(pressPlanStatuses).optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(eq(pressPlan.companyId, ctx.companyId), input.status ? eq(pressPlan.status, input.status) : undefined);
      const rows = await ctx.db
        .select({
          id: pressPlan.id,
          number: pressPlan.number,
          period: pressPlan.period,
          status: pressPlan.status,
          purpose: pressPlan.purpose,
          pressLineId: pressPlan.pressLineId,
          windowStart: pressPlan.windowStart,
          windowEnd: pressPlan.windowEnd,
          releasedAt: pressPlan.releasedAt,
          createdAt: pressPlan.createdAt,
          // The outer plan's columns written out (review I-3): drizzle prints `${pressPlan.id}` bare in a
          // single-table select, and a bare "id" inside the subquery binds to the inner table.
          dies: sql<number>`(select count(*) from press_plan_die d where d.company_id = "press_plan"."company_id" and d.press_plan_id = "press_plan"."id")`,
          kgG: sql<number>`(select coalesce(sum(l.kg_g), 0) from press_plan_line l where l.company_id = "press_plan"."company_id" and l.press_plan_id = "press_plan"."id")`,
        })
        .from(pressPlan)
        .where(where)
        .orderBy(desc(pressPlan.windowStart), desc(pressPlan.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      const [total] = await ctx.db.select({ n: count() }).from(pressPlan).where(where);
      const n = total?.n ?? 0;
      const next = input.offset + rows.length;
      return { items: rows.map((r) => ({ ...r, dies: Number(r.dies), kgG: Number(r.kgG) })), total: n, nextOffset: next < n ? next : null };
    }),

  /**
   * What can go on a plan (FP-OP-11): open lines (confirmed / dispatching) with planable kg,
   * grouped by die, oldest order first. `sectionIds` narrows to some dies.
   */
  candidates: companyProcedure
    .input(z.object({ sectionIds: z.array(id).max(80).optional(), limit: z.number().int().min(1).max(500).default(300) }))
    .query(async ({ ctx, input }) => {
      const { lines, nextOffset } = await lineBalancePage(
        ctx.db,
        ctx.companyId,
        { statuses: PLANABLE_STATUSES, withBaki: true, ...(input.sectionIds ? { dieIds: input.sectionIds } : {}) },
        { limit: input.limit },
      );
      const strips = await lineStrips(ctx.db, ctx.companyId, lines.map((l) => l.lineId));
      const groups = new Map<string, { sectionId: string; sectionCode: string; planableG: number; lines: (LineBalance & { strip: LineStrip })[] }>();
      for (const l of lines) {
        const strip = strips.get(l.lineId)!;
        if (strip.planableG <= 0) continue;
        const g = groups.get(l.sectionId) ?? { sectionId: l.sectionId, sectionCode: l.sectionCode, planableG: 0, lines: [] };
        g.planableG += strip.planableG;
        g.lines.push({ ...l, strip });
        groups.set(l.sectionId, g);
      }
      return { dies: [...groups.values()], more: nextOffset !== null };
    }),
});
