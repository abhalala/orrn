/**
 * The two figures every dispatch screen shows, from ONE place (BACKLOG 80): the list (`listDispatches`),
 * the detail (`getDispatch`) and the packing list header all take them from here.
 *
 * - Ship day: the company calendar day (`settings.timezone`) of the ship date somebody entered (`shipDate`,
 *   kind "ship"); with none, the day a completed load left (`completedAt`, kind "dispatched"); else none.
 *   Never read a day off the raw instant in UTC: 20:30 UTC is already the next day in IST.
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

export function dispatchShipDay(
  d: { status: string; completedAt: Date | null; shipDate: Date | null },
  settingsOrTimezone: Record<string, unknown> | string | null | undefined,
): { ymd: string; kind: ShipDayKind } | null {
  const tz = typeof settingsOrTimezone === "string" ? settingsOrTimezone : companyTimezone(settingsOrTimezone);
  if (d.shipDate) return { ymd: ymdOfInstant(tz, d.shipDate), kind: "ship" };
  if (d.status === "completed" && d.completedAt) return { ymd: ymdOfInstant(tz, d.completedAt), kind: "dispatched" };
  return null;
}
