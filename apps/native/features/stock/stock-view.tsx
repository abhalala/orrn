import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { can, useMe } from "@/utils/me";
import { trpc } from "@/utils/trpc";

import { failedWithoutData } from "./section-page";
import { SectionBlock } from "./section-row";
import { sectionRows, stockTotals, type SectionSort, type StockPosition, type SummaryRow } from "./sections";
import { useRefresh } from "./use-refresh";
import { YardFilter } from "./yard-filter";

/**
 * The Stock tab: one block per section (die) with stock, from
 * `bundle.stockSummary` for in-stock and for held bundles. Void and
 * dispatched bundles are in neither, so they never count here. Search and
 * sort run on the loaded sections; "All bundles" opens the full list.
 */
export function StockView() {
  const { t } = useT();
  const router = useRouter();
  const [yard, setYard] = useState<string | undefined>(undefined);
  const filter = yard ? { locationId: yard } : {};
  const available = useQuery(trpc.bundle.stockSummary.queryOptions({ status: "available", ...filter }));
  const reserved = useQuery(trpc.bundle.stockSummary.queryOptions({ status: "reserved", ...filter }));
  const { data: me } = useMe();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SectionSort>("kg");
  const { refreshing, onRefresh } = useRefresh([available.refetch, reserved.refetch]);

  const items = (q: typeof available): SummaryRow[] => (q.data?.items ?? []) as SummaryRow[];
  const all = sectionRows(items(available), items(reserved), { query: "", sort });
  const shown = sectionRows(items(available), items(reserved), { query, sort });
  // In stock = available and held apart, counted by the server over the same yard filter as the sections.
  const totals = stockTotals(available.data?.stock as StockPosition | undefined, all);
  const canPack = can(me, "bundle.pack");

  const loading = available.isPending || reserved.isPending;
  // A failed background refetch keeps the stock already on screen.
  const failed = failedWithoutData(available) || failedWithoutData(reserved);

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      {loading && !failed ? (
        <LoadingBlock />
      ) : failed ? (
        <ErrorBlock
          error={available.error ?? reserved.error}
          onRetry={() => {
            void available.refetch();
            void reserved.refetch();
          }}
        />
      ) : (
        <>
          {all.length > 0 ? (
            <View className="gap-2">
              <Text className="font-sans-medium text-[15px] text-ink">
                {t("stock.totals", { bundles: totals.bundles.toLocaleString("en-IN"), kg: formatKgTotal(gToKg(totals.weightG)) })}
              </Text>
              {totals.held > 0 ? (
                <Chip tone="blue" label={t("stock.heldKg", { count: totals.held.toLocaleString("en-IN"), kg: formatKgTotal(gToKg(totals.heldWeightG)) })} />
              ) : null}
            </View>
          ) : null}

          <YardFilter value={yard} onChange={setYard} />

          <ListRow title={t("stock.list.title")} onPress={() => router.push("/stock/bundles")} />

          {all.length === 0 ? (
            <EmptyState
              title={t("stock.empty")}
              actionLabel={canPack ? t("stock.emptyAction") : undefined}
              onAction={canPack ? () => router.push("/pack/new") : undefined}
            />
          ) : (
            <>
              <Field
                label={t("stock.searchSections")}
                value={query}
                onChangeText={setQuery}
                autoCorrect={false}
                autoComplete="off"
                returnKeyType="search"
              />
              <SegmentedControl
                label={t("common.sort")}
                value={sort}
                onChange={setSort}
                options={[
                  { value: "kg", label: t("common.sortMostKg") },
                  { value: "az", label: t("common.sortAZ") },
                ]}
              />
              {query.trim() ? (
                <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-muted">
                  {t("stock.sectionsFound", { count: shown.length })}
                </Text>
              ) : null}
              {shown.length > 0 ? (
                <View accessibilityLabel={t("stock.sections")} className="gap-3">
                  {shown.map((row, i) => (
                    <SectionBlock key={row.dieId} row={row} index={i} />
                  ))}
                </View>
              ) : (
                <EmptyState title={t("common.noResults", { query: query.trim() })} actionLabel={t("stock.clearSearch")} onAction={() => setQuery("")} />
              )}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
