/**
 * Sales order maths shared by the orders router, dispatch and reports (spec P13, PL-8).
 *
 * - ordered    = the line's kg / pcs.
 * - produced   = non-void bundles whose `sales_order_line_id` is the line (set at pack time; a
 *                completed dispatch sets it to the line the item was linked to, or NULL when the
 *                bundle left unlinked, so produced includes dispatched and never what left for others).
 * - dispatched = bundles of COMPLETED, not deleted dispatches whose item is linked to the line.
 * - baki       = ordered − dispatched, floored at 0 (never shown negative); the excess is `overG`.
 *
 * Every figure is an integer (grams, pieces); every subquery is scoped by company explicitly, so a
 * forged cross-company link (foreign keys do not check the company) adds nothing.
 *
 * Rows never get cut silently: `lineBalances` throws past MAX_LINE_ROWS, screens page with
 * `lineBalancePage`, and report totals come from SQL (`lineTotals`, `orderTotals`), never from a sum
 * over a page of rows.
 */
import { and, asc, desc, eq, inArray, isNotNull, sql, type SQL } from "drizzle-orm";

import { approval } from "@orrn/db/schema/approval";
import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dispatchItem } from "@orrn/db/schema/dispatch";
import { bundle } from "@orrn/db/schema/inventory";
import { packingListLine } from "@orrn/db/schema/packing";
import { company } from "@orrn/db/schema/tenant";
import {
  openSalesOrderStatuses,
  salesOrder,
  salesOrderLine,
  type SalesOrderStatus,
} from "@orrn/db/schema/sales";

import { chunk, type OrrnDb, type SqliteBatchItem } from "./atomic";

/** Fallback when neither the customer nor the company sets one: 5 % of the line's kg. */
export const DEFAULT_ORDER_TOLERANCE_BP = 500;
export const MAX_ORDER_TOLERANCE_BP = 10_000;

/** The tolerance that applies to a customer: their own, else `settings.orderToleranceBp`, else 5 %. */
export function effectiveToleranceBp(
  customerBp: number | null | undefined,
  settings: Record<string, unknown> | null | undefined,
): number {
  const ok = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_ORDER_TOLERANCE_BP;
  if (ok(customerBp)) return customerBp;
  const fromSettings = settings?.orderToleranceBp;
  return ok(fromSettings) ? fromSettings : DEFAULT_ORDER_TOLERANCE_BP;
}

/** Most kg a line may receive without an override: ordered + floor(ordered × bp / 10 000). */
export function lineLimitG(orderedG: number, bp: number): number {
  return orderedG + Math.floor((orderedG * bp) / 10_000);
}

export type LineBalance = {
  lineId: string;
  orderId: string;
  orderNumber: string;
  orderStatus: SalesOrderStatus;
  orderDate: string;
  poNumber: string | null;
  customerId: string;
  customerName: string;
  lineNo: number;
  sectionId: string;
  sectionCode: string;
  series: string;
  sectionName: string | null;
  cutLengthMm: number;
  kgPer12ftMilli: number | null;
  finish: string | null;
  note: string | null;
  orderedG: number;
  orderedPcs: number | null;
  producedG: number;
  producedPcs: number;
  producedBundles: number;
  dispatchedG: number;
  dispatchedPcs: number;
  dispatchedBundles: number;
  /** ordered − dispatched, never below 0. */
  bakiG: number;
  /** null when the line has no piece count. */
  bakiPcs: number | null;
  /** dispatched beyond ordered (0 when not over). */
  overG: number;
};

const num = (v: unknown) => (v == null ? 0 : Number(v));
const toMs = (v: Date | number | null) => (v instanceof Date ? v.getTime() : Number(v ?? 0));

/*
 * Correlated per-line figures. The company is the outer line's own `company_id` (the outer query is
 * scoped to the caller's company), so every inner row must belong to that same company without
 * binding a parameter per subquery: the analytics statements stay at a fixed, small parameter count.
 */

