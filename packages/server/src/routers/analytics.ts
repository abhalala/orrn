/**
 * Role-gated analytics reads (analytics addendum §2 A1/A4/A5, §3; task PL-A1).
 *
 * - Every procedure is `actionProcedure("analytics.view")`: owner, admin, manager, office and
 *   accountant. Floor roles and viewer get FORBIDDEN.
 * - Tenant-scoped: every table in every statement is filtered or joined on `ctx.companyId`.
 * - Volume = completed dispatches only: `dispatch.status = 'completed'`, not soft-deleted, dated by
 *   `dispatch.completed_at` (set by `dispatch.complete`), weighed as the sum of its bundles' grams.
 * - Buckets and ranges are company-local calendar days (`settings.timezone`, IST default); dates are
 *   `YYYY-MM-DD` and both `from` and `to` are inclusive days (ruling RP10, as `purchase.register`):
 *   `from == to` is one day, and the query ends at the local midnight that starts the day after `to`.
 * - One join rule everywhere: dispatch LEFT JOIN item LEFT JOIN bundle, each scoped to the company,
 *   so a completed dispatch with no items counts as a dispatch of 0 kg.
 * - Aggregation happens in SQL (GROUP BY); no statement binds ids from JS, so the bound-parameter
 *   count is a small constant whatever the data size (D1 allows 100).
 * - Weights are integer grams (`…KgG`); formatting is the client's job.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { die } from "@orrn/db/schema/catalog";
import { customer } from "@orrn/db/schema/customers";
import { dispatch, dispatchItem } from "@orrn/db/schema/dispatch";
import { bundle } from "@orrn/db/schema/inventory";
import { packingList } from "@orrn/db/schema/packing";
import { company } from "@orrn/db/schema/tenant";

import type { OrrnDb } from "@orrn/db";
import { actionProcedure, router } from "../index";
import { now } from "../lib/clock";
import { companyTimezone } from "../lib/dayWindow";
import { lineTotals } from "../lib/orders";
import { productionDayWindowFor } from "../lib/productionDay";
import { isIsoDate } from "../lib/purchase";
import { analyticsReportProcedures } from "./analyticsReports";
import {
  addDays,
  addMonths,
  addYears,
  bucketKeyExpr,
  bucketStarts,
  daysBetween,
  localDate,
  localMidnight,
  zonedRange,
  type BucketUnit,
} from "../lib/zonedBuckets";

const DAY_MS = 86_400_000;
const MAX_RANGE_YEARS = 3;
const TOP_SECTIONS = 8;
const RECENT_DISPATCHES = 10;

const analyticsProcedure = actionProcedure("analytics.view");

// ── inputs ───────────────────────────────────────────────────────────────────

const isoDate = z.string().refine(isIsoDate, "Use a date like 2026-10-03");

/** from <= to (both inclusive days) and at most 3 calendar years: to < from + 3 years. */
function checkRange(r: { from: string; to: string }, ctx: z.RefinementCtx) {
  if (!isIsoDate(r.from) || !isIsoDate(r.to)) return;
  if (r.from > r.to) {
    ctx.addIssue({ code: "custom", message: "From must be on or before To", path: ["to"] });
  } else if (r.to >= addYears(r.from, MAX_RANGE_YEARS)) {
    ctx.addIssue({ code: "custom", message: `A range can cover at most ${MAX_RANGE_YEARS} years`, path: ["to"] });
  }
}

const summaryInput = z
  .object({
    customerId: z.string().min(1).max(64),
    from: isoDate,
    to: isoDate,
    bucket: z.enum(["week", "month"]).default("month"),
  })
  .superRefine(checkRange);

const leaderboardInput = z
  .object({ from: isoDate, to: isoDate, limit: z.number().int().min(1).max(25).default(10) })
  .superRefine(checkRange);

const customerKgInput = z.object({ from: isoDate, to: isoDate }).superRefine(checkRange);

const trendsInput = z.object({ days: z.number().int().min(1).max(366).default(90) });
const volumeInput = z.object({ months: z.number().int().min(1).max(36).default(12) });

// ── output types ─────────────────────────────────────────────────────────────

export type SectionShare = {
  /** `die.id` of the section; null on the folded "Other" row. */
  sectionId: string | null;
  label: string;
  kgG: number;
  bundles: number;
  sharePct: number;
};

