import { formatKg } from "@orrn/domain";
import { paperFormatter } from "@/shared/lib/paper-fmt";
import { yearInZone } from "@/shared/lib/plant-calendar";

/** Day formatting for dispatch screens (spec §2: `d MMM`, plus the year when it isn't this year). */

type DayOptions = { now?: Date; timeZone?: string; locale?: string };

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * "4 Oct", or "30 Dec 2025" outside the current year, as a calendar day in
 * `timeZone` (default Asia/Kolkata). Hindi and Gujarati get their own month names with Latin
 * digits (numbers stay Latin, spec §2).
 *
 * This is the paper's date style (today's: day, month name, 24 hour clock, whatever the plant chose): the packing
 * list views call it, and a paper keeps its own style until it has its own setting. Screens use `shipDayText`.
 */
export function formatDay(value: Date | string | number | null | undefined, opts: DayOptions = {}): string | null {
  const d = toDate(value);
  if (!d) return null;
  const timeZone = opts.timeZone ?? "Asia/Kolkata";
  const now = opts.now ?? new Date();
  const sameYear = yearInZone(d.getTime(), timeZone) === yearInZone(now.getTime(), timeZone);
  return paperFormatter(opts.locale, timeZone).date(d.getTime(), { year: !sameYear });
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

/**
 * A dispatch's kg, everywhere a dispatch total is shown (list, detail header, action bar, hold and
 * complete sheets): kg to the 10 g, the packing list's own precision, so 809.764 kg reads 809.76 on
 * the list, the hero and the embedded packing list alike (BACKLOG 80).
 */
export function dispatchKgText(weightG: number): string {
  return formatKg(weightG / 1000, 2);
}

/**
 * A ship day from the server's `shipDay.ymd` ("2026-10-27", already the company's calendar day):
 * "27 Oct". Read as a plain calendar day, so no timezone can move it.
 */
export function formatYmdDay(ymd: string | null | undefined, opts: Omit<DayOptions, "timeZone"> = {}): string | null {
  if (!ymd) return null;
  const ms = parseDayInput(ymd);
  return ms === null ? null : formatDay(ms, { ...opts, timeZone: "UTC" });
}