/** Non-void bundles packed for (or dispatched against) the outer line. */
function producedExpr(what: "g" | "pcs" | "n") {
  const agg = what === "g" ? sql`sum(b.weight_g)` : what === "pcs" ? sql`sum(b.quantity)` : sql`count(*)`;
  return sql<number>`(select coalesce(${agg}, 0) from bundle b where b.company_id = ${salesOrderLine.companyId} and b.sales_order_line_id = ${salesOrderLine.id} and b.status <> 'void')`;
}

/** Bundles of completed, live dispatches whose item is linked to the outer line. */
function dispatchedExpr(what: "g" | "pcs" | "n") {
  const agg = what === "g" ? sql`sum(b.weight_g)` : what === "pcs" ? sql`sum(b.quantity)` : sql`count(*)`;
  return sql<number>`(select coalesce(${agg}, 0) from dispatch_item di join dispatch d on d.id = di.dispatch_id and d.company_id = di.company_id join bundle b on b.id = di.bundle_id and b.company_id = di.company_id where di.company_id = ${salesOrderLine.companyId} and di.sales_order_line_id = ${salesOrderLine.id} and d.status = 'completed' and d.deleted_at is null)`;
}

export type LineFilter = {
  orderId?: string;
  customerId?: string;
  orderIds?: string[];
  dieIds?: string[];
  lineIds?: string[];
  /** Only lines of booking / confirmed / dispatching orders (shorthand for `statuses`). */
  openOnly?: boolean;
  statuses?: readonly SalesOrderStatus[];
  /** Only lines with baki left (ordered > dispatched), filtered in SQL before any limit or page. */
  withBaki?: boolean;
};

/** Most lines one `lineBalances` call returns. Past it the call throws (page with `lineBalancePage`). */
export const MAX_LINE_ROWS = 1000;
/** Id lists bind one parameter each: at most this many per statement (≤ 100 bound parameters in all). */
const ID_CHUNK = 80;

/** `lineBalances` would return more than MAX_LINE_ROWS lines: page or aggregate instead of cutting. */
export class LineLimitError extends Error {
  constructor() {
    super(`lineBalances: more than ${MAX_LINE_ROWS} order lines match; use lineBalancePage (rows) or lineTotals (sums)`);
    this.name = "LineLimitError";
  }
}

export type BalanceTotals = { lines: number; orderedG: number; producedG: number; dispatchedG: number; bakiG: number; overG: number };

type IdList = { lineIds?: string[]; dieIds?: string[]; orderIds?: string[] };
type IdKey = keyof IdList;

/** The one id list a filter carries (they are not combined), or null. */
function idListOf(filter: LineFilter): IdKey | null {
  return filter.lineIds ? "lineIds" : filter.dieIds ? "dieIds" : filter.orderIds ? "orderIds" : null;
}

/** WHERE for one statement over order lines; `ids` is at most ID_CHUNK long. */
function lineWhere(companyId: string, filter: LineFilter, ids: IdList): SQL | undefined {
  const statuses = filter.statuses ?? (filter.openOnly ? openSalesOrderStatuses : undefined);
  const conditions: (SQL | undefined)[] = [eq(salesOrderLine.companyId, companyId)];
  if (filter.orderId) conditions.push(eq(salesOrderLine.salesOrderId, filter.orderId));
  if (filter.customerId) conditions.push(eq(salesOrder.customerId, filter.customerId));
  if (statuses) conditions.push(inArray(salesOrder.status, [...statuses]));
  if (ids.lineIds) conditions.push(inArray(salesOrderLine.id, ids.lineIds));
  if (ids.dieIds) conditions.push(inArray(salesOrderLine.dieId, ids.dieIds));
  if (ids.orderIds) conditions.push(inArray(salesOrderLine.salesOrderId, ids.orderIds));
  if (filter.withBaki) conditions.push(sql`${salesOrderLine.kgG} > ${dispatchedExpr("g")}`);
  return and(...conditions);
}

