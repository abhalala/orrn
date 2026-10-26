/**
 * Plain formatting for the phone's clock and the plant's serials. Pure (no
 * React Native imports) so bun tests run it. Month names come from i18n
 * (`native.monthsShort`), digits stay Latin in Hindi, as on the plant's paper.
 */

/** The 12 short month names from the comma-separated i18n string. */
export function monthNames(csv: string): string[] {
  return csv.split(",").map((m) => m.trim());
}

type DateLike = Date | number | string | null | undefined;

/** The zone the server falls back to (`DEFAULT_TIMEZONE` in packages/server/src/lib/dayWindow.ts). */
export const FALLBACK_ZONE = "Asia/Kolkata";

/** A calendar day with no time ("2026-10-24"): the server's order and ship dates. It names a day, never an instant. */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The company's IANA zone from `me.company.settings` (key `timezone`). Missing, empty or not a zone this
 * runtime knows reads as IST, exactly as the server's `companyTimezone` does (so a bad setting shows the
 * same day on the phone and on the web, never the phone's own clock).
 */
export function zoneOf(settings: { [key: string]: unknown } | null | undefined): string {
  const tz = settings?.timezone;
  return typeof tz === "string" && tz.length > 0 && zoneFormatter(tz) !== null ? tz : FALLBACK_ZONE;
}

function toDate(value: DateLike): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && DATE_ONLY.test(value)) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

const zoneFormatters = new Map<string, Intl.DateTimeFormat | null>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat | null {
  if (zoneFormatters.has(timeZone)) return zoneFormatters.get(timeZone) ?? null;
  let fmt: Intl.DateTimeFormat | null = null;
  try {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    fmt = null;
  }
  zoneFormatters.set(timeZone, fmt);
  return fmt;
}

/**
 * The wall clock of an instant. With a zone it is the company's wall clock, the same on every phone;
 * without one (or when the runtime cannot do that zone) it is the phone's own clock.
 */
export function wallClock(d: Date, timeZone?: string): WallClock {
  const fmt = timeZone ? zoneFormatter(timeZone) : null;
  if (fmt) {
    const get: Record<string, number> = {};
    for (const p of fmt.formatToParts(d)) if (p.type !== "literal") get[p.type] = Number(p.value);
    if (get.year !== undefined && get.month !== undefined && get.day !== undefined) {
      return { year: get.year, month: get.month, day: get.day, hour: (get.hour ?? 0) % 24, minute: get.minute ?? 0 };
    }
  }
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(), hour: d.getHours(), minute: d.getMinutes() };
}

/** "YYYY-MM-DD" of an instant on the company's calendar. */
export function dayKeyIn(timeZone: string | undefined, at: Date = new Date()): string {
  const w = wallClock(at, timeZone);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** The hour (0 to 23) on the company's clock, for the greeting. */
export function hourIn(timeZone: string | undefined, at: Date = new Date()): number {
  return wallClock(at, timeZone).hour;
}

/**
 * "4 Oct" this year, "30 Dec 2025" otherwise; null for no date. On the company's calendar when a zone is
 * given (otherwise the phone's). A date-only text ("2026-10-24") is a calendar day and prints as that
 * day on every phone, whatever its zone.
 */
export function formatDay(value: DateLike, months: readonly string[], now: Date = new Date(), timeZone?: string): string | null {
  let y: number;
  let m: number;
  let d: number;
  if (typeof value === "string" && DATE_ONLY.test(value)) {
    const hit = DATE_ONLY.exec(value)!;
    y = Number(hit[1]);
    m = Number(hit[2]);
    d = Number(hit[3]);
  } else {
    const date = toDate(value);
    if (!date) return null;
    const w = wallClock(date, timeZone);
    y = w.year;
    m = w.month;
    d = w.day;
  }
  const base = `${d} ${months[m - 1] ?? ""}`;
  return y === wallClock(now, timeZone).year ? base : `${base} ${y}`;
}

/** 24 hour "07:05" on the company's clock when a zone is given (otherwise the phone's); null for no time. */
export function formatTime(value: DateLike, timeZone?: string): string | null {
  const d = toDate(value);
  if (!d) return null;
  const w = wallClock(d, timeZone);
  return `${String(w.hour).padStart(2, "0")}:${String(w.minute).padStart(2, "0")}`;
}

/** Natural order: digit runs compare as numbers, so "2207" < "14701" and "26J2" < "26J10". Case-insensitive. */
export function naturalCompare(a: string, b: string): number {
  const ax = a.toLowerCase().match(/\d+|\D+/g) ?? [];
  const bx = b.toLowerCase().match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(ax.length, bx.length); i++) {
    const x = ax[i]!;
    const y = bx[i]!;
    if (x === y) continue;
    const xn = /^\d/.test(x);
    const yn = /^\d/.test(y);
    if (xn && yn) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff;
      // Same value, different zero padding: shorter first.
      if (x.length !== y.length) return x.length - y.length;
      continue;
    }
    return x < y ? -1 : 1;
  }
  return ax.length - bx.length;
}

/** `Array.sort` comparator for plant serials (packing order, not text order). */
export const bySerial = naturalCompare;
