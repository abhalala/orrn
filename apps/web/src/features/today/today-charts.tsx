/**
 * Today's two charts for `analytics.view` roles (analytics addendum §4):
 * 90 days of packed vs dispatched kg (two series, one axis, today drawn as
 * "so far") and stock age (kg by days since packing, ordinal ramp). Loaded
 * with `lazy()` from today-screen.tsx inside `<Can do="analytics.view">`, so
 * the chart kit and d3 never reach floor roles or the entry chunk.
 */
import { formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { EmptyState } from "@orrn/ui/components/empty-state";
import {
  BarChart,
  ChartCard,
  TimeSeriesChart,
  barTable,
  chartDateFormat,
  timeSeriesTable,
} from "@orrn/ui/charts";
import { useQuery } from "@tanstack/react-query";
import { useId, useMemo } from "react";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { ageingBars, trendSeries, type AgeBucket } from "./today-model";

const TREND_DAYS = 90;
const FIVE_MINUTES = 5 * 60_000;

const AGE_NAMES = {
  "0-15": ["today.ageing.upTo15", "today.ageing.upTo15Short"],
  "16-30": ["today.ageing.upTo30", "today.ageing.upTo30Short"],
  "31-60": ["today.ageing.upTo60", "today.ageing.upTo60Short"],
  "60+": ["today.ageing.over60", "today.ageing.over60Short"],
} as const satisfies Record<AgeBucket["key"], readonly [string, string]>;

export default function TodayCharts() {
  const { t, locale } = useT();
  const headingId = useId();
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

  const kg = useMemo(() => (v: number) => `${formatKgTotal(v)} ${t("units.kg")}`, [t]);
  // Days arrive as calendar dates; UTC midnight formatted in UTC keeps each label on its day.
  const dates = useMemo(() => chartDateFormat("day", locale, "UTC"), [locale]);
  const series = useMemo(
    () =>
      trendSeries(trends.data ?? [], {
        packed: t("today.trend.packed"),
        dispatched: t("today.trend.dispatched"),
      }),
    [trends.data, t],
  );
  const bars = useMemo(
    () =>
      ageingBars(ageing.data?.buckets ?? [], (key) => ({
        label: t(AGE_NAMES[key][0]),
        short: t(AGE_NAMES[key][1]),
      })),
    [ageing.data, t],
  );

  const trendQuiet = trends.data?.every((d) => d.packedKgG === 0 && d.dispatchedKgG === 0) ?? false;
  const nothingInStock = (ageing.data?.totals.bundles ?? 0) === 0;

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <h2 id={headingId} className="m-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">
        {t("today.trendsHeading")}
      </h2>
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <ChartCard
          data-testid="today-trend"
          className="lg:col-span-2"
          title={t("today.trend.title")}
          subtitle={t("today.trend.subtitle")}
          legend={{ series, shape: "line" }}
          table={timeSeriesTable(series, {
            t,
            format: kg,
            formatDate: dates.long,
            dateHeader: t("today.trend.dateHeader"),
          })}
          state={trends.isPending ? "loading" : trends.isError ? "error" : undefined}
          onRetry={() => void trends.refetch()}
          refreshing={trends.isFetching && !trends.isPending}
          plotHeight={260}
        >
          {trendQuiet ? (
            <EmptyState className="py-8" title={t("today.trend.emptyTitle")} body={t("today.trend.emptyBody")} />
          ) : (
            <TimeSeriesChart
              series={series}
              kind="line"
              format={kg}
              formatDate={dates}
              height={260}
              label={t("today.trend.label")}
            />
          )}
        </ChartCard>

        <ChartCard
          data-testid="today-ageing"
          title={t("today.ageing.title")}
          subtitle={t("today.ageing.subtitle")}
          table={barTable(bars, {
            t,
            format: kg,
            labelHeader: t("today.ageing.ageHeader"),
            valueHeader: t("today.ageing.valueHeader"),
          })}
          state={ageing.isPending ? "loading" : ageing.isError ? "error" : undefined}
          onRetry={() => void ageing.refetch()}
          refreshing={ageing.isFetching && !ageing.isPending}
          plotHeight={260}
        >
          {nothingInStock ? (
            <EmptyState className="py-8" title={t("today.ageing.emptyTitle")} body={t("today.ageing.emptyBody")} />
          ) : (
            <BarChart data={bars} format={kg} ordinal height={260} label={t("today.ageing.label")} />
          )}
        </ChartCard>
      </div>
    </section>
  );
}

