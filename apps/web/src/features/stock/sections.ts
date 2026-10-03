/**
 * Stock by section (die), from `bundle.stockSummary` run once for available
 * and once for reserved stock. Pure functions so the Sections screen's merge,
 * sort and search are unit-tested.
 */

/** One `bundle.stockSummary` row. D1 aggregates can arrive as strings, so every count goes through `Number`. */
export type SummaryRow = {
  dieId: string;
  dieSeries: string;
  dieSectionCode: string;
  dieName: string | null;
  dieWeightMinG: number;
  dieWeightMaxG: number;
  bundleCount: number;
  totalQuantity: number;
  totalWeightG: number;
  totalLengthMm: number;
};

export type StockAmount = { bundles: number; weightG: number };

export type SectionStock = {
  dieId: string;
  series: string;
  sectionCode: string;
  name: string | null;
  /** The die's band, grams per 12 ft (spec Q1: shown as kg/12ft). */
  weightMinG: number;
  weightMaxG: number;
  /** In stock: free to dispatch. */
  available: StockAmount;
  /** Reserved by a held dispatch: still on the floor, not free. */
  held: StockAmount;
};

export type SectionSort = "kg" | "az";

const NONE: StockAmount = { bundles: 0, weightG: 0 };

function amount(r: SummaryRow): StockAmount {
  return { bundles: Number(r.bundleCount) || 0, weightG: Number(r.totalWeightG) || 0 };
}

function base(r: SummaryRow): Omit<SectionStock, "available" | "held"> {
  return {
    dieId: r.dieId,
    series: r.dieSeries,
    sectionCode: r.dieSectionCode,
    name: r.dieName,
    weightMinG: Number(r.dieWeightMinG) || 0,
    weightMaxG: Number(r.dieWeightMaxG) || 0,
  };
}

/** One row per die that has available or held stock. */
export function mergeSections(available: readonly SummaryRow[], reserved: readonly SummaryRow[]): SectionStock[] {
  const byDie = new Map<string, SectionStock>();
  for (const r of available) byDie.set(r.dieId, { ...base(r), available: amount(r), held: NONE });
  for (const r of reserved) {
    const found = byDie.get(r.dieId);
    if (found) found.held = amount(r);
    else byDie.set(r.dieId, { ...base(r), available: NONE, held: amount(r) });
  }
  return [...byDie.values()];
}

/** The label the plant prints and says: series then section code (`PATTI 14701`). */
export function sectionLabel(s: { series: string; sectionCode: string }): string {
  return [s.series, s.sectionCode].filter(Boolean).join(" ");
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function byLabel(a: SectionStock, b: SectionStock): number {
  return collator.compare(a.series, b.series) || collator.compare(a.sectionCode, b.sectionCode);
}

/** "kg": most kg in stock first (held-only sections sink), ties A to Z. "az": series then code, numbers in number order. */
export function sortSections(rows: readonly SectionStock[], sort: SectionSort): SectionStock[] {
  const out = [...rows];
  if (sort === "az") return out.sort(byLabel);
  return out.sort((a, b) => b.available.weightG - a.available.weightG || byLabel(a, b));
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Client-side search over the loaded sections: series, section code, die name, or "series code" together. */
export function filterSections(rows: readonly SectionStock[], query: string): SectionStock[] {
  const needle = normalise(query);
  if (!needle) return [...rows];
  return rows.filter((s) => {
    const haystack = normalise(`${sectionLabel(s)} ${s.name ?? ""}`);
    return haystack.includes(needle) || normalise(s.name ?? "").includes(needle);
  });
}

export function sectionTotals(rows: readonly SectionStock[]): {
  available: StockAmount;
  held: StockAmount;
  sections: number;
} {
  const sum = (pick: (s: SectionStock) => StockAmount): StockAmount =>
    rows.reduce((t, s) => ({ bundles: t.bundles + pick(s).bundles, weightG: t.weightG + pick(s).weightG }), NONE);
  return { available: sum((s) => s.available), held: sum((s) => s.held), sections: rows.length };
}

export type SectionHeadline = {
  /** In stock: free bundles. Held: every bundle on the floor is reserved. None: nothing on the floor. */
  state: "inStock" | "held" | "none";
  tone: "green" | "blue" | "neutral";
  bundles: number;
  weightG: number;
  /** Held bundles, shown beside the in-stock count. */
  held: number;
};

/**
 * What a section's block (Sections) and hero (its own page) show: the
 * in-stock count in green; the held count in blue when every bundle is held;
 * neutral when nothing is on the floor. Status is the colour, so a green
 * "0 in stock" never appears.
 */
export function sectionHeadline(s: SectionStock | undefined): SectionHeadline {
  if (s && s.available.bundles > 0) {
    return { state: "inStock", tone: "green", bundles: s.available.bundles, weightG: s.available.weightG, held: s.held.bundles };
  }
  if (s && s.held.bundles > 0) {
    return { state: "held", tone: "blue", bundles: s.held.bundles, weightG: s.held.weightG, held: s.held.bundles };
  }
  return { state: "none", tone: "neutral", bundles: 0, weightG: 0, held: 0 };
}
