/**
 * Report charts (W4-ANALYTICS), loaded with `lazy()` so the chart kit and d3 never reach the entry
 * chunk or a role that only reads the tables. Each chart sits in a ChartCard whose table view is
 * built from the same bars and the same format (chart kit rules). One unit per axis.
 */
import { formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { BarChart, ChartCard, barTable, chartDateFormat } from "@orrn/ui/charts";
import { useMemo } from "react";

import { orderMonthBars, orderMonthBuckets, recoveryBars, stockAgeBars, type OrdersData, type RecoveryData, type StockAgeData } from "./model";

const PLOT_HEIGHT = 220;
const kg = (v: number) => (v === 0 ? "0 kg" : `${formatKgTotal(v)} kg`);
const pct = (v: number) => `${v.toFixed(1)} %`;

export function RecoveryChart({ data }: { data: RecoveryData }) {
  const { t } = useT();
  const bars = useMemo(() => recoveryBars(data, t), [data, t]);
  const group = t(`reports.production.group.${data.groupBy}`);
  return (
    <ChartCard
      data-testid="chart-recovery"
      level={3}
      title={t("reports.production.chartTitle")}
      subtitle={group}
      plotHeight={PLOT_HEIGHT}
      state={bars.length === 0 ? "empty" : undefined}
      emptyTitle={t("reports.production.empty")}
      table={barTable(bars, { t, format: pct, labelHeader: group, valueHeader: t("reports.production.recovery") })}
    >
      <BarChart data={bars} format={pct} formatTicks={(ticks) => ticks.map((v) => `${v} %`)} height={PLOT_HEIGHT} label={t("reports.production.chartLabel")} />
    </ChartCard>
  );
}

export function StockAgeChart({ data }: { data: StockAgeData }) {
  const { t } = useT();
  const bars = useMemo(() => stockAgeBars(data, t), [data, t]);
  return (
    <ChartCard
      data-testid="chart-report-stock-age"
      level={2}
      title={t("reports.stockAge.chartTitle")}
      subtitle={t("reports.stockAge.chartSubtitle")}
      plotHeight={PLOT_HEIGHT}
      state={data.totals.bundles === 0 ? "empty" : undefined}
      emptyTitle={t("reports.stockAge.empty")}
      table={barTable(bars, { t, format: kg, labelHeader: t("reports.stockAge.ageHeader"), valueHeader: t("reports.stockAge.kgHeader") })}
    >
      <BarChart data={bars} format={kg} ordinal height={PLOT_HEIGHT} label={t("reports.stockAge.chartLabel")} />
    </ChartCard>
  );
}

/**
 * Ordered kg per order month: every month between the first and the last is a bar (an empty month
 * is a zero bar), bars carry their month start so the axis writes dated ticks, and the company's
 * current month is marked "so far" (chart kit rules). `to` is the period's end date, if any.
 */
export function OrderMonthsChart({ data, to }: { data: OrdersData; to?: string }) {
  const { t, locale } = useT();
  const dates = useMemo(() => chartDateFormat("month", locale, "UTC"), [locale]);
  const bars = useMemo(() => orderMonthBars(orderMonthBuckets(data.rows.map((r) => ({ key: r.key, orderedG: r.orderedG })), { today: data.today, to }), dates), [data, to, dates]);
  return (
    <ChartCard
      data-testid="chart-order-months"
      level={2}
      title={t("reports.orders.chartTitle")}
      plotHeight={PLOT_HEIGHT}
      state={bars.length === 0 ? "empty" : undefined}
      emptyTitle={t("reports.orders.empty")}
      table={barTable(bars, { t, format: kg, labelHeader: t("reports.orders.monthHeader"), valueHeader: t("reports.orders.kgHeader") })}
    >
      <BarChart data={bars} format={kg} formatDate={dates} height={PLOT_HEIGHT} label={t("reports.orders.chartLabel")} />
    </ChartCard>
  );
}
