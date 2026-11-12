/**
 * Dates on the customer screens (spec §2: `d MMM`, plus the year when it isn't the current one,
 * on the company's calendar), in the plant's date order. Calendar dates (`YYYY-MM-DD` from the analytics API)
 * are formatted as they are; instants are first placed on the company's calendar.
 */
import type { Fmt } from "@orrn/domain";

import { bookDayText } from "@/shared/lib/fmt-text";

import { todayIn } from "./period";

/** "1 Apr" this year, "1 Sep 2025" otherwise. `today` is the company's `YYYY-MM-DD`. */
export function formatDay(fmt: Fmt, ymd: string, today: string): string {
  return bookDayText(fmt, ymd, today);
}

/** The company-calendar day of an instant, formatted like `formatDay`. */
export function formatInstantDay(fmt: Fmt, at: string | number | Date, timeZone: string, today: string): string {
  const instant = at instanceof Date ? at : new Date(at);
  return formatDay(fmt, todayIn(timeZone, instant), today);
}

/**
 * The date of a row in a customer's dispatch list: the server's ONE ship day (`shipDay`: the day a completed
 * load left, else the ship date entered), else the day the load was started. Never re-derived from `shipDate`
 * or `completedAt` here, so this page cannot disagree with the dispatch list and detail.
 */
export function formatDispatchDay(
  fmt: Fmt,
  d: { shipDay?: { ymd: string } | null; createdAt: string | number | Date },
  timeZone: string,
  today: string,
): string {
  return d.shipDay?.ymd ? formatDay(fmt, d.shipDay.ymd, today) : formatInstantDay(fmt, d.createdAt, timeZone, today);
}
