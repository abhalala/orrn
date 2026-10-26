/**
 * Turns a picked file into header → text rows for `parseImport`. CSV goes
 * through papaparse and Excel through xlsx, both loaded only when a file is
 * read (`await import`, never in the entry chunk). Every cell comes out as
 * text; numbers are not interpreted here.
 *
 * Row numbers follow the sheet the person has open: blank rows in the middle
 * are kept (the parser skips them) and `firstDataRow` says which sheet row the
 * first data row is, so "Row 7" in orrn is row 7 in Excel.
 */
export type SheetRows = { rows: Record<string, string>[]; firstDataRow: number };

export type FileKind = "csv" | "excel";

export const ACCEPT = ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel";

export function fileKind(name: string): FileKind | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "csv") return "csv";
  if (ext === "xlsx" || ext === "xls") return "excel";
  return null;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

function isBlankRow(row: readonly unknown[] | undefined): boolean {
  return !row || row.every((cell) => cellText(cell).trim() === "");
}

/** Header names: trimmed, BOM removed, blanks dropped, repeats numbered ("Name 2") so no column is lost. */
function headerNames(raw: readonly unknown[]): (string | null)[] {
  const seen = new Map<string, number>();
  return raw.map((cell) => {
    const name = cellText(cell).replace(/^﻿/, "").trim();
    if (name === "") return null;
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} ${count}`;
  });
}

/**
 * Rows from a cell matrix (first non-blank row is the header). `startRow` is
 * the zero-based sheet row of `matrix[0]` (Excel ranges can start lower).
 */
export function rowsFromMatrix(matrix: readonly (readonly unknown[])[], startRow: number): SheetRows {
  let headerIndex = 0;
  while (headerIndex < matrix.length && isBlankRow(matrix[headerIndex])) headerIndex++;
  const firstDataRow = startRow + headerIndex + 2;
  if (headerIndex >= matrix.length) return { rows: [], firstDataRow };

  const headers = headerNames(matrix[headerIndex]!);
  let end = matrix.length;
  while (end > headerIndex + 1 && isBlankRow(matrix[end - 1])) end--;

  const rows: Record<string, string>[] = [];
  for (let i = headerIndex + 1; i < end; i++) {
    const cells = matrix[i] ?? [];
    const row: Record<string, string> = {};
    headers.forEach((name, col) => {
      if (name !== null) row[name] = cellText(cells[col]);
    });
    rows.push(row);
  }
  return { rows, firstDataRow };
}

export async function readCsvText(text: string): Promise<SheetRows> {
  const Papa = (await import("papaparse")).default;
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ""), { header: false, skipEmptyLines: false });
  return rowsFromMatrix(result.data, 0);
}

async function readExcel(buffer: ArrayBuffer): Promise<SheetRows> {
  const XLSX = await import("xlsx");
  const book = XLSX.read(buffer, { type: "array" });
  const firstName = book.SheetNames[0];
  const sheet = firstName ? book.Sheets[firstName] : undefined;
  if (!sheet || !sheet["!ref"]) return { rows: [], firstDataRow: 2 };
  const start = XLSX.utils.decode_range(sheet["!ref"]).s.r;
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: true });
  return rowsFromMatrix(matrix, start);
}

export class UnsupportedFileError extends Error {}

/** Reads the first sheet of a CSV or Excel file. Throws `UnsupportedFileError` for other files. */
export async function readSheetFile(file: File): Promise<SheetRows> {
  const kind = fileKind(file.name);
  if (kind === "csv") return readCsvText(await file.text());
  if (kind === "excel") return readExcel(await file.arrayBuffer());
  throw new UnsupportedFileError(file.name);
}

/**
 * Bounds on one file (AGENTS.md: large imports are bounded). 20,000 rows is
 * 40 calls of 500; a bigger file should be split. 10 MB keeps Excel parsing
 * in the browser quick on an office PC.
 */
export const MAX_FILE_ROWS = 20_000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type FileProblem = {
  key: "imports.wrongType" | "imports.tooBig" | "imports.noRows" | "imports.tooManyRows";
  vars?: Record<string, string>;
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Number((bytes / 1024).toFixed(1))} KB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}

/** Why a picked file is refused before it is read, or null. */
export function fileProblem(file: { name: string; size: number }): FileProblem | null {
  if (!fileKind(file.name)) return { key: "imports.wrongType" };
  if (file.size > MAX_FILE_BYTES) return { key: "imports.tooBig", vars: { size: formatBytes(MAX_FILE_BYTES) } };
  return null;
}

/** Why a read sheet is refused before it is parsed, or null. */
export function rowsProblem(count: number): FileProblem | null {
  if (count === 0) return { key: "imports.noRows" };
  if (count > MAX_FILE_ROWS) {
    return {
      key: "imports.tooManyRows",
      vars: { count: count.toLocaleString("en-IN"), max: MAX_FILE_ROWS.toLocaleString("en-IN") },
    };
  }
  return null;
}
