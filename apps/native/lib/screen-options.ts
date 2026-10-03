import { useThemeColor } from "./theme";

/** Font families registered in lib/fonts.ts. */
const DISPLAY = "BricolageGrotesque_700Bold";
const DISPLAY_LARGE = "BricolageGrotesque_800ExtraBold";

/**
 * Themed options for every Stack: canvas background, ink text, Bricolage
 * titles, no header hairline. `largeTitle` gives tab roots the iOS large
 * title (screens must scroll with `contentInsetAdjustmentBehavior="automatic"`).
 */
export function useStackOptions({ largeTitle = false }: { largeTitle?: boolean } = {}) {
  const canvas = useThemeColor("background");
  const ink = useThemeColor("foreground");

  return {
    headerStyle: { backgroundColor: canvas },
    headerTintColor: ink,
    headerShadowVisible: false,
    headerTitleStyle: { fontFamily: DISPLAY, fontSize: 18, color: ink },
    headerLargeTitle: largeTitle,
    headerLargeTitleShadowVisible: false,
    headerLargeTitleStyle: { fontFamily: DISPLAY_LARGE, color: ink },
    headerBackButtonDisplayMode: "minimal" as const,
    contentStyle: { backgroundColor: canvas },
  };
}
