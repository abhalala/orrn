import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { foundryError } from "./errors";

/** Kg text from grams, the way every other phone screen says it. */
export const kgOf = (g: number): string => formatKgTotal(gToKg(g));

const NOTE_TONES = {
  neutral: { box: "bg-surface-sunken", text: "text-ink" },
  amber: { box: "bg-tone-amber-tint", text: "text-tone-amber-ink" },
  red: { box: "bg-tone-red-tint", text: "text-tone-red-ink" },
  green: { box: "bg-tone-green-tint", text: "text-tone-green-ink" },
} as const;

/** A plain sentence in a tinted box (info or warning). */
export function Note({ tone = "neutral", children }: { tone?: keyof typeof NOTE_TONES; children: ReactNode }) {
  const c = NOTE_TONES[tone];
  return (
    <View className={cn("rounded-card px-4 py-3", c.box)}>
      <Text className={cn("font-sans text-[15px] leading-6", c.text)}>{children}</Text>
    </View>
  );
}

/** A refused write, said in the person's language where the form can see it (never the server's English). */
export function ErrorLine({ error }: { error: unknown }) {
  const { t } = useT();
  if (!error) return null;
  return (
    <View accessibilityLiveRegion="polite" className="rounded-card bg-tone-red-tint px-4 py-3">
      <Text className="font-sans-medium text-[15px] leading-6 text-tone-red-ink">{foundryError(t, error)}</Text>
    </View>
  );
}

/** A titled block of a sheet or screen. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View className="gap-3 rounded-card border border-hairline bg-surface p-4">
      <Text accessibilityRole="header" className="font-display-bold text-lg text-ink">
        {title}
      </Text>
      {hint ? <Text className="font-sans text-sm text-ink-muted">{hint}</Text> : null}
      {children}
    </View>
  );
}

/** A label and a figure in one row of a card. */
export function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View className="min-w-[44%] flex-1 gap-0.5">
      <Text className="font-sans text-[13px] text-ink-muted">{label}</Text>
      <Text className={cn("font-mono text-base text-ink", strong ? "font-mono-semibold" : "font-mono-medium")}>{value}</Text>
    </View>
  );
}
