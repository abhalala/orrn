/**
 * PDF text layer to tables (plan C2). The input is positioned text items, as a PDF library reports them: no library
 * object crosses this line. Items are grouped into lines by their y and merged into cells by the gaps between them.
 * A table is a run of multi-cell lines; its columns come from projecting the cells of those lines onto the x axis.
 * One-cell lines never widen a column: they are placed into a column or folded into the cell above afterwards, and a
 * one-cell line that is not a row of the table ends the run (C-new-6). Each run goes through `findBlocks` like a sheet.
 */
import { cellKind, inferKind } from "../cells";
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
type Col = [number, number];

/** A page number on its own: `Page 2`, `Page 2 of 5`, `2 of 5`. Never table data (C17). */
const PAGE_MARK = /^(?:page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\d+\s+of\s+\d+)$/i;

function median(xs: number[], fallback: number): number {
  if (xs.length === 0) return fallback;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** One row of a laid out page. */
type LayoutRow = {
  cells: string[];
  /** The positioned cells of the row, with folded lines joined in; null for a blank gap row. */
  pos: Cell[] | null;
};

/**
 * A table run and the lines that belong with it. `pre` are the lines above the run that are not rows of it (titles);
 * `cols` is null for the lines left over at the end of a page, which hold no table.
 */
type Segment = { pre: Line[]; rows: LayoutRow[]; cols: Col[] | null };

type PageLayout = { segments: Segment[]; charWidth: number; height: number; fused: number };

/** Index of the column holding the cell: by its midpoint, else by its left edge. -1 when none does. */
function columnOf(cols: readonly (readonly [number, number])[], c: Cell, charWidth: number): number {
  const mid = (c.x0 + c.x1) / 2;
  const k = cols.findIndex(([a, b]) => mid >= a && mid <= b);
  return k !== -1 ? k : cols.findIndex(([a, b]) => c.x0 >= a - charWidth && c.x0 <= b);
}

/** The column holding the cell, else the nearest one. */
function nearestColumn(cols: readonly (readonly [number, number])[], c: Cell, charWidth: number): number {
  const k = columnOf(cols, c, charWidth);
  if (k !== -1) return k;
  const mid = (c.x0 + c.x1) / 2;
  let best = 0;
  let dist = Infinity;
  cols.forEach(([a, b], x) => {
    const d = mid < a ? a - mid : mid - b;
    if (d < dist) {
      dist = d;
      best = x;
    }
  });
  return best;
}

const overlapping = (cols: readonly Col[], c: Cell) => cols.filter(([a, b]) => c.x0 < b && c.x1 > a).length;

function mergeSpans(spans: (readonly [number, number])[], charWidth: number): Col[] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const cols: Col[] = [];
  for (const [a, b] of sorted) {
    const last = cols[cols.length - 1];
    if (last && a <= last[1] + charWidth * 0.5) last[1] = Math.max(last[1], b);
    else cols.push([a, b]);
  }
  return cols;
}

/**
 * Column spans of a run's multi-cell lines. A cell that bridges the gap between two cells of another line (a wide
 * title cell, a group label, a long text) would fuse their columns, so it is left out of the spans and placed by x.
 */
function buildCols(lines: readonly Line[], charWidth: number): Col[] {
  const out = new Set<Cell>();
  let cols: Col[] = [];
  for (let round = 0; round < 50; round++) {
    cols = mergeSpans(lines.flatMap((l) => l.cells.filter((c) => !out.has(c)).map((c) => [c.x0, c.x1] as const)), charWidth);
    let changed = false;
    for (const l of lines) {
      const kept = l.cells.filter((c) => !out.has(c));
      for (let a = 1; a < kept.length; a++) {
        const left = kept[a - 1]!;
        const right = kept[a]!;
        if (columnOf(cols, left, charWidth) !== columnOf(cols, right, charWidth)) continue;
        for (const other of lines) {
          if (other === l) continue;
          for (const c of other.cells) {
            if (!out.has(c) && c.x0 < right.x0 && c.x1 > left.x1) {
              out.add(c);
              changed = true;
            }
          }
        }
      }
    }
    if (!changed) break;
  }
  return cols;
}

