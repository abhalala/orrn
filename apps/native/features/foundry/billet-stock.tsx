import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list-row";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { StatusBlock } from "@/components/ui/status-block";
import { useMe } from "@/utils/me";
import { trpc } from "@/utils/trpc";

import { BILLET_QUERY, billetCards, CAST_TONE, showsBillets, type BilletCard, type CastStatus } from "./foundry-model";
import { kgOf } from "./ui";

const CAST_STATUS_KEY: Record<CastStatus, MessageKey> = {
  open: "foundry.casts.status.open",
  closing: "foundry.casts.status.closing",
  closed: "foundry.casts.status.closed",
  cancelled: "foundry.casts.status.cancelled",
};

/**
 * Billets in the store, on the Stock tab for the foundry floor: the total, then one card per cast grouped
 * by alloy. The kg is the server's store ledger (`stock.billets`, every cast, not just the page). Only casts
 * with stock are asked for (a cast at or below 0 kg drops to the finished group). Tapping a card opens the cast.
 */
export function BilletStock() {
  const { t } = useT();
  const router = useRouter();
  const { data: me } = useMe();
  const shown = showsBillets(me);
  const query = useQuery({ ...trpc.foundry.stock.billets.queryOptions(BILLET_QUERY), enabled: shown });
  if (!shown) return null;

  const cards = billetCards(query.data);
  const open = (c: BilletCard) => router.push({ pathname: "/cast/[id]", params: { id: c.castId } } as never);
  const row = (c: BilletCard) => (
    <ListRow
      key={c.castId}
      title={c.number}
      subtitle={c.alloy}
      trailing={
        <View className="items-end gap-1">
          <Text className="font-mono-semibold text-base text-ink">{`${kgOf(c.onHandG)} ${t("units.kg")}`}</Text>
          <Chip tone={CAST_TONE[c.status as CastStatus] ?? "neutral"} label={t(CAST_STATUS_KEY[c.status as CastStatus] ?? CAST_STATUS_KEY.open)} />
        </View>
      }
      onPress={() => open(c)}
    />
  );

  return (
    <View className="gap-3">
      <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
        {t("foundry.stock.title")}
      </Text>
      {query.isPending ? <LoadingBlock /> : null}
      {query.isError && !query.data ? <ErrorBlock error={query.error} onRetry={() => void query.refetch()} retrying={query.isRefetching} /> : null}
      {query.data ? (
        <>
          <StatusBlock tone="blue" title={t("foundry.stock.onHand")} value={gToKg(cards.totalG)} unit={t("units.kg")} format={formatKgTotal} />
          {query.data.adjustedG !== 0 ? <Text className="font-sans text-sm text-ink-muted">{t("foundry.stock.adjusted", { kg: kgOf(Math.abs(query.data.adjustedG)) })}</Text> : null}
          {cards.groups.length === 0 && cards.finished.length === 0 ? <Text className="font-sans text-[15px] text-ink-muted">{t("foundry.stock.empty")}</Text> : null}
          {cards.groups.map((g) => (
            <View key={g.alloy} className="gap-2">
              <Text className="font-sans-semibold text-base text-ink">{t("foundry.stock.alloyLine", { kg: kgOf(g.onHandG), casts: g.count })}</Text>
              <Text className="font-mono text-sm text-ink-muted">{g.alloy}</Text>
              {g.casts.map(row)}
            </View>
          ))}
          {cards.finished.length > 0 ? (
            <View className="gap-2">
              <Text className="font-sans-semibold text-base text-ink">{t("foundry.stock.finished")}</Text>
              {cards.finished.map(row)}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}
