/**
 * The balance strip of an order line (FP-OP-05, specs §E2 "Balance strip per line"; C17) and the
 * queries that read it: late orders (FP-OP-18) and the suggested line for a bundle (Pack, Dispatch).
 * Baki itself is still computed only in `lib/orders.ts` (`dispatchedExpr`); this file adds the
 * figures between "ordered" and "dispatched":
 *
 * - plannedG  = kg on press plan lines of draft plans, and of released plans whose run for that
 *               die is still live (queued … counting). A logged run moves it to pressed; a voided
 *               run or a cancelled / closed plan drops it.
 * - loggedG   = good kg of LOGGED runs shared over the plan lines of that plan die by their kg
 *               (Wave 1: press_run_line, which carries the cut per line, lands in Wave 2).
 * - pressedG  = max(0, logged − aged − produced) (press log never reduces baki).
 * - agedG     = 0 until ageing rows exist (Wave 2/3, `ageing.forOrder`).
 * - packedG   = linked bundles available + reserved; inStockG = available only.
 * - overG     = max(0, produced − ordered).
 * - planableG = max(0, ordered − dispatched − packed − planned − pressed − aged) (`@orrn/domain`).
 *
 * Every subquery is scoped by the outer line's company (no parameter per subquery), and id lists
 * are chunked (≤ 80 ids per statement, D1's 100 bound parameters).
 */
import { planableG as planableOf } from "@orrn/domain";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import { salesOrderLine } from "@orrn/db/schema/sales";

import { chunk, type OrrnDb } from "./atomic";
import { lineBalancePage, type LineBalance, type LineFilter } from "./orders";

export type LineStrip = {
  orderedG: number;
  orderedPcs: number | null;
  producedG: number;
  dispatchedG: number;
  bakiG: number;
  bakiPcs: number | null;
  plannedG: number;
  pressedG: number;
  agedG: number;
  packedG: number;
  inStockG: number;
  /** Produced beyond ordered (the strip's "over" chip). */
  overG: number;
  planableG: number;
};

const ID_CHUNK = 80;
const num = (v: unknown) => (v == null ? 0 : Number(v));

const L = salesOrderLine;
/*
 * The outer line's columns, always table-qualified: in a single-table select drizzle prints a bare
 * "company_id", which inside a correlated subquery would resolve to the INNER table.
 */
const LC = sql`"sales_order_line"."company_id"`;
const LI = sql`"sales_order_line"."id"`;

function bundleSum(statuses: readonly string[]) {
  const list = sql.join(
    statuses.map((s) => sql.raw(`'${s}'`)),
    sql`, `,
  );
  return sql<number>`(select coalesce(sum(b.weight_g), 0) from bundle b where b.company_id = ${LC} and b.sales_order_line_id = ${LI} and b.status in (${list}))`;
}

/** Plan kg still ahead of the press for the outer line (optionally leaving one plan out). */
function plannedExpr(excludePlanId?: string) {
  const exclude = excludePlanId ? sql` and pl.press_plan_id <> ${excludePlanId}` : sql``;
  return sql<number>`(select coalesce(sum(pl.kg_g), 0) from press_plan_line pl join press_plan p on p.id = pl.press_plan_id and p.company_id = pl.company_id where pl.company_id = ${LC} and pl.sales_order_line_id = ${LI}${exclude} and (p.status = 'draft' or (p.status = 'released' and exists (select 1 from press_run r where r.company_id = pl.company_id and r.press_plan_die_id = pl.press_plan_die_id and r.status not in ('logged', 'voided')))))`;
}

/** Good kg of logged runs, shared over the plan die's lines by their planned kg (floored). */
const loggedExpr = sql<number>`(select coalesce(sum((r.good_g * pl.kg_g) / (select sum(x.kg_g) from press_plan_line x where x.company_id = pl.company_id and x.press_plan_die_id = pl.press_plan_die_id)), 0) from press_plan_line pl join press_run r on r.company_id = pl.company_id and r.press_plan_die_id = pl.press_plan_die_id where pl.company_id = ${LC} and pl.sales_order_line_id = ${LI} and r.status = 'logged' and r.good_g is not null)`;

const producedExpr = sql<number>`(select coalesce(sum(b.weight_g), 0) from bundle b where b.company_id = ${LC} and b.sales_order_line_id = ${LI} and b.status <> 'void')`;

function dispatchedExpr(what: "g" | "pcs") {
  const agg = what === "g" ? sql`sum(b.weight_g)` : sql`sum(b.quantity)`;
  return sql<number>`(select coalesce(${agg}, 0) from dispatch_item di join dispatch d on d.id = di.dispatch_id and d.company_id = di.company_id join bundle b on b.id = di.bundle_id and b.company_id = di.company_id where di.company_id = ${LC} and di.sales_order_line_id = ${LI} and d.status = 'completed' and d.deleted_at is null)`;
}

/** EXISTS: the line (`lineIdSql`) is on a released press plan (its figures are fixed). */
export function onReleasedPlan(companyId: string, lineIdSql: SQL): SQL {
  return sql`exists (select 1 from press_plan_line rpl join press_plan rp on rp.id = rpl.press_plan_id and rp.company_id = rpl.company_id where rpl.company_id = ${companyId} and rpl.sales_order_line_id = ${lineIdSql} and rp.status = 'released')`;
}

