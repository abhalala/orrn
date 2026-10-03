import { formatCompactIN } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { area as d3area, curveMonotoneX, line as d3line } from "d3-shape";
import { scaleLinear } from "d3-scale";
import { useMemo, useState, type KeyboardEvent } from "react";

import { ChartTooltip } from "./chart-tooltip";
import {
  assignSeriesSlots,
  chartDateFormat,
  detectGranularity,
  estimateTextWidth,
  maxOf,
  pickTickIndices,
  seriesColor,
  valueScale,
} from "./scales";
import { useChartWidth } from "./use-chart-width";

export type TimeSeriesPoint = { t: Date; v: number };
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
  /** Axis tick text. Default compact en-IN ("12k", "1.2L"). */
  formatTick?(v: number): string;
  /** Long date for tooltips and names; short date for ticks. Default: IST, en-IN, by bucket size. */
  formatDate?: { long(d: Date): string; short(d: Date): string };
};

const TOP = 22;
const BOTTOM = 26;
const RIGHT = 8;
const TICK_FONT = 12;

/**
 * Line or area chart over time. Thin 2px lines, an 8px end dot per series,
 * direct end labels when they don't collide, hairline grid, one y axis from
 * zero. A crosshair snaps to the nearest date under the pointer anywhere on
 * the plot; the plot is one tab stop and the arrow keys walk the dates
 * (Home/End jump, Escape hides the tooltip). Each date's accessible name
 * reads every series, so the tooltip is never the only way to a value.
 */
