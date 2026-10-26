import { useColorScheme } from "nativewind";

import { themeColor, type ThemeKey } from "./theme-colors";

/**
 * Raw hex for the current colour scheme, for the places where a Tailwind class
 * cannot reach: navigation header tints, icon `color` props, RefreshControl.
 *
 * Nothing is declared here. Every value is read from `@orrn/ui/tokens` (see
 * `theme-colors.ts`), the same source `tailwind.config.js` uses to generate
 * the NativeWind classes.
 */
export function useThemeColor(key: ThemeKey): string {
  const { colorScheme } = useColorScheme();
  return themeColor(colorScheme === "dark" ? "dark" : "light", key);
}
