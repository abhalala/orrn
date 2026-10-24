import { useT } from "@orrn/i18n";
import { Stack } from "expo-router";

import { HeaderBack } from "@/components/header-back";
import { useStackOptions } from "@/lib/screen-options";

/**
 * More, opened from the avatar in any tab header: Dies, Customers, Guides,
 * Settings, language, sign out.
 * Its first screen gets HeaderBack: as the root of a nested Stack it has no
 * native chevron, and an edge swipe must not be the only way back to the tabs.
 * Screens pushed on top get the native chevron as usual.
 */
export default function MoreLayout() {
  const { t } = useT();
  const options = useStackOptions();
  return (
    <Stack screenOptions={options}>
      <Stack.Screen
        name="index"
        options={{ title: t("nav.more"), headerLargeTitle: true, headerLeft: () => <HeaderBack /> }}
      />
      <Stack.Screen name="dies" options={{ title: t("nav.dies") }} />
      <Stack.Screen name="dies/[id]" options={{ title: t("nav.dies") }} />
      <Stack.Screen name="customers" options={{ title: t("nav.customers") }} />
      <Stack.Screen name="customers/[id]" options={{ title: t("nav.customers") }} />
      <Stack.Screen name="guides" options={{ title: t("nav.guides") }} />
      <Stack.Screen name="guides/[slug]" options={{ title: t("nav.guides") }} />
      <Stack.Screen name="settings" options={{ title: t("nav.settings") }} />
    </Stack>
  );
}
