import type { BundleStatus } from "@orrn/domain";

/** One line of `dispatch.getDispatch` items. */
export type DispatchItem = {
  itemId: string;
  bundleId: string;
  serial: string;
  status: BundleStatus;
  quantity: number;
  weightG: number;
  lengthMm: number;
  /** The packing session the bundle came from. Never shown and never a group. */
  groupId: string | null;
  groupLabel: string | null;
  dieId: string;
  dieSeries: string;
  dieSectionCode: string;
  dieName?: string | null;
  /** Another dispatch holding this bundle (both listed it; that one held it first). */
  heldBy?: string | null;
  /** The sales order of the line it is linked to (FP-PK-17 names other orders on an order's load). */
  orderId?: string | null;
  orderNumber?: string | null;
};

export type ItemGroup<T extends DispatchItem = DispatchItem> = {
  key: string;
  /** The packing group label ("A") when set, else the section. */
  label: string;
  labelled: boolean;
  /** The section(s) in the group; comma separated when one label spans several. */
  dieLabel: string;
  bundles: T[];
  weightG: number;
  pieces: number;
};

/** "14701 Patti 1" × 1/8"" (code and name), else "14701 PATTI" (code and series). */
export function itemLabel(item: Pick<DispatchItem, "dieSectionCode" | "dieSeries" | "dieName">): string {
  const name = item.dieName?.trim() || item.dieSeries?.trim() || "";
  return [item.dieSectionCode?.trim(), name].filter(Boolean).join(" ");
}

const natural = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });

/**
 * Bundles of a dispatch grouped the way the packing list groups them: by
 * packing group label, else by section (die). Never by the packing session
 * (`groupId`). Labelled groups come first in label order, then sections in
 * code order, so groups never jump around while bundles are scanned in.
 * Inside a group the incoming order is kept (the server sends newest first).
 */
export function groupItems<T extends DispatchItem>(items: readonly T[]): ItemGroup<T>[] {
  const groups = new Map<string, ItemGroup<T> & { dies: Set<string> }>();
  for (const it of items) {
    const label = it.groupLabel?.trim() || null;
    const die = itemLabel(it);
    const key = label ? `label:${label}` : `die:${it.dieId}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, label: label ?? die, labelled: Boolean(label), dieLabel: "", bundles: [], weightG: 0, pieces: 0, dies: new Set() };
      groups.set(key, g);
    }
    g.bundles.push(it);
    g.weightG += it.weightG;
    g.pieces += it.quantity;
    g.dies.add(die);
  }
  return [...groups.values()]
    .sort((a, b) => (a.labelled !== b.labelled ? (a.labelled ? -1 : 1) : natural(a.label, b.label)))
    .map(({ dies, ...g }) => ({ ...g, dieLabel: [...dies].sort(natural).join(", ") }));
}

export function dispatchTotals(items: readonly Pick<DispatchItem, "weightG" | "quantity">[]) {
  let weightG = 0;
  let pieces = 0;
  for (const it of items) {
    weightG += it.weightG;
    pieces += it.quantity;
  }
  return { bundles: items.length, weightG, pieces };
}