/** Order book figures per customer (open orders' lines); null when the customer has no open order line. */
export type OpenOrders = { orderedG: number; dispatchedG: number; bakiG: number; lines: number };

export type CustomerSummary = {
  customer: { id: string; name: string };
  totals: { dispatches: number; bundles: number; kgG: number; pieces: number; avgLoadKgG: number };
  firstDispatchAt: string | null;
  lastDispatchAt: string | null;
  daysSinceLast: number | null;
  series: { bucketStart: string; kgG: number; dispatches: number }[];
  topSections: SectionShare[];
  recentDispatches: {
    id: string;
    code: string;
    completedAt: string;
    bundles: number;
    kgG: number;
    plNumber: string | null;
  }[];
  cadenceDays: number | null;
  openOrders: OpenOrders | null;
};

export type CustomerLeaderboard = {
  period: { from: string; to: string };
  previous: { from: string; to: string };
  rows: {
    customerId: string;
    name: string;
    kgG: number;
    sharePct: number;
    dispatches: number;
    rank: number;
    previousRank: number | null;
    deltaPct: number | null;
  }[];
  otherKgG: number;
  /** Share of `otherKgG`; with the rows' shares it sums to exactly 100.0 when `totalKgG` > 0. */
  otherSharePct: number;
  totalKgG: number;
};

/** kg column of the customers list: customers with completed dispatches in the period, most kg first. */
export type CustomerKg = {
  period: { from: string; to: string };
  rows: { customerId: string; kgG: number; dispatches: number }[];
};

export type TrendDay = { date: string; packedKgG: number; dispatchedKgG: number };

export type AgeBucketKey = "0-15" | "16-30" | "31-60" | "60+";
export type StockAgeing = {
  asOf: string;
  totals: { bundles: number; kgG: number };
  buckets: { key: AgeBucketKey; minDays: number; maxDays: number | null; bundles: number; kgG: number }[];
  topSections: SectionShare[];
};

export type DispatchMonth = { month: string; kgG: number; dispatches: number };

// ── helpers ──────────────────────────────────────────────────────────────────

const num = (v: unknown) => Number(v ?? 0);
const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Percentages to one decimal by the largest-remainder method, so they sum to exactly 100.0 when
 * `whole` > 0 and `parts` add up to `whole`. Works in integer tenths of a percent.
 */
function shares(parts: number[], whole: number): number[] {
  if (whole <= 0) return parts.map(() => 0);
  const tenths = parts.map((p) => Math.floor((p * 1000) / whole));
  const rest = parts.map((p, i) => ({ i, r: p * 1000 - tenths[i]! * whole }));
  let left = 1000 - tenths.reduce((t, x) => t + x, 0);
  rest.sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of rest) {
    if (left <= 0) break;
    tenths[i]! += 1;
    left -= 1;
  }
  return tenths.map((t) => t / 10);
}

/** Competition ranks (1, 1, 3) over values already sorted descending. */
function competitionRanks(sortedDesc: number[]): number[] {
  const out: number[] = [];
  sortedDesc.forEach((v, i) => out.push(i > 0 && v === sortedDesc[i - 1] ? out[i - 1]! : i + 1));
  return out;
}

const toMs = (v: unknown) => (v instanceof Date ? v.getTime() : Number(v));
const iso = (v: unknown) => new Date(toMs(v)).toISOString();

function sectionLabel(r: { name: string | null; series: string; sectionCode: string }) {
  return r.name?.trim() ? r.name.trim() : `${r.series} ${r.sectionCode}`;
}

