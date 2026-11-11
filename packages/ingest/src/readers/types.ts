/**
 * One raw row of a block's region, exactly as read, with its row number in the sheet or on the page (0-based). PDF rows
 * carry their 1-based page and the line's text cells left to right.
 */
export type PreviewRow = { row: number; page?: number; cells: string[] };

/**
 * At most this many raw rows go in a block's preview: from the first row of the region, or, when a long title pushes
 * the guessed header down, a window that holds the rows just above the header, the header and the rows under it.
 */
export const PREVIEW_ROWS = 12;

/**
 * Hints for one block. With hints a reader does not guess: the block follows them exactly. Row numbers are raw rows:
 * for a sheet or CSV the 0-based row of the sheet, for a PDF the 0-based line on the page (the numbers in `preview`).
 * - `headerRow`: the raw row that holds the column names (the top one when the header has two rows).
 * - `headerRows`: 1 (default) or 2. Two rows join as "top bottom", a blank top cell continuing the group to its left.
 * - `firstDataRow`: the first data row. Default: the row under the header.
 * - `lastDataRow`: the last data row. Default for sheets and CSV: the row before the next hinted header or before the
 *   next block the reader guessed, whichever comes first, else the end of the sheet. For PDF: the line before the next
 *   hinted header on the same page, else the end of the page.
 * - `page` (PDF only): the 1-based page of the header. `lastPage` (PDF only): the page of `lastDataRow`, default `page`.
 */
export type BlockHints = {
  headerRow: number;
  headerRows?: 1 | 2;
  firstDataRow?: number;
  lastDataRow?: number | null;
  page?: number;
  lastPage?: number;
};

/**
 * A row the reader could not place in a table, or left out on purpose, with its row number. No cell text is quoted.
 * - `not_placed`: no table took the row (no header was found for it, or it fits no column).
 * - `footer_left_out` (PDF): a one-cell line under the table read as a footer, not a row.
 * - `title_repeated` (PDF): the title of the table repeated on a later page.
 * - `skipped_by_hint`: a row between the header and the hinted first data row.
 * - `after_last_row`: a row after the hinted last data row that no other block takes.
 * - `kept_as_title`: a row above the header, kept in the block's title, not in its rows. It may be data.
 */
export type RowWarning = {
  code: "not_placed" | "footer_left_out" | "title_repeated" | "skipped_by_hint" | "after_last_row" | "kept_as_title";
  row: number;
  /** 1-based page, for PDF only. */
  page?: number;
};

/**
 * A table found in a file: what every reader returns (PORTAL-RULES-3 section 4.1).
 *
 * The reader only guesses. It makes no claim about confidence: a header is trusted when it fits a layout the plant
 * already knows (`chooseHeader`), or when a person picked it (the block was read with `hints`).
 *
 * After the header the reader makes no judgement. A footer, a totals row, a second table stacked under the first, a
 * signature or a stray line is a row like any other. The dry run refuses or asks about rows that do not parse, and a
 * person sees them before approving. A line or row of the region the reader does not put in `rows` (a title line, a
 * line skipped by a hint, a line it could not place) is listed in `warnings` with its row number and, for PDF, page.
 */
export type ReadBlock = {
  sheetName: string | null;
  /** Text of the rows above the header, joined by one space. Each of those rows is also a `kept_as_title` warning. */
  title: string | null;
  /** Position of the header row inside the block (the title rows come first). */
  headerRow: number;
  headerRows: 1 | 2;
  headers: string[];
  /** Data rows after the header. Interior blank rows stay (the recipe skips them); trailing ones are cut. */
  rows: string[][];
  /** Row of the sheet where the first data row sits, 0-based. Row `i` of `rows` is sheet row `firstDataSheetRow + i`. */
  firstDataSheetRow: number;
  /** At most `PREVIEW_ROWS` raw rows of the block's region, before any header was applied. */
  preview: PreviewRow[];
  /** The header the rows were read under, as hints in raw row numbers: the reader's guess, or the hints it was given. */
  guess: BlockHints;
  /** The hints the block was read with, or null when the reader guessed. */
  hints: BlockHints | null;
  /** Rows of this block's region that are not in `rows`. */
  warnings: RowWarning[];
};

/** What a spreadsheet library hands over for a cell. No library objects: only these plain values. */
export type MatrixCell = string | number | boolean | Date | null | undefined;
