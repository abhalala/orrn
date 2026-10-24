import { gToKg } from "@orrn/domain";
import type { MessageKey, TranslateVars } from "@orrn/i18n";

/** `analytics.stockAgeing` (plant PL-A1). Weights in grams; "Other" has `sectionId: null`. */
export type StockAgeingData = {
  asOf: string;
  totals: { bundles: number; kgG: number };
  buckets: { key: string; minDays: number; maxDays: number | null; bundles: number; kgG: number }[];
  topSections: { sectionId: string | null; label: string; kgG: number; bundles: number; sharePct: number }[];
};

type T = (key: MessageKey, vars?: TranslateVars) => string;

/** The four age buckets as ordinal bars in kg. No bar is partial: ageing is a snapshot of now. */
export function ageBars(data: StockAgeingData, t: T) {
  return data.buckets.map((b) => ({
    key: b.key,
    label: t("stock.charts.bucket", { range: b.key }),
    short: b.key,
    value: gToKg(b.kgG),
  }));
}

/**
 * Top sections by kg for `RankedBars`, plus the folded rest. A die the
 * screen already shows gets the same label as its block (`PATTI 14701`).
 */
export function topSectionRows(data: StockAgeingData, labelFor: (dieId: string) => string | undefined) {
  const rows = data.topSections
    .filter((s): s is typeof s & { sectionId: string } => s.sectionId !== null)
    .map((s) => ({ key: s.sectionId, label: labelFor(s.sectionId) ?? s.label, value: gToKg(s.kgG), share: s.sharePct }));
  const other = gToKg(data.topSections.find((s) => s.sectionId === null)?.kgG ?? 0);
  return { rows, other };
}
