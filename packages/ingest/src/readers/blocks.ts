/**
 * Matrix to blocks (plan B2): header detection, titles, two-row headers, several tables on one sheet.
 *
 * The header is the first row in the first 20 with at least 2 non-blank cells, at least 60% of them text. Rows above it
 * are the title. If the next row is also at least 60% text and the header has merged or blank cells, the two combine as
 * "top bottom" with `headerRows = 2`. A blank row followed by a new header-like row starts a new block.
 */
import { cellKind, inferKind } from "../cells";
import { usedWidth } from "../fingerprint";
import { PREVIEW_ROWS, type BlockHints, type MatrixCell, type PreviewRow, type ReadBlock, type RowWarning, type UnsureReason } from "./types";

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
  if (nonBlank(bottom) < 2 || textShare(bottom) < HEADER_TEXT_SHARE) return false;
  let first = -1;
  let last = -1;
  top.forEach((c, i) => {
    if (c !== "") {
      if (first === -1) first = i;
      last = i;
    }
  });
  // A group label in the last top cell ("Party | Apr 2025" over "Kg | Pcs | Rate") has no blank inside the top span.
  if (!hasBlankInSpan(top) && !(last !== -1 && isGroupLabel(top, bottom, last))) return false;
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
export const TITLE_MARK = /:\s*\S|\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/;
/** A bare year. It marks a title only when the cell is not a group label (C-new-1: "Apr 2025" over "Kg | Pcs"). */
const YEAR_MARK = /\b(?:19|20)\d{2}\b/;

/** The bottom cells under a top cell: from it to the column before the next filled top cell. */
function spanBelow(top: readonly string[], below: readonly string[], i: number): string[] {
  let end = i + 1;
  while (end < Math.max(top.length, below.length) && (top[end] ?? "") === "") end++;
  return Array.from({ length: end - i }, (_, x) => (below[i + x] ?? "").toLowerCase());
}

/**
 * Is the year or month cell at `i` a group label over sub-columns (C-new-1), not a letterhead (C-new-5, R-new-1)? It
 * must span blank top cells over filled bottom cells, and the shape must show a group row, whatever the number of dated
 * cells: (a) another filled top cell has a blank under it (Sr or Party over a blank, which a letterhead over a full
 * header never has), or (b) the same sub-column names sit under another top cell (Kg | Pcs under Apr and under Total).
 */
function isGroupLabel(row: readonly string[], below: readonly string[], i: number): boolean {
  if ((row[i + 1] ?? "") !== "" || (below[i + 1] ?? "") === "") return false;
  if (row.some((c, j) => j !== i && c !== "" && (below[j] ?? "") === "")) return true;
  const mine = spanBelow(row, below, i);
  if (mine.length < 2 || mine.some((c) => c === "")) return false;
  return row.some((c, j) => {
    if (j === i || c === "") return false;
    const other = spanBelow(row, below, j);
    return other.length === mine.length && other.every((x, n) => x === mine[n]);
  });
}

/**
 * Is the header-like row at `h` a title above the real header (C15)? Only when it carries a title mark and the next
 * non-blank row is header-like with more cells. A bare year counts only when its cell is not a group label (see
 * `isGroupLabel`). A group-label row of a two-row header is not a title.
 */
function isTitleAbove(rows: readonly string[][], h: number): number {
  const row = rows[h]!;
  let k = h + 1;
  while (k < rows.length && nonBlank(rows[k]!) === 0) k++;
  if (k >= rows.length) return -1;
  const below = rows[k]!;
  const marked = row.some((c, i) => c !== "" && (TITLE_MARK.test(c) || (YEAR_MARK.test(c) && !isGroupLabel(row, below, i))));
  if (!marked) return -1;
  return isHeaderLike(below) && nonBlank(below) > nonBlank(row) ? k : -1;
}


/** A blank-value word in a number column: never a column name. */
export const NULL_WORD = /^(?:nil|na|n\/a|none|null|nill|-+)$/i;
/** A word: text with two letters in a row that is not a blank-value word. */
export const isWord = (s: string) => cellKind(s) === "text" && /[a-z]{2}/i.test(s) && !NULL_WORD.test(s);
const isNumberish = (s: string) => {
  const k = cellKind(s);
  return k === "int" || k === "decimal" || k === "date";
};

/** What the confidence check needs to know about one block. */
export type JudgeInput = {
  /** Rows above the header in the region (a title, a letterhead). */
  hasTitle: boolean;
  /** The top header row as read. */
  topRow: readonly string[];
  headerRows: 1 | 2;
  /** The headers the block returns, padded to its width. */
  headers: readonly string[];
  rows: readonly (readonly string[])[];
};

