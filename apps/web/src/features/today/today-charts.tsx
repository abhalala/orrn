/**
 * Today's two charts for `analytics.view` roles (analytics addendum §4):
 * 90 days of packed vs dispatched kg (two series, one axis, today drawn as
 * "so far") and stock age (kg by days since packing, ordinal ramp). Loaded
 * with `lazy()` from today-screen.tsx inside `<Can do="analytics.view">`, so
 * the chart kit and d3 never reach floor roles or the entry chunk.
 *
 * Kept in step with the KPI row above (`live`, from the polled
 * `dashboard.today`): today's trend point is the KPI figures themselves, and
 * whenever those figures change (a bundle packed, a dispatch done, midnight)
 * both charts refetch, so stock age follows "In stock" too.
 */
import { formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import {
  BarChart,
  ChartCard,
  TimeSeriesChart,
  barTable,
  chartDateFormat,
  timeSeriesTable,
} from "@orrn/ui/charts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import {
  ageingBars,
  formatCount,
  newestFirst,
  trendSeries,
  withLiveToday,
  type AgeBucket,
  type LiveToday,
} from "./today-model";

const TREND_DAYS = 90;
const FIVE_MINUTES = 5 * 60_000;

const AGE_NAMES = {
  "0-15": ["today.ageing.upTo15", "today.ageing.upTo15Short"],
  "16-30": ["today.ageing.upTo30", "today.ageing.upTo30Short"],
  "31-60": ["today.ageing.upTo60", "today.ageing.upTo60Short"],
  "60+": ["today.ageing.over60", "today.ageing.over60Short"],
} as const satisfies Record<AgeBucket["key"], readonly [string, string]>;

/** Card state from a query: data on screen wins; the error card only when there is nothing to show. */
function cardState(q: { data: unknown; isError: boolean }, empty: boolean): "loading" | "error" | "empty" | undefined {
  if (q.data === undefined) return q.isError ? "error" : "loading";
  return empty ? "empty" : undefined;
}

export type TodayChartsProps = {
  /** Today's figures from the KPI query, plus in-stock totals: a change refetches both charts. */
  live: LiveToday & { stockBundles: number; stockKg: number };
};

export default function TodayCharts({ live }: TodayChartsProps) {
  const { t, locale } = useT();
  // Each ChartCard shows its own error with Try again, so no global toast.
  const trends = useQuery({
    ...trpc.analytics.trends.queryOptions({ days: TREND_DAYS }),
    staleTime: FIVE_MINUTES,
    meta: INLINE_ERROR_META,
  });
  const ageing = useQuery({
    ...trpc.analytics.stockAgeing.queryOptions(),
    staleTime: FIVE_MINUTES,
    meta: INLINE_ERROR_META,
  });

  // The KPI figures moved on (polled every minute): refresh the charts behind them once.
  const signature = `${live.date}|${live.packedG}|${live.dispatchedG}|${live.stockBundles}|${live.stockKg}`;
  const lastSignature = useRef(signature);
  const { refetch: refetchTrends } = trends;
  const { refetch: refetchAgeing } = ageing;
  useEffect(() => {
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    void refetchTrends();
    void refetchAgeing();
  }, [signature, refetchTrends, refetchAgeing]);

  const kg = useMemo(() => (v: number) => `${formatKgTotal(v)} ${t("units.kg")}`, [t]);
  // Days arrive as calendar dates; UTC midnight formatted in UTC keeps each label on its day.
  const dates = useMemo(() => chartDateFormat("day", locale, "UTC"), [locale]);
  const { date, packedG, dispatchedG } = live;
  const days = useMemo(
    () => (trends.data ? withLiveToday(trends.data, { date, packedG, dispatchedG }) : []),
    [trends.data, date, packedG, dispatchedG],
  );
  const series = useMemo(
    () =>
      trendSeries(days, {
        packed: t("today.trend.packed"),
        dispatched: t("today.trend.dispatched"),
      }),
    [days, t],
  );
  // Newest first: today so far, then yesterday (the kit lists oldest first).
  const trendTable = useMemo(
    () =>
      newestFirst(
        timeSeriesTable(series, { t, format: kg, formatDate: dates.long, dateHeader: t("today.trend.dateHeader") }),
      ),
    [series, t, kg, dates],
  );
  const bars = useMemo(
    () =>
      ageingBars(ageing.data?.buckets ?? [], (key) => ({
        label: t(AGE_NAMES[key][0]),
        short: t(AGE_NAMES[key][1]),
      })),
    [ageing.data, t],
  );
  const ageingTable = useMemo(() => {
    const table = barTable(bars, {
      t,
      format: kg,
      labelHeader: t("today.ageing.ageHeader"),
      valueHeader: t("today.ageing.valueHeader"),
    });
    // The yard counts bundles: each age row also says how many.
    const buckets = ageing.data?.buckets ?? [];
    return {
      columns: [...table.columns, { key: "bundles", header: t("pack.columns.bundles"), numeric: true }],
      rows: table.rows.map((row, i) => ({ ...row, bundles: formatCount(buckets[i]?.bundles ?? 0) })),
    };
  }, [bars, ageing.data, kg, t]);

  const trendQuiet = days.every((d) => d.packedKgG === 0 && d.dispatchedKgG === 0);
  const nothingInStock = (ageing.data?.totals.bundles ?? 0) === 0;

  return (
    // The cards title themselves (h2, peers of the list sections); the region is named for landmarks.
    <section aria-label={t("today.trendsHeading")} className="@container min-w-0">
      <div className="grid min-w-0 grid-cols-1 gap-4 @[56rem]:grid-cols-3">
        <ChartCard
          data-testid="today-trend"
          className="@[56rem]:col-span-2"
          level={2}
          title={t("today.trend.title")}
          subtitle={t("today.trend.subtitle")}
          legend={{ series, shape: "line" }}
          table={trendTable}
          state={cardState(trends, trendQuiet)}
          emptyTitle={t("today.trend.emptyTitle")}
          emptyBody={t("today.trend.emptyBody")}
          onRetry={() => void trends.refetch()}
          plotHeight={260}
        >
          <TimeSeriesChart
            series={series}
            kind="line"
            format={kg}
            formatDate={dates}
            height={260}
            label={t("today.trend.label")}
          />
        </ChartCard>

        <ChartCard
          data-testid="today-ageing"
          level={2}
          title={t("today.ageing.title")}
          subtitle={t("today.ageing.subtitle")}
          table={ageingTable}
          state={cardState(ageing, nothingInStock)}
          emptyTitle={t("today.ageing.emptyTitle")}
          emptyBody={t("today.ageing.emptyBody")}
          onRetry={() => void ageing.refetch()}
          plotHeight={260}
        >
          <BarChart data={bars} format={kg} ordinal height={260} label={t("today.ageing.label")} />
        </ChartCard>
      </div>
    </section>
  );
}
