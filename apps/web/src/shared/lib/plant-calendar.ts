/**
 * The plant's calendar and wall clock as numbers, for logic and for input values (units layer, slice b part 3).
 *
 * Nothing here is shown to a person. A date or a time on a screen goes through the plant's `Fmt` (`useFmt()`:
 * `date`, `time`, `day`), which follows the plant's date order and clock. These functions answer "which calendar
 * day is it in this zone", "what is the zone's offset", "what wall clock does this instant read" for the
 * production day, the day filters, the `datetime-local` boxes and the Today greeting, none of which may change
 * with a display setting. `plant-calendar` is the only web module (besides the platform staff screens and the zone
 * picker) the date guard (`date-format-guard.test.ts`) lets use `Intl.DateTimeFormat`.
 *
 * Zones that `Intl` does not know throw, as they always did here; each caller keeps its own fallback.
 */

const zoneChecked = new Map<string, boolean>();

/** True when `Intl` knows the zone. Cached, so it is cheap to call on every render. */
export function isValidZone(zone: string): boolean {
  const hit = zoneChecked.get(zone);
  if (hit !== undefined) return hit;
  let ok = true;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    ok = false;
  }
  zoneChecked.set(zone, ok);
  return ok;
}

/** The calendar day of an instant in `zone` as `YYYY-MM-DD` (en-CA writes it that way). Throws on an unknown zone. */
export function ymdInZone(at: Date | number, zone: string | undefined): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

export type WallParts = { y: number; m: number; d: number; h: number; min: number };

const wallFormats = new Map<string, Intl.DateTimeFormat>();

/** Year, month, day, hour (0 to 23) and minute that `zone`'s wall clock reads at `at`. Throws on an unknown zone. */
export function wallParts(at: Date | number, zone: string | undefined): WallParts {
  const key = zone ?? "";
  let f = wallFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    wallFormats.set(key, f);
  }
  const parts = f.formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, min: get("minute") };
}

/** The hour (0 to 23) on `zone`'s wall clock. Throws on an unknown zone. */
export function hourInZone(at: Date | number, zone: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: zone }).format(at));
}

/** Offset of `zone` from UTC at `utcMs`, in minutes (east positive), read to the second. Throws on an unknown zone. */
export function zoneOffsetMinutes(zone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000);
}

const yearFormats = new Map<string, Intl.DateTimeFormat>();

/** The year of an instant on `zone`'s calendar, as text. An unknown zone reads the device's, as the "when" text always did. */
export function yearInZone(at: number, zone: string): string {
  let f = yearFormats.get(zone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: zone });
    } catch {
      f = new Intl.DateTimeFormat("en", { year: "numeric" });
    }
    yearFormats.set(zone, f);
  }
  return f.format(at);
}
