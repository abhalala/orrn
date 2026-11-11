/**
 * Matrix to blocks (plan B2): header detection, titles, two-row headers, several tables on one sheet.
 *
 * The header is the first row in the first 20 with at least 2 non-blank cells, at least 60% of them text. Rows above it
 * are the title. If the next row is also at least 60% text and the header has merged or blank cells, the two combine as
 * "top bottom" with `headerRows = 2`. A blank row followed by a new header-like row starts a new block.
 */
import { cellKind, inferKind } from "../cells";
import { parseDate } from "../dates";
import { usedWidth } from "../fingerprint";
import { PREVIEW_HEAD_ROWS, PREVIEW_ROWS, type BlockHints, type MatrixCell, type PreviewRow, type ReadBlock, type RowWarning } from "./types";

export const HEADER_SEARCH_ROWS = 20;
export const HEADER_TEXT_SHARE = 0.6;

/**
 * A cell as text (PORTAL-RULES-3 section 5.4). Text passes through as it is, never coerced. A number, when a matrix
 * hands one over, is written without float noise: a whole number as it is, any other at 15 significant digits, so
 * 12.299999999999999 is "12.3" and 0.1 + 0.2 is "0.3". What a person saw ("007", "18%", "12.30") only the file's
 * formatted text gives, so the web hands that over as a string. Excel dates arrive as Date objects: they become
 * `YYYY-MM-DD` (UTC), or with the time when there is one.
 */
export function toCellText(v: MatrixCell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.replace(/ /g, " ").trim();
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    if (Object.is(v, -0)) return "0";
    return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(15)));
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (Number.isNaN(v.getTime())) return "";
  const iso = v.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso.slice(0, 19);
}

const nonBlank = (row: readonly string[]) => row.filter((c) => c !== "").length;

