/**
 * Reference copy of the stock "when" helper as it was before the plant formatter (units layer, slice b part 3).
 * No screen imports it; the parity tests compare the plant formatter under default preferences against it.
 */
import type { Locale } from "@orrn/i18n";

function tag(locale: Locale | string): string {
  // Latin digits in both languages: numbers stay Latin script (spec §2 Language).
  return locale === "hi" ? "hi-IN-u-nu-latn" : "en-IN";
}

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
 * `3 Oct, 14:20`, or `31 Dec 2025, 11:30` outside the current year, in the
 * company timezone (spec §2: dates `d MMM` + year if not current, 24h).
 * An unknown zone falls back to the device's.
 */
export function formatWhen(
  at: string | number | Date,
  opts: { locale: Locale | string; timeZone?: string; now?: number },
): string {
  const timeZone = validZone(opts.timeZone);
  const date = new Date(at);
  const yearOf = (d: Date) => new Intl.DateTimeFormat("en", { year: "numeric", timeZone }).format(d);
  const sameYear = yearOf(date) === yearOf(new Date(opts.now ?? Date.now()));
  const day = new Intl.DateTimeFormat(tag(opts.locale), {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone,
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(
    date,
  );
  return `${day}, ${time}`;
}