/**
 * Write-time twin of `planableG` for a plan's own lines (review round 1 I-2): EXISTS a line of
 * plan `planId` that is planned past what it may take, i.e. ordered − dispatched − packed −
 * planned (every live plan, this one included) − pressed − aged < 0. Put it in a
 * `batchAbortUnless(not …)` right after the plan lines (create) or the queued runs (release) are
 * written, so a pack, a dispatch or another plan landing after the read fails the batch whole.
 * The figures are the strip's own subqueries (`plannedExpr`, `loggedExpr`, …) on the outer line.
 */
export function planOverPlannedSql(companyId: string, planId: string): SQL {
  const pressed = sql`max(0, ${loggedExpr} - ${producedExpr})`;
  return sql`exists (select 1 from sales_order_line where ${LC} = ${companyId} and ${LI} in (select xpl.sales_order_line_id from press_plan_line xpl where xpl.company_id = ${companyId} and xpl.press_plan_id = ${planId}) and ("sales_order_line"."kg_g" - ${dispatchedExpr("g")} - ${bundleSum(["available", "reserved"])} - ${plannedExpr()} - ${pressed}) < 0)`;
}

export function stripOf(r: {
  orderedG: number;
  orderedPcs: number | null;
  producedG: number;
  dispatchedG: number;
  dispatchedPcs: number;
  plannedG: number;
  loggedG: number;
  packedG: number;
  inStockG: number;
}): LineStrip {
  const agedG = 0;
  const pressedG = Math.max(0, r.loggedG - agedG - r.producedG);
  return {
    orderedG: r.orderedG,
    orderedPcs: r.orderedPcs,
    producedG: r.producedG,
    dispatchedG: r.dispatchedG,
    bakiG: Math.max(0, r.orderedG - r.dispatchedG),
    bakiPcs: r.orderedPcs == null ? null : Math.max(0, r.orderedPcs - r.dispatchedPcs),
    plannedG: r.plannedG,
    pressedG,
    agedG,
    packedG: r.packedG,
    inStockG: r.inStockG,
    overG: Math.max(0, r.producedG - r.orderedG),
    planableG: planableOf({
      orderedG: r.orderedG,
      dispatchedG: r.dispatchedG,
      packedG: r.packedG,
      plannedG: r.plannedG,
      pressedG,
      agedG,
    }),
  };
}

/**
 * Strip figures for these lines of the company, keyed by line id. `excludePlanId` leaves that
 * plan's own quantity out of `plannedG` (release re-checks a plan against what is left for it).
 */
export async function lineStrips(
  db: OrrnDb,
  companyId: string,
  lineIds: readonly string[],
  opts: { excludePlanId?: string } = {},
): Promise<Map<string, LineStrip>> {
  const out = new Map<string, LineStrip>();
  for (const part of chunk([...new Set(lineIds)], ID_CHUNK)) {
    const rows = await db
      .select({
        id: L.id,
        orderedG: L.kgG,
        orderedPcs: L.pcs,
        producedG: producedExpr,
        dispatchedG: dispatchedExpr("g"),
        dispatchedPcs: dispatchedExpr("pcs"),
        plannedG: plannedExpr(opts.excludePlanId),
        loggedG: loggedExpr,
        packedG: bundleSum(["available", "reserved"]),
        inStockG: bundleSum(["available"]),
      })
      .from(L)
      .where(and(eq(L.companyId, companyId), inArray(L.id, part)));
    for (const r of rows) {
      out.set(
        r.id,
        stripOf({
          orderedG: num(r.orderedG),
          orderedPcs: r.orderedPcs == null ? null : Number(r.orderedPcs),
          producedG: num(r.producedG),
          dispatchedG: num(r.dispatchedG),
          dispatchedPcs: num(r.dispatchedPcs),
          plannedG: num(r.plannedG),
          loggedG: num(r.loggedG),
          packedG: num(r.packedG),
          inStockG: num(r.inStockG),
        }),
      );
    }
  }
  return out;
}

/** Days an order may run before it shows as late (OP §6). */
export const LATE_AFTER_DAYS = 15;

/** `YYYY-MM-DD` minus `days` calendar days. */
export function ymdMinusDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!) - days * 86_400_000);
  return t.toISOString().slice(0, 10);
}

/** Whole calendar days between two `YYYY-MM-DD` days (b − a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (v: string) => {
    const [y, m, d] = v.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/**
 * Suggested line for a bundle (OP §6): the oldest open line of this customer for this die AND cut
 * length that still has baki; else the oldest open line of this customer for the die with baki.
 */
export async function suggestedLine(
  db: OrrnDb,
  companyId: string,
  input: { customerId: string; dieId: string; cutLengthMm?: number | null },
): Promise<{ line: LineBalance; match: "die_and_length" | "die" } | null> {
  const base: LineFilter = { customerId: input.customerId, dieIds: [input.dieId], openOnly: true, withBaki: true };
  if (input.cutLengthMm != null) {
    const exact = await lineBalancePage(db, companyId, { ...base, cutLengthMm: input.cutLengthMm }, { limit: 1 });
    if (exact.lines[0]) return { line: exact.lines[0], match: "die_and_length" };
  }
  const any = await lineBalancePage(db, companyId, base, { limit: 1 });
  return any.lines[0] ? { line: any.lines[0], match: "die" } : null;
}
