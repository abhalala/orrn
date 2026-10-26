import { useT } from "@orrn/i18n";
import { cn } from "@orrn/ui/lib/utils";

import { sparkline, x10Text, type SparkReading } from "./model";

/**
 * The temperature log as one line against the recipe's band (the shaded strip). A text summary is
 * the accessible name; the numbers are in the readings table, never only in the picture.
 */
export function TempSpark({
  readings,
  band,
  height = 56,
  className,
}: {
  readings: readonly SparkReading[];
  band: { lowX10: number; highX10: number } | null;
  height?: number;
  className?: string;
}) {
  const { t } = useT();
  const width = 240;
  const spark = sparkline(readings, { width, height }, band);
  if (!spark) {
    return (
      <p className={cn("m-0 text-[13px] text-muted-foreground", className)} data-testid="spark-empty">
        {t("ageing.readings.empty")}
      </p>
    );
  }
  const label = t("ageing.spark.label", { count: readings.length, min: x10Text(spark.minX10), max: x10Text(spark.maxX10) });
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className={cn("block w-full", className)} style={{ height }} data-testid="temp-spark">
      {spark.band ? <rect x={0} y={spark.band.y} width={width} height={spark.band.height} className="fill-tone-green-tint" /> : null}
      <polyline points={spark.points} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="stroke-foreground" />
      {spark.last ? <circle cx={spark.last.x} cy={spark.last.y} r={3.5} className="fill-tone-amber" /> : null}
    </svg>
  );
}
