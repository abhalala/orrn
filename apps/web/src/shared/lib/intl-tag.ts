/**
 * The `Intl` locale tag for a screen language (BACKLOG 87: dates on floor screens follow the user's
 * language, so a Gujarati screen never reads "23 Oct"). Digits stay Latin (`numberingSystem: "latn"` at
 * the call site, spec §2). Unknown values fall back to English (India).
 */
export function intlTag(locale: string | undefined | null): string {
  return locale === "hi" ? "hi-IN" : locale === "gu" ? "gu-IN" : "en-IN";
}

/**
 * "23 Oct" / "23 अक्तू" / "23 ઑક્ટો": a day and a short month in the user's language, joined by a plain
 * space. Intl's own separators and the English "Sept" differ between ICU builds, so the parts are assembled.
 */
export function dayMonth(date: Date, locale: string | undefined | null, timeZone: string | undefined, withYear = false): string {
  const make = (tz: string | undefined) =>
    new Intl.DateTimeFormat(intlTag(locale), {
      day: "numeric",
      month: "short",
      ...(withYear ? { year: "numeric" } : {}),
      timeZone: tz,
      numberingSystem: "latn",
    }).formatToParts(date);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = make(timeZone);
  } catch {
    parts = make(undefined); // unknown zone: the device's
  }
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const month = locale === "hi" || locale === "gu" ? part("month") : part("month").replace(/^Sept$/, "Sep");
  return [part("day"), month, withYear ? part("year") : ""].filter(Boolean).join(" ");
}

/**
 * A plain `YYYY-MM-DD` calendar day (a production day, a book date) in the user's language, "25 Oct 2026".
 * Not for inputs: an `<input type="date">` keeps the ISO text. Anything that is not `YYYY-MM-DD` comes back as given.
 */
export function ymdLabel(ymd: string, locale: string | undefined | null): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  return dayMonth(new Date(`${ymd}T12:00:00Z`), locale, "UTC", true);
}