/** Does the line fit the columns one cell to one column, with no new column and no cell across two? */
function fitsColumns(cols: readonly Col[], l: Line, charWidth: number): boolean {
  const seen = new Set<number>();
  for (const c of l.cells) {
    const k = columnOf(cols, c, charWidth);
    if (k === -1 || seen.has(k) || overlapping(cols, c) > 1) return false;
    seen.add(k);
  }
  return true;
}

const isTextish = (s: string) => {
  const k = cellKind(s);
  return k === "text" || k === "code";
};

/** Is the line a new header: text over a column where the run's data rows hold numbers, dates or codes? */
function isNewHeader(cols: readonly Col[], l: Line, members: readonly Line[], charWidth: number): boolean {
  if (!isHeaderLike(l.cells.map((c) => c.text))) return false;
  const data = members.length > 1 && isHeaderLike(members[0]!.cells.map((c) => c.text)) ? members.slice(1) : members;
  return l.cells.some((c) => {
    if (!isTextish(c.text)) return false;
    const k = columnOf(cols, c, charWidth);
    const values = data.flatMap((m) => m.cells.filter((d) => columnOf(cols, d, charWidth) === k).map((d) => d.text));
    const kind = inferKind(values);
    return kind === "int" || kind === "decimal" || kind === "date" || kind === "code";
  });
}

type Entry = { line: number } | { gap: true };

