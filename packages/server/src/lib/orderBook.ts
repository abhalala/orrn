/**
 * The order book at a glance (FP-OP-20, BACKLOG 34): one kg bar per sales order and the header
 * strip over the same filter, both from ONE SQL statement text so the strip is the sum of the grid
 * by construction (a test asserts it).
 *
 * Per order line, with O ordered, D dispatched, A available on the line (in stock: the D-3B rule,
 * the same as the detail strip's `inStockG`), V reserved on a dispatch, H held in the yard for the
 * line and not already on it (FP-OP-17), R pressed-not-packed and L planned (the strip's own
 * subqueries, `lib/orderStrip.ts`), the bar segments are taken in order and capped so they add up
 * to the ordered kg:
 *
 *   dispatched = min(D, O)
 *   in stock   = min(A, O - dispatched)
 *   held       = min(V + H, O - dispatched - in stock)                (on a truck, or held for it)
 *   pressed    = min(R, O - dispatched - in stock - held)
 *   planned    = min(L, O - dispatched - in stock - held - pressed)
 *   rest       = O - dispatched - in stock - held - pressed - planned (not planned)
 *   over       = max(0, D + A + V + H + R + L - O)                   (its own chip)
 *
 * The bundle counts follow the same sets: `inStockBundles` counts A, `heldBundles` counts V + H
 * (review r1 I-5: "In stock X kg · N bundles" is one set).
 *
 * Segments are summed per order and over the filter. `dispatchedBp` = dispatched ÷ ordered in
 * basis points, rounded half up, so the bar's label is a share of ordered, never a bare figure.
 * Every figure is an integer in grams; the client only writes them down.
 *
 * Lateness is evaluated here in SQL with the same rule as `lateOf` (Q7 A).
 */
import { sql, type SQL } from "drizzle-orm";

import type { SalesOrderStatus } from "@orrn/db/schema/sales";

import type { OrrnDb } from "./atomic";
import {
  bundleSum,
  dispatchedExpr,
  heldSum,
  loggedExpr,
  plannedExpr,
  producedExpr,
} from "./orderStrip";

export const BOOK_STAGES = ["dispatched", "in_stock", "held", "pressed", "planned", "unplanned", "over"] as const;
export type BookStage = (typeof BOOK_STAGES)[number];

export type BookFilter = {
  statuses?: readonly SalesOrderStatus[];
  customerId?: string;
  /** Exact party city (the customer's billing address city, case-insensitive). */
  city?: string;
  search?: string;
  /** Order date range, inclusive, `YYYY-MM-DD`. */
  dateFrom?: string;
  dateTo?: string;
  /** Only orders with kg in this stage of the bar. */
  stage?: BookStage;
  /** Only late orders (FP-OP-18). */
  late?: boolean;
  /** Company calendar day and the order-date cutoff (today minus the late window). */
  today: string;
  cutoff: string;
};

export type BookBar = {
  dispatchedG: number;
  inStockG: number;
  /** Reserved on a dispatch, or held in the yard for the order (FP-OP-17). */
  heldG: number;
  pressedG: number;
  plannedG: number;
  /** Not planned yet. */
  restG: number;
  /** Pipeline kg beyond ordered (the "over" chip). */
  overG: number;
  /** Dispatched ÷ ordered, basis points, rounded half up (0 when nothing is ordered). */
  dispatchedBp: number;
};

export type BookRow = {
  id: string;
  period: string;
  number: string;
  customerId: string;
  customerName: string;
  city: string | null;
  poNumber: string | null;
  orderDate: string;
  expectedDate: string | null;
  status: SalesOrderStatus;
  createdAt: number;
  lines: number;
  orderedG: number;
  producedG: number;
  dispatchedG: number;
  bakiG: number;
  /** Dispatched beyond ordered, per line (the list's long-standing figure). */
  excessG: number;
  inStockBundles: number;
  heldBundles: number;
  late: boolean;
  bar: BookBar;
};

