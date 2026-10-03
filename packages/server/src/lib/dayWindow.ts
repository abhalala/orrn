export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export type Ymd = { year: number; month: number; day: number };

function formatterFor(timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
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
