/**
 * Dates on the customer screens (spec §2: `d MMM`, plus the year when it isn't the current one,
 * on the company's calendar). Calendar dates (`YYYY-MM-DD` from the analytics API) are formatted
 * as they are; instants are first placed on the company's calendar.
 */
import { todayIn } from "./period";

function tag(locale: string): string {
  return locale === "hi" ? "hi-IN" : "en-IN";
}

function format(at: Date, locale: string, timeZone: string, withYear: boolean): string {
  return new Intl.DateTimeFormat(tag(locale), {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone,
    numberingSystem: "latn",
  }).format(at);
}

/** "1 Apr" this year, "1 Sep 2025" otherwise. `today` is the company's `YYYY-MM-DD`. */
export function formatDay(ymd: string, locale: string, today: string): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return format(new Date(Date.UTC(y, m - 1, d)), locale, "UTC", ymd.slice(0, 4) !== today.slice(0, 4));
}

/** The company-calendar day of an instant, formatted like `formatDay`. */
export function formatInstantDay(at: string | number | Date, locale: string, timeZone: string, today: string): string {
  const instant = at instanceof Date ? at : new Date(at);
  return formatDay(todayIn(timeZone, instant), locale, today);
}
