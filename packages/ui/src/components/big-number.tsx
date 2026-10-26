import type { HTMLAttributes } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { useCountUp } from "./motion";

export type BigNumberProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  value: number;
  /** Formats the number for display (e.g. `formatKgTotal`). Default: en-IN grouping, no decimals. */
  format?: (n: number) => string;
  /** Count up from 0 on first render (KPI blocks). Off under reduced motion. */
  countUp?: boolean;
};

const defaultFormat = (n: number) => Math.round(n).toLocaleString("en-IN");

/**
 * Display number in Bricolage with tabular figures. Size comes from the
 * parent (`text-[52px]` etc.). While counting, screen readers get the final
 * value only; the moving digits are hidden from them. Marked
 * `data-no-truncate`: the e2e layout guard fails if it is ever cut off.
 */
export function BigNumber({ value, format = defaultFormat, countUp = false, className, ...rest }: BigNumberProps) {
  const shown = useCountUp(value, { enabled: countUp });
  const finalText = format(value);
  const counting = countUp && shown !== value;
  return (
    <span
      data-slot="big-number"
      // A key value: shown in full, never ellipsised (layout guards check it).
      data-no-truncate=""
      className={cn(
        "inline-block font-display font-extrabold leading-[0.95] tracking-[-0.04em] tabular-nums",
        className,
      )}
      {...rest}
    >
      {counting ? (
        // The invisible final value reserves the width so nothing shifts as digits grow.
        <span className="inline-grid">
          <span aria-hidden="true" className="invisible col-start-1 row-start-1">
            {finalText}
          </span>
          <span aria-hidden="true" className="col-start-1 row-start-1">
            {format(shown)}
          </span>
          <span className="sr-only">{finalText}</span>
        </span>
      ) : (
        finalText
      )}
    </span>
  );
}
