/**
 * What `/stock/$dieId` puts in its header. The die normally names the
 * section, but a die deleted while bundles are still on the floor (the server
 * allows it, and a deleted die can't be restored) must not hide its stock:
 * Sections still shows its block, so the page falls back to the stock
 * summary row, then to the die's own bundles. "Not found" only when there is
 * no die, no stock and no bundle at all.
 */
import { sectionLabel, type SectionStock } from "./sections";

/** The `die.get` fields the header uses. */
export type SectionDie = { series: string; sectionCode: string; name: string | null; weightMinG: number; weightMaxG: number };

export type SectionHeader = {
  label: string;
  name: string | null;
  /** The die's band, grams per 12 ft (0 when unknown). */
  weightMinG: number;
  weightMaxG: number;
  /** The die has its own page to link to ("Die details"). */
  dieListed: boolean;
};

export type SectionPageState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "notFound" }
  | { kind: "ready"; header: SectionHeader };

export function resolveSectionPage(input: {
  /** undefined while loading (or after a failed load), null when the company has no live die with this id. */
  die: SectionDie | null | undefined;
  dieFailed: boolean;
  /** This die's row in the merged stock summary (available + held), if any. */
  stock: SectionStock | undefined;
  summaryReady: boolean;
  /** `listBundles({ dieId, limit: 1 })` in every status, asked only when there is neither die nor stock. */
  probe: { total: number; first?: { dieSeries: string; dieSectionCode: string } } | undefined;
}): SectionPageState {
  const { die, dieFailed, stock, summaryReady, probe } = input;
  if (die) {
    return {
      kind: "ready",
      header: { label: sectionLabel(die), name: die.name, weightMinG: die.weightMinG, weightMaxG: die.weightMaxG, dieListed: true },
    };
  }
  const fromStock = (dieListed: boolean): SectionPageState => ({
    kind: "ready",
    header: {
      label: sectionLabel(stock!),
      name: stock!.name,
      weightMinG: stock!.weightMinG,
      weightMaxG: stock!.weightMaxG,
      dieListed,
    },
  });
  if (die === undefined) {
    if (!dieFailed) return { kind: "loading" };
    // The die didn't load (connection): the summary still names the section; its die page may well work.
    return stock ? fromStock(true) : { kind: "error" };
  }
  if (stock) return fromStock(false);
  if (!summaryReady || !probe) return { kind: "loading" };
  if (probe.total > 0 && probe.first) {
    return {
      kind: "ready",
      header: {
        label: sectionLabel({ series: probe.first.dieSeries, sectionCode: probe.first.dieSectionCode }),
        name: null,
        weightMinG: 0,
        weightMaxG: 0,
        dieListed: false,
      },
    };
  }
  return { kind: "notFound" };
}

/**
 * Show a load error only when there is nothing to show. React Query v5 keeps
 * `data` when a background refetch fails, so stock already on screen stays.
 */
export function failedWithoutData(q: { isError: boolean; data: unknown }): boolean {
  return q.isError && q.data === undefined;
}
