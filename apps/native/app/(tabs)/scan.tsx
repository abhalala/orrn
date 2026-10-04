import { useT } from "@orrn/i18n";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ScreenTitle } from "@/components/ui/screen-title";

/**
 * Placeholder until Task 29 builds the camera scanner (expo-camera, QR +
 * Code128, torch, manual entry). Scan has no stack header, so the title is here.
 */
export default function ScanScreen() {
  const { t } = useT();
  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={["top", "left", "right"]}>
      <ScrollView contentContainerClassName="gap-4 px-4 py-6">
        <ScreenTitle>{t("nav.scan")}</ScreenTitle>
        <View className="w-full max-w-[1100px] gap-2 self-center rounded-card border border-hairline bg-surface p-5">
          <Text className="font-sans-semibold text-base text-ink">{t("ui.stubTitle")}</Text>
          <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("ui.stubBody")}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
