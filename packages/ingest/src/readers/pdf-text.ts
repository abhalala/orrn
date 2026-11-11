/**
 * NOT USED BY THE FIRST PORTAL RELEASE (owner's decision, 2026-11-11). The first release reads sheets, CSV and
 * database dumps only. PDFs and photos are uploaded and kept, marked "kept, not read yet", and the next release reads
 * them with a vision model. Why: the round 5 recheck (PORTAL-R4-CHECK.md) found that on tightly spaced real-looking
 * tables 78 to 100 percent of rows carry a doubt, too many for a person to check by eye, and it still found values
 * under the wrong column with no doubt (B-R5-1, B-R5-3). This file is left as it was at round 5; do not build on it.
 */
/**
 * PDF text layer to tables (plan C2). The input is positioned text items, as a PDF library reports them: no library
 * object crosses this line. Items are grouped into lines by their y and merged into cells by the gaps between them.
 * A table is a run of multi-cell lines; its columns come from projecting the cells of those lines onto the x axis.
 * One-cell lines never widen a column: they are placed into a column or folded into the cell above afterwards, and a
 * one-cell line that is not a row of the table ends the run (C-new-6). Each run goes through `readSheet` like a sheet.
 */
import { cellKind, inferKind } from "../cells";
import { checkHintShape, combineHeaders, couldBeHeader, finishShape, HintError, isHeaderLike, isValueCell, isWord, previewIndices, readSheet, regionStartOf, TITLE_MARK } from "./blocks";
import { type BlockHints, type DoubtCode, type PreviewRow, type ReadBlock, type RowDoubt, type RowWarning } from "./types";

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
  /**
   * Hints for blocks, each naming its `page` (1-based); row numbers are lines on the page (0-based, the numbers in a
   * block's `preview`). The pages a hint covers (`page` to `lastPage`) follow the hints exactly; other pages are guessed.
   */
  hints?: readonly BlockHints[] | null;
};

/** A text item as placed on the page. */
type Part = { text: string; x0: number; x1: number };
/** Items on one line close enough to read as one cell. `parts`: the items it was merged from, left to right. */
type Cell = { text: string; x0: number; x1: number; parts?: Part[] };
/** A line of text on the page; `n` is its 0-based line number, the raw row number of a PDF page. */
type Line = { y: number; cells: Cell[]; n: number };
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
  /** First and last page line of the row (a folded line makes them differ); -1 for a blank gap row. */
  line: number;
  last: number;
};

/**
 * A table run and the lines that belong with it. `pre` are the lines above the run that are not rows of it (titles);
 * `cols` is null for the lines left over at the end of a page, which hold no table.
 */
type Segment = {
  pre: Line[];
  rows: LayoutRow[];
  cols: Col[] | null;
  /** A line with one cell was folded or kept as a row; a line did not fit the columns one to one. */
  oneCell: boolean;
  notFit: boolean;
};

type PageLayout = { segments: Segment[]; charWidth: number; height: number; fused: number; lines: Line[] };

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

/**
 * Does the line fit once the spans take it in (R-new-2)? A header alone gives narrow spans: a value right-aligned under
 * "Kg" can be far wider than "Kg". A data line (not header-like) fits when the spans rebuilt with it keep the same number
 * of columns and it then fits them one cell to one column. A header-like line never widens: it may head the next table.
 */
function fitsWidened(members: readonly Line[], cols: readonly Col[], l: Line, charWidth: number): boolean {
  if (isHeaderLike(l.cells.map((c) => c.text))) return false;
  const wider = buildCols([...members, l], charWidth);
  return wider.length === cols.length && fitsColumns(wider, l, charWidth);
}


/**
 * Is the line a new header? Either words over columns where the run's data rows hold numbers, dates or codes (a code
 * such as "T4012" or a blank-value word such as "Nil" there is a data value): two such columns for a line at the row
 * pitch that fits the columns one to one, one for any other line; or a line of words only that does not fit the columns, under
 * data rows that hold numbers. A row of words that fits the columns (a name and a city) is data.
 */
function isNewHeader(cols: readonly Col[], l: Line, members: readonly Line[], charWidth: number, afterBreak: boolean, nextLine?: Line): boolean {
  if (!isHeaderLike(l.cells.map((c) => c.text))) return false;
  const headed = members.length > 1 && isHeaderLike(members[0]!.cells.map((c) => c.text));
  const data = headed ? members.slice(1) : members;
  if (
    headed &&
    l.cells.every((c) => isWord(c.text)) &&
    data.some((m) => m.cells.some((d) => {
      const k = cellKind(d.text);
      return k === "int" || k === "decimal";
    })) &&
    !fitsColumns(cols, l, charWidth)
  ) {
    return true;
  }
  const kindAt = (c: Cell) => {
    const k = nearestColumn(cols, c, charWidth);
    return inferKind(data.flatMap((m) => m.cells.filter((d) => nearestColumn(cols, d, charWidth) === k).map((d) => d.text)));
  };
  const wordsOverValues = l.cells.filter((c) => {
    if (!isWord(c.text)) return false;
    const kind = kindAt(c);
    return kind === "int" || kind === "decimal" || kind === "date" || kind === "code";
  }).length;
  // The line after does not read like a row of this table: a number under a column of words, or a word under numbers.
  const nextIsOther =
    nextLine !== undefined &&
    nextLine.cells.some((c) => {
      const kind = kindAt(c);
      const own = cellKind(c.text);
      return ((kind === "int" || kind === "decimal" || kind === "date") && isWord(c.text)) || (kind === "text" && (own === "int" || own === "decimal"));
    });
  // A line at the row pitch that fits the columns one to one is a row with a remark in it ("Shree | T 4012 | Nil |
  // Cancelled") unless words sit over two or more columns of values (R3-9): once the header is found, a row is not
  // taken as a header. After a blank gap or a line that is not part of a row (a title such as "Summary"), before a
  // line that does not read like a row of this table, or when it does not fit, one such word is enough.
  return wordsOverValues >= (fitsColumns(cols, l, charWidth) && !afterBreak && !nextIsOther ? 2 : 1);
}

type Entry = { line: number } | { gap: true };

