/**
 * Dates on the customer screens (spec §2: `d MMM`, plus the year when it isn't the current one,
 * on the company's calendar). Calendar dates (`YYYY-MM-DD` from the analytics API) are formatted
 * as they are; instants are first placed on the company's calendar.
 */
import { intlTag } from "@/shared/lib/intl-tag";

import { todayIn } from "./period";


/**
 * "1 Apr" / "1 Sep 2025", assembled from explicit format parts (day, month, year) joined by a plain
 * space. Intl's own pattern differs between ICU builds ("1 Sept 2025" vs "1 Sep 2025", a comma in
 * some CLDR releases), so the screen never relies on its separators or on the English "Sept" spelling.
 */
function format(at: Date, locale: string, timeZone: string, withYear: boolean): string {
  const parts = new Intl.DateTimeFormat(intlTag(locale), {
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone,
    numberingSystem: "latn",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const month = locale === "hi" || locale === "gu" ? part("month") : part("month").replace(/^Sept$/, "Sep");
  return [part("day"), month, withYear ? part("year") : ""].filter(Boolean).join(" ");
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
