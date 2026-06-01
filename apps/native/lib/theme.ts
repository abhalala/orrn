import { useColorScheme } from "nativewind";

/**
 * Drop-in replacement for `heroui-native`'s `useThemeColor()`. Returns the raw
 * hex for the current scheme so callers can pass real color values to RN APIs
 * that don't accept Tailwind classes (e.g. navigation header tints, icon
 * `color` props, `placeholderTextColor`).
 *
 * Color values mirror the HSL variables defined in `apps/native/global.css`
 * and the hex tokens in `packages/ui/src/tokens.ts` — keep them in sync.
 */

type ThemeKey =
  | "background"
  | "foreground"
  | "card"
  | "muted"
  | "muted-foreground"
  | "border"
  | "primary"
  | "destructive"
  | "success"
  | "danger"
  | "link";

const LIGHT_COLORS: Record<ThemeKey, string> = {
  background: "#f6f8fb",
  foreground: "#111827",
  card: "#ffffff",
  muted: "#5d6b7c",
  "muted-foreground": "#5d6b7c",
  border: "#d9e1ea",
  primary: "#4f7cff",
  destructive: "#ef4444",
  success: "#10b981",
  danger: "#ef4444",
  link: "#4f7cff",
};

const DARK_COLORS: Record<ThemeKey, string> = {
  background: "#070a11",
  foreground: "#f4f7fb",
  card: "#101722",
  muted: "#a7b2c2",
  "muted-foreground": "#a7b2c2",
  border: "#263142",
  primary: "#4f7cff",
  destructive: "#ef4444",
  success: "#10b981",
  danger: "#ef4444",
  link: "#4f7cff",
};

export function useThemeColor(key: ThemeKey): string {
  const { colorScheme } = useColorScheme();
  const palette = colorScheme === "dark" ? DARK_COLORS : LIGHT_COLORS;
  return palette[key];
}
