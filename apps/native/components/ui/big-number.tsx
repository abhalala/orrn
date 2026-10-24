import { cn } from "@orrn/ui/lib/utils";
import { useEffect, useState } from "react";
import { Text, type TextProps } from "react-native";

import { useReduceMotion } from "@/lib/reduced-motion";

export type BigNumberProps = Omit<TextProps, "children"> & {
  value: number;
  /** Formats the number for display (e.g. `formatKgTotal`). Default: en-IN grouping, no decimals. */
  format?: (n: number) => string;
  /** Count up from 0 on first render (KPI blocks). Off under reduced motion. */
  countUp?: boolean;
  className?: string;
};

const defaultFormat = (n: number) => Math.round(n).toLocaleString("en-IN");
const COUNT_MS = 700;

/**
 * Display number in Bricolage with tabular figures. Size comes from the
 * className (`text-5xl`). While counting, screen readers get the final value
 * only (accessibilityLabel). Never ellipsised: a key value is shown in full.
 */
export function BigNumber({ value, format = defaultFormat, countUp = false, className, ...rest }: BigNumberProps) {
  const reduceMotion = useReduceMotion();
  const animate = countUp && !reduceMotion;
  const [shown, setShown] = useState(animate ? 0 : value);

  useEffect(() => {
    if (!animate) {
      setShown(value);
      return;
    }
    const start = Date.now();
    const from = 0;
    let frame = 0;
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / COUNT_MS);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from + (value - from) * eased);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, animate]);

  const finalText = format(value);
  return (
    <Text
      accessibilityLabel={finalText}
      {...rest}
      className={cn("font-display-extrabold tracking-tighter text-ink", className)}
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {format(animate ? shown : value)}
    </Text>
  );
}
