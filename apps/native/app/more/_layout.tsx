import { useT } from "@orrn/i18n";
import { Stack } from "expo-router";

import { useStackOptions } from "@/lib/screen-options";

/**
 * More, opened from the avatar in any tab header: Dies, Customers, Guides,
 * Settings (Task 29 adds those screens to this stack), language, sign out.
 */
export default function MoreLayout() {
  const { t } = useT();
  const options = useStackOptions();
  return (
    <Stack screenOptions={options}>
      <Stack.Screen name="index" options={{ title: t("nav.more"), headerLargeTitle: true }} />
    </Stack>
  );
}