/**
 * The narrow rule for `sure` (PORTAL-RULES-3 section 3). The header is the first non-blank row of the region, nothing
 * sits above it, it has at least two filled cells, every one of them text (not a number, date or code), and no column
 * of the block lacks a name. Some row below holds a number or a date, and so does the first row under the header (so
 * the header is not a title over the real header, and the next row is not a second header row). No data row is wider
 * than the header, no word sits in a number column, no blank row splits the rows, and the last row has more than one
 * filled cell. Every failed condition is a reason; no reasons is `sure`.
 */
export function unsureReasons(b: JudgeInput): UnsureReason[] {
  const out: UnsureReason[] = [];
  if (b.hasTitle) out.push("rows_above_header");
  if (nonBlank(b.topRow) < 2) out.push("header_too_few_cells");
  if (b.headers.some((c) => c !== "" && cellKind(c) !== "text")) out.push("header_not_text");
  if (b.headers.some((c) => c === "")) out.push("header_blank_cell");
  if (b.headerRows === 2) out.push("two_row_header");
  if (!b.rows.some((r) => r.some(isNumberish))) out.push("no_number_below");
  const first = b.rows.find((r) => nonBlank(r) > 0);
  if (first && !first.some(isNumberish)) out.push("first_row_has_no_number");
  let lastHead = -1;
  b.topRow.forEach((c, i) => {
    if (c !== "") lastHead = i;
  });
  if (b.headerRows === 2) lastHead = b.headers.length - 1;
  if (b.rows.some((r) => r.some((c, i) => i > lastHead && c !== ""))) out.push("row_wider_than_header");
  const width = b.headers.length;
  for (let c = 0; c < width; c++) {
    let nums = 0;
    let words = 0;
    for (const r of b.rows) {
      const v = r[c] ?? "";
      if (v === "") continue;
      if (isNumberish(v)) nums++;
      else if (isWord(v)) words++;
    }
    if (nums > 0 && words > 0 && nums >= words) {
      out.push("word_in_number_column");
      break;
    }
  }
  let seenBlank = false;
  for (const r of b.rows) {
    if (nonBlank(r) === 0) seenBlank = true;
    else if (seenBlank) {
      out.push("gap_in_rows");
      break;
    }
  }
  const last = b.rows[b.rows.length - 1];
  if (last && nonBlank(last) === 1) out.push("one_cell_last_row");
  return out;
}

/** The first `PREVIEW_ROWS` raw rows from `from`, up to `to` (exclusive), with their row numbers. */
export function previewRows(rows: readonly (readonly string[])[], from: number, to: number): PreviewRow[] {
  const out: PreviewRow[] = [];
  for (let r = from; r < Math.min(to, rows.length) && out.length < PREVIEW_ROWS; r++) out.push({ row: r, cells: [...rows[r]!] });
  return out;
}

/** A hint that cannot be followed: out of the sheet, overlapping another, or with rows in the wrong order. */
export class HintError extends Error {
  constructor(
    readonly code: "hint_out_of_range" | "hint_overlap" | "hint_order",
    message: string,
  ) {
    super(message);
    this.name = "HintError";
  }
}

/** One sheet read: its blocks, and rows that no block took. */
export type SheetRead = { blocks: ReadBlock[]; warnings: RowWarning[] };

export type FindBlocksOptions = {
  sheetName?: string | null;
  /** Hints for every block of the sheet. Given, the reader follows them and guesses nothing on this sheet. */
  hints?: readonly BlockHints[] | null;
};

const lastFilled = (rows: readonly string[][], from: number, to: number) => {
  let last = from - 1;
  for (let r = from; r <= to; r++) if (nonBlank(rows[r]!) > 0) last = r;
  return last;
};

/** Pad ragged rows under blank headers (C34) and cut trailing blank columns. */
function finishShape(headersIn: readonly string[], data: readonly string[][]): { headers: string[]; rows: string[][] } {
  let headers = [...headersIn];
  const wide = data.reduce((m, r) => Math.max(m, r.length), headers.length);
  if (wide > headers.length) headers = [...headers, ...Array<string>(wide - headers.length).fill("")];
  const width = usedWidth(headers, data);
  return { headers: headers.slice(0, width), rows: data.map((r) => r.slice(0, width)) };
}

