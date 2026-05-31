import type { LengthUnit } from "@orrn/server/lib/length";
import { formatLengthValue } from "@orrn/server/lib/length";
import * as XLSX from "xlsx";

import type { PLSnapshot } from "./snapshot";

function buildWorkbook(pl: PLSnapshot, code: string, lengthUnit: LengthUnit) {
  const cust = pl.dispatch.customer;
  const shipDate = pl.dispatch.shipDate
    ? new Date(pl.dispatch.shipDate).toLocaleDateString("en-IN")
    : "";
  const genDate = new Date(pl.generatedAt).toLocaleString("en-IN");

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

  const lengthLabel = lengthUnit === "inch" ? "Length (in)" : "Length (mm)";
  const headers = [
    "#",
    "Bundle Serial",
    "Die Series",
    "Die Section",
    "Group",
    "Quantity",
    "Weight (g)",
    "Weight (kg)",
    lengthLabel,
  ];
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

  const wb = XLSX.utils.book_new();

  const wsMeta = XLSX.utils.aoa_to_sheet(metaData);
  wsMeta["!cols"] = [{ wch: 20 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsMeta, "Summary");

  const wsItems = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  wsItems["!cols"] = [
    { wch: 4 },
    { wch: 16 },
    { wch: 12 },
    { wch: 14 },
    { wch: 10 },
    { wch: 10 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, wsItems, "Items");

  return wb;
}

/** Build an XLSX workbook buffer for sharing or download on any platform. */
export function buildPackingListXlsxBuffer(
  pl: PLSnapshot,
  code: string,
  lengthUnit: LengthUnit = "mm",
): Uint8Array {
  const arrayBuffer = XLSX.write(buildWorkbook(pl, code, lengthUnit), {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
  return new Uint8Array(arrayBuffer);
}

/** Base64-encoded workbook for React Native file writes. */
export function buildPackingListXlsxBase64(
  pl: PLSnapshot,
  code: string,
  lengthUnit: LengthUnit = "mm",
): string {
  return XLSX.write(buildWorkbook(pl, code, lengthUnit), {
    type: "base64",
    bookType: "xlsx",
  }) as string;
}
