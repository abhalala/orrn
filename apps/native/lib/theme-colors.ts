import { c2, dangerText, tones } from "@orrn/ui/tokens";

/**
 * Pure colour lookup behind `useThemeColor` (kept free of `nativewind` so
 * tests can import it). Every value is read from `@orrn/ui/tokens`.
 */
export type ThemeKey =
  | "background"
  | "foreground"
  | "card"
  | "muted-foreground"
  | "border"
  | "primary"
  | "destructive"
  | "success"
  | "link";

export type ThemeMode = "light" | "dark";

/** Pure lookup, shared by the hook and tests. */
export function themeColor(mode: ThemeMode, key: ThemeKey): string {
  const s = c2[mode];
  switch (key) {
    case "background":
      return s.canvas;
    case "foreground":
    case "primary":
      return s.ink;
    case "card":
      return s.surface;
    case "muted-foreground":
      return s.inkMuted;
    case "border":
      return s.hairline;
    case "destructive":
      return dangerText[mode];
    case "success":
      return tones.green[mode].ink;
    case "link":
      return tones.blue[mode].ink;
  }
}
