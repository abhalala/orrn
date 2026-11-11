import type { Fmt } from "@orrn/domain";

import { pinned } from "@/shared/lib/fmt-text";

/** "24 Oct" on the plant clock for the foundry lists: English month names as ever, the plant's date order. */
export function dayText(fmt: Fmt, ms: number, timeZone: string): string {
  return pinned(fmt, { zone: timeZone, locale: "en" }).date(ms, { year: false });
}

/** "14:05" (or "2:05 pm") on the plant clock: the plant's choice of 12 or 24 hours. */
export function clockText(fmt: Fmt, ms: number, timeZone: string): string {
  return pinned(fmt, { zone: timeZone }).time(ms);
}
