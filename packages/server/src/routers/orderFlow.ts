/**
 * Orders and planning, Wave 1 server (FP-OP-01…10, 18; specs §E2). These procedures are mounted on
 * the `orders` router beside the PL-8 ones (`salesOrder.ts` spreads `orderFlowProcedures`), so the
 * screens call `orders.confirm`, `orders.reallocate`, … Every number is computed here.
 *
 * Permissions: confirm / close / cancel / repriceWeight need `order.manage`; reallocate needs
 * `order.reallocate`; reads are open to members (no prices in them, ruling PL8-R1).
 * Audit: order.confirm / order.close / order.cancel / order.weight.refresh / order.reallocate.
 */
import { confirmBlockers, MAX_REALLOCATE_BUNDLES, reallocationCheck } from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import { auditLog } from "@orrn/db/schema/audit";
import { user } from "@orrn/db/schema/auth";
import { die } from "@orrn/db/schema/catalog";
import { dispatch } from "@orrn/db/schema/dispatch";
import { bundle } from "@orrn/db/schema/inventory";
import { reasonCode } from "@orrn/db/schema/reasons";
import { openSalesOrderStatuses, salesOrder, salesOrderLine, salesOrderWeightBases } from "@orrn/db/schema/sales";

import { actionProcedure, companyProcedure } from "../index";
import { requestApprovalInsert } from "../lib/approval";
import { auditInsert } from "../lib/audit";
import { atomicBatch, type OrrnDb, type SqliteBatchItem } from "../lib/atomic";
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
import { daysBetween, LATE_AFTER_DAYS, lineStrips, suggestedLine, ymdMinusDays } from "../lib/orderStrip";
import {
  bundlesPendingReallocation,
  isPlantStockSql,
  moveStatements,
  pendingReallocationOf,
  type ReallocateMeta,
  type TransferRow,
} from "../lib/reallocate";
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
              and(eq(salesOrder.id, order.id), eq(salesOrder.companyId, ctx.companyId), eq(salesOrder.status, order.status)),
            ),
          batchAbortUnless(ctx.db, "sales_order_line", orderLanded(ctx.companyId, order.id, seq)),
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
      }),
    )
    .query(async ({ ctx, input }) => {
      const floor = await companyFloor(ctx.db, ctx.companyId);
      const section = await loadSection(ctx.db, ctx.companyId, input.sectionId);
      const copies = await sectionCopies(ctx.db, ctx.companyId, section);
      if (input.dieInstanceId && !copies.some((c) => c.id === input.dieInstanceId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `That copy is not a live copy of ${section.sectionCode}` });
      }
      const basis = chooseBasis(section, copies, { pinnedCopyId: input.dieInstanceId, weightBasis: input.weightBasis });
      const qty = lineQty(input, basis.basisMilli, floor.unit);
      return {
        ...basis,
        ...qty,
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

  /** Order timeline (FP-OP-06): audit rows about the order, its lines and its reallocations, oldest first. */
  timeline: companyProcedure
    .input(z.object({ id, limit: z.number().int().min(1).max(200).default(100), offset: z.number().int().min(0).default(0) }))
    .query(async ({ ctx, input }) => {
      const order = await loadOrder(ctx.db, ctx.companyId, input.id);
      const actor = alias(user, "timeline_actor");
      const about = or(
        and(eq(auditLog.subjectType, "sales_order"), eq(auditLog.subjectId, order.id)),
        sql`json_extract(${auditLog.meta}, '$.orderId') = ${order.id}`,
        sql`exists (select 1 from json_each(${auditLog.meta}, '$.orderIds') j where j.value = ${order.id})`,
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
        if (!target && !b.lineId && Number(b.plant)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `${b.serial} is already plant stock` });
        }
        const check = reallocationCheck({
          bundle: {
            status: b.status,
            dieId: b.dieId,
            lengthMm: b.lengthMm,
            heldOnDispatchCode: b.dispatchCode ?? null,
            customerId: b.lineCustomerId ?? null,
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
        };
        const req = requestApprovalInsert(ctx, {
          kind: "order_reallocate",
          subjectId: batchId,
          serverSeq: seq,
          requestNote: reason,
          meta: meta as unknown as Record<string, unknown>,
        });
        await atomicBatch(ctx.db, [
          req.statement,
          auditInsert(ctx, {
            action: "order.reallocate",
            subjectType: "bundle_transfer",
            subjectId: batchId,
            meta: { status: "pending", approvalId: req.id, batchId, toLineId: target.lineId, orderIds, bundles: ids.length, kgG, reasonCode: reasonCodeValue },
          }),
        ]);
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
          sql`(select count(*) from bundle b where b.company_id = ${ctx.companyId} and b.server_seq = ${seq} and b.status = 'available' and ${target ? sql`b.sales_order_line_id = ${target.lineId}` : sql`b.sales_order_line_id is null`} and b.id in (select t.bundle_id from bundle_transfer t where t.company_id = ${ctx.companyId} and t.batch_id = ${batchId})) = ${ids.length}`,
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
          rank,
          lengthMatch,
        })
        .from(bundle)
        .leftJoin(nowLine, and(eq(nowLine.id, bundle.salesOrderLineId), eq(nowLine.companyId, ctx.companyId)))
        .leftJoin(nowOrder, and(eq(nowOrder.id, nowLine.salesOrderId), eq(nowOrder.companyId, ctx.companyId)))
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
        };
      });
      const ready = items.filter((i) => i.allocation === "plant" || i.allocation === "unassigned" || i.allocation === "same_customer");
      return { items, readyG: ready.reduce((s, i) => s + i.weightG, 0), readyBundles: ready.length };
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