/** Top rows (already the top 8 by kg) plus an "Other" row for whatever the totals leave over. */
function foldSections(
  top: { dieId: string; name: string | null; series: string; sectionCode: string; kgG: unknown; bundles: unknown }[],
  totalKgG: number,
  totalBundles: number,
): SectionShare[] {
  const rows: SectionShare[] = top.map((r) => ({
    sectionId: r.dieId,
    label: sectionLabel(r),
    kgG: num(r.kgG),
    bundles: num(r.bundles),
    sharePct: 0,
  }));
  const otherKgG = totalKgG - rows.reduce((t, r) => t + r.kgG, 0);
  const otherBundles = totalBundles - rows.reduce((t, r) => t + r.bundles, 0);
  if (otherBundles > 0 || otherKgG > 0) {
    rows.push({ sectionId: null, label: "Other", kgG: otherKgG, bundles: otherBundles, sharePct: 0 });
  }
  const pcts = shares(rows.map((r) => r.kgG), totalKgG);
  rows.forEach((r, i) => (r.sharePct = pcts[i]!));
  return rows;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Completed, live dispatches of the caller's company. */
function completedDispatches(companyId: string): SQL {
  return and(eq(dispatch.companyId, companyId), eq(dispatch.status, "completed"), isNull(dispatch.deletedAt))!;
}

const itemsOfDispatch = (companyId: string) =>
  and(eq(dispatchItem.dispatchId, dispatch.id), eq(dispatchItem.companyId, companyId));
const bundleOfItem = (companyId: string) => and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, companyId));
const dieOfBundle = (companyId: string) => and(eq(die.id, bundle.dieId), eq(die.companyId, companyId));

async function timezoneOf(db: OrrnDb, companyId: string): Promise<string> {
  const [row] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  return companyTimezone(row?.settings);
}

// ── router ───────────────────────────────────────────────────────────────────

