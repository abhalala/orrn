import type { LengthUnit } from "@orrn/server/lib/length";
import { formatLengthValue } from "@orrn/server/lib/length";
import * as XLSX from "xlsx";

import { bundlesText, isPlSnapshotV2, PL_COLUMN_HEADINGS, plGroupTitle, plShipDateText, type PLSnapshot } from "./snapshot";

/** v2: one "Packing list" sheet — header block, the 11 columns, group titles, subtotals, total. */
function buildWorkbookV2(pl: PLSnapshot & { header: NonNullable<PLSnapshot["header"]>; groups: NonNullable<PLSnapshot["groups"]>; summary: NonNullable<PLSnapshot["summary"]> }) {
  const h = pl.header;
  const aoa: (string | number | null)[][] = [
    ["Packing list", h.plNumber],
    ["Date", h.date],
    ["From", h.company.legalName ?? h.company.name],
    ["From GSTIN", h.company.gstin ?? ""],
    ["From address", h.company.address ?? ""],
    ["Bill to", h.billTo.name],
    ["Bill to GSTIN", h.billTo.gstin ?? ""],
    ["Bill to address", h.billTo.address ?? ""],
    ["Ship to", h.shipTo.name],
    ["Ship to GSTIN", h.shipTo.gstin ?? ""],
    ["Ship to address", h.shipTo.address ?? ""],
    ["Vehicle", h.vehicleNo ?? ""],
    ["Driver", [h.driverName, h.driverPhone].filter(Boolean).join(" · ")],
    ["Transporter", h.transporter ?? ""],
    ["PO numbers", h.poNumbers.join(", ")],
    ["Invoice", [h.invoiceNumber, h.invoiceDate].filter(Boolean).join(" · ")],
    ["Dispatch", h.dispatchCode],
    ["Ship date", plShipDateText(pl.dispatch.shipDate) ?? ""],
    ["Notes", pl.dispatch.notes ?? ""],
    [],
    [...PL_COLUMN_HEADINGS],
  ];
  for (const g of pl.groups) {
    aoa.push([plGroupTitle(g, pl.groups)]);
    for (const r of g.rows) {
      aoa.push([
        r.sr,
        r.bundleNo,
        r.section,
        r.item,
        +(r.weightG / 1000).toFixed(3),
        r.cutFt,
        r.cutIn,
        r.pcs,
        r.kgPer12ftMilli == null ? null : +(r.kgPer12ftMilli / 1000).toFixed(3),
        r.range12ft,
        r.po ?? "",
      ]);
    }
    aoa.push([null, bundlesText(g.subtotal.bundles), null, null, +(g.subtotal.weightG / 1000).toFixed(3), null, null, g.subtotal.pcs]);
  }
  aoa.push([]);
  aoa.push([null, bundlesText(pl.summary.bundles), null, null, +(pl.summary.weightG / 1000).toFixed(3), null, null, pl.summary.pcs]);
  aoa.push([null, pl.summary.text]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 16 }, { wch: 22 }, { wch: 10 }, { wch: 22 }, { wch: 11 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 9 }, { wch: 10 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, "Packing list");
  return wb;
}

function buildWorkbook(pl: PLSnapshot, code: string, lengthUnit: LengthUnit) {
  if (isPlSnapshotV2(pl)) return buildWorkbookV2(pl);
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
