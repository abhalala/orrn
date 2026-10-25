/**
 * Orders and planning, Wave 1 server (FP-OP-01…10, 18; specs §E2). These procedures are mounted on
 * the `orders` router beside the PL-8 ones (`salesOrder.ts` spreads `orderFlowProcedures`), so the
 * screens call `orders.confirm`, `orders.reallocate`, … Every number is computed here.
 *
 * Permissions: confirm / close / cancel / repriceWeight / hold / release need `order.manage`;
 * reallocate needs `order.reallocate`; reads are open to members (no prices in them, ruling PL8-R1).
 * Audit: order.confirm / order.close / order.cancel / order.weight.refresh / order.reallocate /
 * order.hold / order.release (FP-OP-17, `lib/orderHold.ts`).
 */
import { confirmBlockers, holdCheck, MAX_HOLD_BUNDLES, MAX_REALLOCATE_BUNDLES, reallocationCheck } from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, asc, count, desc, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { approval } from "@orrn/db/schema/approval";
import { auditLog } from "@orrn/db/schema/audit";
import { user } from "@orrn/db/schema/auth";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dispatch } from "@orrn/db/schema/dispatch";
import { bundle } from "@orrn/db/schema/inventory";
import { reasonCode } from "@orrn/db/schema/reasons";
import { bundleTransfer, openSalesOrderStatuses, salesOrder, salesOrderLine, salesOrderWeightBases } from "@orrn/db/schema/sales";

import { actionProcedure, companyProcedure, router } from "../index";
import { requestApprovalInsert } from "../lib/approval";
import { auditInsert } from "../lib/audit";
import { atomicBatch, chunk, mapInChunks, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
import { now as clockNow } from "../lib/clock";
import { zonedYmd } from "../lib/dayWindow";
import { assertDieAllowed } from "../lib/dieOwner";
import {
  chooseBasis,
  companyFloor,
  lineQty,
  loadSection,
  resolveLines,
  sectionCopies,
} from "../lib/orderLines";
import { batchAbortUnless, isBatchAbort, kgText, lineBalancePage, lineTotals } from "../lib/orders";
import { holdsOf, releaseOrderHoldsStatements } from "../lib/orderHold";
import { daysBetween, LATE_AFTER_DAYS, lineStrips, suggestedLine, ymdMinusDays } from "../lib/orderStrip";
import {
  bundlesPendingReallocation,
  isPlantStockSql,
  plantOriginCustomerSql,
  moveStatements,
  pendingReallocationOf,
  type ReallocateMeta,
  type TransferRow,
} from "../lib/reallocate";
import { ensureDefaultReasonCodes } from "../lib/reasonCodes";
import { nextCompanySeq } from "../lib/sequence";

const id = z.string().min(1).max(64);
const text = (max: number) => z.string().trim().max(max);
const blank = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v.trim());

// ---------------------------------------------------------------------------
// PO uniqueness (FP-OP-01): per company + customer + PO among orders that are not cancelled.
// ---------------------------------------------------------------------------

export async function assertPoFree(
  db: OrrnDb,
  companyId: string,
  input: { customerId: string; poNumber: string; exceptOrderId?: string },
): Promise<void> {
  const [row] = await db
    .select({ number: salesOrder.number })
    .from(salesOrder)
    .where(
      and(
        eq(salesOrder.companyId, companyId),
        eq(salesOrder.customerId, input.customerId),
        sql`lower(${salesOrder.poNumber}) = lower(${input.poNumber})`,
        sql`${salesOrder.status} <> 'cancelled'`,
        input.exceptOrderId ? sql`${salesOrder.id} <> ${input.exceptOrderId}` : undefined,
      ),
    )
    .limit(1);
  if (row) {
    throw new TRPCError({ code: "CONFLICT", message: `PO ${input.poNumber} is already on ${row.number} for this customer` });
  }
}

/** Write-time twin of `assertPoFree`: fails the batch when two live orders end up with this PO. */
export function poRepeatGuard(db: OrrnDb, companyId: string, input: { customerId: string; poNumber: string }): SqliteBatchItem {
  return batchAbortUnless(
    db,
    "sales_order_line",
    sql`(select count(*) from sales_order o where o.company_id = ${companyId} and o.customer_id = ${input.customerId} and lower(o.po_number) = lower(${input.poNumber}) and o.status <> 'cancelled') <= 1`,
  );
}

