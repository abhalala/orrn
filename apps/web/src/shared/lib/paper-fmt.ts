import { formatterFor, ORRN_DEFAULT_PREFS, type Fmt } from "@orrn/domain";

/**
 * The formatter for a text that mirrors a paper (the packing list) or has no plant to ask (a model function called
 * without one): today's date style and 24 hour clock, whatever the plant chose. Screens use `usePaperFmt()`.
 */
export function paperFormatter(locale: string | undefined | null, timeZone = "Asia/Kolkata"): Fmt {
  return formatterFor(ORRN_DEFAULT_PREFS, { locale: locale === "hi" || locale === "gu" ? locale : "en", timeZone });
}