function layoutPage(itemsIn: readonly TextItem[], opts: PdfTextOptions): PageLayout {
  const items = itemsIn.filter((i) => i.str.trim() !== "");
  if (items.length === 0) return { segments: [], charWidth: 5, height: 10, fused: 0 };
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

  const dy = (a: number, b: number) => Math.abs(lines[a]!.y - lines[b]!.y);
  const far = (a: number, b: number) => dy(a, b) > height * 3;
  const multi = (j: number) => lines[j]!.cells.length >= 2;

  /**
   * The run that starts at the multi-cell line `i`. Next multi-cell lines within 3 line heights join it. One-cell
   * lines wait: they are rows of the run only when the next multi-cell line continues the same table (fits its
   * columns one to one and is not a new header), or when no table line follows them on the page. A multi-cell line
   * after a blank gap joins only when it continues the table.
   */
  const collectRun = (i: number): { entries: Entry[]; end: number } => {
    const entries: Entry[] = [{ line: i }];
    const members: Line[] = [lines[i]!];
    let cols = buildCols(members, charWidth);
    let pending: Entry[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const big = far(j - 1, j);
      if (!multi(j)) {
        if (big) break;
        pending.push({ line: j });
        continue;
      }
      const l = lines[j]!;
      const plain = pending.length === 0 && !big;
      if (!plain && !(fitsColumns(cols, l, charWidth) && !isNewHeader(cols, l, members, charWidth))) {
        // The waiting one-cell lines head whatever comes next.
        const first = pending[0];
        return { entries, end: first && "line" in first ? first.line : j };
      }
      if (big) pending.push({ gap: true });
      entries.push(...pending, { line: j });
      pending = [];
      members.push(l);
      cols = buildCols(members, charWidth);
    }
    // Trailing one-cell lines within 3 line heights stay with the run (data rows, or footers the reader drops).
    entries.push(...pending);
    return { entries, end: j };
  };

  let fused = 0;
  const emitRun = (entries: readonly Entry[]): { rows: LayoutRow[]; cols: Col[] } => {
    const lineIdx = entries.flatMap((e) => ("line" in e ? [e.line] : []));
    const cols = buildCols(
      lineIdx.filter(multi).map((j) => lines[j]!),
      charWidth,
    );
    // The row pitch: the median gap between two multi-cell lines next to each other.
    const pitches: number[] = [];
    for (let x = 1; x < lineIdx.length; x++) {
      const a = lineIdx[x - 1]!;
      const b = lineIdx[x]!;
      if (b === a + 1 && multi(a) && multi(b)) pitches.push(dy(a, b));
    }
    const pitch = median(pitches, height * 1.5);
    // Key columns: the first column, and every column whose data cells are numbers. A wrapped line never sits there.
    const multiLines = lineIdx.filter(multi).map((j) => lines[j]!);
    const data = multiLines.length > 1 && isHeaderLike(multiLines[0]!.cells.map((c) => c.text)) ? multiLines.slice(1) : multiLines;
    const key = new Set<number>([0]);
    cols.forEach((_, k) => {
      const kind = inferKind(data.flatMap((l) => l.cells.filter((c) => nearestColumn(cols, c, charWidth) === k).map((c) => c.text)));
      if (kind === "int" || kind === "decimal") key.add(k);
    });
    const rows: LayoutRow[] = [];
    let prev = -1;
    for (const e of entries) {
      if (!("line" in e)) {
        rows.push({ cells: [], pos: null });
        prev = -1;
        continue;
      }
      const l = lines[e.line]!;
      if (l.cells.length === 1) {
        const c = l.cells[0]!;
        const k = nearestColumn(cols, c, charWidth);
        const last = rows[rows.length - 1];
        // A wrapped cell sits clearly closer to the line above than the row pitch (C17, C-new-3). In a tight table
        // a wrapped line can sit at the pitch: a one-cell line within the pitch, under a filled cell of the row above,
        // outside the key columns, is a wrapped line too (C-new-7). Otherwise it is a row with the other cells blank.
        const gapAbove = prev === -1 ? Infinity : dy(prev, e.line);
        const underCell = last !== undefined && last.pos !== null && (last.cells[k] ?? "") !== "";
        const wrapped = gapAbove < pitch * 0.75 || (gapAbove <= pitch * 1.05 && underCell && !key.has(k) && isTextish(c.text));
        if (wrapped && last && last.pos) {
          last.cells[k] = last.cells[k] === "" ? c.text : `${last.cells[k]} ${c.text}`;
          const at = last.pos.find((p) => columnOf(cols, p, charWidth) === k);
          if (at) {
            at.text = last.cells[k]!;
            at.x1 = Math.max(at.x1, c.x1);
          } else last.pos.push({ ...c });
        } else {
          const cells = Array<string>(cols.length).fill("");
          cells[k] = c.text;
          rows.push({ cells, pos: [{ ...c }] });
        }
        prev = e.line;
        continue;
      }
      const cells = Array<string>(cols.length).fill("");
      for (const c of l.cells) {
        const k = nearestColumn(cols, c, charWidth);
        if (cells[k] !== "") fused++;
        cells[k] = cells[k] === "" ? c.text : `${cells[k]} ${c.text}`;
      }
      rows.push({ cells, pos: l.cells.map((c) => ({ ...c })) });
      prev = e.line;
    }
    return { rows, cols };
  };

  const segments: Segment[] = [];
  let pre: Line[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!multi(i)) {
      pre.push(lines[i]!);
      i++;
      continue;
    }
    const { entries, end } = collectRun(i);
    // A lone multi-cell line with more text after it (a "Party: ... Date: ..." line) heads what follows.
    if (entries.length === 1 && end < lines.length) {
      pre.push(lines[i]!);
      i++;
      continue;
    }
    const { rows, cols } = emitRun(entries);
    segments.push({ pre, rows, cols });
    pre = [];
    i = end;
  }
  if (pre.length > 0) segments.push({ pre: [], rows: pre.map((l) => ({ cells: l.cells.map((c) => c.text), pos: l.cells.map((c) => ({ ...c })) })), cols: null });
  return { segments, charWidth, height, fused };
}

/** The matrix rows of a segment: its title lines, then its rows. */
const segmentMatrix = (s: Segment): string[][] => [...s.pre.map((l) => l.cells.map((c) => c.text)), ...s.rows.map((r) => r.cells)];

export function textItemsToMatrix(itemsIn: readonly TextItem[], opts: PdfTextOptions = {}): string[][] {
  const out: string[][] = [];
  layoutPage(itemsIn, opts).segments.forEach((s, k) => {
    if (k > 0) out.push([]);
    out.push(...segmentMatrix(s));
  });
  return out;
}

export type PdfTextRead = {
  blocks: ReadBlock[];
  /**
   * Text the reader could not use, one line per page and kind: `page 3: text but no table`, `page 2: 1 row did not
   * line up with the table above`. No cell text is quoted.
   */
  warnings: string[];
};

