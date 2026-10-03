/**
 * Purchase charts for `analytics.view` roles (analytics addendum: "Purchase
 * (PL-W2): vendor rate trend + kg by vendor"). Loaded with `lazy()` from the
 * lots page so the chart kit never reaches the entry chunk. One register read
 * (six calendar months to today) feeds both cards.
 */
import { useT } from "@orrn/i18n";
import {
  ChartCard,
  RankedBars,
  TimeSeriesChart,
  chartDateFormat,
  foldToOther,
  rankedTable,
  timeSeriesTable,
  type TimeSeries,
} from "@orrn/ui/charts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { trpc } from "@/shared/utils/trpc";

import { chartWindow, kgByVendor, monthlyRates } from "./chart-data";
import { kgText } from "./format";
import { useCompanyToday } from "./lot-ui";
import { formatRate } from "./lot-view";

const TOP_VENDORS = 8;
const RATE_SERIES = 3;

/** First day of a `YYYY-MM` month at midnight IST, the bucket start the kit expects. */
const monthStart = (month: string) => new Date(`${month}-01T00:00:00+05:30`);

export default function PurchaseCharts() {
  const { t, locale } = useT();
  const today = useCompanyToday();
  const range = useMemo(() => chartWindow(today), [today]);
  const register = useQuery(trpc.purchase.register.queryOptions({ from: range.from, to: range.to }));

  const monthDates = useMemo(() => chartDateFormat("month", locale), [locale]);
  const lots = useMemo(() => register.data?.lots ?? [], [register.data]);

  const rateSeries: TimeSeries[] = useMemo(
    () =>
      monthlyRates(lots, range.months, { maxSeries: RATE_SERIES }).map((s) => ({
        key: s.key,
        label: s.label,
        points: s.points.map((p) => ({ t: monthStart(p.month), v: p.v, partial: p.partial })),
      })),
    [lots, range.months],
  );
  const vendors = useMemo(() => foldToOther(kgByVendor(lots), TOP_VENDORS), [lots]);

  const rate = (v: number) => t("purchase.detail.perKg", { rate: formatRate(Math.round(v * 100)) });
  const kg = (v: number) => `${kgText(Math.round(v * 1000))} kg`;
  const state = register.isLoading ? "loading" : register.isError ? "error" : undefined;

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <ChartCard
        data-testid="purchase-chart-rate"
        level={2}
        title={t("purchase.charts.rateTitle")}
        subtitle={t("purchase.charts.rateSubtitle")}
        state={state ?? (rateSeries.length === 0 ? "empty" : undefined)}
        onRetry={() => register.refetch()}
        refreshing={register.isFetching && !register.isLoading}
        legend={rateSeries.length > 1 ? { series: rateSeries, shape: "line" } : undefined}
        table={timeSeriesTable(rateSeries, {
          t,
          format: rate,
          formatDate: monthDates.long,
          dateHeader: t("purchase.charts.month"),
        })}
      >
        <TimeSeriesChart
          series={rateSeries}
          kind={rateSeries.length > 1 ? "line" : "area"}
          format={rate}
          formatDate={monthDates}
          label={t("purchase.charts.rateLabel")}
        />
      </ChartCard>

      <ChartCard
        data-testid="purchase-chart-vendors"
        level={2}
        title={t("purchase.charts.vendorTitle")}
        subtitle={t("purchase.charts.vendorSubtitle")}
        state={state ?? (vendors.rows.length === 0 ? "empty" : undefined)}
        onRetry={() => register.refetch()}
        refreshing={register.isFetching && !register.isLoading}
        table={rankedTable(vendors.rows, {
          t,
          format: kg,
          valueHeader: t("purchase.charts.bought"),
          other: vendors.other,
          otherLabel: t("purchase.charts.otherVendors"),
        })}
      >
        <RankedBars
          rows={vendors.rows}
          other={vendors.other}
          otherLabel={t("purchase.charts.otherVendors")}
          format={kg}
          label={t("purchase.charts.vendorLabel")}
        />
      </ChartCard>
    </div>
  );
}
