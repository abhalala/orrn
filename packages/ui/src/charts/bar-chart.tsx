import { formatCompactIN } from "@orrn/domain";
import { scaleBand } from "d3-scale";
import { useState, type KeyboardEvent } from "react";

import { ChartTooltip } from "./chart-tooltip";
import { estimateTextWidth, maxOf, ordinalColor, pickTickIndices, seriesColor, valueScale } from "./scales";
import { useChartWidth } from "./use-chart-width";

export type BarDatum = {
  key: string;
  /** Full name for the tooltip, the table and the accessible name ("Mar 2026"). */
  label: string;
  /** Shorter axis tick text ("Mar"). Defaults to `label`. */
  short?: string;
  value: number;
};

export type BarChartProps = {
  /** One series of vertical bars (grouped, never stacked unless parts of a whole). */
  data: BarDatum[];
  /** Full value for cap labels, tooltips and accessible names. */
  format(v: number): string;
  /** Whole chart height in px, x-axis band included. Default 240. */
  height?: number;
  /** Accessible name of the plot. */
  label?: string;
  /**
   * Ordered buckets (stock age, tiers): bars take the one-hue ordinal ramp,
   * low to high, so the order reads in the colour too. Nominal categories
   * (months, customers) keep one colour: never colour bars by their value.
   */
  ordinal?: boolean;
  /** Categorical slot for a nominal series. Default 0 (slot 1). */
  slot?: number;
  /** Axis tick text. Default compact en-IN. */
  formatTick?(v: number): string;
};

const TOP = 24;
const BOTTOM = 26;
const RIGHT = 4;
const BAR_MAX = 24;
const RADIUS = 4;
const TICK_FONT = 12;

/** Column with a 4px rounded data end, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  if (h <= 0) return "";
  const r = Math.min(RADIUS, w / 2, h);
  return [
    `M${x},${y + h}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + w - r}`,
    `Q${x + w},${y} ${x + w},${y + r}`,
    `V${y + h}`,
    "Z",
  ].join("");
}

/**
 * Vertical bar chart, one series. Bars are at most 24px wide and grow from
 * one baseline; values sit on the caps when every label fits, otherwise
 * only the tallest bar is labelled and the rest live in the tooltip and
 * the table. Each bar is its own hit target (the full band, full height):
 * hover or focus shows its tooltip and lifts it. The plot is one tab stop;
 * arrow keys move between bars.
 */
