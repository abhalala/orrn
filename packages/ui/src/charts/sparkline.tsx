import { formatCompactIN } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { curveMonotoneX, line as d3line } from "d3-shape";
import { scaleLinear } from "d3-scale";

import { seriesColor } from "./scales";
import { useChartWidth } from "./use-chart-width";

export type SparklineProps = {
  /** Oldest first; the last point is the current period. */
  points: number[];
  /** What the trend is, e.g. "Dispatched, last 12 months". Read with a summary of the numbers. */
  label: string;
  /** Number text in the summary. Default compact en-IN. */
  format?(v: number): string;
  /** Unit read after every number in the summary, e.g. "kg". */
  unit?: string;
  /** Height in px. Default 36. */
  height?: number;
};

const PAD = 6;

/**
 * Trend line for a stat tile: the de-emphasis grey with the current period
 * as an accent dot (slot 1). No axes and no tooltip: it is one image whose
 * accessible name states first, last, high and low, and the tile's own
 * number carries the value.
 */
export function Sparkline({ points, label, format: formatNumber = formatCompactIN, unit, height = 36 }: SparklineProps) {
  const { t } = useT();
  const format = (v: number) => (unit ? `${formatNumber(v)} ${unit}` : formatNumber(v));
  const [ref, width] = useChartWidth<HTMLDivElement>();
  const summary =
    points.length > 0
      ? t("charts.sparkSummary", {
          label,
          first: format(points[0]!),
          last: format(points[points.length - 1]!),
          max: format(Math.max(...points)),
          min: format(Math.min(...points)),
        })
      : label;

  // The shape is the point of a sparkline: scale to its own low and high.
  const lo = points.length ? Math.min(...points) : 0;
  const hi = points.length ? Math.max(...points) : 1;
  const x = scaleLinear().domain([0, Math.max(1, points.length - 1)]).range([PAD, Math.max(PAD + 1, width - PAD)]);
  const y = scaleLinear().domain(hi > lo ? [lo, hi] : [lo - 1, hi + 1]).range([height - PAD, PAD]);
  const path = d3line<number>()
    .x((_, i) => x(i))
    .y((v) => y(v))
    .curve(curveMonotoneX)(points);
  const last = points[points.length - 1];

  return (
    <div ref={ref} data-chart-kit="" className="w-full" style={{ height }}>
      <svg data-slot="sparkline" role="img" aria-label={summary} width={Math.max(width, 0)} height={height} className="block">
        {width > 0 && path ? (
          <g className="orrn-chart-in">
            <path d={path} fill="none" stroke="var(--chart-other)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {last !== undefined ? (
              <circle
                cx={x(points.length - 1)}
                cy={y(last)}
                r={4}
                fill={seriesColor(0)}
                stroke="var(--card)"
                strokeWidth={2}
              />
            ) : null}
          </g>
        ) : null}
      </svg>
    </div>
  );
}
