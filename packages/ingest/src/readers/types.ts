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
};

/** What a spreadsheet library hands over for a cell. No library objects: only these plain values. */
export type MatrixCell = string | number | boolean | Date | null | undefined;
