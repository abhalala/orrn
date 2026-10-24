import { productionDayStartMin, readFloorSettings, resolveShift } from "@orrn/domain";

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export type Ymd = { year: number; month: number; day: number };

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatters.set(timeZone, fmt);
  return fmt;
}

/** Wall-clock parts of `ms` in `timeZone`, read back as if they were UTC. */
function wallClockAsUtc(fmt: Intl.DateTimeFormat, ms: number): { utc: number; ymd: Ymd } {
  const get: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(ms))) {
    if (p.type !== "literal") get[p.type] = Number(p.value);
  }
  const ymd = { year: get.year!, month: get.month!, day: get.day! };
  const utc = Date.UTC(ymd.year, ymd.month - 1, ymd.day, get.hour!, get.minute!, get.second!);
  return { utc, ymd };
}

/** UTC offset of `timeZone` at `ms`, in milliseconds (positive east of UTC). */
function offsetMs(fmt: Intl.DateTimeFormat, ms: number): number {
  return wallClockAsUtc(fmt, ms).utc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant at which the wall clock in the zone reads `ymd 00:00:00`. */
function localMidnightUtc(fmt: Intl.DateTimeFormat, ymd: Ymd): number {
  const guess = Date.UTC(ymd.year, ymd.month - 1, ymd.day);
  let start = guess - offsetMs(fmt, guess);
  // Re-evaluate once at the candidate so a DST change between guess and start settles.
  start = guess - offsetMs(fmt, start);
  return start;
}

/** UTC offset of `timezone` at the instant `ms`, in milliseconds (positive east of UTC; IST = +19 800 000). */
export function zonedOffsetMs(timezone: string, ms: number): number {
  return offsetMs(formatterFor(timezone), ms);
}

/** UTC instant at which the wall clock in `timezone` reads `ymd` 00:00:00 (day may overflow the month). */
export function zonedMidnightMs(timezone: string, ymd: Ymd): number {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day));
  return localMidnightUtc(formatterFor(timezone), {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  });
}

/** Company timezone from `company.settings` (IANA name), else IST. */
export function companyTimezone(settings: Record<string, unknown> | null | undefined): string {
  const tz = settings?.timezone;
  return typeof tz === "string" && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
}

/** Calendar date (year, month 1-12, day) of the instant `ms` on the wall clock of `timezone`. */
export function zonedYmd(timezone: string = DEFAULT_TIMEZONE, ms: number = Date.now()): Ymd {
  return wallClockAsUtc(formatterFor(timezone), ms).ymd;
}

/** UTC instant at which the calendar month containing `now` starts on the wall clock of `timezone`. */
export function monthStartMs(timezone: string = DEFAULT_TIMEZONE, now: number = Date.now()): number {
  const fmt = formatterFor(timezone);
  const { ymd } = wallClockAsUtc(fmt, now);
  return localMidnightUtc(fmt, { year: ymd.year, month: ymd.month, day: 1 });
}

/**
 * The [startMs, endMs) UTC window of the calendar day containing `now` in
 * `timezone` (local midnight to next local midnight).
 */
export function dayWindow(
  timezone: string = DEFAULT_TIMEZONE,
  now: number = Date.now(),
): { startMs: number; endMs: number } {
  const fmt = formatterFor(timezone);
  const { ymd } = wallClockAsUtc(fmt, now);
  const next = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + 1));
  return {
    startMs: localMidnightUtc(fmt, ymd),
    endMs: localMidnightUtc(fmt, {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
    }),
  };
}

/**
 * IANA zone check. `Intl.supportedValuesOf` lists canonical ids only (V8 says
 * "Asia/Calcutta", not "Asia/Kolkata"), so also accept any "Area/City" name the
 * runtime can actually format with.
 */
export function isValidTimezone(timezone: string): boolean {
  if ((Intl.supportedValuesOf("timeZone") as string[]).includes(timezone) || timezone === "UTC") return true;
  if (!/^[A-Za-z]+(?:\/[A-Za-z0-9_+-]+)+$/.test(timezone)) return false;
  try {
    formatterFor(timezone);
    return true;
  } catch {
    return false;
  }
}

/** UTC instant at which the wall clock in `timezone` reads `ymd` + `minuteOfDay` (day may overflow). */
export function zonedWallMs(timezone: string, ymd: Ymd, minuteOfDay: number): number {
  const fmt = formatterFor(timezone);
  const guess = Date.UTC(ymd.year, ymd.month - 1, ymd.day, 0, minuteOfDay);
  let at = guess - offsetMs(fmt, guess);
  // Re-evaluate at the candidate so a DST change between guess and answer settles.
  at = guess - offsetMs(fmt, at);
  return at;
}

export type ProductionDayWindow = {
  /** [startMs, endMs): shift 1's start to the next shift 1 start; local midnight with no shifts. */
  startMs: number;
  endMs: number;
  /** `YYYY-MM-DD`; before shift 1 starts it is the previous calendar day (C15). */
  productionDay: string;
  timezone: string;
  /** False = no shifts saved: the window is the calendar day (Today caption says "since midnight"). */
  shiftsSet: boolean;
  /** Shift 1's start, minutes from local midnight (0 with no shifts). */
  startMin: number;
  /** The shift the instant falls in, or null with no shifts. */
  shift: { id: string; name: string; seq: number } | null;
};

/**
 * The production day containing `nowMs` for a company's settings (FP-PF-05; platform spec §4
 * Shifts helper). Used by Today, pack's packed-today and the press daily summary. A changed shift
 * 1 start moves the window from the next read on; nothing already counted is rewritten.
 * `monthStartMs`, FY rollover and bundle month letters stay on calendar midnight.
 */
export function productionDayWindow(
  settings: Record<string, unknown> | null | undefined,
  nowMs: number = Date.now(),
): ProductionDayWindow {
  const timezone = companyTimezone(settings);
  const { shifts } = readFloorSettings(settings);
  const { utc, ymd } = wallClockAsUtc(formatterFor(timezone), nowMs);
  const minuteOfDay = Math.floor((utc - Date.UTC(ymd.year, ymd.month - 1, ymd.day)) / 60_000);
  const resolved = resolveShift(shifts, { ...ymd, minuteOfDay });
  const [year, month, day] = resolved.productionDay.split("-").map(Number) as [number, number, number];
  const startMin = productionDayStartMin(shifts);
  const startMs = zonedWallMs(timezone, { year, month, day }, startMin);
  const endMs = zonedWallMs(timezone, { year, month, day: day + 1 }, startMin);
  return {
    startMs,
    endMs,
    productionDay: resolved.productionDay,
    timezone,
    shiftsSet: shifts.length > 0,
    startMin,
    shift:
      resolved.shiftId && resolved.shiftName && resolved.shiftSeq
        ? { id: resolved.shiftId, name: resolved.shiftName, seq: resolved.shiftSeq }
        : null,
  };
}