// Joins pin the joined row to the line's company (column = column, no bound parameter).
const orderJoin = and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, salesOrderLine.companyId));
const customerJoin = and(eq(customer.id, salesOrder.customerId), eq(customer.companyId, salesOrderLine.companyId));
const dieJoin = and(eq(die.id, salesOrderLine.dieId), eq(die.companyId, salesOrderLine.companyId));

/** Oldest order first: order date, then entry time, then number (SO-9 before SO-10), then line no. */
const OLDEST_FIRST = [
  asc(salesOrder.orderDate),
  asc(salesOrder.createdAt),
  asc(sql`length(${salesOrder.number})`),
  asc(salesOrder.number),
  asc(salesOrderLine.lineNo),
];
const NEWEST_FIRST = [
  desc(salesOrder.orderDate),
  desc(salesOrder.createdAt),
  desc(sql`length(${salesOrder.number})`),
  desc(salesOrder.number),
  desc(salesOrderLine.lineNo),
];

function lineSelect(db: OrrnDb) {
  return db
    .select({
      lineId: salesOrderLine.id,
      orderId: salesOrder.id,
      orderNumber: salesOrder.number,
      orderStatus: salesOrder.status,
      orderDate: salesOrder.orderDate,
      poNumber: salesOrder.poNumber,
      orderCreatedAt: salesOrder.createdAt,
      customerId: salesOrder.customerId,
      customerName: customer.name,
      lineNo: salesOrderLine.lineNo,
      sectionId: salesOrderLine.dieId,
      sectionCode: die.sectionCode,
      series: die.series,
      sectionName: die.name,
      cutLengthMm: salesOrderLine.cutLengthMm,
      kgPer12ftMilli: salesOrderLine.kgPer12ftMilli,
      finish: salesOrderLine.finish,
      note: salesOrderLine.note,
      orderedG: salesOrderLine.kgG,
      orderedPcs: salesOrderLine.pcs,
      producedG: producedExpr("g"),
      producedPcs: producedExpr("pcs"),
      producedBundles: producedExpr("n"),
      dispatchedG: dispatchedExpr("g"),
      dispatchedPcs: dispatchedExpr("pcs"),
      dispatchedBundles: dispatchedExpr("n"),
    })
    .from(salesOrderLine)
    .innerJoin(salesOrder, orderJoin)
    .innerJoin(customer, customerJoin)
    .innerJoin(die, dieJoin);
}

type LineRow = Awaited<ReturnType<ReturnType<typeof lineSelect>["where"]>>[number];

function toBalance({ orderCreatedAt: _created, ...r }: LineRow): LineBalance {
  const orderedG = num(r.orderedG);
  const dispatchedG = num(r.dispatchedG);
  const dispatchedPcs = num(r.dispatchedPcs);
  return {
    ...r,
    orderedG,
    orderedPcs: r.orderedPcs == null ? null : Number(r.orderedPcs),
    producedG: num(r.producedG),
    producedPcs: num(r.producedPcs),
    producedBundles: num(r.producedBundles),
    dispatchedG,
    dispatchedPcs,
    dispatchedBundles: num(r.dispatchedBundles),
    bakiG: Math.max(0, orderedG - dispatchedG),
    bakiPcs: r.orderedPcs == null ? null : Math.max(0, Number(r.orderedPcs) - dispatchedPcs),
    overG: Math.max(0, dispatchedG - orderedG),
  };
}

async function pageRows(
  db: OrrnDb,
  companyId: string,
  filter: LineFilter,
  ids: IdList,
  page: { limit: number; offset: number; newestFirst?: boolean },
): Promise<{ rows: LineRow[]; more: boolean }> {
  const rows = await lineSelect(db)
    .where(lineWhere(companyId, filter, ids))
    .orderBy(...(page.newestFirst ? NEWEST_FIRST : OLDEST_FIRST))
    .limit(page.limit + 1)
    .offset(page.offset);
  const more = rows.length > page.limit;
  return { rows: more ? rows.slice(0, page.limit) : rows, more };
}

/**
 * One page of line balances, oldest order first (or newest first), in ONE statement: an id list may
 * carry at most 80 ids. `nextOffset` is null on the last page. Use `lineTotals` for sums over the
 * whole filter, never a sum over a page.
 */