export type BookTotals = {
  orders: number;
  openOrders: number;
  lateOrders: number;
  lines: number;
  orderedG: number;
  dispatchedG: number;
  inStockG: number;
  heldG: number;
  pressedG: number;
  plannedG: number;
  restG: number;
  overG: number;
  bakiG: number;
  inStockBundles: number;
  heldBundles: number;
  dispatchedBp: number;
};

const num = (v: unknown) => (v == null ? 0 : Number(v));

/** Dispatched share of ordered in basis points, rounded half up. */
export function dispatchedBpOf(dispatchedG: number, orderedG: number): number {
  return orderedG > 0 ? Math.floor((dispatchedG * 10_000 * 2 + orderedG) / (orderedG * 2)) : 0;
}

/** Cities of the plant's customers that have orders (filter options), sorted. */
export async function bookCities(db: OrrnDb, companyId: string): Promise<string[]> {
  const rows = await db.all<{ city: string }>(
    sql`select distinct trim(json_extract(c.billing_address, '$.city')) as city from customer c where c.company_id = ${companyId} and c.deleted_at is null and trim(coalesce(json_extract(c.billing_address, '$.city'), '')) <> '' and exists (select 1 from sales_order o where o.company_id = c.company_id and o.customer_id = c.id) order by 1 collate nocase`,
  );
  return rows.map((r) => r.city);
}

const OPEN = sql`('booking', 'confirmed', 'dispatching')`;

/**
 * The `fo` CTE chain: one row per order in the filter, with its kg segments. `rates` adds the
 * rupee columns (ordered / dispatched / baki value in paise, lines with no rate) for the order
 * summary report; callers pass it only for `order.price` holders while `priceOnSalesOrder` is on.
 */
