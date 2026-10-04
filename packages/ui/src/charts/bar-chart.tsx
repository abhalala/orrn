import { useT } from "@orrn/i18n";
import { scaleBand } from "d3-scale";

import { TICK_FONT, XTicks, YAxis, useRovingMarks, useYAxis } from "./chart-internals";
import { ChartTooltip } from "./chart-tooltip";
import {
  capLabelBars,
  chartDateFormat,
  dateTickTexts,
  detectGranularity,
  estimateTextWidth,
  maxOf,
  ordinalColor,
  pickTickIndices,
  placeCapLabel,
  seriesColor,
  widestDateTick,
  type Box,
  type ChartDateFormat,
} from "./scales";
import { useChartWidth } from "./use-chart-width";

export type BarDatum = {
  key: string;
  /** Full name for the tooltip, the table and the accessible name ("Mar 2026"). */
  label: string;
  /** Shorter axis tick text for undated buckets ("0-15"). Defaults to `label`. */
  short?: string;
  /**
   * Start of a dated bucket (month, day). When every bar has one, the chart
   * writes the axis ticks from `formatDate` and adds the year where the axis
   * crosses into a new one ("Oct 25 ... Jan 26 ... Oct"); `short` is ignored.
   */
  t?: Date;
  value: number;
  /**
   * The bucket is still open (this month): a light fill with an outline,
   * read "so far" in the tooltip, name and table. Never carries a value
   * label on the plot. Last bar only.
   */
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
  /** Tick text for dated bars (`t`). Default: `chartDateFormat` by bucket size. */
  formatDate?: ChartDateFormat;
};

const TOP = 24;
const BOTTOM = 26;
const RIGHT = 4;
const BAR_MAX = 24;
const RADIUS = 4;
/** C2 input radius, for the keyboard focus ring around a bar. */
const RING_RADIUS = 12;
/** A bar with a value above zero is never thinner than this, so a day-one month still shows. */
const MIN_BAR = 2;
/** A partial bar's outlined box is at least this tall, so its outline reads. */
const MIN_PARTIAL = 4;

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
 * tooltip and the table. A zero bar is never labelled (the axis says 0). A value label stays inside the plot (never over
 * the y-axis ticks): at the first and last bars it lines up with the bar's
 * outer edge. A partial last bucket is a light fill with a 2px outline, at
 * least a sliver tall, and reads "so far"; it never carries a value label.
 * Each bar is its own hit target (the full band, full height) with its own
 * tooltip; keyboard focus draws a rounded ring inside the plot that starts
 * below any value label it would cross. One tab stop, starting on the
 * newest bar.
 */
export function BarChart({
  data,
  format,
  height = 240,
  label,
  ordinal = false,
  slot = 0,
  formatTicks,
  formatDate,
}: BarChartProps) {
  const { t, locale } = useT();
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const roving = useRovingMarks(
    data.map((d) => d.key),
    "chart-bar",
  );

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
  /** Top of a bar: a value above zero always shows, at least a sliver. */
  const topOf = (d: BarDatum) => (d.value > 0 ? Math.min(y(d.value), plotH - (d.partial ? MIN_PARTIAL : MIN_BAR)) : y(d.value));

  const capLabels = data.map((d) => format(d.value));
  // Value labels go on complete bars above zero only: an open bucket is never a headline.
  const complete = data.filter((d) => !d.partial);
  const allCapsFit = complete.every((d) => estimateTextWidth(format(d.value), TICK_FONT, true) + 6 <= step);
  const labelled = new Set(capLabelBars(data, allCapsFit));
  const caps = data
    .map((d, i) => {
      if (!labelled.has(i)) return null;
      const w = estimateTextWidth(capLabels[i]!, TICK_FONT, true);
      const spot = placeCapLabel({
        center: center(d.key),
        width: w,
        barLeft: barX(d.key),
        barRight: barX(d.key) + barW,
        plotRight: plotW + RIGHT,
      });
      const base = topOf(d) - 6;
      return { key: d.key, i, ...spot, base, box: { left: spot.left, right: spot.right, top: base - 12, bottom: base + 3 } as Box };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  // Dated bars write their own ticks, with the year where the axis crosses one.
  const times = data.every((d) => d.t) ? data.map((d) => d.t!.getTime()) : null;
  const dates = formatDate ?? (times ? chartDateFormat(detectGranularity(times), locale) : null);
  const xLabelWidth =
    times && dates
      ? widestDateTick(times, dates, TICK_FONT)
      : Math.max(...data.map((d) => estimateTextWidth(d.short ?? d.label, TICK_FONT)), 16);
  const tickIdx = pickTickIndices(data.length, plotW, Math.max(step, xLabelWidth + 12));
  const tickTexts =
    times && dates
      ? dateTickTexts(
          tickIdx.map((i) => times[i]!),
          dates,
        )
      : tickIdx.map((i) => data[i]!.short ?? data[i]!.label);
  const show = roving.show;
  const focused = roving.focusRing;

  // The ring never runs through a value label: where one crosses it, the
  // ring starts just below that label.
  const ring = (() => {
    if (focused === null) return null;
    const x0 = band(data[focused]!.key)! - 3;
    const x1 = x0 + band.bandwidth() + 6;
    const fullTop = -TOP + 3;
    // A label well inside the ring (clear of its sides and rounded corners) doesn't touch it.
    const inside = (b: Box) => b.left >= x0 + 2 && b.right <= x1 - 2 && b.top >= fullTop + RING_RADIUS;
    const crossing = caps.filter((c) => c.box.left < x1 + 1 && c.box.right > x0 - 1 && !inside(c.box));
    const top = Math.max(fullTop, ...crossing.map((c) => c.box.bottom + 2));
    return { left: x0, right: x1, top, bottom: plotH + 3 };
  })();

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
              items={tickIdx.map((i, k) => ({ key: data[i]!.key, x: center(data[i]!.key), text: tickTexts[k]! }))}
              plotH={plotH}
              minX={-left}
              maxX={plotW + RIGHT}
            />

            {ring ? (
              <rect
                data-slot="chart-focus-ring"
                aria-hidden="true"
                x={ring.left}
                y={ring.top}
                width={ring.right - ring.left}
                height={ring.bottom - ring.top}
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
                const top = topOf(d);
                if (d.partial) {
                  // Inset by the outline's half width so the 2px stroke stays on the bar.
                  return (
                    <path
                      key={d.key}
                      data-slot="chart-bar-mark"
                      data-partial=""
                      d={columnPath(barX(d.key) + 1, top + 1, barW - 2, plotH - top - 1)}
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
                    d={columnPath(barX(d.key), top, barW, plotH - top)}
                    fill={color}
                    style={lift}
                  />
                );
              })}
              {caps.map((c) => (
                <text
                  key={c.key}
                  data-slot="chart-cap-label"
                  x={c.x}
                  y={c.base}
                  textAnchor={c.anchor}
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
