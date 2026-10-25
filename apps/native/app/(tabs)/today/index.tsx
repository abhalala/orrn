import Feather from "@expo/vector-icons/Feather";
import { dispatchTone, formatKgTotal, gToKg, type DispatchStatus } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { Chip } from "@/components/ui/chip";
import { ListRow } from "@/components/ui/list-row";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { StatusBlock } from "@/components/ui/status-block";
import { PageHeader } from "@/components/ui/page-header";
import { greetingKey, inStock, showStartHere, TILE_META, todayTiles, type TodayTile } from "@/features/today/today-model";
import { hourIn, zoneOf } from "@/lib/format";
import { useFormat } from "@/lib/use-format";
import { useThemeColor } from "@/lib/theme";
import { useMe } from "@/utils/me";
import { trpc } from "@/utils/trpc";

const TILE_CLASSES: Record<TodayTile, { box: string; text: string }> = {
  pack: { box: "bg-tone-blue", text: "text-tone-blue-on" },
  dispatch: { box: "bg-tone-red", text: "text-tone-red-on" },
  stock: { box: "bg-tone-amber", text: "text-tone-amber-on" },
  guides: { box: "bg-tone-neutral", text: "text-tone-neutral-on" },
};

const DISPATCH_STATUS_KEY: Record<"draft" | "reserved", MessageKey> = {
  draft: "status.dispatch.draft",
  reserved: "status.dispatch.reserved",
};

const kgFormat = (n: number) => formatKgTotal(n);

export default function TodayScreen() {
  const { t } = useT();
  const router = useRouter();
  const fmt = useFormat();
  const muted = useThemeColor("muted-foreground");
  const me = useMe();
  const today = useQuery(trpc.dashboard.today.queryOptions());
  const data = today.data;

  const firstName = (me.data?.user?.name ?? "").trim().split(/\s+/)[0] ?? "";
  const tiles = todayTiles(me.data);
  const go = (href: string) => router.push(href as never);

  const stock = data ? inStock(data.stock) : null;

  return (
    <Screen onRefresh={() => void today.refetch()} refreshing={today.isRefetching}>
      <PageHeader title={t(greetingKey(hourIn(zoneOf(me.data?.company?.settings as { [key: string]: unknown } | null | undefined))), { name: firstName })} size="md" />

      {today.isPending ? <LoadingBlock /> : null}
      {today.isError && !data ? <ErrorBlock error={today.error} onRetry={() => void today.refetch()} retrying={today.isRefetching} /> : null}

      {data && stock ? (
        <>
          <View className="flex-row flex-wrap gap-3">
            <View className="min-w-[150px] flex-1">
              <StatusBlock
                index={0}
                tone="green"
                title={t("today.packed")}
                meta={t("units.bundles", { count: data.packedToday.bundles })}
                value={gToKg(data.packedToday.weightG)}
                unit={t("units.kg")}
                format={kgFormat}
              />
            </View>
            <View className="min-w-[150px] flex-1">
              <StatusBlock
                index={1}
                tone="neutral"
                title={t("today.dispatched")}
                meta={
                  data.dispatchedToday.dispatches > 0
                    ? t("today.dispatchesDone", { count: data.dispatchedToday.dispatches })
                    : t("today.noDispatchYet")
                }
                value={gToKg(data.dispatchedToday.weightG)}
                unit={t("units.kg")}
                format={kgFormat}
              />
            </View>
            <View className="min-w-[150px] flex-1">
              <StatusBlock
                index={2}
                tone="amber"
                title={t("today.inStock")}
                meta={t("units.bundles", { count: stock.bundles })}
                value={stock.kg}
                unit={t("units.kg")}
                format={kgFormat}
              />
            </View>
          </View>

          {data.failedPrintJobs > 0 ? (
            <View accessible accessibilityLabel={`${t("today.printProblemsCount", { count: data.failedPrintJobs })}, ${t("today.printProblemsBody")}`} className="flex-row items-center gap-3 rounded-card bg-tone-red-tint p-4">
              <Feather name="printer" size={20} color={muted} importantForAccessibility="no" />
              <View className="min-w-0 flex-1">
                <Text className="font-sans-semibold text-base text-tone-red-ink">{t("today.printProblemsCount", { count: data.failedPrintJobs })}</Text>
                <Text className="font-sans text-sm text-tone-red-ink">{t("today.printProblemsBody")}</Text>
              </View>
            </View>
          ) : null}

          {tiles.length > 0 ? (
            <View className="flex-row flex-wrap gap-3">
              {tiles.map((tile) => {
                const meta = TILE_META[tile];
                const c = TILE_CLASSES[tile];
                const hint = tile === "dispatch" ? t(meta.hint, { count: data.openDispatches.length }) : t(meta.hint);
                return (
                  <PressableScale
                    key={tile}
                    accessibilityRole="button"
                    accessibilityLabel={`${t(meta.title)}, ${hint}`}
                    onPress={() => go(meta.href)}
                    className={cn("min-h-[88px] min-w-[150px] flex-1 justify-between rounded-block p-4", c.box)}
                  >
                    <Text className={cn("font-display-bold text-lg", c.text)}>{t(meta.title)}</Text>
                    <Text className={cn("mt-2 font-sans-medium text-[13px]", c.text)}>{hint}</Text>
                  </PressableScale>
                );
              })}
            </View>
          ) : null}

          {showStartHere(data.stock) ? (
            <View className="gap-3 rounded-card border border-hairline bg-surface p-4">
              <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
                {t("today.startHere.title")}
              </Text>
              <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("today.startHere.body")}</Text>
              <ListRow title={t("today.startHere.addDie")} onPress={() => go("/more/dies")} />
              <ListRow title={t("today.startHere.addCustomer")} onPress={() => go("/more/customers")} />
              <ListRow title={t("today.startHere.packFirst")} onPress={() => go("/pack/new")} />
              <ListRow title={t("today.startHere.connectPrinter")} />
            </View>
          ) : null}

          <View className="gap-2">
            <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
              {t("today.openDispatches")}
            </Text>
            {data.openDispatches.length === 0 ? (
              <Text className="font-sans text-[15px] text-ink-muted">{t("today.noOpenDispatches")}</Text>
            ) : (
              data.openDispatches.map((d) => (
                <ListRow
                  key={d.id}
                  title={d.code}
                  subtitle={`${d.customerName}, ${t("units.bundlesKg", { bundles: d.bundles, kg: formatKgTotal(gToKg(d.weightG)) })}`}
                  trailing={<Chip tone={dispatchTone(d.status as DispatchStatus)} label={t(DISPATCH_STATUS_KEY[d.status])} />}
                  onPress={() => go(`/dispatch/${d.id}`)}
                />
              ))
            )}
          </View>

          <View className="gap-2">
            <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
              {t("today.sessionsTodayHeading")}
            </Text>
            {data.recentSessions.length === 0 ? (
              <Text className="font-sans text-[15px] text-ink-muted">{t("today.noSessionsToday")}</Text>
            ) : (
              data.recentSessions.map((s) => (
                <ListRow
                  key={s.id}
                  title={s.code}
                  subtitle={`${s.dieLabel}, ${t("units.bundlesKg", { bundles: s.bundles, kg: formatKgTotal(gToKg(s.weightG)) })}`}
                  trailing={<Text className="font-mono text-sm text-ink-muted">{fmt.time(s.createdAt) ?? ""}</Text>}
                  onPress={() => go(`/pack/${s.id}`)}
                />
              ))
            )}
          </View>
        </>
      ) : null}
    </Screen>
  );
}
