import Feather from "@expo/vector-icons/Feather";
import { dispatchTone, formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Linking, Text, View } from "react-native";

import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { PageHeader } from "@/components/ui/page-header";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Screen } from "@/components/ui/screen";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusBlock } from "@/components/ui/status-block";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import {
  addressLines,
  companyTimeZone,
  customerFactsLine,
  DEFAULT_PERIOD,
  PERIOD_LABEL,
  PERIODS,
  periodRange,
  todayIn,
  type Period,
} from "@/features/customers/customer-view";
import { PagedList } from "@/features/more/paged-list";
import { isNotFound } from "@/features/more/query-errors";
import { useThemeColor } from "@/lib/theme";
import { useFormat } from "@/lib/use-format";
import { can, useMe } from "@/utils/me";
import { trpc } from "@/utils/trpc";

const RECENT_PAGE = 10;

/**
 * One customer, read only: contact and addresses, what they took this period
 * and when they last did (owners and managers who can see analytics), and
 * their dispatches. Adding and editing customers stays on the web.
 */
export default function CustomerScreen() {
  const { t } = useT();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: me } = useMe();
  const [refreshing, setRefreshing] = useState(false);
  const query = useQuery({ ...trpc.customer.get.queryOptions({ id: id ?? "" }), enabled: !!id, retry: false });

  const refresh = () => {
    setRefreshing(true);
    void query.refetch().finally(() => setRefreshing(false));
  };

  if (query.data === undefined) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t("nav.customers") }} />
        {query.isError ? (
          isNotFound(query.error) ? (
            <EmptyState
              title={t("customers.detail.notFound")}
              actionLabel={t("customers.detail.backToList")}
              onAction={() => (router.canGoBack() ? router.back() : router.replace("/more/customers"))}
            />
          ) : (
            <ErrorBlock error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />
          )
        ) : (
          <LoadingBlock />
        )}
      </Screen>
    );
  }

  const customer = query.data;
  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: customer.name }} />
      <PageHeader title={customer.name} subtitle={customer.taxId ? t("customers.detail.gstin", { gstin: customer.taxId }) : undefined} />
      {can(me, "analytics.view") ? <Analytics customerId={customer.id} /> : null}
      <Contact customer={customer} />
      <Recent customerId={customer.id} />
    </Screen>
  );
}

function Analytics({ customerId }: { customerId: string }) {
  const { t } = useT();
  const format = useFormat();
  const { data: me } = useMe();
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const today = useMemo(() => todayIn(companyTimeZone(me?.company?.settings)), [me?.company?.settings]);
  const range = useMemo(() => periodRange(period, today), [period, today]);
  const summary = useQuery({
    ...trpc.analytics.customerSummary.queryOptions({ customerId, from: range.from, to: range.to, bucket: "month" }),
    placeholderData: keepPreviousData,
  });
  const totals = summary.data?.totals;
  const stale = summary.isPlaceholderData;

  return (
    <View className="gap-3">
      {summary.data ? (
        <Text className="font-sans-medium text-[15px] leading-6 text-ink-muted">{customerFactsLine(t, summary.data)}</Text>
      ) : null}
      <SegmentedControl
        label={t("customers.period.label")}
        options={PERIODS.map((p) => ({ value: p, label: t(PERIOD_LABEL[p]) }))}
        value={period}
        onChange={setPeriod}
      />
      {summary.isError && !summary.data ? (
        <ErrorBlock error={summary.error} onRetry={() => void summary.refetch()} retrying={summary.isFetching} />
      ) : !totals ? (
        <LoadingBlock />
      ) : (
        <View className={stale ? "gap-3 opacity-60" : "gap-3"} accessibilityState={{ busy: stale }}>
          <StatusBlock
            tone="neutral"
            title={t("customers.detail.kpi.kg")}
            meta={t("customers.period.range", { from: format.day(range.from) ?? range.from, to: format.day(range.to) ?? range.to })}
            value={totals.kgG / 1000}
            format={formatKgTotal}
            unit={t("units.kg")}
          />
          <View className="flex-row gap-3">
            <Kpi label={t("customers.detail.kpi.dispatches")} value={String(totals.dispatches)} />
            <Kpi label={t("customers.detail.kpi.avgLoad")} value={formatKgTotal(totals.avgLoadKgG / 1000)} unit={t("customers.detail.kpi.perDispatch")} />
          </View>
          {summary.data?.openOrders ? <OpenOrders orders={summary.data.openOrders} /> : null}
        </View>
      )}
    </View>
  );
}

function Kpi({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <View accessible accessibilityLabel={`${label}, ${value}${unit ? ` ${unit}` : ""}`} className="min-w-0 flex-1 gap-1 rounded-card border border-hairline bg-surface p-4">
      <Text className="font-sans-medium text-[13px] text-ink-muted">{label}</Text>
      <Text className="font-display-extrabold text-2xl text-ink">
        {value}
      </Text>
      {unit ? <Text className="font-sans text-xs text-ink-muted">{unit}</Text> : null}
    </View>
  );
}

