import type { StatusTone } from "@orrn/domain";
import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { PALETTE_CLASSES } from "./badge";

export type ChipProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  tone: StatusTone;
  /** The status word ("In stock", "Held", "Void"). Colour is never the only signal. */
  children: ReactNode;
};

/**
 * Status chip: soft tint with tone ink (>= 4.5:1 in both themes, checked in
 * tokens.test.ts). A small dot in the ink colour leads the word so the chip
 * still reads as a status in greyscale.
 */
export function Chip({ tone, children, className, ...rest }: ChipProps) {
  return (
    <span
      data-slot="chip"
      data-tone={tone}
      className={cn(
        "inline-flex min-h-6 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold leading-none",
        PALETTE_CLASSES[tone],
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
      <span className="truncate">{children}</span>
    </span>
  );
}
