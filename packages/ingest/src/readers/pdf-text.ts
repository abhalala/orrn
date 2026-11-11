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

export function textItemsToMatrix(itemsIn: readonly TextItem[], opts: PdfTextOptions = {}): string[][] {
  const items = itemsIn.filter((i) => i.str.trim() !== "");
  if (items.length === 0) return [];
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
  let i = 0;
  let prevY: number | null = null;
  while (i < lines.length) {
    const line = lines[i]!;
    if (prevY !== null && Math.abs(prevY - line.y) > height * 3) matrix.push([]);
    if (line.cells.length < 2) {
      matrix.push([line.cells.map((c) => c.text).join(" ")]);
      prevY = line.y;
      i++;
      continue;
    }
    // A region of multi-cell lines that follow each other.
    // A one-cell line right under a row (within 1.5 line heights) is a wrapped cell: it stays in the region (C17).
    const isWrap = (k: number) => lines[k]!.cells.length === 1 && Math.abs(lines[k - 1]!.y - lines[k]!.y) <= height * 1.5;
    let j = i;
    while (
      j < lines.length &&
      (j === i || Math.abs(lines[j - 1]!.y - lines[j]!.y) <= height * 3) &&
      (lines[j]!.cells.length >= 2 || (j > i && isWrap(j)))
    )
      j++;
    const region = lines.slice(i, j);
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
    for (const l of region) {
      if (l.cells.length === 1) {
        const c = l.cells[0]!;
        const k = cols.findIndex(([a, b]) => c.x0 >= a - charWidth && c.x0 <= b);
        const last = matrix[matrix.length - 1];
        if (k !== -1 && last) {
          last[k] = last[k] === "" ? c.text : `${last[k]} ${c.text}`;
          continue;
        }
        matrix.push([c.text]);
        continue;
      }
      const row = Array<string>(cols.length).fill("");
      for (const c of l.cells) {
        const mid = (c.x0 + c.x1) / 2;
        const k = cols.findIndex(([a, b]) => mid >= a && mid <= b);
        const at = k === -1 ? 0 : k;
        row[at] = row[at] === "" ? c.text : `${row[at]} ${c.text}`;
      }
      matrix.push(row);
    }
    prevY = region[region.length - 1]!.y;
    i = j;
  }
  return matrix;
}

export type PdfTextRead = {
  blocks: ReadBlock[];
  /** A page with text that gave no table and no rows (`page 3: text but no table`). No cell text is quoted. */
  warnings: string[];
};

const nonBlankCells = (r: readonly string[]) => r.filter((c) => c !== "").length;

/**
 * Pages of text items to blocks. A table that continues on the next page is one block: the header repeated at the top
 * of the next page is dropped, and data rows at the top of a page with no header join the table above (C16).
 */
export function readPdfText(pages: readonly (readonly TextItem[])[], opts: PdfTextOptions = {}): PdfTextRead {
  const out: ReadBlock[] = [];
  const warnings: string[] = [];
  pages.forEach((items, p) => {
    const matrix = textItemsToMatrix(items, opts);
    const prev = [...out].reverse().find((b) => b.rows.length > 0);
    let rest = matrix;
    let appended = 0;
    if (p > 0 && prev) {
      // Rows above the first header-like row continue the table of the page before.
      let h = matrix.findIndex((r) => isHeaderLike(r));
      if (h === -1) h = matrix.length;
      const width = prev.headers.length;
      for (const r of matrix.slice(0, h)) {
        // A lone short line (a page number, a footer) is noise; a row of another width is not this table.
        if (nonBlankCells(r) < 2 || Math.abs(r.length - width) > 1) continue;
        prev.rows.push(r.length >= width ? r.slice(0, width) : [...r, ...Array<string>(width - r.length).fill("")]);
        appended++;
      }
      rest = matrix.slice(h);
    }
    const blocks = findBlocks(rest, { sheetName: `Page ${p + 1}` });
    // Footer lines under a table (one cell, after the data) are not rows (C17).
    for (const b of blocks) {
      while (b.headers.length >= 2 && b.rows.length > 0 && nonBlankCells(b.rows[b.rows.length - 1]!) <= 1) b.rows.pop();
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
