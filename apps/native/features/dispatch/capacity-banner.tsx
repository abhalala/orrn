import Feather from "@expo/vector-icons/Feather";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { Text, View } from "react-native";

import { useThemeColor } from "@/lib/theme";

import { capacityView } from "./capacity";
import type { CapacityReport } from "../scan/outcome";

const BOX = {
  ok: "border border-hairline bg-surface",
  near: "bg-tone-amber-tint",
  over: "bg-tone-red-tint",
} as const;
const TEXT = { ok: "text-ink", near: "text-tone-amber-ink", over: "text-tone-red-ink" } as const;
const BAR = { ok: "bg-primary", near: "bg-tone-amber-ink", over: "bg-tone-red-ink" } as const;

/**
 * How full the truck is, from the server's check: quiet while there is room, amber from 95 percent, red once
 * the load passes the capacity. It only warns. Nothing shows when the dispatch has no capacity set.
 */
export function CapacityBanner({ capacity }: { capacity: CapacityReport | null | undefined }) {
  const { t } = useT();
  const ink = useThemeColor("foreground");
  const view = capacityView(capacity);
  if (!view) return null;
  const headline = t(view.headline.key, view.headline.vars);
  const loaded = t("dispatch.capacity.loaded", view.loaded);
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={`${headline}. ${loaded}`}
      accessibilityLiveRegion="polite"
      className={cn("gap-2 rounded-card px-4 py-3", BOX[view.state])}
    >
      <View className="flex-row items-start gap-2">
        <Feather name={view.state === "ok" ? "truck" : "alert-triangle"} size={18} color={ink} importantForAccessibility="no" />
        <Text className={cn("min-w-0 flex-1 font-sans-semibold text-[15px] leading-6", TEXT[view.state])}>{headline}</Text>
      </View>
      <Text className={cn("font-mono-semibold text-sm", TEXT[view.state])}>{loaded}</Text>
      <View importantForAccessibility="no-hide-descendants" className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
        <View className={cn("h-full rounded-full", BAR[view.state])} style={{ width: `${view.pct}%` }} />
      </View>
    </View>
  );
}
