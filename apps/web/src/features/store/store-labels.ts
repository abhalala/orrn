import type { MessageKey, Translate } from "@orrn/i18n";

import { formatQty, type QtyProblem, type StoreCategory, type StoreUnit } from "./store-qty";
import type { Fmt } from "@orrn/domain";
import { massUnit } from "@/shared/lib/fmt-text";

/** Unknown values from older rows fall back to "other" instead of showing a raw key. */
function pick<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const UNITS: readonly StoreUnit[] = ["kg", "litre", "piece", "metre", "set", "box", "bag"];
const CATEGORIES: readonly StoreCategory[] = ["chemical", "fuel", "gas", "spare", "other"];
const PURPOSES = ["melt", "nitriding", "maintenance", "exchange", "other"] as const;

/** Short unit after a number: "kg", "L", "pcs", "boxes". `milli` picks singular or plural. */
export function unitShort(t: Translate, unit: string, milli = 2000, fmt?: Fmt): string {
  const u = pick(unit, UNITS, "kg");
  if (u === "kg" && fmt) return massUnit(fmt);
  return t(`store.unitShort.${u}` as MessageKey, { count: milli === 1000 ? 1 : 2 });
}

/** Full unit name for pickers: "Kilogram (kg)". */
export function unitName(t: Translate, unit: string): string {
  return t(`store.unitName.${pick(unit, UNITS, "kg")}` as MessageKey);
}

/** "12.5 kg", "3 pcs". */
export function qtyText(t: Translate, milli: number, unit: string, fmt?: Fmt): string {
  return `${formatQty(milli, unit, fmt)} ${unitShort(t, unit, Math.abs(milli), fmt)}`;
}

export function categoryLabel(t: Translate, category: string): string {
  return t(`store.categories.${pick(category, CATEGORIES, "other")}` as MessageKey);
}

export function purposeLabel(t: Translate, purpose: string): string {
  return t(`store.purpose.${pick(purpose, PURPOSES, "other")}` as MessageKey);
}

export function qtyProblemText(t: Translate, problem: QtyProblem): string {
  return t(`store.form.qty.${problem}` as MessageKey);
}

/** "Chemical, counted in kg". */
export function countedIn(t: Translate, item: { category: string; unit: string }, fmt?: Fmt): string {
  return t("store.countedIn", { category: categoryLabel(t, item.category), unit: unitShort(t, item.unit, 2000, fmt) });
}
