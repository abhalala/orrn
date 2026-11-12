import { clipCell, DEFAULT_LIMITS, WIRE_CELL_MAX_CHARS } from "./limits";
import type { EngineBlock, EngineHints, PdfItem, ReaderEngine } from "./reader-engine";
import { FACTS_MAX, type BlockMeta, type ReadBlock, type ReadFailure, type ReadProgress, type SheetHints, type WireBlockInput } from "./reader-protocol";
import type { ArtifactKind } from "./types";

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

/**
 * A number as the text a person sees when the file has no formatted text for it: a whole number as it is, any other
 * number at 15 significant digits, which is what Excel shows and removes the float noise (0.1 + 0.2 is "0.3").
 */
export function numberText(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(15)));
}

/** Text of a cell, as the existing import reader does: no number formatting, dates as `YYYY-MM-DD`. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return numberText(value);
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
export type XlsxSheet = Record<string, unknown> & { "!ref"?: string; "!merges"?: { s: { r: number; c: number }; e: { r: number; c: number } }[] };

export type MatrixOptions = {
  /** The workbook counts days from 1904 (`Workbook.WBProps.date1904`). */
  date1904?: boolean;
  /** Real cells past these stop the read before any matrix is built. */
  maxRows?: number;
  maxColumns?: number;
};

/** A merged range that runs down a column, in matrix rows and columns (row 0 is the first row of the matrix). */
export type MatrixMerge = { col: number; firstRow: number; lastRow: number };

/**
 * A sheet as a matrix of text, plus the columns that hold real Excel date cells.
 * - The extent comes from the cells that hold something, never from the declared `!ref`, which formatting can
 *   stretch to the last row of the sheet.
 * - Date cells become `YYYY-MM-DD` from the serial number (in the workbook's date system), with no time zone in the
 *   way. A time-only cell becomes `HH:mm` and is not a date. A date with a time keeps its day.
 * - An error cell (`#N/A`) keeps its visible text; its numeric code is never a value.
 * - Everything else is the text the person saw (rule 5.4): the cell's formatted text when the file has it ("007",
 *   "18%", "(1,234)", "12.30"), else the number written without float noise. Never "7", "0.18" or "12.299999999999999".
 * - `rowBase` is the sheet row the matrix starts at, for the row numbers a person sees. `merges` are the vertical
 *   merged ranges, in matrix rows and columns, for an order number written once over several rows.
 */
export function matrixFromSheet(
  X: XlsxLike,
  sheet: XlsxSheet,
  opts: MatrixOptions = {},
): { matrix: string[][]; dateColumns: number[]; rowBase?: number; merges?: MatrixMerge[] } {
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
        } else if (cell.t === "n" && typeof cell.v === "number") {
          // The formatted text when the file has it; SheetJS gives none for a format it cannot read (`#,##,##0`).
          text = typeof cell.w === "string" && cell.w !== "" ? cell.w : numberText(cell.v);
        } else if (cell.t === "s") {
          text = String(cell.v);
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
  const merges: MatrixMerge[] = [];
  for (const m of sheet["!merges"] ?? []) {
    if (merges.length >= MAX_MERGES) break;
    // A range that runs down: one entry for each column it covers (the value sits in its first row).
    if (m.e.r <= m.s.r) continue;
    for (let c = m.s.c; c <= m.e.c; c += 1) {
      const col = c - c0;
      const firstRow = m.s.r - r0;
      const lastRow = Math.min(m.e.r - r0, maxR - r0);
      if (col >= 0 && col < columns && firstRow >= 0 && lastRow > firstRow) merges.push({ col, firstRow, lastRow });
    }
  }
  return { matrix, dateColumns, rowBase: r0, merges };
}

/** The server takes at most this many merged ranges for one table. */
const MAX_MERGES = 10_000;

type Piece = {
  sheetName: string | null;
  block: EngineBlock;
  dateColumns?: number[];
  /** The sheet row the matrix started at, and its vertical merged ranges (matrix rows and columns). */
  rowBase?: number;
  merges?: MatrixMerge[];
  /** This table's place among the tables of its sheet. */
  tableIndex?: number;
};

const PREVIEW_CELL_CHARS = 200;
const PREVIEW_CELLS = 200;

/**
 * Turns the engine's tables into `ReadBlock`s. Cells are cut at 200 characters, a block over 50,000 rows is
 * split into parts with the same headers (each part is its own candidate, numbered in order), columns above
 * 200 and blocks above 50 stop the read. Each block also carries what the header check needs: the raw rows of its
 * region (`preview`), the header the rows were read under, the region width and the merged ranges of its rows.
 */
