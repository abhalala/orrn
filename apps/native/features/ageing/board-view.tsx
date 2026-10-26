import Feather from "@expo/vector-icons/Feather";
import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { Can } from "@/components/can";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { PageHeader } from "@/components/ui/page-header";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Screen } from "@/components/ui/screen";
import { ErrorBlock, LoadingBlock } from "@/components/ui/state";
import { useThemeColor } from "@/lib/theme";
import { useNow } from "@/lib/use-now";
import { trpc } from "@/utils/trpc";

import { batchByOven, batchByTrolley, capacityTone, soakProgress, x10Text } from "./model";
import { TempSpark } from "./spark";
import { BOARD_POLL_MS, type Batch, type BatchSummary, type Oven, type Trolley } from "./use-ageing";
import { useDuration } from "./use-duration";
import { Note, PhaseChip, Section } from "./ui";

const kgText = (g: number) => formatKgTotal(gToKg(g));

/**
 * The ageing board (FP-AG-16): the held batches first, then each oven with the batch in it (stage, last
 * temperature, soak timer, a line of the log) and each trolley free or carrying a batch. Everything is the
 * server's: `ageing.ovens.list`, `ageing.trolleys.list` and `ageing.batches.list`. It polls every 30 s and on pull.
 */
export function BoardView() {
  const { t } = useT();
  const router = useRouter();
  const now = useNow(30_000);
  const ovens = useQuery({ ...trpc.ageing.ovens.list.queryOptions({}), refetchInterval: BOARD_POLL_MS });
  const trolleys = useQuery({ ...trpc.ageing.trolleys.list.queryOptions({}), refetchInterval: BOARD_POLL_MS });
  const batches = useQuery({ ...trpc.ageing.batches.list.queryOptions({ limit: 100 }), refetchInterval: BOARD_POLL_MS });
  const refetchAll = () => {
    void ovens.refetch();
    void trolleys.refetch();
    void batches.refetch();
  };
  const refreshing = ovens.isRefetching || trolleys.isRefetching || batches.isRefetching;
  const failed = (ovens.isError && !ovens.data) || (trolleys.isError && !trolleys.data) || (batches.isError && !batches.data);

  const header = (
    <PageHeader
      title={t("ageing.title")}
      subtitle={t("ageing.floor.subtitle")}
    />
  );

  if (failed) {
    return (
      <Screen onRefresh={refetchAll} refreshing={refreshing}>
        {header}
        <ErrorBlock error={ovens.error ?? trolleys.error ?? batches.error} onRetry={refetchAll} retrying={refreshing} />
      </Screen>
    );
  }
  if (!ovens.data || !trolleys.data || !batches.data) {
    return (
      <Screen>
        {header}
        <LoadingBlock />
      </Screen>
    );
  }

  const live = batches.data.items.filter((b) => b.status !== "closed" && b.status !== "void");
  const byOven = batchByOven(live);
  const byTrolley = batchByTrolley(live);
  const activeOvens = ovens.data.items.filter((o) => o.status !== "draft");
  const activeTrolleys = trolleys.data.items.filter((r) => r.status !== "draft");
  const held = live.filter((b) => b.status === "held");
  const counts = {
    inOven: live.filter((b) => b.status === "in_oven").length,
    out: live.filter((b) => b.status === "out").length,
    held: held.length,
  };
  const open = (id: string) => router.push({ pathname: "/more/ageing/[id]", params: { id } });
  const load = (trolley?: string) => router.push(trolley ? { pathname: "/more/ageing/load", params: { trolley } } : { pathname: "/more/ageing/load" });

  return (
    <Screen onRefresh={refetchAll} refreshing={refreshing}>
      {header}
      <View accessibilityLabel={t("ageing.floor.counts")} className="flex-row flex-wrap gap-2">
        <Chip tone="amber" label={t("ageing.floor.inOven", { count: counts.inOven })} />
        <Chip tone="blue" label={t("ageing.floor.out", { count: counts.out })} />
        <Chip tone={counts.held > 0 ? "red" : "neutral"} label={t("ageing.floor.held", { count: counts.held })} />
      </View>
      <Can do="ageing.load">
        <Button size="lg" label={t("ageing.action.load")} onPress={() => load()} />
      </Can>

      {activeOvens.length === 0 ? <Note tone="amber">{t("ageing.empty.noOvenAsk")}</Note> : null}

      {held.length > 0 ? (
        <Section title={t("ageing.floor.heldTitle")} hint={t("ageing.floor.heldHint")}>
          {held.map((b) => (
            <HeldCard key={b.id} batch={b} onOpen={() => open(b.id)} />
          ))}
        </Section>
      ) : null}

      <Section title={t("ageing.floor.ovens")}>
        {activeOvens.map((o) => (
          <OvenCard key={o.id} oven={o} batch={byOven.get(o.id)} now={now} onOpen={open} onLoad={() => load()} />
        ))}
      </Section>

      <Section title={t("ageing.floor.trolleys")}>
        {activeTrolleys.length === 0 ? <Note tone="amber">{t("ageing.empty.noTrolleyAsk")}</Note> : null}
        {activeTrolleys.map((r) => (
          <TrolleyCard key={r.id} trolley={r} batch={byTrolley.get(r.id)} onOpen={open} onLoad={() => load(r.id)} />
        ))}
      </Section>
    </Screen>
  );
}

