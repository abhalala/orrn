import type { LengthUnit } from "@orrn/server/lib/length";
import { formatLengthValue } from "@orrn/server/lib/length";
import * as XLSX from "xlsx";

import type { PLSnapshot } from "./snapshot";
import { groupPlItems } from "./group";

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
  const itemRow = (item: PLSnapshot["items"][number], i: number) => [
    i + 1,
    item.bundleSerial,
    item.die.series,
    item.die.sectionCode,
    (item.groupLabel ?? item.groupId) || "",
    item.quantity,
    item.weightG,
    +(item.weightG / 1000).toFixed(3),
    formatLengthValue(item.lengthMm, lengthUnit),
  ];
  let rows: Array<Array<string | number>>;
  const netRowIndexes: number[] = [];
  if (pl.schemaVersion === 2) {
    const grouped = groupPlItems(pl.items, pl.groups);
    rows = [];
    let index = 0;
    for (const group of grouped.groups) {
      rows.push([group.label]);
      for (const item of group.items) rows.push(itemRow(item, index++));
      rows.push([`${group.label} — ${group.subtotal.bundles} BUNDLE / ${group.subtotal.weightKg.toFixed(3)} kg`]);
    }
    rows.push(["NET", "", "", "", "", grouped.net.quantity, "", grouped.net.weightKg]);
    netRowIndexes.push(rows.length);
  } else {
    rows = pl.items.map(itemRow);
  }

  const wb = XLSX.utils.book_new();

  const wsMeta = XLSX.utils.aoa_to_sheet(metaData);
  wsMeta["!cols"] = [{ wch: 20 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, wsMeta, "Summary");

  const wsItems = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  for (const rowIndex of netRowIndexes) {
    for (let column = 0; column < headers.length; column += 1) {
      const cell = wsItems[XLSX.utils.encode_cell({ r: rowIndex, c: column })];
      if (cell) cell.s = { fill: { fgColor: { rgb: "FFF3BF" } }, font: { bold: true } };
    }
  }
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
    cellStyles: true,
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
    cellStyles: true,
  }) as string;
}