export function finishBlocks(pieces: readonly Piece[], limits: ReadLimits = READ_LIMITS): ReadBlock[] {
  const out: ReadBlock[] = [];
  for (const { sheetName, block, dateColumns, rowBase = 0, merges = [], tableIndex = 0 } of pieces) {
    // A plain loop: spreading 150,000 rows into one call throws in V8 and Safari.
    let columns = block.headers.length;
    for (const r of block.rows) if (r.length > columns) columns = r.length;
    if (columns > limits.maxColumns) throw new ReadStop({ code: "too_many_columns", sheet: sheetName, columns });
    // The server cuts cells at 200 characters and records why; the browser only keeps the wire cap.
    const headers = block.headers.map((h) => clipCell(h, WIRE_CELL_MAX_CHARS).text);
    const rows = block.rows.map((r) => r.map((c) => clipCell(c, WIRE_CELL_MAX_CHARS).text));
    const guess: EngineHints = block.guess ?? { headerRow: block.headerRow, headerRows: block.headerRows === 2 ? 2 : 1 };
    const firstDataRow = block.firstDataSheetRow ?? guess.headerRow + (guess.headerRows ?? 1);
    const preview = (block.preview ?? []).map((p) => ({
      row: p.row,
      ...(p.page !== undefined ? { page: p.page } : {}),
      cells: p.cells.slice(0, PREVIEW_CELLS).map((c) => clipCell(c, PREVIEW_CELL_CHARS).text),
    }));
    // Rows above the header that hold text: the region starts `block.headerRow` rows above the guessed header.
    const regionStart = guess.headerRow - block.headerRow;
    const titleRows = preview.filter((p) => p.row >= regionStart && p.row < guess.headerRow && p.cells.some((c) => c.trim() !== "")).map((p) => p.row);
    const leftOut = (block.warnings ?? [])
      .filter((w) => w.code === "skipped_repeat_header" || w.code === "skipped_title" || w.code === "after_last_row")
      .map((w) => ({ code: w.code as "skipped_repeat_header" | "skipped_title" | "after_last_row", row: w.row, text: w.text ?? "" }));
    const sections = block.sections ?? [];
    const parts = Math.max(1, Math.ceil(rows.length / limits.maxRowsPerBlock));
    for (let part = 0; part < parts; part += 1) {
      const from = part * limits.maxRowsPerBlock;
      const slice = parts === 1 ? rows : rows.slice(from, (part + 1) * limits.maxRowsPerBlock);
      const base = block.title ?? sheetName;
      const title = parts === 1 ? block.title : `${base ?? ""} (${part + 1}/${parts})`.trim();
      // Merged ranges of this part's rows, by the row index inside the part. A range that starts above the part has its
      // value in another part, so it is left out; one that runs past the part is cut at its end.
      const merged: { col: number; firstRow: number; lastRow: number }[] = [];
      for (const m of merges) {
        const first = m.firstRow - firstDataRow - from;
        const last = Math.min(m.lastRow - firstDataRow - from, slice.length - 1);
        if (first >= 0 && last > first && m.col < headers.length) merged.push({ col: m.col, firstRow: first, lastRow: last });
      }
      const input: WireBlockInput = {
        ordinal: out.length,
        sheetName,
        title,
        // The raw row of the header: the server checks it against the rows of `preview`, which carry raw row numbers.
        headerRow: guess.headerRow,
        headerRows: guess.headerRows === 2 ? 2 : 1,
        headers,
        rowCount: slice.length,
        sample: sampleRows(slice),
        ...(dateColumns && dateColumns.length > 0 ? { dateColumns: dateColumns.filter((c) => c < headers.length) } : {}),
        // Required by the server (rule 7.2): it checks the header on the preview and takes the names from it.
        preview,
        ...(merged.length > 0 ? { merged } : {}),
        ...(block.width !== undefined ? { width: block.width } : {}),
        // What the reader said about the table, for the review screen to show (display only, never decided on). Row numbers
        // are the sheet's own, counted from 0.
        gaps: block.gaps ?? 0,
        warnings: leftOut.slice(0, FACTS_MAX).map((w) => ({ code: w.code, row: w.row + rowBase, text: w.text.slice(0, 200) })),
        warningsTotal: leftOut.length,
        sections: sections.slice(0, FACTS_MAX).map((x) => ({ row: x.row + rowBase, text: x.text.slice(0, 200) })),
        sectionsTotal: sections.length,
      };
      const meta: BlockMeta = {
        sheetName,
        tableIndex,
        part,
        guess,
        hints: block.hints ?? null,
        follows: part === 0 ? (block.follows ?? null) : null,
        rowBase,
        preview,
        firstDataRow: firstDataRow + from,
        lastDataRow: firstDataRow + from + slice.length - 1,
        titleRows,
        gaps: block.gaps ?? 0,
        sections: block.sections ?? [],
        leftOut,
      };
      out.push({ input, rows: slice, meta });
      if (out.length > limits.maxBlocks) throw new ReadStop({ code: "too_many_blocks", blocks: out.length });
    }
  }
  // The server wants the table above as the ordinal of its block in this same list.
  for (const b of out) {
    const f = b.meta?.follows;
    if (!f) continue;
    const upper = out.find((x) => x.meta && x.meta.sheetName === b.meta!.sheetName && x.meta.tableIndex === f.block && x.meta.part === 0);
    if (upper) b.input.follows = { ordinal: upper.input.ordinal, gapRows: f.gapRows };
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

/** The hints for the tables of one sheet, or none. A CSV is one unnamed sheet. */
const hintsFor = (all: readonly SheetHints[] | undefined, sheetName: string | null): EngineHints[] | null => {
  const found = all?.find((h) => h.sheetName === sheetName);
  return found && found.hints.length > 0 ? found.hints : null;
};

export async function readSheetBytes(buffer: ArrayBuffer, deps: ReadDeps, hints?: readonly SheetHints[]): Promise<ReadBlock[]> {
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
    const { matrix, dateColumns, rowBase, merges } = matrixFromSheet(X, sheet, {
      date1904: book.Workbook?.WBProps?.date1904 === true,
      maxRows: Math.max(0, limits.maxRawRows - rawRows),
      maxColumns: limits.maxColumns,
    });
    rawRows += matrix.length;
    checkRawRows(rawRows, limits);
    deps.onProgress?.({ phase: "sheet", sheet: name, rowsRead: matrix.length, rowsTotal: matrix.length });
    deps.engine.blocksFromMatrix(matrix, { sheetName: name, hints: hintsFor(hints, name) }).forEach((block, tableIndex) => {
      pieces.push({ sheetName: name, block, dateColumns, rowBase, merges, tableIndex });
    });
  }
  deps.onProgress?.({ phase: "blocks", sheet: null, rowsRead: rawRows, rowsTotal: rawRows });
  return finishBlocks(pieces, limits);
}

export async function readCsvText(text: string, deps: ReadDeps, sheetName: string | null = null, hints?: readonly SheetHints[]): Promise<ReadBlock[]> {
  const limits = deps.limits ?? READ_LIMITS;
  deps.onProgress?.({ phase: "open", sheet: sheetName, rowsRead: 0, rowsTotal: null });
  const body = text.replace(/^\uFEFF/, "");
  const read = { sheetName, hints: hintsFor(hints, sheetName) };
  let tables: EngineBlock[];
  let rows: number;
  if (deps.engine.blocksFromCsv) {
    // The package's own reader picks the delimiter; a hint needs it to number the rows the same way.
    const out = deps.engine.blocksFromCsv(body, read);
    tables = out.blocks;
    rows = out.rawRows;
  } else {
    const Papa = await deps.loadPapa!();
    const parsed = Papa.parse(body, { header: false, skipEmptyLines: false });
    const matrix = parsed.data.map((row) => (Array.isArray(row) ? row.map(cellText) : []));
    tables = deps.engine.blocksFromMatrix(matrix, read);
    rows = matrix.length;
  }
  checkRawRows(rows, limits);
  deps.onProgress?.({ phase: "sheet", sheet: sheetName, rowsRead: rows, rowsTotal: rows });
  return finishBlocks(tables.map((block, tableIndex) => ({ sheetName, block, tableIndex })), limits);
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
  const pieces: Piece[] = tables.map((t, tableIndex) => {
    rawRows += t.rows.length;
    // A dump's column list is its header, always: the preview is the list and the first rows, so the server can check it.
    const preview = [{ row: 0, cells: t.headers }, ...t.rows.slice(0, 11).map((cells, i) => ({ row: i + 1, cells }))];
    return {
      sheetName: t.table,
      block: {
        title: null, headerRow: 0, headerRows: 1, headers: t.headers, rows: t.rows,
        guess: { headerRow: 0, headerRows: 1 as const }, hints: null, preview, firstDataSheetRow: 1,
        width: t.headers.length,
      },
      tableIndex,
    };
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

/**
 * Reads one file of a known kind. Throws `ReadStop` with the reason when it cannot. `hints` are the header rows a person
 * or the server named, per sheet. PDFs and photos are not read in this release: they are kept, so no reader runs on them
 * (`readPdfBytes` stays for the release that reads them).
 */
export async function readFileBlocks(
  file: Pick<File, "arrayBuffer" | "text" | "stream" | "size">,
  kind: ArtifactKind,
  deps: ReadDeps,
  hints?: readonly SheetHints[],
): Promise<ReadBlock[]> {
  switch (kind) {
    case "sheet":
      return readSheetBytes(await file.arrayBuffer(), deps, hints);
    case "csv":
      return readCsvText(await file.text(), deps, null, hints);
    case "sql":
      return readSqlChunks(textChunks(file), file.size, deps);
    case "pdf_text":
    case "pdf_scan":
    case "image":
      throw new ReadStop({ code: "unreadable", detail: "PDFs and photos are kept, not read, in this release" });
  }
}
