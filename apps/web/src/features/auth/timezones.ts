/** Default plant time zone: the day boundary `dashboard.today` uses when none is set (spec section 5). */
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

/** Short list for the company step: India first, then zones Indian exporters' partners commonly use. */
const COMMON = [
  DEFAULT_TIMEZONE,
  "Asia/Dubai",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Asia/Singapore",
  "Europe/London",
  "UTC",
];

export type TimezoneOption = { value: string; label: string; device: boolean };

/** "Asia/Kolkata, GMT+5:30", or null when the browser doesn't know the zone. */
function label(zone: string, now: Date): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(now);
    const offset = parts.find((p) => p.type === "timeZoneName")?.value;
    return offset ? `${zone}, ${offset}` : zone;
  } catch {
    return null;
  }
}

/**
 * Options for the time zone select: the short list, plus this device's zone
 * and the company's saved zone when they aren't on it. Zone ids stay Latin,
 * like codes; the offset makes them readable.
 */
export function timezoneOptions({ now = new Date(), device, saved }: { now?: Date; device?: string; saved?: string } = {}) {
  const zones = [...COMMON];
  for (const extra of [saved, device]) if (extra && !zones.includes(extra)) zones.push(extra);
  const out: TimezoneOption[] = [];
  for (const zone of zones) {
    const text = label(zone, now);
    if (text) out.push({ value: zone, label: text, device: zone === device });
  }
  return out;
}

/** The browser's own zone, if it reports one. */
export function deviceTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
