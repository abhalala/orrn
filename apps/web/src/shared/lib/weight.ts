/**
 * Weight display helpers. Stored data stays in grams; the plant reads kg.
 * Indian digit grouping (en-IN): 18,940.5 / 1,23,456.7.
 */

const bundleKg = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const totalKg = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function toKg(grams: number | string | null | undefined): number {
  const g = Number(grams);
  return Number.isFinite(g) ? g / 1000 : 0;
}

/** One bundle or item, 2 decimals, no unit: "52.40". */
export function kgValue(grams: number | string | null | undefined): string {
  return bundleKg.format(toKg(grams));
}

/** One bundle or item: "52.40 kg". */
export function formatKg(grams: number | string | null | undefined): string {
  return `${kgValue(grams)} kg`;
}

/** Totals, 1 decimal, no unit: "18,940.5". */
export function kgTotalValue(grams: number | string | null | undefined): string {
  return totalKg.format(toKg(grams));
}

/** Totals: "18,940.5 kg". */
export function formatKgTotal(grams: number | string | null | undefined): string {
  return `${kgTotalValue(grams)} kg`;
}
