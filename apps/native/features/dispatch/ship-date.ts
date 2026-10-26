import { wallClock } from "@/lib/format";

/** What the ship date chips say. `typed` keeps the text as typed until it is a real day. */
export type ShipDateChoice = { kind: "none" } | { kind: "today" } | { kind: "tomorrow" } | { kind: "typed"; text: string };

/**
 * UTC midnight of the company's calendar day `offset` days from `now` (the phone's calendar when no zone is
 * given): how the server stores a ship date. "Today" is the plant's today, not the phone's.
 */
function dayStart(now: Date, offset: number, timeZone?: string): number {
  const w = wallClock(now, timeZone);
  return Date.UTC(w.year, w.month - 1, w.day + offset);
}

const TYPED = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\s*$/;

/** DD-MM-YYYY (also / or .) to UTC midnight, or undefined for text that is not a real day. */
function parseTyped(text: string): number | undefined {
  const m = TYPED.exec(text);
  if (!m) return undefined;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const ms = Date.UTC(year, month - 1, day);
  const d = new Date(ms);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day ? ms : undefined;
}

/** null clears the date, undefined means the typed text is not a day yet (do not save). */
export function shipDateFromChoice(choice: ShipDateChoice, now: Date = new Date(), timeZone?: string): number | null | undefined {
  switch (choice.kind) {
    case "none":
      return null;
    case "today":
      return dayStart(now, 0, timeZone);
    case "tomorrow":
      return dayStart(now, 1, timeZone);
    case "typed":
      return parseTyped(choice.text);
  }
}

const two = (n: number) => String(n).padStart(2, "0");

/** The choice that shows a stored ship date: a chip when it is today or tomorrow, else the typed text. */
export function shipDateChoice(shipDate: number | null | undefined, now: Date = new Date(), timeZone?: string): ShipDateChoice {
  if (shipDate === null || shipDate === undefined) return { kind: "none" };
  if (shipDate === dayStart(now, 0, timeZone)) return { kind: "today" };
  if (shipDate === dayStart(now, 1, timeZone)) return { kind: "tomorrow" };
  const d = new Date(shipDate);
  return { kind: "typed", text: `${two(d.getUTCDate())}-${two(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}` };
}

/** The server's one ship day (lib/dispatchFigures): a completed load's departure day, else the entered ship date. */
export type ShipDay = { ymd: string; kind: "dispatched" | "ship" } | null | undefined;

/**
 * What a dispatch row or header says about its day: "Dispatched 28 Oct" for a load that left, "Ship 26 Oct" for one
 * still being built or held, "no ship date" otherwise. The day is the server's `shipDay`, never re-derived from
 * `shipDate` (read in UTC) or `completedAt` here, so the phone cannot disagree with the web or the packing list.
 */
export function shipDayLine(
  shipDay: ShipDay,
  formatDay: (ymd: string) => string | null,
  t: (key: "dispatch.detail.dispatchedOn" | "dispatch.detail.shipOn" | "native.dispatch.noShipDate", vars?: { date: string }) => string,
): string {
  const day = shipDay?.ymd ? formatDay(shipDay.ymd) : null;
  if (!shipDay || !day) return t("native.dispatch.noShipDate");
  return t(shipDay.kind === "dispatched" ? "dispatch.detail.dispatchedOn" : "dispatch.detail.shipOn", { date: day });
}

/** A customer's dispatch row date: the server's ship day, else the day the load was started. */
export function customerDispatchDay(
  d: { shipDay?: ShipDay; createdAt: string | number | Date },
  formatDay: (value: string | number | Date) => string | null,
): string | null {
  return d.shipDay?.ymd ? formatDay(d.shipDay.ymd) : formatDay(d.createdAt);
}
