import { Sparkline } from "@orrn/ui/charts";

import { useFmt } from "@/shared/lib/fmt";
import { sectionText, sectionUnit } from "@/shared/lib/fmt-text";

/**
 * Loaded on the die card only, so the chart kit stays out of the entry chunk. The points are canonical (grams per 12 ft), so the
 * trend reads in the same section unit as the list of readings under it.
 */
export function ReadingTrend({ points, label }: { points: number[]; label: string }) {
  const fmt = useFmt();
  if (points.length === 0) return null;
  return <Sparkline points={points} label={label} unit={sectionUnit(fmt)} format={(value) => sectionText(fmt, Math.round(value))} height={64} />;
}
