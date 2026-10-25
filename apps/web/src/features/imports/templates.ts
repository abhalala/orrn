/**
 * Sheets orrn hands out: the column guide and sample sheet for each import
 * (headers carry their unit, so a sample can never be misread), and the
 * "rows with problems" / "rows not saved" downloads built from the person's
 * own rows so they can fix them in Excel and import again.
 */
import type { LengthUnit } from "@orrn/domain";

import { toCsv, type ImportKind, type RejectedRow } from "./parse";
import type { SheetRows } from "./read-file";

export type GuideColumn = { field: string; header: string; required: boolean };

/** The header to write in a sheet for each field. Inch companies get `Length (ft)`, which also takes `11 ft 6 in`. */
export function columnGuide(kind: ImportKind, unit: LengthUnit): GuideColumn[] {
  const length = unit === "mm" ? "Length (mm)" : "Length (ft)";
  switch (kind) {
    case "bundles":
      return [
        { field: "dieSeries", header: "Die series", required: true },
        { field: "dieSectionCode", header: "Section code", required: true },
        { field: "quantity", header: "Pieces", required: true },
        { field: "weight", header: "Weight (kg)", required: true },
        { field: "length", header: length, required: true },
        { field: "poNumber", header: "PO number", required: false },
      ];
    case "dies":
      return [
        { field: "series", header: "Series", required: true },
        { field: "sectionCode", header: "Section code", required: true },
        { field: "weightMin", header: "Min weight (kg/12ft)", required: true },
        { field: "weightMax", header: "Max weight (kg/12ft)", required: true },
        { field: "name", header: "Name", required: false },
        { field: "width", header: "Width (mm)", required: false },
        { field: "thickness", header: "Thickness (mm)", required: false },
        { field: "leg", header: "Leg (mm)", required: false },
        { field: "status", header: "Status", required: false },
        { field: "notes", header: "Notes", required: false },
      ];
    case "customers":
      return [
        { field: "name", header: "Name", required: true },
        { field: "phone", header: "Phone", required: false },
        { field: "email", header: "Email", required: false },
        { field: "taxId", header: "GSTIN", required: false },
        { field: "notes", header: "Notes", required: false },
      ];
  }
}

/** Sample rows, keyed by field, for the sample sheet. Plain values a person can overwrite. */
function sampleValues(kind: ImportKind, unit: LengthUnit): Record<string, string>[] {
  switch (kind) {
    case "bundles":
      return [
        { dieSeries: "40", dieSectionCode: "4012", quantity: "25", weight: "58.4", length: unit === "mm" ? "3658" : "12", poNumber: "PO-2611" },
        { dieSeries: "40", dieSectionCode: "4012", quantity: "20", weight: "44.9", length: unit === "mm" ? "3505" : "11 ft 6 in", poNumber: "" },
      ];
    case "dies":
      return [
        { series: "40", sectionCode: "4012", weightMin: "2.2", weightMax: "2.5", name: "Window frame", width: "44.5", thickness: "1.2", leg: "", status: "active", notes: "" },
      ];
    case "customers":
      return [{ name: "Shree Ganesh Aluminium", phone: "98250 12345", email: "accounts@example.in", taxId: "24AAACS1234A1Z5", notes: "" }];
  }
}

export function sampleCsv(kind: ImportKind, unit: LengthUnit): string {
  const guide = columnGuide(kind, unit);
  const rows = sampleValues(kind, unit).map((values) => guide.map((c) => values[c.field] ?? ""));
  return toCsv(
    guide.map((c) => c.header),
    rows,
  );
}

function sheetHeaders(sheet: SheetRows): string[] {
  const headers: string[] = [];
  for (const row of sheet.rows) for (const h of Object.keys(row)) if (!headers.includes(h)) headers.push(h);
  return headers;
}

function rawRow(sheet: SheetRows, row: number, headers: readonly string[]): string[] {
  const raw = sheet.rows[row - sheet.firstDataRow] ?? {};
  return headers.map((h) => raw[h] ?? "");
}

/** The person's own rows that had a problem, with the sheet row number first and the problem last. */
export function problemsCsv(
  sheet: SheetRows,
  rejected: readonly RejectedRow[],
  labels: { row: string; problem: string },
  describe: (r: RejectedRow) => string,
): string {
  const headers = sheetHeaders(sheet);
  const sorted = [...rejected].sort((a, b) => a.row - b.row);
  return toCsv(
    [labels.row, ...headers, labels.problem],
    sorted.map((r) => [String(r.row), ...rawRow(sheet, r.row, headers), describe(r)]),
  );
}

/** The person's own rows, unchanged, for the given sheet row numbers (rows a failed import did not save). */
export function rowsCsv(sheet: SheetRows, rowNumbers: readonly number[]): string {
  const headers = sheetHeaders(sheet);
  return toCsv(
    headers,
    rowNumbers.map((n) => rawRow(sheet, n, headers)),
  );
}

/** The CSV as a file body. The BOM makes Excel read Hindi text as UTF-8. */
export function csvBlob(csv: string): Blob {
  return new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
}

/** Saves a CSV to the device (with the BOM, see `csvBlob`). */
export function downloadCsv(filename: string, csv: string) {
  const blob = csvBlob(csv);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
