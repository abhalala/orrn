import type { LengthUnit } from "@orrn/server/lib/length";
import * as XLSX from "xlsx";

import { packingListModel, type PackingListModelOptions } from "./rows";
import {
  bundlesText as plBundlesText,
  isPlSnapshotV2,
  PL_COLUMN_HEADINGS,
  plExtraColumns,
  plGroupTitle,
  plProfileLines,
  plRevisionText,
  plRowExtras,
  plDispatchCodesText,
  plSectionSubtotalAfter,
  plShipDateText,
  type PlSnapshotV2,
} from "./snapshot";
import type { PackingListSnapshot } from "./types";

/** A parsed snapshot that also carries the PL-8 v2 blocks (header, groups, summary). */
type V2Snapshot = PackingListSnapshot & { header: PlSnapshotV2["header"]; groups: PlSnapshotV2["groups"]; summary: PlSnapshotV2["summary"] };

/**
 * The packing list as an Excel sheet that mirrors the plant's printed PL: a
 * header block (company, PL no, dispatch, customer, dates, totals), then the
 * nine plant columns plus the packing group, each group closed by a subtotal
 * row and the sheet by the grand total. Weights, lengths, pieces and kg/12ft
 * are numeric cells (W17) so the office can sum and sort; dates are ISO
 * days. English only, like the plant's paper PL and the Tally invoice.
 */
export const XLSX_COLUMNS = [
  "Sr",
  "Bundle no",
  "Item",
  "Packing group",
  "Weight kg",
  "Cut length ft",
  "Cut length in",
  "Pcs",
  "kg/12ft",
  "Weight range /12'",
] as const;

const FORMATS: Partial<Record<(typeof XLSX_COLUMNS)[number], string>> = {
  "Weight kg": "0.00#",
  "kg/12ft": "0.000",
  "Weight range /12'": "0.0",
};

type Cell = string | number | null;

const bundlesText = (n: number) => `${n} ${n === 1 ? "bundle" : "bundles"}`;

/** v2: one "Packing list" sheet — header block, the 11 columns, group titles, subtotals, total. */
function buildWorkbookV2(pl: V2Snapshot) {
  const h = pl.header;
  const aoa: (string | number | null)[][] = [
    ["Packing list", plRevisionText(pl) ? `${h.plNumber} (${plRevisionText(pl)})` : h.plNumber],
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
    ["Dispatch", plDispatchCodesText(pl)],
    ["Ship date", plShipDateText(pl.dispatch.shipDate, pl.header?.shipDate) ?? ""],
    ["Notes", pl.dispatch.notes ?? ""],
    [],
  ];
  // FP-PK-13: optional Party no / Original SO columns after the 11, section subtotals, kinds.
  const extra = plExtraColumns(pl);
  aoa.push([...PL_COLUMN_HEADINGS, ...(extra.partyNo ? ["Party no"] : []), ...(extra.originalSo ? ["Original SO"] : [])]);
  const sectionAfter = plSectionSubtotalAfter(pl);
  pl.groups.forEach((g, gi) => {
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
        ...(extra.partyNo ? [plRowExtras(pl, r).partyNo] : []),
        ...(extra.originalSo ? [plRowExtras(pl, r).originalSo] : []),
      ]);
    }
    aoa.push([null, plBundlesText(g.subtotal.bundles), null, null, +(g.subtotal.weightG / 1000).toFixed(3), null, null, g.subtotal.pcs]);
    const sec = sectionAfter.get(gi);
    if (sec) aoa.push([null, plBundlesText(sec.bundles), `Section ${sec.sectionCode}`, null, +(sec.weightG / 1000).toFixed(3), null, null, sec.pcs]);
  });
  aoa.push([]);
  for (const line of plProfileLines(pl)) aoa.push([null, line]);
  aoa.push([null, plBundlesText(pl.summary.bundles), null, null, +(pl.summary.weightG / 1000).toFixed(3), null, null, pl.summary.pcs]);
  aoa.push([null, pl.summary.text]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 16 }, { wch: 22 }, { wch: 10 }, { wch: 22 }, { wch: 11 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 9 }, { wch: 10 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, "Packing list");
  return wb;
}

function buildWorkbook(pl: PackingListSnapshot, code: string, opts: PackingListModelOptions = {}) {
  if (isPlSnapshotV2(pl)) return buildWorkbookV2(pl);
  const { header, groups, totals } = packingListModel(pl, opts);

  const meta: Cell[][] = [
    [header.companyName],
    ["Packing list", code],
    ["Dispatch", header.dispatchCode],
    ["Customer", header.customerName],
    ...(header.customerTaxId ? [["GSTIN", header.customerTaxId]] : []),
    ["Date", header.date ?? ""],
    ["Ship date", header.shipDate ?? ""],
    ["Bundles", totals.bundles],
    ["Total kg", totals.weightKg],
    ...(header.notes ? [["Notes", header.notes]] : []),
    [],
  ];

  const body: Cell[][] = [];
  for (const g of groups) {
    for (const r of g.rows) {
      body.push([
        r.sr,
        r.bundleNo,
        r.item,
        g.label,
        r.weightKg,
        r.cutLengthFt,
        r.cutLengthIn,
        r.pcs,
        r.kgPer12ft,
        r.weightRange12ft,
      ]);
    }
    body.push([null, bundlesText(g.bundles), `Total ${g.label}`, null, g.weightKg, null, null, g.pieces, null, null]);
  }
  body.push([null, bundlesText(totals.bundles), "Total", null, totals.weightKg, null, null, totals.pieces, null, null]);

  const ws = XLSX.utils.aoa_to_sheet([...meta, [...XLSX_COLUMNS], ...body]);

  // Number formats on the numeric cells of every body row.
  const first = meta.length + 1;
  body.forEach((_, i) => {
    XLSX_COLUMNS.forEach((name, c) => {
      const z = FORMATS[name];
      if (!z) return;
      const cell = ws[XLSX.utils.encode_cell({ r: first + i, c })] as XLSX.CellObject | undefined;
      if (cell && cell.t === "n") cell.z = z;
    });
  });
  const totalKgCell = ws[XLSX.utils.encode_cell({ r: meta.findIndex((m) => m[0] === "Total kg"), c: 1 })] as
    | XLSX.CellObject
    | undefined;
  if (totalKgCell) totalKgCell.z = "#,##0.00#";

  ws["!cols"] = [
    { wch: 5 },
    { wch: 14 },
    { wch: 30 },
    { wch: 16 },
    { wch: 11 },
    { wch: 13 },
    { wch: 13 },
    { wch: 6 },
    { wch: 9 },
    { wch: 17 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Packing list");
  return wb;
}

/**
 * An XLSX workbook for download (web) or sharing. `lengthUnit` is accepted
 * for older callers and ignored: the plant's PL always shows feet and inches.
 */
export function buildPackingListXlsxBuffer(
  pl: PackingListSnapshot,
  code: string,
  _lengthUnit?: LengthUnit,
  opts: PackingListModelOptions = {},
): Uint8Array {
  const arrayBuffer = XLSX.write(buildWorkbook(pl, code, opts), {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
  return new Uint8Array(arrayBuffer);
}

/** Base64-encoded workbook for React Native file writes. */
export function buildPackingListXlsxBase64(
  pl: PackingListSnapshot,
  code: string,
  _lengthUnit?: LengthUnit,
  opts: PackingListModelOptions = {},
): string {
  return XLSX.write(buildWorkbook(pl, code, opts), {
    type: "base64",
    bookType: "xlsx",
  }) as string;
}
