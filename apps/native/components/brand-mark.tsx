import { useT } from "@orrn/i18n";
import { tones } from "@orrn/ui/tokens";
import { Text, View } from "react-native";
import Svg, { ClipPath, Defs, Path, Rect } from "react-native-svg";

const STOPS: readonly [number, string][] = [
  [0, tones.red.from],
  [0.25, tones.amber.from],
  [0.5, tones.green.from],
  [0.75, tones.blue.from],
  [1, tones.red.from],
];

function mix(from: string, to: string, t: number) {
  const channels = [1, 3, 5].map((index) => {
    const start = Number.parseInt(from.slice(index, index + 2), 16);
    const end = Number.parseInt(to.slice(index, index + 2), 16);
    return Math.round(start + (end - start) * t)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function colorAt(t: number) {
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [start, from] = STOPS[i]!;
    const [end, to] = STOPS[i + 1]!;
    if (t <= end) return mix(from.slice(1), to.slice(1), end === start ? 0 : (t - start) / (end - start));
  }
  return STOPS[0]![1];
}

/** Same gradient tile as the web sign-in wordmark (`.orrn-mark`). */
function MarkTile({ size }: { size: number }) {
  const wedges = 24;
  const center = size / 2;
  const radius = size * 0.75;
  const paths = Array.from({ length: wedges }, (_, index) => {
    const start = ((200 + (index * 360) / wedges) * Math.PI) / 180;
    const end = ((200 + ((index + 1) * 360) / wedges) * Math.PI) / 180;
    const x0 = center + radius * Math.sin(start);
    const y0 = center - radius * Math.cos(start);
    const x1 = center + radius * Math.sin(end);
    const y1 = center - radius * Math.cos(end);
    return {
      d: `M${center} ${center} L${x0} ${y0} A${radius} ${radius} 0 0 1 ${x1} ${y1} Z`,
      fill: colorAt(index / wedges),
    };
  });

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Defs>
        <ClipPath id="orrn-mark-tile">
          <Rect width={size} height={size} rx={size * 0.3} />
        </ClipPath>
      </Defs>
      {paths.map((path) => (
        <Path key={path.d} d={path.d} fill={path.fill} clipPath="url(#orrn-mark-tile)" />
      ))}
    </Svg>
  );
}

/**
 * The sign-in gradient tile plus the wordmark. Used on every native front door.
 */
export function BrandMark({ size = 40 }: { size?: number }) {
  const { t } = useT();

  return (
    <View
      className="flex-row items-center gap-3"
      accessible
      accessibilityRole="image"
      accessibilityLabel={t("common.appName")}
    >
      <MarkTile size={size} />
      <Text className="font-display-extrabold text-[28px] tracking-tight text-ink" maxFontSizeMultiplier={1.3}>
        {t("common.appName")}
      </Text>
    </View>
  );
}