export async function lineBalancePage(
  db: OrrnDb,
  companyId: string,
  filter: LineFilter,
  page: { limit: number; offset?: number; newestFirst?: boolean },
): Promise<{ lines: LineBalance[]; nextOffset: number | null }> {
  const key = idListOf(filter);
  const ids = key ? filter[key]! : null;
  if (ids && ids.length === 0) return { lines: [], nextOffset: null };
  if (ids && ids.length > ID_CHUNK) throw new Error(`lineBalancePage: at most ${ID_CHUNK} ids per call`);
  const limit = Math.max(1, Math.min(Math.trunc(page.limit), MAX_LINE_ROWS));
  const offset = Math.max(0, Math.trunc(page.offset ?? 0));
  const { rows, more } = await pageRows(db, companyId, filter, key ? { [key]: ids! } : {}, {
    limit,
    offset,
    newestFirst: page.newestFirst,
  });
  return { lines: rows.map(toBalance), nextOffset: more ? offset + limit : null };
}

/**
 * Every line balance the filter matches, oldest order first (order date, entry time, number, line
 * no). Never cuts silently: past MAX_LINE_ROWS lines it throws `LineLimitError`, so a report that
 * can grow must page (`lineBalancePage`) and sum in SQL (`lineTotals`, `orderTotals`).
 */
export async function lineBalances(db: OrrnDb, companyId: string, filter: LineFilter = {}): Promise<LineBalance[]> {
  const key = idListOf(filter);
  if (!key) {
    const { rows, more } = await pageRows(db, companyId, filter, {}, { limit: MAX_LINE_ROWS, offset: 0 });
    if (more) throw new LineLimitError();
    return rows.map(toBalance);
  }
  const ids = [...new Set(filter[key]!)];
  if (ids.length === 0) return [];
  const rows: LineRow[] = [];
  for (const part of chunk(ids, ID_CHUNK)) {
    const got = await pageRows(db, companyId, filter, { [key]: part }, { limit: MAX_LINE_ROWS, offset: 0 });
    if (got.more || rows.length + got.rows.length > MAX_LINE_ROWS) throw new LineLimitError();
    rows.push(...got.rows);
  }
  // Chunks come back one after another: restore the oldest-first order across them.
  rows.sort(
    (a, b) =>
      a.orderDate.localeCompare(b.orderDate) ||
      toMs(a.orderCreatedAt) - toMs(b.orderCreatedAt) ||
      a.orderNumber.length - b.orderNumber.length ||
      a.orderNumber.localeCompare(b.orderNumber) ||
      a.lineNo - b.lineNo,
  );
  return rows.map(toBalance);
}

/** Per-line figures as a derived table, for the SQL sums below (same joins and filters as the rows). */
function figuresTable(db: OrrnDb, companyId: string, filter: LineFilter, ids: IdList) {
  return db
    .select({
      orderId: sql<string>`${salesOrderLine.salesOrderId}`.as("order_id"),
      kgG: sql<number>`${salesOrderLine.kgG}`.as("kg_g"),
      producedG: producedExpr("g").as("produced_g"),
      dispatchedG: dispatchedExpr("g").as("dispatched_g"),
    })
    .from(salesOrderLine)
    .innerJoin(salesOrder, orderJoin)
    .innerJoin(customer, customerJoin)
    .innerJoin(die, dieJoin)
    .where(lineWhere(companyId, filter, ids))
    .as("t");
}

function sumsOf(t: ReturnType<typeof figuresTable>) {
  return {
    lines: sql<number>`count(*)`,
    orderedG: sql<number>`coalesce(sum(${t.kgG}), 0)`,
    producedG: sql<number>`coalesce(sum(${t.producedG}), 0)`,
    dispatchedG: sql<number>`coalesce(sum(${t.dispatchedG}), 0)`,
    // Baki and excess per line first (so one over-dispatched line never hides another's baki).
    bakiG: sql<number>`coalesce(sum(max(${t.kgG} - ${t.dispatchedG}, 0)), 0)`,
    overG: sql<number>`coalesce(sum(max(${t.dispatchedG} - ${t.kgG}, 0)), 0)`,
  };
}

