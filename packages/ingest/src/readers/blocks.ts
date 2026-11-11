/**
 * Matrix to blocks (plan B2): header detection, titles, two-row headers, several tables on one sheet.
 *
 * The header is the first row in the first 20 with at least 2 non-blank cells, at least 60% of them text. Rows above it
 * are the title. If the next row is also at least 60% text and the header has merged or blank cells, the two combine as
 * "top bottom" with `headerRows = 2`. A blank row followed by a new header-like row starts a new block.
 */
import { cellKind } from "../cells";
import { usedWidth } from "../fingerprint";
import { inferKind } from "../cells";
import type { MatrixCell, ReadBlock } from "./types";

export const HEADER_SEARCH_ROWS = 20;
export const HEADER_TEXT_SHARE = 0.6;

/** Excel dates arrive as Date objects: they become `YYYY-MM-DD` (UTC), or with the time when there is one. */
export function toCellText(v: MatrixCell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.replace(/ /g, " ").trim();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (Number.isNaN(v.getTime())) return "";
  const iso = v.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 19);
}

const nonBlank = (row: readonly string[]) => row.filter((c) => c !== "").length;

function textShare(row: readonly string[]): number {
  let n = 0;
  let text = 0;
  for (const c of row) {
    if (c === "") continue;
    n++;
    const k = cellKind(c);
    if (k === "text" || k === "code") text++;
  }
  return n === 0 ? 0 : text / n;
}

export function isHeaderLike(row: readonly string[]): boolean {
  return nonBlank(row) >= 2 && textShare(row) >= HEADER_TEXT_SHARE;
}

function hasBlankInSpan(row: readonly string[]): boolean {
  let first = -1;
  let last = -1;
  row.forEach((c, i) => {
    if (c !== "") {
      if (first === -1) first = i;
      last = i;
    }
  });
  for (let i = first; i <= last; i++) if (row[i] === "") return true;
  return false;
}

const isTextCell = (c: string) => {
  const k = cellKind(c);
  return k === "text" || k === "code";
};

/**
 * Is `bottom` the second row of a two-row header under `top` (C14)? Needs structure, not only text: some top cell
 * inside the header span is blank over a filled bottom cell (a group label spans it); every bottom cell is a short
 * label (text of 3 words or fewer); and the row below does not hold text in the same columns as `bottom` does, which
 * would make `bottom` the first data row.
 */
function isSecondHeaderRow(top: readonly string[], bottom: readonly string[], below: readonly string[] | undefined): boolean {
  if (!hasBlankInSpan(top) || nonBlank(bottom) < 2 || textShare(bottom) < HEADER_TEXT_SHARE) return false;
  let first = -1;
  let last = -1;
  top.forEach((c, i) => {
    if (c !== "") {
      if (first === -1) first = i;
      last = i;
    }
  });
  let spans = false;
  for (let i = first + 1; i <= Math.max(last, bottom.length - 1); i++) if ((top[i] ?? "") === "" && (bottom[i] ?? "") !== "") spans = true;
  if (!spans) return false;
  if (bottom.some((c) => c !== "" && (!isTextCell(c) || c.trim().split(/\s+/).length > 3))) return false;
  if (below && nonBlank(below) > 0) {
    const sameShape = bottom.every((c, i) => c === "" || ((below[i] ?? "") !== "" && isTextCell(below[i]!)));
    if (sameShape) return false;
  }
  return true;
}

/** "Top bottom" for a two-row header. A blank top cell above a filled bottom cell continues the group to its left. */
function combineHeaders(top: readonly string[], bottom: readonly string[]): string[] {
  const width = Math.max(top.length, bottom.length);
  const out: string[] = [];
  let group = "";
  for (let c = 0; c < width; c++) {
    const t = top[c] ?? "";
    const b = bottom[c] ?? "";
    if (t !== "") group = t;
    const head = t !== "" ? t : b !== "" ? group : "";
    out.push(head !== "" && b !== "" && head !== b ? `${head} ${b}` : head !== "" ? head : b);
    if (t === "" && b === "") group = "";
  }
  return out;
}

/**
 * Does this row after a gap start a new table? It must look like a header and hold text where the table above has
 * numbers, dates or codes. Two text-only tables stacked on one sheet stay one block.
 */
function startsNewBlock(row: readonly string[], recent: readonly string[][], width: number): boolean {
  if (!isHeaderLike(row)) return false;
  for (let c = 0; c < width; c++) {
    if ((row[c] ?? "") === "") continue;
    const kind = inferKind(recent.map((r) => r[c] ?? ""));
    if (kind === "int" || kind === "decimal" || kind === "date" || kind === "code") return true;
  }
  return false;
}

