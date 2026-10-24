/**
 * Dates for the Pack screens (spec §2: `d MMM`, the year only when it isn't
 * the current one, 24h times, in the company timezone when set). Digits stay
 * Latin in Hindi too.
 */

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type PackedWhen = {
  /** `today` / `yesterday` read as words; `date` shows `date`. */
  day: "today" | "yesterday" | "date";
  /** `3 Oct`, or `31 Dec 2025` outside the current year. */
  date: string;
  /** `14:05` */
  time: string;
};

type Parts = { y: number; m: number; d: number; hh: string; mm: string };

function zoned(date: Date, timeZone: string | undefined): Parts {
  const fmt = (tz: string | undefined) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  let f: Intl.DateTimeFormat;
  try {
    f = fmt(timeZone);
  } catch {
    f = fmt(undefined); // unknown zone: the device's
  }
  const get = (type: string) => f.formatToParts(date).find((p) => p.type === type)?.value ?? "0";
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), hh: get("hour"), mm: get("minute") };
}

/** Days between two calendar dates (b - a). */
function dayDiff(a: Parts, b: Parts): number {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
}

export function packedWhen(
  at: Date | number | string,
  opts: { now?: Date; timeZone?: string; locale?: string } = {},
): PackedWhen {
  const date = at instanceof Date ? at : new Date(at);
  const p = zoned(date, opts.timeZone);
  const today = zoned(opts.now ?? new Date(), opts.timeZone);
  const diff = dayDiff(p, today);

  let dayMonth: string;
  if (opts.locale === "hi") {
    try {
      dayMonth = new Intl.DateTimeFormat("hi-IN", {
        day: "numeric",
        month: "short",
        timeZone: opts.timeZone,
        numberingSystem: "latn",
      }).format(date);
    } catch {
      dayMonth = `${p.d} ${MONTHS_EN[p.m - 1]}`;
    }
  } else {
    dayMonth = `${p.d} ${MONTHS_EN[p.m - 1]}`;
  }

  return {
    day: diff === 0 ? "today" : diff === 1 ? "yesterday" : "date",
    date: p.y === today.y ? dayMonth : `${dayMonth} ${p.y}`,
    time: `${p.hh}:${p.mm}`,
  };
}