/** The page's text as lines, top to bottom: items on one baseline, merged into cells by the gaps between them. */
function pageLines(itemsIn: readonly TextItem[], opts: PdfTextOptions): { lines: Line[]; charWidth: number; height: number } {
  const items = itemsIn.filter((i) => i.str.trim() !== "");
  if (items.length === 0) return { lines: [], charWidth: 5, height: 10 };
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
      const part: Part = { text: it.str, x0: it.x, x1: it.x + it.width };
      if (last && it.x - last.x1 <= gap) {
        const space = it.x - last.x1 > charWidth * 0.2 && !last.text.endsWith(" ") && !it.str.startsWith(" ") ? " " : "";
        last.text += space + it.str;
        last.x1 = Math.max(last.x1, it.x + it.width);
        last.parts!.push(part);
      } else cells.push({ text: it.str, x0: it.x, x1: it.x + it.width, parts: [part] });
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, " ").trim();
    const kept = cells.filter((c) => !PAGE_MARK.test(c.text));
    if (kept.length > 0) lines.push({ y: lineY, cells: kept, n: lines.length });
    current = [];
  };
  for (const it of sorted) {
    if (current.length > 0 && Math.abs(it.y - lineY) > lineTol) flush();
    if (current.length === 0) lineY = it.y;
    current.push(it);
  }
  flush();
  return { lines, charWidth, height };
}

function layoutPage(itemsIn: readonly TextItem[], opts: PdfTextOptions): PageLayout {
  const { lines, charWidth, height } = pageLines(itemsIn, opts);
  if (lines.length === 0) return { segments: [], charWidth, height, fused: 0, lines };

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
      // A first line of colon labels or a date ("Party: ... Date: ...") over lines it does not fit is a title.
      if (members.length === 1 && members[0]!.cells.some((c) => TITLE_MARK.test(c.text)) && !fitsColumns(cols, l, charWidth)) {
        return { entries, end: j };
      }
      // Waiting lines that are wrapped lines of the last row do not break the run.
      const wraps = big ? 0 : countWraps(entries, cols, members[members.length - 1]!, pending);
      const plain = !big && wraps === pending.length;
      // A new header ends the run whether or not lines wait and whether or not it fits the columns (C-new-6).
      const newHead = isNewHeader(cols, l, members, charWidth, !plain, lines.slice(j + 1).find((x) => x.cells.length >= 2));
      if (newHead || (!plain && !fitsColumns(cols, l, charWidth) && !fitsWidened(members, cols, l, charWidth))) {
        // Lines across a blank gap from the next table belong to this run: trailing rows or footers.
        if (big) {
          entries.push(...pending);
          return { entries, end: j };
        }
        // Wrapped lines stay with the run, and so do lines in a column of the table (rows with one value), but the
        // last waiting line heads the next table and a line in no column ends the run.
        let keep = wraps;
        while (keep < pending.length - 1 && columnOf(cols, lines[(pending[keep] as { line: number }).line]!.cells[0]!, charWidth) !== -1) keep++;
        entries.push(...pending.slice(0, keep));
        const first = pending[keep];
        return { entries, end: first && "line" in first ? first.line : j };
      }
      if (big) pending.push({ gap: true });
      entries.push(...pending, { line: j });
      pending = [];
      members.push(l);
      // The spans change only when a cell reaches outside them.
      if (!l.cells.every((c) => cols.some(([a, b]) => c.x0 >= a && c.x1 <= b))) cols = buildCols(members, charWidth);
    }
    // Trailing one-cell lines within 3 line heights stay with the run (data rows, or footers the reader drops).
    entries.push(...pending);
    return { entries, end: j };
  };

  /** Columns, row pitch and key columns of a run made of these lines. */
  type Shape = { cols: Col[]; pitch: number; key: Set<number> };
  const shapeOf = (lineIdx: readonly number[], known?: Col[]): Shape => {
    const multiLines = lineIdx.filter(multi).map((j) => lines[j]!);
    const cols = known ?? buildCols(multiLines, charWidth);
    // The row pitch: the median gap between two multi-cell lines next to each other.
    const pitches: number[] = [];
    for (let x = 1; x < lineIdx.length; x++) {
      const a = lineIdx[x - 1]!;
      const b = lineIdx[x]!;
      if (b === a + 1 && multi(a) && multi(b)) pitches.push(dy(a, b));
    }
    // With no two multi-cell lines next to each other, the median gap between any two lines of the run.
    const anyGaps: number[] = [];
    for (let x = 1; x < lineIdx.length; x++) if (lineIdx[x] === lineIdx[x - 1]! + 1) anyGaps.push(dy(lineIdx[x - 1]!, lineIdx[x]!));
    const pitch = median(pitches, median(anyGaps, height * 1.5));
    // Key columns: the first column, and every column whose data cells are numbers. A wrapped line never sits there.
    const data = multiLines.length > 1 && isHeaderLike(multiLines[0]!.cells.map((c) => c.text)) ? multiLines.slice(1) : multiLines;
    const key = new Set<number>([0]);
    cols.forEach((_, k) => {
      const kind = inferKind(data.flatMap((l) => l.cells.filter((c) => nearestColumn(cols, c, charWidth) === k).map((c) => c.text)));
      if (kind === "int" || kind === "decimal") key.add(k);
    });
    return { cols, pitch, key };
  };

  /**
   * Is a one-cell line a wrapped line of the row above? It sits clearly closer than the row pitch (C17, C-new-3), or,
   * in a tight table, within the pitch, under a filled cell of the row above, outside the key columns (C-new-7).
   */
  const isWrap = (shape: Shape, gapAbove: number, k: number, above: Cell | undefined, c: Cell) =>
    gapAbove < shape.pitch * 0.75 ||
    (gapAbove <= shape.pitch * 1.05 &&
      above !== undefined &&
      !shape.key.has(k) &&
      // Wrapped text starts where the cell above starts and stays inside its column.
      Math.abs(c.x0 - above.x0) <= charWidth &&
      c.x1 < (shape.cols[k + 1]?.[0] ?? Infinity));

  /** How many of the waiting one-cell lines, from the first, are wrapped lines of the run's last row. */
  const countWraps = (entries: readonly Entry[], cols: Col[], lastRow: Line, pending: readonly Entry[]): number => {
    if (pending.length === 0) return 0;
    const shape = shapeOf(
      entries.flatMap((e) => ("line" in e ? [e.line] : [])),
      cols,
    );
    let above = (entries[entries.length - 1] as { line: number }).line;
    let n = 0;
    for (const e of pending) {
      if (!("line" in e)) break;
      const c = lines[e.line]!.cells[0]!;
      const k = nearestColumn(shape.cols, c, charWidth);
      const cellAbove = lastRow.cells.find((d) => nearestColumn(shape.cols, d, charWidth) === k);
      if (!isWrap(shape, dy(above, e.line), k, cellAbove, c)) break;
      above = e.line;
      n++;
    }
    return n;
  };

  let fused = 0;
  const emitRun = (entries: readonly Entry[]): { rows: LayoutRow[]; cols: Col[]; oneCell: boolean; notFit: boolean } => {
    const shape = shapeOf(entries.flatMap((e) => ("line" in e ? [e.line] : [])));
    const cols = shape.cols;
    const rows: LayoutRow[] = [];
    let prev = -1;
    let oneCell = false;
    let notFit = false;
    for (const e of entries) {
      if (!("line" in e)) {
        rows.push({ cells: [], pos: null, line: -1, last: -1 });
        prev = -1;
        continue;
      }
      const l = lines[e.line]!;
      if (l.cells.length === 1) {
        oneCell = true;
        const c = l.cells[0]!;
        const k = nearestColumn(cols, c, charWidth);
        const last = rows[rows.length - 1];
        // A wrapped line joins the cell above; any other one-cell line is a row with the other cells blank.
        const gapAbove = prev === -1 ? Infinity : dy(prev, e.line);
        const cellAbove = last?.pos?.find((p) => nearestColumn(cols, p, charWidth) === k);
        const wrapped = isWrap(shape, gapAbove, k, cellAbove, c);
        if (wrapped && last && last.pos) {
          last.last = e.line;
          last.cells[k] = last.cells[k] === "" ? c.text : `${last.cells[k]} ${c.text}`;
          const at = last.pos.find((p) => columnOf(cols, p, charWidth) === k);
          if (at) {
            at.text = last.cells[k]!;
            at.x1 = Math.max(at.x1, c.x1);
          } else last.pos.push({ ...c });
        } else {
          // A line of text alone (a signature, a party-only row) starts in its column; a long one reaches into the next.
          const kind = cellKind(c.text);
          const starts = kind === "int" || kind === "decimal" ? -1 : cols.findIndex(([a, b]) => c.x0 >= a - charWidth && c.x0 <= b);
          const cells = Array<string>(cols.length).fill("");
          cells[starts !== -1 ? starts : k] = c.text;
          rows.push({ cells, pos: [{ ...c }], line: e.line, last: e.line });
        }
        prev = e.line;
        continue;
      }
      const cells = Array<string>(cols.length).fill("");
      if (!fitsColumns(cols, l, charWidth)) notFit = true;
      for (const c of l.cells) {
        const k = nearestColumn(cols, c, charWidth);
        if (cells[k] !== "") fused++;
        cells[k] = cells[k] === "" ? c.text : `${cells[k]} ${c.text}`;
      }
      rows.push({ cells, pos: l.cells.map((c) => ({ ...c })), line: e.line, last: e.line });
      prev = e.line;
    }
    return { rows, cols, oneCell, notFit };
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
    const { rows, cols, oneCell, notFit } = emitRun(entries);
    segments.push({ pre, rows, cols, oneCell, notFit });
    pre = [];
    i = end;
  }
  if (pre.length > 0) {
    const rows = pre.map((l) => ({ cells: l.cells.map((c) => c.text), pos: l.cells.map((c) => ({ ...c })), line: l.n, last: l.n }));
    segments.push({ pre: [], rows, cols: null, oneCell: true, notFit: true });
  }
  return { segments, charWidth, height, fused, lines };
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
  /** Lines no block took, with their page and line number. No cell text is quoted. */
  rowWarnings: RowWarning[];
  /**
   * Text the reader could not use, one line per page and kind: `page 3: text but no table`, `page 2: 1 row did not
   * line up with the table above`. No cell text is quoted.
   */
  warnings: string[];
};

