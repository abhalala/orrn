import { formatKg, gToKg, kgPer12ft, weightRange12ft } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { Chip } from "@/components/ui/chip";
import { PressableScale } from "@/components/ui/pressable-scale";
import { formatKgBand } from "@/features/stock/format";
import { useLengthUnit } from "@/utils/length";

import { rangeStatus } from "./timeline";

const RANGE_TONE = { inRange: "green", below: "amber", above: "amber", noRange: "neutral" } as const;

type Fact = { key: string; label: string; value: ReactNode };

/**
 * The bundle's facts on a card: weight in kg, pieces, cut length in the
 * company unit, kg/12ft with its range chip against the die's band, the
 * billed weight range /12', the section, PO, packing session and when it was
 * packed. Section and session link to their pages.
 */
export function BundleFacts({
  bundle,
  die,
  group,
  packedAt,
}: {
  bundle: { weightG: number; quantity: number; lengthMm: number; poNumber: string | null; dieId: string };
  die: { series: string; sectionCode: string; name: string | null; weightMinG: number; weightMaxG: number } | null;
  group: { id: string; code: string } | null;
  packedAt: string;
}) {
  const { t } = useT();
  const router = useRouter();
  const lu = useLengthUnit();
  const perFoot = kgPer12ft({ weightG: bundle.weightG, pieces: bundle.quantity, lengthMm: bundle.lengthMm });
  const range = die ? rangeStatus(perFoot, die.weightMinG, die.weightMaxG) : "noRange";
  const band = die ? formatKgBand(die.weightMinG, die.weightMaxG) : null;
  const section = die ? [die.series, die.sectionCode].filter(Boolean).join(" ") : null;

  const link = (label: string, mono: boolean, href: string) => (
    <PressableScale accessibilityRole="link" accessibilityLabel={label} onPress={() => router.push(href)} className="min-h-11 justify-center">
      <Text className={`${mono ? "font-mono-semibold" : "font-sans-semibold"} text-base text-ink underline`}>{label}</Text>
    </PressableScale>
  );

  const facts: Fact[] = [
    { key: "weight", label: t("bundle.facts.weight"), value: `${formatKg(gToKg(bundle.weightG))} kg` },
    { key: "pieces", label: t("bundle.facts.pieces"), value: String(bundle.quantity) },
    { key: "length", label: t("bundle.facts.cutLength"), value: lu.formatLength(bundle.lengthMm) },
    {
      key: "kg12",
      label: t("bundle.facts.kgPer12ft"),
      value:
        perFoot === null ? (
          "-"
        ) : (
          <View className="flex-row flex-wrap items-center justify-end gap-2">
            <Text className="font-mono-semibold text-base text-ink">{formatKg(perFoot)}</Text>
            {range !== "noRange" ? <Chip tone={RANGE_TONE[range]} label={t(`status.range.${range}`)} /> : null}
          </View>
        ),
    },
    { key: "range", label: t("bundle.facts.weightRange"), value: perFoot === null ? "-" : formatKg(weightRange12ft(perFoot), 1) },
    ...(band ? [{ key: "band", label: t("bundle.facts.dieBand"), value: band }] : []),
    { key: "section", label: t("bundle.facts.section"), value: section ? link(section, false, `/stock/${encodeURIComponent(bundle.dieId)}`) : "-" },
    ...(die?.name ? [{ key: "die", label: t("bundle.facts.die"), value: die.name }] : []),
    ...(bundle.poNumber ? [{ key: "po", label: t("bundle.facts.po"), value: bundle.poNumber }] : []),
    ...(group ? [{ key: "session", label: t("bundle.facts.session"), value: link(group.code, true, `/pack/${encodeURIComponent(group.id)}`) }] : []),
    { key: "packed", label: t("bundle.facts.packed"), value: packedAt },
  ];

  return (
    <View className="rounded-card border border-hairline bg-surface px-4">
      {facts.map((f, i) => (
        <View
          key={f.key}
          accessible={typeof f.value === "string"}
          accessibilityLabel={typeof f.value === "string" ? `${f.label}, ${f.value}` : undefined}
          className={`min-h-12 flex-row items-center justify-between gap-4 py-2 ${i > 0 ? "border-t border-hairline" : ""}`}
        >
          <Text className="font-sans-medium text-sm text-ink-muted">{f.label}</Text>
          <View className="min-w-0 shrink items-end">
            {typeof f.value === "string" ? <Text className="text-right font-mono-semibold text-base text-ink">{f.value}</Text> : f.value}
          </View>
        </View>
      ))}
    </View>
  );
}
