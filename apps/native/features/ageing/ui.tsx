import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { Chip } from "@/components/ui/chip";

import { ageingError } from "./errors";
import { phaseTone, rowTone, soakTone, STAGE_KEYS, STAGES } from "./model";
import type { Batch, BatchRow } from "./use-ageing";

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
    <View accessibilityLiveRegion={tone === "red" ? "polite" : "none"} className={cn("rounded-card px-4 py-3", c.box)}>
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
      <Text className="font-sans-medium text-[15px] leading-6 text-tone-red-ink">{ageingError(t, error)}</Text>
    </View>
  );
}

/** A titled block of a screen. */
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

export function PhaseChip({ phase }: { phase: Batch["phase"] }) {
  const { t } = useT();
  return <Chip tone={phaseTone(phase)} label={t(`ageing.phase.${phase}`)} />;
}

export function RowChip({ status }: { status: BatchRow["status"] }) {
  const { t } = useT();
  return <Chip tone={rowTone(status)} label={t(`ageing.rowStatus.${status}`)} />;
}

export function SoakChip({ verdict }: { verdict: NonNullable<Batch["soak"]>["verdict"] }) {
  const { t } = useT();
  return <Chip tone={soakTone(verdict)} label={t(`ageing.soakVerdict.${verdict}`)} />;
}

/**
 * The five stages of a cycle as numbered dots: the stage the batch stands at is filled, the ones behind it carry a
 * tint, and each says its name (colour is never the only signal). `current` is `stageIndex(batch)`.
 */
export function StageStepper({ current }: { current: number }) {
  const { t } = useT();
  return (
    <View accessibilityRole="list" className="flex-row items-start gap-1">
      {STAGES.map((stage, i) => {
        const done = i < current;
        const here = i === current;
        return (
          <View
            key={stage}
            accessible
            accessibilityRole="text"
            accessibilityLabel={t(STAGE_KEYS[stage])}
            accessibilityState={{ selected: here }}
            className="min-w-0 flex-1 items-center gap-1.5"
          >
            <View className={cn("h-8 w-8 items-center justify-center rounded-full", here ? "bg-primary" : done ? "bg-tone-green-tint" : "bg-surface-sunken")}>
              <Text className={cn("font-mono-semibold text-sm", here ? "text-primary-foreground" : done ? "text-tone-green-ink" : "text-ink-muted")}>{i + 1}</Text>
            </View>
            <Text numberOfLines={2} className={cn("text-center text-[12px] leading-4", here ? "font-sans-semibold text-ink" : "font-sans text-ink-muted")}>
              {t(STAGE_KEYS[stage])}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
