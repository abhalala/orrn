import { useT } from "@orrn/i18n";
import { inkPanel } from "@orrn/ui/tokens";
import { Text, View } from "react-native";

/**
 * The orrn four-cube mark (same geometry as `apps/web/public/favicon.svg` and
 * the app icon) built from token tone classes, plus the wordmark.
 */
export function BrandMark({ size = 40 }: { size?: number }) {
  const { t } = useT();
  const unit = size / 32;
  const cube = { width: 8 * unit, height: 8 * unit, borderRadius: 2.5 * unit };
  const gap = 2 * unit;

  return (
    <View
      className="flex-row items-center gap-3"
      accessible
      accessibilityRole="image"
      accessibilityLabel={t("common.appName")}
    >
      <View
        className="items-center justify-center"
        // The tile stays ink in both themes, like the app icon; the hairline keeps its shape on the dark canvas.
        style={{
          width: size,
          height: size,
          borderRadius: 9 * unit,
          padding: 7 * unit,
          gap,
          backgroundColor: inkPanel.bg,
          borderWidth: 1,
          borderColor: inkPanel.border,
        }}
      >
        <View className="flex-row" style={{ gap }}>
          <View className="bg-tone-red" style={cube} />
          <View className="bg-tone-amber" style={cube} />
        </View>
        <View className="flex-row" style={{ gap }}>
          <View className="bg-tone-blue" style={cube} />
          <View className="bg-tone-green" style={cube} />
        </View>
      </View>
      <Text className="font-display-extrabold text-[28px] tracking-tight text-ink" maxFontSizeMultiplier={1.3}>
        {t("common.appName")}
      </Text>
    </View>
  );
}