function bookCte(companyId: string, f: BookFilter, opts: { rates?: boolean } = {}): SQL {
  const where: SQL[] = [sql`sales_order_line.company_id = ${companyId}`];
  if (f.statuses && f.statuses.length > 0) {
    where.push(sql`sales_order.status in (${sql.join(f.statuses.map((s) => sql`${s}`), sql`, `)})`);
  }
  if (f.customerId) where.push(sql`sales_order.customer_id = ${f.customerId}`);
  if (f.city) where.push(sql`lower(trim(json_extract(customer.billing_address, '$.city'))) = lower(${f.city.trim()})`);
  if (f.dateFrom) where.push(sql`sales_order.order_date >= ${f.dateFrom}`);
  if (f.dateTo) where.push(sql`sales_order.order_date <= ${f.dateTo}`);
  if (f.search) {
    const pattern = `%${f.search}%`;
    where.push(sql`(sales_order.number like ${pattern} or sales_order.po_number like ${pattern} or customer.name like ${pattern})`);
  }

  const lateExpr = sql`(sales_order.status in ('confirmed', 'dispatching') and ord.baki_g > 0 and ((sales_order.expected_date is not null and sales_order.expected_date < ${f.today}) or (sales_order.expected_date is null and sales_order.order_date < ${f.cutoff})))`;
  const outer: SQL[] = [];
  if (f.late) outer.push(lateExpr);
  if (f.stage) {
    const col = {
      dispatched: sql`ord.dispatched_g`,
      in_stock: sql`ord.in_stock_g`,
      held: sql`ord.held_g`,
      pressed: sql`ord.pressed_g`,
      planned: sql`ord.planned_g`,
      unplanned: sql`ord.rest_g`,
      over: sql`ord.over_g`,
    }[f.stage];
    outer.push(sql`${col} > 0`);
  }

  return sql`with f as (
      select sales_order_line.id as lid, sales_order_line.sales_order_id as oid, sales_order_line.kg_g as o_g,
        ${dispatchedExpr("g")} as d_g,
        ${bundleSum(["available"])} as a_g,
        ${bundleSum(["reserved"])} as v_g,
        ${heldSum("g", true)} as h_g,
        ${plannedExpr()} as pl_g,
        max(0, ${loggedExpr} - ${producedExpr}) as r_g,
        ${producedExpr} as prod_g,
        ${opts.rates ? sql`sales_order_line.rate_paise as rate_p,` : sql``}
        (select count(*) from bundle ab where ab.company_id = sales_order_line.company_id and ab.sales_order_line_id = sales_order_line.id and ab.status = 'available') as in_n,
        (select count(*) from bundle vb where vb.company_id = sales_order_line.company_id and vb.sales_order_line_id = sales_order_line.id and vb.status = 'reserved')
          + (select count(*) from bundle hb where hb.company_id = sales_order_line.company_id and hb.held_for_line_id = sales_order_line.id and hb.status in ('available', 'reserved') and coalesce(hb.sales_order_line_id, '') <> sales_order_line.id) as held_n
      from sales_order_line
      join sales_order on sales_order.id = sales_order_line.sales_order_id and sales_order.company_id = sales_order_line.company_id
      join customer on customer.id = sales_order.customer_id and customer.company_id = sales_order_line.company_id
      where ${sql.join(where, sql` and `)}
    ),
    s1 as (select *, min(d_g, o_g) as ds, min(a_g, o_g - min(d_g, o_g)) as ss from f),
    s1h as (select *, min(v_g + h_g, o_g - ds - ss) as hs from s1),
    s2 as (select *, min(r_g, o_g - ds - ss - hs) as ps from s1h),
    s3 as (select *, min(pl_g, o_g - ds - ss - hs - ps) as ls from s2),
    ord as (
      select oid, count(*) as lines, sum(o_g) as ordered_g, sum(d_g) as raw_d_g, sum(ds) as dispatched_g, sum(ss) as in_stock_g,
        sum(hs) as held_g, sum(ps) as pressed_g, sum(ls) as planned_g, sum(o_g - ds - ss - hs - ps - ls) as rest_g,
        sum(max(0, d_g + a_g + v_g + h_g + r_g + pl_g - o_g)) as over_g, sum(prod_g) as produced_g,
        sum(max(o_g - d_g, 0)) as baki_g, sum(max(d_g - o_g, 0)) as excess_g, sum(in_n) as in_n, sum(held_n) as held_n
        ${
          opts.rates
            ? sql`, sum(case when rate_p is null then 0 else cast(round(o_g * rate_p / 1000.0) as integer) end) as ordered_v,
        sum(case when rate_p is null then 0 else cast(round(d_g * rate_p / 1000.0) as integer) end) as dispatched_v,
        sum(case when rate_p is null then 0 else cast(round(max(o_g - d_g, 0) * rate_p / 1000.0) as integer) end) as baki_v,
        sum(case when rate_p is null then 1 else 0 end) as rate_missing`
            : sql``
        }
      from s3 group by oid
    ),
    fo as (
      select ord.*, sales_order.period, sales_order.number, sales_order.customer_id, customer.name as customer_name,
        trim(json_extract(customer.billing_address, '$.city')) as city, sales_order.po_number, sales_order.order_date,
        sales_order.expected_date, sales_order.status, sales_order.created_at,
        case when ${lateExpr} then 1 else 0 end as is_late
      from ord
      join sales_order on sales_order.id = ord.oid
      join customer on customer.id = sales_order.customer_id and customer.company_id = sales_order.company_id
      ${outer.length > 0 ? sql`where ${sql.join(outer, sql` and `)}` : sql``}
    )`;
}

type FoRow = {
  oid: string;
  period: string;
  number: string;
  customer_id: string;
  customer_name: string;
  city: string | null;
  po_number: string | null;
  order_date: string;
  expected_date: string | null;
  status: SalesOrderStatus;
  created_at: number;
  is_late: number;
  lines: number;
  ordered_g: number;
  raw_d_g: number;
  dispatched_g: number;
  in_stock_g: number;
  held_g: number;
  pressed_g: number;
  planned_g: number;
  rest_g: number;
  over_g: number;
  produced_g: number;
  baki_g: number;
  excess_g: number;
  in_n: number;
  held_n: number;
};

