import { defaultGroupLabel, type PackingGroupKey } from "@orrn/server/lib/packing-group";
import { formatWeightRange12ft, kgPer12ft, mmToFeet } from "@orrn/server/lib/weight-range";

import { groupPlItems } from "./group";
import type { PLSnapshot } from "./snapshot";

export type LivePackingListItem = {
  bundleId: string;
  serial: string;
  quantity: number;
  weightG: number;
  lengthMm: number;
  groupLabel?: string | null;
  dieSeries: string;
  dieSectionCode: string;
  dieName?: string | null;
  poNumber?: string | null;
  createdAt?: Date | string | null;
  addedAt: Date | string;
};

export function buildLiveSnapshot(input: {
  company: { id: string; name: string };
  customer: PLSnapshot["dispatch"]["customer"];
  dispatch: {
    code: string;
    shipDate: Date | string | null;
    invoiceNo?: string | null;
    notes?: string | null;
    status: string;
    completedAt?: Date | string | null;
  };
  items: LivePackingListItem[];
  packingGroupKey: PackingGroupKey;
}): PLSnapshot {
  const mapped = input.items.map((item) => {
    const ratio = kgPer12ft(item.weightG, item.quantity, item.lengthMm);
    const label = item.groupLabel?.trim() || defaultGroupLabel(
      { sectionCode: item.dieSectionCode, name: item.dieName },
      item,
      input.packingGroupKey,
    ) || "UNGROUPED";
    return {
      bundleSerial: item.serial,
      die: { series: item.dieSeries, sectionCode: item.dieSectionCode, name: item.dieName },
      groupId: label,
      groupLabel: label,
      quantity: item.quantity,
      weightG: item.weightG,
      lengthMm: item.lengthMm,
      uid: item.bundleId,
      poNumber: item.poNumber,
      kgPer12ft: ratio,
      kgPerCut: item.quantity > 0 ? item.weightG / 1000 / item.quantity : null,
      weightRange: formatWeightRange12ft(ratio ?? Number.NaN),
      lengthFt: mmToFeet(item.lengthMm),
      packedAt: item.createdAt ? new Date(item.createdAt).toISOString() : null,
      addedAt: new Date(item.addedAt).getTime(),
    };
  });
  const firstSeen = new Map<string, number>();
  for (const item of mapped) {
    firstSeen.set(item.groupLabel, Math.min(firstSeen.get(item.groupLabel) ?? Infinity, item.addedAt));
  }
  mapped.sort((a, b) =>
    (firstSeen.get(a.groupLabel)! - firstSeen.get(b.groupLabel)!) ||
    (a.addedAt - b.addedAt) || a.bundleSerial.localeCompare(b.bundleSerial));
  const items = mapped.map(({ addedAt: _addedAt, ...item }) => item);
  const grouped = groupPlItems(items);
  return {
    schemaVersion: 2,
    packingGroupKey: input.packingGroupKey,
    packingListLayout: "orrn",
    dispatch: {
      code: input.dispatch.code,
      customer: input.customer,
      shipDate: input.dispatch.shipDate ? new Date(input.dispatch.shipDate).toISOString() : null,
      invoiceNo: input.dispatch.invoiceNo ?? null,
      notes: input.dispatch.notes ?? "",
      completedAt: input.dispatch.completedAt ? new Date(input.dispatch.completedAt).toISOString() : null,
    },
    company: input.company,
    items,
    groups: grouped.groups.map((group) => ({
      label: group.label,
      firstSeenAt: new Date(firstSeen.get(group.label) ?? Date.now()).toISOString(),
      bundleCount: group.subtotal.bundles,
      quantity: group.subtotal.quantity,
      weightKg: group.subtotal.weightKg,
      lotFrom: group.lotFrom,
      lotTo: group.lotTo,
    })),
    totals: {
      totalBundles: grouped.net.bundles,
      totalQuantity: grouped.net.quantity,
      totalWeightKg: grouped.net.weightKg,
      totalLengthM: Number((items.reduce((sum, item) => sum + item.lengthMm, 0) / 1000).toFixed(3)),
    },
    generatedAt: new Date().toISOString(),
  };
}
