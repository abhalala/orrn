import Feather from "@expo/vector-icons/Feather";
import { cn } from "@orrn/ui/lib/utils";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { useThemeColor } from "@/lib/theme";

export type ListRowProps = {
  title: string;
  subtitle?: string;
  /** Mono text under the title (serials, codes). */
  code?: string;
  /** A chip or a number on the right. */
  trailing?: ReactNode;
  onPress?: () => void;
  /** Spoken name; defaults to title and subtitle. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  className?: string;
  /** Set inside a `radiogroup`: the row is a radio button, and this is whether it is the chosen one. */
  radioChecked?: boolean;
};

/** A 56px+ tappable row in a card list. With `onPress` it is a button with a chevron. */
export function ListRow({ title, subtitle, code, trailing, onPress, accessibilityLabel, accessibilityHint, className, radioChecked }: ListRowProps) {
  const muted = useThemeColor("muted-foreground");
  const label = accessibilityLabel ?? [title, code, subtitle].filter(Boolean).join(", ");
  const content = (
    <>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="font-sans-semibold text-base text-ink">{title}</Text>
        {code ? <Text className="font-mono text-sm text-ink-muted">{code}</Text> : null}
        {subtitle ? <Text className="font-sans text-sm text-ink-muted">{subtitle}</Text> : null}
      </View>
      {trailing}
      {onPress ? <Feather name="chevron-right" size={20} color={muted} importantForAccessibility="no" /> : null}
    </>
  );
  const classes = cn("min-h-14 flex-row items-center gap-3 rounded-card border border-hairline bg-surface px-4 py-3", className);
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} className={classes}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      accessibilityRole={radioChecked === undefined ? "button" : "radio"}
      accessibilityState={radioChecked === undefined ? undefined : { checked: radioChecked }}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      className={classes}
    >
      {content}
    </PressableScale>
  );
}
