import type { StatusTone } from "@orrn/domain";
import { cn } from "@orrn/ui/lib/utils";
import { Text, View } from "react-native";

/** Static class names so Tailwind's scanner sees every tone. */
const TONE_CLASSES: Record<StatusTone, { box: string; text: string; dot: string }> = {
  green: { box: "bg-tone-green-tint", text: "text-tone-green-ink", dot: "bg-tone-green-ink" },
  blue: { box: "bg-tone-blue-tint", text: "text-tone-blue-ink", dot: "bg-tone-blue-ink" },
  amber: { box: "bg-tone-amber-tint", text: "text-tone-amber-ink", dot: "bg-tone-amber-ink" },
  red: { box: "bg-tone-red-tint", text: "text-tone-red-ink", dot: "bg-tone-red-ink" },
  neutral: { box: "bg-tone-neutral-tint", text: "text-tone-neutral-ink", dot: "bg-tone-neutral-ink" },
};

export type ChipProps = { tone: StatusTone; label: string; className?: string };

/**
 * Status chip: soft tint, tone ink, a dot ahead of the word so it still reads
 * as a status in greyscale. The word is the accessible name (colour is never
 * the only signal). Never shrinks next to text.
 */
export function Chip({ tone, label, className }: ChipProps) {
  const c = TONE_CLASSES[tone];
  return (
    <View accessible accessibilityLabel={label} className={cn("min-h-6 shrink-0 flex-row items-center gap-1.5 self-start rounded-full px-2.5 py-1", c.box, className)}>
      <View importantForAccessibility="no-hide-descendants" className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
      <Text numberOfLines={1} className={cn("font-sans-semibold text-xs", c.text)}>
        {label}
      </Text>
    </View>
  );
}
