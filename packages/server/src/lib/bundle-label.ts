import type { bundle, bundleGroup } from "@orrn/db/schema/inventory";
import type { die } from "@orrn/db/schema/catalog";

export type BundleLabelLayout = `x${number}`;

export type BundleLabelVariables = {
  length: string;
  poNumber: string;
  quantity: string;
  serialNumber: string;
  seriesName: string;
  uuid: string;
  weight: string;
  weight12ft: string;
  weight_each: string;
  layout: string;
};

type BundleRow = typeof bundle.$inferSelect;
type BundleGroupRow = typeof bundleGroup.$inferSelect;
type DieRow = typeof die.$inferSelect;

function formatUnit(value: number, unit: string): string {
  if (!Number.isFinite(value)) return unit ? `— ${unit}` : "—";
  const formatted = Number.isInteger(value)
    ? String(value)
    : value
        .toFixed(3)
        .replace(/\.0+$/, "")
        .replace(/(\.[1-9]*)0+$/, "$1");
  return unit ? `${formatted} ${unit}` : formatted;
}

function mmToInches(mm: number): number {
  return mm / 25.4;
}

function labelLength(bundleRow: BundleRow, groupRow: BundleGroupRow): { value: number; unit: string } {
  const unit = groupRow.unit || "mm";
  if (unit === "inch" || unit === "in") {
    return { value: mmToInches(bundleRow.lengthMm), unit: "inch" };
  }
  return { value: bundleRow.lengthMm, unit };
}

export function buildBundleLabelVariables({
  bundleRow,
  groupRow,
  dieRow,
  layout,
}: {
  bundleRow: BundleRow;
  groupRow: BundleGroupRow;
  dieRow: DieRow | null;
  layout: string;
}): BundleLabelVariables {
  const { value: lengthValue, unit: lengthUnit } = labelLength(bundleRow, groupRow);
  const weightKg = bundleRow.weightG / 1000;
  const quantity = bundleRow.quantity;
  const weightEach = quantity > 0 ? weightKg / quantity : Number.NaN;
  const lengthIn = mmToInches(bundleRow.lengthMm);
  const weight12ft = quantity > 0 && lengthIn > 0 ? (weightKg / quantity / lengthIn) * 12 : Number.NaN;
  const bundlePo = "poNumber" in bundleRow ? bundleRow.poNumber : null;

  return {
    length: formatUnit(lengthValue, lengthUnit),
    poNumber: bundlePo || groupRow.purchaseOrderRef || "",
    quantity: String(quantity),
    serialNumber: bundleRow.serial,
    seriesName: dieRow?.series ?? "",
    uuid: bundleRow.id,
    weight: formatUnit(weightKg, "kg"),
    weight12ft: formatUnit(weight12ft, "kg/12ft"),
    weight_each: formatUnit(weightEach, ""),
    layout,
  };
}