function OpenOrders({ orders }: { orders: { orderedG: number; dispatchedG: number; bakiG: number; lines: number } }) {
  const { t } = useT();
  const cells = [
    { key: "ordered", label: t("customers.detail.openOrders.ordered"), g: orders.orderedG },
    { key: "dispatched", label: t("customers.detail.openOrders.dispatched"), g: orders.dispatchedG },
    { key: "baki", label: t("customers.detail.openOrders.baki"), g: orders.bakiG },
  ];
  return (
    <View className="gap-3 rounded-card border border-hairline bg-surface p-4">
      <View className="flex-row flex-wrap items-baseline justify-between gap-2">
        <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
          {t("customers.detail.openOrders.title")}
        </Text>
        <Text className="font-sans-medium text-[13px] text-ink-muted">{t("customers.detail.openOrders.lines", { count: orders.lines })}</Text>
      </View>
      <View className="flex-row gap-3">
        {cells.map((c) => (
          <View key={c.key} accessible accessibilityLabel={`${c.label}, ${formatKgTotal(c.g / 1000)} ${t("units.kg")}`} className="min-w-0 flex-1 gap-0.5">
            <Text className="font-sans-medium text-[13px] text-ink-muted">{c.label}</Text>
            <Text className="font-mono-semibold text-[15px] text-ink">
              {formatKgTotal(c.g / 1000)}
            </Text>
            <Text className="font-sans text-xs text-ink-muted">{t("units.kg")}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

type ContactCustomer = {
  phone: string | null;
  email: string | null;
  billingAddress: Record<string, unknown> | null;
  shippingAddress: Record<string, unknown> | null;
  notes: string | null;
};

function Contact({ customer }: { customer: ContactCustomer }) {
  const { t } = useT();
  const ink = useThemeColor("foreground");
  const billing = addressLines(customer.billingAddress);
  const shipping = addressLines(customer.shippingAddress);
  const shippingSame = shipping.length === 0 || shipping.join("|") === billing.join("|");

  return (
    <View className="gap-4 rounded-card border border-hairline bg-surface p-5">
      <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
        {t("customers.detail.contact")}
      </Text>
      {customer.phone || customer.email ? (
        <View className="gap-1">
          {customer.phone ? (
            <PressableScale
              accessibilityRole="link"
              accessibilityLabel={t("native.more.call", { phone: customer.phone })}
              onPress={() => void Linking.openURL(`tel:${customer.phone!.replace(/\s+/g, "")}`).catch(() => {})}
              className="min-h-11 flex-row items-center gap-2.5"
            >
              <Feather name="phone" size={18} color={ink} />
              <Text className="min-w-0 flex-1 font-sans-medium text-[15px] text-ink">{customer.phone}</Text>
            </PressableScale>
          ) : null}
          {customer.email ? (
            <PressableScale
              accessibilityRole="link"
              accessibilityLabel={t("native.more.mail", { email: customer.email })}
              onPress={() => void Linking.openURL(`mailto:${customer.email}`).catch(() => {})}
              className="min-h-11 flex-row items-center gap-2.5"
            >
              <Feather name="mail" size={18} color={ink} />
              <Text className="min-w-0 flex-1 font-sans-medium text-[15px] text-ink">{customer.email}</Text>
            </PressableScale>
          ) : null}
        </View>
      ) : (
        <Text className="font-sans text-[15px] text-ink-muted">{t("customers.detail.noContact")}</Text>
      )}

      <View className="gap-1 border-t border-hairline pt-3">
        <Text className="font-sans-semibold text-[13px] text-ink-muted">{t("customers.form.billingAddress")}</Text>
        {billing.length > 0 ? (
          billing.map((line) => (
            <Text key={line} className="font-sans text-[15px] leading-6 text-ink">
              {line}
            </Text>
          ))
        ) : (
          <Text className="font-sans text-[15px] text-ink-muted">{t("customers.detail.noAddress")}</Text>
        )}
      </View>
      {billing.length > 0 || shipping.length > 0 ? (
        <View className="gap-1">
          <Text className="font-sans-semibold text-[13px] text-ink-muted">{t("customers.form.shippingAddress")}</Text>
          {shippingSame && billing.length > 0 ? (
            <Text className="font-sans text-[15px] leading-6 text-ink">{t("customers.detail.sameAsBilling")}</Text>
          ) : (
            shipping.map((line) => (
              <Text key={line} className="font-sans text-[15px] leading-6 text-ink">
                {line}
              </Text>
            ))
          )}
        </View>
      ) : null}
      {customer.notes ? (
        <View className="gap-1 border-t border-hairline pt-3">
          <Text className="font-sans-semibold text-[13px] text-ink-muted">{t("customers.form.notes")}</Text>
          <Text className="font-sans text-[15px] leading-6 text-ink">{customer.notes}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Recent({ customerId }: { customerId: string }) {
  const { t } = useT();
  const router = useRouter();
  const format = useFormat();
  return (
    <View className="gap-3">
      <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
        {t("customers.detail.recent.title")}
      </Text>
      <PagedList
        pageSize={RECENT_PAGE}
        usePage={(offset) =>
          useQuery({
            ...trpc.dispatch.listDispatches.queryOptions({ customerId, limit: RECENT_PAGE, offset }),
            placeholderData: keepPreviousData,
          })
        }
        empty={<EmptyState title={t("customers.noDispatches")} />}
        renderRow={(d) => {
          // A completed load reads the day it left; one still being built reads its ship date, else the day it was started.
          const day = d.status === "completed" && d.completedAt ? format.day(d.completedAt) : d.shipDate ? format.shipDay(d.shipDate) : format.day(d.createdAt);
          const load = `${t("units.bundles", { count: d.itemCount })}, ${formatKgTotal(d.totalWeightG / 1000)} ${t("units.kg")}`;
          return (
            <ListRow
              key={d.id}
              title={d.code}
              subtitle={[day, load].filter(Boolean).join(", ")}
              accessibilityLabel={`${d.code}, ${t(`status.dispatch.${d.status}`)}, ${[day, load].filter(Boolean).join(", ")}`}
              trailing={<Chip tone={dispatchTone(d.status)} label={t(`status.dispatch.${d.status}`)} />}
              onPress={() => router.push({ pathname: "/dispatch/[id]", params: { id: d.id } })}
            />
          );
        }}
      />
    </View>
  );
}
