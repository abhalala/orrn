/** Reference copy of the Today clock and caption helpers before the plant formatter (units layer, slice b part 3). No screen imports it. */
export const DEFAULT_TIMEZONE = "Asia/Kolkata";
type TodayData = { productionDay: { day: string; startMs: number; shiftsSet: boolean; shift: { name: string } | null } };

function validZone(timezone: string): string {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * The plant's wall clock: the hour (for the greeting) and today's long date
 * ("Saturday, 3 October"), read in the company time zone so a phone set to
 * another zone still greets the shift correctly. Digits stay Latin in Hindi.
 */
export function companyClock(timezone: string, nowMs: number, locale: string): { hour: number; date: string } {
  const timeZone = validZone(timezone);
  const at = new Date(nowMs);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone }).format(at),
  );
  // Weekday, day and month are read as format parts and joined here: Intl's own pattern differs
  // between ICU builds (a comma after the weekday in some, none in others).
  const parts = new Intl.DateTimeFormat(dateTag(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
    numberingSystem: "latn",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${part("weekday")}, ${part("day")} ${part("month")}`;
  return { hour, date };
}

/** 24 h time on the plant's wall clock ("14:05"), for session times and "Showing the numbers from 14:05". */
export function clockTime(timezone: string): (at: string | number) => string {
  const format = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: validZone(timezone),
  });
  return (at) => format.format(new Date(at));
}

/** BCP 47 tag for the dates on Today; digits stay Latin in every language. */
function dateTag(locale: string): string {
  return locale === "hi" ? "hi-IN" : locale === "gu" ? "gu-IN" : "en-IN";
}

function dayText(day: string, locale: string): string {
  // `day` is a plain calendar date (YYYY-MM-DD): read it as UTC so no zone can move it.
  return new Intl.DateTimeFormat(dateTag(locale), { day: "numeric", month: "short", timeZone: "UTC", numberingSystem: "latn" }).format(
    new Date(`${day}T00:00:00Z`),
  );
}

/**
 * What the Today caption says (FP-PF-05, FP-PF-15): the production day, when it starts, the
 * calendar date, and the shift now. Before shift 1 starts the production day is yesterday's.
 */
export function productionDayCaption(
  pd: Pick<TodayData["productionDay"], "day" | "startMs" | "shiftsSet" | "shift">,
  timezone: string,
  locale: string,
  nowMs: number,
): ProductionDayCaption {
  const zone = validZone(timezone);
  const calendarDay = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: zone }).format(new Date(nowMs));
  return {
    day: dayText(pd.day, locale),
    from: pd.shiftsSet ? clockTime(zone)(pd.startMs) : null,
    calendar: dayText(calendarDay, locale),
    beforeStart: pd.shiftsSet && calendarDay !== pd.day,
    shiftName: pd.shift?.name ?? null,
  };
}

