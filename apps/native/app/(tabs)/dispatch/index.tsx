import { dispatchTone } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { HowToButton } from "@/components/ui/how-to-button";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { useFormat } from "@/lib/use-format";
import { trpc } from "@/utils/trpc";

import { kgTotal } from "@/features/dispatch/format";
import { shipDayLine } from "@/features/dispatch/ship-date";
import { DISPATCH_TABS, dispatchTab, type DispatchTab } from "@/features/dispatch/tabs";

/**
 * Dispatch: Building, Held, Dispatched and Cancelled as four tabs over
 * `dispatch.listDispatches`. A row says which dispatch, for whom, when it
 * ships and how much is on it; pull down to refresh.
 */
export default function DispatchScreen() {
  const { t } = useT();
  const router = useRouter();
  const format = useFormat();
  const [tab, setTab] = useState<DispatchTab>(dispatchTab(undefined));
  const list = useQuery(trpc.dispatch.listDispatches.queryOptions({ status: tab, limit: 100 }));
  const items = list.data?.items ?? [];

  const openNew = () => router.push("/dispatch/new");

  return (
    <Screen onRefresh={() => void list.refetch()} refreshing={list.isRefetching && !list.isPending}>
      <View className="flex-row items-center justify-between gap-3">
        <HowToButton slug="build-dispatch" />
        <Can do="dispatch.create">
          <Button label={t("dispatch.newDispatch")} onPress={openNew} />
        </Can>
      </View>
      <SegmentedControl
        label={t("native.dispatch.tabsLabel")}
        value={tab}
        onChange={setTab}
        options={DISPATCH_TABS.map((value) => ({ value, label: t(`status.dispatch.${value}`) }))}
      />

      {list.isPending ? <LoadingBlock /> : null}
      {list.isError && !list.data ? <ErrorBlock error={list.error} onRetry={() => void list.refetch()} retrying={list.isRefetching} /> : null}

      {list.data && items.length === 0 ? (
        <View className="gap-3">
          <EmptyState title={tab === "draft" ? t("dispatch.emptyBuilding") : t("dispatch.empty")} />
          <Can do="dispatch.create">
            <Button size="lg" label={t("dispatch.newDispatch")} onPress={openNew} />
          </Can>
        </View>
      ) : null}

      {items.map((d) => {
        const totals = t("dispatch.build.groupTotal", { bundles: d.itemCount, kg: kgTotal(d.totalWeightG) });
        return (
          <ListRow
            key={d.id}
            title={d.customerName}
            code={d.code}
            subtitle={[shipDayLine(d.shipDay, format.day, t), totals].join(" · ")}
            trailing={<Chip tone={dispatchTone(d.status)} label={t(`status.dispatch.${d.status}`)} />}
            onPress={() => router.push({ pathname: "/dispatch/[id]", params: { id: d.id } })}
          />
        );
      })}
      {list.data && list.data.total > items.length ? (
        <Text className="text-center font-sans text-sm text-ink-muted">{t("common.pageRange", { from: 1, to: items.length, total: list.data.total })}</Text>
      ) : null}
    </Screen>
  );
}
