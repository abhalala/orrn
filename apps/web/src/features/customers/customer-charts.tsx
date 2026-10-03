/**
 * Customer charts (analytics addendum §4): the leaderboard on /customers and a customer's monthly
 * volume and top sections. This module imports the chart kit, so screens load it with `lazy()`
 * and only for `analytics.view` roles: it must never reach the entry chunk, and floor roles never
 * download it (scripts/check-modulepreload.ts).
 */
import { formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import {
  BarChart,
  ChartCard,
  RankedBars,
  barTable,
  chartDateFormat,
  formatShare,
  rankedTable,
  type BarDatum,
  type RankedRow,
} from "@orrn/ui/charts";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { trpc } from "@/shared/utils/trpc";

const kgText = (v: number) => `${formatKgTotal(v)} kg`;

/** Who is leading over the page's period: top 10 by kg, the rest folded into Other. */
export function LeaderboardCard({ range }: { range: { from: string; to: string } }) {
  const { t } = useT();
  const query = useQuery({
    ...trpc.analytics.customerLeaderboard.queryOptions({ from: range.from, to: range.to, limit: 10 }),
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const rows: RankedRow[] = useMemo(
    () =>
      (data?.rows ?? []).map((r) => ({
        key: r.customerId,
        label: r.name,
        value: r.kgG / 1000,
        share: r.sharePct,
        movement: r.previousRank === null ? null : r.previousRank - r.rank,
      })),
    [data],
  );
  const other = (data?.otherKgG ?? 0) / 1000;
  const otherLabel = t("customers.leaderboard.otherShare", { share: formatShare(data?.otherSharePct ?? 0) });
  const state = query.isPending ? "loading" : query.isError && !data ? "error" : rows.length === 0 ? "empty" : undefined;

  return (
    <ChartCard
      data-testid="customer-leaderboard"
      level={2}
      title={t("customers.leaderboard.title")}
      subtitle={t("customers.leaderboard.subtitle", { total: formatKgTotal((data?.totalKgG ?? 0) / 1000) })}
      state={state}
      refreshing={query.isFetching && !query.isPending}
      onRetry={() => query.refetch()}
      plotHeight={320}
      table={rankedTable(rows, {
        t,
        format: kgText,
        valueHeader: t("customers.leaderboard.valueHeader"),
        other,
        otherLabel,
      })}
    >
      <RankedBars rows={rows} other={other} otherLabel={otherLabel} format={kgText} label={t("customers.leaderboard.label")} />
    </ChartCard>
  );
}

/** A month bucket start ("2026-10-01") as a Date that reads as that month in any zone. */
function monthDate(bucketStart: string): Date {
  const [y, m] = bucketStart.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1, 12));
}

/** kg dispatched to one customer per month, last 12 months, this month marked "so far". */
export function VolumeCard({
  series,
  state,
  onRetry,
}: {
  series: { bucketStart: string; kgG: number }[];
  state?: "loading" | "error";
  onRetry?(): void;
}) {
  const { t, locale } = useT();
  const dates = useMemo(() => chartDateFormat("month", locale, "UTC"), [locale]);
  const bars: BarDatum[] = useMemo(
    () =>
      series.map((s, i) => {
        const at = monthDate(s.bucketStart);
        return {
          key: s.bucketStart,
          label: dates.long(at),
          short: dates.short(at),
          value: s.kgG / 1000,
          partial: i === series.length - 1,
        };
      }),
    [series, dates],
  );
  const empty = !state && bars.every((b) => b.value === 0);

  return (
    <ChartCard
      data-testid="customer-volume"
      level={2}
      title={t("customers.detail.volume.title")}
      subtitle={t("customers.detail.volume.subtitle")}
      state={state ?? (empty ? "empty" : undefined)}
      onRetry={onRetry}
      table={barTable(bars, {
        t,
        format: kgText,
        labelHeader: t("customers.detail.volume.month"),
        valueHeader: t("customers.detail.volume.value"),
      })}
    >
      <BarChart data={bars} format={kgText} label={t("customers.detail.volume.label")} />
    </ChartCard>
  );
}

/** What one customer buys in the period: top sections by kg, the rest folded into Other. */
export function SectionsCard({
  sections,
  state,
  refreshing,
  onRetry,
}: {
  sections: { sectionId: string | null; label: string; kgG: number; sharePct: number }[];
  state?: "loading" | "error";
  refreshing?: boolean;
  onRetry?(): void;
}) {
  const { t } = useT();
  const rows: RankedRow[] = useMemo(
    () =>
      sections
        .filter((s) => s.sectionId !== null)
        .map((s) => ({ key: s.sectionId!, label: s.label, value: s.kgG / 1000, share: s.sharePct })),
    [sections],
  );
  const otherRow = sections.find((s) => s.sectionId === null);
  const other = otherRow ? otherRow.kgG / 1000 : 0;
  const otherLabel = t("customers.detail.sections.other");
  const empty = !state && rows.length === 0 && other === 0;

  return (
    <ChartCard
      data-testid="customer-sections"
      level={2}
      title={t("customers.detail.sections.title")}
      subtitle={t("customers.detail.sections.subtitle")}
      state={state ?? (empty ? "empty" : undefined)}
      refreshing={refreshing}
      onRetry={onRetry}
      table={rankedTable(rows, {
        t,
        format: kgText,
        valueHeader: t("customers.detail.sections.valueHeader"),
        other,
        otherLabel,
      })}
    >
      <RankedBars rows={rows} other={other} otherLabel={otherLabel} format={kgText} label={t("customers.detail.sections.label")} />
    </ChartCard>
  );
}
