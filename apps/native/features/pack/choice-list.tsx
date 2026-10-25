import Feather from "@expo/vector-icons/Feather";
import { cn } from "@orrn/ui/lib/utils";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { useThemeColor } from "@/lib/theme";

export type Choice = {
  value: string;
  /** What the radio says out loud and on screen. */
  label: string;
  detail?: string;
  /** A chip or tag beside the label. */
  tag?: ReactNode;
  disabled?: boolean;
};

/** A radio group of tappable rows (order line, die copy, cast). The chosen row says it is selected. */
export function ChoiceList({
  legend,
  hint,
  error,
  choices,
  value,
  onChange,
}: {
  legend: string;
  hint?: string;
  error?: string | null;
  choices: readonly Choice[];
  value: string;
  onChange: (value: string) => void;
}) {
  const ink = useThemeColor("foreground");
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={legend} className="gap-2">
      <Text className="font-sans-semibold text-[15px] text-ink">{legend}</Text>
      {choices.map((c) => {
        const selected = c.value === value;
        return (
          <PressableScale
            key={c.value || "none"}
            accessibilityRole="radio"
            accessibilityLabel={[c.label, c.detail].filter(Boolean).join(", ")}
            accessibilityState={{ checked: selected, selected, disabled: !!c.disabled }}
            disabled={c.disabled}
            onPress={() => onChange(c.value)}
            className={cn("min-h-14 flex-row items-center gap-3 rounded-card border bg-surface px-4 py-3", selected ? "border-primary" : "border-hairline", c.disabled && "opacity-50")}
          >
            <View className="min-w-0 flex-1 gap-0.5">
              <View className="flex-row flex-wrap items-center gap-2">
                <Text className="font-mono-semibold text-base text-ink">{c.label}</Text>
                {c.tag}
              </View>
              {c.detail ? <Text className="font-sans text-sm text-ink-muted">{c.detail}</Text> : null}
            </View>
            {selected ? <Feather name="check-circle" size={22} color={ink} importantForAccessibility="no" /> : null}
          </PressableScale>
        );
      })}
      {error ? (
        <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-destructive">
          {error}
        </Text>
      ) : hint ? (
        <Text className="font-sans text-sm text-ink-muted">{hint}</Text>
      ) : null}
    </View>
  );
}
