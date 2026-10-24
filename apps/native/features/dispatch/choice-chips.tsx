import { cn } from "@orrn/ui/lib/utils";
import { Text, View } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";

export type ChoiceOption<V extends string> = { value: V; label: string };

/**
 * A wrapping row of pill choices, one selected (ship date: none, today,
 * tomorrow, typed). A radio group, so a screen reader hears "selected". Unlike
 * the segmented control these wrap, so four long Hindi words still fit.
 */
export function ChoiceChips<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly ChoiceOption<V>[];
  value: V;
  onChange: (value: V) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} className="flex-row flex-wrap gap-2">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <PressableScale
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: selected, selected }}
            onPress={() => onChange(o.value)}
            className={cn("min-h-11 justify-center rounded-full border px-4", selected ? "border-primary bg-primary" : "border-control bg-surface")}
          >
            <Text className={cn("font-sans-semibold text-[15px]", selected ? "text-primary-foreground" : "text-ink")}>{o.label}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}
