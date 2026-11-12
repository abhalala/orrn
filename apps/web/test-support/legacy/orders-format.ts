/** Reference copy of the orders date helpers before the plant formatter (units layer, slice b part 3). No screen imports it. */

/** `Date` or ms as "24 Oct, 20:00" on the plant's clock (`settings.timezone`; review m-9). */
export function dayTimeText(at: Date | number | string, locale: string, timeZone = "Asia/Kolkata"): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    numberingSystem: "latn",
    timeZone,
  }).format(d);
}

/** A `YYYY-MM-DD` day as "25 Oct" (a calendar day, no zone shift). */
export function dayText(ymd: string, locale: string): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const at = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(at.getTime())) return ymd;
  return new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", { day: "numeric", month: "short", numberingSystem: "latn", timeZone: "UTC" }).format(at);
}
