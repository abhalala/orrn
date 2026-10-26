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

const DAY_FORMATS = new Map<Locale, Intl.DateTimeFormat>();

/**
 * A book date for lists: "4 Oct" inside the plant's current year (from `today`, the company's
 * book date), "30 Dec 2025" otherwise.
 */
export function bookDayText(date: string, locale: Locale, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  if (date.slice(0, 4) !== today.slice(0, 4)) return bookDateText(date, locale);
  let f = DAY_FORMATS.get(locale);
  if (!f) {
    f = new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
      numberingSystem: "latn",
    });
    DAY_FORMATS.set(locale, f);
  }
  return f.format(new Date(`${date}T12:00:00Z`));
}

const YEAR_FORMATS = new Map<string, Intl.DateTimeFormat>();

function yearIn(at: Date, timeZone: string): string {
  let f = YEAR_FORMATS.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-IN", { year: "numeric", timeZone });
    YEAR_FORMATS.set(timeZone, f);
  }
  return f.format(at);
}

/**
 * An instant on the plant's wall clock (C2 dates): "3 Oct at 14:00", 24-hour, with the year only
 * outside the plant's current year ("30 Dec 2025 at 22:12"). `now` is for tests.
 */
export function instantDateText(at: Date | string | number, locale: Locale, timeZone = "Asia/Kolkata", now: number = Date.now()): string {
  const tag = locale === "hi" ? "hi-IN" : "en-IN";
  const when = new Date(at);
  const format = (zone: string) => {
    const options: Intl.DateTimeFormatOptions = {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      numberingSystem: "latn",
      timeZone: zone,
    };
    if (yearIn(when, zone) !== yearIn(new Date(now), zone)) options.year = "numeric";
    // Explicit parts, not Intl's own pattern: the "at" / comma between date and time and the English
    // "Sept" spelling differ between ICU builds (Linux vs macOS).
    const parts = new Intl.DateTimeFormat(tag, options).formatToParts(when);
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
    const month = locale === "hi" ? part("month") : part("month").replace(/^Sept$/, "Sep");
    const date = [part("day"), month, options.year ? part("year") : ""].filter(Boolean).join(" ");
    return `${date}${locale === "hi" ? ", " : " at "}${part("hour")}:${part("minute")}`;
  };
  try {
    return format(timeZone);
  } catch {
    // A bad zone in settings must not break the screen.
    return format("Asia/Kolkata");
  }
}

/** Item names like "PATTA/ROTTER/HEATSINK": a zero-width space after each slash, so narrow cells wrap at a slash. */
export function slashBreaks(text: string): string {
  return text.replaceAll("/", "/​");
}