function rowOf(r: FoRow): BookRow {
  const orderedG = num(r.ordered_g);
  const dispatchedG = num(r.dispatched_g);
  return {
    id: r.oid,
    period: r.period,
    number: r.number,
    customerId: r.customer_id,
    customerName: r.customer_name,
    city: r.city || null,
    poNumber: r.po_number,
    orderDate: r.order_date,
    expectedDate: r.expected_date,
    status: r.status,
    createdAt: num(r.created_at),
    lines: num(r.lines),
    orderedG,
    producedG: num(r.produced_g),
    // The list's dispatched kg is the raw figure (it can pass ordered); the bar caps it per line.
    dispatchedG: num(r.raw_d_g),
    bakiG: num(r.baki_g),
    excessG: num(r.excess_g),
    inStockBundles: num(r.in_n),
    heldBundles: num(r.held_n),
    late: num(r.is_late) === 1,
    bar: {
      dispatchedG,
      inStockG: num(r.in_stock_g),
      heldG: num(r.held_g),
      pressedG: num(r.pressed_g),
      plannedG: num(r.planned_g),
      restG: num(r.rest_g),
      overG: num(r.over_g),
      dispatchedBp: dispatchedBpOf(dispatchedG, orderedG),
    },
  };
}

/**
 * One page of the order book plus the strip over the WHOLE filter. `rows` are newest first
 * (created, then number length, then number), as the list always was.
 */
export async function orderBook(
  db: OrrnDb,
  companyId: string,
  filter: BookFilter,
  page: { limit: number; offset: number },
): Promise<{ rows: BookRow[]; total: number; totals: BookTotals }> {
  const rows = await db.all<FoRow>(
    sql`${bookCte(companyId, filter)} select * from fo order by created_at desc, length(number) desc, number desc limit ${page.limit} offset ${page.offset}`,
  );
  const totals = await bookTotals(db, companyId, filter);
  return { rows: rows.map(rowOf), total: totals.orders, totals };
}

/** The strip: sums over every order the filter matches (never over a page). */
export async function bookTotals(db: OrrnDb, companyId: string, filter: BookFilter): Promise<BookTotals> {
  const [r] = await db.all<Record<string, number>>(
    sql`${bookCte(companyId, filter)} select count(*) as orders, coalesce(sum(case when status in ${OPEN} then 1 else 0 end), 0) as open_orders,
      coalesce(sum(is_late), 0) as late_orders, coalesce(sum(lines), 0) as lines, coalesce(sum(ordered_g), 0) as ordered_g,
      coalesce(sum(dispatched_g), 0) as dispatched_g, coalesce(sum(in_stock_g), 0) as in_stock_g, coalesce(sum(held_g), 0) as held_g, coalesce(sum(pressed_g), 0) as pressed_g,
      coalesce(sum(planned_g), 0) as planned_g, coalesce(sum(rest_g), 0) as rest_g, coalesce(sum(over_g), 0) as over_g,
      coalesce(sum(baki_g), 0) as baki_g, coalesce(sum(in_n), 0) as in_n, coalesce(sum(held_n), 0) as held_n from fo`,
  );
  const orderedG = num(r?.ordered_g);
  const dispatchedG = num(r?.dispatched_g);
  return {
    orders: num(r?.orders),
    openOrders: num(r?.open_orders),
    lateOrders: num(r?.late_orders),
    lines: num(r?.lines),
    orderedG,
    dispatchedG,
    inStockG: num(r?.in_stock_g),
    heldG: num(r?.held_g),
    pressedG: num(r?.pressed_g),
    plannedG: num(r?.planned_g),
    restG: num(r?.rest_g),
    overG: num(r?.over_g),
    bakiG: num(r?.baki_g),
    inStockBundles: num(r?.in_n),
    heldBundles: num(r?.held_n),
    dispatchedBp: dispatchedBpOf(dispatchedG, orderedG),
  };
}

