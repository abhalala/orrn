import { useT } from "@orrn/i18n";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { trpc } from "@/utils/trpc";

import { BundleRows, Pager } from "./bundle-list";
import { offsetOf, PAGE_SIZE, pageWithinTotal, parseBundlesParams, type BundlesParams, type StatusFilterValue } from "./bundle-search";
import { failedWithoutData } from "./section-page";
import { sectionLabel } from "./sections";
import { StatusFilter } from "./status-filter";
import { useRefresh } from "./use-refresh";
import { YardFilter } from "./yard-filter";

const SEARCH_DEBOUNCE_MS = 250;

/** `/stock/bundles`: every bundle, newest first, 50 a page. Params `status`, `q`, `dieId`, `groupId` set the starting view. */
export function BundlesView() {
  const raw = useLocalSearchParams();
  const initial = parseBundlesParams(raw);
  // A new set of params (e.g. a link from a section) starts the list afresh.
  return <BundlesList key={JSON.stringify(initial)} initial={initial} />;
}

function BundlesList({ initial }: { initial: BundlesParams }) {
  const { t } = useT();
  const [status, setStatus] = useState<StatusFilterValue>(initial.status ?? "all");
  const [text, setText] = useState(initial.q ?? "");
  const [q, setQ] = useState(initial.q);
  const [dieId, setDieId] = useState(initial.dieId);
  const [groupId, setGroupId] = useState(initial.groupId);
  const [yard, setYard] = useState<string | undefined>(undefined);
  const [pageNo, setPageNo] = useState(1);

  // Typing waits a moment before it searches and keeps the last page on screen meanwhile.
  useEffect(() => {
    const next = text.trim() || undefined;
    if (next === q) return;
    const id = setTimeout(() => {
      setQ(next);
      setPageNo(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text, q]);

  const bundles = useQuery({
    ...trpc.bundle.listBundles.queryOptions({
      status: status === "all" ? undefined : status,
      search: q,
      dieId,
      groupId,
      ...(yard ? { locationId: yard } : {}),
      limit: PAGE_SIZE,
      offset: offsetOf(pageNo),
    }),
    placeholderData: keepPreviousData,
  });
  const total = bundles.data && !bundles.isPlaceholderData ? Number(bundles.data.total) : undefined;
  useEffect(() => {
    if (total === undefined) return;
    const fixed = pageWithinTotal(pageNo, total);
    if (fixed !== pageNo) setPageNo(fixed);
  }, [total, pageNo]);
  const { refreshing, onRefresh } = useRefresh([bundles.refetch]);

  // Name what a section or session link shows; every row shares it.
  const first = bundles.isPlaceholderData ? undefined : bundles.data?.items[0];
  const scope = groupId
    ? first
      ? t("stock.list.filterGroupNamed", { code: first.groupCode })
      : t("stock.list.filterGroup")
    : dieId
      ? first
        ? t("stock.list.filterDieNamed", { section: sectionLabel({ series: first.dieSeries, sectionCode: first.dieSectionCode }) })
        : t("stock.list.filterDie")
      : null;

  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: t("stock.list.title") }} />
      <Field
        label={t("stock.list.search")}
        value={text}
        onChangeText={setText}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        returnKeyType="search"
      />
      <StatusFilter
        value={status}
        onChange={(next) => {
          setStatus(next);
          setPageNo(1);
        }}
      />
      <YardFilter
        value={yard}
        onChange={(next) => {
          setYard(next);
          setPageNo(1);
        }}
      />
      {scope ? (
        <View className="gap-1">
          <Text className="font-sans-medium text-sm text-ink-muted">{scope}</Text>
          <Button
            variant="ghost"
            label={t("stock.list.clearFilter")}
            onPress={() => {
              setDieId(undefined);
              setGroupId(undefined);
              setPageNo(1);
            }}
          />
        </View>
      ) : null}

      {failedWithoutData(bundles) ? (
        <ErrorBlock error={bundles.error} onRetry={() => void bundles.refetch()} retrying={bundles.isFetching} />
      ) : bundles.isPending ? (
        <LoadingBlock />
      ) : bundles.data && bundles.data.items.length > 0 ? (
        <>
          <BundleRows rows={bundles.data.items} />
          <Pager page={pageNo} total={Number(bundles.data.total)} onChange={setPageNo} />
        </>
      ) : q ? (
        <EmptyState
          title={t("common.noResults", { query: q })}
          actionLabel={t("stock.clearSearch")}
          onAction={() => {
            setText("");
            setQ(undefined);
          }}
        />
      ) : (
        <EmptyState title={t("stock.list.empty")} />
      )}
    </Screen>
  );
}
