/**
 * Dates for the Pack screens (spec §2: `d MMM`, the year only when it isn't the current one, the plant's clock,
 * in the company timezone when set). The month is in the screen language (en, hi, gu); digits stay Latin; the date
 * order and the 12 or 24 hour clock are the plant's.
 */
import type { Fmt } from "@orrn/domain";

import { pinned } from "@/shared/lib/fmt-text";
import { wallParts } from "@/shared/lib/plant-calendar";

export type PackedWhen = {
  /** `today` / `yesterday` read as words; `date` shows `date`. */
  day: "today" | "yesterday" | "date";
  /** `3 Oct`, or `31 Dec 2025` outside the current year. */
  date: string;
  /** `14:05` */
  time: string;
};

/** Days between two calendar dates (b - a). */
function dayDiff(a: { y: number; m: number; d: number }, b: { y: number; m: number; d: number }): number {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export function packedWhen(fmt: Fmt, at: Date | number | string, opts: { now?: Date; timeZone?: string } = {}): PackedWhen {
  const date = at instanceof Date ? at : new Date(at);
  // An unknown zone reads the plant's own clock instead of throwing.
  const f = pinned(fmt, { zone: opts.timeZone });
  const p = wallParts(date, f.zone);
  const today = wallParts(opts.now ?? new Date(), f.zone);
  const diff = dayDiff(p, today);
  return {
    day: diff === 0 ? "today" : diff === 1 ? "yesterday" : "date",
    date: f.date(date.getTime(), { year: p.y !== today.y }),
    time: f.time(date.getTime()),
  };
}
