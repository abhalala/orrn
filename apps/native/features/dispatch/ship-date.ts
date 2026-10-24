/** What the ship date chips say. `typed` keeps the text as typed until it is a real day. */
export type ShipDateChoice = { kind: "none" } | { kind: "today" } | { kind: "tomorrow" } | { kind: "typed"; text: string };

/** UTC midnight of the phone's calendar day `offset` days from `now`: how the server stores a ship date. */
function dayStart(now: Date, offset: number): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + offset);
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
export function shipDateFromChoice(choice: ShipDateChoice, now: Date = new Date()): number | null | undefined {
  switch (choice.kind) {
    case "none":
      return null;
    case "today":
      return dayStart(now, 0);
    case "tomorrow":
      return dayStart(now, 1);
    case "typed":
      return parseTyped(choice.text);
  }
}

const two = (n: number) => String(n).padStart(2, "0");

/** The choice that shows a stored ship date: a chip when it is today or tomorrow, else the typed text. */
export function shipDateChoice(shipDate: number | null | undefined, now: Date = new Date()): ShipDateChoice {
  if (shipDate === null || shipDate === undefined) return { kind: "none" };
  if (shipDate === dayStart(now, 0)) return { kind: "today" };
  if (shipDate === dayStart(now, 1)) return { kind: "tomorrow" };
  const d = new Date(shipDate);
  return { kind: "typed", text: `${two(d.getUTCDate())}-${two(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}` };
}
