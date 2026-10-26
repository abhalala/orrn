import { formatKgTotal, gToKg, type StatusTone } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { useRouter } from "expo-router";
import { Text, View } from "react-native";

import { BigNumber } from "@/components/ui/big-number";
import { PressableScale } from "@/components/ui/pressable-scale";
import { toEntering } from "@/lib/entering";
import { riseEntering } from "@/lib/motion";
import { AnimatedView } from "@/lib/nativewind-interop";
import { useReduceMotion } from "@/lib/reduced-motion";

import { formatKgBand } from "./format";
import type { SectionRow } from "./sections";

/** Static class names so Tailwind sees every tone. */
const TONE: Record<StatusTone, { bg: string; on: string }> = {
  green: { bg: "bg-tone-green", on: "text-tone-green-on" },
  blue: { bg: "bg-tone-blue", on: "text-tone-blue-on" },
  amber: { bg: "bg-tone-amber", on: "text-tone-amber-on" },
  red: { bg: "bg-tone-red", on: "text-tone-red-on" },
  neutral: { bg: "bg-tone-neutral", on: "text-tone-neutral-on" },
};

/**
 * One section on the Stock tab: green when bundles are in stock, blue when
 * every bundle is held (the colour is the status), with the count as the big
 * number, kg, held bundles and the die's kg/12ft band. Opens the section.
 */
export function SectionBlock({ row, index }: { row: SectionRow; index: number }) {
  const { t } = useT();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const c = TONE[row.tone];
  const heldOnly = row.state === "held";
  const count = heldOnly ? row.held : row.bundles;
  const weightG = heldOnly ? row.heldWeightG : row.weightG;
  const band = formatKgBand(row.bandMinG, row.bandMaxG);
  const unit = heldOnly ? t("stock.block.unitHeld", { count }) : t("stock.block.unitInStock", { count });
  const meta = [
    row.state === "none" ? null : t("stock.block.kg", { kg: formatKgTotal(gToKg(weightG)) }),
    row.state === "inStock" && row.held > 0 ? t("stock.heldKg", { count: row.held, kg: formatKgTotal(gToKg(row.heldWeightG)) }) : null,
    band ? t("stock.block.band", { band }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const label = [row.label, row.name, row.state === "none" ? null : `${count} ${unit}`, meta].filter(Boolean).join(", ");

  return (
    <AnimatedView entering={toEntering(riseEntering(reduceMotion, index))}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => router.push(`/stock/${encodeURIComponent(row.dieId)}`)}
        className={cn("min-h-[96px] gap-2 rounded-block p-4", c.bg)}
      >
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className={cn("font-display-bold text-[18px] leading-6", c.on)}>{row.label}</Text>
            {row.name ? <Text className={cn("font-sans-medium text-[13px]", c.on)}>{row.name}</Text> : null}
          </View>
          {row.state === "none" ? null : (
            <View className="items-end">
              <BigNumber value={count} className={cn("text-[34px] leading-[46px]", c.on)} />
              <Text className={cn("font-sans-semibold text-[13px]", c.on)}>{unit}</Text>
            </View>
          )}
        </View>
        {meta ? <Text className={cn("font-sans-medium text-[13px]", c.on)}>{meta}</Text> : null}
      </PressableScale>
    </AnimatedView>
  );
}