const totalsOf = (r: Partial<Record<keyof BalanceTotals, unknown>> | undefined): BalanceTotals => ({
  lines: num(r?.lines),
  orderedG: num(r?.orderedG),
  producedG: num(r?.producedG),
  dispatchedG: num(r?.dispatchedG),
  bakiG: num(r?.bakiG),
  overG: num(r?.overG),
});

function addTotals(a: BalanceTotals, b: BalanceTotals): BalanceTotals {
  return {
    lines: a.lines + b.lines,
    orderedG: a.orderedG + b.orderedG,
    producedG: a.producedG + b.producedG,
    dispatchedG: a.dispatchedG + b.dispatchedG,
    bakiG: a.bakiG + b.bakiG,
    overG: a.overG + b.overG,
  };
}

/** Sums over EVERY line the filter matches, computed in SQL (no row cap): the totals of a report. */
export async function lineTotals(db: OrrnDb, companyId: string, filter: LineFilter = {}): Promise<BalanceTotals> {
  const key = idListOf(filter);
  const parts = key ? chunk([...new Set(filter[key]!)], ID_CHUNK).map((part) => ({ [key]: part })) : [{}];
  let total = totalsOf(undefined);
  for (const ids of parts) {
    const t = figuresTable(db, companyId, filter, ids);
    const [row] = await db.select(sumsOf(t)).from(t);
    total = addTotals(total, totalsOf(row));
  }
  return total;
}

/** Sums per order (GROUP BY in SQL) for a page of orders; orders with no lines are absent. */
export async function orderTotals(db: OrrnDb, companyId: string, orderIds: readonly string[]): Promise<Map<string, BalanceTotals>> {
  const out = new Map<string, BalanceTotals>();
  for (const part of chunk([...new Set(orderIds)], ID_CHUNK)) {
    const t = figuresTable(db, companyId, {}, { orderIds: part });
    const rows = await db
      .select({ orderId: t.orderId, ...sumsOf(t) })
      .from(t)
      .groupBy(sql`${t.orderId}`);
    for (const r of rows) out.set(r.orderId, totalsOf(r));
  }
  return out;
}

/** Totals over a set of line balances (baki summed per line, so one over-dispatched line never hides another's baki). */
export function sumBalances(lines: readonly LineBalance[]): BalanceTotals {
  const t = { lines: lines.length, orderedG: 0, producedG: 0, dispatchedG: 0, bakiG: 0, overG: 0 };
  for (const l of lines) {
    t.orderedG += l.orderedG;
    t.producedG += l.producedG;
    t.dispatchedG += l.dispatchedG;
    t.bakiG += l.bakiG;
    t.overG += l.overG;
  }
  return t;
}

type SuggestBundle = { id: string; dieId: string; weightG: number; salesOrderLineId: string | null };

/**
 * Order line to link each bundle to when it is scanned onto a dispatch (spec P13 "order line
 * suggested per bundle"; ruling PL8-R10 as amended in fix round 1):
 *   1. the line it was packed for, when that line is an open line of this customer and section;
 *   2. else the oldest open line of this customer and section that still has baki after what is
 *      already on this dispatch;
 *   3. else, when the customer has open lines for the section but none has baki left, the NEWEST of
 *      them, so kg beyond the order meets the dispatch_overdraw rule at completion (Review Focus 5)
 *      instead of leaving unlinked and unchecked.
 * Bundles of a section the customer has no open line for stay unlinked.
 */
