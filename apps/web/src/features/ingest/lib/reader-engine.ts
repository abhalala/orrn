/**
 * The seam between the browser reader and the pure readers of `@orrn/ingest` (lane C): header detection, two-row
 * headers, titles, block splitting, the SQL dump reader and PDF text tables. The reader core takes a
 * `ReaderEngine`, so it is tested with a small fake and wired to the package in `engine.ts`.
 */
/**
 * Hints for one table, in raw rows of the sheet or CSV (the numbers in a block's `preview`). With hints a reader does not
 * guess. `lastDataRow` ends the table (a join with the table below sets it); `skipRows` leaves rows out of it (a header
 * repeated further down).
 */
export type EngineHints = {
  headerRow: number;
  headerRows?: 1 | 2;
  firstDataRow?: number;
  lastDataRow?: number | null;
  skipRows?: number[];
};

/** One raw row of a table's region, as read, before any header was applied. */
export type EnginePreviewRow = { row: number; page?: number; cells: string[] };

/** A table that starts right after another one of the same sheet, with only blank rows between them. */
export type EngineFollows = { block: number; gapRows: number };

export type EngineBlock = {
  title: string | null;
  /** 0-based row of the header in the matrix it came from. */
  headerRow: number;
  headerRows: number;
  headers: string[];
  rows: string[][];
  /** The header the rows were read under, in raw rows. Without it (a small fake engine) the header row is the raw row. */
  guess?: EngineHints;
  /** The hints the block was read with, or null when the engine guessed. */
  hints?: EngineHints | null;
  /** The first raw rows of the region, for the server's header check and for the person's choice. */
  preview?: EnginePreviewRow[];
  /** The region's width, to its last filled cell. */
  width?: number;
  /** Raw row where `rows[0]` sits. Row `i` of `rows` is raw row `firstDataSheetRow + i`. */
  firstDataSheetRow?: number;
  /** Set when this table starts right after another one of the sheet (blank rows between). */
  follows?: EngineFollows | null;
};

/** What a read of one sheet or CSV may be told: its name and the hints for its tables. */
export type MatrixRead = { sheetName?: string | null; hints?: readonly EngineHints[] | null };

export type PdfItem = { page: number; text: string; x: number; y: number; width: number; height: number };

export type EngineTable = { title: string | null; sheetName?: string | null; headers: string[]; rows: string[][] };

export interface SqlTableReader {
  /** Feed the next chunk of dump text, in order. */
  push(chunk: string): void;
  /** Tables read so far, once the text has ended. */
  finish(): { table: string; headers: string[]; rows: string[][] }[];
}

export interface ReaderEngine {
  /** One sheet or CSV as a matrix of cell text: its tables. A hint that cannot be followed throws `ReadStop("hint_error")`. */
  blocksFromMatrix(matrix: string[][], opts?: MatrixRead): EngineBlock[];
  /** A CSV file as text: its tables, with the delimiter chosen by the package. Optional so a small fake engine stays small. */
  blocksFromCsv?(text: string, opts?: MatrixRead): { blocks: EngineBlock[]; rawRows: number };
  createSqlReader(): SqlTableReader;
  /** Positioned text items of a PDF: its tables. */
  tablesFromPdfItems(items: PdfItem[]): EngineTable[];
}
