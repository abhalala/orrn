import { useT } from "@orrn/i18n";
import { BarChart, ChartCard, barTable } from "@orrn/ui/charts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { trpc } from "@/shared/utils/trpc";

import { failedFirstLoad } from "./errors";
import { volumeBars, volumeDateFormat } from "./volume-data";
import { useWeightChart } from "@/shared/lib/weight-chart";

/**
 * Monthly kg dispatched, last 12 months with this month marked "so far"
 * (analytics addendum §4: Dispatch list, `analytics.view` only). Loaded
 * lazily from the dispatch list, so floor roles never download the chart
 * kit. No range control: one fixed window (see bulletin, chart kit crash
 * when bars shrink under hover).
 */
export default function DispatchVolumeChart() {
  const { t, locale } = useT();
  // Plotted in the plant's weight unit, so the gridlines and the labels agree (a lb plant reads lb on both).
  const wc = useWeightChart();
  const kg = (v: number) => wc.text(v);
  const query = useQuery(trpc.analytics.dispatchVolume.queryOptions({ months: 12 }));

  const data = useMemo(() => volumeBars(query.data ?? [], locale).map((d) => ({ ...d, value: wc.value(d.value) })), [query.data, locale, wc]);
  const dates = useMemo(() => volumeDateFormat(locale), [locale]);

  // Nothing dispatched in a year (a new company): no chart at all. The kit's empty
  // state asks for a longer period, which this card doesn't offer.
  if (query.isSuccess && data.every((d) => d.value === 0)) return null;
  const state = query.isPending ? "loading" : failedFirstLoad(query) ? "error" : undefined;

  return (
    <ChartCard
      data-testid="dispatch-volume"
      level={2}
      title={t("dispatch.volume.title")}
      subtitle={t("dispatch.volume.subtitle")}
      table={barTable(data, { t, format: kg, labelHeader: t("dispatch.volume.month"), valueHeader: t("dispatch.volume.kg") })}
      state={state}
      refreshing={query.isFetching && !query.isPending}
      onRetry={() => void query.refetch()}
    >
      <BarChart data={data} format={kg} formatTicks={wc.ticks} formatDate={dates} label={t("dispatch.volume.label")} />
    </ChartCard>
  );
}