export async function suggestLines(
  db: OrrnDb,
  companyId: string,
  input: { customerId: string; dispatchId: string; bundles: readonly SuggestBundle[] },
): Promise<Map<string, LineBalance>> {
  const out = new Map<string, LineBalance>();
  if (input.bundles.length === 0) return out;
  const dieIds = [...new Set(input.bundles.map((b) => b.dieId))];

  // Open lines with baki, oldest first (baki filtered in SQL). A scan adds at most 100 bundles and
  // each takes one line, so reading the oldest MAX_LINE_ROWS of them per chunk never changes a pick.
  const withBaki: LineBalance[] = [];
  for (const part of chunk(dieIds, ID_CHUNK)) {
    const page = await lineBalancePage(
      db,
      companyId,
      { customerId: input.customerId, dieIds: part, openOnly: true, withBaki: true },
      { limit: MAX_LINE_ROWS },
    );
    withBaki.push(...page.lines);
  }
  // Chunks split by section and picks only compare lines of one section, so each section's lines keep
  // the statement's oldest-first order and no re-sort across chunks is needed.
  // Packed-for lines count even with no baki left (rule 1).
  const packedForIds = [...new Set(input.bundles.flatMap((b) => (b.salesOrderLineId ? [b.salesOrderLineId] : [])))];
  const packedFor = new Map(
    (packedForIds.length
      ? await lineBalances(db, companyId, { customerId: input.customerId, lineIds: packedForIds, openOnly: true })
      : []
    ).map((l) => [l.lineId, l]),
  );

  const onThisDispatch = await db
    .select({
      lineId: dispatchItem.salesOrderLineId,
      g: sql<number>`coalesce(sum(${bundle.weightG}), 0)`,
    })
    .from(dispatchItem)
    .innerJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, companyId)))
    .where(
      and(
        eq(dispatchItem.companyId, companyId),
        eq(dispatchItem.dispatchId, input.dispatchId),
        isNotNull(dispatchItem.salesOrderLineId),
      ),
    )
    .groupBy(dispatchItem.salesOrderLineId);
  const pending = new Map(onThisDispatch.map((r) => [r.lineId as string, num(r.g)]));

  const remaining = new Map<string, number>();
  const remainingOf = (l: LineBalance) => {
    if (!remaining.has(l.lineId)) remaining.set(l.lineId, l.orderedG - l.dispatchedG - (pending.get(l.lineId) ?? 0));
    return remaining.get(l.lineId)!;
  };
  const byDie = new Map<string, LineBalance[]>();
  for (const l of withBaki) {
    const list = byDie.get(l.sectionId) ?? [];
    list.push(l);
    byDie.set(l.sectionId, list);
  }
  const fallback = new Map<string, LineBalance | null>();
  const fallbackFor = async (dieId: string) => {
    if (!fallback.has(dieId)) {
      const page = await lineBalancePage(
        db,
        companyId,
        { customerId: input.customerId, dieIds: [dieId], openOnly: true },
        { limit: 1, newestFirst: true },
      );
      fallback.set(dieId, page.lines[0] ?? null);
    }
    return fallback.get(dieId)!;
  };

  for (const b of input.bundles) {
    const own = b.salesOrderLineId ? packedFor.get(b.salesOrderLineId) : undefined;
    const pick =
      (own && own.sectionId === b.dieId ? own : undefined) ??
      (byDie.get(b.dieId) ?? []).find((l) => remainingOf(l) > 0) ??
      (await fallbackFor(b.dieId));
    if (!pick) continue;
    out.set(b.id, pick);
    remaining.set(pick.lineId, remainingOf(pick) - b.weightG);
  }
  return out;
}

export type OverdrawLine = {
  lineId: string;
  orderNumber: string;
  lineNo: number;
  sectionCode: string;
  orderedG: number;
  limitG: number;
  /** Already dispatched against the line by other completed dispatches. */
  otherDispatchedG: number;
  /** On this dispatch, linked to the line. */
  thisDispatchG: number;
  totalG: number;
  overG: number;
  /** An approved dispatch_overdraw request for this dispatch allows this line's total. */
  covered: boolean;
};

/** Bundle kg on dispatch items of `dispatchId` (or of completed dispatches) linked to the outer line `l`. */
function lineTotalSql(companyId: string, dispatchId: string) {
  return sql`(select coalesce(sum(b.weight_g), 0) from dispatch_item x join dispatch dx on dx.id = x.dispatch_id and dx.company_id = ${companyId} join bundle b on b.id = x.bundle_id and b.company_id = ${companyId} where x.company_id = ${companyId} and x.sales_order_line_id = l.id and ((dx.status = 'completed' and dx.deleted_at is null) or dx.id = ${dispatchId}))`;
}

