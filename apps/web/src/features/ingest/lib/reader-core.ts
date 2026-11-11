import { clipCell, DEFAULT_LIMITS, WIRE_CELL_MAX_CHARS } from "./limits";
import type { EngineBlock, PdfItem, ReaderEngine } from "./reader-engine";
import type { ReadBlock, ReadFailure, ReadProgress } from "./reader-protocol";
import type { ArtifactKind, BlockInput } from "./types";

/**
 * Reading a file into blocks (plan A1, A4). Pure of the browser: the libraries (xlsx, papaparse, pdfjs) and the
 * engine come in as arguments, so the worker passes the real ones and the tests small fakes.
 */

export type ReadLimits = { maxRawRows: number; maxColumns: number; maxBlocks: number; maxRowsPerBlock: number };

export const READ_LIMITS: ReadLimits = {
  maxRawRows: DEFAULT_LIMITS.rawRowsPerFile,
  maxColumns: DEFAULT_LIMITS.columnsPerBlock,
  maxBlocks: DEFAULT_LIMITS.blocksPerFile,
  maxRowsPerBlock: DEFAULT_LIMITS.stagedRowsPerBlock,
};

export class ReadStop extends Error {
  constructor(readonly failure: ReadFailure) {
    super(failure.code);
  }
}

export type Progress = (p: ReadProgress) => void;

/** Rows in the sample: the first 100 and 100 spread over the rest (plan B3), 200 at most. */
export function sampleRows(rows: readonly string[][], first = 100, spread = 100): string[][] {
  if (rows.length <= first + spread) return rows.map((r) => r.slice());
  const out = rows.slice(0, first).map((r) => r.slice());
  const rest = rows.length - first;
  for (let i = 0; i < spread; i += 1) out.push(rows[first + Math.floor(((i + 0.5) * rest) / spread)]!.slice());
  return out;
}

/** Text of a cell, as the existing import reader does: no number formatting, dates as `YYYY-MM-DD`. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** The parts of the `xlsx` module the reader uses. */
export type XlsxLike = {
  read(
    data: ArrayBuffer,
    opts: { type: "array"; cellNF: boolean },
  ): { SheetNames: string[]; Sheets: Record<string, XlsxSheet>; Workbook?: { WBProps?: { date1904?: boolean } } };
  utils: {
    decode_range(ref: string): { s: { r: number; c: number }; e: { r: number; c: number } };
    decode_cell(address: string): { r: number; c: number };
    encode_cell(cell: { r: number; c: number }): string;
  };
  SSF: {
    parse_date_code(serial: number, opts?: { date1904?: boolean }): { y: number; m: number; d: number; H?: number; M?: number } | null;
    is_date(format: string): boolean;
  };
};
export type XlsxCell = { t?: string; v?: unknown; w?: string; z?: string | number };
export type XlsxSheet = Record<string, unknown> & { "!ref"?: string };

export type MatrixOptions = {
  /** The workbook counts days from 1904 (`Workbook.WBProps.date1904`). */
  date1904?: boolean;
  /** Real cells past these stop the read before any matrix is built. */
  maxRows?: number;
  maxColumns?: number;
};

const ZERO_PAD = /^0+$/;

/**
 * A sheet as a matrix of text, plus the columns that hold real Excel date cells.
 * - The extent comes from the cells that hold something, never from the declared `!ref`, which formatting can
 *   stretch to the last row of the sheet.
 * - Date cells become `YYYY-MM-DD` from the serial number (in the workbook's date system), with no time zone in the
 *   way. A time-only cell becomes `HH:mm` and is not a date. A date with a time keeps its day.
 * - An error cell (`#N/A`) keeps its visible text; its numeric code is never a value.
 * - A whole number shown with leading zeros (format `0000`) keeps them. Other numbers stay as stored.
 */
