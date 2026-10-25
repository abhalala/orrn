import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";

import { PressableScale } from "@/components/ui/pressable-scale";

import { ageingTile } from "./model";

const TILE = {
  red: { box: "bg-tone-red", text: "text-tone-red-on" },
  blue: { box: "bg-tone-blue", text: "text-tone-blue-on" },
  amber: { box: "bg-tone-amber", text: "text-tone-amber-on" },
  green: { box: "bg-tone-green", text: "text-tone-green-on" },
  neutral: { box: "bg-tone-neutral", text: "text-tone-neutral-on" },
} as const;

/**
 * Today's Ageing tile: batches in the oven, out and waiting for the test, and held, from the server's own
 * `dashboard.today().ageing` (null for a person without ageing.view; a plant without the module is left out here, since the server sends 0/0/0 to it).
 * Held turns it red. Tapping it opens the board under More.
 */
export function AgeingToday({ ageing, me }: { ageing: { inOven: number; held: number; out: number } | null | undefined; me: Parameters<typeof ageingTile>[1] }) {
  const { t } = useT();
  const router = useRouter();
  const tile = ageingTile(ageing, me);
  if (!tile) return null;
  const c = TILE[tile.tone];
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${t("today.oven.title")}, ${t("today.oven.inOven")} ${tile.inOven}, ${t("today.oven.out")} ${tile.out}, ${t("today.oven.held")} ${tile.held}`}
      accessibilityHint={t("today.oven.open")}
      onPress={() => router.push("/more/ageing")}
      className={cn("min-h-[88px] justify-between gap-3 rounded-block p-4", c.box)}
    >
      <Text className={cn("font-display-bold text-lg", c.text)}>{t("today.oven.title")}</Text>
      <View className="flex-row gap-6">
        <View>
          <Text className={cn("font-display-extrabold text-3xl", c.text)}>{tile.inOven}</Text>
          <Text className={cn("font-sans-medium text-[13px]", c.text)}>{t("today.oven.inOven")}</Text>
        </View>
        <View>
          <Text className={cn("font-display-extrabold text-3xl", c.text)}>{tile.out}</Text>
          <Text className={cn("font-sans-medium text-[13px]", c.text)}>{t("today.oven.out")}</Text>
        </View>
        <View>
          <Text className={cn("font-display-extrabold text-3xl", c.text)}>{tile.held}</Text>
          <Text className={cn("font-sans-medium text-[13px]", c.text)}>{t("today.oven.held")}</Text>
        </View>
      </View>
    </PressableScale>
  );
}
