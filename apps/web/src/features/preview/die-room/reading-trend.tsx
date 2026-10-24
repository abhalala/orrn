import { Sparkline } from "@orrn/ui/charts";

/** Loaded on the die card only, so the chart kit stays out of the entry chunk. */
export function ReadingTrend({ points }: { points: number[] }) {
  if (points.length === 0) return null;
  return (
    <Sparkline
      points={points}
      label="Drift readings, kg per 12 ft"
      unit="kg per 12 ft"
      format={(value) => value.toFixed(3)}
      height={64}
    />
  );
}
