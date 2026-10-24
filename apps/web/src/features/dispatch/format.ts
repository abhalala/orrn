/** Day formatting for dispatch screens (spec §2: `d MMM`, plus the year when it isn't this year). */

type DayOptions = { now?: Date; timeZone?: string; locale?: string };

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function yearIn(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", { year: "numeric", timeZone }).format(d);
}

/**
 * "4 Oct", or "30 Dec 2025" outside the current year, as a calendar day in
 * `timeZone` (default Asia/Kolkata). Hindi gets Hindi month names with Latin
 * digits (numbers stay Latin, spec §2).
 */
export function formatDay(value: Date | string | number | null | undefined, opts: DayOptions = {}): string | null {
  const d = toDate(value);
  if (!d) return null;
  const timeZone = opts.timeZone ?? "Asia/Kolkata";
  const now = opts.now ?? new Date();
  const sameYear = yearIn(d, timeZone) === yearIn(now, timeZone);
  return new Intl.DateTimeFormat(opts.locale === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone,
    numberingSystem: "latn",
  }).format(d);
}

/**
 * A ship date is a calendar day. It is stored as UTC midnight of that day
 * (what `<input type="date">` gives), and shown in UTC so it never moves a day.
 */
export function parseDayInput(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : ms;
}

export function isoDayInput(value: Date | string | number): string {
  const d = toDate(value);
  return d ? d.toISOString().slice(0, 10) : "";
}

/** A ship date for display ("4 Oct"). */
export function formatShipDate(value: Date | string | number | null | undefined, opts: Omit<DayOptions, "timeZone"> = {}) {
  return formatDay(value, { ...opts, timeZone: "UTC" });
}
