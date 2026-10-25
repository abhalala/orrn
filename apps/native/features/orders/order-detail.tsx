import { useT } from "@orrn/i18n";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { isNotFound } from "@/features/more/query-errors";
import { announce } from "@/lib/a11y";
import { feedback } from "@/lib/feedback";
import { useFormat } from "@/lib/use-format";
import { useLengthUnit } from "@/utils/length";
import { queryClient, trpc } from "@/utils/trpc";

import {
  blockerText,
  dieTitle,
  lateLabel,
  milliText,
  orderErrorLines,
  orderKgText,
  pcsText,
  STATUS_KEY,
  STATUS_TONE,
  stripCells,
  timelineLabel,
  type OrderStatus,
  type Strip,
} from "./order-model";

function LineCard({ n, title, lengthText, ordered, strip, basis, pin }: { n: number; title: string; lengthText: string; ordered: string; strip: Strip | null; basis: string | null; pin: string | null }) {
  const { t } = useT();
  const cells = strip ? stripCells(strip) : [];
  return (
    <View className="gap-3 rounded-card border border-hairline bg-surface p-5">
      <View className="gap-0.5">
        <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
          {`${t("orders.detail.lineShort", { n })} ${title}`}
        </Text>
        <Text className="font-sans text-[15px] text-ink-muted">{[lengthText, ordered, pin].filter(Boolean).join(", ")}</Text>
      </View>
      {cells.length > 0 ? (
        <View accessibilityLabel={t("orders.strip.label")} className="flex-row flex-wrap gap-x-4 gap-y-3">
          {cells.map((c) => (
            <View key={c.key} accessible accessibilityLabel={`${t(c.labelKey)}, ${c.kg} ${t("units.kg")}${c.pcs ? `, ${c.pcs} ${t("units.pcs")}` : ""}`} className="min-w-[40%] flex-1 gap-0.5">
              <Text className="font-sans-medium text-[13px] text-ink-muted">{t(c.labelKey)}</Text>
              <Text className={c.open ? "font-mono-semibold text-[17px] text-tone-amber-ink" : "font-mono-semibold text-[17px] text-ink"}>{c.kg}</Text>
              {c.pcs ? <Text className="font-mono text-[13px] text-ink-muted">{`${c.pcs} ${t("units.pcs")}`}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      {strip && strip.overG > 0 ? <Chip tone="amber" label={t("orders.over", { kg: orderKgText(strip.overG) })} /> : null}
      {basis ? <Text className="font-sans text-sm text-ink-muted">{basis}</Text> : null}
    </View>
  );
}

/**
 * One order: status, late chip, the server's eight-figure strip per line, what stops it being
 * confirmed (as sentences) and the confirm button for the office. A refused confirm shows the
 * server's reasons in words; nothing on this page changes until the server says it saved.
 */
export function OrderDetail({ id }: { id: string }) {
  const { t } = useT();
  const router = useRouter();
  const format = useFormat();
  const { formatLength } = useLengthUnit();
  const [refreshing, setRefreshing] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const order = useQuery({ ...trpc.orders.get.queryOptions({ id }), enabled: !!id, retry: false });
  const timeline = useQuery({ ...trpc.orders.timeline.queryOptions({ id, limit: 20 }), enabled: !!order.data });
  const confirm = useMutation(trpc.orders.confirm.mutationOptions());

  const refresh = () => {
    setRefreshing(true);
    void Promise.allSettled([order.refetch(), timeline.refetch()]).finally(() => setRefreshing(false));
  };

  if (order.data === undefined) {
    return (
      <Screen>
        {order.isError ? (
          isNotFound(order.error) ? (
            <EmptyState title={t("orders.detail.notFound")} actionLabel={t("common.back")} onAction={() => (router.canGoBack() ? router.back() : router.replace("/orders"))} />
          ) : (
            <ErrorBlock error={order.error} onRetry={() => void order.refetch()} retrying={order.isFetching} />
          )
        ) : (
          <LoadingBlock />
        )}
      </Screen>
    );
  }

  const { order: o, lines, lineDetails, totals, lateDays, confirmBlockers } = order.data;
  const status = o.status as OrderStatus;
  const late = lateLabel(lateDays, t);
  const blockers = confirmBlockers.map((b) => blockerText(b, t));

  async function doConfirm() {
    setProblems([]);
    try {
      await confirm.mutateAsync({ id, serverSeq: o.serverSeq });
      feedback.success();
      announce(t("orders.confirmed"));
      void queryClient.invalidateQueries(trpc.orders.pathFilter());
    } catch (e) {
      feedback.error();
      setProblems(orderErrorLines(t, e));
      // The order may have changed under us; show what the server has now.
      void order.refetch();
    }
  }

  return (
    <Screen onRefresh={refresh} refreshing={refreshing}>
      <Stack.Screen options={{ title: o.number }} />
      <PageHeader title={o.number} subtitle={o.customerName} right={<Chip tone={STATUS_TONE[status]} label={t(STATUS_KEY[status])} />} />

      <View className="gap-1.5">
        <Text className="font-sans text-[15px] text-ink">{o.poNumber ? `${t("orders.po")} ${o.poNumber}` : t("orders.noPo")}</Text>
        <Text className="font-sans text-[15px] text-ink-muted">{`${t("orders.orderDate")} ${format.day(o.orderDate) ?? o.orderDate}`}</Text>
        {late ? <Chip tone="red" label={late} /> : null}
      </View>

      <View className="flex-row flex-wrap gap-x-4 gap-y-3 rounded-card border border-hairline bg-surface p-5">
        <Total label={t("orders.totals.ordered")} kg={orderKgText(totals.orderedG)} />
        <Total label={t("orders.totals.dispatched")} kg={orderKgText(totals.dispatchedG)} />
        <Total label={t("orders.totals.baki")} kg={orderKgText(totals.bakiG)} />
      </View>

      {status === "booking" ? (
        <View className="gap-3 rounded-card border border-hairline bg-surface p-5">
          {blockers.length > 0 ? (
            <View accessibilityLiveRegion="polite" className="gap-1.5">
              <Text accessibilityRole="header" className="font-sans-semibold text-base text-ink">
                {t("orders.toConfirm")}
              </Text>
              {blockers.map((b) => (
                <Text key={b} className="font-sans text-[15px] leading-6 text-ink">{`• ${b}`}</Text>
              ))}
            </View>
          ) : null}
          <Can do="order.manage">
            <Button size="lg" label={t("orders.confirm")} loading={confirm.isPending} loadingLabel={t("common.saving")} disabled={blockers.length > 0} onPress={() => void doConfirm()} />
          </Can>
          {problems.length > 0 ? (
            <View accessibilityRole="alert" accessibilityLiveRegion="polite" className="gap-1 rounded-input bg-tone-red-tint px-4 py-3">
              {problems.map((p) => (
                <Text key={p} className="font-sans-medium text-[15px] leading-6 text-tone-red-ink">
                  {p}
                </Text>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {lines.map((line, i) => {
        const d = lineDetails.find((x) => x.lineId === line.lineId);
        const basis = d?.copyMilli != null || d?.bandStartMilli != null ? basisText(t, d) : null;
        const pin = d?.dieInstanceId ? t("orders.line.copyPinned") : d?.tierRank != null ? t("orders.line.tierOrBetter", { rank: d.tierRank }) : null;
        const ordered = line.orderedPcs != null ? `${pcsText(line.orderedPcs)} ${t("units.pcs")}, ${orderKgText(line.orderedG)} ${t("units.kg")}` : `${orderKgText(line.orderedG)} ${t("units.kg")}`;
        return (
          <LineCard
            key={line.lineId}
            n={i + 1}
            title={dieTitle(line)}
            lengthText={formatLength(line.cutLengthMm)}
            ordered={ordered}
            strip={(d?.strip as Strip | undefined) ?? null}
            basis={basis}
            pin={pin}
          />
        );
      })}

      <View className="gap-3 rounded-card border border-hairline bg-surface p-5">
        <Text accessibilityRole="header" className="font-display-bold text-[17px] text-ink">
          {t("orders.detail.timeline")}
        </Text>
        {timeline.data === undefined ? (
          timeline.isError ? <Text className="font-sans text-[15px] text-ink-muted">{t("errors.network")}</Text> : <LoadingBlock />
        ) : timeline.data.events.length === 0 ? (
          <Text className="font-sans text-[15px] text-ink-muted">{t("orders.detail.timelineEmpty")}</Text>
        ) : (
          timeline.data.events.map((ev) => {
            const label = timelineLabel(ev);
            return (
              <View key={ev.id} accessible className="gap-0.5">
                <Text className="font-sans text-[15px] text-ink">{t(label.key, label.vars)}</Text>
                <Text className="font-sans text-sm text-ink-muted">{[format.day(ev.at), format.time(ev.at), ev.actorName].filter(Boolean).join(", ")}</Text>
              </View>
            );
          })
        )}
      </View>
    </Screen>
  );
}

function Total({ label, kg }: { label: string; kg: string }) {
  const { t } = useT();
  return (
    <View accessible accessibilityLabel={`${label}, ${kg} ${t("units.kg")}`} className="min-w-[28%] flex-1 gap-0.5">
      <Text className="font-sans-medium text-[13px] text-ink-muted">{label}</Text>
      <Text className="font-mono-semibold text-[17px] text-ink">{kg}</Text>
    </View>
  );
}

function basisText(
  t: ReturnType<typeof useT>["t"],
  d: { weightBasis: string | null; copyMilli: number | null; bandStartMilli: number | null; basisNote: string | null },
): string | null {
  if (d.weightBasis === "copy_current" && d.copyMilli != null) return t("orders.detail.basisLine", { milli: milliText(d.copyMilli), basis: t("orders.weightBasis.copy_current") });
  if (d.bandStartMilli != null) return t("orders.detail.basisLine", { milli: milliText(d.bandStartMilli), basis: t("orders.weightBasis.band_start") });
  return null;
}