async function loadOrder(db: OrrnDb, companyId: string, orderId: string) {
  const [row] = await db
    .select()
    .from(salesOrder)
    .where(and(eq(salesOrder.id, orderId), eq(salesOrder.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
  return row;
}

async function orderLines(db: OrrnDb, companyId: string, orderId: string) {
  return db
    .select()
    .from(salesOrderLine)
    .where(and(eq(salesOrderLine.companyId, companyId), eq(salesOrderLine.salesOrderId, orderId)))
    .orderBy(asc(salesOrderLine.lineNo));
}

/** What still blocks confirming this order (`@orrn/domain` confirmBlockers; codes the screen words). */
export async function orderConfirmBlockers(db: OrrnDb, companyId: string, order: { id: string; poNumber: string | null }) {
  const floor = await companyFloor(db, companyId);
  const lines = await orderLines(db, companyId, order.id);
  return confirmBlockers({
    poNumber: order.poNumber,
    dieRequired: floor.floor.dieRequiredOnSalesOrder,
    lines: lines.map((l) => ({
      pcs: l.pcs,
      kgG: l.kgG,
      cutLengthMm: l.cutLengthMm,
      alloy: l.alloy,
      temper: l.temper,
      dieInstanceId: l.dieInstanceId,
      tierRank: l.tierRank,
    })),
  });
}

/** The order row landed at this request's seq (abort guard for status moves). */
const orderLanded = (companyId: string, orderId: string, seq: number) =>
  sql`exists (select 1 from sales_order o where o.id = ${orderId} and o.company_id = ${companyId} and o.server_seq = ${seq})`;

function conflict(): never {
  throw new TRPCError({ code: "CONFLICT", message: "This order changed meanwhile. Reload and try again." });
}

/** EXISTS: something has started against the order's lines (packed, planned, pressed, dispatched). */
function orderHasWork(companyId: string, orderId: string): SQL {
  const lines = sql`(select l.id from sales_order_line l where l.company_id = ${companyId} and l.sales_order_id = ${orderId})`;
  return sql`(exists (select 1 from bundle b where b.company_id = ${companyId} and b.status <> 'void' and b.sales_order_line_id in ${lines})
    or exists (select 1 from press_plan_line pl join press_plan p on p.id = pl.press_plan_id and p.company_id = pl.company_id where pl.company_id = ${companyId} and p.status <> 'cancelled' and pl.sales_order_line_id in ${lines})
    or exists (select 1 from dispatch_item di join dispatch d on d.id = di.dispatch_id and d.company_id = di.company_id where di.company_id = ${companyId} and d.deleted_at is null and d.status <> 'cancelled' and di.sales_order_line_id in ${lines}))`;
}

const holdInput = z.object({
  /** The open line the bundles are held for. */
  lineId: id,
  bundleIds: z
    .array(id)
    .min(1, "Pick at least one bundle")
    .max(MAX_HOLD_BUNDLES, `At most ${MAX_HOLD_BUNDLES} bundles at a time`),
  note: text(500).optional(),
});

const releaseInput = z.object({
  lineId: id,
  /** These held bundles only; omitted = every bundle held for the line. */
  bundleIds: z.array(id).min(1).max(MAX_HOLD_BUNDLES, `At most ${MAX_HOLD_BUNDLES} bundles at a time`).optional(),
  note: text(500).optional(),
});

/** The line with its order and customer (company scoped), or NOT_FOUND. */
async function loadLineWithOrder(db: OrrnDb, companyId: string, lineId: string) {
  const [row] = await db
    .select({
      lineId: salesOrderLine.id,
      lineNo: salesOrderLine.lineNo,
      dieId: salesOrderLine.dieId,
      cutLengthMm: salesOrderLine.cutLengthMm,
      orderId: salesOrder.id,
      orderNumber: salesOrder.number,
      status: salesOrder.status,
      customerId: salesOrder.customerId,
      customerName: customer.name,
    })
    .from(salesOrderLine)
    .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, companyId)))
    .innerJoin(customer, and(eq(customer.id, salesOrder.customerId), eq(customer.companyId, companyId)))
    .where(and(eq(salesOrderLine.id, lineId), eq(salesOrderLine.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Order line not found" });
  return row;
}

/** SQL list of bound ids, for `in (…)` inside raw guards. */
const idList = (ids: readonly string[]) => sql.join(ids.map((x) => sql`${x}`), sql`, `);

const reallocateInput = z.object({
  bundleIds: z
    .array(id)
    .min(1, "Pick at least one bundle")
    .max(MAX_REALLOCATE_BUNDLES, `At most ${MAX_REALLOCATE_BUNDLES} bundles at a time`),
  /** The target order line; null = plant stock. */
  toLineId: id.nullable(),
  /** Why (free text); required unless a reason code is picked. */
  reason: text(500).optional(),
  /** `reason_code.code` of kind `reallocate`; required when the cut length differs. */
  reasonCode: text(40).optional(),
  /**
   * The approved `die_owner_override` that lets an owned die's bundles go to this customer (C47:
   * the move then needs both that override and the `order_reallocate` approval). Re-checked when
   * the reallocation is decided: an override closed meanwhile moves nothing.
   */
  dieOwnerApprovalId: id.optional(),
});

export const orderFlowProcedures = {
  /**
   * booking → confirmed (OP §6): PO, ≥ 1 line, each line pcs, kg, length, alloy, temper and (when
   * `dieRequiredOnSalesOrder`) a copy or tier; the PO not on another live order of the customer;
   * a pinned copy passes the owner check (purpose `plan`).
   */
  confirm: actionProcedure("order.manage")
    .input(z.object({ id, serverSeq: z.number().int().nonnegative().optional() }))
    .mutation(async ({ ctx, input }) => {
      const order = await loadOrder(ctx.db, ctx.companyId, input.id);
      if (order.status !== "booking") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Only a booking can be confirmed (this order is ${order.status})` });
      }
      if (input.serverSeq !== undefined && input.serverSeq !== order.serverSeq) conflict();
      const blockers = await orderConfirmBlockers(ctx.db, ctx.companyId, order);
      if (blockers.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Fill these before confirming: ${blockers.join(", ")}` });
      }
      await assertPoFree(ctx.db, ctx.companyId, { customerId: order.customerId, poNumber: order.poNumber!, exceptOrderId: order.id });
      const lines = await orderLines(ctx.db, ctx.companyId, order.id);
      for (const l of lines) {
        if (l.dieInstanceId) {
          await assertDieAllowed(ctx.db, ctx.companyId, {
            dieId: l.dieId,
            dieInstanceId: l.dieInstanceId,
            customerId: order.customerId,
            purpose: "plan",
          });
        }
      }
      const at = clockNow();
      const userId = ctx.session.user.id;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db
            .update(salesOrder)
            .set({
              status: "confirmed",
              confirmedAt: at,
              confirmedBy: userId,
              statusChangedAt: at,
              statusChangedBy: userId,
              serverSeq: seq,
            })
            .where(
              and(
                eq(salesOrder.id, order.id),
                eq(salesOrder.companyId, ctx.companyId),
                eq(salesOrder.status, "booking"),
                eq(salesOrder.serverSeq, order.serverSeq),
              ),
            ),
          batchAbortUnless(ctx.db, "sales_order_line", orderLanded(ctx.companyId, order.id, seq)),
          poRepeatGuard(ctx.db, ctx.companyId, { customerId: order.customerId, poNumber: order.poNumber! }),
          auditInsert(ctx, {
            action: "order.confirm",
            subjectType: "sales_order",
            subjectId: order.id,
            meta: { number: order.number, period: order.period, orderId: order.id, lines: lines.length },
          }),
        ]);
      } catch (e) {
        if (isBatchAbort(e, "sales_order_line")) conflict();
        throw e;
      }
      return { id: order.id, status: "confirmed" as const };
    }),

  /** confirmed / dispatching → closed. A reason is required while baki is left (Q-OP-8). Bundles stay on the line (FP-OP-07). */
  close: actionProcedure("order.manage")
    .input(z.object({ id, reason: text(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const order = await loadOrder(ctx.db, ctx.companyId, input.id);
      if (order.status !== "confirmed" && order.status !== "dispatching") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `A ${order.status} order can't be closed` });
      }
      const totals = await lineTotals(ctx.db, ctx.companyId, { orderId: order.id });
      const reason = blank(input.reason);
      if (totals.bakiG > 0 && !reason) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${kgText(totals.bakiG)} kg baki is left on this order. Give a reason to close it.`,
        });
      }
      const at = clockNow();
      const userId = ctx.session.user.id;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db
            .update(salesOrder)
            .set({
              status: "closed",
              closedAt: at,
              closedBy: userId,
              closeReason: reason,
              statusChangedAt: at,
              statusChangedBy: userId,
              serverSeq: seq,
            })
            .where(
              and(
                eq(salesOrder.id, order.id),
                eq(salesOrder.companyId, ctx.companyId),
                eq(salesOrder.status, order.status),
                // Review round 1 m-9: only over the version whose baki was read (a kg raise meanwhile
                // could leave baki on an order closed without a reason).
                eq(salesOrder.serverSeq, order.serverSeq),
              ),
            ),
          batchAbortUnless(ctx.db, "sales_order_line", orderLanded(ctx.companyId, order.id, seq)),
          // FP-OP-17: a closed order holds no yard stock.
          ...(await releaseOrderHoldsStatements(ctx, order.id, "order_closed", seq)),
          auditInsert(ctx, {
            action: "order.close",
            subjectType: "sales_order",
            subjectId: order.id,
            meta: { number: order.number, orderId: order.id, from: order.status, bakiG: totals.bakiG, reason },
          }),
        ]);
      } catch (e) {
        if (isBatchAbort(e, "sales_order_line")) conflict();
        throw e;
      }
      return { id: order.id, status: "closed" as const, bakiG: totals.bakiG };
    }),

  /**
   * booking / confirmed → cancelled, only while nothing is packed, planned, pressed or
   * dispatched against it (OP §6; the check is also in the UPDATE's WHERE). Frees the PO.
   */
  cancel: actionProcedure("order.manage")
    .input(z.object({ id, reason: text(500).min(1, "Say why the order is cancelled") }))
    .mutation(async ({ ctx, input }) => {
      const order = await loadOrder(ctx.db, ctx.companyId, input.id);
      if (order.status !== "booking" && order.status !== "confirmed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `A ${order.status} order can't be cancelled` });
      }
      const [work] = await ctx.db
        .select({ busy: sql<number>`${orderHasWork(ctx.companyId, order.id)}` })
        .from(salesOrder)
        .where(and(eq(salesOrder.id, order.id), eq(salesOrder.companyId, ctx.companyId)));
      if (work && Number(work.busy)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Bundles, a press plan or a dispatch already carry this order. Close it instead of cancelling.",
        });
      }
      const at = clockNow();
      const userId = ctx.session.user.id;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db
            .update(salesOrder)
            .set({
              status: "cancelled",
              cancelledAt: at,
              cancelledBy: userId,
              cancelReason: input.reason,
              statusChangedAt: at,
              statusChangedBy: userId,
              serverSeq: seq,
            })
            .where(
              and(
                eq(salesOrder.id, order.id),
                eq(salesOrder.companyId, ctx.companyId),
                eq(salesOrder.status, order.status),
                sql`not ${orderHasWork(ctx.companyId, order.id)}`,
              ),
            ),
          batchAbortUnless(ctx.db, "sales_order_line", orderLanded(ctx.companyId, order.id, seq)),
          // FP-OP-17: a cancelled order holds no yard stock.
          ...(await releaseOrderHoldsStatements(ctx, order.id, "order_cancelled", seq)),
          auditInsert(ctx, {
            action: "order.cancel",
            subjectType: "sales_order",
            subjectId: order.id,
            meta: { number: order.number, orderId: order.id, from: order.status, reason: input.reason },
          }),
        ]);
      } catch (e) {
        if (isBatchAbort(e, "sales_order_line")) conflict();
        throw e;
      }
      return { id: order.id, status: "cancelled" as const };
    }),

  /**
   * Line quote while typing (IP §6): the basis the server would lock and the other side of the
   * line. Nothing is saved. No prices.
   */
  quote: companyProcedure
    .input(
      z.object({
        sectionId: id,
        dieInstanceId: id.nullable().optional(),
        cutLengthMm: z.number().int().min(1).max(30_000),
        qtyBasis: z.enum(["pcs", "kg"]),
        pcs: z.number().int().min(1).max(10_000_000).optional(),
        kgG: z.number().int().min(1).max(1_000_000_000).optional(),
        weightBasis: z.enum(salesOrderWeightBases).optional(),
        /**
         * Editing a booked line: quote on the basis it was locked with, exactly as `orders.update`
         * will save it, unless the section, the pin or the basis choice changed (that re-bases it,
         * and the quote is the fresh one). `locked` says which.
         */
        lineId: id.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const floor = await companyFloor(ctx.db, ctx.companyId);
      let stored: typeof salesOrderLine.$inferSelect | null = null;
      if (input.lineId) {
        const [row] = await ctx.db
          .select()
          .from(salesOrderLine)
          .where(and(eq(salesOrderLine.id, input.lineId), eq(salesOrderLine.companyId, ctx.companyId)))
          .limit(1);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Order line not found" });
        stored = row;
      }
      const section = await loadSection(ctx.db, ctx.companyId, input.sectionId);
      const copies = await sectionCopies(ctx.db, ctx.companyId, section);
      const keepsBasis =
        stored != null &&
        stored.qtyBasis != null &&
        stored.kgPer12ftMilli != null &&
        stored.dieId === input.sectionId &&
        (input.dieInstanceId ?? null) === (stored.dieInstanceId ?? null) &&
        (input.weightBasis === undefined || input.weightBasis === stored.weightBasis);
      if (!keepsBasis && input.dieInstanceId && !copies.some((c) => c.id === input.dieInstanceId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `That copy is not a live copy of ${section.sectionCode}` });
      }
      const basis =
        keepsBasis && stored
          ? {
              weightBasis: stored.weightBasis ?? ("copy_current" as const),
              basisMilli: stored.kgPer12ftMilli!,
              bandStartMilli: stored.bandStartMilli ?? section.weightMinG,
              copyMilli: stored.copyMilli,
              readingId: stored.readingId,
              basisNote: stored.basisNote,
              copyId: stored.dieInstanceId,
              copyCode: stored.dieInstanceId ? (copies.find((c) => c.id === stored.dieInstanceId)?.code ?? null) : null,
            }
          : chooseBasis(section, copies, { pinnedCopyId: input.dieInstanceId, weightBasis: input.weightBasis });
      const qty = lineQty(input, basis.basisMilli, floor.unit);
      return {
        ...basis,
        ...qty,
        locked: keepsBasis,
        alloy: section.alloy ?? floor.floor.defaultAlloy,
        temper: section.temper ?? floor.floor.defaultTemper,
        lengthUnit: floor.unit,
        dieBands: floor.floor.dieBands,
      };
    }),

  /**
   * Refresh a line's weight basis (FP-OP-04; audit `order.weight.refresh`). A pieces line gets a
   * new kg; a kg line gets new pieces. Refused while the line is on a released press plan, or when
   * more kg is already dispatched than the new ordered kg.
   */
  repriceWeight: actionProcedure("order.manage")
    .input(
      z.object({
        lineId: id,
        weightBasis: z.enum(salesOrderWeightBases).optional(),
        /** Pin (or with null unpin) a copy at the same time; omitted = keep. */
        dieInstanceId: id.nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [line] = await ctx.db
        .select({ line: salesOrderLine, orderStatus: salesOrder.status, orderNumber: salesOrder.number })
        .from(salesOrderLine)
        .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, ctx.companyId)))
        .where(and(eq(salesOrderLine.id, input.lineId), eq(salesOrderLine.companyId, ctx.companyId)))
        .limit(1);
      if (!line) throw new TRPCError({ code: "NOT_FOUND", message: "Order line not found" });
      const l = line.line;
      if (line.orderStatus === "closed" || line.orderStatus === "cancelled") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `A ${line.orderStatus} order can't change` });
      }
      const onReleasedPlan = sql`exists (select 1 from press_plan_line pl join press_plan p on p.id = pl.press_plan_id and p.company_id = pl.company_id where pl.company_id = ${ctx.companyId} and pl.sales_order_line_id = ${l.id} and p.status = 'released')`;
      const [released] = await ctx.db
        .select({ yes: sql<number>`${onReleasedPlan}` })
        .from(salesOrderLine)
        .where(eq(salesOrderLine.id, l.id));
      if (released && Number(released.yes)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Line ${l.lineNo} is on a released press plan; its weight can't change now` });
      }
      const floor = await companyFloor(ctx.db, ctx.companyId);
      const pinned = input.dieInstanceId === undefined ? l.dieInstanceId : input.dieInstanceId;
      const [resolved] = await resolveLines(
        ctx.db,
        ctx.companyId,
        [
          {
            sectionId: l.dieId,
            cutLengthMm: l.cutLengthMm,
            dieInstanceId: pinned,
            qtyBasis: l.qtyBasis ?? (l.pcs ? "pcs" : "kg"),
            weightBasis: input.weightBasis ?? l.weightBasis ?? undefined,
            pcs: l.pcs,
            kgG: l.kgG,
            alloy: l.alloy,
            temper: l.temper,
          },
        ],
        { canPrice: false, floor },
      );
      const next = resolved!;
      const strip = (await lineStrips(ctx.db, ctx.companyId, [l.id])).get(l.id)!;
      if (strip.dispatchedG > next.kgG) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${kgText(strip.dispatchedG)} kg is already dispatched on line ${l.lineNo}, more than the new ${kgText(next.kgG)} kg`,
        });
      }
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      try {
        await atomicBatch(ctx.db, [
          ctx.db
            .update(salesOrderLine)
            .set({
              kgG: next.kgG,
              pcs: next.pcs,
              kgPer12ftMilli: next.kgPer12ftMilli,
              dieInstanceId: pinned,
              qtyBasis: next.qtyBasis,
              impliedG: next.impliedG,
              weightBasis: next.weightBasis,
              bandStartMilli: next.bandStartMilli,
              copyMilli: next.copyMilli,
              readingId: next.readingId,
              basisNote: next.basisNote,
              serverSeq: seq,
            })
            .where(
              and(
                eq(salesOrderLine.id, l.id),
                eq(salesOrderLine.companyId, ctx.companyId),
                eq(salesOrderLine.serverSeq, l.serverSeq),
                sql`not ${onReleasedPlan}`,
              ),
            ),
          batchAbortUnless(
            ctx.db,
            "sales_order_line",
            sql`exists (select 1 from sales_order_line x where x.id = ${l.id} and x.company_id = ${ctx.companyId} and x.server_seq = ${seq})`,
          ),
          // The order's version moves too, so an editor holding the old order can't save over it.
          ctx.db
            .update(salesOrder)
            .set({ serverSeq: seq })
            .where(and(eq(salesOrder.id, l.salesOrderId), eq(salesOrder.companyId, ctx.companyId))),
          auditInsert(ctx, {
            action: "order.weight.refresh",
            subjectType: "sales_order_line",
            subjectId: l.id,
            meta: {
              orderId: l.salesOrderId,
              number: line.orderNumber,
              lineNo: l.lineNo,
              from: { basisMilli: l.kgPer12ftMilli, weightBasis: l.weightBasis, kgG: l.kgG, pcs: l.pcs },
              to: { basisMilli: next.kgPer12ftMilli, weightBasis: next.weightBasis, kgG: next.kgG, pcs: next.pcs },
            },
          }),
        ]);
      } catch (e) {
        if (isBatchAbort(e, "sales_order_line")) conflict();
        throw e;
      }
      return {
        lineId: l.id,
        kgG: next.kgG,
        pcs: next.pcs,
        impliedG: next.impliedG ?? null,
        kgPer12ftMilli: next.kgPer12ftMilli,
        weightBasis: next.weightBasis ?? null,
        basisNote: next.basisNote ?? null,
      };
    }),

  /**
   * Order timeline (FP-OP-06): audit rows about the order, its lines, its plans and reallocations,
   * the packs of bundles packed for its lines (`bundle.receipt.create`) and the completions of
   * dispatches carrying them (`dispatch.complete`, `dispatch.overdraw.request`), oldest first.
   */
  timeline: companyProcedure
    .input(z.object({ id, limit: z.number().int().min(1).max(200).default(100), offset: z.number().int().min(0).default(0) }))
    .query(async ({ ctx, input }) => {
      const order = await loadOrder(ctx.db, ctx.companyId, input.id);
      const actor = alias(user, "timeline_actor");
      const lines = sql`(select tl.id from sales_order_line tl where tl.company_id = ${ctx.companyId} and tl.sales_order_id = ${order.id})`;
      const about = or(
        and(eq(auditLog.subjectType, "sales_order"), eq(auditLog.subjectId, order.id)),
        sql`json_extract(${auditLog.meta}, '$.orderId') = ${order.id}`,
        sql`exists (select 1 from json_each(${auditLog.meta}, '$.orderIds') j where j.value = ${order.id})`,
        // Packs of bundles packed for the order's lines (moved-away bundles included) …
        sql`(${auditLog.action} = 'bundle.receipt.create' and ${auditLog.subjectType} = 'bundle_group' and ${auditLog.subjectId} in (select tb.group_id from bundle tb where tb.company_id = ${ctx.companyId} and coalesce(tb.packed_sales_order_line_id, tb.sales_order_line_id) in ${lines}))`,
        // … and completions (and overdraw asks) of dispatches that carry them.
        sql`(${auditLog.subjectType} = 'dispatch' and ${auditLog.action} in ('dispatch.complete', 'dispatch.overdraw.request') and ${auditLog.subjectId} in (select tdi.dispatch_id from dispatch_item tdi where tdi.company_id = ${ctx.companyId} and tdi.sales_order_line_id in ${lines}))`,
      );
      const rows = await ctx.db
        .select({
          id: auditLog.id,
          at: auditLog.at,
          action: auditLog.action,
          subjectType: auditLog.subjectType,
          subjectId: auditLog.subjectId,
          actorId: auditLog.actorId,
          actorName: actor.name,
          meta: auditLog.meta,
        })
        .from(auditLog)
        .leftJoin(actor, eq(actor.id, auditLog.actorId))
        // Nothing about an order predates it (a day of slack for clock skew): the company + time
        // index bounds the scan instead of reading the company's whole audit history.
        .where(and(eq(auditLog.companyId, ctx.companyId), gte(auditLog.at, new Date(order.createdAt.getTime() - 86_400_000)), about))
        .orderBy(asc(auditLog.at), asc(auditLog.id))
        .limit(input.limit + 1)
        .offset(input.offset);
      const more = rows.length > input.limit;
      return { events: more ? rows.slice(0, input.limit) : rows, nextOffset: more ? input.offset + input.limit : null };
    }),

  /**
   * Bundles on a line, and bundles packed for it that were moved to another line (FP-OP-07): each
   * with the line it is on now and the line (order, PO) it was packed for.
   */
  lineBundles: companyProcedure
    .input(z.object({ lineId: id, limit: z.number().int().min(1).max(200).default(100), offset: z.number().int().min(0).default(0) }))
    .query(async ({ ctx, input }) => {
      const nowLine = alias(salesOrderLine, "now_line");
      const nowOrder = alias(salesOrder, "now_order");
      const packLine = alias(salesOrderLine, "pack_line");
      const packOrder = alias(salesOrder, "pack_order");
      const rows = await ctx.db
        .select({
          id: bundle.id,
          serial: bundle.serial,
          partyNo: bundle.partyNo,
          status: bundle.status,
          weightG: bundle.weightG,
          pcs: bundle.quantity,
          lengthMm: bundle.lengthMm,
          lineId: bundle.salesOrderLineId,
          orderNumber: nowOrder.number,
          poNumber: nowOrder.poNumber,
          packedLineId: sql<string | null>`coalesce(${bundle.packedSalesOrderLineId}, ${bundle.salesOrderLineId})`,
          packedOrderNumber: packOrder.number,
          packedPoNumber: packOrder.poNumber,
        })
        .from(bundle)
        .leftJoin(nowLine, and(eq(nowLine.id, bundle.salesOrderLineId), eq(nowLine.companyId, ctx.companyId)))
        .leftJoin(nowOrder, and(eq(nowOrder.id, nowLine.salesOrderId), eq(nowOrder.companyId, ctx.companyId)))
        .leftJoin(
          packLine,
          and(eq(packLine.id, sql`coalesce(${bundle.packedSalesOrderLineId}, ${bundle.salesOrderLineId})`), eq(packLine.companyId, ctx.companyId)),
        )
        .leftJoin(packOrder, and(eq(packOrder.id, packLine.salesOrderId), eq(packOrder.companyId, ctx.companyId)))
        .where(
          and(
            eq(bundle.companyId, ctx.companyId),
            or(eq(bundle.salesOrderLineId, input.lineId), eq(bundle.packedSalesOrderLineId, input.lineId)),
          ),
        )
        .orderBy(asc(bundle.createdAt), asc(bundle.serial))
        .limit(input.limit + 1)
        .offset(input.offset);
      const more = rows.length > input.limit;
      const items = (more ? rows.slice(0, input.limit) : rows).map((r) => ({ ...r, movedAway: r.lineId !== input.lineId }));
      return { items, nextOffset: more ? input.offset + input.limit : null };
    }),

  /**
   * Move bundles to another order line or to plant stock (FP-OP-08/09). Only `available` bundles;
   * same die; a different cut length is allowed with a warning and a `reallocate` reason code.
   * Same customer / plant: applied now. Another customer's bundles: a pending `order_reallocate`
   * approval; nothing moves until it is approved. The owner gate (C47) runs for the target customer.
   */
  reallocate: actionProcedure("order.reallocate")
    .input(reallocateInput)
    .mutation(async ({ ctx, input }) => {
      const ids = [...new Set(input.bundleIds)];
      if (ids.length !== input.bundleIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "A bundle is listed twice" });
      const fromLine = alias(salesOrderLine, "from_line");
      const fromOrder = alias(salesOrder, "from_order");
      const rows = await ctx.db
        .select({
          id: bundle.id,
          serial: bundle.serial,
          status: bundle.status,
          dieId: bundle.dieId,
          dieInstanceId: bundle.dieInstanceId,
          lengthMm: bundle.lengthMm,
          weightG: bundle.weightG,
          lineId: bundle.salesOrderLineId,
          lineCustomerId: fromOrder.customerId,
          orderId: fromOrder.id,
          dispatchCode: dispatch.code,
          plant: sql<number>`${isPlantStockSql(ctx.companyId, { id: sql`${bundle.id}`, line: sql`${bundle.salesOrderLineId}` })}`,
          // Review round 1 m-3: plant stock remembers the customer it came from (its latest transfer's
          // from-line), so handing it to another customer still needs that customer's approval.
          originCustomerId: sql<string | null>`${plantOriginCustomerSql(ctx.companyId, sql`${bundle.id}`)}`,
          // A bundle on a live (draft or reserved) dispatch can't move.
          onDispatchCode: sql<string | null>`(select d2.code from dispatch_item di2 join dispatch d2 on d2.id = di2.dispatch_id and d2.company_id = di2.company_id where di2.company_id = ${ctx.companyId} and di2.bundle_id = ${bundle.id} and d2.deleted_at is null and d2.status in ('draft', 'reserved') limit 1)`,
        })
        .from(bundle)
        .leftJoin(fromLine, and(eq(fromLine.id, bundle.salesOrderLineId), eq(fromLine.companyId, ctx.companyId)))
        .leftJoin(fromOrder, and(eq(fromOrder.id, fromLine.salesOrderId), eq(fromOrder.companyId, ctx.companyId)))
        .leftJoin(dispatch, and(eq(dispatch.id, bundle.currentDispatchId), eq(dispatch.companyId, ctx.companyId)))
        .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, ids)));
      if (rows.length !== ids.length) throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });

      let target: { lineId: string; orderId: string; customerId: string; dieId: string; cutLengthMm: number; lineNo: number; orderNumber: string } | null =
        null;
      if (input.toLineId) {
        const [t] = await ctx.db
          .select({
            lineId: salesOrderLine.id,
            orderId: salesOrder.id,
            customerId: salesOrder.customerId,
            dieId: salesOrderLine.dieId,
            cutLengthMm: salesOrderLine.cutLengthMm,
            lineNo: salesOrderLine.lineNo,
            orderNumber: salesOrder.number,
            status: salesOrder.status,
          })
          .from(salesOrderLine)
          .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, ctx.companyId)))
          .where(and(eq(salesOrderLine.id, input.toLineId), eq(salesOrderLine.companyId, ctx.companyId)))
          .limit(1);
        if (!t) throw new TRPCError({ code: "NOT_FOUND", message: "Order line not found" });
        if (!(openSalesOrderStatuses as readonly string[]).includes(t.status)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${t.orderNumber} is ${t.status}; pick an open order` });
        }
        target = t;
      }

      const pending = await bundlesPendingReallocation(ctx.db, ctx.companyId, ids);
      // FP-OP-17: a held bundle moves only to the line it is held for; anything else releases it first.
      const holds = await holdsOf(ctx.db, ctx.companyId, ids);
      const transfers: TransferRow[] = [];
      const warnings: { bundleId: string; serial: string; kind: "length_mismatch"; bundleLengthMm: number; lineLengthMm: number }[] = [];
      let needsApproval = false;
      for (const b of rows) {
        if (pending.has(b.id)) {
          throw new TRPCError({ code: "CONFLICT", message: `${b.serial} is waiting on a reallocation approval` });
        }
        if (target && b.lineId === target.lineId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${b.serial} is already on ${target.orderNumber} line ${target.lineNo}` });
        }
        const hold = holds.get(b.id);
        if (hold && hold.lineId !== target?.lineId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `${b.serial} is held for ${hold.orderNumber} line ${hold.lineNo} (${hold.customerName}). Release the hold first.`,
          });
        }
        if (!target && !b.lineId && Number(b.plant)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${b.serial} is already plant stock` });
        }
        const check = reallocationCheck({
          bundle: {
            status: b.status,
            dieId: b.dieId,
            lengthMm: b.lengthMm,
            heldOnDispatchCode: b.dispatchCode ?? null,
            customerId: b.lineCustomerId ?? (b.lineId ? null : (b.originCustomerId ?? null)),
          },
          target: target ? { dieId: target.dieId, cutLengthMm: target.cutLengthMm, customerId: target.customerId } : null,
        });
        if (!check.ok) {
          const why =
            check.refusal === "dispatched"
              ? "is already dispatched"
              : check.refusal === "void"
                ? "is void"
                : check.refusal === "held"
                  ? `is held on dispatch ${check.dispatchCode ?? ""}`.trim()
                  : "is a different die from that line";
          throw new TRPCError({ code: "BAD_REQUEST", message: `${b.serial} ${why}` });
        }
        if (b.onDispatchCode) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${b.serial} is on dispatch ${b.onDispatchCode}; take it off the dispatch first` });
        }
        if (check.needsApproval) needsApproval = true;
        const mismatch = check.warnings.includes("length_mismatch");
        if (mismatch && target) {
          warnings.push({ bundleId: b.id, serial: b.serial, kind: "length_mismatch", bundleLengthMm: b.lengthMm, lineLengthMm: target.cutLengthMm });
        }
        transfers.push({ bundleId: b.id, fromLineId: b.lineId ?? null, lengthMismatch: mismatch });
      }

      // Reason: a reallocate reason code (required on a length mismatch) and/or text.
      let codeLabel: string | null = null;
      if (input.reasonCode) {
        await ensureDefaultReasonCodes(ctx.db, ctx.companyId);
        const [code] = await ctx.db
          .select({ code: reasonCode.code, label: reasonCode.label, requiresNote: reasonCode.requiresNote })
          .from(reasonCode)
          .where(
            and(
              eq(reasonCode.companyId, ctx.companyId),
              eq(reasonCode.kind, "reallocate"),
              eq(reasonCode.code, input.reasonCode),
              eq(reasonCode.active, true),
            ),
          )
          .limit(1);
        if (!code) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick a reason from the list" });
        if (code.requiresNote && !blank(input.reason)) throw new TRPCError({ code: "BAD_REQUEST", message: "Write a note for this reason" });
        codeLabel = code.label;
      }
      if (warnings.length > 0 && !input.reasonCode) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `The cut length differs for ${warnings.map((w) => w.serial).join(", ")}. Pick a reason code to move them.`,
        });
      }
      const reason = blank(input.reason) ?? codeLabel;
      if (!reason) throw new TRPCError({ code: "BAD_REQUEST", message: "Say why the bundles move" });

      // Owner gate for the customer the bundles go to (C47). Plant stock is checked when it is
      // allocated again (and at pack / dispatch), so a move to plant stock is never refused here.
      if (target) {
        const seen = new Set<string>();
        for (const b of rows) {
          const key = `${b.dieId}|${b.dieInstanceId ?? ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          await assertDieAllowed(ctx.db, ctx.companyId, {
            dieId: b.dieId,
            dieInstanceId: b.dieInstanceId,
            customerId: target.customerId,
            purpose: "dispatch",
            approvalId: input.dieOwnerApprovalId ?? null,
          });
        }
      }

      const at = clockNow();
      const userId = ctx.session.user.id;
      const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
      const batchId = crypto.randomUUID();
      const kgG = rows.reduce((s, b) => s + b.weightG, 0);
      const fromLineIds = [...new Set(rows.flatMap((b) => (b.lineId ? [b.lineId] : [])))];
      const orderIds = [...new Set([...rows.flatMap((b) => (b.orderId ? [b.orderId] : [])), ...(target ? [target.orderId] : [])])];
      const reasonCodeValue = input.reasonCode ?? null;

      if (needsApproval && target) {
        const meta: ReallocateMeta = {
          bundleIds: ids,
          fromLineIds,
          toLineId: target.lineId,
          kgG,
          reason,
          reasonCode: reasonCodeValue,
          items: transfers.map((t) => ({ bundleId: t.bundleId, fromLineId: t.fromLineId })),
          lengthMismatchBundleIds: warnings.map((w) => w.bundleId),
          orderIds,
          dieOwnerApprovalId: input.dieOwnerApprovalId ?? null,
        };
        const req = requestApprovalInsert(ctx, {
          kind: "order_reallocate",
          subjectId: batchId,
          serverSeq: seq,
          requestNote: reason,
          meta: meta as unknown as Record<string, unknown>,
        });
        // Write time: none of the bundles went onto a dispatch or into another pending request
        // after the read (a pending bundle can't be dispatched, and is asked for once).
        const guards = chunk(ids, 80).map((part) => {
          const list = sql.join(part.map((x) => sql`${x}`), sql`, `);
          return batchAbortUnless(
            ctx.db,
            "sales_order_line",
            sql`not exists (select 1 from dispatch_item di join dispatch d on d.id = di.dispatch_id and d.company_id = di.company_id where di.company_id = ${ctx.companyId} and d.deleted_at is null and d.status in ('draft', 'reserved') and di.bundle_id in (${list}))
              and not exists (select 1 from approval a, json_each(a.meta, '$.bundleIds') j where a.company_id = ${ctx.companyId} and a.kind = 'order_reallocate' and a.status = 'pending' and j.value in (${list}))
              and not exists (select 1 from bundle hb where hb.company_id = ${ctx.companyId} and hb.id in (${list}) and hb.held_for_line_id is not null and hb.held_for_line_id <> ${target.lineId})`,
          );
        });
        try {
          await atomicBatch(ctx.db, [
            ...guards,
            req.statement,
            auditInsert(ctx, {
              action: "order.reallocate",
              subjectType: "bundle_transfer",
              subjectId: batchId,
              meta: { status: "pending", approvalId: req.id, batchId, toLineId: target.lineId, orderIds, bundles: ids.length, kgG, reasonCode: reasonCodeValue },
            }),
          ]);
        } catch (e) {
          if (isBatchAbort(e, "sales_order_line")) {
            throw new TRPCError({ code: "CONFLICT", message: "A bundle went onto a dispatch or another request meanwhile. Reload and try again." });
          }
          throw e;
        }
        return { status: "pending" as const, batchId, approvalId: req.id, moved: 0, kgG, warnings };
      }

      const statements: SqliteBatchItem[] = [
        ...moveStatements(ctx.db, {
          companyId: ctx.companyId,
          seq,
          batchId,
          toLineId: target?.lineId ?? null,
          reason,
          reasonCode: reasonCodeValue,
          userId,
          at,
          rows: transfers,
        }),
        // Every bundle must have moved in this batch (a dispatch scan or another move in between fails it whole).
        batchAbortUnless(
          ctx.db,
          "sales_order_line",
          sql`(select count(*) from bundle b where b.company_id = ${ctx.companyId} and b.server_seq = ${seq} and b.status = 'available' and ${target ? sql`b.sales_order_line_id = ${target.lineId} and (b.held_for_line_id is null or b.held_for_line_id = ${target.lineId})` : sql`b.sales_order_line_id is null and b.held_for_line_id is null`} and b.id in (select t.bundle_id from bundle_transfer t where t.company_id = ${ctx.companyId} and t.batch_id = ${batchId})) = ${ids.length}`,
        ),
        auditInsert(ctx, {
          action: "order.reallocate",
          subjectType: "bundle_transfer",
          subjectId: batchId,
          meta: {
            status: "applied",
            batchId,
            toLineId: target?.lineId ?? null,
            orderIds,
            bundles: ids.length,
            kgG,
            reasonCode: reasonCodeValue,
            lengthMismatch: warnings.length,
          },
        }),
      ];
      try {
        await atomicBatch(ctx.db, statements);
      } catch (e) {
        if (isBatchAbort(e, "sales_order_line")) {
          throw new TRPCError({ code: "CONFLICT", message: "A bundle changed meanwhile. Reload and try again." });
        }
        throw e;
      }
      return { status: "applied" as const, batchId, approvalId: null, moved: ids.length, kgG, warnings };
    }),

  /**
   * Hold yard bundles for an open line (FP-OP-17, C9 "Put on sales order"). Only `available` bundles
   * of the line's die, on no live dispatch, not waiting on a reallocation approval, and on no line or
   * on this line (a bundle on another line moves with `orders.reallocate`). A different cut length is
   * allowed with a warning. Owned dies pass the owner gate for the line's customer (purpose
   * dispatch). The bundles stay `available` where they are; the line's strip shows them as held.
   * Audit `order.hold`; no ledger rows. Bundles already held for this line are reported, not re-held.
   */
  hold: actionProcedure("order.manage")
    .input(holdInput)
    .mutation(async ({ ctx, input }) => {
      const ids = [...new Set(input.bundleIds)];
      if (ids.length !== input.bundleIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "A bundle is listed twice" });
      const line = await loadLineWithOrder(ctx.db, ctx.companyId, input.lineId);
      const open = (openSalesOrderStatuses as readonly string[]).includes(line.status);
      if (!open) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${line.orderNumber} is ${line.status}; hold stock for an open order` });
      }
      const onLine = alias(salesOrderLine, "on_line");
      const onOrder = alias(salesOrder, "on_order");
      const rows = await mapInChunks(ids, (part) =>
        ctx.db
          .select({
            id: bundle.id,
            serial: bundle.serial,
            status: bundle.status,
            dieId: bundle.dieId,
            dieInstanceId: bundle.dieInstanceId,
            lengthMm: bundle.lengthMm,
            weightG: bundle.weightG,
            pcs: bundle.quantity,
            lineId: bundle.salesOrderLineId,
            lineNo: onLine.lineNo,
            orderNumber: onOrder.number,
            heldForLineId: bundle.heldForLineId,
            onDispatchCode: sql<string | null>`(select d2.code from dispatch_item di2 join dispatch d2 on d2.id = di2.dispatch_id and d2.company_id = di2.company_id where di2.company_id = ${ctx.companyId} and di2.bundle_id = ${bundle.id} and d2.deleted_at is null and d2.status in ('draft', 'reserved') limit 1)`,
          })
          .from(bundle)
          .leftJoin(onLine, and(eq(onLine.id, bundle.salesOrderLineId), eq(onLine.companyId, ctx.companyId)))
          .leftJoin(onOrder, and(eq(onOrder.id, onLine.salesOrderId), eq(onOrder.companyId, ctx.companyId)))
          .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, part))),
      );
      if (rows.length !== ids.length) throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const pending = await bundlesPendingReallocation(ctx.db, ctx.companyId, ids);
      const heldElsewhere = await holdsOf(
        ctx.db,
        ctx.companyId,
        rows.filter((r) => r.heldForLineId && r.heldForLineId !== line.lineId).map((r) => r.id),
      );

      const toHold: typeof rows = [];
      const alreadyHeld: string[] = [];
      const warnings: { bundleId: string; serial: string; kind: "length_mismatch"; bundleLengthMm: number; lineLengthMm: number }[] = [];
      for (const bid of ids) {
        const b = byId.get(bid)!;
        const check = holdCheck({
          bundle: {
            status: b.status,
            dieId: b.dieId,
            lengthMm: b.lengthMm,
            salesOrderLineId: b.lineId,
            heldForLineId: b.heldForLineId,
            onLiveDispatch: b.onDispatchCode !== null,
            pendingReallocation: pending.has(b.id),
          },
          line: { id: line.lineId, dieId: line.dieId, cutLengthMm: line.cutLengthMm, open },
        });
        if (!check.ok) {
          const other = heldElsewhere.get(b.id);
          const why: Record<typeof check.refusal, string> = {
            line_closed: `${line.orderNumber} is ${line.status}; hold stock for an open order`,
            not_available: `${b.serial} is ${b.status}; only bundles in the yard can be held`,
            on_dispatch: `${b.serial} is on dispatch ${b.onDispatchCode ?? ""}; take it off the dispatch first`,
            pending_reallocation: `${b.serial} is waiting on a reallocation approval`,
            die_mismatch: `${b.serial} is a different die from that line`,
            other_line: `${b.serial} is on ${b.orderNumber ?? "another order"} line ${b.lineNo ?? ""}; move it with Reallocate instead`,
            held_elsewhere: other
              ? `${b.serial} is already held for ${other.orderNumber} line ${other.lineNo} (${other.customerName}). Release it first.`
              : `${b.serial} is already held for another order line. Release it first.`,
          };
          throw new TRPCError({ code: "BAD_REQUEST", message: why[check.refusal] });
        }
        if (check.alreadyHeld) {
          alreadyHeld.push(b.serial);
          continue;
        }
        if (check.warnings.includes("length_mismatch")) {
          warnings.push({ bundleId: b.id, serial: b.serial, kind: "length_mismatch", bundleLengthMm: b.lengthMm, lineLengthMm: line.cutLengthMm });
        }
        toHold.push(b);
      }

      // Owner gate (C47) for the customer the stock is held for, once per die / copy.
      const seen = new Set<string>();
      for (const b of toHold) {
        const key = `${b.dieId}|${b.dieInstanceId ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await assertDieAllowed(ctx.db, ctx.companyId, {
          dieId: b.dieId,
          dieInstanceId: b.dieInstanceId,
          customerId: line.customerId,
          purpose: "dispatch",
        });
      }

      const kgG = toHold.reduce((sum, b) => sum + b.weightG, 0);
      if (toHold.length > 0) {
        const at = clockNow();
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const statements: SqliteBatchItem[] = [];
        for (const part of chunk(toHold.map((b) => b.id), 80)) {
          statements.push(
            ctx.db
              .update(bundle)
              .set({ heldForLineId: line.lineId, heldAt: at, serverSeq: seq })
              .where(
                and(
                  eq(bundle.companyId, ctx.companyId),
                  inArray(bundle.id, part),
                  eq(bundle.status, "available"),
                  sql`${bundle.heldForLineId} is null`,
                  sql`(${bundle.salesOrderLineId} is null or ${bundle.salesOrderLineId} = ${line.lineId})`,
                  sql`not exists (select 1 from dispatch_item hdi join dispatch hd on hd.id = hdi.dispatch_id and hd.company_id = hdi.company_id where hdi.company_id = ${ctx.companyId} and hdi.bundle_id = ${bundle.id} and hd.deleted_at is null and hd.status in ('draft', 'reserved'))`,
                  sql`not ${pendingReallocationOf(ctx.companyId, sql`${bundle.id}`)}`,
                ),
              ),
          );
        }
        // Write time: every bundle was held by THIS call, and the order is still open.
        for (const part of chunk(toHold.map((b) => b.id), 80)) {
          statements.push(
            batchAbortUnless(
              ctx.db,
              "sales_order_line",
              sql`(select count(*) from bundle hb where hb.company_id = ${ctx.companyId} and hb.server_seq = ${seq} and hb.held_for_line_id = ${line.lineId} and hb.id in (${idList(part)})) = ${part.length}`,
            ),
          );
        }
        statements.push(
          batchAbortUnless(
            ctx.db,
            "sales_order_line",
            sql`exists (select 1 from sales_order o where o.id = ${line.orderId} and o.company_id = ${ctx.companyId} and o.status in ('booking', 'confirmed', 'dispatching'))`,
          ),
          auditInsert(ctx, {
            action: "order.hold",
            subjectType: "sales_order_line",
            subjectId: line.lineId,
            meta: {
              orderId: line.orderId,
              orderNumber: line.orderNumber,
              lineNo: line.lineNo,
              customerId: line.customerId,
              bundleIds: toHold.map((b) => b.id),
              serials: toHold.map((b) => b.serial),
              kgG,
              pcs: toHold.reduce((sum, b) => sum + b.pcs, 0),
              note: blank(input.note),
              lengthMismatch: warnings.map((w) => w.serial),
            },
          }),
        );
        try {
          await atomicBatch(ctx.db, statements);
        } catch (e) {
          if (isBatchAbort(e, "sales_order_line")) {
            throw new TRPCError({ code: "CONFLICT", message: "A bundle or the order changed meanwhile. Reload and try again." });
          }
          throw e;
        }
      }
      const strip = (await lineStrips(ctx.db, ctx.companyId, [line.lineId])).get(line.lineId)!;
      return {
        lineId: line.lineId,
        orderId: line.orderId,
        orderNumber: line.orderNumber,
        held: toHold.map((b) => b.serial),
        alreadyHeld,
        kgG,
        warnings,
        strip,
      };
    }),

  /**
   * End holds on a line (FP-OP-17): the listed bundles (each must be held for this line), or every
   * bundle held for it. The bundles stay where they are. Audit `order.release`; no ledger rows.
   */
  release: actionProcedure("order.manage")
    .input(releaseInput)
    .mutation(async ({ ctx, input }) => {
      const line = await loadLineWithOrder(ctx.db, ctx.companyId, input.lineId);
      const asked = input.bundleIds ? [...new Set(input.bundleIds)] : null;
      const rows = asked
        ? await mapInChunks(asked, (part) =>
            ctx.db
              .select({ id: bundle.id, serial: bundle.serial, weightG: bundle.weightG, heldForLineId: bundle.heldForLineId })
              .from(bundle)
              .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, part))),
          )
        : await ctx.db
            .select({ id: bundle.id, serial: bundle.serial, weightG: bundle.weightG, heldForLineId: bundle.heldForLineId })
            .from(bundle)
            .where(and(eq(bundle.companyId, ctx.companyId), eq(bundle.heldForLineId, line.lineId)));
      if (asked && rows.length !== asked.length) throw new TRPCError({ code: "NOT_FOUND", message: "Bundle not found" });
      const notHeld = rows.filter((r) => r.heldForLineId !== line.lineId);
      if (notHeld.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `${notHeld.map((r) => r.serial).join(", ")} ${notHeld.length === 1 ? "is" : "are"} not held for ${line.orderNumber} line ${line.lineNo}`,
        });
      }
      const kgG = rows.reduce((sum, b) => sum + b.weightG, 0);
      if (rows.length > 0) {
        const seq = await nextCompanySeq({ db: ctx.db }, ctx.companyId);
        const statements: SqliteBatchItem[] = [];
        for (const part of chunk(rows.map((r) => r.id), 80)) {
          statements.push(
            ctx.db
              .update(bundle)
              .set({ heldForLineId: null, heldAt: null, serverSeq: seq })
              .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, part), eq(bundle.heldForLineId, line.lineId))),
          );
        }
        statements.push(
          auditInsert(ctx, {
            action: "order.release",
            subjectType: "sales_order_line",
            subjectId: line.lineId,
            meta: {
              orderId: line.orderId,
              orderNumber: line.orderNumber,
              lineNo: line.lineNo,
              reason: "released",
              bundleIds: rows.map((r) => r.id),
              serials: rows.map((r) => r.serial),
              kgG,
              note: blank(input.note),
            },
          }),
        );
        await atomicBatch(ctx.db, statements);
      }
      const strip = (await lineStrips(ctx.db, ctx.companyId, [line.lineId])).get(line.lineId)!;
      return { lineId: line.lineId, released: rows.map((r) => r.serial), kgG, strip };
    }),

  /**
   * Bundles held for a line (FP-OP-17), oldest hold first: where each sits now (its own line, the
   * dispatch it is on) and the held total. No prices.
   */
  holds: companyProcedure
    .input(z.object({ lineId: id, limit: z.number().int().min(1).max(200).default(100), offset: z.number().int().min(0).default(0) }))
    .query(async ({ ctx, input }) => {
      await loadLineWithOrder(ctx.db, ctx.companyId, input.lineId);
      const where = and(eq(bundle.companyId, ctx.companyId), eq(bundle.heldForLineId, input.lineId));
      const rows = await ctx.db
        .select({
          id: bundle.id,
          serial: bundle.serial,
          partyNo: bundle.partyNo,
          status: bundle.status,
          weightG: bundle.weightG,
          pcs: bundle.quantity,
          lengthMm: bundle.lengthMm,
          locationId: bundle.locationId,
          lineId: bundle.salesOrderLineId,
          heldAt: bundle.heldAt,
          // Table-qualified: a single-table select prints a bare "id", which the subquery would take as its own.
          dispatchCode: sql<string | null>`(select d2.code from dispatch_item di2 join dispatch d2 on d2.id = di2.dispatch_id and d2.company_id = di2.company_id where di2.company_id = ${ctx.companyId} and di2.bundle_id = "bundle"."id" and d2.deleted_at is null and d2.status in ('draft', 'reserved') limit 1)`,
        })
        .from(bundle)
        .where(where)
        .orderBy(asc(bundle.heldAt), asc(bundle.serial))
        .limit(input.limit + 1)
        .offset(input.offset);
      const [sum] = await ctx.db
        .select({
          n: sql<number>`count(*)`,
          g: sql<number>`coalesce(sum(case when ${bundle.status} in ('available', 'reserved') then ${bundle.weightG} else 0 end), 0)`,
        })
        .from(bundle)
        .where(where);
      const more = rows.length > input.limit;
      return {
        items: more ? rows.slice(0, input.limit) : rows,
        total: Number(sum?.n ?? 0),
        heldG: Number(sum?.g ?? 0),
        nextOffset: more ? input.offset + input.limit : null,
      };
    }),

  /**
   * Plant stock (FP-OP-09, C8): available bundles on no line whose latest transfer went to no line.
   * `includeUnassigned` adds legacy bundles with no line and no transfer (they need a transfer
   * before they can go on a dispatch).
   */
  plantStock: companyProcedure
    .input(
      z.object({
        sectionId: id.optional(),
        includeUnassigned: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const plant = isPlantStockSql(ctx.companyId, { id: sql`${bundle.id}`, line: sql`${bundle.salesOrderLineId}` });
      const where = and(
        eq(bundle.companyId, ctx.companyId),
        eq(bundle.status, "available"),
        input.sectionId ? eq(bundle.dieId, input.sectionId) : undefined,
        input.includeUnassigned ? sql`${bundle.salesOrderLineId} is null` : plant,
      );
      const rows = await ctx.db
        .select({
          id: bundle.id,
          serial: bundle.serial,
          sectionId: bundle.dieId,
          sectionCode: die.sectionCode,
          weightG: bundle.weightG,
          pcs: bundle.quantity,
          lengthMm: bundle.lengthMm,
          locationId: bundle.locationId,
          createdAt: bundle.createdAt,
          /** FP-OP-17: the line this bundle is held for (null = free). */
          heldForLineId: bundle.heldForLineId,
          plant: sql<number>`${plant}`,
        })
        .from(bundle)
        .innerJoin(die, and(eq(die.id, bundle.dieId), eq(die.companyId, ctx.companyId)))
        .where(where)
        .orderBy(asc(bundle.createdAt), asc(bundle.serial))
        .limit(input.limit + 1)
        .offset(input.offset);
      const [sum] = await ctx.db
        .select({ n: sql<number>`count(*)`, g: sql<number>`coalesce(sum(${bundle.weightG}), 0)` })
        .from(bundle)
        .where(where);
      const more = rows.length > input.limit;
      return {
        items: (more ? rows.slice(0, input.limit) : rows).map(({ plant: p, ...r }) => ({
          ...r,
          allocation: Number(p) ? ("plant" as const) : ("unassigned" as const),
        })),
        total: Number(sum?.n ?? 0),
        totalG: Number(sum?.g ?? 0),
        nextOffset: more ? input.offset + input.limit : null,
      };
    }),

  /**
   * Ready-stock prompt (FP-OP-10): available bundles of this die that a new line could take, best
   * first: plant stock, unassigned, this customer's leftovers (closed orders), this customer's
   * other open lines, then other customers' (those need an approval to move). Within each group
   * the exact cut length comes first, then the oldest packed. Bundles waiting on a reallocation
   * approval are left out.
   */
  matchStock: companyProcedure
    .input(
      z.object({
        sectionId: id,
        cutLengthMm: z.number().int().min(1).max(30_000).optional(),
        customerId: id.optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const nowLine = alias(salesOrderLine, "match_line");
      const nowOrder = alias(salesOrder, "match_order");
      const heldLine = alias(salesOrderLine, "match_held_line");
      const heldOrder = alias(salesOrder, "match_held_order");
      const plant = isPlantStockSql(ctx.companyId, { id: sql`${bundle.id}`, line: sql`${bundle.salesOrderLineId}` });
      const cust = input.customerId ?? null;
      const rank = sql<number>`case
        when ${bundle.salesOrderLineId} is null and ${plant} then 0
        when ${bundle.salesOrderLineId} is null then 1
        when ${nowOrder.customerId} = ${cust} and ${nowOrder.status} in ('closed', 'cancelled') then 2
        when ${nowOrder.customerId} = ${cust} then 3
        when ${nowOrder.status} in ('closed', 'cancelled') then 4
        else 5 end`;
      const lengthMatch =
        input.cutLengthMm != null ? sql<number>`case when ${bundle.lengthMm} = ${input.cutLengthMm} then 1 else 0 end` : sql<number>`1`;
      const where = and(
        eq(bundle.companyId, ctx.companyId),
        eq(bundle.dieId, input.sectionId),
        eq(bundle.status, "available"),
        sql`not ${pendingReallocationOf(ctx.companyId, sql`${bundle.id}`)}`,
      );
      const rows = await ctx.db
        .select({
          id: bundle.id,
          serial: bundle.serial,
          weightG: bundle.weightG,
          pcs: bundle.quantity,
          lengthMm: bundle.lengthMm,
          createdAt: bundle.createdAt,
          lineId: bundle.salesOrderLineId,
          orderId: nowOrder.id,
          orderNumber: nowOrder.number,
          orderStatus: nowOrder.status,
          poNumber: nowOrder.poNumber,
          customerId: nowOrder.customerId,
          heldForLineId: bundle.heldForLineId,
          heldForOrderNumber: heldOrder.number,
          rank,
          lengthMatch,
        })
        .from(bundle)
        .leftJoin(nowLine, and(eq(nowLine.id, bundle.salesOrderLineId), eq(nowLine.companyId, ctx.companyId)))
        .leftJoin(nowOrder, and(eq(nowOrder.id, nowLine.salesOrderId), eq(nowOrder.companyId, ctx.companyId)))
        .leftJoin(heldLine, and(eq(heldLine.id, bundle.heldForLineId), eq(heldLine.companyId, ctx.companyId)))
        .leftJoin(heldOrder, and(eq(heldOrder.id, heldLine.salesOrderId), eq(heldOrder.companyId, ctx.companyId)))
        .where(where)
        .orderBy(asc(rank), desc(lengthMatch), asc(bundle.createdAt), asc(bundle.serial))
        .limit(input.limit);
      const ALLOC = ["plant", "unassigned", "same_customer", "same_customer", "other_customer", "other_customer"] as const;
      const items = rows.map((r) => {
        const allocation = ALLOC[Number(r.rank)] ?? "other_customer";
        return {
          id: r.id,
          serial: r.serial,
          weightG: r.weightG,
          pcs: r.pcs,
          lengthMm: r.lengthMm,
          createdAt: r.createdAt,
          allocation,
          lineId: r.lineId,
          orderId: r.orderId,
          orderNumber: r.orderNumber,
          orderStatus: r.orderStatus,
          poNumber: r.poNumber,
          lengthMatch: Boolean(Number(r.lengthMatch)),
          /** Another customer's bundle: moving it waits on an `order_reallocate` approval. */
          needsApproval: allocation === "other_customer" && cust !== null,
          /** FP-OP-17: held for a line (spoken for; release it before moving it elsewhere). */
          heldForLineId: r.heldForLineId,
          heldForOrderNumber: r.heldForOrderNumber,
        };
      });
      const ready = items.filter(
        (i) => !i.heldForLineId && (i.allocation === "plant" || i.allocation === "unassigned" || i.allocation === "same_customer"),
      );
      return { items, readyG: ready.reduce((s, i) => s + i.weightG, 0), readyBundles: ready.length };
    }),

  /**
   * Reallocation requests (FP-OP-08) for the order screens and the approver's sheet: the
   * cross-customer requests (`order_reallocate` approvals) as pending / applied / rejected, and
   * `get` by approval or batch id (a batch applied at once, without an approval, too). Names,
   * serials, kg, orders and POs only; never rates (C46).
   */
  reallocations: router({
    list: companyProcedure
      .input(
        z.object({
          status: z.enum(["pending", "applied", "rejected"]).optional(),
          /** Requests that move bundles from or to this order. */
          orderId: id.optional(),
          limit: z.number().int().min(1).max(100).default(50),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ ctx, input }) => {
        const requester = alias(user, "realloc_requester");
        const decider = alias(user, "realloc_decider");
        const toLine = alias(salesOrderLine, "realloc_to_line");
        const toOrder = alias(salesOrder, "realloc_to_order");
        const where = and(
          eq(approval.companyId, ctx.companyId),
          eq(approval.kind, "order_reallocate"),
          input.status ? eq(approval.status, REALLOCATION_STATUS_TO_APPROVAL[input.status]) : undefined,
          input.orderId
            ? sql`exists (select 1 from json_each(${approval.meta}, '$.orderIds') j where j.value = ${input.orderId})`
            : undefined,
        );
        const rows = await ctx.db
          .select({
            approvalId: approval.id,
            batchId: approval.subjectId,
            status: approval.status,
            meta: approval.meta,
            requestedAt: approval.createdAt,
            requestedById: approval.requestedBy,
            requestedByName: requester.name,
            decidedAt: approval.decidedAt,
            decidedByName: decider.name,
            decisionNote: approval.note,
            toLineNo: toLine.lineNo,
            toOrderId: toOrder.id,
            toOrderNumber: toOrder.number,
            toOrderPeriod: toOrder.period,
            toPoNumber: toOrder.poNumber,
            toCustomerId: toOrder.customerId,
            toCustomerName: customer.name,
          })
          .from(approval)
          .leftJoin(requester, eq(requester.id, approval.requestedBy))
          .leftJoin(decider, eq(decider.id, approval.decidedBy))
          .leftJoin(toLine, and(eq(toLine.id, sql`json_extract(${approval.meta}, '$.toLineId')`), eq(toLine.companyId, ctx.companyId)))
          .leftJoin(toOrder, and(eq(toOrder.id, toLine.salesOrderId), eq(toOrder.companyId, ctx.companyId)))
          .leftJoin(customer, and(eq(customer.id, toOrder.customerId), eq(customer.companyId, ctx.companyId)))
          .where(where)
          .orderBy(desc(approval.createdAt), desc(approval.id))
          .limit(input.limit)
          .offset(input.offset);
        const [total] = await ctx.db.select({ n: count() }).from(approval).where(where);
        const n = Number(total?.n ?? 0);
        const next = input.offset + rows.length;
        return {
          items: rows.map((r) => {
            const meta = r.meta as unknown as ReallocateMeta;
            return {
              approvalId: r.approvalId,
              batchId: r.batchId,
              status: APPROVAL_TO_REALLOCATION_STATUS[r.status],
              bundles: meta.bundleIds?.length ?? 0,
              kgG: meta.kgG ?? 0,
              reason: meta.reason ?? null,
              reasonCode: meta.reasonCode ?? null,
              orderIds: meta.orderIds ?? [],
              to: {
                lineId: meta.toLineId,
                lineNo: r.toLineNo,
                orderId: r.toOrderId,
                orderNumber: r.toOrderNumber,
                orderPeriod: r.toOrderPeriod,
                poNumber: r.toPoNumber,
                customerId: r.toCustomerId,
                customerName: r.toCustomerName,
              },
              requestedAt: r.requestedAt,
              requestedById: r.requestedById,
              requestedByName: r.requestedByName,
              decidedAt: r.decidedAt,
              decidedByName: r.decidedByName,
              decisionNote: r.decisionNote,
            };
          }),
          total: n,
          nextOffset: next < n ? next : null,
        };
      }),

    get: companyProcedure
      .input(z.object({ approvalId: id.optional(), batchId: id.optional() }).refine((v) => Boolean(v.approvalId || v.batchId), "Give the approval or batch id"))
      .query(async ({ ctx, input }) => {
        const [req] = await ctx.db
          .select()
          .from(approval)
          .where(
            and(
              eq(approval.companyId, ctx.companyId),
              eq(approval.kind, "order_reallocate"),
              input.approvalId ? eq(approval.id, input.approvalId) : eq(approval.subjectId, input.batchId!),
            ),
          )
          .orderBy(desc(approval.createdAt))
          .limit(1);
        let head: {
          approvalId: string | null;
          batchId: string;
          status: "pending" | "applied" | "rejected";
          kgG: number | null;
          reason: string | null;
          reasonCode: string | null;
          toLineId: string | null;
          items: { bundleId: string; fromLineId: string | null; lengthMismatch: boolean }[];
          requestedAt: Date;
          requestedById: string | null;
          decidedAt: Date | null;
          decidedById: string | null;
          decisionNote: string | null;
        };
        if (req) {
          const meta = req.meta as unknown as ReallocateMeta;
          const mismatch = new Set(meta.lengthMismatchBundleIds ?? []);
          head = {
            approvalId: req.id,
            batchId: req.subjectId,
            status: APPROVAL_TO_REALLOCATION_STATUS[req.status],
            kgG: meta.kgG ?? null,
            reason: meta.reason ?? null,
            reasonCode: meta.reasonCode ?? null,
            toLineId: meta.toLineId ?? null,
            items: (meta.items ?? []).map((i) => ({ bundleId: i.bundleId, fromLineId: i.fromLineId, lengthMismatch: mismatch.has(i.bundleId) })),
            requestedAt: req.createdAt,
            requestedById: req.requestedBy,
            decidedAt: req.decidedAt,
            decidedById: req.decidedBy,
            decisionNote: req.note,
          };
        } else {
          if (!input.batchId) throw new TRPCError({ code: "NOT_FOUND", message: "Reallocation not found" });
          // A batch applied at once (same customer, plant stock): its transfer rows.
          const rows = await ctx.db
            .select()
            .from(bundleTransfer)
            .where(and(eq(bundleTransfer.companyId, ctx.companyId), eq(bundleTransfer.batchId, input.batchId)))
            .orderBy(asc(bundleTransfer.createdAt))
            .limit(MAX_REALLOCATE_BUNDLES);
          if (rows.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Reallocation not found" });
          head = {
            approvalId: null,
            batchId: input.batchId,
            status: "applied",
            kgG: null,
            reason: rows[0]!.reason,
            reasonCode: rows[0]!.reasonCode,
            toLineId: rows[0]!.toSalesOrderLineId,
            items: rows.map((r) => ({ bundleId: r.bundleId, fromLineId: r.fromSalesOrderLineId, lengthMismatch: r.lengthMismatch })),
            requestedAt: rows[0]!.createdAt,
            requestedById: rows[0]!.createdBy,
            decidedAt: null,
            decidedById: null,
            decisionNote: null,
          };
        }

        const bundleIds = head.items.map((i) => i.bundleId);
        const bundles = new Map<string, { serial: string; weightG: number; pcs: number; lengthMm: number; status: string; lineId: string | null }>();
        for (const part of chunk(bundleIds, 80)) {
          const rows = await ctx.db
            .select({
              id: bundle.id,
              serial: bundle.serial,
              weightG: bundle.weightG,
              pcs: bundle.quantity,
              lengthMm: bundle.lengthMm,
              status: bundle.status,
              lineId: bundle.salesOrderLineId,
            })
            .from(bundle)
            .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, part)));
          for (const r of rows) bundles.set(r.id, r);
        }
        const moved = new Set<string>();
        for (const part of chunk(bundleIds, 80)) {
          const rows = await ctx.db
            .select({ bundleId: bundleTransfer.bundleId })
            .from(bundleTransfer)
            .where(
              and(
                eq(bundleTransfer.companyId, ctx.companyId),
                eq(bundleTransfer.batchId, head.batchId),
                inArray(bundleTransfer.bundleId, part),
              ),
            );
          for (const r of rows) moved.add(r.bundleId);
        }
        const lineIds = [...new Set([head.toLineId, ...head.items.map((i) => i.fromLineId)].filter((x): x is string => Boolean(x)))];
        const lines = new Map<string, Awaited<ReturnType<typeof reallocationLines>>[number]>();
        for (const l of await reallocationLines(ctx.db, ctx.companyId, lineIds)) lines.set(l.lineId, l);
        const users = new Map<string, string>();
        const userIds = [head.requestedById, head.decidedById].filter((x): x is string => Boolean(x));
        if (userIds.length > 0) {
          for (const u of await ctx.db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, userIds))) users.set(u.id, u.name);
        }
        const items = head.items
          .map((i) => {
            const b = bundles.get(i.bundleId);
            return {
              bundleId: i.bundleId,
              serial: b?.serial ?? "",
              weightG: b?.weightG ?? 0,
              pcs: b?.pcs ?? null,
              lengthMm: b?.lengthMm ?? null,
              status: b?.status ?? null,
              lineIdNow: b?.lineId ?? null,
              lengthMismatch: i.lengthMismatch,
              from: i.fromLineId ? (lines.get(i.fromLineId) ?? null) : null,
              moved: moved.has(i.bundleId),
            };
          })
          .sort((a, b) => a.serial.localeCompare(b.serial));
        return {
          approvalId: head.approvalId,
          batchId: head.batchId,
          status: head.status,
          kgG: head.kgG ?? items.reduce((sum, i) => sum + i.weightG, 0),
          reason: head.reason,
          reasonCode: head.reasonCode,
          /** null = plant stock. */
          to: head.toLineId ? (lines.get(head.toLineId) ?? null) : null,
          bundles: items,
          requestedAt: head.requestedAt,
          requestedByName: head.requestedById ? (users.get(head.requestedById) ?? null) : null,
          decidedAt: head.decidedAt,
          decidedByName: head.decidedById ? (users.get(head.decidedById) ?? null) : null,
          decisionNote: head.decisionNote,
        };
      }),
  }),

  /** Orders running late (FP-OP-18 data): confirmed / dispatching, baki left, ordered more than 15 days ago. */
  late: companyProcedure
    .input(z.object({ customerId: id.optional(), limit: z.number().int().min(1).max(500).default(100), offset: z.number().int().min(0).default(0) }))
    .query(async ({ ctx, input }) => {
      const floor = await companyFloor(ctx.db, ctx.companyId);
      const t = zonedYmd(floor.timezone, clockNow().getTime());
      const today = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;
      const filter = {
        customerId: input.customerId,
        statuses: ["confirmed", "dispatching"] as const,
        withBaki: true,
        orderDateBefore: ymdMinusDays(today, LATE_AFTER_DAYS),
      };
      const [page, totals] = await Promise.all([
        lineBalancePage(ctx.db, ctx.companyId, filter, { limit: input.limit, offset: input.offset }),
        lineTotals(ctx.db, ctx.companyId, filter),
      ]);
      return {
        today,
        lines: page.lines.map((l) => ({ ...l, daysOpen: daysBetween(l.orderDate, today) })),
        totals,
        nextOffset: page.nextOffset,
      };
    }),

  /** Suggested line for a bundle (OP §6): oldest open line with baki for customer + die + cut length, else customer + die. */
  suggestLine: companyProcedure
    .input(z.object({ customerId: id, sectionId: id, cutLengthMm: z.number().int().min(1).max(30_000).optional() }))
    .query(async ({ ctx, input }) => {
      const got = await suggestedLine(ctx.db, ctx.companyId, {
        customerId: input.customerId,
        dieId: input.sectionId,
        cutLengthMm: input.cutLengthMm,
      });
      return got ? { ...got.line, match: got.match } : null;
    }),
};

