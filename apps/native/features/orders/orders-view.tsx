import { useT } from "@orrn/i18n";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { ListRow } from "@/components/ui/list-row";
import { Screen } from "@/components/ui/screen";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { PagedList } from "@/features/more/paged-list";
import { useDebounced } from "@/features/more/use-debounced";
import { queryClient, trpc } from "@/utils/trpc";

import { lateLabel, listInput, orderKgText, ORDER_FILTERS, STATUS_KEY, STATUS_TONE, type OrderFilter, type OrderStatus } from "./order-model";

const PAGE = 30;
const FILTER_KEY = { open: "orders.filter.open", closed: "orders.filter.closed", cancelled: "orders.filter.cancelled" } as const;

/**
 * The Orders tab (office): customer POs and what is still to dispatch. The late chip is the server's
 * `lateDays`; baki is the server's too. Booking an order is one line at a time (`/orders/new`).
 */
export function OrdersView() {
  const { t } = useT();
  const router = useRouter();
  const [filter, setFilter] = useState<OrderFilter>("open");
  const [text, setText] = useState("");
  const search = useDebounced(text.trim(), 300);
  const [refreshing, setRefreshing] = useState(false);

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void queryClient.invalidateQueries(trpc.orders.list.pathFilter()).finally(() => setRefreshing(false));
      }}
    >
      <Can do="order.manage">
        <Button size="lg" label={t("orders.new")} onPress={() => router.push("/orders/new")} />
      </Can>

      <Field
        label={t("orders.searchLabel")}
        placeholder={t("orders.search")}
        value={text}
        onChangeText={setText}
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      <SegmentedControl<OrderFilter>
        label={t("orders.filter.label")}
        options={ORDER_FILTERS.map((f) => ({ value: f, label: t(FILTER_KEY[f]) }))}
        value={filter}
        onChange={setFilter}
      />

      <PagedList
        key={`${filter}:${search}`}
        pageSize={PAGE}
        usePage={(offset) =>
          useQuery({
            ...trpc.orders.list.queryOptions({ ...listInput(filter, search), limit: PAGE, offset }),
            placeholderData: keepPreviousData,
          })
        }
        empty={
          search ? (
            <EmptyState title={t("orders.empty.noMatch")} body={t("orders.empty.noMatchBody")} />
          ) : filter === "open" ? (
            <EmptyState title={t("orders.empty.title")} body={t("orders.empty.body")} />
          ) : (
            <EmptyState title={t("orders.empty.filtered", { status: t(FILTER_KEY[filter]) })} />
          )
        }
        renderRow={(o) => {
          const late = lateLabel(o.lateDays, t);
          const status = o.status as OrderStatus;
          return (
            <ListRow
              key={o.id}
              title={`${o.number}, ${o.customerName}`}
              subtitle={`${o.poNumber ? `${t("orders.po")} ${o.poNumber}` : t("orders.noPo")}, ${t("orders.baki")} ${orderKgText(o.bakiG)} ${t("units.kg")}`}
              trailing={
                <View className="items-end gap-1">
                  <Chip tone={STATUS_TONE[status]} label={t(STATUS_KEY[status])} />
                  {late ? <Chip tone="red" label={late} /> : null}
                </View>
              }
              onPress={() => router.push({ pathname: "/orders/[id]", params: { id: o.id } })}
            />
          );
        }}
      />
    </Screen>
  );
}
