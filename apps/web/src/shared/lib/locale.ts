import { DEFAULT_LOCALE, isLocale, type Locale } from "@orrn/i18n";

/** Per-device language choice (index.html reads the same key to set `<html lang>` before paint). */
export const LOCALE_STORAGE_KEY = "orrn.locale";

export function readStoredLocale(): Locale {
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Saves the choice and keeps `<html lang>` in step (screen readers, Devanagari font fallback). */
export function storeLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Private mode or blocked storage: the choice still applies to this visit.
  }
  document.documentElement.lang = locale;
}
