/**
 * Packing list Excel export — generated client-side via SheetJS (xlsx).
 * Import lazily to avoid bloating the initial bundle.
 */
import type { LengthUnit } from "@orrn/api/lib/length";
import { formatLengthValue } from "@orrn/api/lib/length";
import type { PLSnapshot } from "./packingListPdf";

export async function downloadPackingListXlsx(pl: PLSnapshot, code: string, lengthUnit: LengthUnit = "mm") {
  // Dynamic import keeps xlsx out of the initial chunk
  const XLSX = await import("xlsx");

  const cust = pl.dispatch.customer;
  const shipDate = pl.dispatch.shipDate
    ? new Date(pl.dispatch.shipDate).toLocaleDateString("en-IN")
    : "";
  const genDate = new Date(pl.generatedAt).toLocaleString("en-IN");

  // ---- Cover / meta sheet ----
  const metaData = [
    ["Packing List", code],
    ["Company", pl.company.name],
    ["Dispatch", pl.dispatch.code],
    ["Customer", cust.name],
    ["Customer Tax ID", cust.taxId ?? ""],
    ["Customer Phone", cust.phone ?? ""],
    ["Customer Email", cust.email ?? ""],
    ["Ship Date", shipDate],
    ["Generated At", genDate],
    ["Notes", pl.dispatch.notes],
    [],
    ["Totals"],
    ["Total Bundles", pl.totals.totalBundles],
    ["Total Quantity", pl.totals.totalQuantity],
    ["Total Weight (kg)", pl.totals.totalWeightKg],
    ["Total Length", formatLengthValue(pl.totals.totalLengthM * 1000, lengthUnit)],
  ];

  // ---- Items sheet ----
  const lengthLabel = lengthUnit === "inch" ? "Length (in)" : "Length (mm)";
  const headers = ["#", "Bundle Serial", "Die Series", "Die Section", "Group", "Quantity", "Weight (g)", "Weight (kg)", lengthLabel];
  const rows = pl.items.map((item, i) => [
    i + 1,
    item.bundleSerial,
    item.die.series,
    item.die.sectionCode,
    item.groupId || "",
    item.quantity,
    item.weightG,
    +(item.weightG / 1000).toFixed(3),
    formatLengthValue(item.lengthMm, lengthUnit),
  ]);

  // ---- Workbook ----
  const wb = XLSX.utils.book_new();

  const wsMeta = XLSX.utils.aoa_to_sheet(metaData);
  wsMeta["!cols"] = [{ wch: 20 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsMeta, "Summary");

  const wsItems = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  wsItems["!cols"] = [{ wch: 4 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsItems, "Items");

  XLSX.writeFile(wb, `${code}.xlsx`);
}
