import type { MessageKey, Translate } from "@orrn/i18n";

import { formatQty, type QtyProblem, type StoreCategory, type StoreUnit } from "./store-qty";

/** Unknown values from older rows fall back to "other" instead of showing a raw key. */
function pick<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const UNITS: readonly StoreUnit[] = ["kg", "litre", "piece", "metre", "set", "box", "bag"];
const CATEGORIES: readonly StoreCategory[] = ["chemical", "fuel", "gas", "spare", "other"];
const PURPOSES = ["melt", "nitriding", "maintenance", "exchange", "other"] as const;

/** Short unit after a number: "kg", "L", "pcs", "boxes". `milli` picks singular or plural. */
export function unitShort(t: Translate, unit: string, milli = 2000): string {
  const u = pick(unit, UNITS, "kg");
  return t(`store.unitShort.${u}` as MessageKey, { count: milli === 1000 ? 1 : 2 });
}

/** Full unit name for pickers: "Kilogram (kg)". */
export function unitName(t: Translate, unit: string): string {
  return t(`store.unitName.${pick(unit, UNITS, "kg")}` as MessageKey);
}

/** "12.5 kg", "3 pcs". */
export function qtyText(t: Translate, milli: number, unit: string): string {
  return `${formatQty(milli)} ${unitShort(t, unit, Math.abs(milli))}`;
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
export function countedIn(t: Translate, item: { category: string; unit: string }): string {
  return t("store.countedIn", { category: categoryLabel(t, item.category), unit: unitShort(t, item.unit) });
}
