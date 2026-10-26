import { cn } from "@orrn/ui/lib/utils";
import { Text, View } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";

export type SegmentOption<V extends string> = { value: V; label: string };

export type SegmentedControlProps<V extends string> = {
  /** Names the group for screen readers. */
  label: string;
  options: readonly SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
  className?: string;
};

/** Pill toggle for two to four choices (Building / Held / Dispatched, mm / inch). A radio group: each segment says it is selected. */
export function SegmentedControl<V extends string>({ label, options, value, onChange, className }: SegmentedControlProps<V>) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} className={cn("flex-row gap-1 rounded-full bg-surface-sunken p-1 dark:border dark:border-hairline dark:bg-canvas", className)}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <PressableScale
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: selected, selected }}
            onPress={() => onChange(o.value)}
            className="min-w-0 flex-1"
          >
            <View className={cn("min-h-11 items-center justify-center rounded-full px-3", selected && "bg-surface dark:border dark:border-control/40 dark:bg-surface-sunken")}>
              <Text numberOfLines={1} className={cn("text-[15px] text-ink", selected ? "font-sans-semibold" : "font-sans")}>
                {o.label}
              </Text>
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}
