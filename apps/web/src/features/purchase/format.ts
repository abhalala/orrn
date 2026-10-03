/** Number and date text for purchase screens: kg from grams, % from basis points, book dates. */
import type { Locale } from "@orrn/i18n";

const KG = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const PCT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** Grams as kg the way the kanta slip reads: "12,450", "12,450.5". */
export function kgText(g: number): string {
  return KG.format(g / 1000);
}

/** Basis points as "0.5%". */
export function pctText(bp: number): string {
  return `${PCT.format(bp / 100)}%`;
}

const DATE_FORMATS = new Map<Locale, Intl.DateTimeFormat>();

function dateFormat(locale: Locale): Intl.DateTimeFormat {
  let f = DATE_FORMATS.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
      numberingSystem: "latn",
    });
    DATE_FORMATS.set(locale, f);
  }
  return f;
}

/** A `YYYY-MM-DD` book date as "3 Oct 2026" (read in UTC so no time zone can move it a day). */
export function bookDateText(date: string, locale: Locale): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return dateFormat(locale).format(new Date(`${date}T12:00:00Z`));
}

/** An instant as a date in the plant's time zone. */
export function instantDateText(at: Date | string | number, locale: Locale, timeZone = "Asia/Kolkata"): string {
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    numberingSystem: "latn",
  };
  const tag = locale === "hi" ? "hi-IN" : "en-IN";
  try {
    return new Intl.DateTimeFormat(tag, { ...options, timeZone }).format(new Date(at));
  } catch {
    // A bad zone in settings must not break the screen.
    return new Intl.DateTimeFormat(tag, { ...options, timeZone: "Asia/Kolkata" }).format(new Date(at));
  }
}
