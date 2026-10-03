import { useT } from "@orrn/i18n";
import { scaleBand } from "d3-scale";

import { TICK_FONT, XTicks, YAxis, useRovingMarks, useYAxis } from "./chart-internals";
import { ChartTooltip } from "./chart-tooltip";
import { estimateTextWidth, maxOf, ordinalColor, pickTickIndices, seriesColor, type Box } from "./scales";
import { useChartWidth } from "./use-chart-width";

export type BarDatum = {
  key: string;
  /** Full name for the tooltip, the table and the accessible name ("Mar 2026"). */
  label: string;
  /** Shorter axis tick text ("Mar"). Defaults to `label`. */
  short?: string;
  value: number;
  /** The bucket is still open (this month): a light fill with an outline, read "so far". Last bar only. */
  partial?: boolean;
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
  /** Labels for the whole set of y ticks (one unit per axis). Default compact en-IN. */
  formatTicks?(ticks: number[]): string[];
};

const TOP = 24;
const BOTTOM = 26;
const RIGHT = 4;
const BAR_MAX = 24;
const RADIUS = 4;
/** C2 input radius, for the keyboard focus ring around a bar. */
const RING_RADIUS = 12;

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
 * only the tallest complete bar is labelled and the rest live in the
 * tooltip and the table. A partial last bucket is a light fill with a 2px
 * outline and reads "so far". Each bar is its own hit target (the full
 * band, full height) with its own tooltip; keyboard focus draws a rounded
 * ring inside the plot. One tab stop, starting on the newest bar.
 */
export function BarChart({ data, format, height = 240, label, ordinal = false, slot = 0, formatTicks }: BarChartProps) {
  const { t } = useT();
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const roving = useRovingMarks(data.length, "chart-bar");

  const peak = maxOf(data.map((d) => d.value));
  const plotH = Math.max(40, height - TOP - BOTTOM);
  const { y, ticks, labels, left } = useYAxis(peak, plotH, formatTicks);
  const plotW = Math.max(40, width - left - RIGHT);
  const band = scaleBand<string>()
    .domain(data.map((d) => d.key))
    .range([0, plotW])
    .paddingInner(0.25)
    .paddingOuter(0.15);
  const step = band.step();
  const barW = Math.min(BAR_MAX, band.bandwidth());
  const barX = (key: string) => band(key)! + (band.bandwidth() - barW) / 2;
  const center = (key: string) => band(key)! + band.bandwidth() / 2;
  const colorAt = (i: number) => (ordinal ? ordinalColor(i, data.length) : seriesColor(slot));
  const nameOf = (d: BarDatum) => (d.partial ? t("charts.soFarLabel", { label: d.label }) : d.label);

  const capLabels = data.map((d) => format(d.value));
  const allCapsFit = capLabels.every((c) => estimateTextWidth(c, TICK_FONT, true) + 6 <= step);
  // The peak label goes on the tallest COMPLETE bar: an open bucket is never the headline.
  const completePeak = maxOf(data.filter((d) => !d.partial).map((d) => d.value));
  const peakIndex = data.findIndex((d) => !d.partial && d.value === completePeak);
  const caps = data
    .map((d, i) => {
      if (!(allCapsFit || i === peakIndex)) return null;
      const w = estimateTextWidth(capLabels[i]!, TICK_FONT, true);
      const cx = Math.max(w / 2 - left, Math.min(plotW + RIGHT - w / 2, center(d.key)));
      const base = y(d.value) - 6;
      return { key: d.key, i, cx, base, box: { left: cx - w / 2, right: cx + w / 2, top: base - 12, bottom: base + 3 } as Box };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const xLabelWidth = Math.max(...data.map((d) => estimateTextWidth(d.short ?? d.label, TICK_FONT)), 16);
  const tickIdx = pickTickIndices(data.length, plotW, Math.max(step, xLabelWidth + 12));
  const show = roving.show;
  const focused = roving.focusVisible ? show : null;

  return (
    <div
      ref={ref}
      data-chart-kit=""
      className="relative w-full"
      style={{ height }}
      onPointerLeave={roving.onPointerLeave}
    >
      {width > 0 && data.length > 0 ? (
        <svg data-slot="chart-plot" role="group" aria-label={label} width={width} height={height} className="block overflow-visible">
          <g transform={`translate(${left},${TOP})`}>
            <YAxis ticks={ticks} labels={labels} y={y} plotW={plotW} />
            <XTicks
              items={tickIdx.map((i) => ({ key: data[i]!.key, x: center(data[i]!.key), text: data[i]!.short ?? data[i]!.label }))}
              plotH={plotH}
              minX={-left}
              maxX={plotW + RIGHT}
            />

            {/* Under the marks and labels: the cap text's halo hides the ring where they cross. */}
            {focused !== null ? (
              <rect
                data-slot="chart-focus-ring"
                aria-hidden="true"
                x={band(data[focused]!.key)! - 3}
                y={-TOP + 3}
                width={band.bandwidth() + 6}
                height={TOP - 3 + plotH + 3}
                rx={RING_RADIUS}
                fill="none"
                stroke="var(--ring)"
                strokeWidth={2}
                pointerEvents="none"
              />
            ) : null}

            <g aria-hidden="true" className="orrn-chart-in">
              {data.map((d, i) => {
                const color = colorAt(i);
                const lift = show === i ? { filter: "brightness(1.12) saturate(1.1)" } : undefined;
                if (d.partial) {
                  // Inset by the outline's half width so the 2px stroke stays on the bar.
                  return (
                    <path
                      key={d.key}
                      data-slot="chart-bar-mark"
                      data-partial=""
                      d={columnPath(barX(d.key) + 1, y(d.value) + 1, barW - 2, plotH - y(d.value) - 1)}
                      fill={color}
                      fillOpacity={0.35}
                      stroke={color}
                      strokeWidth={2}
                      style={lift}
                    />
                  );
                }
                return (
                  <path
                    key={d.key}
                    data-slot="chart-bar-mark"
                    d={columnPath(barX(d.key), y(d.value), barW, plotH - y(d.value))}
                    fill={color}
                    style={lift}
                  />
                );
              })}
              {caps.map((c) => (
                <text
                  key={c.key}
                  data-slot="chart-cap-label"
                  x={c.cx}
                  y={c.base}
                  textAnchor="middle"
                  stroke="var(--card)"
                  strokeWidth={4}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                  className="fill-foreground font-mono text-[12px] font-medium tabular-nums"
                >
                  {capLabels[c.i]}
                </text>
              ))}
            </g>

            {/* Hit layer: each band, full height. Focus is drawn by the ring. */}
            <g>
              {data.map((d, i) => (
                <rect
                  key={d.key}
                  {...roving.markProps(i)}
                  role="img"
                  aria-label={`${nameOf(d)}: ${capLabels[i]}`}
                  x={band(d.key)! - (step - band.bandwidth()) / 2}
                  y={-TOP + 2}
                  width={step}
                  height={height - 4}
                  fill="transparent"
                  className="outline-none"
                />
              ))}
            </g>
          </g>
        </svg>
      ) : null}

      {show !== null && width > 0 ? (
        <ChartTooltip
          x={left + center(data[show]!.key)}
          boxWidth={width}
          boxHeight={height}
          minLeft={left}
          avoid={caps.map((c) => ({
            left: left + c.box.left,
            right: left + c.box.right,
            top: TOP + c.box.top,
            bottom: TOP + c.box.bottom,
          }))}
          title={nameOf(data[show]!)}
          rows={[{ key: data[show]!.key, value: capLabels[show]! }]}
        />
      ) : null}
    </div>
  );
}
