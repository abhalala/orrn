import { naturalCompare } from "../../lib/format";

/** The fields of a `dispatch.getDispatch` item this module reads. */
export type DispatchItemLike = {
  itemId: string;
  bundleId: string;
  serial: string;
  status: string;
  quantity: number;
  weightG: number;
  lengthMm: number;
  groupLabel: string | null;
  dieId: string;
  dieSeries: string;
  dieSectionCode: string;
};

export type ItemGroup<T extends DispatchItemLike> = {
  key: string;
  /** The packing group label, else "section name". */
  label: string;
  /** True when a person typed this label (these groups list first). */
  labelled: boolean;
  bundles: T[];
  weightG: number;
  pieces: number;
};

/** "14701 Patti 1", else "14701 PATTI": the section code plus its name, else its series. */
export function itemLabel(die: { dieSectionCode: string; dieSeries: string; dieName?: string | null }): string {
  const name = die.dieName?.trim();
  return `${die.dieSectionCode} ${name ? name : die.dieSeries}`;
}

/** A void bundle is not part of what ships: never counted, never listed. */
const counts = (item: { status: string }) => item.status !== "void";

/**
 * Items grouped like the printed packing list: groups a person labelled come
 * first (by label), then one group per section in natural order, each with
 * its bundle count's kg and pieces. Bundles inside a group sort in packing
 * order (26J2 before 26J10).
 */
export function groupItems<T extends DispatchItemLike>(items: readonly T[]): ItemGroup<T>[] {
  const groups = new Map<string, ItemGroup<T>>();
  for (const item of items.filter(counts)) {
    const label = item.groupLabel?.trim();
    const key = label ? `label:${label}` : `die:${item.dieId}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, label: label || itemLabel(item), labelled: !!label, bundles: [], weightG: 0, pieces: 0 };
      groups.set(key, group);
    }
    group.bundles.push(item);
    group.weightG += item.weightG;
    group.pieces += item.quantity;
  }
  const out = [...groups.values()];
  for (const g of out) g.bundles.sort((a, b) => naturalCompare(a.serial, b.serial));
  return out.sort((a, b) => {
    if (a.labelled !== b.labelled) return a.labelled ? -1 : 1;
    if (a.labelled) return naturalCompare(a.label, b.label);
    return naturalCompare(a.bundles[0]!.dieSectionCode, b.bundles[0]!.dieSectionCode) || naturalCompare(a.label, b.label);
  });
}

export type DispatchTotals = { bundles: number; weightG: number; pieces: number };

export function dispatchTotals(items: readonly Pick<DispatchItemLike, "status" | "weightG" | "quantity">[]): DispatchTotals {
  const live = items.filter(counts);
  return {
    bundles: live.length,
    weightG: live.reduce((sum, i) => sum + i.weightG, 0),
    pieces: live.reduce((sum, i) => sum + i.quantity, 0),
  };
}
