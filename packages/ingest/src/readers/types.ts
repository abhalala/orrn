/**
 * Is the reader sure where the table starts and which row holds the column names? `sure` follows one narrow rule
 * (PORTAL-RULES-3 section 3, see `blocks.ts`). Everything else is `unsure`: the block is still the best guess, and the
 * web asks the person to check the column names on the preview.
 */
export type BlockConfidence = "sure" | "unsure";

/**
 * Why a block is unsure. Codes, not words: the web turns them into text.
 * - `rows_above_header`: a title, letterhead or other rows sit above the header in the region.
 * - `header_too_few_cells`: the header has fewer than two filled cells.
 * - `header_not_text`: a header cell is a number, a date or a code.
 * - `header_like_title`: a header cell reads like a title or letterhead (a colon label such as "Party: Om", or a full
 *   date), so the real header may be the row below.
 * - `header_repeated`: two header cells hold the same name (a second header row of sizes or units may sit below).
 * - `header_blank_cell`: a column has no name (a blank header cell, also a data row wider than the header).
 * - `two_row_header`: the reader joined two rows into the header (group labels over columns).
 * - `no_number_below`: no data row holds a number or a date.
 * - `first_row_has_no_number`: the first row under the header holds no number or date, so it may be a second header
 *   row, or the header may be a title.
 * - `first_row_like_header`: the first row under the header could itself be the header: its numbers are years, dates
 *   on the 1st of a month, or whole numbers rising left to right (lengths 12, 14, 16; column numbers 1, 2, 3).
 * - `row_wider_than_header`: a data row has a cell right of the header's last cell.
 * - `word_in_number_column`: a word sits in a column whose other cells are numbers or dates.
 * - `gap_in_rows`: a blank row sits between data rows (what follows may be a footer or another table).
 * - `one_cell_last_row`: the last row has one filled cell (a footer or a note, or a real row).
 * - `last_row_not_data`: the last row is blank in every column of numbers or dates ("Prepared by | Checked by").
 * - `more_tables`: the sheet or page holds another table, so where this one ends is a guess.
 * - `line_not_placed` (PDF): a line on the page could not be placed in the table.
 * - `columns_not_shared` (PDF): the rows of the region do not share column positions.
 * - `one_cell_line` (PDF): a line with one cell was folded into the row above or kept as its own row.
 * - `rows_left_out` (PDF): a line under the table was left out as a footer (listed in `warnings`).
 * - `continued_without_header` (PDF): lines on a later page with no header of their own were joined to the table.
 */
export const UNSURE_REASONS = [
  "rows_above_header",
  "header_too_few_cells",
  "header_not_text",
  "header_like_title",
  "header_repeated",
  "header_blank_cell",
  "two_row_header",
  "no_number_below",
  "first_row_has_no_number",
  "first_row_like_header",
  "row_wider_than_header",
  "word_in_number_column",
  "gap_in_rows",
  "one_cell_last_row",
  "last_row_not_data",
  "more_tables",
  "line_not_placed",
  "columns_not_shared",
  "one_cell_line",
  "rows_left_out",
  "continued_without_header",
] as const;
export type UnsureReason = (typeof UNSURE_REASONS)[number];

/** One raw row of a block's region, exactly as read, with its row number in the sheet or on the page (0-based). */
export type PreviewRow = { row: number; cells: string[] };

/** At most this many raw rows go in a block's preview. */
export const PREVIEW_ROWS = 12;

/**
 * Hints for one block. With hints a reader does not guess: the block follows them exactly. Row numbers are raw rows:
 * for a sheet or CSV the 0-based row of the sheet, for a PDF the 0-based line on the page (the numbers in `preview`).
 * - `headerRow`: the raw row that holds the column names (the top one when the header has two rows).
 * - `headerRows`: 1 (default) or 2. Two rows join as "top bottom", a blank top cell continuing the group to its left.
 * - `firstDataRow`: the first data row. Default: the row under the header.
 * - `lastDataRow`: the last data row. Default: the row before the next hinted header, else the end of the sheet or page.
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
 * - `kept_as_title`: a row of two or more filled cells above the header, kept in the block's title. It may be data.
 */
export type RowWarning = {
  code: "not_placed" | "footer_left_out" | "title_repeated" | "skipped_by_hint" | "after_last_row" | "kept_as_title";
  row: number;
  /** 1-based page, for PDF only. */
  page?: number;
};

/** A table found in a file: what every reader returns. */
export type ReadBlock = {
  sheetName: string | null;
  /** Text of the rows above the header, joined by one space. */
  title: string | null;
  /** Position of the header row inside the block (the title rows come first). */
  headerRow: number;
  headerRows: 1 | 2;
  headers: string[];
  /** Data rows after the header. Interior blank rows stay (the recipe skips them); trailing ones are cut. */
  rows: string[][];
  /** Row of the sheet where the first data row sits, 0-based. Row `i` of `rows` is sheet row `firstDataSheetRow + i`. */
  firstDataSheetRow: number;
  /** `sure` only under the narrow rule; hinted blocks are `sure`. */
  confidence: BlockConfidence;
  /** Empty when sure. */
  reasons: UnsureReason[];
  /** The first raw rows of the block's region, before any header was applied (up to `PREVIEW_ROWS`). */
  preview: PreviewRow[];
  /** The reader's choice as hints, in raw row numbers: the web preselects them in the "Check the column names" step. */
  guess: BlockHints;
  /** The hints the block was read with, or null when the reader chose. */
  hints: BlockHints | null;
  /** Rows of this block's region the reader could not place or left out. */
  warnings: RowWarning[];
};

/** What a spreadsheet library hands over for a cell. No library objects: only these plain values. */
export type MatrixCell = string | number | boolean | Date | null | undefined;
