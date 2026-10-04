/**
 * Stock age and top sections (analytics addendum §4): for `analytics.view`
 * roles only, and loaded with `lazy()` from the Sections screen so the chart
 * kit never reaches the entry chunk or a floor role's download.
 */
import { formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { BarChart, ChartCard, RankedBars, barTable, rankedTable } from "@orrn/ui/charts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { trpc } from "@/shared/utils/trpc";

import { ageBars, topSectionRows } from "./charts-data";

// An empty age bucket reads "0 kg", not "0.0 kg".
const kg = (v: number) => (v === 0 ? "0 kg" : `${formatKgTotal(v)} kg`);
const PLOT_HEIGHT = 220;

export default function StockCharts({ labelFor }: { labelFor(dieId: string): string | undefined }) {
  const { t } = useT();
  const ageing = useQuery(trpc.analytics.stockAgeing.queryOptions());
  const data = ageing.data;

  const bars = useMemo(() => (data ? ageBars(data, t) : []), [data, t]);
  const top = useMemo(() => (data ? topSectionRows(data, labelFor) : { rows: [], other: 0 }), [data, labelFor]);

  const state = ageing.isPending ? "loading" : ageing.isError ? "error" : data && data.totals.bundles === 0 ? "empty" : undefined;
  const retry = () => void ageing.refetch();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="stock-charts">
      <ChartCard
        data-testid="chart-stock-age"
        level={2}
        title={t("stock.charts.ageTitle")}
        subtitle={t("stock.charts.ageSubtitle")}
        state={state}
        refreshing={ageing.isFetching && !ageing.isPending}
        onRetry={retry}
        plotHeight={PLOT_HEIGHT}
        table={barTable(bars, {
          t,
          format: kg,
          labelHeader: t("stock.charts.ageHeader"),
          valueHeader: t("stock.charts.kgHeader"),
        })}
      >
        <BarChart data={bars} format={kg} ordinal height={PLOT_HEIGHT} label={t("stock.charts.ageLabel")} />
      </ChartCard>

      <ChartCard
        data-testid="chart-top-sections"
        level={2}
        title={t("stock.charts.topTitle")}
        subtitle={t("stock.charts.topSubtitle")}
        state={state}
        refreshing={ageing.isFetching && !ageing.isPending}
        onRetry={retry}
        plotHeight={PLOT_HEIGHT}
        table={rankedTable(top.rows, {
          t,
          format: kg,
          valueHeader: t("stock.charts.kgHeader"),
          other: top.other,
          otherLabel: t("stock.charts.otherSections"),
        })}
      >
        <RankedBars
          rows={top.rows}
          other={top.other}
          otherLabel={t("stock.charts.otherSections")}
          format={kg}
          label={t("stock.charts.topLabel")}
        />
      </ChartCard>
    </div>
  );
}
