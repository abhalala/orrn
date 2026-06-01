import type { HTMLAttributes } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/**
 * Loading placeholder. Uses a moving gradient shimmer rather than just
 * opacity pulsing — feels more modern and reads as "data is on its way"
 * instead of "this thing is broken". Falls back to the pulse animation if
 * the browser drops the gradient (e.g. ancient browsers without
 * `background-size: 200% 100%`).
 */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      className={cn("orrn-skeleton-shimmer rounded-md bg-muted", className)}
      {...props}
    />
  );
}
