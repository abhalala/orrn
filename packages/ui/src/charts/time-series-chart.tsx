import { useT } from "@orrn/i18n";
import { area as d3area, curveMonotoneX, line as d3line } from "d3-shape";
import { scaleLinear } from "d3-scale";
import { useMemo } from "react";

import { TICK_FONT, XTicks, YAxis, useRovingMarks, useYAxis } from "./chart-internals";
import { ChartTooltip } from "./chart-tooltip";
import {
  assignSeriesSlots,
  boxesOverlap,
  chartDateFormat,
  detectGranularity,
  estimateTextWidth,
  maxOf,
  pickTickIndices,
  segmentHitsBox,
  seriesColor,
  type Box,
} from "./scales";
import { useChartWidth } from "./use-chart-width";

export type TimeSeriesPoint = {
  t: Date;
  v: number;
  /** The bucket is still open (today, this month): drawn dashed and hollow, read "so far". Last point only. */
  partial?: boolean;
};
export type TimeSeries = { key: string; label: string; points: TimeSeriesPoint[] };

export type TimeSeriesChartProps = {
  /** One to eight series on ONE axis (never dual-axis). Colour follows `key`. */
  series: TimeSeries[];
  /** `area` adds a 10% wash under each line; use it for a single series. */
  kind: "line" | "area";
  /** Full value for tooltips and accessible names, e.g. `v => formatKgTotal(v) + " kg"`. */
  format(v: number): string;
  /** Whole chart height in px, x-axis band included. Default 240. */
  height?: number;
  /** Accessible name of the plot. Defaults to the series labels. */
  label?: string;
  /** Stable colour domain (every key this screen can show) so filtering never repaints. */
  colorDomain?: string[];
  /** Labels for the whole set of y ticks (one unit per axis). Default compact en-IN ("0.5L", "1L"). */
  formatTicks?(ticks: number[]): string[];
  /** Long date for tooltips and names; short date for ticks. Default: IST, en-IN, by bucket size. */
  formatDate?: { long(d: Date): string; short(d: Date): string };
};

const TOP = 22;
const BOTTOM = 26;
const RIGHT = 8;
const LABEL_FONT = 13;
/** Text baselines tried for an end label, relative to its dot, nearest first. */
const LABEL_OFFSETS = [-10, 20, -26, 36, -42, 52];

/**
 * Line or area chart over time. Thin 2px lines, an 8px end dot per series,
 * direct end labels nudged clear of every line (dropped if no spot is
 * clear), hairline grid, one y axis from zero with one unit. A partial last
 * bucket is a dashed final segment with a hollow end dot, and reads "so far".
 * A crosshair snaps to the nearest date anywhere on the plot; the plot is
 * one tab stop starting on the newest date (see `useRovingMarks`). Each
 * date's accessible name reads every series, so the tooltip is never the
 * only way to a value.
 */