const nonBlankCells = (r: readonly string[]) => r.filter((c) => c !== "").length;
const lineText = (l: Line) => l.cells.map((c) => c.text).join(" ");
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Is the line the title of the table above again, or a "continued" mark? Such a line is dropped on purpose. A line
 * that is only part of the old title counts only above a repeated header (`partOk`): above data it may be a row.
 */
function repeatsTitle(text: string, title: string | null, partOk: boolean): boolean {
  const t = squash(text);
  if (/^(?:continued|contd)\b/.test(t)) return true;
  if (!title || t === "") return false;
  const was = squash(title);
  return was === t || t.includes(was) || (partOk && was.includes(t));
}
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
 * Does a line placed under the columns of the table above read like one of its rows (R3-3)? Not when it could be a
 * header (see `couldBeHeader`), when a word sits in a column of numbers or dates, or a number in a column of words.
 * A line that does not place is reported elsewhere, so it does not decide here.
 */
function continuesTable(prev: ReadBlock, placed: string[] | null, next: string[] | undefined): boolean {
  if (!placed) return true;
  // Numbers of one size are common in data rows; only the stronger signs refuse a continuation.
  if (couldBeHeader(placed, next, prev.rows[prev.rows.length - 1], false)) return false;
  return placed.every((v, k) => {
    if (v === "") return true;
    const kind = inferKind(prev.rows.map((r) => r[k] ?? ""));
    const own = cellKind(v);
    if ((kind === "int" || kind === "decimal" || kind === "date") && isWord(v)) return false;
    return !(kind === "text" && (own === "int" || own === "decimal"));
  });
}

/** Page lines of a matrix row: first and last line (a folded line makes them differ); -1 for a blank row. */
type Src = { line: number; last: number };
const srcOf = (r: LayoutRow): Src => ({ line: r.line, last: r.last });

/**
 * The lines above a header-less run and the run's rows as one matrix, every line placed by x (R-new-2). First into the
 * run's columns; when a line above does not fit them, into columns rebuilt from the multi-cell lines above and the
 * run's rows together (a header line over a run with a column it does not name). A line that still fits no column is
 * left out and its line number returned.
 */
function placeAbove(pre: readonly Line[], rows: readonly LayoutRow[], cols: Col[] | null, charWidth: number): { matrix: string[][]; src: Src[]; unplaced: number[] } {
  if (cols) {
    const placed = pre.map((l) => placeByX(l.cells, cols, cols.length, charWidth));
    if (placed.every((p) => p !== null)) {
      return {
        matrix: [...(placed as string[][]), ...rows.map((r) => r.cells)],
        src: [...pre.map((l) => ({ line: l.n, last: l.n })), ...rows.map(srcOf)],
        unplaced: [],
      };
    }
  }
  const multiLines = [...pre.filter((l) => l.cells.length >= 2), ...rows.flatMap((r) => (r.pos && r.pos.length >= 2 ? [{ y: 0, cells: r.pos, n: r.line }] : []))];
  const wide = buildCols(multiLines, charWidth);
  const matrix: string[][] = [];
  const src: Src[] = [];
  const unplaced: number[] = [];
  const all = [...pre.map((l) => ({ cells: l.cells as Cell[] | null, line: l.n, last: l.n })), ...rows.map((r) => ({ cells: r.pos, line: r.line, last: r.last }))];
  for (const x of all) {
    if (x.cells === null || x.cells.length === 0) {
      matrix.push([]);
      src.push({ line: -1, last: -1 });
      continue;
    }
    const p = placeByX(x.cells, wide, wide.length, charWidth);
    if (p) {
      matrix.push(p);
      src.push({ line: x.line, last: x.last });
    } else unplaced.push(x.line);
  }
  return { matrix, src, unplaced };
}

