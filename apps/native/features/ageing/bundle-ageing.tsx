import { useT } from "@orrn/i18n";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { Chip } from "@/components/ui/chip";
import { PressableScale } from "@/components/ui/pressable-scale";
import { useFormat } from "@/lib/use-format";
import { can, useMe } from "@/utils/me";
import { trpc } from "@/utils/trpc";

import "./errors";
import { ageingModuleOn, x10Text } from "./model";
import { Figure } from "./ui";

const TONE = { aged: "green", in_ageing: "amber", held: "red", not_aged: "neutral" } as const;

/**
 * The bundle page's ageing line (FP-AG-13): "Aged" with the batch, trolley, oven, recipe, times and hardness it
 * passed, opening the batch for people who may read ageing. A bundle that never met a trolley says "Not aged".
 * Read from `ageing.bundleTrace` (any member); nothing is asked when the plant has no ageing module.
 */
export function BundleAgeing({ bundleId }: { bundleId: string }) {
  const { t } = useT();
  const router = useRouter();
  const format = useFormat();
  const { data: me } = useMe();
  const on = ageingModuleOn(me);
  const trace = useQuery({ ...trpc.ageing.bundleTrace.queryOptions({ bundleId }), enabled: on, staleTime: 30_000 });
  const d = trace.data;
  if (!on || !d) return null;
  const when = (ms: number) => `${format.day(ms) ?? ""} ${format.time(ms) ?? ""}`.trim();
  const mayOpen = can(me, "ageing.view");
  const facts: [string, string][] = [];
  if (d.trolleyCode) facts.push([t("ageing.field.trolley"), d.trolleyCode]);
  if (d.ovenCode) facts.push([t("ageing.field.oven"), d.ovenCode]);
  if (d.recipeLabel) facts.push([t("ageing.field.recipe"), d.recipeLabel]);
  if (d.inAt) facts.push([t("ageing.field.inAt"), when(d.inAt)]);
  if (d.outAt) facts.push([t("ageing.field.outAt"), when(d.outAt)]);
  if (d.releasedAt) facts.push([t("ageing.trace.released"), when(d.releasedAt)]);
  if (d.hardnessReadingX10 !== null) facts.push([t("ageing.field.hardness"), `${x10Text(d.hardnessReadingX10)} ${d.hardnessMethod ? t(`ageing.method.${d.hardnessMethod}`) : ""}`.trim()]);
  if (d.castCode) facts.push([t("ageing.field.cast"), d.castCode]);
  return (
    <View className="gap-3 rounded-card border border-hairline bg-surface p-4">
      <View className="flex-row items-center justify-between gap-2">
        <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
          {t("ageing.trace.title")}
        </Text>
        <Chip tone={TONE[d.state]} label={t(`ageing.bundleState.${d.state}`)} />
      </View>
      {d.batchNumber ? (
        mayOpen && d.batchId ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={d.batchNumber}
            onPress={() => router.push({ pathname: "/more/ageing/[id]", params: { id: d.batchId! } })}
            className="min-h-11 justify-center"
          >
            <Text className="font-mono-semibold text-base text-ink">{[d.batchNumber, d.pressRunNumber].filter(Boolean).join(", ")}</Text>
          </PressableScale>
        ) : (
          <Text className="font-mono-semibold text-base text-ink">{[d.batchNumber, d.pressRunNumber].filter(Boolean).join(", ")}</Text>
        )
      ) : (
        <Text className="font-sans text-sm text-ink-muted">{t("ageing.trace.none")}</Text>
      )}
      {facts.length > 0 ? (
        <View className="flex-row flex-wrap gap-x-4 gap-y-3">
          {facts.map(([label, value]) => (
            <Figure key={label} label={label} value={value} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * What voiding a bundle packed from a trolley line does (Q60-A): while the line's batch is open the pieces go back
 * to the line; once the batch is closed they are written off as loose aged stock and nothing goes back. Says nothing
 * for a bundle that never came off a trolley line (or whose batch the reader cannot see).
 */
export function BundleVoidNote({ bundleId, enabled }: { bundleId: string; enabled: boolean }) {
  const { t } = useT();
  const { data: me } = useMe();
  const on = enabled && ageingModuleOn(me);
  const trace = useQuery({ ...trpc.ageing.bundleTrace.queryOptions({ bundleId }), enabled: on, staleTime: 15_000 });
  const batchId = trace.data?.batchId ?? null;
  const batch = useQuery({ ...trpc.ageing.batches.get.queryOptions({ id: batchId ?? "" }), enabled: on && batchId !== null, staleTime: 15_000 });
  const rowId = trace.data?.ageingRowId ?? null;
  const row = batch.data?.rows.find((r) => r.id === rowId);
  // A whole-bundle row is the bundle itself: nothing is drawn from it and nothing goes back.
  if (!batch.data || !row || row.source === "bundle") return null;
  const closed = batch.data.status === "closed";
  if (!closed && batch.data.status !== "released" && batch.data.status !== "held") return null;
  return (
    <View accessibilityLiveRegion="polite" className="rounded-card bg-tone-amber-tint px-4 py-3">
      <Text className="font-sans-medium text-[15px] leading-6 text-tone-amber-ink">
        {closed ? t("ageing.trace.voidWritesOff", { batch: batch.data.number }) : t("ageing.trace.voidReturns", { batch: batch.data.number })}
      </Text>
    </View>
  );
}
