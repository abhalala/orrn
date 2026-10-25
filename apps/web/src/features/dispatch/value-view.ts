import { formatKgTotal, gToKg } from "@orrn/domain";

/**
 * FP-OP-14: what the dispatch's value card shows, from `dispatch.getDispatch().value` (the server
 * computes the figure; the client only formats it). Null value: no card (rates off, or no
 * `order.price`).
 */
export type DispatchValue = {
  valuePaise: number;
  pricedItems: number;
  pricedG: number;
  rateMissing: number;
  missingG: number;
  complete: boolean;
};

const RUPEES = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Paise as "₹1,23,456.78" (Indian grouping). */
export function formatRupees(paise: number): string {
  return `₹${RUPEES.format(paise / 100)}`;
}

export type ValueCardModel = {
  amount: string;
  pricedKg: string;
  missing: { count: number; kg: string } | null;
};

export function valueCardModel(value: DispatchValue | null | undefined): ValueCardModel | null {
  if (!value) return null;
  return {
    amount: formatRupees(value.valuePaise),
    pricedKg: formatKgTotal(gToKg(value.pricedG)),
    missing: value.rateMissing > 0 ? { count: value.rateMissing, kg: formatKgTotal(gToKg(value.missingG)) } : null,
  };
}