/**
 * Raw rows of a PDF page for a preview: lines `from` to `to`, each as its cells, with the 1-based `page`, at most
 * the window `previewIndices` gives.
 */
function linesPreview(lines: readonly Line[], from: number, to: number, page: number, header: number, headerRows: number): PreviewRow[] {
  const end = Math.min(to + 1, lines.length);
  const hasValue = (n: number) => lines[n]!.cells.some((c) => isValueCell(c.text));
  return previewIndices(Math.max(from, 0), end, header, headerRows, hasValue).map((n) => ({ row: n, page, cells: lines[n]!.cells.map((c) => c.text) }));
}

/** Where a guessed PDF block's region starts, for the lines listed when it holds no rows. */
type BlockMeta = { regionStart: number; page: number; headEnd: number };
/** The page lines of one row of a guessed block: 0-based page, first and last line (a wrapped line makes them differ). */
type RowSrc = { p: number; line: number; last: number };

// ---------------------------------------------------------------- columns from the header (rule 5.3)

const partsOf = (c: Cell): Part[] => c.parts ?? [{ text: c.text, x0: c.x0, x1: c.x1 }];

/** Two parts of one cell joined as `pageLines` joins items: a space when they do not touch. */
function joinParts(left: string, leftX1: number, p: Part, charWidth: number): string {
  const space = p.x0 - leftX1 > charWidth * 0.2 && !left.endsWith(" ") && !p.text.startsWith(" ") ? " " : "";
  return (left + space + p.text).replace(/\s+/g, " ").trim();
}

/** The columns of a header: one band per header cell, from the midpoint with its left neighbour to the one with its right. */
type Bands = { anchors: Col[]; edges: number[]; charWidth: number };

/** A line's cells as spans, split where two items of a cell sit more than one character apart ("Rate" and "Vehicle", M5). */
function headSpans(l: Line, charWidth: number): Col[] {
  const out: Col[] = [];
  for (const c of l.cells) {
    let open: Col | null = null;
    for (const p of partsOf(c)) {
      if (open && p.x0 - open[1] <= charWidth) open[1] = Math.max(open[1], p.x1);
      else {
        open = [p.x0, p.x1];
        out.push(open);
      }
    }
  }
  return out;
}

/**
 * The bands of a header (PORTAL-RULES-3 section 5.3). The header's cells, left to right: the cells of its bottom line,
 * and cells of a line above that sit over no cell below (a name such as "Party" whose bottom cell is blank). The edge
 * between two bands is the midpoint between the nearest edges of their header cells; the first and last bands run to
 * the page edges. This holds for left-aligned, right-aligned and centred headers alike.
 */
function bandsOf(headLines: readonly Line[], charWidth: number): Bands {
  const bottom = headSpans(headLines[headLines.length - 1]!, charWidth);
  const anchors: Col[] = [...bottom];
  for (const l of headLines.slice(0, -1)) {
    for (const sp of headSpans(l, charWidth)) if (!bottom.some((b) => sp[0] < b[1] && sp[1] > b[0])) anchors.push(sp);
  }
  anchors.sort((a, b) => a[0] - b[0]);
  const edges = anchors.slice(1).map((a, k) => (anchors[k]![1] + a[0]) / 2);
  return { anchors, edges, charWidth };
}

const bandOf = (b: Bands, x: number) => {
  let k = 0;
  while (k < b.edges.length && x >= b.edges[k]!) k++;
  return k;
};

/** Where a cell of a line was placed: its band and its x extent. */
type Span = { band: number; x0: number; x1: number };
type Placed = { cells: string[]; doubts: DoubtCode[]; spans: Span[] };

/**
 * A line's items in the bands: each item goes to the band that holds its horizontal centre. `head`: a header line,
 * where an item over a header cell names that cell's band (a group name over several names the first). `row`: a data
 * line, with the doubts of rule 5.3 that one line shows. `fold`: the wrapped rest of a row, checked only for crossing.
 *
 * When two cells of a data line fall in one band and the band next to the outer one is empty on that line, the outer
 * cell moves there: a number right-aligned at the end of a wide column can sit past the midpoint to a short
 * left-aligned name (R4-5). The line still carries `cells_joined`, so the move is never silent.
 */
function placeOnBands(l: Line, b: Bands, mode: "head" | "row" | "fold"): Placed {
  const n = b.anchors.length;
  const doubts = new Set<DoubtCode>();
  // Groups: the parts of one cell that fall in one band, left to right.
  type Group = { band: number; cell: Cell; parts: Part[] };
  const groups: Group[] = [];
  for (const c of l.cells) {
    for (const p of partsOf(c)) {
      const mid = (p.x0 + p.x1) / 2;
      const over = mode === "head" ? b.anchors.findIndex(([a, z]) => p.x0 < z && p.x1 > a) : -1;
      const k = over !== -1 ? over : bandOf(b, mid);
      if (mode !== "head") {
        const lo = k === 0 ? -Infinity : b.edges[k - 1]!;
        const hi = k === n - 1 ? Infinity : b.edges[k]!;
        const w = p.x1 - p.x0;
        if (lo - p.x0 > w / 4 || p.x1 - hi > w / 4) doubts.add("crosses_column");
      }
      // Parts of one cell are one phrase only when they sit at most one character apart (as `headSpans` splits a
      // header): two values 8 points apart were merged into one cell by `pageLines`, but are two cells here.
      const last = groups[groups.length - 1];
      const lastX1 = last ? last.parts[last.parts.length - 1]!.x1 : -Infinity;
      if (last && last.band === k && last.cell === c && p.x0 - lastX1 <= b.charWidth) last.parts.push(p);
      else groups.push({ band: k, cell: c, parts: [p] });
    }
  }
  if (mode === "row") {
    const used = (k: number) => groups.some((g) => g.band === k);
    for (let k = 0; k < n; k++) {
      const inBand = groups.filter((g) => g.band === k);
      if (inBand.length < 2) continue;
      doubts.add("cells_joined");
      if (k > 0 && !used(k - 1)) inBand[0]!.band = k - 1;
      else if (k < n - 1 && !used(k + 1)) inBand[inBand.length - 1]!.band = k + 1;
    }
  }
  const cells = Array<string>(n).fill("");
  const spans: Span[] = [];
  let prev: { band: number; x1: number } | null = null;
  for (const g of groups) {
    let text = "";
    let x1 = -Infinity;
    for (const p of g.parts) {
      text = text === "" ? p.text.trim() : joinParts(text, x1, p, b.charWidth);
      x1 = p.x1;
    }
    cells[g.band] = cells[g.band] === "" ? text : `${cells[g.band]} ${text}`;
    spans.push({ band: g.band, x0: g.parts[0]!.x0, x1 });
    if (mode === "row" && prev && prev.band !== g.band && g.parts[0]!.x0 - prev.x1 < b.charWidth * 2) doubts.add("cells_close");
    prev = { band: g.band, x1 };
  }
  if (mode === "row" && n >= 2 && cells.filter((x) => x !== "").length * 2 < n) doubts.add("few_columns");
  return { cells, doubts: [...doubts], spans };
}

