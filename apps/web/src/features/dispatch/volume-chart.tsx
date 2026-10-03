import { formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { BarChart, ChartCard, barTable } from "@orrn/ui/charts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { trpc } from "@/shared/utils/trpc";

import { volumeBars } from "./volume-data";

const kg = (v: number) => `${formatKgTotal(v)} kg`;

/**
 * Monthly kg dispatched, last 12 months with this month marked "so far"
 * (analytics addendum §4: Dispatch list, `analytics.view` only). Loaded
 * lazily from the dispatch list, so floor roles never download the chart
 * kit. No range control: one fixed window (see bulletin, chart kit crash
 * when bars shrink under hover).
 */
export default function DispatchVolumeChart() {
  const { t, locale } = useT();
  const query = useQuery(trpc.analytics.dispatchVolume.queryOptions({ months: 12 }));

  const data = useMemo(() => volumeBars(query.data ?? [], locale), [query.data, locale]);

  // Nothing dispatched in a year (a new company): no chart at all. The kit's empty
  // state asks for a longer period, which this card doesn't offer.
  if (query.isSuccess && data.every((d) => d.value === 0)) return null;
  const state = query.isPending ? "loading" : query.isError ? "error" : undefined;

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
      <BarChart data={data} format={kg} label={t("dispatch.volume.label")} />
    </ChartCard>
  );
}