/**
 * Write-time guard for the dispatch-complete UPDATE (Review Focus 5): no order line touched by this
 * dispatch ends up above ordered + tolerance unless an APPROVED dispatch_overdraw request for this
 * dispatch allows that line's total. It reads items, links and other completed dispatches inside the
 * statement, so a concurrent completion against the same line, or a link added after our read,
 * cannot slip an unapproved overdraw through.
 */
export function overdrawGuard(companyId: string, dispatchId: string, toleranceBp: number): SQL {
  const total = lineTotalSql(companyId, dispatchId);
  return sql`not exists (select 1 from sales_order_line l where l.company_id = ${companyId} and l.id in (select y.sales_order_line_id from dispatch_item y where y.company_id = ${companyId} and y.dispatch_id = ${dispatchId}) and ${total} > l.kg_g + cast((l.kg_g * cast(${toleranceBp} as integer)) / 10000 as integer) and not exists (select 1 from approval a, json_each(a.meta, '$.lines') j where a.company_id = ${companyId} and a.kind = 'dispatch_overdraw' and a.subject_id = ${dispatchId} and a.status = 'approved' and json_extract(j.value, '$.lineId') = l.id and json_extract(j.value, '$.totalG') >= ${total}))`;
}

/** Per order line linked on this dispatch: totals against the limit and approval coverage (read time). */
export async function dispatchOverdraw(
  db: OrrnDb,
  companyId: string,
  dispatchId: string,
  toleranceBp: number,
): Promise<OverdrawLine[]> {
  const rows = await db
    .select({
      lineId: salesOrderLine.id,
      orderNumber: salesOrder.number,
      lineNo: salesOrderLine.lineNo,
      sectionCode: die.sectionCode,
      orderedG: salesOrderLine.kgG,
      thisG: sql<number>`(select coalesce(sum(b.weight_g), 0) from dispatch_item x join bundle b on b.id = x.bundle_id and b.company_id = ${companyId} where x.company_id = ${companyId} and x.dispatch_id = ${dispatchId} and x.sales_order_line_id = ${salesOrderLine.id})`,
      otherG: sql<number>`(select coalesce(sum(b.weight_g), 0) from dispatch_item x join dispatch dx on dx.id = x.dispatch_id and dx.company_id = ${companyId} join bundle b on b.id = x.bundle_id and b.company_id = ${companyId} where x.company_id = ${companyId} and x.sales_order_line_id = ${salesOrderLine.id} and dx.status = 'completed' and dx.deleted_at is null and dx.id <> ${dispatchId})`,
    })
    .from(salesOrderLine)
    .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, companyId)))
    .innerJoin(die, and(eq(die.id, salesOrderLine.dieId), eq(die.companyId, companyId)))
    .where(
      and(
        eq(salesOrderLine.companyId, companyId),
        inArray(
          salesOrderLine.id,
          db
            .select({ id: dispatchItem.salesOrderLineId })
            .from(dispatchItem)
            .where(and(eq(dispatchItem.companyId, companyId), eq(dispatchItem.dispatchId, dispatchId))),
        ),
      ),
    )
    .orderBy(asc(salesOrder.number), asc(salesOrderLine.lineNo));
  if (rows.length === 0) return [];

  const approved = await db
    .select({ meta: approval.meta })
    .from(approval)
    .where(
      and(
        eq(approval.companyId, companyId),
        eq(approval.kind, "dispatch_overdraw"),
        eq(approval.subjectId, dispatchId),
        eq(approval.status, "approved"),
      ),
    );
  const allowed = new Map<string, number>();
  for (const a of approved) {
    const lines = (a.meta as { lines?: unknown })?.lines;
    if (!Array.isArray(lines)) continue;
    for (const l of lines as { lineId?: unknown; totalG?: unknown }[]) {
      if (typeof l?.lineId === "string" && typeof l.totalG === "number") {
        allowed.set(l.lineId, Math.max(allowed.get(l.lineId) ?? 0, l.totalG));
      }
    }
  }

  return rows.map((r) => {
    const orderedG = num(r.orderedG);
    const limitG = lineLimitG(orderedG, toleranceBp);
    const thisDispatchG = num(r.thisG);
    const otherDispatchedG = num(r.otherG);
    const totalG = otherDispatchedG + thisDispatchG;
    const overG = Math.max(0, totalG - limitG);
    return {
      lineId: r.lineId,
      orderNumber: r.orderNumber,
      lineNo: r.lineNo,
      sectionCode: r.sectionCode,
      orderedG,
      limitG,
      otherDispatchedG,
      thisDispatchG,
      totalG,
      overG,
      covered: overG === 0 || (allowed.get(r.lineId) ?? -1) >= totalG,
    };
  });
}

