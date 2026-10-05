// Per-family import: the package index would bundle every icon font (~5 MB).
import Feather from "@expo/vector-icons/Feather";
import { useT } from "@orrn/i18n";
import { useRouter } from "expo-router";
import { Platform } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { useThemeColor } from "@/lib/theme";

/**
 * A visible Back for the first screen of a nested Stack (More, and any stack
 * T29 nests inside it). iOS draws its own chevron only when the screen has a
 * previous screen in the same native stack, so without this the only way out
 * was an edge swipe, which Switch Control and Voice Control users cannot do
 * (WCAG 2.5.1). Use as `headerLeft: () => <HeaderBack />`;
 * __tests__/routes.test.ts requires it on every nested Stack outside the tabs.
 */
export function HeaderBack() {
  const { t } = useT();
  const router = useRouter();
  const ink = useThemeColor("foreground");

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t("common.back")}
      hitSlop={4}
      // Opened from a cold-start link there is still "/" underneath (unstable_settings), so back() always has somewhere to go; the fallback is the gate.
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      className="h-11 w-11 items-center justify-center rounded-full"
    >
      <Feather name={Platform.OS === "ios" ? "chevron-left" : "arrow-left"} size={Platform.OS === "ios" ? 28 : 24} color={ink} />
    </PressableScale>
  );
}