export function BarChart({ data, format, height = 240, label, ordinal = false, slot = 0, formatTick = formatCompactIN }: BarChartProps) {
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const [active, setActive] = useState<{ index: number; via: "pointer" | "focus" } | null>(null);
  const [roving, setRoving] = useState(0);
  const [hidden, setHidden] = useState(false);

  const peak = maxOf(data.map((d) => d.value));
  const plotH = Math.max(40, height - TOP - BOTTOM);
  const { scale: y, ticks } = valueScale(peak, plotH);
  const left = Math.max(...ticks.map((v) => estimateTextWidth(formatTick(v), TICK_FONT, true))) + 10;
  const plotW = Math.max(40, width - left - RIGHT);
  const band = scaleBand<string>()
    .domain(data.map((d) => d.key))
    .range([0, plotW])
    .paddingInner(0.25)
    .paddingOuter(0.15);
  const step = band.step();
  const barW = Math.min(BAR_MAX, band.bandwidth());
  const barX = (key: string) => band(key)! + (band.bandwidth() - barW) / 2;
  const colorAt = (i: number) => (ordinal ? ordinalColor(i, data.length) : seriesColor(slot));

  const capLabels = data.map((d) => format(d.value));
  const allCapsFit = capLabels.every((c) => estimateTextWidth(c, TICK_FONT, true) + 6 <= step);
  const peakIndex = data.findIndex((d) => d.value === peak);

  const xLabelWidth = Math.max(...data.map((d) => estimateTextWidth(d.short ?? d.label, TICK_FONT)), 16);
  const tickIdx = pickTickIndices(data.length, plotW, Math.max(step, xLabelWidth + 12));

  const show = active && !hidden ? active.index : null;
  const move = (to: number, el: Element | null) => {
    const i = Math.max(0, Math.min(data.length - 1, to));
    setRoving(i);
    el?.closest("svg")?.querySelectorAll<SVGRectElement>("[data-slot='chart-bar']")[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<SVGRectElement>, i: number) => {
    const keys: Record<string, number> = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: data.length - 1 };
    if (e.key === "Escape") {
      setHidden(true);
      return;
    }
    if (e.key in keys) {
      e.preventDefault();
      move(keys[e.key]!, e.currentTarget);
    }
  };

  return (
    <div
      ref={ref}
      data-chart-kit=""
      className="relative w-full"
      style={{ height }}
      onPointerLeave={() => setActive((a) => (a?.via === "pointer" ? null : a))}
    >
      {width > 0 && data.length > 0 ? (
        <svg data-slot="chart-plot" role="group" aria-label={label} width={width} height={height} className="block overflow-visible">
          <g transform={`translate(${left},${TOP})`}>
            <g aria-hidden="true">
              {ticks.map((v) => (
                <g key={v} transform={`translate(0,${y(v)})`}>
                  <line
                    x2={plotW}
                    stroke={v === 0 ? "var(--chart-axis)" : "var(--chart-grid)"}
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text x={-10} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[12px] tabular-nums">
                    {formatTick(v)}
                  </text>
                </g>
              ))}
              {tickIdx.map((i) => {
                const d = data[i]!;
                return (
                  <text
                    key={d.key}
                    data-slot="chart-x-tick"
                    x={band(d.key)! + band.bandwidth() / 2}
                    y={plotH + 18}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[12px]"
                  >
                    {d.short ?? d.label}
                  </text>
                );
              })}
            </g>

            <g aria-hidden="true" className="orrn-chart-in">
              {data.map((d, i) => (
                <path
                  key={d.key}
                  d={columnPath(barX(d.key), y(d.value), barW, plotH - y(d.value))}
                  fill={colorAt(i)}
                  style={show === i ? { filter: "brightness(1.12) saturate(1.1)" } : undefined}
                />
              ))}
              {data.map((d, i) => {
                if (!(allCapsFit || i === peakIndex)) return null;
                const w = estimateTextWidth(capLabels[i]!, TICK_FONT, true);
                const cx = band(d.key)! + band.bandwidth() / 2;
                const clamped = Math.max(w / 2 - left, Math.min(plotW + RIGHT - w / 2, cx));
                return (
                  <text
                    key={d.key}
                    data-slot="chart-cap-label"
                    x={clamped}
                    y={y(d.value) - 6}
                    textAnchor="middle"
                    className="fill-foreground font-mono text-[12px] font-medium tabular-nums"
                  >
                    {capLabels[i]}
                  </text>
                );
              })}
            </g>

            {/* Hit layer: each band, full height. */}
            <g>
              {data.map((d, i) => {
                const x0 = band(d.key)! - (step - band.bandwidth()) / 2;
                return (
                  <rect
                    key={d.key}
                    data-slot="chart-bar"
                    role="img"
                    aria-label={`${d.label}: ${capLabels[i]}`}
                    tabIndex={i === roving ? 0 : -1}
                    x={x0}
                    y={-TOP + 2}
                    width={step}
                    height={height - 4}
                    rx={8}
                    fill="transparent"
                    onPointerEnter={() => {
                      setHidden(false);
                      setActive({ index: i, via: "pointer" });
                    }}
                    onFocus={() => {
                      setHidden(false);
                      setRoving(i);
                      setActive({ index: i, via: "focus" });
                    }}
                    onBlur={() => setActive((a) => (a?.via === "focus" ? null : a))}
                    onKeyDown={(e) => onKeyDown(e, i)}
                  />
                );
              })}
            </g>
          </g>
        </svg>
      ) : null}

      {show !== null && width > 0 ? (
        <ChartTooltip
          x={left + band(data[show]!.key)! + band.bandwidth() / 2}
          y={Math.max(4, TOP + y(data[show]!.value) - 64)}
          boxWidth={width}
          title={data[show]!.label}
          rows={[{ key: data[show]!.key, value: capLabels[show]! }]}
        />
      ) : null}
    </div>
  );
}
