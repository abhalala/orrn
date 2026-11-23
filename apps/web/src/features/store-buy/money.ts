/**
 * Money on the buying screens. The server keeps integer paise (rates per unit of the item's unit) and
 * GST in basis points; these parse what a person types exactly (the units layer's money field, so
 * "84.505" is 8451 paise, never a float times 100) and format for display with Indian grouping.
 */
import { toCanonical } from "@orrn/domain";

const RUPEES = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2, numberingSystem: "latn" });
const PCT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, numberingSystem: "latn" });

/** 1 crore per unit (server STORE_MAX_RATE_PAISE). */
export const MAX_RATE_PAISE = 1_000_000_000;
/** 28 % (server STORE_MAX_GST_BP). */
export const MAX_GST_BP = 2_800;

/** Paise as "₹1,23,456.78". */
export function rupees(paise: number): string {
  return `₹${RUPEES.format(paise / 100)}`;
}

/** Paise as a plain input value: "84.5" stays "84.50", no grouping, no sign. */
export function paiseToText(paise: number): string {
  return (paise / 100).toFixed(2);
}

/** Typed rupees ("84.50", "1,250") to paise, rounded half away from zero; null when it is not a plain amount or is over the cap. */
export function ratePaiseFromText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const r = toCanonical("order.amount", trimmed, "inr", { mode: "round" });
  if (!r.ok || r.value < 0 || r.value > MAX_RATE_PAISE) return null;
  return r.value;
}

/** Typed percent ("18", "12.5") to basis points; null when it is not a number between 0 and 28. */
export function gstBpFromText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const r = toCanonical("customer.tolerance", trimmed, "pct", { mode: "round" });
  if (!r.ok || r.value < 0 || r.value > MAX_GST_BP) return null;
  return r.value;
}

/** Basis points as "18 %" style text without the sign: "18", "12.5". */
export function bpText(bp: number): string {
  return PCT.format(bp / 100);
}