/** A cell that reads like a title or letterhead, not a column name: a colon label or a full date. */
const TITLE_MARK = /:\s*\S|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/;
/** A bare year. It marks a title only when the cell is not a group label (C-new-1: "Apr 2025" over "Kg | Pcs"). */
const YEAR_MARK = /\b(?:19|20)\d{2}\b/;

/**
 * Is the header-like row at `h` a title above the real header (C15)? Only when it carries a title mark and the next
 * non-blank row is header-like with more cells. A bare year counts only when its cell does not head a group: the
 * cell to its right is blank and the row below fills that column. A group-label row of a two-row header is not a title.
 */
function isTitleAbove(rows: readonly string[][], h: number): number {
  const row = rows[h]!;
  let k = h + 1;
  while (k < rows.length && nonBlank(rows[k]!) === 0) k++;
  if (k >= rows.length) return -1;
  const below = rows[k]!;
  const groupLabel = (i: number) => (row[i + 1] ?? "") === "" && (below[i + 1] ?? "") !== "";
  const marked = row.some((c, i) => c !== "" && (TITLE_MARK.test(c) || (YEAR_MARK.test(c) && !groupLabel(i))));
  if (!marked) return -1;
  return isHeaderLike(below) && nonBlank(below) > nonBlank(row) ? k : -1;
}

export function findBlocks(matrix: readonly (readonly MatrixCell[])[], opts: { sheetName?: string | null } = {}): ReadBlock[] {
  const rows = matrix.map((r) => r.map(toCellText));
  const n = rows.length;
  const blocks: ReadBlock[] = [];
  let pos = 0;

  while (pos < n) {
    let h = -1;
    for (let i = pos; i < Math.min(n, pos + HEADER_SEARCH_ROWS); i++) {
      if (isHeaderLike(rows[i]!)) {
        h = i;
        break;
      }
    }
    if (h === -1) break;
    const real = isTitleAbove(rows, h);
    if (real !== -1) h = real;

    let start = h;
    for (let i = pos; i < h; i++) {
      if (nonBlank(rows[i]!) > 0) {
        start = i;
        break;
      }
    }
    const titleParts: string[] = [];
    for (let i = start; i < h; i++) {
      const cells = rows[i]!.filter((c) => c !== "");
      if (cells.length > 0) titleParts.push(cells.join(" "));
    }

    let headers = rows[h]!;
    let headerRows: 1 | 2 = 1;
    const next = rows[h + 1];
    if (next && isSecondHeaderRow(headers, next, rows[h + 2])) {
      headers = combineHeaders(headers, next);
      headerRows = 2;
    }
    const dataStart = h + headerRows;

    const data: string[][] = [];
    let i = dataStart;
    let end = n;
    while (i < n) {
      const row = rows[i]!;
      if (nonBlank(row) > 0) {
        data.push(row);
        i++;
        continue;
      }
      // A blank row: look past it, over up to 3 title-like lines, for a new header.
      let j = i;
      while (j < n && nonBlank(rows[j]!) === 0) j++;
      let found = false;
      if (j < n) {
        for (let k = j; k < Math.min(n, j + 4); k++) {
          const cand = rows[k]!;
          if (nonBlank(cand) <= 1) continue;
          // A new table needs a data row right under its header; a footer such as "Prepared by" has none (C33).
          const below = rows[k + 1];
          found = below !== undefined && nonBlank(below) > 0 && !isHeaderLike(below) && startsNewBlock(cand, data.slice(-200), headers.length);
          break;
        }
      }
      if (found) {
        end = i;
        break;
      }
      if (j >= n) break;
      for (let b = i; b < j; b++) data.push(rows[b]!);
      i = j;
    }
    pos = Math.max(end, dataStart);

    // Ragged rows (CSV): a cell right of the header's last cell is kept under a blank header (C34).
    const wide = data.reduce((m, r) => Math.max(m, r.length), headers.length);
    if (wide > headers.length) headers = [...headers, ...Array<string>(wide - headers.length).fill("")];
    const width = usedWidth(headers, data);
    blocks.push({
      sheetName: opts.sheetName ?? null,
      title: titleParts.length > 0 ? titleParts.join(" ") : null,
      headerRow: h - start,
      headerRows,
      headers: headers.slice(0, width),
      rows: data.map((r) => r.slice(0, width)),
      firstDataSheetRow: dataStart,
    });
    if (end === n) break;
  }
  return blocks;
}
