import { formatKgTotal, gToKg, type Fmt } from "@orrn/domain";
import { kgGrouped1 } from "@/shared/lib/fmt-text";

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

export function valueCardModel(value: DispatchValue | null | undefined, fmt?: Fmt): ValueCardModel | null {
  if (!value) return null;
  return {
    amount: fmt ? fmt.money(value.valuePaise) : formatRupees(value.valuePaise),
    pricedKg: fmt ? kgGrouped1(fmt, value.pricedG) : formatKgTotal(gToKg(value.pricedG)),
    missing: value.rateMissing > 0 ? { count: value.rateMissing, kg: fmt ? kgGrouped1(fmt, value.missingG) : formatKgTotal(gToKg(value.missingG)) } : null,
  };
}
