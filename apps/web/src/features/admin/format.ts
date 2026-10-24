import type { Locale } from "@orrn/i18n";

/** What the API sends for a timestamp: a Date (superjson), an ISO string or epoch ms. */
export type DateInput = Date | string | number;

export function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Intl locale: Indian English, or Hindi with Latin digits (serials and numbers stay Latin, spec §2). */
function intlLocale(locale: Locale): string {
  return locale === "hi" ? "hi-IN-u-nu-latn" : "en-IN";
}

/** "3 Oct" this year, "28 Dec 2025" otherwise (spec §2: d MMM, year if not current). Device time zone. */
export function formatDay(value: DateInput, opts: { now?: Date; locale: Locale }): string {
  const date = toDate(value);
  const now = opts.now ?? new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(intlLocale(opts.locale), {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  })
    .format(date)
    .replace(",", "");
}

/** "14:32": 24 hour clock, always two-digit. */
export function formatTime(value: DateInput, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(toDate(value));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "5 minutes ago", "yesterday", "3 days ago"; older than 30 days falls back to `formatDay`. */
export function formatAgo(value: DateInput, opts: { now?: Date; locale: Locale }): string {
  const date = toDate(value);
  const now = opts.now ?? new Date();
  const diff = date.getTime() - now.getTime();
  const abs = Math.abs(diff);
  if (abs >= 30 * DAY) return formatDay(date, { now, locale: opts.locale });
  const rtf = new Intl.RelativeTimeFormat(intlLocale(opts.locale), { numeric: "auto" });
  if (abs < MINUTE) return rtf.format(0, "second");
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), "hour");
  return rtf.format(Math.round(diff / DAY), "day");
}
