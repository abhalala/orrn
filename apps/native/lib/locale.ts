import { DEFAULT_LOCALE, isLocale, type Locale } from "@orrn/i18n";

/** Same key as web's localStorage entry; SecureStore keys allow only `[\w.-]`. */
export const LOCALE_STORAGE_KEY = "orrn.locale";

/**
 * The language to open in: a saved choice first, then the first device
 * language we support (a Hindi phone opens in Hindi), then English.
 */
export function pickLocale(stored: unknown, deviceLanguages: readonly (string | null | undefined)[]): Locale {
  if (isLocale(stored)) return stored;
  for (const code of deviceLanguages) {
    const base = code?.toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}
