import { cn } from "@orrn/ui/lib/utils";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

const NOTE_TONES = {
  neutral: { box: "bg-surface-sunken", text: "text-ink" },
  red: { box: "bg-tone-red-tint", text: "text-tone-red-ink" },
  green: { box: "bg-tone-green-tint", text: "text-tone-green-ink" },
} as const;

/** A plain sentence in a tinted box. */
export function Note({ tone = "neutral", children }: { tone?: keyof typeof NOTE_TONES; children: ReactNode }) {
  const c = NOTE_TONES[tone];
  return (
    <View accessibilityLiveRegion={tone === "neutral" ? "none" : "polite"} className={cn("rounded-card px-4 py-3", c.box)}>
      <Text className={cn("font-sans text-[15px] leading-6", c.text)}>{children}</Text>
    </View>
  );
}

/** A titled block of a screen. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-3 rounded-card border border-hairline bg-surface p-4">
      <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** A label and a figure. */
export function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-w-[44%] flex-1 gap-0.5">
      <Text className="font-sans text-[13px] text-ink-muted">{label}</Text>
      <Text className="font-mono-medium text-base text-ink">{value}</Text>
    </View>
  );
}
