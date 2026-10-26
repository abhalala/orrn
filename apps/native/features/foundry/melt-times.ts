/**
 * The five times on the foundry sheet (preheat start, charging start, charging end, casting start,
 * casting end), typed as a melt date plus clock times in the plant's zone (`settings.timezone`). A
 * melt that runs past midnight is typed as the clock shows it: a time earlier than the one before
 * it belongs to the next day. A draft may leave times blank; only the filled ones become instants.
 * Pure: the server still checks the order (`times_out_of_order`) and the 72 hour span.
 */
import { MELT_TIME_KEYS, type MeltTimeKey } from "@orrn/domain";

export { MELT_TIME_KEYS };
export type { MeltTimeKey };
export type MeltTimes = Record<MeltTimeKey, string>;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const DAY_MS = 86_400_000;

type Parts = { y: number; m: number; d: number; h: number; min: number };

function wallParts(at: number, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute") };
}

/** Offset of `timeZone` from UTC at instant `at`, in ms (IST = +5.5 h). */
function zoneOffset(at: number, timeZone: string): number {
  const p = wallParts(at, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min) - Math.floor(at / 60_000) * 60_000;
}

/** Epoch ms of a wall-clock `YYYY-MM-DD` + `HH:MM` in `timeZone`, or null for text that is neither. */
export function zonedEpoch(date: string, time: string, timeZone: string): number | null {
  const dm = DATE_RE.exec(date.trim());
  const tm = TIME_RE.exec(time.trim());
  if (!dm || !tm) return null;
  const [y, m, d, h, min] = [Number(dm[1]), Number(dm[2]), Number(dm[3]), Number(tm[1]), Number(tm[2])];
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59) return null;
  const naive = Date.UTC(y, m - 1, d, h, min);
  const check = new Date(naive);
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  // Two passes so an offset that changes between the naive guess and the answer (DST) still lands.
  let epoch = naive - zoneOffset(naive, timeZone);
  epoch = naive - zoneOffset(epoch, timeZone);
  return epoch;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The plant's calendar day at `at` (default now), as `YYYY-MM-DD`. */
export function todayIn(timeZone: string, at: number = Date.now()): string {
  const p = wallParts(at, timeZone);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** The plant's wall clock at `at` (default now), as `HH:MM`. */
export function nowTimeIn(timeZone: string, at: number = Date.now()): string {
  const p = wallParts(at, timeZone);
  return `${pad(p.h)}:${pad(p.min)}`;
}

/** `YYYY-MM-DD` + n days (calendar arithmetic, no zone involved). */
export function addDays(date: string, days: number): string {
  const dm = DATE_RE.exec(date);
  if (!dm) return date;
  const d = new Date(Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3])) + days * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function minutes(time: string): number | null {
  const tm = TIME_RE.exec(time.trim());
  if (!tm) return null;
  const h = Number(tm[1]);
  const m = Number(tm[2]);
  return h <= 23 && m <= 59 ? h * 60 + m : null;
}

export type ResolvedMeltTimes = {
  /** Epoch ms per time; null for a blank or invalid time (or while the date is not a date). */
  epochs: Record<MeltTimeKey, number | null>;
  /** Times left blank, in sheet order. */
  missing: MeltTimeKey[];
  /** Times that are written but are not a clock time (`7:70`). */
  invalid: MeltTimeKey[];
  /** Days after the melt date each time falls on (0 = the melt date). */
  dayOffset: Record<MeltTimeKey, number>;
  /** The time is on a later day than the one written before it. */
  nextDay: Record<MeltTimeKey, boolean>;
};

/**
 * Turns the melt date and the clock times into instants. Each written time earlier than the
 * previous written one moves to the next day; equal times stay on the same day.
 */
export function resolveMeltTimes(date: string, times: MeltTimes, timeZone: string): ResolvedMeltTimes {
  const missing: MeltTimeKey[] = [];
  const invalid: MeltTimeKey[] = [];
  const dayOffset = {} as Record<MeltTimeKey, number>;
  const nextDay = {} as Record<MeltTimeKey, boolean>;
  const epochs = {} as Record<MeltTimeKey, number | null>;
  let day = 0;
  let prev: number | null = null;
  const dateOk = DATE_RE.test(date.trim());
  for (const key of MELT_TIME_KEYS) {
    const text = (times[key] ?? "").trim();
    const m = minutes(text);
    dayOffset[key] = day;
    nextDay[key] = false;
    epochs[key] = null;
    if (text === "") {
      missing.push(key);
      continue;
    }
    if (m === null) {
      invalid.push(key);
      continue;
    }
    if (prev !== null && m < prev) {
      day += 1;
      nextDay[key] = true;
    }
    dayOffset[key] = day;
    prev = m;
    if (dateOk) epochs[key] = zonedEpoch(addDays(date.trim(), day), text, timeZone);
  }
  return { epochs, missing, invalid, dayOffset, nextDay };
}

/** Splits a saved instant back into the form's melt date and clock text (plant zone). */
export function splitInstant(ms: number, timeZone: string): { date: string; time: string } {
  return { date: todayIn(timeZone, ms), time: nowTimeIn(timeZone, ms) };
}
