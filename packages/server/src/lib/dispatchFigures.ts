/**
 * The two figures every dispatch screen shows, from ONE place (BACKLOG 80): the list (`listDispatches`),
 * the detail (`getDispatch`) and the packing list header all take them from here.
 *
 * - Ship day (one rule for the list, the detail, the customer page, the party portal and the phone): a COMPLETED
 *   load reads the day it left (`completedAt`, kind "dispatched"), whatever ship date was planned; a load still
 *   being built or held reads the ship date somebody entered (`shipDate`, kind "ship"); else none. The packing
 *   list prints the ENTERED ship date only (`enteredShipYmd`; it prints its own issue date besides).
 *   Always the company calendar day (`settings.timezone`): 20:30 UTC is already the next day in IST.
 * - Weight: the sum of the dispatch items' bundle weights (grams). A packing list's summary is the same sum
 *   taken when it was issued, so the current revision of a completed dispatch equals it.
 */
import { companyTimezone, zonedYmd } from "./dayWindow";

export type ShipDayKind = "dispatched" | "ship";

const pad2 = (n: number) => String(n).padStart(2, "0");

export function ymdOfInstant(timezone: string, at: Date | number): string {
  const d = zonedYmd(timezone, typeof at === "number" ? at : at.getTime());
  return `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
}

function zoneOf(settingsOrTimezone: Record<string, unknown> | string | null | undefined): string {
  return typeof settingsOrTimezone === "string" ? settingsOrTimezone : companyTimezone(settingsOrTimezone);
}

const DAY_MS = 86_400_000;

/**
 * The calendar day of an entered ship date. The web form and the phone store a typed day as UTC midnight of
 * that day, which must read as that same day in every zone (a plant west of UTC would otherwise see the day
 * before); any other instant is a moment and reads on the company's clock.
 */
function shipDateYmd(tz: string, shipDate: Date): string {
  const ms = shipDate.getTime();
  return ms % DAY_MS === 0 ? new Date(ms).toISOString().slice(0, 10) : ymdOfInstant(tz, ms);
}

export function dispatchShipDay(
  d: { status: string; completedAt: Date | null; shipDate: Date | null },
  settingsOrTimezone: Record<string, unknown> | string | null | undefined,
): { ymd: string; kind: ShipDayKind } | null {
  const tz = zoneOf(settingsOrTimezone);
  if (d.status === "completed" && d.completedAt) return { ymd: ymdOfInstant(tz, d.completedAt), kind: "dispatched" };
  if (d.shipDate) return { ymd: shipDateYmd(tz, d.shipDate), kind: "ship" };
  return null;
}

/** The ship date somebody entered, as the company's calendar day; null when none was entered (never the completion day). */
export function enteredShipYmd(
  shipDate: Date | null | undefined,
  settingsOrTimezone: Record<string, unknown> | string | null | undefined,
): string | null {
  return shipDate ? shipDateYmd(zoneOf(settingsOrTimezone), shipDate) : null;
}
