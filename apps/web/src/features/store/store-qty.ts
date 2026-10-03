/**
 * Store quantities on the client (spec P17, ruling RP16). The server stores integer milli-units of
 * the item's own unit (`qtyMilli`: 1000 = 1 kg / 1 litre / 1 piece); countable units take whole
 * numbers; one entry is capped at 100,000 units. These lists mirror `@orrn/db/schema/store` and
 * `lib/store.ts` (pinned by store-qty.test.ts) so the web bundle never pulls in the schema.
 */

export const STORE_UNITS = ["kg", "litre", "piece", "metre", "set", "box", "bag"] as const;
export type StoreUnit = (typeof STORE_UNITS)[number];

export const COUNTABLE_UNITS: readonly StoreUnit[] = ["piece", "set", "box", "bag"];

export const STORE_CATEGORIES = ["chemical", "fuel", "gas", "spare", "other"] as const;
export type StoreCategory = (typeof STORE_CATEGORIES)[number];

/** What an issue (MRS) is for. `exchange` exists on the server only as the outgoing leg of an exchange. */
export const ISSUE_PURPOSES = ["melt", "nitriding", "maintenance", "other"] as const;
export type IssuePurpose = (typeof ISSUE_PURPOSES)[number];

/** 100,000 units per entry (server `MAX_STORE_QTY_MILLI`). */
export const MAX_QTY_MILLI = 100_000_000;

export type QtyProblem = "empty" | "invalid" | "zero" | "decimals" | "whole" | "tooBig";
export type QtyResult = { ok: true; milli: number } | { ok: false; problem: QtyProblem };

const QTY_TEXT = /^(\d*)(?:\.(\d*))?$/;

export function isCountable(unit: StoreUnit | string | null | undefined): boolean {
  return Boolean(unit && (COUNTABLE_UNITS as readonly string[]).includes(unit));
}

/**
 * Reads what the person typed as exact milli-units: integer and fraction digits are combined as
 * strings, so "1.005" is 1005, never 1004.999. Commas and spaces are ignored. A unit, when known,
 * adds the whole-number rule for countable items.
 */
export function parseQtyMilli(text: string, unit: StoreUnit | null): QtyResult {
  const cleaned = text.replace(/[\s,]/g, "");
  if (cleaned === "") return { ok: false, problem: "empty" };
  const m = QTY_TEXT.exec(cleaned);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return { ok: false, problem: "invalid" };
  const whole = m[1] ?? "";
  const frac = m[2] ?? "";
  if (frac.length > 3) return { ok: false, problem: "decimals" };
  // More digits than the cap could ever hold: refuse before Number() loses precision.
  if (whole.replace(/^0+/, "").length > 7) return { ok: false, problem: "tooBig" };
  const milli = Number(whole || "0") * 1000 + Number(frac.padEnd(3, "0"));
  if (milli === 0) return { ok: false, problem: "zero" };
  if (milli > MAX_QTY_MILLI) return { ok: false, problem: "tooBig" };
  if (isCountable(unit) && milli % 1000 !== 0) return { ok: false, problem: "whole" };
  return { ok: true, milli };
}

const DISPLAY = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3, numberingSystem: "latn" });

/** Milli-units for display: Indian grouping, up to three decimals, no trailing zeros ("12.5"). */
export function formatQty(milli: number): string {
  return DISPLAY.format(milli / 1000);
}

/** Milli-units back into an input value: plain digits, no grouping ("1250.75"). */
export function qtyToText(milli: number): string {
  const sign = milli < 0 ? "-" : "";
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, "0").replace(/0+$/, "");
  return `${sign}${whole}${frac ? `.${frac}` : ""}`;
}

/** An issue of `milli` would take the store below zero (the server refuses it too). */
export function isShort(milli: number, balanceMilli: number): boolean {
  return milli > balanceMilli;
}