/** Statuses an order may be moved to by hand, from each status. `dispatching` is set by the server. */
export const ORDER_STATUS_MOVES: Record<SalesOrderStatus, readonly SalesOrderStatus[]> = {
  booking: ["confirmed", "closed", "cancelled"],
  confirmed: ["booking", "closed", "cancelled"],
  dispatching: ["closed"],
  closed: ["confirmed"],
  cancelled: [],
};

/**
 * A batch statement that fails the WHOLE batch unless `landed` holds at that point: it inserts a row
 * with a NULL id into `table` (NOT NULL violation), and inserts nothing when `landed` is true. D1
 * rolls a failed batch back, so the statements around it land all together or not at all. Catch the
 * error with `isBatchAbort(e, table)`.
 */
export function batchAbortUnless(
  db: OrrnDb,
  table: "sales_order_line" | "packing_list_line",
  landed: SQL,
): SqliteBatchItem {
  const nul = <T>(name: string) => sql<T | null>`null`.as(name);
  // Keys follow each table's column order (insert-select rule); every value is NULL.
  const from = db.select({ one: sql`1` }).from(company).limit(1).as("abort_src");
  if (table === "packing_list_line") {
    return db.insert(packingListLine).select(
      db
        .select({
          id: nul<string>("id"),
          companyId: nul<string>("company_id"),
          packingListId: nul<string>("packing_list_id"),
          bundleId: nul<string>("bundle_id"),
          dieId: nul<string>("die_id"),
          quantity: nul<number>("quantity"),
          weightG: nul<number>("weight_g"),
          lengthMm: nul<number>("length_mm"),
          groupLabel: nul<string>("group_label"),
        })
        .from(from)
        .where(sql`not (${landed})`) as never,
    );
  }
  return db.insert(salesOrderLine).select(
    db
      .select({
        id: nul<string>("id"),
        companyId: nul<string>("company_id"),
        serverSeq: nul<number>("server_seq"),
        salesOrderId: nul<string>("sales_order_id"),
        lineNo: nul<number>("line_no"),
        dieId: nul<string>("die_id"),
        kgPer12ftMilli: nul<number>("kg_per_12ft_milli"),
        cutLengthMm: nul<number>("cut_length_mm"),
        pcs: nul<number>("pcs"),
        kgG: nul<number>("kg_g"),
        finish: nul<string>("finish"),
        note: nul<string>("note"),
        createdBy: nul<string>("created_by"),
        createdAt: nul<number>("created_at"),
        updatedAt: nul<number>("updated_at"),
      })
      .from(from)
      .where(sql`not (${landed})`) as never,
  );
}

export function isBatchAbort(e: unknown, table: "sales_order_line" | "packing_list_line"): boolean {
  const needle = `NOT NULL constraint failed: ${table}.id`;
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    if ((cur instanceof Error ? cur.message : String(cur)).includes(needle)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** "1,234.567" — kg with Indian grouping and gram precision, for messages and documents. */
export function kgText(g: number, digits = 3): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
    g / 1000,
  );
}
