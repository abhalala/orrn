/**
 * `@orrn/ui/charts`: the in-house chart kit (analytics addendum A2/A3).
 * SVG + d3-scale/d3-shape/d3-array, C2 tokens, the dataviz skill's rules.
 * Import it only from lazily loaded screens: it must never reach the entry
 * chunk (scripts/check-modulepreload.ts fails the build if it does).
 * Every chart must sit in a ChartCard: the table view is the fallback for
 * the low-contrast categorical slots. See README.md.
 */
export { ChartCard, type ChartCardProps, type ChartLegend } from "./chart-card";
export {
  ChartTable,
  barTable,
  formatShare,
  movementText,
  rankedTable,
  timeSeriesTable,
  type ChartTableColumn,
  type ChartTableData,
  type ChartTableProps,
  type ChartTableRow,
} from "./chart-table";
export { TimeSeriesChart, type TimeSeries, type TimeSeriesChartProps, type TimeSeriesPoint } from "./time-series-chart";
export { BarChart, type BarChartProps, type BarDatum } from "./bar-chart";
export { RankedBars, type RankedBarsProps, type RankedRow } from "./ranked-bars";
export { Sparkline, type SparklineProps } from "./sparkline";
export {
  CHART_MAX_SERIES,
  OTHER_COLOR,
  assignSeriesSlots,
  chartDateFormat,
  detectGranularity,
  foldToOther,
  ordinalColor,
  seriesColor,
  seriesLegend,
  type ChartDateFormat,
  type DateGranularity,
} from "./scales";