export function matrixFromSheet(X: XlsxLike, sheet: XlsxSheet, opts: MatrixOptions = {}): { matrix: string[][]; dateColumns: number[] } {
  const ref = sheet["!ref"];
  if (!ref) return { matrix: [], dateColumns: [] };
  const declared = X.utils.decode_range(ref);

  // One pass over the sheet's own cells: the extent of what is really filled.
  let minR = Infinity;
  let minC = Infinity;
  let maxR = -1;
  let maxC = -1;
  for (const key of Object.keys(sheet)) {
    if (key.charCodeAt(0) === 33) continue; // "!"
    const cell = sheet[key] as XlsxCell | undefined;
    if (!cell || cell.v === undefined || cell.v === null || cell.v === "") continue;
    const at = X.utils.decode_cell(key);
    if (at.r < minR) minR = at.r;
    if (at.r > maxR) maxR = at.r;
    if (at.c < minC) minC = at.c;
    if (at.c > maxC) maxC = at.c;
  }
  if (maxR < 0) return { matrix: [], dateColumns: [] };
  const r0 = Math.min(declared.s.r, minR);
  const c0 = Math.min(declared.s.c, minC);
  const rows = maxR - r0 + 1;
  const columns = maxC - c0 + 1;
  if (opts.maxRows !== undefined && rows > opts.maxRows) throw new ReadStop({ code: "too_many_rows", rows });
  if (opts.maxColumns !== undefined && columns > opts.maxColumns) throw new ReadStop({ code: "too_many_columns", sheet: null, columns });

  const matrix: string[][] = [];
  const dateCounts = new Map<number, { dates: number; filled: number }>();
  for (let r = r0; r <= maxR; r += 1) {
    const row: string[] = [];
    for (let c = c0; c <= maxC; c += 1) {
      const cell = sheet[X.utils.encode_cell({ r, c })] as XlsxCell | undefined;
      let text = "";
      if (cell && cell.v !== undefined && cell.v !== null) {
        const col = c - c0;
        const counts = dateCounts.get(col) ?? { dates: 0, filled: 0 };
        counts.filled += 1;
        if (cell.t === "e") {
          text = typeof cell.w === "string" && cell.w !== "" ? cell.w : "#ERROR";
        } else if (cell.t === "n" && typeof cell.v === "number" && typeof cell.z === "string" && X.SSF.is_date(cell.z)) {
          const wholeDays = Math.floor(cell.v);
          if (cell.v > 0 && cell.v < 1) {
            // A time of day: HH:mm, and not a date.
            const minutes = Math.round(cell.v * 24 * 60);
            text = `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
          } else {
            const d = X.SSF.parse_date_code(cell.v, { date1904: opts.date1904 === true });
            if (d && d.d > 0 && d.m > 0 && wholeDays >= 1) {
              text = `${pad(d.y, 4)}-${pad(d.m)}-${pad(d.d)}`;
              counts.dates += 1;
            } else text = typeof cell.w === "string" && cell.w !== "" ? cell.w : cellText(cell.v);
          }
        } else if (cell.t === "d" && cell.v instanceof Date) {
          text = cellText(cell.v);
          counts.dates += 1;
        } else if (cell.t === "n" && typeof cell.v === "number" && typeof cell.z === "string" && ZERO_PAD.test(cell.z) && Number.isInteger(cell.v) && cell.v >= 0) {
          text = String(cell.v).padStart(cell.z.length, "0");
        } else text = cellText(cell.v);
        dateCounts.set(col, counts);
      }
      row.push(text);
    }
    matrix.push(row);
  }
  const dateColumns = [...dateCounts.entries()]
    .filter(([, n]) => n.filled > 0 && n.dates / n.filled >= 0.5)
    .map(([col]) => col)
    .sort((a, b) => a - b);
  return { matrix, dateColumns };
}

type Piece = { sheetName: string | null; block: EngineBlock; dateColumns?: number[] };

/**
 * Turns the engine's tables into `ReadBlock`s. Cells are cut at 200 characters, a block over 50,000 rows is
 * split into parts with the same headers (each part is its own candidate, numbered in order), columns above
 * 200 and blocks above 50 stop the read.
 */
export function finishBlocks(pieces: readonly Piece[], limits: ReadLimits = READ_LIMITS): ReadBlock[] {
  const out: ReadBlock[] = [];
  for (const { sheetName, block, dateColumns } of pieces) {
    // A plain loop: spreading 150,000 rows into one call throws in V8 and Safari.
    let columns = block.headers.length;
    for (const r of block.rows) if (r.length > columns) columns = r.length;
    if (columns > limits.maxColumns) throw new ReadStop({ code: "too_many_columns", sheet: sheetName, columns });
    // The server cuts cells at 200 characters and records why; the browser only keeps the wire cap.
    const headers = block.headers.map((h) => clipCell(h, WIRE_CELL_MAX_CHARS).text);
    const rows = block.rows.map((r) => r.map((c) => clipCell(c, WIRE_CELL_MAX_CHARS).text));
    const parts = Math.max(1, Math.ceil(rows.length / limits.maxRowsPerBlock));
    for (let part = 0; part < parts; part += 1) {
      const slice = parts === 1 ? rows : rows.slice(part * limits.maxRowsPerBlock, (part + 1) * limits.maxRowsPerBlock);
      const base = block.title ?? sheetName;
      const title = parts === 1 ? block.title : `${base ?? ""} (${part + 1}/${parts})`.trim();
      const input: BlockInput = {
        ordinal: out.length,
        sheetName,
        title,
        headerRow: block.headerRow,
        headerRows: block.headerRows,
        headers,
        rowCount: slice.length,
        sample: sampleRows(slice),
        ...(dateColumns && dateColumns.length > 0 ? { dateColumns: dateColumns.filter((c) => c < headers.length) } : {}),
      };
      out.push({ input, rows: slice });
      if (out.length > limits.maxBlocks) throw new ReadStop({ code: "too_many_blocks", blocks: out.length });
    }
  }
  return out;
}

function checkRawRows(rows: number, limits: ReadLimits): void {
  if (rows > limits.maxRawRows) throw new ReadStop({ code: "too_many_rows", rows });
}

export type ReadDeps = {
  engine: ReaderEngine;
  limits?: ReadLimits;
  onProgress?: Progress;
  /** Loaded on demand, only for the kind of file being read. */
  loadXlsx?: () => Promise<XlsxLike>;
  loadPapa?: () => Promise<PapaLike>;
  loadPdf?: () => Promise<PdfLike>;
  isCancelled?: () => boolean;
};

export type PapaLike = { parse(text: string, opts: { header: false; skipEmptyLines: false }): { data: unknown[][] } };

export type PdfLike = {
  getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDocument> };
};
export type PdfDocument = {
  numPages: number;
  getPage(n: number): Promise<{
    getTextContent(): Promise<{ items: ({ str?: string; transform?: number[]; width?: number; height?: number } | object)[] }>;
  }>;
};

/** SHA-256 of the bytes, lower-case hex. */
export async function sha256OfBuffer(buffer: ArrayBuffer, subtle: Pick<SubtleCrypto, "digest"> = crypto.subtle): Promise<string> {
  const digest = new Uint8Array(await subtle.digest("SHA-256", buffer));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

function cancelled(deps: ReadDeps): void {
  if (deps.isCancelled?.()) throw new ReadStop({ code: "unreadable", detail: "cancelled" });
}

export async function readSheetBytes(buffer: ArrayBuffer, deps: ReadDeps): Promise<ReadBlock[]> {
  const limits = deps.limits ?? READ_LIMITS;
  const X = await deps.loadXlsx!();
  deps.onProgress?.({ phase: "open", sheet: null, rowsRead: 0, rowsTotal: null });
  // cellNF keeps each cell's number format, which is how a date cell is told from a plain number.
  const book = X.read(buffer, { type: "array", cellNF: true });
  const pieces: Piece[] = [];
  let rawRows = 0;
  for (const name of book.SheetNames) {
    cancelled(deps);
    const sheet = book.Sheets[name];
    if (!sheet) continue;
    const { matrix, dateColumns } = matrixFromSheet(X, sheet, {
      date1904: book.Workbook?.WBProps?.date1904 === true,
      maxRows: Math.max(0, limits.maxRawRows - rawRows),
      maxColumns: limits.maxColumns,
    });
    rawRows += matrix.length;
    checkRawRows(rawRows, limits);
    deps.onProgress?.({ phase: "sheet", sheet: name, rowsRead: matrix.length, rowsTotal: matrix.length });
    for (const block of deps.engine.blocksFromMatrix(matrix)) pieces.push({ sheetName: name, block, dateColumns });
  }
  deps.onProgress?.({ phase: "blocks", sheet: null, rowsRead: rawRows, rowsTotal: rawRows });
  return finishBlocks(pieces, limits);
}

export async function readCsvText(text: string, deps: ReadDeps, sheetName: string | null = null): Promise<ReadBlock[]> {
  const limits = deps.limits ?? READ_LIMITS;
  const Papa = await deps.loadPapa!();
  deps.onProgress?.({ phase: "open", sheet: sheetName, rowsRead: 0, rowsTotal: null });
  const parsed = Papa.parse(text.replace(/^﻿/, ""), { header: false, skipEmptyLines: false });
  const matrix = parsed.data.map((row) => (Array.isArray(row) ? row.map(cellText) : []));
  checkRawRows(matrix.length, limits);
  deps.onProgress?.({ phase: "sheet", sheet: sheetName, rowsRead: matrix.length, rowsTotal: matrix.length });
  return finishBlocks(deps.engine.blocksFromMatrix(matrix).map((block) => ({ sheetName, block })), limits);
}

/** A SQL dump read in chunks of text, so a 100 MB file never sits in one string. */
export async function readSqlChunks(chunks: AsyncIterable<string>, totalBytes: number | null, deps: ReadDeps): Promise<ReadBlock[]> {
  const limits = deps.limits ?? READ_LIMITS;
  const reader = deps.engine.createSqlReader();
  let chars = 0;
  for await (const chunk of chunks) {
    cancelled(deps);
    reader.push(chunk);
    chars += chunk.length;
    deps.onProgress?.({ phase: "table", sheet: null, rowsRead: chars, rowsTotal: totalBytes });
  }
  const tables = reader.finish();
  let rawRows = 0;
  const pieces: Piece[] = tables.map((t) => {
    rawRows += t.rows.length;
    return { sheetName: t.table, block: { title: null, headerRow: 0, headerRows: 1, headers: t.headers, rows: t.rows } };
  });
  checkRawRows(rawRows, limits);
  return finishBlocks(pieces, limits);
}

/** A text PDF: positioned items of each page go to the engine, which finds the tables. */
export async function readPdfBytes(buffer: ArrayBuffer, deps: ReadDeps): Promise<ReadBlock[]> {
  const limits = deps.limits ?? READ_LIMITS;
  const pdf = await deps.loadPdf!();
  deps.onProgress?.({ phase: "open", sheet: null, rowsRead: 0, rowsTotal: null });
  const doc = await pdf.getDocument({ data: new Uint8Array(buffer) }).promise;
  const items: PdfItem[] = [];
  let chars = 0;
  for (let n = 1; n <= doc.numPages; n += 1) {
    cancelled(deps);
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    for (const raw of content.items) {
      const it = raw as { str?: string; transform?: number[]; width?: number; height?: number };
      if (typeof it.str !== "string" || it.str.trim() === "" || !it.transform) continue;
      chars += it.str.length;
      items.push({ page: n, text: it.str, x: it.transform[4] ?? 0, y: it.transform[5] ?? 0, width: it.width ?? 0, height: it.height ?? 0 });
    }
    deps.onProgress?.({ phase: "page", sheet: null, rowsRead: n, rowsTotal: doc.numPages });
  }
  if (chars < 20) throw new ReadStop({ code: "no_text_layer" });
  const tables = deps.engine.tablesFromPdfItems(items);
  let rawRows = 0;
  const pieces: Piece[] = tables.map((t) => {
    rawRows += t.rows.length;
    return { sheetName: t.sheetName ?? null, block: { title: t.title, headerRow: 0, headerRows: 1, headers: t.headers, rows: t.rows } };
  });
  checkRawRows(rawRows, limits);
  if (pieces.length === 0) throw new ReadStop({ code: "unreadable", detail: "no table in the pdf" });
  return finishBlocks(pieces, limits);
}

/** Text chunks of a file, decoded as UTF-8, for the SQL reader. */
export async function* textChunks(file: Pick<Blob, "stream">): AsyncGenerator<string> {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

/** Reads one file of a known kind. Throws `ReadStop` with the reason when it cannot. */
export async function readFileBlocks(
  file: Pick<File, "arrayBuffer" | "text" | "stream" | "size">,
  kind: ArtifactKind,
  deps: ReadDeps,
): Promise<ReadBlock[]> {
  switch (kind) {
    case "sheet":
      return readSheetBytes(await file.arrayBuffer(), deps);
    case "csv":
      return readCsvText(await file.text(), deps);
    case "sql":
      return readSqlChunks(textChunks(file), file.size, deps);
    case "pdf_text":
    case "pdf_scan":
      return readPdfBytes(await file.arrayBuffer(), deps);
    case "image":
      throw new ReadStop({ code: "unreadable", detail: "images are read by the vision step" });
  }
}
