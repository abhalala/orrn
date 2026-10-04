import { BigNumber } from "@orrn/ui/components/big-number";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import type { CSSProperties } from "react";

/**
 * A quiet KPI tile on the white surface: label, one meta line, big Bricolage number and its unit below.
 * The screen's one loud tile is a StatusBlock beside these.
 */
export function KpiTile({
  label,
  value,
  format,
  unit,
  meta,
  className,
  style,
}: {
  label: string;
  value: number;
  format?: (n: number) => string;
  unit?: string;
  meta?: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      data-slot="kpi-tile"
      style={style}
      className={cn("flex min-h-[168px] min-w-0 flex-col rounded-card border border-border bg-card p-[18px]", className)}
    >
      <span className="font-display text-[17px] leading-tight font-bold tracking-[-0.02em] break-words">{label}</span>
      {meta ? <span className="mt-1 text-[13px] leading-snug font-medium break-words text-muted-foreground">{meta}</span> : null}
      {/* The unit always takes its own line (empty when there is none), so the numbers of tiles
          side by side sit on one baseline even when a long unit would have wrapped on a phone. */}
      <span className="mt-auto flex flex-col gap-1 pt-6">
        <BigNumber value={value} format={format} countUp className="text-[36px] sm:text-[40px]" />
        <span aria-hidden={unit ? undefined : true} className="min-h-5 min-w-0 text-[13px] leading-5 font-semibold break-words">
          {unit}
        </span>
      </span>
    </div>
  );
}

export function KpiTileSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex min-h-[168px] flex-col justify-between rounded-card border border-border bg-card p-[18px]", className)}>
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-10 w-2/3" />
    </div>
  );
}
