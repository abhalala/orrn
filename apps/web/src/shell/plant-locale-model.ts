import { plantDefaultLocale } from "@orrn/domain";
import { DEFAULT_LOCALE, type Locale } from "@orrn/i18n";

/**
 * The language a signed-in device should open in when it has never chosen one: the plant's
 * (`company.settings.locale`; for a Gujarat plant Gujarati once the PF §9-14 switch in
 * `@orrn/domain` is on). Null = leave the device as it is: it chose, or the plant's is English.
 */
export function plantLocaleFor(stored: Locale | null, settings: Record<string, unknown> | null | undefined): Locale | null {
  if (stored !== null) return null;
  const plant = plantDefaultLocale(settings);
  return plant === DEFAULT_LOCALE ? null : plant;
}
