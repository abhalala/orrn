/** Reference copy of the approvals time text before the plant formatter (units layer, slice b part 3). No screen imports it. */

function zonedParts(at: number, timeZone: string): { day: string; month: string; hour: string; minute: string } {
  const fmt = (tz: string | undefined) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(timeZone);
  } catch {
    parts = fmt(undefined);
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: get("day"), month: get("month"), hour: get("hour"), minute: get("minute") };
}

/**
 * "24 Oct 21:00" in the plant's time zone (not the device's), built from parts so the wording is
 * the same on every ICU.
 */
export function plantTimeText(at: number, timeZone: string): string {
  const p = zonedParts(at, timeZone);
  return `${p.day} ${p.month} ${p.hour}:${p.minute}`;
}

/** "24 Oct 21:00 to 23:00", or both dates when the run crosses midnight. */
export function lateWindowText(startedAt: number, stoppedAt: number, timeZone: string): string {
  const a = zonedParts(startedAt, timeZone);
  const b = zonedParts(stoppedAt, timeZone);
  const sameDay = a.day === b.day && a.month === b.month;
  return `${a.day} ${a.month} ${a.hour}:${a.minute} to ${sameDay ? "" : `${b.day} ${b.month} `}${b.hour}:${b.minute}`;
}

