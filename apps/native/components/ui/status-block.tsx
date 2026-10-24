import type { StatusTone } from "@orrn/domain";
import { cn } from "@orrn/ui/lib/utils";
import { Text, View } from "react-native";

import { BigNumber } from "@/components/ui/big-number";
import { PressableScale } from "@/components/ui/pressable-scale";
import { AnimatedView } from "@/lib/nativewind-interop";
import { toEntering } from "@/lib/entering";
import { riseEntering } from "@/lib/motion";
import { useReduceMotion } from "@/lib/reduced-motion";

const TONE_CLASSES: Record<StatusTone, { bg: string; on: string; bar: string }> = {
  green: { bg: "bg-tone-green", on: "text-tone-green-on", bar: "bg-tone-green-on" },
  blue: { bg: "bg-tone-blue", on: "text-tone-blue-on", bar: "bg-tone-blue-on" },
  amber: { bg: "bg-tone-amber", on: "text-tone-amber-on", bar: "bg-tone-amber-on" },
  red: { bg: "bg-tone-red", on: "text-tone-red-on", bar: "bg-tone-red-on" },
  neutral: { bg: "bg-tone-neutral", on: "text-tone-neutral-on", bar: "bg-tone-neutral-on" },
};

export type StatusBlockProps = {
  tone: StatusTone;
  title: string;
  /** One line under the title. Carry the status word here when the title does not ("In stock", "Held"). */
  meta?: string;
  value: number | string;
  unit?: string;
  /** 0..1, drawn as a bar under the number. */
  progress?: number;
  onPress?: () => void;
  /** Hint read after the label for a block that opens something. */
  accessibilityHint?: string;
  /** Count a numeric value up from 0 on first render. */
  countUp?: boolean;
  format?: (n: number) => string;
  /** Position in the screen's stagger (`rise`). */
  index?: number;
  className?: string;
};

/**
 * The C2 status tile: a colour block whose colour IS the status, with a title,
 * one meta line, a big Bricolage number and an optional progress bar. Text
 * uses the tone's `on` colour at full strength; hierarchy comes from size and
 * weight, never from opacity. With `onPress` the whole block is a button.
 */
export function StatusBlock({ tone, title, meta, value, unit, progress, onPress, accessibilityHint, countUp = true, format, index = 0, className }: StatusBlockProps) {
  const reduceMotion = useReduceMotion();
  const c = TONE_CLASSES[tone];
  const pct = progress === undefined ? undefined : Math.round(Math.min(1, Math.max(0, progress)) * 100);
  const valueText = typeof value === "number" ? (format ? format(value) : Math.round(value).toLocaleString("en-IN")) : value;
  const label = [title, meta, `${valueText}${unit ? ` ${unit}` : ""}`].filter(Boolean).join(", ");

  const body = (
    <>
      <View>
        <Text className={cn("font-display-bold text-[17px] leading-6", c.on)}>{title}</Text>
        {meta ? <Text className={cn("mt-1 font-sans-medium text-[13px]", c.on)}>{meta}</Text> : null}
      </View>
      <View className="mt-6 flex-row flex-wrap items-baseline gap-x-2 gap-y-1">
        {typeof value === "number" ? (
          <BigNumber value={value} format={format} countUp={countUp} className={cn("text-[44px] leading-[58px]", c.on)} />
        ) : (
          <Text className={cn("max-w-full font-mono-semibold text-[32px] leading-[42px]", c.on)}>{value}</Text>
        )}
        {unit ? <Text className={cn("font-sans-semibold text-[13px]", c.on)}>{unit}</Text> : null}
      </View>
      {pct !== undefined ? (
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }} className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/20">
          <View className={cn("h-full rounded-full", c.bar)} style={{ width: `${pct}%` }} />
        </View>
      ) : null}
    </>
  );

  const classes = cn("min-h-[168px] w-full justify-between rounded-block p-[18px]", c.bg, className);
  const entering = toEntering(riseEntering(reduceMotion, index));

  return (
    <AnimatedView entering={entering}>
      {onPress ? (
        <PressableScale accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint} onPress={onPress} className={classes}>
          {body}
        </PressableScale>
      ) : (
        <View accessible accessibilityLabel={label} className={classes}>
          {body}
        </View>
      )}
    </AnimatedView>
  );
}
