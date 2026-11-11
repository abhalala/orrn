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
  checkRow: null,
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
