import { DEFAULT_TIMEZONE } from "../src/lib/dayWindow";
import { ymdOfInstant } from "../src/lib/dispatchFigures";

const DAY_MS = 86_400_000;

/**
 * The plant's calendar day (`YYYY-MM-DD`) `offsetDays` from now, on the company clock (Asia/Kolkata unless
 * `timezone` says otherwise): the same day the reports bucket by.
 *
 * Tests that build a from/to range or compare against "today" must use this, never
 * `new Date().toISOString().slice(0, 10)`: that is the UTC day, which differs from the plant day for 5.5 hours
 * every evening (after 18:30 UTC), and a test written with it fails only at that time of day (BACKLOG 110).
 */
export function plantDay(offsetDays = 0, timezone: string = DEFAULT_TIMEZONE): string {
  return ymdOfInstant(timezone, Date.now() + offsetDays * DAY_MS);
}