export const analyticsRouter = router({
  // W4-ANALYTICS office reports (reports.read): recovery, dieLife, stockAge, orders.
  ...analyticsReportProcedures,

  /**
   * One customer over the days from..to (inclusive): totals, a week or month series, top sections, cadence. First/last
   * dispatch, days since last and the 10 recent dispatches are all-time (not range-bound).
   */
  customerSummary: analyticsProcedure.input(summaryInput).query(async ({ ctx, input }): Promise<CustomerSummary> => {
    const companyId = ctx.companyId;
    const [timezone, [cust]] = await Promise.all([
      timezoneOf(ctx.db, companyId),
      ctx.db
        .select({ id: customer.id, name: customer.name })
        .from(customer)
        .where(and(eq(customer.id, input.customerId), eq(customer.companyId, companyId), isNull(customer.deletedAt)))
        .limit(1),
    ]);
    if (!cust) throw new TRPCError({ code: "NOT_FOUND", message: "Customer not found" });

    const unit: BucketUnit = input.bucket;
    const end = addDays(input.to, 1);
    const { fromMs, toMs: endMs, segments } = zonedRange(timezone, input.from, end);
    const mine = and(completedDispatches(companyId), eq(dispatch.customerId, cust.id));
    const inRange = and(mine, gte(dispatch.completedAt, new Date(fromMs)), lt(dispatch.completedAt, new Date(endMs)));
    const key = bucketKeyExpr(dispatch.completedAt, segments, unit);

    const recent = ctx.db
      .select({ id: dispatch.id, code: dispatch.code, completedAt: dispatch.completedAt, plNumber: dispatch.plNumber })
      .from(dispatch)
      .where(mine)
      .orderBy(desc(dispatch.completedAt), desc(dispatch.id))
      .limit(RECENT_DISPATCHES)
      .as("recent");

    const [seriesRows, [span], sectionRows, recentRows, cadenceRows] = await Promise.all([
      ctx.db
        .select({
          key,
          dispatches: sql<number>`count(distinct ${dispatch.id})`,
          bundles: sql<number>`count(${bundle.id})`,
          kgG: sql<number>`coalesce(sum(${bundle.weightG}), 0)`,
          pieces: sql<number>`coalesce(sum(${bundle.quantity}), 0)`,
        })
        .from(dispatch)
        .leftJoin(dispatchItem, itemsOfDispatch(companyId))
        .leftJoin(bundle, bundleOfItem(companyId))
        .where(inRange)
        .groupBy(key),
      ctx.db
        .select({
          first: sql<number | null>`min(${dispatch.completedAt})`,
          last: sql<number | null>`max(${dispatch.completedAt})`,
        })
        .from(dispatch)
        .where(mine),
      ctx.db
        .select({
          dieId: bundle.dieId,
          name: die.name,
          series: die.series,
          sectionCode: die.sectionCode,
          kgG: sql<number>`sum(${bundle.weightG})`,
          bundles: sql<number>`count(*)`,
        })
        .from(dispatch)
        .innerJoin(dispatchItem, itemsOfDispatch(companyId))
        .innerJoin(bundle, bundleOfItem(companyId))
        .innerJoin(die, dieOfBundle(companyId))
        .where(inRange)
        .groupBy(bundle.dieId)
        .orderBy(desc(sql`sum(${bundle.weightG})`), asc(bundle.dieId))
        .limit(TOP_SECTIONS),
      ctx.db
        .select({
          id: recent.id,
          code: recent.code,
          completedAt: recent.completedAt,
          bundles: sql<number>`count(${bundle.id})`,
          kgG: sql<number>`coalesce(sum(${bundle.weightG}), 0)`,
          // A scalar, never a join: revisions and combined lists share a dispatch, and a join would
          // count each bundle once per list. The dispatch's PL number, else the current revision
          // (nothing supersedes it, not combined away) of a list covering it.
          plNumber: sql<string | null>`coalesce(${recent.plNumber}, (select pl.code from ${packingList} pl where pl.company_id = ${companyId} and (pl.dispatch_id = ${recent.id} or exists (select 1 from packing_list_dispatch pd where pd.company_id = ${companyId} and pd.packing_list_id = pl.id and pd.dispatch_id = ${recent.id})) and pl.combined_into_id is null and not exists (select 1 from ${packingList} pn where pn.company_id = ${companyId} and pn.supersedes_id = pl.id) order by pl.created_at desc limit 1))`,
        })
        .from(recent)
        .leftJoin(dispatchItem, and(eq(dispatchItem.dispatchId, recent.id), eq(dispatchItem.companyId, companyId)))
        .leftJoin(bundle, bundleOfItem(companyId))
        .groupBy(recent.id, recent.code, recent.completedAt, recent.plNumber)
        .orderBy(desc(recent.completedAt), desc(recent.id)),
      ctx.db
        .select({ at: dispatch.completedAt })
        .from(dispatch)
        .where(inRange)
        .orderBy(asc(dispatch.completedAt)),
    ]);

    // Order book (PL-8): open orders' lines for this customer; null when there are none.
    // Sums in SQL over every open line (no row cap).
    const book = await lineTotals(ctx.db, companyId, { customerId: cust.id, openOnly: true });
    const openOrders: OpenOrders | null =
      book.lines === 0
        ? null
        : { orderedG: book.orderedG, dispatchedG: book.dispatchedG, bakiG: book.bakiG, lines: book.lines };

    const byKey = new Map(seriesRows.map((r) => [r.key, r]));
    const series = bucketStarts(input.from, end, unit).map((bucketStart) => {
      const r = byKey.get(bucketStart);
      return { bucketStart, kgG: num(r?.kgG), dispatches: num(r?.dispatches) };
    });
    const totals = { dispatches: 0, bundles: 0, kgG: 0, pieces: 0, avgLoadKgG: 0 };
    for (const r of seriesRows) {
      totals.dispatches += num(r.dispatches);
      totals.bundles += num(r.bundles);
      totals.kgG += num(r.kgG);
      totals.pieces += num(r.pieces);
    }
    totals.avgLoadKgG = totals.dispatches > 0 ? Math.round(totals.kgG / totals.dispatches) : 0;

    const times = cadenceRows.map((r) => toMs(r.at));
    const gaps = times.slice(1).map((t, i) => (t - times[i]!) / DAY_MS).sort((a, b) => a - b);

    const lastMs = span?.last == null ? null : toMs(span.last);
    const nowMs = now().getTime();
    return {
      customer: { id: cust.id, name: cust.name },
      totals,
      firstDispatchAt: span?.first == null ? null : iso(span.first),
      lastDispatchAt: lastMs === null ? null : iso(lastMs),
      daysSinceLast:
        lastMs === null ? null : Math.max(0, daysBetween(localDate(timezone, lastMs), localDate(timezone, nowMs))),
      series,
      topSections: foldSections(sectionRows, totals.kgG, totals.bundles),
      recentDispatches: recentRows.map((r) => ({
        id: r.id,
        code: r.code,
        completedAt: iso(r.completedAt),
        bundles: num(r.bundles),
        kgG: num(r.kgG),
        plNumber: r.plNumber ?? null,
      })),
      cadenceDays: gaps.length > 0 ? round1(median(gaps)) : null,
      openOrders,
    };
  }),

  /**
   * Who is leading over the days from..to (inclusive), against the same number of days immediately
   * before. Rows are live customers of this company with a completed dispatch in the period, ranked
   * by kg with competition ranks (equal kg → equal rank); ties are listed by lower(name), then id.
   * Soft-deleted (or unmatched) customers are never listed, but their kg stays in `otherKgG` and
   * `totalKgG`, so the total matches `dispatchVolume`.
   */
  customerLeaderboard: analyticsProcedure
    .input(leaderboardInput)
    .query(async ({ ctx, input }): Promise<CustomerLeaderboard> => {
      const companyId = ctx.companyId;
      const timezone = await timezoneOf(ctx.db, companyId);
      const days = daysBetween(input.from, input.to) + 1;
      const previous = { from: addDays(input.from, -days), to: addDays(input.from, -1) };
      const prevFromMs = localMidnight(timezone, previous.from);
      const fromMs = localMidnight(timezone, input.from);
      const endMs = localMidnight(timezone, addDays(input.to, 1));
      const current = sql`${dispatch.completedAt} >= ${fromMs}`;

      const rows = await ctx.db
        .select({
          customerId: dispatch.customerId,
          name: customer.name,
          listable: sql<number>`(${customer.id} is not null and ${customer.deletedAt} is null)`,
          kgG: sql<number>`coalesce(sum(case when ${current} then ${bundle.weightG} end), 0)`,
          dispatches: sql<number>`count(distinct case when ${current} then ${dispatch.id} end)`,
          prevKgG: sql<number>`coalesce(sum(case when ${dispatch.completedAt} < ${fromMs} then ${bundle.weightG} end), 0)`,
        })
        .from(dispatch)
        .leftJoin(customer, and(eq(customer.id, dispatch.customerId), eq(customer.companyId, companyId)))
        .leftJoin(dispatchItem, itemsOfDispatch(companyId))
        .leftJoin(bundle, bundleOfItem(companyId))
        .where(
          and(
            completedDispatches(companyId),
            gte(dispatch.completedAt, new Date(prevFromMs)),
            lt(dispatch.completedAt, new Date(endMs)),
          ),
        )
        .groupBy(dispatch.customerId);

      type Row = (typeof rows)[number] & { name: string };
      const listed = rows.filter((r): r is Row => num(r.listable) === 1 && r.name !== null);
      const byKg = (kgOf: (r: Row) => number) => (a: Row, b: Row) => {
        const an = a.name.toLowerCase();
        const bn = b.name.toLowerCase();
        return kgOf(b) - kgOf(a) || (an < bn ? -1 : an > bn ? 1 : 0) || (a.customerId < b.customerId ? -1 : 1);
      };

      const prevSorted = listed.filter((r) => num(r.prevKgG) > 0).sort(byKg((r) => num(r.prevKgG)));
      const prevRanks = competitionRanks(prevSorted.map((r) => num(r.prevKgG)));
      const prevRank = new Map(prevSorted.map((r, i) => [r.customerId, prevRanks[i]!]));

      const ranked = listed.filter((r) => num(r.dispatches) > 0).sort(byKg((r) => num(r.kgG)));
      const ranks = competitionRanks(ranked.map((r) => num(r.kgG)));
      const totalKgG = rows.reduce((t, r) => t + num(r.kgG), 0);
      const top = ranked.slice(0, input.limit);
      const topKgG = top.reduce((t, r) => t + num(r.kgG), 0);
      const otherKgG = totalKgG - topKgG;
      const pcts = shares([...top.map((r) => num(r.kgG)), otherKgG], totalKgG);
      return {
        period: { from: input.from, to: input.to },
        previous,
        rows: top.map((r, i) => {
          const kgG = num(r.kgG);
          const prevKgG = num(r.prevKgG);
          return {
            customerId: r.customerId,
            name: r.name,
            kgG,
            sharePct: pcts[i]!,
            dispatches: num(r.dispatches),
            rank: ranks[i]!,
            previousRank: prevRank.get(r.customerId) ?? null,
            deltaPct: prevKgG > 0 ? round1(((kgG - prevKgG) / prevKgG) * 100) : null,
          };
        }),
        otherKgG,
        otherSharePct: pcts.at(-1)!,
        totalKgG,
      };
    }),

  /**
   * Completed-dispatch kg and count per customer over the days from..to (inclusive): the kg column
   * of the customers list, which follows the leaderboard's period (task T23, ruling R33). Same join
   * rule as everywhere here; one GROUP BY, no id list bound (constant parameter count). Customers
   * with nothing in the period are absent, so the client reads them as 0. Soft-deleted customers'
   * rows are returned too (the client only looks up ids it lists).
   */
  customerKg: analyticsProcedure.input(customerKgInput).query(async ({ ctx, input }): Promise<CustomerKg> => {
    const companyId = ctx.companyId;
    const timezone = await timezoneOf(ctx.db, companyId);
    const fromMs = localMidnight(timezone, input.from);
    const endMs = localMidnight(timezone, addDays(input.to, 1));
    const kgG = sql<number>`coalesce(sum(${bundle.weightG}), 0)`;

    const rows = await ctx.db
      .select({
        customerId: dispatch.customerId,
        kgG,
        dispatches: sql<number>`count(distinct ${dispatch.id})`,
      })
      .from(dispatch)
      .leftJoin(dispatchItem, itemsOfDispatch(companyId))
      .leftJoin(bundle, bundleOfItem(companyId))
      .where(
        and(
          completedDispatches(companyId),
          gte(dispatch.completedAt, new Date(fromMs)),
          lt(dispatch.completedAt, new Date(endMs)),
        ),
      )
      .groupBy(dispatch.customerId)
      .orderBy(desc(kgG), asc(dispatch.customerId));

    return {
      period: { from: input.from, to: input.to },
      rows: rows.map((r) => ({ customerId: r.customerId, kgG: num(r.kgG), dispatches: num(r.dispatches) })),
    };
  }),

  /**
   * Daily packed vs dispatched kg for the last `days` company days, today last (Today chart).
   * Packed = bundles by pack time (`bundle.created_at`), void bundles left out.
   */
  trends: analyticsProcedure.input(trendsInput).query(async ({ ctx, input }): Promise<TrendDay[]> => {
    const companyId = ctx.companyId;
    const timezone = await timezoneOf(ctx.db, companyId);
    const at = now();
    const calendarToday = localDate(timezone, at.getTime());
    // FP-PF-05: Today's KPI blocks cover the production day; a night shift past midnight is still
    // yesterday's production day, so the trend ends there too and its "so far" day is the blocks'.
    const { productionDay } = await productionDayWindowFor(ctx.db, companyId, at);
    const today = productionDay < calendarToday ? productionDay : calendarToday;
    const from = addDays(today, -(input.days - 1));
    const to = addDays(today, 1);
    const { fromMs, toMs: endMs, segments } = zonedRange(timezone, from, to);
    const packedKey = bucketKeyExpr(bundle.createdAt, segments, "day");
    const shippedKey = bucketKeyExpr(dispatch.completedAt, segments, "day");

    const [packed, shipped] = await Promise.all([
      ctx.db
        .select({ key: packedKey, kgG: sql<number>`coalesce(sum(${bundle.weightG}), 0)` })
        .from(bundle)
        .where(
          and(
            eq(bundle.companyId, companyId),
            ne(bundle.status, "void"),
            gte(bundle.createdAt, new Date(fromMs)),
            lt(bundle.createdAt, new Date(endMs)),
          ),
        )
        .groupBy(packedKey),
      ctx.db
        .select({ key: shippedKey, kgG: sql<number>`coalesce(sum(${bundle.weightG}), 0)` })
        .from(dispatch)
        .leftJoin(dispatchItem, itemsOfDispatch(companyId))
        .leftJoin(bundle, bundleOfItem(companyId))
        .where(
          and(
            completedDispatches(companyId),
            gte(dispatch.completedAt, new Date(fromMs)),
            lt(dispatch.completedAt, new Date(endMs)),
          ),
        )
        .groupBy(shippedKey),
    ]);
    const packedBy = new Map(packed.map((r) => [r.key, num(r.kgG)]));
    const shippedBy = new Map(shipped.map((r) => [r.key, num(r.kgG)]));
    return bucketStarts(from, to, "day").map((date) => ({
      date,
      packedKgG: packedBy.get(date) ?? 0,
      dispatchedKgG: shippedBy.get(date) ?? 0,
    }));
  }),

  /**
   * In-stock bundles (available + reserved) by age = company calendar days from the pack date
   * (`bundle.created_at`) to today: 0–15, 16–30, 31–60, 60+ (61 and over), by kg and bundles; plus
   * the top 8 sections by kg and an "Other" row.
   */
  stockAgeing: analyticsProcedure.query(async ({ ctx }): Promise<StockAgeing> => {
    const companyId = ctx.companyId;
    const timezone = await timezoneOf(ctx.db, companyId);
    const nowMs = now().getTime();
    const today = localDate(timezone, nowMs);
    const inStock = and(eq(bundle.companyId, companyId), inArray(bundle.status, ["available", "reserved"]));
    // Packed on or after local midnight of (today − N) ⇔ at most N calendar days old. The edges are
    // server-computed integers inlined as literals (the CASE appears in SELECT and GROUP BY).
    const edge = (days: number) => sql.raw(String(localMidnight(timezone, addDays(today, -days))));
    const bucket = sql<number>`case when ${bundle.createdAt} >= ${edge(15)} then 0 when ${bundle.createdAt} >= ${edge(30)} then 1 when ${bundle.createdAt} >= ${edge(60)} then 2 else 3 end`;

    const [bucketRows, sectionRows] = await Promise.all([
      ctx.db
        .select({ bucket, bundles: sql<number>`count(*)`, kgG: sql<number>`coalesce(sum(${bundle.weightG}), 0)` })
        .from(bundle)
        .where(inStock)
        .groupBy(bucket),
      ctx.db
        .select({
          dieId: bundle.dieId,
          name: die.name,
          series: die.series,
          sectionCode: die.sectionCode,
          kgG: sql<number>`sum(${bundle.weightG})`,
          bundles: sql<number>`count(*)`,
        })
        .from(bundle)
        .innerJoin(die, dieOfBundle(companyId))
        .where(inStock)
        .groupBy(bundle.dieId)
        .orderBy(desc(sql`sum(${bundle.weightG})`), asc(bundle.dieId))
        .limit(TOP_SECTIONS),
    ]);

    const defs: { key: AgeBucketKey; minDays: number; maxDays: number | null }[] = [
      { key: "0-15", minDays: 0, maxDays: 15 },
      { key: "16-30", minDays: 16, maxDays: 30 },
      { key: "31-60", minDays: 31, maxDays: 60 },
      { key: "60+", minDays: 61, maxDays: null },
    ];
    const byBucket = new Map(bucketRows.map((r) => [num(r.bucket), r]));
    const buckets = defs.map((d, i) => ({
      ...d,
      bundles: num(byBucket.get(i)?.bundles),
      kgG: num(byBucket.get(i)?.kgG),
    }));
    const totals = {
      bundles: buckets.reduce((t, b) => t + b.bundles, 0),
      kgG: buckets.reduce((t, b) => t + b.kgG, 0),
    };
    return {
      asOf: new Date(nowMs).toISOString(),
      totals,
      buckets,
      topSections: foldSections(sectionRows, totals.kgG, totals.bundles),
    };
  }),

  /** Completed-dispatch kg and count per company month for the last `months`, this month last. */
  dispatchVolume: analyticsProcedure.input(volumeInput).query(async ({ ctx, input }): Promise<DispatchMonth[]> => {
    const companyId = ctx.companyId;
    const timezone = await timezoneOf(ctx.db, companyId);
    const thisMonth = `${localDate(timezone, now().getTime()).slice(0, 7)}-01`;
    const from = addMonths(thisMonth, -(input.months - 1));
    const to = addMonths(thisMonth, 1);
    const { fromMs, toMs: endMs, segments } = zonedRange(timezone, from, to);
    const key = bucketKeyExpr(dispatch.completedAt, segments, "month");

    const rows = await ctx.db
      .select({
        key,
        dispatches: sql<number>`count(distinct ${dispatch.id})`,
        kgG: sql<number>`coalesce(sum(${bundle.weightG}), 0)`,
      })
      .from(dispatch)
      .leftJoin(dispatchItem, itemsOfDispatch(companyId))
      .leftJoin(bundle, bundleOfItem(companyId))
      .where(
        and(
          completedDispatches(companyId),
          gte(dispatch.completedAt, new Date(fromMs)),
          lt(dispatch.completedAt, new Date(endMs)),
        ),
      )
      .groupBy(key);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return bucketStarts(from, to, "month").map((start) => ({
      month: start.slice(0, 7),
      kgG: num(byKey.get(start)?.kgG),
      dispatches: num(byKey.get(start)?.dispatches),
    }));
  }),
});
