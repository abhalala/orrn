import type { HTMLAttributes } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type SkeletonProps = HTMLAttributes<HTMLDivElement>;

/**
 * Loading placeholder shaped like the content it stands in for (size it with
 * the same height/width/radius as the real thing). A soft sheen moves across
 * it; under reduced motion it is a still block. Hidden from screen readers;
 * mark the loading region with `aria-busy` instead.
 */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("orrn-skeleton-shimmer rounded-input bg-surface-sunken dark:bg-surface-overlay", className)}
      {...props}
    />
  );
}
