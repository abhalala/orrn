/**
 * Hold stock against a line (FP-OP-17, C9 "Put on sales order"; BACKLOG rank 32).
 *
 * The office picks yard bundles and holds them for an open line: `bundle.held_for_line_id` (0027).
 * The bundle stays `available` and on its own line (none, or the held line itself), so it still
 * counts as packed / in stock wherever it already did; the line's strip shows it as `heldG` and its
 * `planableG` takes off the held kg not already in `packedG` (lib/orderStrip.ts).
 *
 * - `orders.hold` / `orders.release` (`order.manage`) write `order.hold` / `order.release` audit rows;
 *   that is the history. No ledger rows: holding moves no kg.
 * - Every dispatch add path refuses a bundle held for an OPEN line of another customer with code
 *   `held_for_order` and "Held for SO-n (customer)"; held for this dispatch's customer it goes on,
 *   linked to the held line, and the hold ends when that dispatch completes (audited).
 * - `orders.reallocate` refuses a held bundle unless it moves to the very line it is held for.
 * - Closing or cancelling an order releases its holds in the same batch (audited).
 * - Voiding a held bundle releases its hold (D17; audited `order.release`, reason `voided`).
 */
import { holdBlocksDispatch } from "@orrn/domain";
import { and, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";

import { customer } from "@orrn/db/schema/customers";
import { bundle } from "@orrn/db/schema/inventory";
import { openSalesOrderStatuses, salesOrder, salesOrderLine } from "@orrn/db/schema/sales";

import type { Context } from "../context";
import { auditInsert, auditInsertGuarded } from "./audit";
import { chunk, mapInChunks, type OrrnDb, type SqliteBatchItem } from "./atomic";

/** The line a bundle is held for, with what a refusal and the screens need. */
export type BundleHold = {
  bundleId: string;
  serial: string;
  weightG: number;
  lineId: string;
  lineNo: number;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  orderOpen: boolean;
  heldAt: Date | null;
};

const ID_CHUNK = 80;

/** Holds of these bundles (company scoped, chunked), keyed by bundle id. Bundles not held are absent. */
export async function holdsOf(db: OrrnDb, companyId: string, bundleIds: readonly string[]): Promise<Map<string, BundleHold>> {
  const ids = [...new Set(bundleIds)];
  if (ids.length === 0) return new Map();
  const rows = await mapInChunks(ids, (part) =>
    db
      .select({
        bundleId: bundle.id,
        serial: bundle.serial,
        weightG: bundle.weightG,
        lineId: salesOrderLine.id,
        lineNo: salesOrderLine.lineNo,
        orderId: salesOrder.id,
        orderNumber: salesOrder.number,
        customerId: salesOrder.customerId,
        customerName: customer.name,
        status: salesOrder.status,
        heldAt: bundle.heldAt,
      })
      .from(bundle)
      .innerJoin(salesOrderLine, and(eq(salesOrderLine.id, bundle.heldForLineId), eq(salesOrderLine.companyId, companyId)))
      .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, companyId)))
      .innerJoin(customer, and(eq(customer.id, salesOrder.customerId), eq(customer.companyId, companyId)))
      .where(and(eq(bundle.companyId, companyId), inArray(bundle.id, part), isNotNull(bundle.heldForLineId))),
  );
  return new Map(
    rows.map(({ status, ...r }) => [r.bundleId, { ...r, orderOpen: (openSalesOrderStatuses as readonly string[]).includes(status) }]),
  );
}

/** The refusal sentence (English; clients word `scan.continuous.heldForOrder`). */
export function heldForOrderReason(orderNumber: string, customerName: string): string {
  return `Held for ${orderNumber} (${customerName})`;
}

/** A dispatch add refused by a hold: machine code, sentence, and the order it is held for. */
export type HeldForOrderBlock = {
  code: "held_for_order";
  reason: string;
  orderNumber: string;
  customerName: string;
  lineId: string;
};

/** `held_for_order` when the hold keeps the bundle off a dispatch of `dispatchCustomerId`, else null. */
export function heldForOrderBlock(hold: BundleHold | undefined, dispatchCustomerId: string): HeldForOrderBlock | null {
  if (!hold || !holdBlocksDispatch({ hold, dispatchCustomerId })) return null;
  return {
    code: "held_for_order",
    reason: heldForOrderReason(hold.orderNumber, hold.customerName),
    orderNumber: hold.orderNumber,
    customerName: hold.customerName,
    lineId: hold.lineId,
  };
}

/**
 * The line a scan should link a bundle to: the held line when it is held for an open line of this
 * dispatch's customer (pass it to `suggestLines` as the packed-for line), else the bundle's own line.
 */
export function linkLineFor(b: { id: string; salesOrderLineId: string | null }, holds: ReadonlyMap<string, BundleHold>, dispatchCustomerId: string): string | null {
  const h = holds.get(b.id);
  return h && h.orderOpen && h.customerId === dispatchCustomerId ? h.lineId : b.salesOrderLineId;
}

/**
 * Write-time guard SQL (for `batchAbortUnless(not …)`): EXISTS one of `bundleIds` held for an open
 * line of a customer other than `customerId`. A hold that lands between the read and the add fails
 * the add whole.
 */
export function heldForOtherCustomerSql(companyId: string, customerId: string, bundleIds: readonly string[]): SQL {
  const list = sql.join(
    bundleIds.map((id) => sql`${id}`),
    sql`, `,
  );
  return sql`exists (select 1 from bundle hb join sales_order_line hl on hl.id = hb.held_for_line_id and hl.company_id = hb.company_id join sales_order ho on ho.id = hl.sales_order_id and ho.company_id = hl.company_id where hb.company_id = ${companyId} and hb.id in (${list}) and ho.customer_id <> ${customerId} and ho.status in ('booking', 'confirmed', 'dispatching'))`;
}

