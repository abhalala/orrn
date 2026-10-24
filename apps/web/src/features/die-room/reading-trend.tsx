import { Sparkline } from "@orrn/ui/charts";

/** Loaded on the die card only, so the chart kit stays out of the entry chunk. */
export function ReadingTrend({ points, label }: { points: number[]; label: string }) {
  if (points.length === 0) return null;
  return <Sparkline points={points} label={label} unit="kg/12ft" format={(value) => value.toFixed(3)} height={64} />;
}
