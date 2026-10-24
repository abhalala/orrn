import { DEFAULT_LOCALE, hasMessages, isLocale, loadMessages, type Locale } from "@orrn/i18n";

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

/**
 * The dictionaries a page needs before it renders. On web they are fetched on demand
 * (@orrn/i18n dictionaries.web.ts) and the entry carries only the English the public `/` page
 * shows, so `/` in English waits for nothing and every other page waits for its language's full
 * dictionary (Hindi is complete by the parity test, so a Hindi page does not also wait for English).
 */
export function localesToLoad(pathname: string, locale: Locale, loaded: (locale: Locale) => boolean = hasMessages): Locale[] {
  if (locale === DEFAULT_LOCALE && pathname === "/") return [];
  return loaded(locale) ? [] : [locale];
}

/**
 * Root route beforeLoad: awaits the saved language's dictionary, so the first render is already in
 * that language and an app page never shows a raw key. A no-op once loaded. On `/` in English the
 * provider fetches the full English after the page is up, so "Sign in" opens without a wait. A
 * failed fetch (offline, a stale deploy) is not fatal: the page renders with what is loaded and the
 * next navigation tries again.
 */
export async function ensureLocale(pathname: string): Promise<void> {
  const needed = localesToLoad(pathname, readStoredLocale());
  await Promise.all(needed.map((locale) => loadMessages(locale))).catch(() => {});
}
