import { useLayoutEffect, useRef, useState } from "react";

export type ChartTooltipRow = { key: string; label?: string; value: string; color?: string };

export type ChartTooltipProps = {
  /** Anchor x inside the chart box (the crosshair or the bar centre). */
  x: number;
  /** Top of the tooltip inside the chart box. */
  y: number;
  /** Width of the chart box, to keep the tooltip inside it. */
  boxWidth: number;
  title: string;
  rows: ChartTooltipRow[];
};

const GAP = 12;

/**
 * The one tooltip for every chart. Values lead (strong, mono), series names
 * follow (muted), keyed by a short line in the series colour, never a box.
 * Hidden from assistive tech: the focused mark's accessible name already
 * says the same thing, so screen readers don't hear it twice. Labels are
 * rendered as React text (escaped), never as HTML.
 */
export function ChartTooltip({ x, y, boxWidth, title, rows }: ChartTooltipProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(160);
  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.offsetWidth);
  }, [title, rows]);

  // Right of the anchor when it fits, else left of it, always inside the box.
  let left = x + GAP;
  if (left + width > boxWidth) left = x - GAP - width;
  left = Math.max(0, Math.min(left, boxWidth - width));

  return (
    <div
      ref={ref}
      data-slot="chart-tooltip"
      aria-hidden="true"
      className="pointer-events-none absolute z-10 flex max-w-[min(240px,100%)] flex-col gap-1 rounded-input border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md"
      style={{ left, top: y }}
    >
      <span data-slot="chart-tooltip-title" className="text-[12px] font-medium leading-4 text-muted-foreground">
        {title}
      </span>
      {rows.map((row) => (
        <span key={row.key} className="flex items-center gap-2 leading-5">
          {row.color ? (
            <span aria-hidden="true" className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: row.color }} />
          ) : null}
          <span data-slot="chart-tooltip-value" className="font-mono text-[14px] font-semibold whitespace-nowrap">
            {row.value}
          </span>
          {row.label ? <span className="min-w-0 text-[12px] text-muted-foreground">{row.label}</span> : null}
        </span>
      ))}
    </div>
  );
}