const REALLOCATION_STATUS_TO_APPROVAL = { pending: "pending", applied: "approved", rejected: "rejected" } as const;
const APPROVAL_TO_REALLOCATION_STATUS = { pending: "pending", approved: "applied", rejected: "rejected" } as const;

/** Order line, order, PO and customer name of these lines (a reallocation's from / to). */
async function reallocationLines(db: OrrnDb, companyId: string, lineIds: readonly string[]) {
  const out: {
    lineId: string;
    lineNo: number;
    cutLengthMm: number;
    orderId: string;
    orderNumber: string;
    orderPeriod: string;
    poNumber: string | null;
    orderStatus: string;
    customerId: string;
    customerName: string;
  }[] = [];
  for (const part of chunk([...lineIds], 80)) {
    const rows = await db
      .select({
        lineId: salesOrderLine.id,
        lineNo: salesOrderLine.lineNo,
        cutLengthMm: salesOrderLine.cutLengthMm,
        orderId: salesOrder.id,
        orderNumber: salesOrder.number,
        orderPeriod: salesOrder.period,
        poNumber: salesOrder.poNumber,
        orderStatus: salesOrder.status,
        customerId: salesOrder.customerId,
        customerName: customer.name,
      })
      .from(salesOrderLine)
      .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, companyId)))
      .innerJoin(customer, and(eq(customer.id, salesOrder.customerId), eq(customer.companyId, companyId)))
      .where(and(eq(salesOrderLine.companyId, companyId), inArray(salesOrderLine.id, part)));
    out.push(...rows);
  }
  return out;
}

/** Strip + confirm data for `orders.get` (kept here so the PL-8 router file stays small). */
export async function orderDetailExtras(
  db: OrrnDb,
  companyId: string,
  order: { id: string; poNumber: string | null; status: string },
  opts: { showRates: boolean },
) {
  const lines = await orderLines(db, companyId, order.id);
  const strips = await lineStrips(db, companyId, lines.map((l) => l.id));
  const blockers = order.status === "booking" ? await orderConfirmBlockers(db, companyId, order) : [];
  return {
    confirmBlockers: blockers,
    lineDetails: lines.map((l) => ({
      lineId: l.id,
      dieInstanceId: l.dieInstanceId,
      tierRank: l.tierRank,
      qtyBasis: l.qtyBasis,
      impliedG: l.impliedG,
      weightBasis: l.weightBasis,
      bandStartMilli: l.bandStartMilli,
      copyMilli: l.copyMilli,
      readingId: l.readingId,
      basisNote: l.basisNote,
      alloy: l.alloy,
      temper: l.temper,
      ...(opts.showRates ? { ratePaise: l.ratePaise } : {}),
      strip: strips.get(l.id)!,
    })),
  };
}