function OvenCard({ oven, batch, now, onOpen, onLoad }: { oven: Oven; batch: BatchSummary | undefined; now: number; onOpen: (id: string) => void; onLoad: () => void }) {
  const { t } = useT();
  const out = oven.status === "out_of_service";
  return (
    <View className={cn("gap-3 rounded-card border border-hairline bg-surface-sunken p-4", out && "opacity-80")}>
      <View className="flex-row items-center justify-between gap-2">
        <Text accessibilityRole="header" className="font-mono-semibold text-xl text-ink">
          {oven.code}
        </Text>
        {out ? <Chip tone="neutral" label={t("ageing.masterStatus.out_of_service")} /> : batch ? <PhaseChip phase={batch.phase} /> : <Chip tone="neutral" label={t("ageing.floor.empty")} />}
      </View>
      {batch ? (
        <OvenBatch batch={batch} now={now} onOpen={() => onOpen(batch.id)} />
      ) : (
        <View className="gap-3">
          <Text className="font-sans text-sm text-ink-muted">{oven.capacityG ? t("ageing.floor.capacity", { kg: kgText(oven.capacityG) }) : t("ageing.capacity.unknown")}</Text>
          {!out ? (
            <Can do="ageing.load">
              <Button variant="secondary" label={t("ageing.action.load")} onPress={onLoad} />
            </Can>
          ) : null}
        </View>
      )}
    </View>
  );
}

