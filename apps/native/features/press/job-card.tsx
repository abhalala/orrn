import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Text, View } from "react-native";

import { Chip } from "@/components/ui/chip";
import { PressableScale } from "@/components/ui/pressable-scale";
import { useLengthUnit } from "@/utils/length";

import { runBanner, type JobCard } from "./press-model";

const TONE = { neutral: "neutral", blue: "blue", green: "green", amber: "amber", red: "red" } as const;

/**
 * One die's job card (FP-PR-02): the sales order numbers with cut length, pieces and kg for each, the
 * totals and how much is already pressed. Read only; it opens the run.
 */
export function JobCardView({ card, onOpen }: { card: JobCard; onOpen: () => void }) {
  const { t } = useT();
  const lu = useLengthUnit();
  const banner = runBanner(card.status);
  const die = [card.sectionCode, card.copyCode ? t("native.press.jobCopy", { code: card.copyCode }) : t("native.press.jobNoCopy")].join(", ");
  const kg = formatKgTotal(gToKg(card.totals.kgG));
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${card.number}, ${die}, ${t(banner.headline)}, ${t("native.press.jobTotals", { pcs: card.totals.pcs, kg })}`}
      onPress={onOpen}
      className="gap-2 rounded-card border border-hairline bg-surface p-4"
    >
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="font-mono-semibold text-base text-ink">{card.number}</Text>
        <View className="flex-row flex-wrap items-center gap-2">
          {card.urgent ? <Chip tone="red" label={t("native.press.urgent")} /> : null}
          <Chip tone={TONE[banner.tone]} label={t(banner.headline)} />
        </View>
      </View>
      <Text className="font-sans-semibold text-[15px] text-ink">{die}</Text>
      {card.lines.map((l, i) => (
        <Text key={`${l.orderNumber}-${l.cutLengthMm}-${i}`} className="font-mono text-sm text-ink-muted">
          {t("native.press.jobLine", { order: l.orderNumber, length: lu.formatLength(l.cutLengthMm), pcs: l.pcs, kg: formatKgTotal(gToKg(l.kgG)) })}
        </Text>
      ))}
      <View className="flex-row flex-wrap items-baseline justify-between gap-2">
        <Text className="font-mono-semibold text-[15px] text-ink">{t("native.press.jobTotals", { pcs: card.totals.pcs, kg })}</Text>
        {card.totals.pressedG > 0 ? (
          <Text className="font-sans text-sm text-ink-muted">{t("native.press.jobPressed", { kg: formatKgTotal(gToKg(card.totals.pressedG)) })}</Text>
        ) : null}
      </View>
    </PressableScale>
  );
}
