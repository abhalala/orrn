import { kgPer12ft } from "@orrn/domain";
import type { bundle, bundleGroup } from "@orrn/db/schema/inventory";
import type { die } from "@orrn/db/schema/catalog";

export type BundleLabelLayout = `x${number}`;

/** Template variables; the full list (this plus `PackLabelVariables`) is frozen as `LABEL_VARIABLES` in @orrn/domain (BACKLOG 54: no `uuid`). */
export type BundleLabelVariables = {
  length: string;
  poNumber: string;
  quantity: string;
  serialNumber: string;
  seriesName: string;
  weight: string;
  weight12ft: string;
  weight_each: string;
  layout: string;
  /**
   * Cast number the bundle was packed from (`K31`), "" when the bundle has no cast. Templates print
   * it with the `{{cast}}` placeholder (FD hardware table: "spool template must print cast").
   */
  cast: string;
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

/**
 * Pack label variables (FP-PK-04/05), merged over `buildBundleLabelVariables` by the print call.
 * Names are the template placeholders: `{{qr}}` the label QR address (`/b/{serial}?c={slug}`),
 * `{{cast}}` the cast number (same name and meaning as W1-SPOOL's), `{{salesOrder}}` the order the
 * bundle was packed for (`SO-12/1`), `{{standard}}` / `{{cml}}` the BIS pair snapshotted at pack,
 * `{{partyNo}}` the customer's own bundle number (else the serial), `{{showLogo}}` "1"/"0" (a
 * template hides its logo block on "0"). Every value is a string, "" when absent, never undefined.
 */
export type PackLabelVariables = {
  qr: string;
  cast: string;
  salesOrder: string;
  standard: string;
  cml: string;
  partyNo: string;
  showLogo: string;
};

export function buildPackLabelVariables(input: {
  bundleRow: Pick<BundleRow, "serial" | "partyNo" | "bisStandard" | "cmlNo" | "showLogo">;
  qrUrl: string;
  castNumber?: string | null;
  /** The packed-for order line as printed: `SO-12/1`. */
  salesOrderCode?: string | null;
}): PackLabelVariables {
  const b = input.bundleRow;
  return {
    qr: input.qrUrl,
    cast: input.castNumber ?? "",
    salesOrder: input.salesOrderCode ?? "",
    standard: b.bisStandard ?? "",
    cml: b.cmlNo ?? "",
    partyNo: b.partyNo ?? b.serial,
    showLogo: b.showLogo === false ? "0" : "1",
  };
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
  castRow = null,
}: {
  bundleRow: BundleRow;
  groupRow: BundleGroupRow;
  dieRow: DieRow | null;
  layout: string;
  /** The bundle's cast, looked up in the same company by the caller; null when none. */
  castRow?: { number: string } | null;
}): BundleLabelVariables {
  const { value: lengthValue, unit: lengthUnit } = labelLength(bundleRow, groupRow);
  const weightKg = bundleRow.weightG / 1000;
  const quantity = bundleRow.quantity;
  const weightEach = quantity > 0 ? weightKg / quantity : Number.NaN;
  const weight12ft =
    kgPer12ft({ weightG: bundleRow.weightG, pieces: quantity, lengthMm: bundleRow.lengthMm }) ?? Number.NaN;
  const bundlePo = "poNumber" in bundleRow ? bundleRow.poNumber : null;

  return {
    length: formatUnit(lengthValue, lengthUnit),
    poNumber: bundlePo || groupRow.purchaseOrderRef || "",
    quantity: String(quantity),
    serialNumber: bundleRow.serial,
    seriesName: dieRow?.series ?? "",
    weight: formatUnit(weightKg, "kg"),
    weight12ft: formatUnit(weight12ft, "kg/12ft"),
    weight_each: formatUnit(weightEach, ""),
    layout,
    cast: castRow?.number ?? "",
  };
}
