/**
 * PDF text layer to tables (plan C2). The input is positioned text items, as a PDF library reports them: no library
 * object crosses this line. Items are grouped into lines by their y, merged into cells by the gaps between them, and
 * the columns of a run of multi-cell lines come from projecting the cells onto the x axis. The resulting matrix goes
 * through `findBlocks` like a sheet.
 */
import { findBlocks, isHeaderLike } from "./blocks";
import type { ReadBlock } from "./types";

export type TextItem = {
  str: string;
  /** Left edge. */
  x: number;
  /** Baseline. */
  y: number;
  width: number;
  height?: number;
};

export type PdfTextOptions = {
  /** PDF coordinates grow upward (default). Set false when y grows downward. */
  yUp?: boolean;
};

type Cell = { text: string; x0: number; x1: number };
type Line = { y: number; cells: Cell[] };

/** A page number on its own: `Page 2`, `Page 2 of 5`, `2 of 5`. Never table data (C17). */
const PAGE_MARK = /^(?:page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s+of\s+\d+)$/i;

function median(xs: number[], fallback: number): number {
  if (xs.length === 0) return fallback;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** One page laid out: the matrix, and for each matrix row the column spans of its region and its cells (or null). */
type PageLayout = {
  matrix: string[][];
  /** Column x spans of the region a row came from; null for a row outside any region. */
  rowCols: ([number, number][] | null)[];
  /** The positioned cells of a row read from one line; null for a blank gap row or a folded line. */
  rowCells: (Cell[] | null)[];
  charWidth: number;
};

/** Index of the column holding the cell: by its midpoint, else by its left edge. -1 when none does. */
function columnOf(cols: readonly (readonly [number, number])[], c: Cell, charWidth: number): number {
  const mid = (c.x0 + c.x1) / 2;
  const k = cols.findIndex(([a, b]) => mid >= a && mid <= b);
  return k !== -1 ? k : cols.findIndex(([a, b]) => c.x0 >= a - charWidth && c.x0 <= b);
}

function layoutPage(itemsIn: readonly TextItem[], opts: PdfTextOptions): PageLayout {
  const items = itemsIn.filter((i) => i.str.trim() !== "");
  if (items.length === 0) return { matrix: [], rowCols: [], rowCells: [], charWidth: 5 };
  const sign = opts.yUp === false ? -1 : 1;
  const height = median(items.map((i) => i.height ?? 0).filter((h) => h > 0), 10);
  const charWidth = median(items.map((i) => i.width / Math.max(i.str.length, 1)).filter((w) => w > 0), 5);
  const lineTol = height * 0.5;
  const gap = charWidth * 2;

  const sorted = [...items].sort((a, b) => sign * (b.y - a.y) || a.x - b.x);
  const lines: Line[] = [];
  let current: TextItem[] = [];
  let lineY = 0;
  const flush = () => {
    if (current.length === 0) return;
    current.sort((a, b) => a.x - b.x);
    const cells: Cell[] = [];
    for (const it of current) {
      const last = cells[cells.length - 1];
      if (last && it.x - last.x1 <= gap) {
        const space = it.x - last.x1 > charWidth * 0.2 && !last.text.endsWith(" ") && !it.str.startsWith(" ") ? " " : "";
        last.text += space + it.str;
        last.x1 = Math.max(last.x1, it.x + it.width);
      } else cells.push({ text: it.str, x0: it.x, x1: it.x + it.width });
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
    const kept = cells.filter((c) => !PAGE_MARK.test(c.text));
    if (kept.length > 0) lines.push({ y: lineY, cells: kept });
    current = [];
  };
  for (const it of sorted) {
    if (current.length > 0 && Math.abs(it.y - lineY) > lineTol) flush();
    if (current.length === 0) lineY = it.y;
    current.push(it);
  }
  flush();

  const matrix: string[][] = [];
  const rowCols: ([number, number][] | null)[] = [];
  const rowCells: (Cell[] | null)[] = [];
  const push = (row: string[], cols: [number, number][] | null, cells: Cell[] | null) => {
    matrix.push(row);
    rowCols.push(cols);
    rowCells.push(cells);
  };
  const dy = (a: number, b: number) => Math.abs(lines[a]!.y - lines[b]!.y);
  let i = 0;
  let prevY: number | null = null;
  while (i < lines.length) {
    const line = lines[i]!;
    if (prevY !== null && Math.abs(prevY - line.y) > height * 3) push([], null, null);
    if (line.cells.length < 2) {
      push([line.cells.map((c) => c.text).join(" ")], null, line.cells);
      prevY = line.y;
      i++;
      continue;
    }
    // A region: a multi-cell line and the lines that follow it within 3 line heights. One-cell lines stay in the
    // region, so a row with blank cells keeps the region's columns.
    let j = i + 1;
    while (j < lines.length && dy(j - 1, j) <= height * 3) j++;
    const region = lines.slice(i, j);
    // The row pitch: the median gap between two multi-cell lines next to each other.
    const pitches: number[] = [];
    for (let k = i + 1; k < j; k++) if (lines[k - 1]!.cells.length >= 2 && lines[k]!.cells.length >= 2) pitches.push(dy(k - 1, k));
    const pitch = median(pitches, height * 1.5);
    const spans = region
      .filter((l) => l.cells.length >= 2)
      .flatMap((l) => l.cells.map((c) => [c.x0, c.x1] as const))
      .sort((a, b) => a[0] - b[0]);
    const cols: [number, number][] = [];
    for (const [a, b] of spans) {
      const last = cols[cols.length - 1];
      if (last && a <= last[1] + charWidth * 0.5) last[1] = Math.max(last[1], b);
      else cols.push([a, b]);
    }
    region.forEach((l, r) => {
      if (l.cells.length === 1) {
        const c = l.cells[0]!;
        const k = columnOf(cols, c, charWidth);
        // A wrapped cell sits clearly closer to the line above than the row pitch (C17, C-new-3). A one-cell line
        // at the pitch is a row of its own with the other cells blank.
        const wrapped = r > 0 && dy(i + r - 1, i + r) < pitch * 0.75;
        const last = matrix[matrix.length - 1];
        if (k !== -1 && wrapped && last && last.length === cols.length) {
          last[k] = last[k] === "" ? c.text : `${last[k]} ${c.text}`;
          return;
        }
        if (k === -1) {
          push([c.text], null, l.cells);
          return;
        }
        const row = Array<string>(cols.length).fill("");
        row[k] = c.text;
        push(row, cols, l.cells);
        return;
      }
      const row = Array<string>(cols.length).fill("");
      for (const c of l.cells) {
        const k = columnOf(cols, c, charWidth);
        const at = k === -1 ? 0 : k;
        row[at] = row[at] === "" ? c.text : `${row[at]} ${c.text}`;
      }
      push(row, cols, l.cells);
    });
    prevY = region[region.length - 1]!.y;
    i = j;
  }
  return { matrix, rowCols, rowCells, charWidth };
}

export function textItemsToMatrix(itemsIn: readonly TextItem[], opts: PdfTextOptions = {}): string[][] {
  return layoutPage(itemsIn, opts).matrix;
}

export type PdfTextRead = {
  blocks: ReadBlock[];
  /** A page with text that gave no table and no rows (`page 3: text but no table`). No cell text is quoted. */
  warnings: string[];
};

const nonBlankCells = (r: readonly string[]) => r.filter((c) => c !== "").length;

/** A line under a table that is not data: a signature, a print stamp, a note (C-new-4). */
const FOOTER = /^(?:printed|prepared|checked|verified|approved|authori[sz]ed|signature|signatory|receiver'?s?\s+sign|thank|continued|contd|e\.?\s*&\s*o\.?\s*e|subject\s+to\b)/i;

/**
 * Put the cells of a header-less row into the table's columns by x (C-new-2). Each cell goes to the column whose span
 * holds it, else the nearest column within 3 characters. Null when a cell fits no column, two cells meet in one, or a
 * cell lands right of the table.
 */
function placeByX(cells: readonly Cell[], cols: readonly (readonly [number, number])[], width: number, charWidth: number): string[] | null {
  const row = Array<string>(width).fill("");
  for (const c of cells) {
    let k = columnOf(cols, c, charWidth);
    if (k === -1) {
      const mid = (c.x0 + c.x1) / 2;
      let best = Infinity;
      cols.forEach(([a, b], x) => {
        const d = mid < a ? a - mid : mid - b;
        if (d < best) {
          best = d;
          k = x;
        }
      });
      if (best > charWidth * 3) k = -1;
    }
    if (k === -1 || k >= width || row[k] !== "") return null;
    row[k] = c.text;
  }
  return row;
}

/**
 * Pages of text items to blocks. A table that continues on the next page is one block: the header repeated at the top
 * of the next page is dropped, and data rows at the top of a page with no header join the table above (C16). Those
 * rows are placed under the table's columns by x, so a column blank on the whole page stays blank (C-new-2).
 */
export function readPdfText(pages: readonly (readonly TextItem[])[], opts: PdfTextOptions = {}): PdfTextRead {
  const out: ReadBlock[] = [];
  const warnings: string[] = [];
  /** The column x spans of the page a block started on. */
  const blockCols = new Map<ReadBlock, readonly (readonly [number, number])[]>();
  pages.forEach((items, p) => {
    const page = layoutPage(items, opts);
    const matrix = page.matrix;
    const prev = [...out].reverse().find((b) => b.rows.length > 0);
    let rest = matrix;
    let appended = 0;
    let offset = 0;
    if (p > 0 && prev) {
      // Rows above the first header-like row continue the table of the page before.
      let h = matrix.findIndex((r) => isHeaderLike(r));
      if (h === -1) h = matrix.length;
      const width = prev.headers.length;
      const cols = blockCols.get(prev);
      let misplaced = 0;
      matrix.slice(0, h).forEach((r, x) => {
        // A lone short line (a page number, a footer) is noise.
        if (nonBlankCells(r) < 2) return;
        const cells = page.rowCells[x];
        const placed = cols && cells ? placeByX(cells, cols, width, page.charWidth) : r.length === width ? r : null;
        if (!placed) {
          misplaced++;
          return;
        }
        prev.rows.push(placed);
        appended++;
      });
      if (misplaced > 0) warnings.push(`page ${p + 1}: ${misplaced} ${misplaced === 1 ? "row" : "rows"} did not line up with the table above`);
      rest = matrix.slice(h);
      offset = h;
    }
    const blocks = findBlocks(rest, { sheetName: `Page ${p + 1}` });
    for (const b of blocks) {
      // Footer lines under a table are not rows (C17): a one-cell line after a blank gap, or one that reads like a
      // signature or a note. A one-cell row at the table's row pitch is data (C-new-4).
      for (;;) {
        const rows = b.rows;
        const last = rows[rows.length - 1];
        if (b.headers.length < 2 || !last) break;
        if (nonBlankCells(last) === 0) {
          rows.pop();
          continue;
        }
        if (nonBlankCells(last) > 1) break;
        const above = rows[rows.length - 2];
        const afterGap = above !== undefined && nonBlankCells(above) === 0;
        if (!afterGap && !FOOTER.test(last.find((c) => c !== "")!)) break;
        rows.pop();
      }
      const at = offset + b.firstDataSheetRow;
      const cols = page.rowCols[at - 1] ?? page.rowCols[at] ?? null;
      if (cols) blockCols.set(b, cols);
    }
    blocks.forEach((b, k) => {
      const last = [...out].reverse().find((x) => x.rows.length > 0);
      const sameHeader = last && k === 0 && last.headers.length === b.headers.length && last.headers.every((h, x) => h.toLowerCase() === b.headers[x]!.toLowerCase());
      if (last && sameHeader) last.rows.push(...b.rows);
      else out.push(b);
    });
    if (items.some((i) => i.str.trim() !== "") && blocks.length === 0 && appended === 0) warnings.push(`page ${p + 1}: text but no table`);
  });
  // A header with no rows under it (a footer read as a header) is no table.
  return { blocks: out.filter((b) => b.rows.length > 0), warnings };
}

/** Pages of text items to blocks; see `readPdfText`, which also returns the warnings. */
export function readPdfTextBlocks(pages: readonly (readonly TextItem[])[], opts: PdfTextOptions = {}): ReadBlock[] {
  return readPdfText(pages, opts).blocks;
}