export function TimeSeriesChart({
  series,
  kind,
  format,
  height = 240,
  label,
  colorDomain,
  formatTicks,
  formatDate,
}: TimeSeriesChartProps) {
  const { locale, t } = useT();
  const [ref, width] = useChartWidth<HTMLDivElement>();

  const times = useMemo(
    () => [...new Set(series.flatMap((s) => s.points.map((p) => p.t.getTime())))].sort((a, b) => a - b),
    [series],
  );
  const dates = useMemo(
    () => formatDate ?? chartDateFormat(detectGranularity(times), locale),
    [formatDate, times, locale],
  );
  const slots = useMemo(
    () =>
      assignSeriesSlots(
        series.map((s) => s.key),
        colorDomain,
      ),
    [series, colorDomain],
  );
  const lookup = useMemo(() => series.map((s) => new Map(s.points.map((p) => [p.t.getTime(), p]))), [series]);
  const roving = useRovingMarks(times.length, "chart-point");

  const peak = maxOf(series.flatMap((s) => s.points.map((p) => p.v)));
  const plotH = Math.max(40, height - TOP - BOTTOM);
  const { y, ticks, labels, left } = useYAxis(peak, plotH, formatTicks);
  const plotW = Math.max(40, width - left - RIGHT);
  const x = scaleLinear()
    .domain(times.length > 1 ? [times[0]!, times[times.length - 1]!] : [(times[0] ?? 0) - 1, (times[0] ?? 0) + 1])
    .range([0, plotW]);
  const xs = times.map((time) => x(time));

  const isPartial = (i: number) => lookup.some((m) => m.get(times[i]!)?.partial);
  const dateLabel = (i: number) => {
    const text = dates.long(new Date(times[i]!));
    return isPartial(i) ? t("charts.soFarLabel", { label: text }) : text;
  };
  const valueText = (si: number, i: number) => {
    const p = lookup[si]!.get(times[i]!);
    return p === undefined ? t("charts.noValue") : format(p.v);
  };
  const nameAt = (i: number) =>
    `${dateLabel(i)}: ${series.map((s, si) => `${s.label} ${valueText(si, i)}`).join(", ")}`;

  const lineGen = d3line<TimeSeriesPoint>()
    .defined((p) => Number.isFinite(p.v))
    .x((p) => x(p.t.getTime()))
    .y((p) => y(p.v))
    .curve(curveMonotoneX);
  const areaGen = d3area<TimeSeriesPoint>()
    .defined((p) => Number.isFinite(p.v))
    .x((p) => x(p.t.getTime()))
    .y0(plotH)
    .y1((p) => y(p.v))
    .curve(curveMonotoneX);
  /** Complete points draw solid; a partial last point hangs off a dashed segment. */
  const split = (points: TimeSeriesPoint[]) => {
    const last = points[points.length - 1];
    if (last?.partial && points.length >= 2) return { solid: points.slice(0, -1), partial: points.slice(-2) };
    return { solid: points, partial: null };
  };

  // Every line as straight segments between its points; the padding covers
  // the stroke and the small bow of the monotone curve.
  const segments = series.flatMap((s) =>
    s.points.slice(1).map((p, i) => {
      const a = s.points[i]!;
      return [x(a.t.getTime()), y(a.v), x(p.t.getTime()), y(p.v)] as const;
    }),
  );
  const hitsLine = (box: Box) => segments.some(([x0, y0, x1, y1]) => segmentHitsBox(x0, y0, x1, y1, box, 3));

  // Direct end labels (<= 4 series, plot >= 360px): right-aligned left of the
  // end dot, at the nearest baseline whose box clears every line, the dots
  // and the other labels. If any label has no clear spot, none are drawn.
  const placedLabels = (() => {
    if (series.length > 4 || plotW < 360) return null;
    const ends = series
      .map((s) => {
        const last = s.points[s.points.length - 1];
        return last ? { key: s.key, label: s.label, x: x(last.t.getTime()), y: y(last.v) } : null;
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
    const dots: Box[] = ends.map((e) => ({ left: e.x - 6, right: e.x + 6, top: e.y - 6, bottom: e.y + 6 }));
    const placed: { key: string; label: string; x: number; y: number; box: Box }[] = [];
    for (const e of [...ends].sort((a, b) => a.y - b.y)) {
      const w = estimateTextWidth(e.label, LABEL_FONT) + 4;
      const spot = LABEL_OFFSETS.map((off) => e.y + off)
        .map((base) => ({ base, box: { left: e.x - 8 - w, right: e.x - 8, top: base - 12, bottom: base + 3 } }))
        .find(
          ({ box }) =>
            box.top >= -TOP + 2 &&
            box.bottom <= plotH - 2 &&
            !hitsLine(box) &&
            ![...dots, ...placed.map((p) => p.box)].some((b) => boxesOverlap(box, b)),
        );
      if (!spot) return null;
      placed.push({ key: e.key, label: e.label, x: e.x - 8, y: spot.base, box: spot.box });
    }
    const order = Object.fromEntries(series.map((s, i) => [s.key, i]));
    return placed.sort((a, b) => order[a.key]! - order[b.key]!);
  })();

  const tickIdx = pickTickIndices(
    times.length,
    plotW,
    Math.max(...times.map((time) => estimateTextWidth(dates.short(new Date(time)), TICK_FONT)), 24) + 16,
  );

  const show = roving.show;

  return (
    <div
      ref={ref}
      data-chart-kit=""
      className="relative w-full rounded-input has-[[data-slot=chart-point]:focus-visible]:outline-2 has-[[data-slot=chart-point]:focus-visible]:outline-offset-4 has-[[data-slot=chart-point]:focus-visible]:outline-ring"
      style={{ height }}
      onPointerLeave={roving.onPointerLeave}
    >
      {width > 0 && times.length > 0 ? (
        <svg
          data-slot="chart-plot"
          role="group"
          aria-label={label ?? series.map((s) => s.label).join(", ")}
          width={width}
          height={height}
          className="block overflow-visible"
        >
          <g transform={`translate(${left},${TOP})`}>
            <YAxis ticks={ticks} labels={labels} y={y} plotW={plotW} />
            <XTicks
              items={tickIdx.map((i) => ({ key: times[i]!, x: xs[i]!, text: dates.short(new Date(times[i]!)) }))}
              plotH={plotH}
              minX={-left}
              maxX={plotW + RIGHT}
            />

            <g aria-hidden="true" className="orrn-chart-in">
              {series.map((s) => {
                const color = seriesColor(slots[s.key]!);
                const { solid, partial } = split(s.points);
                return (
                  <g key={s.key} data-series={s.key}>
                    {kind === "area" ? (
                      <path d={areaGen(s.points) ?? undefined} fill={color} fillOpacity={0.1} stroke="none" />
                    ) : null}
                    <path
                      data-slot="chart-line"
                      d={lineGen(solid) ?? undefined}
                      fill="none"
                      stroke={color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                    {partial ? (
                      <path
                        data-slot="chart-partial-segment"
                        d={`M${x(partial[0]!.t.getTime())},${y(partial[0]!.v)}L${x(partial[1]!.t.getTime())},${y(partial[1]!.v)}`}
                        fill="none"
                        stroke={color}
                        strokeWidth={2}
                        strokeDasharray="4 3"
                        strokeLinecap="round"
                      />
                    ) : null}
                  </g>
                );
              })}
              {series.map((s) => {
                const last = s.points[s.points.length - 1];
                if (!last) return null;
                const color = seriesColor(slots[s.key]!);
                return (
                  <circle
                    key={s.key}
                    data-slot="chart-end-dot"
                    data-partial={last.partial ? "" : undefined}
                    cx={x(last.t.getTime())}
                    cy={y(last.v)}
                    r={4}
                    fill={last.partial ? "var(--card)" : color}
                    stroke={last.partial ? color : "var(--card)"}
                    strokeWidth={2}
                  />
                );
              })}
              {placedLabels?.map((e) => (
                <text
                  key={e.key}
                  data-slot="chart-end-label"
                  x={e.x}
                  y={e.y}
                  textAnchor="end"
                  stroke="var(--card)"
                  strokeWidth={4}
                  strokeLinejoin="round"
                  paintOrder="stroke"
                  className="fill-foreground text-[13px] font-medium"
                >
                  {e.label}
                </text>
              ))}
            </g>

            {show !== null ? (
              <g aria-hidden="true">
                <line
                  data-slot="chart-crosshair"
                  x1={xs[show]}
                  x2={xs[show]}
                  y1={0}
                  y2={plotH}
                  stroke="var(--control)"
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                {series.map((s, si) => {
                  const p = lookup[si]!.get(times[show]!);
                  if (p === undefined) return null;
                  const color = seriesColor(slots[s.key]!);
                  return (
                    <circle
                      key={s.key}
                      cx={xs[show]}
                      cy={y(p.v)}
                      r={4}
                      fill={p.partial ? "var(--card)" : color}
                      stroke={p.partial ? color : "var(--card)"}
                      strokeWidth={2}
                    />
                  );
                })}
              </g>
            ) : null}

            {/* Hit layer: one column per date, the full chart height, bigger than any mark. */}
            <g>
              {times.map((time, i) => {
                const x0 = i === 0 ? -left : (xs[i - 1]! + xs[i]!) / 2;
                const x1 = i === times.length - 1 ? plotW + RIGHT : (xs[i]! + xs[i + 1]!) / 2;
                return (
                  <rect
                    key={time}
                    {...roving.markProps(i)}
                    role="img"
                    aria-label={nameAt(i)}
                    x={x0}
                    y={-TOP}
                    width={Math.max(1, x1 - x0)}
                    height={height}
                    fill="transparent"
                    className="outline-none"
                  />
                );
              })}
            </g>
          </g>
        </svg>
      ) : null}

      {show !== null && width > 0 ? (
        <ChartTooltip
          x={left + xs[show]!}
          boxWidth={width}
          boxHeight={height}
          minLeft={left}
          avoid={(placedLabels ?? []).map((p) => ({
            left: left + p.box.left,
            right: left + p.box.right,
            top: TOP + p.box.top,
            bottom: TOP + p.box.bottom,
          }))}
          title={dateLabel(show)}
          rows={series.map((s, si) => ({
            key: s.key,
            label: s.label,
            value: valueText(si, show),
            color: seriesColor(slots[s.key]!),
          }))}
        />
      ) : null}
    </div>
  );
}