function OvenBatch({ batch, now, onOpen }: { batch: BatchSummary; now: number; onOpen: () => void }) {
  const { t } = useT();
  const duration = useDuration();
  const muted = useThemeColor("muted-foreground");
  // The curve and the band come from the batch itself: one detail read per batch in an oven.
  const detail = useQuery({ ...trpc.ageing.batches.get.queryOptions({ id: batch.id }), refetchInterval: BOARD_POLL_MS });
  const progress = soakProgress(batch.soakStartedAt, batch.soakMin, now);
  const d: Batch | undefined = detail.data;
  const snap = d?.snapshot ?? null;
  const band = snap ? { lowX10: snap.targetTempX10 - snap.toleranceX10, highX10: snap.targetTempX10 + snap.toleranceX10 } : null;
  const lastTemp = batch.lastTempCX10 === null ? "-" : `${x10Text(batch.lastTempCX10)} °C`;
  return (
    <View className="gap-3">
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${batch.number}, ${t("ageing.floor.onTrolley", { trolley: batch.trolleyCode })}`}
        onPress={onOpen}
        className="min-h-11 flex-row items-center justify-between gap-2"
      >
        <View className="min-w-0 flex-1">
          <Text className="font-mono-semibold text-lg text-ink">{batch.number}</Text>
          <Text className="font-sans text-sm text-ink-muted">{[t("ageing.floor.onTrolley", { trolley: batch.trolleyCode }), batch.recipeLabel].filter(Boolean).join(", ")}</Text>
        </View>
        <Feather name="chevron-right" size={20} color={muted} importantForAccessibility="no" />
      </PressableScale>
      <View className="flex-row flex-wrap gap-4">
        <View className="min-w-[40%] flex-1 gap-0.5">
          <Text className="font-sans text-[13px] text-ink-muted">{t("ageing.floor.lastTemp")}</Text>
          <Text className="font-mono-semibold text-2xl text-ink">{lastTemp}</Text>
        </View>
        <View className="min-w-[40%] flex-1 gap-0.5">
          <Text className="font-sans text-[13px] text-ink-muted">{progress ? t("ageing.floor.soakOf", { total: duration(batch.soakMin ?? 0) }) : t("ageing.floor.stage")}</Text>
          <Text className="font-sans-semibold text-lg text-ink">{progress ? duration(progress.elapsedMin) : t(`ageing.phase.${batch.phase}`)}</Text>
        </View>
      </View>
      <Text className="font-mono text-sm text-ink">{t("ageing.pcsKg", { pcs: batch.totals.loadedPcs, kg: kgText(batch.totals.loadedKgG) })}</Text>
      {progress ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel={t("ageing.floor.soakProgress")} accessibilityValue={{ min: 0, max: 100, now: Math.round(progress.ratio * 100) }} className="h-2 overflow-hidden rounded-full bg-surface">
          <View className="h-full rounded-full bg-tone-green" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
        </View>
      ) : null}
      <TempSpark readings={d?.readings ?? []} band={band} />
      {batch.capacity === "over" || batch.capacity === "near" ? <Chip tone={capacityTone(batch.capacity)} label={t(`ageing.capacity.${batch.capacity}`)} /> : null}
    </View>
  );
}

function TrolleyCard({ trolley, batch, onOpen, onLoad }: { trolley: Trolley; batch: BatchSummary | undefined; onOpen: (id: string) => void; onLoad: () => void }) {
  const { t } = useT();
  const out = trolley.status === "out_of_service";
  if (batch) {
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${trolley.code}, ${batch.number}, ${t(`ageing.phase.${batch.phase}`)}`}
        onPress={() => onOpen(batch.id)}
        className="min-h-14 gap-2 rounded-card border border-hairline bg-surface-sunken p-4"
      >
        <View className="flex-row items-center justify-between gap-2">
          <Text className="font-mono-semibold text-lg text-ink">{trolley.code}</Text>
          <PhaseChip phase={batch.phase} />
        </View>
        <Text className="font-mono-medium text-base text-ink">{batch.number}</Text>
        <Text className="font-sans text-sm text-ink-muted">{batch.recipeLabel ?? t("ageing.floor.noRecipeYet")}</Text>
        <View className="flex-row flex-wrap gap-x-4 gap-y-1">
          <Text className="font-sans text-sm text-ink">{t("ageing.floor.loadedPcs", { pcs: batch.totals.loadedPcs })}</Text>
          {batch.totals.packablePcs > 0 ? <Text className="font-sans text-sm text-ink">{t("ageing.floor.packablePcs", { pcs: batch.totals.packablePcs })}</Text> : null}
          {batch.totals.heldPcs > 0 ? <Text className="font-sans-semibold text-sm text-tone-red-ink">{t("ageing.floor.heldPcs", { pcs: batch.totals.heldPcs })}</Text> : null}
        </View>
      </PressableScale>
    );
  }
  return (
    <View className="gap-3 rounded-card border border-hairline bg-surface p-4">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="font-mono-semibold text-lg text-ink">{trolley.code}</Text>
        {out ? <Chip tone="neutral" label={t("ageing.masterStatus.out_of_service")} /> : <Chip tone="green" label={t("ageing.floor.free")} />}
      </View>
      {!out ? (
        <Can do="ageing.load">
          <Button variant="secondary" label={t("ageing.action.load")} onPress={onLoad} />
        </Can>
      ) : null}
    </View>
  );
}

function HeldCard({ batch, onOpen }: { batch: BatchSummary; onOpen: () => void }) {
  const { t } = useT();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${batch.number}, ${t("ageing.floor.heldPcs", { pcs: batch.totals.heldPcs })}`}
      onPress={onOpen}
      className="min-h-14 gap-1 rounded-card border border-hairline bg-tone-red-tint p-4"
    >
      <View className="flex-row items-center justify-between gap-2">
        <Text className="font-mono-semibold text-lg text-tone-red-ink">{batch.number}</Text>
        <PhaseChip phase="held" />
      </View>
      <Text className="font-sans text-sm text-tone-red-ink">
        {[t("ageing.floor.onTrolley", { trolley: batch.trolleyCode }), batch.recipeLabel, t("ageing.floor.heldPcs", { pcs: batch.totals.heldPcs })].filter(Boolean).join(", ")}
      </Text>
    </PressableScale>
  );
}