/** Follow the hints exactly: no header search, no title test, no table split. */
function readByHints(rows: readonly string[][], hintsIn: readonly BlockHints[], sheetName: string | null): SheetRead {
  const n = rows.length;
  const hints = [...hintsIn].sort((a, b) => a.headerRow - b.headerRow);
  const blocks: ReadBlock[] = [];
  let regionStart = 0;
  hints.forEach((hint, x) => {
    const h = hint.headerRow;
    const headerRows = hint.headerRows ?? 1;
    if (!Number.isInteger(h) || h < 0 || h + headerRows > n) throw new HintError("hint_out_of_range", `header row ${h} is not in the sheet`);
    if (h < regionStart) throw new HintError("hint_overlap", `header row ${h} is inside the block above`);
    const next = hints[x + 1];
    const first = hint.firstDataRow ?? h + headerRows;
    const last = hint.lastDataRow ?? (next ? next.headerRow - 1 : n - 1);
    if (first < h + headerRows) throw new HintError("hint_order", `first data row ${first} is above the header`);
    if (last < first - 1 || last >= n) throw new HintError("hint_out_of_range", `last data row ${last} is not in the sheet`);
    if (next && next.headerRow <= last) throw new HintError("hint_overlap", `header row ${next.headerRow} is inside the block above`);

    let start = h;
    for (let r = regionStart; r < h; r++) {
      if (nonBlank(rows[r]!) > 0) {
        start = r;
        break;
      }
    }
    const titleParts: string[] = [];
    for (let r = start; r < h; r++) {
      const cells = rows[r]!.filter((c) => c !== "");
      if (cells.length > 0) titleParts.push(cells.join(" "));
    }
    const headers = headerRows === 2 ? combineHeaders(rows[h]!, rows[h + 1]!) : rows[h]!;
    const warnings: RowWarning[] = [];
    for (let r = h + headerRows; r < first; r++) if (nonBlank(rows[r]!) > 0) warnings.push({ code: "skipped_by_hint", row: r });
    const end = lastFilled(rows as string[][], first, last);
    const shaped = finishShape(headers, rows.slice(first, end + 1));
    if (!next) for (let r = last + 1; r < n; r++) if (nonBlank(rows[r]!) > 0) warnings.push({ code: "after_last_row", row: r });
    const guess: BlockHints = { headerRow: h, headerRows, firstDataRow: first, lastDataRow: end };
    blocks.push({
      sheetName,
      title: titleParts.length > 0 ? titleParts.join(" ") : null,
      headerRow: h - start,
      headerRows,
      headers: shaped.headers,
      rows: shaped.rows,
      firstDataSheetRow: first,
      confidence: "sure",
      reasons: [],
      preview: previewRows(rows, start, Math.max(last + 1, h + headerRows)),
      guess,
      hints: { ...hint },
      warnings,
    });
    regionStart = last + 1;
  });
  return { blocks, warnings: [] };
}

/**
 * Matrix to blocks with the reader's guess, or by hints. A guessed block says whether the reader is sure (see
 * `unsureReasons`) and carries a preview of its region and the guess as hints.
 */
export function readSheet(matrix: readonly (readonly MatrixCell[])[], opts: FindBlocksOptions = {}): SheetRead {
  const rows = matrix.map((r) => r.map(toCellText));
  const sheetName = opts.sheetName ?? null;
  if (opts.hints && opts.hints.length > 0) return readByHints(rows, opts.hints, sheetName);
  const n = rows.length;
  const blocks: ReadBlock[] = [];
  const warnings: RowWarning[] = [];
  let pos = 0;

  while (pos < n) {
    let h = -1;
    for (let i = pos; i < Math.min(n, pos + HEADER_SEARCH_ROWS); i++) {
      if (isHeaderLike(rows[i]!)) {
        h = i;
        break;
      }
    }
    if (h === -1) {
      // No table here: every row left is reported, never dropped quietly.
      for (let r = pos; r < n; r++) if (nonBlank(rows[r]!) > 0) warnings.push({ code: "not_placed", row: r });
      break;
    }
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

    const shaped = finishShape(headers, data);
    const block: ReadBlock = {
      sheetName,
      title: titleParts.length > 0 ? titleParts.join(" ") : null,
      headerRow: h - start,
      headerRows,
      headers: shaped.headers,
      rows: shaped.rows,
      firstDataSheetRow: dataStart,
      confidence: "sure",
      reasons: [],
      preview: previewRows(rows, start, end),
      guess: { headerRow: h, headerRows, firstDataRow: dataStart, lastDataRow: dataStart + data.length - 1 },
      hints: null,
      warnings: [],
    };
    block.reasons = unsureReasons({ hasTitle: titleParts.length > 0, topRow: rows[h]!, headerRows, headers: block.headers, rows: block.rows });
    blocks.push(block);
    if (end === n) break;
  }
  // Two tables in one region: where one ends and the next starts is a guess.
  if (blocks.length > 1) for (const b of blocks) b.reasons.push("more_tables");
  for (const b of blocks) b.confidence = b.reasons.length === 0 ? "sure" : "unsure";
  return { blocks, warnings };
}

/** The blocks of `readSheet`. */
export function findBlocks(matrix: readonly (readonly MatrixCell[])[], opts: FindBlocksOptions = {}): ReadBlock[] {
  return readSheet(matrix, opts).blocks;
}
