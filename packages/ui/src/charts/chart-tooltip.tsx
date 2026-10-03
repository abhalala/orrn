import { useLayoutEffect, useRef } from "react";

import { boxesOverlap, type Box } from "./scales";

export type ChartTooltipRow = { key: string; label?: string; value: string; color?: string };

export type ChartTooltipProps = {
  /** Anchor x inside the chart box (the crosshair or the bar centre). */
  x: number;
  /** Width and height of the chart box, to keep the tooltip inside it. */
  boxWidth: number;
  boxHeight: number;
  /** Never cover anything left of this (the y-axis ticks). */
  minLeft: number;
  /** Labels the tooltip must not cover (peak value, end labels). */
  avoid?: Box[];
  title: string;
  rows: ChartTooltipRow[];
};

const GAP = 12;

/**
 * The one tooltip for every chart. Values lead (strong, mono), series names
 * follow (muted), keyed by a short line in the series colour, never a box.
 * Placed right of the anchor, else left, at the top, middle or bottom of the
 * plot: the first spot that stays clear of the y-axis ticks and of `avoid`.
 * Hidden from assistive tech: the focused mark's accessible name already
 * says the same thing, so screen readers don't hear it twice. Labels are
 * rendered as React text (escaped), never as HTML.
 */
export function ChartTooltip({ x, boxWidth, boxHeight, minLeft, avoid = [], title, rows }: ChartTooltipProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // Place it against its real size before paint, every render (no stale
  // first-render size, no second pass). `transition-none` matters: the
  // global reduced-motion rule gives every property a 0.01ms transition,
  // which would leave the box at its old spot until the next frame.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // Beside the anchor on either side; on a narrow plot, clamped inside it.
    const xs = [x + GAP, x - GAP - w, Math.max(minLeft, Math.min(x + GAP, boxWidth - w))];
    const ys = [4, Math.max(4, (boxHeight - h) / 2), Math.max(4, boxHeight - h - 30)];
    const candidates = ys.flatMap((top) => xs.map((left) => ({ left, top })));
    const fits = (c: { left: number; top: number }) => c.left >= minLeft && c.left + w <= boxWidth;
    const clear = (c: { left: number; top: number }) =>
      !avoid.some((a) => boxesOverlap({ left: c.left, top: c.top, right: c.left + w, bottom: c.top + h }, a, 2));
    const spot =
      candidates.find((c) => fits(c) && clear(c)) ??
      candidates.find(fits) ?? { left: Math.max(minLeft, Math.min(x + GAP, boxWidth - w)), top: 4 };
    el.style.left = `${Math.max(0, spot.left)}px`;
    el.style.top = `${spot.top}px`;
  });

  return (
    <div
      ref={ref}
      data-slot="chart-tooltip"
      aria-hidden="true"
      className="pointer-events-none absolute z-10 flex w-max transition-none max-w-[min(240px,100%)] flex-col gap-1 rounded-input border border-border bg-popover px-3 py-2 text-popover-foreground shadow-md"
      style={{ left: x + GAP, top: 4 }}
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