/** Share of the filled cells that are text or codes. A blank-value word ("-", "Nil") is a value, not text. */
function textShare(row: readonly string[]): number {
  let n = 0;
  let text = 0;
  for (const c of row) {
    if (c === "") continue;
    n++;
    const k = cellKind(c);
    if ((k === "text" || k === "code") && !NULL_WORD.test(c.trim())) text++;
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
  if (!hasBlankInSpan(top) && !(last !== -1 && isGroupLabel(top, bottom, last, below))) return false;
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
export function combineHeaders(top: readonly string[], bottom: readonly string[]): string[] {
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

const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
/** A group label holds only a month, a year or a financial year: "Apr 2025", "March 2026", "FY 2025-26", "2025-26". */
const GROUP_TEXT = new RegExp(`^(?:${MONTH}\\s*[-']?\\s*(?:\\d{4}|\\d{2})|fy\\s*\\d{2,4}(?:\\s*-\\s*\\d{2,4})?|(?:19|20)\\d{2}(?:\\s*-\\s*\\d{2,4})?)$`, "i");

/**
 * Is the year or month cell at `i` a group label over sub-columns (C-new-1), not a letterhead (C-new-5, R-new-1)? Its
 * text is only a month, a year or a financial year: a dated cell with any other word ("Despatch Register 2025-26") is a
 * title mark (R-new-4). It must span blank top cells over filled bottom cells, and the shape must show a group row:
 * (a) another filled top cell has a blank under it, in a column the first data row fills (Sr or Party over a blank; a
 * letterhead cell past the header has no data under it), (b) the same sub-column names sit under another top cell
 * (Kg | Pcs under Apr and under Total), or (c) every filled top cell is a month or year label, two or more of them.
 * These only shape the guess.
 */
function isGroupLabel(row: readonly string[], below: readonly string[], i: number, data?: readonly string[]): boolean {
  if (!GROUP_TEXT.test(row[i]!.trim())) return false;
  if ((row[i + 1] ?? "") !== "" || (below[i + 1] ?? "") === "") return false;
  if (row.some((c, j) => j !== i && c !== "" && (below[j] ?? "") === "" && (data === undefined || (data[j] ?? "") !== ""))) return true;
  const filled = row.filter((c) => c !== "");
  if (filled.length >= 2 && filled.every((c) => GROUP_TEXT.test(c.trim()))) return true;
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
function isTitleAbove(rows: readonly string[][], h: number, to: number): number {
  const row = rows[h]!;
  let k = h + 1;
  while (k < to && nonBlank(rows[k]!) === 0) k++;
  if (k >= to) return -1;
  const below = rows[k]!;
  const marked = row.some((c, i) => c !== "" && (TITLE_MARK.test(c) || (YEAR_MARK.test(c) && !isGroupLabel(row, below, i, k + 1 < to ? rows[k + 1] : undefined))));
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

/**
 * Plain column names of plant sheets. A data cell is almost never exactly one of them, so a first data row that holds
 * one ("Party | 12", "Phone | 98...") may be the header under a letterhead or a key and value line. The PDF reader uses it
 * to tell whether lines at the top of a page continue the table above (`continuesTable`).
 */
const COLUMN_WORDS = new Set(
  (
    "sr|sr no|s no|sno|no|party|party name|customer|customer name|name|section|section no|die|die no|series|qty|quantity|" +
    "pcs|pieces|kg|kgs|weight|wt|net wt|gross wt|rate|amount|value|date|length|size|city|phone|mobile|contact|email|" +
    "address|gst|gstin|remarks|remark|bundle|bundles|order|order no|po|po no|invoice|invoice no|alloy|temper|finish|" +
    "colour|color|press|hours|shift|vehicle|vehicle no|transporter|code|item|description|unit|uom|month|year"
  ).split("|"),
);

const YEAR_RANGE = (n: number) => n >= 1990 && n <= 2100;
/** A date on the 1st of a month, in any format the date reader knows: a month label in a header. */
function isMonthStart(s: string): boolean {
  return (["ymd", "dmy", "mdy", "d_mon_y"] as const).some((f) => parseDate(s, f)?.slice(8, 10) === "01");
}

/**
 * Could this row be a header itself (R3-1, R3-2)? Column names may be numbers: lengths (12, 14, 16),
 * years (2024, 2025), month dates (1 Apr, 1 May) or column numbers (1, 2, 3). It could when a cell is a plain column
 * name (`COLUMN_WORDS`), or when it holds a number or a
 * date and every one is a year or a month start, or when two or more whole numbers rise left to right, by one each
 * time or (with `sameSize`) of one size: two numbers both at most 100, or three or more with the last at most three
 * times the first and at most 10000. A serial column (the next row holds the value plus one, or
 * the row `before` it the value minus one) is data and is left out of the rising test.
 */
export function couldBeHeader(row: readonly string[], next: readonly string[] | undefined, before?: readonly string[], sameSize = true): boolean {
  if (row.some((v) => COLUMN_WORDS.has(v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()))) return true;
  const nums: { v: string; i: number }[] = [];
  row.forEach((v, i) => {
    if (v !== "" && isNumberish(v)) nums.push({ v, i });
  });
  if (nums.length === 0) return false;
  if (nums.every(({ v }) => (cellKind(v) === "int" && YEAR_RANGE(Number(v.replace(/,/g, "")))) || (cellKind(v) === "date" && isMonthStart(v)))) return true;
  const serial = (v: string, i: number) => (next !== undefined && Number(next[i]) === Number(v) + 1) || (before !== undefined && Number(before[i]) === Number(v) - 1);
  const ints = nums.filter(({ v, i }) => !(cellKind(v) === "int" && serial(v, i)));
  if (ints.length < 2 || ints.some(({ v }) => cellKind(v) !== "int")) return false;
  const vals = ints.map(({ v }) => Number(v.replace(/,/g, "")));
  if (!vals.every((v, k) => k === 0 || v > vals[k - 1]!)) return false;
  // Column names that are numbers count up by one (1, 2, 3) or stay of one size (lengths 8 to 20 ft). A quantity
  // next to a weight (12 | 1200) does not.
  if (vals.every((v, k) => k === 0 || v === vals[k - 1]! + 1)) return true;
  // Two numbers of one size are common in a data row (Pcs | Kg), so two count only when both are small (12 | 16).
  const top = vals[vals.length - 1]!;
  return sameSize && (vals.length === 2 ? top <= 100 : top <= 3 * vals[0]! && top <= 10000);
}

/** Rows kept above the header when a long title moves the preview window down (R4-7). */
export const PREVIEW_ABOVE_HEADER = 3;

/** A cell a person would read as a value: a number or a date. */
export function isValueCell(c: string): boolean {
  const k = cellKind(c);
  return k === "int" || k === "decimal" || k === "date";
}

/**
 * Which rows of `from` to `end` (exclusive) a preview shows (PORTAL-RULES-3 section 5.1, M6). The first
 * `PREVIEW_ROWS` rows, when they hold the guessed header and two rows under it and, when the region has rows with
 * numbers or dates, one of them under the header. Otherwise the window moves to `PREVIEW_ABOVE_HEADER` rows above the
 * header, or above the row before the first row with values when the guess has none under it in the first window, and
 * the first `PREVIEW_HEAD_ROWS` rows of the region come first. A moved window leaves a gap in the row numbers.
 */
export function previewIndices(from: number, end: number, header: number, headerRows: number, hasValue: (r: number) => boolean): number[] {
  const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);
  if (end - from <= PREVIEW_ROWS) return range(from, end);
  let focus = header;
  if (header + headerRows + 2 <= from + PREVIEW_ROWS) {
    const under = range(header + headerRows, from + PREVIEW_ROWS);
    if (under.some(hasValue)) return range(from, from + PREVIEW_ROWS);
    const first = range(from + PREVIEW_ROWS, end).find(hasValue);
    if (first === undefined) return range(from, from + PREVIEW_ROWS);
    focus = first - 1;
  }
  const start = Math.max(from + PREVIEW_HEAD_ROWS, focus - PREVIEW_ABOVE_HEADER);
  if (start <= from + PREVIEW_HEAD_ROWS) return range(from, Math.min(end, from + PREVIEW_HEAD_ROWS + PREVIEW_ROWS));
  return [...range(from, from + PREVIEW_HEAD_ROWS), ...range(start, Math.min(end, start + PREVIEW_ROWS))];
}

/** The raw rows of rows `from` to `to` (exclusive) a preview shows, with their row numbers; see `previewIndices`. */
export function previewRows(rows: readonly (readonly string[])[], from: number, to: number, header = from, headerRows = 1): PreviewRow[] {
  const end = Math.min(to, rows.length);
  const hasValue = (r: number) => rows[r]!.some(isValueCell);
  return previewIndices(from, end, header, headerRows, hasValue).map((r) => ({ row: r, cells: [...rows[r]!] }));
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

/**
 * Hints cross JSON between the web and the server, so the type alone proves nothing (R3-8). The header has one or two
 * rows; the header row, the first data row and the last data row are whole numbers when given; the page fields too.
 */
export function checkHintShape(h: BlockHints): void {
  const whole = (v: unknown) => typeof v === "number" && Number.isInteger(v);
  const optional = (v: unknown) => v === undefined || whole(v);
  if (!whole(h.headerRow)) throw new HintError("hint_out_of_range", "the header row is not a row number");
  if (h.headerRows !== undefined && h.headerRows !== 1 && h.headerRows !== 2) throw new HintError("hint_out_of_range", "the header has one or two rows");
  if (!optional(h.firstDataRow)) throw new HintError("hint_out_of_range", "the first data row is not a row number");
  if (h.lastDataRow !== null && !optional(h.lastDataRow)) throw new HintError("hint_out_of_range", "the last data row is not a row number");
  if (!optional(h.page) || !optional(h.lastPage)) throw new HintError("hint_out_of_range", "the page is not a page number");
}

/** The first raw row of a block's region: its title, or its header. Not `preview[0]`, which may show rows above. */
export const regionStartOf = (b: ReadBlock) => b.guess.headerRow - b.headerRow;

/**
 * The last filled row of rows `from` to `to`, stopping at a run of two or more blank rows (PORTAL-RULES-3 section 5.2):
 * a single blank row is ignored. `from - 1` when there is none.
 */
export function regionEnd(rows: readonly string[][], from: number, to: number): number {
  let last = from - 1;
  let blanks = 0;
  for (let r = from; r <= to; r++) {
    if (nonBlank(rows[r]!) > 0) {
      last = r;
      blanks = 0;
    } else if (++blanks >= 2) break;
  }
  return last;
}

/** Rows to show around a guessed split: this many filled rows above it and rows from the next block's start. */
export const SPLIT_CONTEXT_ROWS = 2;

/** `preview` with rows `from` to `to` added, in row order, each row once. */
function withRows(preview: readonly PreviewRow[], rows: readonly (readonly string[])[], from: number, to: number): PreviewRow[] {
  const have = new Set(preview.map((p) => p.row));
  const out = [...preview];
  for (let r = Math.max(0, from); r <= Math.min(to, rows.length - 1); r++) if (!have.has(r)) out.push({ row: r, cells: [...rows[r]!] });
  return out.sort((a, b) => a.row - b.row);
}

/** One sheet read: its blocks, and rows that no block took. */
export type SheetRead = { blocks: ReadBlock[]; warnings: RowWarning[] };

export type FindBlocksOptions = {
  sheetName?: string | null;
  /** Hints for blocks of the sheet. Hinted regions follow them exactly; the rest of the sheet is guessed (R3-7). */
  hints?: readonly BlockHints[] | null;
  /** For the PDF reader: no header guess when no row looks like a header (it first tries the lines above a run). */
  noHeaderGuess?: boolean;
};

export const lastFilled = (rows: readonly string[][], from: number, to: number) => {
  let last = from - 1;
  for (let r = from; r <= to; r++) if (nonBlank(rows[r]!) > 0) last = r;
  return last;
};

/** Pad ragged rows under blank headers (C34) and cut trailing blank columns. */
export function finishShape(headersIn: readonly string[], data: readonly string[][]): { headers: string[]; rows: string[][] } {
  let headers = [...headersIn];
  const wide = data.reduce((m, r) => Math.max(m, r.length), headers.length);
  if (wide > headers.length) headers = [...headers, ...Array<string>(wide - headers.length).fill("")];
  const width = usedWidth(headers, data);
  return { headers: headers.slice(0, width), rows: data.map((r) => r.slice(0, width)) };
}

/**
 * Follow the hints exactly: no header search, no title test, no table split inside a hinted region (R3-7, rule 5.2).
 * The rest of the sheet keeps the guess, so a hint for one table does not swallow or drop another:
 * - A hinted block without a last data row ends before the next hinted header, or at the last filled row before two
 *   or more blank rows, or at the end of the sheet. A single blank row never ends it: a row after one is a row (B5).
 * - A guessed block outside every hinted region stays as guessed. One whose header sits above a hinted header and
 *   whose rows run into it (the guess joined two tables) keeps its rows above the hinted region, when there are two
 *   or more and a column of numbers or dates; otherwise those rows are the hinted block's title.
 * - Rows between blocks that no guessed block takes are the title of the hinted block below them (each listed as
 *   `kept_as_title`), else `after_last_row` of the hinted block above, else sheet warnings.
 */
function readByHints(rows: readonly string[][], hintsIn: readonly BlockHints[], sheetName: string | null): SheetRead {
  const n = rows.length;
  for (const h of hintsIn) checkHintShape(h);
  const hints = [...hintsIn].sort((a, b) => a.headerRow - b.headerRow);
  const full = guessRange(rows, 0, n, sheetName).blocks;
  const regionOf = (b: ReadBlock) => [regionStartOf(b), Math.max(b.guess.lastDataRow ?? -1, b.guess.headerRow + b.headerRows - 1)] as const;
  type Span = { hint: BlockHints; h: number; headerRows: 1 | 2; first: number; last: number };
  const spans: Span[] = [];
  let prevLast = -1;
  hints.forEach((hint, x) => {
    const h = hint.headerRow;
    const headerRows = hint.headerRows ?? 1;
    if (h < 0 || h + headerRows > n) throw new HintError("hint_out_of_range", `header row ${h} is not in the sheet`);
    if (h <= prevLast) throw new HintError("hint_overlap", `header row ${h} is inside the block above`);
    const next = hints[x + 1];
    if (next && next.headerRow < h + headerRows) throw new HintError("hint_overlap", `header row ${next.headerRow} is inside the header above`);
    const first = hint.firstDataRow ?? h + headerRows;
    if (first < h + headerRows) throw new HintError("hint_order", `first data row ${first} is above the header`);
    const last = hint.lastDataRow ?? Math.max(first - 1, regionEnd(rows, first, next ? next.headerRow - 1 : n - 1));
    if (last < first - 1 || last >= n) throw new HintError("hint_out_of_range", `last data row ${last} is not in the sheet`);
    if (next && next.headerRow <= last) throw new HintError("hint_overlap", `header row ${next.headerRow} is inside the block above`);
    spans.push({ hint, h, headerRows, first, last });
    prevLast = last;
  });

  // The guessed blocks that stay: outside every hinted region, or cut short above one.
  const keptGuess: ReadBlock[] = [];
  for (const b of full) {
    const [start, end] = regionOf(b);
    const hit = spans.find((sp) => start <= sp.last && end >= sp.h);
    if (!hit) {
      keptGuess.push(b);
      continue;
    }
    const dataFrom = b.guess.firstDataRow!;
    if (b.guess.headerRow + b.headerRows - 1 >= hit.h || dataFrom >= hit.h) continue;
    const cut = lastFilled(rows as string[][], dataFrom, hit.h - 1);
    const data = rows.slice(dataFrom, cut + 1);
    // A table: two or more rows and a column of numbers or dates. Key and value lines ("Phone | 98...") are a title.
    const filled = data.filter((r) => nonBlank(r) > 0);
    const width = filled.reduce((w, r) => Math.max(w, r.length), 0);
    const numberColumn = Array.from({ length: width }, (_, c) => inferKind(filled.map((r) => r[c] ?? ""))).some((k) => k === "int" || k === "decimal" || k === "date");
    if (filled.length < 2 || !numberColumn) continue;
    const top = rows[b.guess.headerRow]!;
    const shaped = finishShape(b.headerRows === 2 ? combineHeaders(top, rows[b.guess.headerRow + 1]!) : top, data);
    const block: ReadBlock = { ...b, headers: shaped.headers, rows: shaped.rows, preview: previewRows(rows, start, hit.h, b.guess.headerRow, b.headerRows), guess: { ...b.guess, lastDataRow: cut } };
    keptGuess.push(block);
  }

  const blocks: ReadBlock[] = [];
  const warnings: RowWarning[] = [];
  let prevHinted: ReadBlock | null = null;
  /** Rows `from` to `to`: the guessed blocks there, and the first row of the hinted block's title below (or `to`). */
  const gap = (from: number, to: number, before: boolean): number => {
    const inKept = new Set<number>();
    let covered = from - 1;
    for (const b of keptGuess) {
      const [start, end] = regionOf(b);
      if (start < from || start >= to) continue;
      blocks.push(b);
      for (let r = start; r <= end; r++) inKept.add(r);
      covered = Math.max(covered, end);
    }
    for (let r = from; r < to; r++) {
      if (inKept.has(r) || nonBlank(rows[r]!) === 0 || (before && r > covered)) continue;
      if (prevHinted) prevHinted.warnings.push({ code: "after_last_row", row: r });
      else warnings.push({ code: "not_placed", row: r });
    }
    return before ? covered + 1 : to;
  };

  let from = 0;
  for (const { hint, h, headerRows, first, last } of spans) {
    const titleFrom = gap(from, h, true);
    let start = h;
    for (let r = titleFrom; r < h; r++) {
      if (nonBlank(rows[r]!) > 0) {
        start = r;
        break;
      }
    }
    const titleParts: string[] = [];
    const blockWarnings: RowWarning[] = [];
    for (let r = start; r < h; r++) {
      const cells = rows[r]!.filter((c) => c !== "");
      if (cells.length > 0) titleParts.push(cells.join(" "));
      if (cells.length > 0) blockWarnings.push({ code: "kept_as_title", row: r });
    }
    const headers = headerRows === 2 ? combineHeaders(rows[h]!, rows[h + 1]!) : rows[h]!;
    for (let r = h + headerRows; r < first; r++) if (nonBlank(rows[r]!) > 0) blockWarnings.push({ code: "skipped_by_hint", row: r });
    const end = lastFilled(rows as string[][], first, last);
    const shaped = finishShape(headers, rows.slice(first, end + 1));
    const block: ReadBlock = {
      sheetName,
      title: titleParts.length > 0 ? titleParts.join(" ") : null,
      headerRow: h - start,
      headerRows,
      headers: shaped.headers,
      rows: shaped.rows,
      firstDataSheetRow: first,
      preview: previewRows(rows, start, Math.max(last + 1, h + headerRows), h, headerRows),
      guess: { headerRow: h, headerRows, firstDataRow: first, lastDataRow: end },
      hints: { ...hint },
      warnings: blockWarnings,
      doubts: [],
    };
    blocks.push(block);
    prevHinted = block;
    from = last + 1;
  }
  gap(from, n, false);
  return { blocks, warnings };
}

/**
 * The guess over rows `from` to `to` (exclusive). The header search looks at the next 20 rows that are not blank (R3-6). When none of them
 * looks like a header, the first row of two or more cells with a row under it is the guessed header (R3-5): the block
 * holds numbers or dates, which no layout may know, but there is a guess to show and to correct by hints. A window with
 * no such row is reported row by row and the search goes on below it.
 */
export function guessRange(rows: readonly string[][], from: number, to: number, sheetName: string | null, noHeaderGuess = false): SheetRead {
  const n = to;
  const blocks: ReadBlock[] = [];
  const warnings: RowWarning[] = [];
  let pos = from;
  // The block above a guessed split, and the last filled row before the split.
  let split: { block: ReadBlock; lastData: number } | null = null;

  while (pos < n) {
    let h = -1;
    let fallback = -1;
    let seen = 0;
    let windowEnd = n;
    for (let i = pos; i < n; i++) {
      if (nonBlank(rows[i]!) === 0) continue;
      if (seen === HEADER_SEARCH_ROWS) {
        windowEnd = i;
        break;
      }
      seen++;
      if (isHeaderLike(rows[i]!)) {
        h = i;
        break;
      }
      if (fallback === -1 && nonBlank(rows[i]!) >= 2) {
        let k = i + 1;
        while (k < n && nonBlank(rows[k]!) === 0) k++;
        if (k < n) fallback = i;
      }
    }
    // A header-like row with no row under it ("Prepared by | Checked by" under a table whose header holds numbers) is
    // not the header when a row of two or more cells above it has rows under it (R4-6).
    if (h !== -1 && fallback !== -1 && !rows.slice(h + 1, n).some((r) => nonBlank(r) > 0)) h = noHeaderGuess ? -1 : fallback;
    else if (h === -1 && !noHeaderGuess) h = fallback;
    if (h === -1) {
      // No table in this window: its rows are reported, never dropped quietly, and the search goes on below.
      for (let r = pos; r < windowEnd; r++) if (nonBlank(rows[r]!) > 0) warnings.push({ code: "not_placed", row: r });
      pos = windowEnd;
      continue;
    }
    const real = isTitleAbove(rows, h, n);
    if (real !== -1) h = real;

    let start = h;
    for (let i = pos; i < h; i++) {
      if (nonBlank(rows[i]!) > 0) {
        start = i;
        break;
      }
    }
    const titleParts: string[] = [];
    const blockWarnings: RowWarning[] = [];
    for (let i = start; i < h; i++) {
      const cells = rows[i]!.filter((c) => c !== "");
      if (cells.length > 0) titleParts.push(cells.join(" "));
      if (cells.length > 0) blockWarnings.push({ code: "kept_as_title", row: i });
    }

    let headers = rows[h]!;
    let headerRows: 1 | 2 = 1;
    const next = h + 1 < n ? rows[h + 1] : undefined;
    if (next && isSecondHeaderRow(headers, next, h + 2 < n ? rows[h + 2] : undefined)) {
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
          const below = k + 1 < n ? rows[k + 1] : undefined;
          found = below !== undefined && nonBlank(below) > 0 && !isHeaderLike(below) && startsNewBlock(cand, data.slice(-200), headers.length);
          break;
        }
      }
      if (found) {
        end = i;
        break;
      }
      // A blank row inside one block; the rows after it are rows of this table.
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
      preview: previewRows(rows, start, end, h, headerRows),
      guess: { headerRow: h, headerRows, firstDataRow: dataStart, lastDataRow: dataStart + data.length - 1 },
      hints: null,
      warnings: blockWarnings,
      doubts: [],
    };
    // A guessed split (rule 5.2): both previews show the last rows above it and the first rows of the block below.
    if (split) {
      const above = Math.max(split.block.guess.firstDataRow ?? 0, split.lastData - SPLIT_CONTEXT_ROWS + 1);
      split.block.preview = withRows(split.block.preview, rows, above, start + SPLIT_CONTEXT_ROWS);
      block.preview = withRows(block.preview, rows, above, start - 1);
      split = null;
    }
    blocks.push(block);
    if (end === n) break;
    split = { block, lastData: lastFilled(rows as string[][], dataStart, end - 1) };
  }
  return { blocks, warnings };
}

/**
 * Matrix to blocks with the reader's guess, or by hints. A block carries a preview of its region and its header as
 * hints; whether that header is trusted is `chooseHeader`'s answer, not the reader's.
 */
export function readSheet(matrix: readonly (readonly MatrixCell[])[], opts: FindBlocksOptions = {}): SheetRead {
  const rows = matrix.map((r) => r.map(toCellText));
  const sheetName = opts.sheetName ?? null;
  if (opts.hints && opts.hints.length > 0) return readByHints(rows, opts.hints, sheetName);
  return guessRange(rows, 0, rows.length, sheetName, opts.noHeaderGuess ?? false);
}

/** The blocks of `readSheet`. */
export function findBlocks(matrix: readonly (readonly MatrixCell[])[], opts: FindBlocksOptions = {}): ReadBlock[] {
  return readSheet(matrix, opts).blocks;
}
