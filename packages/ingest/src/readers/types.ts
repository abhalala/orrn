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
 * When the window moves down (a long title, or rows of numbers only further down), the first rows of the region are
 * shown too, so a preview may hold `PREVIEW_ROWS + PREVIEW_HEAD_ROWS` rows. A preview with a gap in its row numbers
 * left rows out, and `chooseHeader` then asks (PORTAL-RULES-3 section 5.1, M6).
 */
export const PREVIEW_HEAD_ROWS = 3;

/**
 * Hints for one block. With hints a reader does not guess: the block follows them exactly. Row numbers are raw rows:
 * for a sheet or CSV the 0-based row of the sheet, for a PDF the 0-based line on the page (the numbers in `preview`).
 * - `headerRow`: the raw row that holds the column names (the top one when the header has two rows).
 * - `headerRows`: 1 (default) or 2. Two rows join as "top bottom", a blank top cell continuing the group to its left.
 * - `firstDataRow`: the first data row. Default: the row under the header.
 * - `lastDataRow`: the last data row. Given, it is followed exactly, across blank rows, and rule 8.1 leaves nothing
 *   out. Default for sheets and CSV (rule 8.1, round 8): the table goes on across blank rows while what follows them
 *   is a repeat of the header, a single text cell, or data that fits the column kinds; it ends before the next
 *   hinted header, else at the end of the sheet. What lies below is read by the guess as further blocks. For PDF: the
 *   line before the next hinted header on the same page, else the end of the page.
 * - `skipRows` (sheets and CSV): data rows to leave out, such as a repeated header inside a range the person joined.
 *   Each must lie between the first and the last data row. A skipped row stays in `rows` as a blank row, so row `i`
 *   of `rows` is still sheet row `firstDataSheetRow + i`, and it is listed as `skipped_by_hint`.
 * - `page` (PDF only): the 1-based page of the header. `lastPage` (PDF only): the page of `lastDataRow`, default `page`.
 */
export type BlockHints = {
  headerRow: number;
  headerRows?: 1 | 2;
  firstDataRow?: number;
  lastDataRow?: number | null;
  skipRows?: number[];
  page?: number;
  lastPage?: number;
};

/**
 * A row the reader could not place in a table, or left out on purpose, with its row number. Only the two lists of
 * rule 8.1 quote the row's text.
 * - `not_placed`: no table took the row (no header was found for it, or it fits no column).
 * - `footer_left_out` (PDF): a one-cell line under the table read as a footer, not a row.
 * - `title_repeated` (PDF): the title of the table repeated on a later page.
 * - `skipped_by_hint`: a row between the header and the hinted first data row, or a row of the hint's `skipRows`.
 * - `after_last_row`: a row below a block that no block takes and that does not look like data (a note, a footer).
 *   Rows that look like data always go in a block (rule 6.1).
 * - `skipped_repeat_header` (rule 8.1): after blank rows, a repeat of the header (every filled cell is the header's
 *   name for that column). Left out of `rows` as a blank row; `text` is its cells joined by one space.
 * - `skipped_title` (rule 8.1): after blank rows, a single text cell ("December", "contd.") with more of the table
 *   after it. Left out of `rows` as a blank row; `text` is the cell.
 * - `kept_as_title`: a row above the header, kept in the block's title, not in its rows. It may be data.
 * - `columns_not_matched`: no longer given since round 5; a PDF row in doubt is a `RowDoubt` in `doubts`. Kept so
 *   stored reads still parse.
 */
export type RowWarning = {
  code:
    | "not_placed"
    | "footer_left_out"
    | "title_repeated"
    | "skipped_by_hint"
    | "after_last_row"
    | "kept_as_title"
    | "columns_not_matched"
    | "skipped_repeat_header"
    | "skipped_title";
  row: number;
  /** The row's text, for `skipped_repeat_header` and `skipped_title` only. */
  text?: string;
  /** 1-based page, for PDF only. */
  page?: number;
};

