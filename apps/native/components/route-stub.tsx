import { useT, type MessageKey } from "@orrn/i18n";
import { Stack } from "expo-router";
import { ScrollView, Text, View } from "react-native";

/**
 * Placeholder for a tab screen whose task hasn't landed yet (mirrors web's
 * `RouteStub`). The route is final; Task 29 replaces each use with the real
 * screen. The stack header shows the title, so it is not repeated here.
 */
export function RouteStub({ titleKey }: { titleKey: MessageKey }) {
  const { t } = useT();
  return (
    <>
      <Stack.Screen options={{ title: t(titleKey) }} />
      <ScrollView className="flex-1 bg-canvas" contentInsetAdjustmentBehavior="automatic" contentContainerClassName="px-4 py-6">
        <View className="w-full max-w-[1100px] gap-2 self-center rounded-card border border-hairline bg-surface p-5">
          <Text className="font-sans-semibold text-base text-ink">{t("ui.stubTitle")}</Text>
          <Text className="font-sans text-[15px] leading-6 text-ink-muted">{t("ui.stubBody")}</Text>
        </View>
      </ScrollView>
    </>
  );
}
