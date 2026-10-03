import { BigNumber } from "@orrn/ui/components/big-number";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";
import type { CSSProperties } from "react";

/**
 * A quiet KPI tile on the white surface: label, big Bricolage number, unit and one meta line.
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
      <span className="mt-auto flex flex-wrap items-baseline gap-x-2 gap-y-1 pt-6">
        <BigNumber value={value} format={format} countUp className="text-[36px] sm:text-[40px]" />
        {unit ? <span className="min-w-0 text-[13px] font-semibold break-words">{unit}</span> : null}
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
