import { Skeleton } from "@orrn/ui/components/skeleton";

/**
 * Stand-in for a ChartCard while the chart kit chunk loads (Suspense fallback). Same frame and
 * plot height as the card, so nothing jumps; it imports nothing from the kit.
 */
export function ChartCardSkeleton({ plotHeight = 240 }: { plotHeight?: number }) {
  return (
    <div aria-hidden="true" className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <Skeleton className="w-full rounded-input" style={{ height: plotHeight }} />
    </div>
  );
}
