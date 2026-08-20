import type { PLSnapshot } from "./snapshot";

type PLItem = PLSnapshot["items"][number];

function itemLabel(item: PLItem): string {
  return item.groupLabel?.trim() || item.groupId?.trim() || "UNGROUPED";
}

function roundedWeight(items: readonly PLItem[]): number {
  return Number((items.reduce((sum, item) => sum + item.weightG, 0) / 1000).toFixed(3));
}

export function groupPlItems(items: PLSnapshot["items"], storedGroups?: PLSnapshot["groups"]) {
  const buckets = new Map<string, Array<{ item: PLItem; lot: number }>>();
  items.forEach((item, index) => {
    const label = itemLabel(item);
    const bucket = buckets.get(label) ?? [];
    bucket.push({ item, lot: index + 1 });
    buckets.set(label, bucket);
  });

  const order = storedGroups?.length
    ? [
        ...storedGroups.map((group) => group.label),
        ...Array.from(buckets.keys()).filter(
          (label) => !storedGroups.some((group) => group.label === label),
        ),
      ]
    : Array.from(buckets.keys());

  const groups = order.flatMap((label) => {
    const entries = buckets.get(label) ?? [];
    if (entries.length === 0) return [];
    const groupItems = entries.map(({ item }) => item);
    return [{
      label,
      items: groupItems,
      subtotal: {
        bundles: groupItems.length,
        quantity: groupItems.reduce((sum, item) => sum + item.quantity, 0),
        weightKg: roundedWeight(groupItems),
      },
      lotFrom: Math.min(...entries.map(({ lot }) => lot)),
      lotTo: Math.max(...entries.map(({ lot }) => lot)),
    }];
  });

  return {
    groups,
    net: {
      bundles: items.length,
      quantity: items.reduce((sum, item) => sum + item.quantity, 0),
      weightKg: roundedWeight(items),
    },
  };
}