/**
 * Which placed lines hold a cell that does not line up with its column: a value under a blank header cell put in the
 * band of a named neighbour, or a remark past the edge of the table (`off_column`). In each band the cells of the
 * block's lines are grouped by a shared left or right edge (within half a character). A cell lines up when it
 * overlaps the band's header cell, when its group holds a cell that does, or when the band has one group only (a
 * right-aligned number past a short left-aligned name lines up with the numbers above and below it).
 */
function offColumn(placed: readonly Placed[], b: Bands): Set<number> {
  const out = new Set<number>();
  const tol = b.charWidth / 2;
  for (let k = 0; k < b.anchors.length; k++) {
    const [a, z] = b.anchors[k]!;
    const cells: { line: number; x0: number; x1: number; head: boolean }[] = [];
    placed.forEach((pl, i) => {
      for (const sp of pl.spans) if (sp.band === k) cells.push({ line: i, x0: sp.x0, x1: sp.x1, head: sp.x0 < z && sp.x1 > a });
    });
    if (cells.length === 0) continue;
    const root = cells.map((_, i) => i);
    const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i]!)));
    // Sorting by each edge joins neighbours in one pass per edge.
    for (const edge of ["x0", "x1"] as const) {
      const order = cells.map((_, i) => i).sort((p, q) => cells[p]![edge] - cells[q]![edge]);
      for (let j = 1; j < order.length; j++) {
        if (cells[order[j]!]![edge] - cells[order[j - 1]!]![edge] <= tol) root[find(order[j]!)] = find(order[j - 1]!);
      }
    }
    const good = new Set(cells.map((c, i) => (c.head ? find(i) : -1)).filter((r) => r !== -1));
    const groups = new Set(cells.map((_, i) => find(i)));
    if (good.size === 0 && groups.size === 1) continue;
    cells.forEach((c, i) => {
      if (!c.head && !good.has(find(i))) out.add(c.line);
    });
  }
  return out;
}

/** A wrapped line's cells added to the row above it, column by column. */
function foldInto(row: string[], cells: readonly string[]): void {
  cells.forEach((c, k) => {
    if (c !== "") row[k] = row[k] === "" ? c : `${row[k]} ${c}`;
  });
}

/** The header names of header lines in the bands: one line as is, two lines combined as a sheet combines them. */
function headersOnBands(headLines: readonly Line[], b: Bands): string[] {
  const placed = headLines.map((l) => placeOnBands(l, b, "head").cells);
  return placed.slice(1).reduce((top, next) => combineHeaders(top, next), placed[0]!);
}

/** Preview rows as the block's cells (M4): header lines as header names, every other line by the bands. */
function previewOnBands(preview: readonly PreviewRow[], linesOf: (page: number) => readonly Line[], b: Bands, head: { page: number; from: number; to: number }): PreviewRow[] {
  return preview.map((pr) => {
    const l = linesOf(pr.page ?? 1)[pr.row];
    if (!l) return pr;
    const isHead = pr.page === head.page && pr.row >= head.from && pr.row <= head.to;
    return { ...pr, cells: placeOnBands(l, b, isHead ? "head" : "row").cells };
  });
}

/** One row of a banded block: its first line, and wrapped lines folded into it. */
type BandRowSource = { lines: { line: Line; page: number }[] } | null;

/**
 * Rows from their lines in the bands, with every doubt on its row: the doubts of each line, and `off_column` for a
 * line with a cell that does not line up with its column (`offColumn`, over all lines of the block).
 */
