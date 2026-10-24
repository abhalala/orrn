/**
 * The saved colour choice (Settings): match the device, always light, always
 * dark. Pure, so bun tests can load it; lib/theme-store.ts reads and writes it.
 */
export const THEME_PREFS = ["system", "light", "dark"] as const;
export type ThemePref = (typeof THEME_PREFS)[number];
export const DEFAULT_THEME_PREF: ThemePref = "system";

/** SecureStore keys allow only `[\w.-]`; same family as `orrn.locale`. */
export const THEME_STORAGE_KEY = "orrn.theme";

export function isThemePref(value: unknown): value is ThemePref {
  return typeof value === "string" && (THEME_PREFS as readonly string[]).includes(value);
}

/** A saved choice, else follow the device. */
export function pickThemePref(stored: unknown): ThemePref {
  return isThemePref(stored) ? stored : DEFAULT_THEME_PREF;
}
