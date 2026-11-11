/**
 * The seam between the browser reader and the pure readers of `@orrn/ingest` (lane C): header detection, two-row
 * headers, titles, block splitting, the SQL dump reader and PDF text tables. The reader core takes a
 * `ReaderEngine`, so it is tested with a small fake and wired to the package in `engine.ts`.
 */
export type EngineBlock = {
  title: string | null;
  /** 0-based row of the header in the matrix it came from. */
  headerRow: number;
  headerRows: number;
  headers: string[];
  rows: string[][];
};

export type PdfItem = { page: number; text: string; x: number; y: number; width: number; height: number };

export type EngineTable = { title: string | null; headers: string[]; rows: string[][] };

export interface SqlTableReader {
  /** Feed the next chunk of dump text, in order. */
  push(chunk: string): void;
  /** Tables read so far, once the text has ended. */
  finish(): { table: string; headers: string[]; rows: string[][] }[];
}

export interface ReaderEngine {
  /** One sheet or CSV as a matrix of cell text: its tables. */
  blocksFromMatrix(matrix: string[][]): EngineBlock[];
  createSqlReader(): SqlTableReader;
  /** Positioned text items of a PDF: its tables. */
  tablesFromPdfItems(items: PdfItem[]): EngineTable[];
}