/** Same, for every bundle listed on a dispatch (completion guard). */
export function dispatchHasForeignHoldSql(companyId: string, dispatchId: string, customerId: string): SQL {
  return sql`exists (select 1 from dispatch_item fdi join bundle hb on hb.id = fdi.bundle_id and hb.company_id = fdi.company_id join sales_order_line hl on hl.id = hb.held_for_line_id and hl.company_id = hb.company_id join sales_order ho on ho.id = hl.sales_order_id and ho.company_id = hl.company_id where fdi.company_id = ${companyId} and fdi.dispatch_id = ${dispatchId} and ho.customer_id <> ${customerId} and ho.status in ('booking', 'confirmed', 'dispatching'))`;
}

type AuditCtx = Pick<Context, "session" | "impersonation"> & { db: OrrnDb; companyId: string };

type ReleaseWhy = {
  reason: "dispatched" | "order_closed" | "order_cancelled" | "voided";
  dispatchId?: string;
  dispatchCode?: string;
};

/** The `order.release` audit input of one line's holds ended by something other than `orders.release`. */
function releaseAuditInput(list: readonly BundleHold[], why: ReleaseWhy) {
  const h = list[0]!;
  return {
    action: "order.release",
    subjectType: "sales_order_line",
    subjectId: h.lineId,
    meta: {
      orderId: h.orderId,
      orderNumber: h.orderNumber,
      lineNo: h.lineNo,
      reason: why.reason,
      ...(why.dispatchId ? { dispatchId: why.dispatchId, dispatchCode: why.dispatchCode ?? null } : {}),
      bundleIds: list.map((x) => x.bundleId),
      serials: list.map((x) => x.serial),
      kgG: list.reduce((s, x) => s + x.weightG, 0),
    },
  };
}

/** One `order.release` audit row per line, for holds ended by something other than `orders.release`. */
function releaseAudits(ctx: AuditCtx, holds: readonly BundleHold[], why: ReleaseWhy): SqliteBatchItem[] {
  const byLine = new Map<string, BundleHold[]>();
  for (const h of holds) byLine.set(h.lineId, [...(byLine.get(h.lineId) ?? []), h]);
  return [...byLine.values()].map((list) => auditInsert(ctx, releaseAuditInput(list, why)));
}

/**
 * D17: voiding a held bundle ends its hold. The void UPDATE clears `held_for_line_id` / `held_at`
 * itself; this is the `order.release` audit (reason `voided`) of the hold read before the write,
 * written only when the void landed (`landed`, a WHERE on `bundle`).
 */
export async function releaseOnVoidStatements(ctx: AuditCtx, bundleId: string, landed: SQL | undefined): Promise<SqliteBatchItem[]> {
  const hold = (await holdsOf(ctx.db, ctx.companyId, [bundleId])).get(bundleId);
  if (!hold) return [];
  return [auditInsertGuarded(ctx, releaseAuditInput([hold], { reason: "voided" }), { from: bundle, where: landed })];
}

/**
 * Dispatch completion: end the holds of the bundles leaving on it (the customer's own holds; a
 * foreign hold is refused before). Run inside the completion batch after its `landed` abort guard.
 */
export async function releaseOnDispatchStatements(
  ctx: AuditCtx,
  d: { id: string; code: string },
  bundleIds: readonly string[],
  seq: number,
): Promise<SqliteBatchItem[]> {
  const holds = [...(await holdsOf(ctx.db, ctx.companyId, bundleIds)).values()];
  if (holds.length === 0) return [];
  const out: SqliteBatchItem[] = [];
  for (const part of chunk(
    holds.map((h) => h.bundleId),
    ID_CHUNK,
  )) {
    out.push(
      ctx.db
        .update(bundle)
        .set({ heldForLineId: null, heldAt: null, serverSeq: seq })
        .where(and(eq(bundle.companyId, ctx.companyId), inArray(bundle.id, part), isNotNull(bundle.heldForLineId))),
    );
  }
  out.push(...releaseAudits(ctx, holds, { reason: "dispatched", dispatchId: d.id, dispatchCode: d.code }));
  return out;
}

/** Order close / cancel: end every hold on the order's lines (same batch as the status change). */
export async function releaseOrderHoldsStatements(
  ctx: AuditCtx,
  orderId: string,
  reason: "order_closed" | "order_cancelled",
  seq: number,
): Promise<SqliteBatchItem[]> {
  const held = await ctx.db
    .select({ id: bundle.id })
    .from(bundle)
    .innerJoin(salesOrderLine, and(eq(salesOrderLine.id, bundle.heldForLineId), eq(salesOrderLine.companyId, ctx.companyId)))
    .where(and(eq(bundle.companyId, ctx.companyId), eq(salesOrderLine.salesOrderId, orderId)));
  const holds = [...(await holdsOf(ctx.db, ctx.companyId, held.map((r) => r.id))).values()];
  const lines = sql`(select l.id from sales_order_line l where l.company_id = ${ctx.companyId} and l.sales_order_id = ${orderId})`;
  return [
    // Every hold of the order, including one placed after the read above (the audit lists what was read).
    ctx.db
      .update(bundle)
      .set({ heldForLineId: null, heldAt: null, serverSeq: seq })
      .where(and(eq(bundle.companyId, ctx.companyId), sql`${bundle.heldForLineId} in ${lines}`)),
    ...(holds.length > 0 ? releaseAudits(ctx, holds, { reason }) : []),
  ];
}
