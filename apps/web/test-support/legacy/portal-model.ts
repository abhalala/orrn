/** Reference copy of the portal date helpers before the plant formatter (units layer, slice b part 3). No screen imports it. */
import { intlTag } from "./legacy-intl-tag";

/** A plain `YYYY-MM-DD` book date. */
export function bookDate(value: string | null | undefined, locale: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value ?? "";
  return new Intl.DateTimeFormat(intlTag(locale), { day: "numeric", month: "short", year: "numeric", numberingSystem: "latn", timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

/**
 * The date a party sees on a dispatch: the server's one ship day (the day the load left, the same day the
 * office's list, detail and customer page show), as a calendar day, so no phone or browser zone can move it.
 */
export function portalDispatchDay(d: { shipDay?: { ymd: string } | null }, locale: string): string {
  return d.shipDay?.ymd ? bookDate(d.shipDay.ymd, locale) : "";
}
