import * as SecureStore from "expo-secure-store";

import { pickThemePref, THEME_STORAGE_KEY, type ThemePref } from "./theme-pref";

/**
 * Per-device colour choice, kept in SecureStore like the language. Read
 * synchronously at start-up (app/_layout.tsx) so the first frame is already in
 * the right scheme; a broken keychain falls back to the device setting.
 */
export function readThemePref(): ThemePref {
  try {
    return pickThemePref(SecureStore.getItem(THEME_STORAGE_KEY));
  } catch {
    return pickThemePref(null);
  }
}

export function storeThemePref(pref: ThemePref): void {
  // The choice still applies to this run if saving fails.
  SecureStore.setItemAsync(THEME_STORAGE_KEY, pref).catch(() => {});
}
