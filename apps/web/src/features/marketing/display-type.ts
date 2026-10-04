import type { Locale } from "@orrn/i18n";

/**
 * Display headings are set tight for Latin text (leading about 1, negative
 * tracking). Devanagari needs room for its marks above and below the line and
 * no negative tracking, so in Hindi they get leading 1.2 and normal tracking.
 * `latin` is the setting the element uses otherwise; leave it empty when a
 * class such as `orrn-display-2` already carries it (utilities override it).
 */
export function displaySetting(locale: Locale, latin = ""): string {
  return locale === "hi" ? "leading-[1.2] tracking-normal" : latin;
}
