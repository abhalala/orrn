import type { Locale } from "@orrn/i18n";
import { getLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";

import { LOCALE_STORAGE_KEY, pickLocale } from "./locale";

/**
 * Per-device language (spec §2: "locale persisted per device"). Read
 * synchronously at start-up so the first frame is already in the right
 * language; a broken keychain falls back to the device language.
 */
export function readInitialLocale(): Locale {
  let stored: string | null = null;
  try {
    stored = SecureStore.getItem(LOCALE_STORAGE_KEY);
  } catch {
    stored = null;
  }
  let device: (string | null)[] = [];
  try {
    device = getLocales().map((l) => l.languageCode);
  } catch {
    device = [];
  }
  return pickLocale(stored, device);
}

export function storeLocale(locale: Locale): void {
  // The choice still applies to this run if saving fails.
  SecureStore.setItemAsync(LOCALE_STORAGE_KEY, locale).catch(() => {});
}