/**
 * Doubt about how a PDF line was split into the block's columns (PORTAL-RULES-3 section 5.3). The row is kept, and the
 * dry run stages it as "check this row against the file" instead of ready.
 * - `crosses_column`: an item crosses the edge of its column by more than a quarter of its width.
 * - `cells_joined`: two items of the line fell in one column and are not one phrase; they are joined with a space.
 * - `cells_close`: two items closer than two average character widths fell in different columns.
 * - `few_columns`: the line fills fewer than half the columns.
 * - `off_column`: a cell does not line up with its column: a value under a blank header cell put in a named
 *   neighbour's column, or a remark past the edge of the table. Not one of the four kinds the rule names; added so
 *   those rows are never silent either.
 */
export type DoubtCode = "crosses_column" | "cells_joined" | "cells_close" | "few_columns" | "off_column";

/**
 * A row of `rows` the reader is not sure it split right. `row` is the index in `rows`; `line` the raw row (for PDF the
 * page line, the number in the preview) the doubt was found on, and `page` its 1-based page. One entry per code.
 */
export type RowDoubt = { row: number; code: DoubtCode; line: number; page?: number };

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
  /**
   * The region's width: the widest of the header and data rows, counted to each row's last filled cell. A column
   * filled only below the preview counts. `chooseHeader` pads the names to it, so a blank header cell matches an
   * approved unnamed column by position (round 6, M-R5-2). Set by the sheet, CSV and SQL readers. The PDF reader is
   * not used by the first release and was not changed: a PDF block may carry the width of its inner matrix. For a
   * whole block `chooseHeader` counts the width from the block's own rows, so that number is never used there.
   */
  width?: number;
  /**
   * Data rows after the header. Interior blank rows stay (the recipe skips them); trailing ones are cut. A row left
   * out (a hint's `skipRows`, or rule 8.1's lists) stays as a blank row and is listed in `warnings`.
   */
  rows: string[][];
  /**
   * Fully blank rows inside `rows`, not counting rows left out (rule 8.1): the screen says "N blank rows inside this
   * table were skipped". Set by the sheet, CSV and SQL readers.
   */
  gaps?: number;
  /**
   * Section 9: the titles this table continues under after a blank row (each also a `skipped_title` warning), in row
   * order. The screen shows "This table continues under '<text>' (row N)" with "Start a new table here", which reads
   * the table again with `lastDataRow` set to the row before the title. Set by the sheet, CSV and SQL readers.
   */
  sections?: { row: number; text: string }[];
  /** Row of the sheet where the first data row sits, 0-based. Row `i` of `rows` is sheet row `firstDataSheetRow + i`. */
  firstDataSheetRow: number;
  /** Raw rows of the block's region, before any header was applied: `PREVIEW_ROWS`, plus `PREVIEW_HEAD_ROWS` when the window moved. */
  preview: PreviewRow[];
  /** The header the rows were read under, as hints in raw row numbers: the reader's guess, or the hints it was given. */
  guess: BlockHints;
  /** The hints the block was read with, or null when the reader guessed. */
  hints: BlockHints | null;
  /** Rows of this block's region that are not in `rows`. */
  warnings: RowWarning[];
  /**
   * Set when this block starts right after another block of the same sheet, with only blank rows between: `block` is
   * that block's index in the sheet's blocks, `gapRows` the number of blank rows between. `continues` is the offer
   * "It continues the table above" (rule 8.1, round 8): true only when every column of the block above is text (such a
   * table never goes on across a blank row by itself), this block's title rows are single cells, and its rows sit
   * inside the width of the block above. The person decides; joining is the upper hint with this block's last row as
   * `lastDataRow` and its title rows in `skipRows`. Null otherwise. Set by the sheet and CSV readers; the SQL reader
   * gives null, the PDF reader (not in the first release) leaves it out.
   */
  follows?: { block: number; gapRows: number; continues: boolean } | null;
  /** Rows of `rows` whose split into columns is in doubt (PDF only; sheets, CSV and SQL give none). */
  doubts: RowDoubt[];
};

/** What a spreadsheet library hands over for a cell. No library objects: only these plain values. */
export type MatrixCell = string | number | boolean | Date | null | undefined;