function rowsOnBands(sources: readonly BandRowSource[], b: Bands): { rows: string[][]; doubts: RowDoubt[] } {
  const n = b.anchors.length;
  const placed: Placed[] = [];
  const at: { row: number; line: number; page: number }[] = [];
  const doubts: RowDoubt[] = [];
  const rows = sources.map((src, r) => {
    if (!src) return Array<string>(n).fill("");
    let row: string[] = [];
    src.lines.forEach(({ line, page }, k) => {
      const pl = placeOnBands(line, b, k === 0 ? "row" : "fold");
      if (k === 0) row = pl.cells;
      else foldInto(row, pl.cells);
      placed.push(pl);
      at.push({ row: r, line: line.n, page });
      for (const code of pl.doubts) doubts.push({ row: r, code, line: line.n, page });
    });
    return row;
  });
  for (const i of offColumn(placed, b)) doubts.push({ row: at[i]!.row, code: "off_column", line: at[i]!.line, page: at[i]!.page });
  // One entry per row and code, in row order.
  const seen = new Set<string>();
  const unique = doubts
    .sort((x, y) => x.row - y.row || x.line - y.line)
    .filter((d) => {
      const key = `${d.row}:${d.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return { rows, doubts: unique };
}

/**
 * A guessed block's columns from its header (rule 5.3): the guess decides which lines are the header and which are
 * rows; the header's cells then give the columns, and each row's lines are placed in them, with doubt marked on the
 * row. The preview is given in the same columns.
 */
function bandGuessed(b: ReadBlock, m: BlockMeta, srcs: readonly (RowSrc | null)[], pageOf: (q: number) => { lines: Line[]; charWidth: number }): void {
  const { lines, charWidth } = pageOf(m.page);
  const headFrom = b.guess.headerRow;
  const headLines = lines.slice(headFrom, m.headEnd + 1);
  if (headLines.length === 0) return;
  const bands = bandsOf(headLines, charWidth);
  const sources: BandRowSource[] = srcs.map((sr) => {
    if (!sr) return null;
    const ls = pageOf(sr.p).lines;
    const out: { line: Line; page: number }[] = [];
    for (let n = sr.line; n <= sr.last; n++) out.push({ line: ls[n]!, page: sr.p + 1 });
    return { lines: out };
  });
  const placed = rowsOnBands(sources, bands);
  b.headers = headersOnBands(headLines, bands);
  b.rows = placed.rows;
  b.doubts = placed.doubts;
  b.preview = previewOnBands(b.preview, (pg) => pageOf(pg - 1).lines, bands, { page: m.page + 1, from: headFrom, to: m.headEnd });
}

/**
 * Pages of text items to blocks. A table that continues on the next page is one block: the header repeated at the top
 * of the next page is dropped, and data rows at the top of a page with no header join the table above (C16). Those
 * rows are placed under the table's columns by x, so a column blank on the whole page stays blank (C-new-2).
 *
 * Pages covered by `hints` follow them exactly (see `readPdfByHints`).
 */
export function readPdfText(pages: readonly (readonly TextItem[])[], opts: PdfTextOptions = {}): PdfTextRead {
  const hinted = opts.hints && opts.hints.length > 0 ? readPdfByHints(pages, opts.hints, opts) : null;
  const covered = hinted?.covered ?? new Set<number>();
  const out: ReadBlock[] = [];
  const warnings: string[] = [];
  const rowWarnings: RowWarning[] = [...(hinted?.rowWarnings ?? [])];
  /** The column x spans of the run a block came from. */
  const blockCols = new Map<ReadBlock, readonly (readonly [number, number])[]>();
  const meta = new Map<ReadBlock, BlockMeta>();
  /** For each guessed block, the page lines of each of its rows (null for a blank row), to place them by the header. */
  const rowSrc = new Map<ReadBlock, (RowSrc | null)[]>();
  const pageLinesOf = new Map<number, { lines: Line[]; charWidth: number }>();
  pages.forEach((items, p) => {
    if (covered.has(p)) return;
    const page = layoutPage(items, opts);
    pageLinesOf.set(p, { lines: page.lines, charWidth: page.charWidth });
    /** The blocks of this page, for footers listed under the last of them. */
    const onPage: ReadBlock[] = [];
    const lost = (line: number) => rowWarnings.push({ code: "not_placed", row: line, page: p + 1 });
    const touch = (b: ReadBlock, last: number) => {
      if (!onPage.includes(b)) onPage.push(b);
      if (last >= 0) {
        b.guess.lastPage = p + 1;
        b.guess.lastDataRow = last;
      }
    };
    let appended = 0;
    let found = 0;
    let misplaced = 0;
    let unplaced = 0;
    let leftover = 0;
    let offset = 0;
    page.segments.forEach((seg, s) => {
      if (s > 0) offset++;
      const segStart = offset;
      offset += seg.pre.length + seg.rows.length;
      let rows = seg.rows;
      let skipped = 0;
      const prev = [...out].reverse().find((b) => b.rows.length > 0);
      let pre = seg.pre;
      if ((p > 0 || s > 0) && prev && seg.cols) {
        // Rows above the first header-like row continue the table above: the table of the page before, or the one
        // above on this page when its run broke off (a run with no header of its own).
        let h = rows.findIndex((r) => isHeaderLike(r.cells));
        if (h === -1) h = rows.length;
        // The first line to continue must read like a row of the table above, not like a header of a new one (R3-3).
        if (h > 0) {
          const cands = [...pre.map((l) => l.cells), ...rows.slice(0, h).flatMap((r) => (r.pos ? [r.pos] : []))].filter((c) => c.length >= 2);
          const colsAbove = blockCols.get(prev);
          const placeLine = (cells: readonly Cell[] | undefined) => (cells && colsAbove ? placeByX(cells, colsAbove, prev.headers.length, page.charWidth) : null);
          if (!continuesTable(prev, placeLine(cands[0]), placeLine(cands[1]) ?? undefined)) h = 0;
        }
        // The page title repeated above a continuation is not a row and not a new title. It is listed, not dropped.
        if (s === 0) {
          pre = pre.filter((l) => {
            if (!repeatsTitle(lineText(l), prev.title, h === 0)) return true;
            prev.warnings.push({ code: "title_repeated", row: l.n, page: p + 1 });
            return false;
          });
        }
        const width = prev.headers.length;
        const cols = blockCols.get(prev);
        const place = (cells: readonly Cell[] | null, flat: string[], lone: boolean, src: Src) => {
          const placed = cols && cells ? placeByX(cells, cols, width, page.charWidth) : flat.length === width ? flat : null;
          if (placed) {
            prev.rows.push(placed);
            rowSrc.get(prev)?.push({ p, line: src.line, last: src.last });
            appended++;
            touch(prev, src.last);
          } else {
            if (lone) unplaced++;
            else misplaced++;
            lost(src.line);
          }
        };
        if (h > 0) {
          // One-cell lines above the continuation rows are rows too (a party-only row), placed by x or reported.
          for (const l of pre) place(l.cells, l.cells.map((c) => c.text), l.cells.length < 2, { line: l.n, last: l.n });
          pre = [];
        }
        for (const r of rows.slice(0, h)) {
          const n = nonBlankCells(r.cells);
          if (n === 0) continue;
          place(r.pos, r.cells, n < 2, srcOf(r));
        }
        rows = rows.slice(h);
        skipped = h;
      }
      // The run alone gives the header; the lines above it are the title of its first block.
      const sheetName = `Page ${p + 1}`;
      const preText = pre.map(lineText);
      let matrix = rows.map((r) => r.cells);
      let src = rows.map(srcOf);
      let read = readSheet(matrix, { sheetName, noHeaderGuess: true });
      let blocks = read.blocks;
      let titleLines = 0;
      if (blocks.length > 0 && preText.length > 0) {
        const b = blocks[0]!;
        b.title = [...preText, ...(b.title ? [b.title] : [])].join(" ");
        b.headerRow += preText.length;
        b.firstDataSheetRow += preText.length;
        titleLines = preText.length;
      } else if (blocks.length === 0 && preText.length > 0) {
        // The run has no header, so the header may sit in the lines above. They are placed by x, never fed as raw cell
        // lists (R-new-2); a line that fits no column is reported.
        const placed = placeAbove(pre, rows, seg.cols, page.charWidth);
        unplaced += placed.unplaced.length;
        placed.unplaced.forEach(lost);
        matrix = placed.matrix;
        src = placed.src;
        read = readSheet(matrix, { sheetName, noHeaderGuess: true });
        blocks = read.blocks;
      }
      // No line looks like a header: the first line of two or more cells is the guess (R3-5).
      if (blocks.length === 0) {
        read = readSheet(matrix, { sheetName });
        blocks = read.blocks;
      }
      // Lines of this run that no block took: listed and counted (R3-3).
      const leftOver = new Set<number>(blocks.length > 0 ? read.warnings.map((w) => w.row) : []);
      if (blocks.length === 0) {
        // A signature or a note under a table on this page is left out on purpose and listed with that table (C17).
        const above = onPage[onPage.length - 1];
        const isFooter = (text: string) => above !== undefined && FOOTER.test(text);
        for (const l of pre) {
          if (isFooter(lineText(l))) above!.warnings.push({ code: "footer_left_out", row: l.n, page: p + 1 });
          else leftOver.add(-1 - l.n);
        }
        matrix.forEach((cells, k) => {
          const at = src[k];
          if (at && at.line >= 0 && at.line === at.last && isFooter(cells.filter((c) => c !== "").join(" "))) above!.warnings.push({ code: "footer_left_out", row: at.line, page: p + 1 });
          else leftOver.add(k);
        });
      }
      for (const k of leftOver) {
        if (k < 0) {
          lost(-1 - k);
          leftover++;
          continue;
        }
        const at = src[k];
        if (!at || at.line < 0) continue;
        for (let n = at.line; n <= at.last; n++) lost(n);
        leftover++;
      }
      blocks.forEach((b, bi) => {
        const g = b.guess;
        const first = g.firstDataRow!;
        // Warnings from the sheet reader count matrix rows: they become page lines with the page (R4-7). The lines above
        // the run that became the first block's title are listed too.
        const listed: RowWarning[] = bi === 0 ? pre.slice(0, titleLines).map((l) => ({ code: "kept_as_title" as const, row: l.n, page: p + 1 })) : [];
        for (const w of b.warnings) {
          if (w.page !== undefined) {
            listed.push(w);
            continue;
          }
          const at = src[w.row];
          if (!at || at.line < 0) continue;
          for (let n = at.line; n <= at.last; n++) listed.push({ ...w, row: n, page: p + 1 });
        }
        b.warnings = listed;
        const srcs = b.rows.map((_, i): RowSrc | null => {
          const at = src[first + i];
          return at && at.line >= 0 ? { p, line: at.line, last: at.last } : null;
        });
        // After the header the reader makes no judgement (rule 4.1): a footer, a total or a signature under the rows is a
        // row. Only trailing blank rows are cut.
        while (b.rows.length > 0 && nonBlankCells(b.rows[b.rows.length - 1]!) === 0) {
          b.rows.pop();
          srcs.pop();
        }
        // The guess in page lines, so the web can show it on the preview and give it back as hints.
        const headLine = src[g.headerRow]!.line;
        const headEnd = src[g.headerRow + b.headerRows - 1]!.last;
        const lastIdx = first + b.rows.length - 1;
        const firstLine = src[first]?.line ?? headEnd + 1;
        const lastLine = lastIdx >= first ? src[lastIdx]!.last : firstLine - 1;
        const regionStart = bi === 0 && titleLines > 0 ? pre[0]!.n : (src[regionStartOf(b)]?.line ?? headLine);
        b.guess = { page: p + 1, headerRow: headLine, headerRows: b.headerRows, firstDataRow: firstLine, lastDataRow: lastLine, lastPage: p + 1 };
        b.preview = linesPreview(page.lines, regionStart, Math.max(lastLine, headEnd), p + 1, headLine, headEnd - headLine + 1);
        b.firstDataSheetRow += segStart + skipped;
        meta.set(b, { regionStart, page: p, headEnd });
        if (seg.cols) blockCols.set(b, seg.cols);
        const last = [...out].reverse().find((x) => x.rows.length > 0);
        const sameHeader = last && found === 0 && last.headers.length === b.headers.length && last.headers.every((h, x) => h.toLowerCase() === b.headers[x]!.toLowerCase());
        if (last && sameHeader) {
          last.rows.push(...b.rows);
          rowSrc.get(last)?.push(...srcs);
          last.warnings.push(...b.warnings);
          touch(last, b.rows.length > 0 ? lastLine : -1);
          // A new title above a header that joins the table above has nowhere to go: report it.
          if (b === blocks[0]) {
            unplaced += titleLines;
            for (let t = 0; t < titleLines; t++) lost(pre[t]!.n);
          }
        } else {
          out.push(b);
          onPage.push(b);
          rowSrc.set(b, srcs);
        }
        found++;
      });
    });
    // A page with text but no table says so once; on a page with a table, lines no block took are counted.
    if (found > 0 || appended > 0) unplaced += leftover;
    if (misplaced > 0) warnings.push(`page ${p + 1}: ${plural(misplaced, "row", "rows")} did not line up with the table above`);
    if (unplaced > 0) warnings.push(`page ${p + 1}: ${plural(unplaced, "line", "lines")} could not be placed`);
    if (page.fused > 0) warnings.push(`page ${p + 1}: ${plural(page.fused, "row has", "rows have")} two values in one column`);
    if (items.some((i) => i.str.trim() !== "") && found === 0 && appended === 0) {
      warnings.push(`page ${p + 1}: text but no table`);
      for (const l of page.lines) lost(l.n);
    }
  });
  // A header with no rows under it (a footer read as a header) is no table. Its lines are listed.
  const kept: ReadBlock[] = [];
  for (const b of out) {
    const m = meta.get(b)!;
    if (b.rows.length > 0) {
      bandGuessed(b, m, rowSrc.get(b) ?? [], (q) => pageLinesOf.get(q)!);
      kept.push(b);
      continue;
    }
    const end = Math.max(b.guess.headerRow + b.headerRows - 1, b.guess.lastDataRow ?? -1);
    for (let n = m.regionStart; n <= end; n++) rowWarnings.push({ code: "not_placed", row: n, page: m.page + 1 });
    for (const w of b.warnings) rowWarnings.push({ ...w, code: "not_placed" });
    warnings.push(`page ${m.page + 1}: ${plural(end - m.regionStart + 1, "line", "lines")} could not be placed`);
  }
  const blocks = [...kept, ...(hinted?.blocks ?? [])].sort((a, b) => (a.guess.page ?? 0) - (b.guess.page ?? 0) || a.guess.headerRow - b.guess.headerRow);
  const seen = new Set<string>();
  const listed = rowWarnings.filter((w) => {
    const k = `${w.page}:${w.row}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { blocks, warnings, rowWarnings: listed };
}

/** Squashed cell texts of a line, to tell a repeated header. */
const lineKey = (cells: readonly string[]) => cells.map(squash).join("|");

/**
 * Follow PDF hints exactly. The region of a hint runs from its header line to its last data line, on its page or on
 * to `lastPage`. Its columns are exactly the header's cells (`bandsOf`, rule 5.3). Every line is one row, except that
 * a one-cell line closer than three quarters of the row pitch to the line above is the rest of a cell above (a wrapped
 * line). Every item goes to the band of its centre; a row in doubt is listed in `doubts`. On later pages a header line
 * repeated there and the lines above it are listed and skipped. Nothing else is decided.
 */
function readPdfByHints(
  pages: readonly (readonly TextItem[])[],
  hintsIn: readonly BlockHints[],
  opts: PdfTextOptions,
): { blocks: ReadBlock[]; rowWarnings: RowWarning[]; covered: Set<number> } {
  const laid = new Map<number, ReturnType<typeof pageLines>>();
  const linesOf = (p: number) => {
    let v = laid.get(p);
    if (!v) {
      v = pageLines(pages[p] ?? [], opts);
      laid.set(p, v);
    }
    return v;
  };
  const hints = hintsIn.map((h) => {
    checkHintShape(h);
    const page = h.page ?? 1;
    if (!Number.isInteger(page) || page < 1 || page > pages.length) throw new HintError("hint_out_of_range", `page ${page} is not in the file`);
    const lastPage = h.lastPage ?? page;
    if (!Number.isInteger(lastPage) || lastPage < page || lastPage > pages.length) throw new HintError("hint_out_of_range", `last page ${lastPage} is not in the file`);
    return { hint: h, p: page - 1, lp: lastPage - 1 };
  });
  hints.sort((a, b) => a.p - b.p || a.hint.headerRow - b.hint.headerRow);
  const covered = new Set<number>();
  const blocks: ReadBlock[] = [];
  const rowWarnings: RowWarning[] = [];
  let prevEnd: { p: number; line: number } | null = null;
  hints.forEach(({ hint, p, lp }, x) => {
    const next = hints[x + 1];
    const { lines, charWidth, height } = linesOf(p);
    const h = hint.headerRow;
    const headerRows = hint.headerRows ?? 1;
    if (!Number.isInteger(h) || h < 0 || h + headerRows > lines.length) throw new HintError("hint_out_of_range", `header line ${h} is not on page ${p + 1}`);
    if (prevEnd && (prevEnd.p > p || (prevEnd.p === p && prevEnd.line >= h))) throw new HintError("hint_overlap", `header line ${h} on page ${p + 1} is inside the block above`);
    const first = hint.firstDataRow ?? h + headerRows;
    if (first < h + headerRows) throw new HintError("hint_order", `first data line ${first} is above the header`);
    if (lp > p && first > lines.length) throw new HintError("hint_out_of_range", `first data line ${first} is not on page ${p + 1}`);
    const lpLines = linesOf(lp).lines;
    const last = hint.lastDataRow ?? (next && next.p === lp ? next.hint.headerRow - 1 : lpLines.length - 1);
    if (last >= lpLines.length || (lp === p && last < first - 1)) throw new HintError("hint_out_of_range", `last data line ${last} is not on page ${lp + 1}`);
    if (next && (next.p < lp || (next.p === lp && next.hint.headerRow <= last))) throw new HintError("hint_overlap", `header line ${next.hint.headerRow} on page ${next.p + 1} is inside the block above`);
    for (let q = p; q <= lp; q++) covered.add(q);

    const regionStart = prevEnd && prevEnd.p === p ? prevEnd.line + 1 : 0;
    const start = Math.min(regionStart, h);
    const titleText = lines.slice(start, h).map(lineText).join(" ");
    const headLines = lines.slice(h, h + headerRows);
    const pEnd = lp === p ? last : lines.length - 1;
    const dataLines = lines.slice(first, pEnd + 1);
    const bands = bandsOf(headLines, charWidth);
    const warnings: RowWarning[] = lines.slice(start, h).map((l) => ({ code: "kept_as_title" as const, row: l.n, page: p + 1 }));
    const headers = headersOnBands(headLines, bands);
    for (let n = h + headerRows; n < first; n++) warnings.push({ code: "skipped_by_hint", row: n, page: p + 1 });

    // The row pitch of the data: the median gap above a multi-cell line (a new row starts there, after the header,
    // after a row or after the wrapped line of one).
    // Every line from the header down counts, so skipped lines (column numbers) still give the pitch.
    const seq = lines.slice(h, pEnd + 1);
    // Two multi-cell lines next to each other give the pitch; a wrapped line between two rows does not shorten it.
    const pairs: number[] = [];
    const gaps: number[] = [];
    for (let k = 1; k < seq.length; k++) {
      if (seq[k]!.cells.length < 2) continue;
      gaps.push(Math.abs(seq[k - 1]!.y - seq[k]!.y));
      if (seq[k - 1]!.cells.length >= 2) pairs.push(Math.abs(seq[k - 1]!.y - seq[k]!.y));
    }
    const pitch = median(pairs, median(gaps, height * 1.5));
    const sources: { lines: { line: Line; page: number }[] }[] = [];
    const addLines = (ls: readonly Line[], q: number) => {
      let above: Line | null = null;
      /** The first line of the current row: a wrapped line sits before the next row would start. */
      let rowStart: Line | null = null;
      for (const l of ls) {
        const prevRow = sources[sources.length - 1];
        if (l.cells.length === 1 && above && rowStart && prevRow && Math.abs(above.y - l.y) < pitch * 0.75 && Math.abs(rowStart.y - l.y) < pitch * 0.9) {
          prevRow.lines.push({ line: l, page: q + 1 });
          above = l;
          continue;
        }
        sources.push({ lines: [{ line: l, page: q + 1 }] });
        above = l;
        rowStart = l;
      }
    };
    addLines(dataLines, p);
    const headKey = lineKey(headLines[0]!.cells.map((c) => c.text));
    for (let q = p + 1; q <= lp; q++) {
      const ql = linesOf(q).lines;
      const qEnd = q === lp ? last : ql.length - 1;
      let from = 0;
      const again = ql.findIndex((l, n) => n <= qEnd && lineKey(l.cells.map((c) => c.text)) === headKey);
      if (again !== -1) {
        for (let n = 0; n < again + headerRows; n++) warnings.push({ code: "title_repeated", row: n, page: q + 1 });
        from = again + headerRows;
      }
      addLines(ql.slice(from, qEnd + 1), q);
    }
    if (!(next && next.p === lp)) for (let n = last + 1; n < lpLines.length; n++) warnings.push({ code: "after_last_row", row: n, page: lp + 1 });
    const { rows, doubts } = rowsOnBands(sources, bands);
    const shaped = finishShape(headers, rows);
    blocks.push({
      sheetName: `Page ${p + 1}`,
      title: titleText !== "" ? titleText : null,
      headerRow: h - start,
      headerRows,
      headers: shaped.headers,
      rows: shaped.rows,
      firstDataSheetRow: first,
      preview: previewOnBands(linesPreview(lines, start, Math.max(pEnd, h + headerRows - 1), p + 1, h, headerRows), (pg) => linesOf(pg - 1).lines, bands, { page: p + 1, from: h, to: h + headerRows - 1 }),
      guess: { page: p + 1, headerRow: h, headerRows, firstDataRow: first, lastDataRow: last, lastPage: lp + 1 },
      hints: { ...hint },
      warnings,
      doubts,
    });
    prevEnd = { p: lp, line: last };
  });
  return { blocks, rowWarnings, covered };
}

/** Pages of text items to blocks; see `readPdfText`, which also returns the warnings. */
export function readPdfTextBlocks(pages: readonly (readonly TextItem[])[], opts: PdfTextOptions = {}): ReadBlock[] {
  return readPdfText(pages, opts).blocks;
}
