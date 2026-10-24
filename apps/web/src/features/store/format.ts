import type { Locale } from "@orrn/i18n";

/** Plant default when the company has no timezone set (AGENTS.md: settings.timezone, IST default). */
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

function validZone(timeZone: string | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

/**
 * `3 Oct, 22:12`, or `31 Mar 2025, 09:42` outside the current year, in the company timezone
 * (C2 spec section 2: dates d MMM + year if not current, times 24h). Same shape as T21's
 * features/stock/format.ts formatWhen; mergers keep one. Latin digits in Hindi. An unknown zone
 * falls back to the device's.
 */
export function formatWhen(
  at: string | number | Date,
  opts: { locale: Locale | string; timeZone?: string; now?: number },
): string {
  const timeZone = validZone(opts.timeZone);
  const date = new Date(at);
  const yearOf = (d: Date) => new Intl.DateTimeFormat("en", { year: "numeric", timeZone }).format(d);
  const sameYear = yearOf(date) === yearOf(new Date(opts.now ?? Date.now()));
  const day = new Intl.DateTimeFormat(opts.locale === "hi" ? "hi-IN-u-nu-latn" : "en-IN", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone,
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(date);
  return `${day}, ${time}`;
}
