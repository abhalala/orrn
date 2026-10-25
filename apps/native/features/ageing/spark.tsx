import { useT } from "@orrn/i18n";
import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Polyline, Rect } from "react-native-svg";

import { useThemeColor } from "@/lib/theme";

import { sparkline, x10Text, type SparkReading } from "./model";

/**
 * The temperature log as a line against the recipe's band (drawn from `sparkline` in model.ts, the web's own
 * arithmetic). The line is one picture of the readings; the numbers sit under it on the batch screen, so the
 * picture itself is described in one sentence for a screen reader.
 */
export function TempSpark({ readings, band, height = 72 }: { readings: readonly SparkReading[]; band: { lowX10: number; highX10: number } | null; height?: number }) {
  const { t } = useT();
  const ink = useThemeColor("foreground");
  const good = useThemeColor("success");
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));
  const spark = width > 0 ? sparkline(readings, { width, height }, band) : null;
  const label = readings.length === 0 ? t("ageing.readings.empty") : t("ageing.spark.label", { count: readings.length, min: x10Text(spark?.minX10 ?? Math.min(...readings.map((r) => r.tempCX10))), max: x10Text(spark?.maxX10 ?? Math.max(...readings.map((r) => r.tempCX10))) });
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} onLayout={onLayout} style={{ height }} className="w-full overflow-hidden rounded-input bg-surface-sunken">
      {spark ? (
        <Svg width={width} height={height}>
          {spark.band ? <Rect x={0} y={spark.band.y} width={width} height={spark.band.height} fill={good} opacity={0.18} /> : null}
          <Polyline points={spark.points} fill="none" stroke={ink} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {spark.last ? <Circle cx={spark.last.x} cy={spark.last.y} r={4} fill={ink} /> : null}
        </Svg>
      ) : null}
    </View>
  );
}
