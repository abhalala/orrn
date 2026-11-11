/**
 * PDF text layer to tables (plan C2). The input is positioned text items, as a PDF library reports them: no library
 * object crosses this line. Items are grouped into lines by their y, merged into cells by the gaps between them, and
 * the columns of a run of multi-cell lines come from projecting the cells onto the x axis. The resulting matrix goes
 * through `findBlocks` like a sheet.
 */
import { findBlocks } from "./blocks";
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
    lines.push({ y: lineY, cells });
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
    let j = i;
    while (j < lines.length && lines[j]!.cells.length >= 2 && (j === i || Math.abs(lines[j - 1]!.y - lines[j]!.y) <= height * 3)) j++;
    const region = lines.slice(i, j);
    const spans = region
      .flatMap((l) => l.cells.map((c) => [c.x0, c.x1] as const))
      .sort((a, b) => a[0] - b[0]);
    const cols: [number, number][] = [];
    for (const [a, b] of spans) {
      const last = cols[cols.length - 1];
      if (last && a <= last[1] + charWidth * 0.5) last[1] = Math.max(last[1], b);
      else cols.push([a, b]);
    }
    for (const l of region) {
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

/**
 * Pages of text items to blocks. A table that continues on the next page with the same header is one block; the header
 * repeated at the top of the next page is dropped.
 */
export function readPdfTextBlocks(pages: readonly (readonly TextItem[])[], opts: PdfTextOptions = {}): ReadBlock[] {
  const out: ReadBlock[] = [];
  pages.forEach((items, p) => {
    const blocks = findBlocks(textItemsToMatrix(items, opts), { sheetName: `Page ${p + 1}` });
    blocks.forEach((b, k) => {
      const prev = out[out.length - 1];
      const sameHeader = prev && k === 0 && prev.headers.length === b.headers.length && prev.headers.every((h, x) => h.toLowerCase() === b.headers[x]!.toLowerCase());
      if (prev && sameHeader) prev.rows.push(...b.rows);
      else out.push(b);
    });
  });
  return out;
}