export const BOOK_SUMMARY_GROUPS = ["customer", "month"] as const;
export type BookSummaryGroup = (typeof BOOK_SUMMARY_GROUPS)[number];

/** Rupee figures of a summary row, in paise (only with `rates`). */
export type BookSummaryRates = {
  orderedValuePaise: number;
  dispatchedValuePaise: number;
  bakiValuePaise: number;
  /** Lines with no rate (their kg count, their value does not). */
  rateMissingLines: number;
};

export type BookSummaryRow = {
  /** Customer id, or the order month `YYYY-MM`. */
  key: string;
  label: string;
  orders: number;
  openOrders: number;
  lateOrders: number;
  lines: number;
  orderedG: number;
  /** Raw dispatched kg (as each order's list row; it can pass ordered). */
  dispatchedG: number;
  bakiG: number;
  /** Dispatched beyond ordered, per line. */
  excessG: number;
  /** Dispatched (capped per line) ÷ ordered, basis points half up. */
  dispatchedBp: number;
  rates?: BookSummaryRates;
};

/**
 * The order book summed by party or by order month (W4-ANALYTICS `/reports/orders`), from the SAME
 * `fo` CTE as the grid and the strip, so every summary row is the sum of its book rows and the
 * summary's total is the strip (`bookTotals`). Rupee columns only with `rates`.
 */
export async function bookSummary(
  db: OrrnDb,
  companyId: string,
  filter: BookFilter,
  groupBy: BookSummaryGroup,
  opts: { rates?: boolean; limit?: number } = {},
): Promise<BookSummaryRow[]> {
  const key = groupBy === "customer" ? sql`customer_id` : sql`substr(order_date, 1, 7)`;
  const label = groupBy === "customer" ? sql`max(customer_name)` : sql`substr(order_date, 1, 7)`;
  const order = groupBy === "customer" ? sql`sum(ordered_g) desc, lower(max(customer_name)), k` : sql`k desc`;
  const rateCols = opts.rates
    ? sql`, coalesce(sum(ordered_v), 0) as ordered_v, coalesce(sum(dispatched_v), 0) as dispatched_v, coalesce(sum(baki_v), 0) as baki_v, coalesce(sum(rate_missing), 0) as rate_missing`
    : sql``;
  const rows = await db.all<Record<string, string | number | null>>(
    sql`${bookCte(companyId, filter, { rates: opts.rates })} select ${key} as k, ${label} as label, count(*) as orders,
      coalesce(sum(case when status in ${OPEN} then 1 else 0 end), 0) as open_orders, coalesce(sum(is_late), 0) as late_orders,
      coalesce(sum(lines), 0) as lines, coalesce(sum(ordered_g), 0) as ordered_g, coalesce(sum(raw_d_g), 0) as raw_d_g,
      coalesce(sum(dispatched_g), 0) as dispatched_g, coalesce(sum(baki_g), 0) as baki_g, coalesce(sum(excess_g), 0) as excess_g ${rateCols}
      from fo group by k order by ${order} limit ${opts.limit ?? 500}`,
  );
  return rows.map((r) => {
    const orderedG = num(r.ordered_g);
    const row: BookSummaryRow = {
      key: String(r.k ?? ""),
      label: String(r.label ?? ""),
      orders: num(r.orders),
      openOrders: num(r.open_orders),
      lateOrders: num(r.late_orders),
      lines: num(r.lines),
      orderedG,
      dispatchedG: num(r.raw_d_g),
      bakiG: num(r.baki_g),
      excessG: num(r.excess_g),
      dispatchedBp: dispatchedBpOf(num(r.dispatched_g), orderedG),
    };
    if (opts.rates) {
      row.rates = {
        orderedValuePaise: num(r.ordered_v),
        dispatchedValuePaise: num(r.dispatched_v),
        bakiValuePaise: num(r.baki_v),
        rateMissingLines: num(r.rate_missing),
      };
    }
    return row;
  });
}
