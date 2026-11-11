import { field } from "./field";
import type { TargetDef } from "./types";

/**
 * Open order book. `orderedKg`, `dispatchedKg` and `bakiKg` are masses stored in grams (the names are the plan's).
 * Group key for one order: customer + (poNumber or oldOrderNo) + orderDate.
 */
export const ordersTarget: TargetDef = {
  id: "orders",
  order: 50,
  fields: [
    field("customer", { required: true, resolver: "customer_by_name" }),
    field("orderDate", { kind: "date", required: true, note: "Order date, or the period as-of date" }),
    field("series", { required: true }),
    field("sectionCode", { required: true, resolver: "section_by_code" }),
    field("poNumber"),
    field("oldOrderNo", { note: "Order number in the old book" }),
    field("kgPer12ft", { kind: "linear_mass" }),
    field("cutLength", { kind: "length" }),
    field("pcs", { kind: "count" }),
    field("orderedKg", { kind: "mass", note: "Ordered quantity, stored in grams" }),
    field("dispatchedKg", { kind: "mass", note: "Dispatched so far, stored in grams" }),
    field("bakiKg", { kind: "mass", note: "Balance still to dispatch, stored in grams" }),
    field("rate", { kind: "price_per_mass", note: "Rate, stored as paise per kg" }),
    field("finish"),
    field("alloy"),
    field("temper"),
    field("note"),
  ],
  keys: ["customer", "oldOrderNo", "orderDate"],
  keyResolvers: {},
  checkRow: (v) => checkOrderLine(v),
};

/** The three quantities differ by more than this many grams: the row is ambiguous (`baki_mismatch`). */
export const BAKI_TOLERANCE_G = 1000;

/**
 * Order line grams (plan B4): `bakiKg` if present, else `orderedKg - dispatchedKg`, else `orderedKg`.
 * `mismatch` is true when all three are present and ordered - dispatched differs from baki by more than 1 kg.
 */
export function orderLineGrams(v: Record<string, unknown>): { grams: number | null; mismatch: boolean } {
  const n = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : null);
  const ordered = n("orderedKg");
  const dispatched = n("dispatchedKg");
  const baki = n("bakiKg");
  const derived = ordered !== null && dispatched !== null ? ordered - dispatched : null;
  const mismatch = ordered !== null && dispatched !== null && baki !== null && Math.abs(derived! - baki) > BAKI_TOLERANCE_G;
  const grams = baki !== null ? baki : derived !== null ? derived : ordered;
  return { grams, mismatch };
}

/**
 * The line must have something left to dispatch (C7). Baki 0 is a closed order. Ordered minus dispatched at or
 * below zero with no baki is over-dispatched or closed. A row with no weight at all needs pieces.
 */
export function checkOrderLine(v: Record<string, unknown>): { field: string; code: "not_positive" | "over_dispatched" | "no_quantity" } | null {
  const baki = typeof v.bakiKg === "number" ? v.bakiKg : null;
  if (baki !== null && baki <= 0) return { field: "bakiKg", code: "not_positive" };
  const line = orderLineGrams(v);
  if (line.grams === null) return typeof v.pcs === "number" ? null : { field: "orderedKg", code: "no_quantity" };
  if (line.grams > 0) return null;
  if (baki === null && typeof v.dispatchedKg === "number") return { field: "dispatchedKg", code: line.grams < 0 ? "over_dispatched" : "not_positive" };
  return { field: "orderedKg", code: "not_positive" };
}
