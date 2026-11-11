/**
 * The one function of the web's `shared/lib/plant-calendar.ts` that the phone's copy of `melt-times.ts` imports
 * (the copy is byte-identical to the web's, so it keeps the web's import path). Same body as the web's.
 */

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
