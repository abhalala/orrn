import Feather from "@expo/vector-icons/Feather";
import { cn } from "@orrn/ui/lib/utils";
import { Text, View } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { useThemeColor } from "@/lib/theme";

/** One choice in a sheet's pick list (a press run, a die maker, a line): a radio row, 56px tall. */
export function ChoiceRow({ label, detail, selected, onPress }: { label: string; detail?: string; selected: boolean; onPress: () => void }) {
  const ink = useThemeColor("foreground");
  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ checked: selected, selected }}
      onPress={onPress}
      className={cn("min-h-14 flex-row items-center gap-3 rounded-card border px-4 py-3", selected ? "border-primary bg-surface-sunken" : "border-hairline bg-surface")}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-sans-semibold text-base text-ink">{label}</Text>
        {detail ? <Text className="font-sans text-sm text-ink-muted">{detail}</Text> : null}
      </View>
      {selected ? <Feather name="check" size={20} color={ink} importantForAccessibility="no" /> : null}
    </PressableScale>
  );
}