export function TimeSeriesChart({
  series,
  kind,
  format,
  height = 240,
  label,
  colorDomain,
  formatTick = formatCompactIN,
  formatDate,
}: TimeSeriesChartProps) {
  const { locale, t } = useT();
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const [active, setActive] = useState<{ index: number; via: "pointer" | "focus" } | null>(null);
  const [hidden, setHidden] = useState(false);

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
  const lookup = useMemo(() => series.map((s) => new Map(s.points.map((p) => [p.t.getTime(), p.v]))), [series]);
  const [rovingIndex, setRovingIndex] = useState<number | null>(null);
  const focusIndex = Math.min(rovingIndex ?? times.length - 1, times.length - 1);

  const peak = maxOf(series.flatMap((s) => s.points.map((p) => p.v)));
  const plotH = Math.max(40, height - TOP - BOTTOM);
  const { scale: y, ticks } = valueScale(peak, plotH);
  const left = Math.max(...ticks.map((v) => estimateTextWidth(formatTick(v), TICK_FONT, true))) + 10;
  const plotW = Math.max(40, width - left - RIGHT);
  const x = scaleLinear()
    .domain(times.length > 1 ? [times[0]!, times[times.length - 1]!] : [(times[0] ?? 0) - 1, (times[0] ?? 0) + 1])
    .range([0, plotW]);
  const xs = times.map((t) => x(t));

  const nameAt = (i: number) => {
    const time = times[i]!;
    const parts = series.map((s, si) => {
      const v = lookup[si]!.get(time);
      return `${s.label} ${v === undefined ? t("charts.noValue") : format(v)}`;
    });
    return `${dates.long(new Date(time))}: ${parts.join(", ")}`;
  };

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

  // Direct end labels (<= 4 series): the higher end above its dot, the others
  // below theirs; dropped entirely when any two would collide or the line
  // ends converge (never nudged away from their lines).
  const ends = series
    .map((s) => {
      const last = s.points[s.points.length - 1];
      return last ? { key: s.key, label: s.label, x: x(last.t.getTime()), y: y(last.v) } : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.y - b.y)
    .map((e, i) => ({ ...e, ly: i === 0 ? Math.max(e.y - 10, -TOP + 14) : Math.min(e.y + 20, plotH - 4) }));
  const order = Object.fromEntries(series.map((s, i) => [s.key, i]));
  const endLabelsFit =
    series.length <= 4 &&
    // A phone-width plot is too dense for labels on the lines; the legend above carries them.
    plotW >= 360 &&
    // Converging ends: the labels would sit on the other line, so the legend carries them.
    ends.every((e, i) => i === 0 || (e.ly - ends[i - 1]!.ly >= 16 && e.y - ends[i - 1]!.y >= 24)) &&
    ends.every((e) => estimateTextWidth(e.label, 13) + 12 < plotW / 2);

  const tickIdx = pickTickIndices(
    times.length,
    plotW,
    Math.max(...times.map((t) => estimateTextWidth(dates.short(new Date(t)), TICK_FONT)), 24) + 16,
  );

  const show = active && !hidden ? active.index : null;
  const move = (to: number, el: Element | null) => {
    const i = Math.max(0, Math.min(times.length - 1, to));
    setRovingIndex(i);
    const svg = el?.closest("svg");
    (svg?.querySelectorAll<SVGRectElement>("[data-slot='chart-point']")[i])?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<SVGRectElement>, i: number) => {
    const keys: Record<string, number> = {
      ArrowRight: i + 1,
      ArrowUp: i + 1,
      ArrowLeft: i - 1,
      ArrowDown: i - 1,
      Home: 0,
      End: times.length - 1,
      PageUp: i + 7,
      PageDown: i - 7,
    };
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
      className="relative w-full rounded-input has-[[data-slot=chart-point]:focus-visible]:outline-2 has-[[data-slot=chart-point]:focus-visible]:outline-offset-4 has-[[data-slot=chart-point]:focus-visible]:outline-ring"
      style={{ height }}
      onPointerLeave={() => setActive((a) => (a?.via === "pointer" ? null : a))}
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
            <g aria-hidden="true">
              {ticks.map((v) => (
                <g key={v} transform={`translate(0,${y(v)})`}>
                  <line
                    x2={plotW}
                    stroke={v === 0 ? "var(--chart-axis)" : "var(--chart-grid)"}
                    strokeWidth={1}
                    shapeRendering="crispEdges"
                  />
                  <text
                    x={-10}
                    dy="0.32em"
                    textAnchor="end"
                    className="fill-muted-foreground font-mono text-[12px] tabular-nums"
                  >
                    {formatTick(v)}
                  </text>
                </g>
              ))}
              {tickIdx.map((i) => {
                const text = dates.short(new Date(times[i]!));
                const w = estimateTextWidth(text, TICK_FONT);
                const cx = xs[i]!;
                const anchor = cx - w / 2 < -left ? "start" : cx + w / 2 > plotW + RIGHT ? "end" : "middle";
                return (
                  <text
                    key={i}
                    data-slot="chart-x-tick"
                    x={anchor === "start" ? Math.max(cx, -left) : cx}
                    y={plotH + 18}
                    textAnchor={anchor}
                    className="fill-muted-foreground text-[12px]"
                  >
                    {text}
                  </text>
                );
              })}
            </g>

            <g aria-hidden="true" className="orrn-chart-in">
              {series.map((s) => {
                const color = seriesColor(slots[s.key]!);
                return (
                  <g key={s.key} data-series={s.key}>
                    {kind === "area" ? (
                      <path d={areaGen(s.points) ?? undefined} fill={color} fillOpacity={0.1} stroke="none" />
                    ) : null}
                    <path
                      d={lineGen(s.points) ?? undefined}
                      fill="none"
                      stroke={color}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  </g>
                );
              })}
              {series.map((s) => {
                const last = s.points[s.points.length - 1];
                if (!last) return null;
                return (
                  <circle
                    key={s.key}
                    cx={x(last.t.getTime())}
                    cy={y(last.v)}
                    r={4}
                    fill={seriesColor(slots[s.key]!)}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                );
              })}
              {endLabelsFit
                ? [...ends].sort((a, b) => order[a.key]! - order[b.key]!).map((e) => (
                    <text
                      key={e.key}
                      data-slot="chart-end-label"
                      x={e.x - 8}
                      y={e.ly}
                      textAnchor="end"
                      stroke="var(--card)"
                      strokeWidth={4}
                      strokeLinejoin="round"
                      paintOrder="stroke"
                      className="fill-foreground text-[13px] font-medium"
                    >
                      {e.label}
                    </text>
                  ))
                : null}
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
                  const v = lookup[si]!.get(times[show]!);
                  if (v === undefined) return null;
                  return (
                    <circle
                      key={s.key}
                      cx={xs[show]}
                      cy={y(v)}
                      r={4}
                      fill={seriesColor(slots[s.key]!)}
                      stroke="var(--card)"
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
                    data-slot="chart-point"
                    role="img"
                    aria-label={nameAt(i)}
                    tabIndex={i === focusIndex ? 0 : -1}
                    x={x0}
                    y={-TOP}
                    width={Math.max(1, x1 - x0)}
                    height={height}
                    fill="transparent"
                    className="outline-none"
                    onPointerEnter={() => {
                      setHidden(false);
                      setActive({ index: i, via: "pointer" });
                    }}
                    onFocus={() => {
                      setHidden(false);
                      setRovingIndex(i);
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
          x={left + xs[show]!}
          y={4}
          boxWidth={width}
          title={dates.long(new Date(times[show]!))}
          rows={series.map((s, si) => {
            const v = lookup[si]!.get(times[show]!);
            return {
              key: s.key,
              label: s.label,
              value: v === undefined ? t("charts.noValue") : format(v),
              color: seriesColor(slots[s.key]!),
            };
          })}
        />
      ) : null}
    </div>
  );
}