const nonBlankCells = (r: readonly string[]) => r.filter((c) => c !== "").length;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
  /** The column x spans of the run a block came from. */
  const blockCols = new Map<ReadBlock, readonly (readonly [number, number])[]>();
  pages.forEach((items, p) => {
    const page = layoutPage(items, opts);
    let appended = 0;
    let found = 0;
    let misplaced = 0;
    let offset = 0;
    page.segments.forEach((seg, s) => {
      if (s > 0) offset++;
      const segStart = offset;
      offset += seg.pre.length + seg.rows.length;
      let rows = seg.rows;
      let skipped = 0;
      const prev = [...out].reverse().find((b) => b.rows.length > 0);
      if (p > 0 && s === 0 && prev && seg.cols) {
        // Rows above the first header-like row continue the table of the page before.
        let h = rows.findIndex((r) => isHeaderLike(r.cells));
        if (h === -1) h = rows.length;
        const width = prev.headers.length;
        const cols = blockCols.get(prev);
        rows.slice(0, h).forEach((r) => {
          // A lone short line (a page number, a footer) is noise.
          if (nonBlankCells(r.cells) < 2) return;
          const placed = cols && r.pos ? placeByX(r.pos, cols, width, page.charWidth) : r.cells.length === width ? r.cells : null;
          if (!placed) {
            misplaced++;
            return;
          }
          prev.rows.push(placed);
          appended++;
        });
        rows = rows.slice(h);
        skipped = h;
      }
      // The run alone gives the header; the lines above it are the title of its first block.
      const sheetName = `Page ${p + 1}`;
      const preText = seg.pre.map((l) => l.cells.map((c) => c.text).join(" "));
      let blocks = findBlocks(
        rows.map((r) => r.cells),
        { sheetName },
      );
      if (blocks.length > 0 && preText.length > 0) {
        const b = blocks[0]!;
        b.title = [...preText, ...(b.title ? [b.title] : [])].join(" ");
        b.headerRow += preText.length;
        b.firstDataSheetRow += preText.length;
      } else if (blocks.length === 0 && preText.length > 0) {
        blocks = findBlocks([...seg.pre.map((l) => l.cells.map((c) => c.text)), ...rows.map((r) => r.cells)], { sheetName });
      }
      for (const b of blocks) {
        // Footer lines under a table are not rows (C17): a one-cell line after a blank gap, or one that reads like a
        // signature or a note. A one-cell row at the table's row pitch is data (C-new-4).
        for (;;) {
          const last = b.rows[b.rows.length - 1];
          if (b.headers.length < 2 || !last) break;
          if (nonBlankCells(last) === 0) {
            b.rows.pop();
            continue;
          }
          if (nonBlankCells(last) > 1) break;
          const above = b.rows[b.rows.length - 2];
          const afterGap = above !== undefined && nonBlankCells(above) === 0;
          if (!afterGap && !FOOTER.test(last.find((c) => c !== "")!)) break;
          b.rows.pop();
        }
        b.firstDataSheetRow += segStart + skipped;
        if (seg.cols) blockCols.set(b, seg.cols);
        const last = [...out].reverse().find((x) => x.rows.length > 0);
        const sameHeader = last && found === 0 && last.headers.length === b.headers.length && last.headers.every((h, x) => h.toLowerCase() === b.headers[x]!.toLowerCase());
        if (last && sameHeader) last.rows.push(...b.rows);
        else out.push(b);
        found++;
      }
    });
    if (misplaced > 0) warnings.push(`page ${p + 1}: ${plural(misplaced, "row", "rows")} did not line up with the table above`);
    if (page.fused > 0) warnings.push(`page ${p + 1}: ${plural(page.fused, "row has", "rows have")} two values in one column`);
    if (items.some((i) => i.str.trim() !== "") && found === 0 && appended === 0) warnings.push(`page ${p + 1}: text but no table`);
  });
  // A header with no rows under it (a footer read as a header) is no table.
  return { blocks: out.filter((b) => b.rows.length > 0), warnings };
}

/** Pages of text items to blocks; see `readPdfText`, which also returns the warnings. */
export function readPdfTextBlocks(pages: readonly (readonly TextItem[])[], opts: PdfTextOptions = {}): ReadBlock[] {
  return readPdfText(pages, opts).blocks;
}
