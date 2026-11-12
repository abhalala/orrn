/**
 * Matrix to blocks (plan B2): header detection, titles, two-row headers, several tables on one sheet.
 *
 * The header is the first row in the first 20 with at least 2 non-blank cells, at least 60% of them text. Rows above it
 * are the title. If the next row is also at least 60% text and the header has merged or blank cells, the two combine as
 * "top bottom" with `headerRows = 2`. A blank row followed by a new header-like row starts a new block.
 */
import { cellKind, inferKind } from "../cells";
import { parseDate } from "../dates";
import { DROPPED_FORMAT, isUnitOnlyName, normalizeHeader, usedWidth } from "../fingerprint";
import { PREVIEW_HEAD_ROWS, PREVIEW_ROWS, type BlockHints, type MatrixCell, type PreviewRow, type ReadBlock, type RowWarning } from "./types";

export const HEADER_SEARCH_ROWS = 20;
export const HEADER_TEXT_SHARE = 0.6;

/**
 * A cell as text (PORTAL-RULES-3 section 5.4). Text passes through as it is, never coerced. A number, when a matrix
 * hands one over, is written without float noise: a whole number as it is, any other at 15 significant digits, so
 * 12.299999999999999 is "12.3" and 0.1 + 0.2 is "0.3". What a person saw ("007", "18%", "12.30") only the file's
 * formatted text gives, so the web hands that over as a string. Excel dates arrive as Date objects: they become
 * `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM:SS` when there is a time. A date is never shifted by the time zone of the
 * machine that reads it (round 6): a Date at UTC midnight is that UTC date (libraries that build dates in UTC), a Date
 * at local midnight is that local date (SheetJS, which the web uses, builds them in local time). Any other Date is
 * written with its UTC clock. One case stays open: a time that is exactly local midnight in UTC (18:30 UTC in India)
 * from a UTC library reads as the next date. Handing over the formatted text avoids it.
 */
export function toCellText(v: MatrixCell): string {
  if (v === null || v === undefined) return "";
  // Invisible format characters are dropped as in names (round 7), except the joiners U+200C and U+200D.
  if (typeof v === "string") return v.replace(DROPPED_FORMAT, "").replace(/\u00a0/g, " ").trim();
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    if (Object.is(v, -0)) return "0";
    return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(15)));
  }
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (Number.isNaN(v.getTime())) return "";
  const iso = v.toISOString();
  if (iso.endsWith("T00:00:00.000Z")) return iso.slice(0, 10);
  if (v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0 && v.getMilliseconds() === 0) {
    const two = (x: number) => String(x).padStart(2, "0");
    return `${String(v.getFullYear()).padStart(4, "0")}-${two(v.getMonth() + 1)}-${two(v.getDate())}`;
  }
  return iso.slice(0, 19);
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
  if (h.skipRows !== undefined && (!Array.isArray(h.skipRows) || !h.skipRows.every(whole))) throw new HintError("hint_out_of_range", "a skip row is not a row number");
}

/** The first raw row of a block's region: its title, or its header. Not `preview[0]`, which may show rows above. */
export const regionStartOf = (b: ReadBlock) => b.guess.headerRow - b.headerRow;

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

/** A row whose filled cells are all unit words ("Rs | nos | kg"): the second line of a header, not data. */
function isUnitsRow(row: readonly string[]): boolean {
  const cells = row.filter((c) => c !== "");
  return cells.length > 0 && cells.every((c) => isUnitOnlyName(normalizeHeader(c)));
}

/** Two rows hold the same names, exactly: cells trimmed, trailing blank cells ignored. */
export function sameNames(a: readonly string[], b: readonly string[]): boolean {
  const cut = (r: readonly string[]) => {
    const t = r.map((c) => c.trim());
    let e = t.length;
    while (e > 0 && t[e - 1] === "") e--;
    return t.slice(0, e);
  };
  const x = cut(a);
  const y = cut(b);
  return x.length > 0 && x.length === y.length && x.every((c, i) => c === y[i]);
}

/** The index after a row's last filled cell. */
const filledWidth = (r: readonly string[]) => {
  for (let c = r.length - 1; c >= 0; c--) if ((r[c] ?? "").trim() !== "") return c + 1;
  return 0;
};

/** A cell with no value: blank, or a blank-value word ("-", "Nil"). */
const isBlankValue = (c: string) => c.trim() === "" || NULL_WORD.test(c.trim());

/** The text of a row's filled cells, joined by one space. */
const rowText = (r: readonly string[]) => r.filter((c) => c.trim() !== "").map((c) => c.trim()).join(" ");

/**
 * Rule 8.1: the kind of each column from the data rows read so far. "value" when every value is a number or a date,
 * "text" when any value is text (a code is text), undefined when the column has no value yet. A units row under the
 * header ("kg | pcs") is not data and is not counted.
 */
export class ColumnKinds {
  private kinds: ("value" | "text" | undefined)[] = [];
  width: number;
  rows = 0;
  constructor(headerWidth: number) {
    this.width = headerWidth;
  }
  add(row: readonly string[]): void {
    this.width = Math.max(this.width, filledWidth(row));
    if (isUnitsRow(row)) return;
    row.forEach((c, i) => {
      if (isBlankValue(c)) return;
      this.kinds[i] = this.kinds[i] === "text" || !isValueCell(c) ? "text" : "value";
    });
    this.rows++;
  }
  /** At least one column holds numbers or dates only. */
  hasValueColumn(): boolean {
    return this.kinds.some((k) => k === "value");
  }
  /**
   * Data that fits: every filled cell inside the width, and a number or a date (or no value) in every number or date
   * column. A table with no number or date column takes no row this way. With no data row yet (a blank spacer right
   * under the header), a row inside the width with a number or a date in it is the first data row.
   */
  fits(row: readonly string[]): boolean {
    if (filledWidth(row) > this.width) return false;
    if (this.rows === 0) return row.some((c) => isValueCell(c));
    if (!this.hasValueColumn()) return false;
    // A row of two or more words and nothing else, in a table with numbers, is another table's header whose names
    // happen to sit over text columns ("Party | Qty | Section" under a table whose Qty holds a word). Round 8 guard,
    // beyond the letter of rule 8.1: it keeps a different table from being swallowed.
    const cells = row.filter((c) => c.trim() !== "");
    if (cells.length >= 2 && cells.every((c) => isWord(c.trim()))) return false;
    return row.every((c, i) => isBlankValue(c) || this.kinds[i] !== "value" || isValueCell(c));
  }
}

/** Rule 8.1: where a table ends, and the rows it left out after blank rows. */
export type TableRun = { last: number; skipped: RowWarning[] };

/**
 * Rule 8.1 (round 8): read a table down from `first` to `limit` (inclusive), its header known. Rows right under the
 * header or under a data row are data. After one or more blank rows, the next filled row is:
 * - a repeat of the header (two or more filled cells, every name of the header in its column, by normalised name):
 *   left out, listed as `skipped_repeat_header`, and the table goes on (with the second header row, when the header
 *   has two rows and the next row repeats it too);
 * - a single text cell: left out and listed as `skipped_title`, when the table goes on after it;
 * - data that fits the column kinds (`ColumnKinds.fits`, with its one guard against a header of words): the table
 *   goes on with it;
 * - anything else: the table ends before the blank rows. Text in a number or date column is the sign of another
 *   table's header.
 * Titles with no more of the table after them are not listed here; the caller places them.
 */
export function readTableRun(rows: readonly (readonly string[])[], header: readonly string[], second: readonly string[] | null, first: number, limit: number): TableRun {
  const kinds = new ColumnKinds(Math.max(filledWidth(header), second ? filledWidth(second) : 0));
  // A repeat holds every name of the header, each in its column, and nothing else (a shorter header that starts with
  // the same names is another table).
  const norm = (r: readonly string[]) => {
    const t = r.map((c) => normalizeHeader(c));
    let e = t.length;
    while (e > 0 && t[e - 1] === "") e--;
    return t.slice(0, e);
  };
  const names = norm(header);
  const isRepeat = (r: readonly string[]) => {
    if (nonBlank(r) < 2) return false;
    const got = norm(r);
    return got.length === names.length && got.every((c, i) => c === names[i]);
  };
  const isTitle = (r: readonly string[]) => {
    const cells = r.filter((c) => c.trim() !== "");
    return cells.length === 1 && !isValueCell(cells[0]!) && !NULL_WORD.test(cells[0]!.trim());
  };
  const skipped: RowWarning[] = [];
  let last = first - 1;
  let r = first;
  while (r <= limit) {
    if (nonBlank(rows[r]!) > 0) {
      kinds.add(rows[r]!);
      last = r++;
      continue;
    }
    const held: RowWarning[] = [];
    let resume = -1;
    for (let k = r; k <= limit; k++) {
      const row = rows[k]!;
      if (nonBlank(row) === 0) continue;
      if (isRepeat(row)) {
        held.push({ code: "skipped_repeat_header", row: k, text: rowText(row) });
        resume = k + 1;
        if (second && k + 1 <= limit && sameNames(rows[k + 1]!, second)) {
          held.push({ code: "skipped_repeat_header", row: k + 1, text: rowText(rows[k + 1]!) });
          resume = k + 2;
        }
        break;
      }
      if (isTitle(row)) {
        held.push({ code: "skipped_title", row: k, text: rowText(row) });
        continue;
      }
      if (kinds.fits(row)) resume = k;
      break;
    }
    if (resume === -1) break;
    skipped.push(...held);
    r = resume;
  }
  return { last, skipped };
}

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
 * Follow the hints exactly: no header search, no title test, no table split inside a hinted region (R3-7). The rest
 * of the sheet keeps the guess, so a hint for one table does not swallow or drop another (rule 6.1):
 * - A hinted block without a last data row ends at the first fully blank row after its first data row, or before the
 *   next hinted header, or at the end of the sheet. It never runs across a blank row on its own. A given last data
 *   row is followed exactly, across blank rows; `skipRows` leaves rows of that range out (as blank rows, listed).
 * - Above the first hinted header and below each hinted block, the rows are guessed again from there, as if the sheet
 *   started there, so each table below gets its own guess and preview. A guessed block whose header sits above the
 *   next hinted header and whose rows run into it keeps its rows above the hinted region, when there are two or more
 *   and a column of numbers or dates; otherwise those rows are the hinted block's title (`kept_as_title`).
 * - A row no block takes, below some block: rows that look like data (two or more cells, not all text) form a block
 *   of their own (the first of them is its guessed header), so the person can join it to the table above. Other rows
 *   (a note, a footer) are `after_last_row` of the nearest block above. Only rows above every block are sheet
 *   warnings (`not_placed`).
 */
function readByHints(rows: readonly string[][], hintsIn: readonly BlockHints[], sheetName: string | null): SheetRead {
  const n = rows.length;
  for (const h of hintsIn) checkHintShape(h);
  const hints = [...hintsIn].sort((a, b) => a.headerRow - b.headerRow);
  const regionOf = (b: ReadBlock) => [regionStartOf(b), Math.max(b.guess.lastDataRow ?? -1, b.guess.headerRow + b.headerRows - 1)] as const;
  type Span = { hint: BlockHints; h: number; headerRows: 1 | 2; first: number; last: number; skipped: RowWarning[] };
  const spans: Span[] = [];
  let prevLast = -1;
  hints.forEach((hint, x) => {
    const h = hint.headerRow;
    const headerRows = hint.headerRows ?? 1;
    if (h < 0 || h + headerRows > n) throw new HintError("hint_out_of_range", `header row ${h} is not in the sheet`);
    // A header with no name in it is not a header (H5): blank header rows are a hint error, not blank column names.
    if (rows.slice(h, h + headerRows).every((r) => nonBlank(r) === 0)) throw new HintError("hint_out_of_range", `header row ${h} is blank`);
    if (h <= prevLast) throw new HintError("hint_overlap", `header row ${h} is inside the block above`);
    const next = hints[x + 1];
    if (next && next.headerRow < h + headerRows) throw new HintError("hint_overlap", `header row ${next.headerRow} is inside the header above`);
    const first = hint.firstDataRow ?? h + headerRows;
    if (first < h + headerRows) throw new HintError("hint_order", `first data row ${first} is above the header`);
    // A first data row the person named must be a row of the sheet (H12). With none named, a header on the last row
    // is a block with no rows.
    if (hint.firstDataRow != null && first >= n) throw new HintError("hint_out_of_range", `first data row ${first} is not in the sheet`);
    let last: number;
    let skipped: RowWarning[] = [];
    if (hint.lastDataRow != null) last = hint.lastDataRow;
    else {
      // Rule 8.1: the table goes on across blank rows while what follows fits it, up to the next hinted header.
      const limit = Math.min(n - 1, next ? next.headerRow - 1 : n - 1);
      const run = readTableRun(rows, rows[h]!, headerRows === 2 ? rows[h + 1]! : null, first, limit);
      skipped = run.skipped;
      // A repeat of the header with no data under it is listed and read past.
      last = Math.max(run.last, ...skipped.map((w) => w.row));
    }
    if (last < first - 1 || last >= n) throw new HintError("hint_out_of_range", `last data row ${last} is not in the sheet`);
    if (next && next.headerRow <= last) throw new HintError("hint_overlap", `header row ${next.headerRow} is inside the block above`);
    for (const r of hint.skipRows ?? []) if (r < first || r > last) throw new HintError("hint_out_of_range", `skip row ${r} is not a data row of the block`);
    spans.push({ hint, h, headerRows, first, last, skipped });
    prevLast = last;
  });

  const blocks: ReadBlock[] = [];
  const warnings: RowWarning[] = [];
  /** Rule 8.1: a hinted table with no number or date column (or no data row). */
  const textOnly = (sp: Span) => {
    const k = new ColumnKinds(0);
    for (let r = sp.first; r <= sp.last; r++) if (nonBlank(rows[r]!) > 0 && !sp.skipped.some((w) => w.row === r)) k.add(rows[r]!);
    return !k.hasValueColumn();
  };
  /** Filled rows that no block takes and that are no title. */
  const loose: number[] = [];

  /**
   * Rows `from` to `to` (exclusive), guessed again from `from`. Pushes the guessed blocks that start there, cut short
   * above `span` when they run into it, and notes the rows they leave. Returns the first row of `span`'s title.
   */
  const gap = (from: number, to: number, span: Span | null, upperHeader: readonly string[] | null): number => {
    // Below a hinted block, a row that repeats its header names exactly (rule 6.1), after a blank row and up to three
    // one-cell title rows ("December"), starts a guess of its own, so the guess above it cannot take it as a row.
    const end = span ? span.last + 1 : n;
    const cuts = [from];
    if (upperHeader) {
      for (let r = from + 1; r < to; r++) {
        if (!sameNames(rows[r]!, upperHeader)) continue;
        let k = r;
        while (k - 1 > from && r - k < 3 && nonBlank(rows[k - 1]!) === 1) k--;
        if (nonBlank(rows[k - 1]!) === 0 && k > cuts[cuts.length - 1]!) cuts.push(k);
      }
    }
    cuts.push(end);
    const guessed = cuts.slice(0, -1).flatMap((a, i) => guessRange(rows, a, cuts[i + 1]!, sheetName, false, upperHeader !== null).blocks);
    const inKept = new Set<number>();
    let covered = from - 1;
    for (const b of guessed) {
      const [start, end] = regionOf(b);
      if (start < from || start >= to) continue;
      // Below a hinted block, a guessed header over at most one row of text and no row that looks like data is no
      // table (C33): a footer such as "Prepared by | Checked by". Its rows go with the block above. A table whose
      // first row under the header reads as names (a units row) is still a table when data follows. Across blank rows
      // below a table of text columns only, such rows may be more of that table (rule 8.1): they stay a block that
      // follows it, unless the header has no row under it at all.
      const sp = from > 0 ? spans.find((x) => x.last + 1 === from) : undefined;
      if (sp) {
        const under = rows.slice(b.firstDataSheetRow, (b.guess.lastDataRow ?? -1) + 1).filter((r) => nonBlank(r) > 0);
        const footer = under.length < 2 && !under.some((r) => nonBlank(r) >= 2 && textShare(r) < 1);
        if (footer && (start === from || under.length === 0 || !textOnly(sp))) continue;
      }
      let keep: ReadBlock | null = b;
      if (span && end >= span.h) {
        keep = null;
        const dataFrom = b.firstDataSheetRow;
        if (b.guess.headerRow + b.headerRows - 1 < span.h && dataFrom < span.h) {
          const cut = lastFilled(rows as string[][], dataFrom, span.h - 1);
          const data = rows.slice(dataFrom, cut + 1);
          // A table: two or more rows and a column of numbers or dates. Key and value lines ("Phone | 98...") are a title.
          const filled = data.filter((r) => nonBlank(r) > 0);
          const width = filled.reduce((w, r) => Math.max(w, r.length), 0);
          const numberColumn = Array.from({ length: width }, (_, c) => inferKind(filled.map((r) => r[c] ?? ""))).some((k) => k === "int" || k === "decimal" || k === "date");
          if (filled.length >= 2 && numberColumn) {
            const top = rows[b.guess.headerRow]!;
            const shaped = finishShape(b.headerRows === 2 ? combineHeaders(top, rows[b.guess.headerRow + 1]!) : top, data);
            keep = { ...b, headers: shaped.headers, rows: shaped.rows, preview: previewRows(rows, start, span.h, b.guess.headerRow, b.headerRows), guess: { ...b.guess, lastDataRow: cut } };
          }
        }
      }
      if (!keep) continue;
      blocks.push(keep);
      const [, keptEnd] = regionOf(keep);
      for (let r = start; r <= keptEnd; r++) inKept.add(r);
      for (const w of keep.warnings) inKept.add(w.row);
      covered = Math.max(covered, keptEnd);
    }
    for (let r = from; r < to; r++) {
      if (inKept.has(r) || nonBlank(rows[r]!) === 0 || (span && r > covered)) continue;
      loose.push(r);
    }
    return span ? covered + 1 : to;
  };

  let from = 0;
  let upperHeader: readonly string[] | null = null;
  for (const span of spans) {
    const { hint, h, headerRows, first, last, skipped } = span;
    const titleFrom = gap(from, h, span, upperHeader);
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
    const skip = new Set(hint.skipRows ?? []);
    for (const r of [...skip].sort((x, y) => x - y)) blockWarnings.push({ code: "skipped_by_hint", row: r });
    for (const w of skipped) {
      skip.add(w.row);
      blockWarnings.push(w);
    }
    const end = lastFilled(rows as string[][], first, last);
    const shaped = finishShape(headers, rows.slice(first, end + 1).map((r, i) => (skip.has(first + i) ? [] : r)));
    blocks.push({
      sheetName,
      title: titleParts.length > 0 ? titleParts.join(" ") : null,
      headerRow: h - start,
      headerRows,
      headers: shaped.headers,
      rows: shaped.rows,
      firstDataSheetRow: first,
      preview: previewRows(rows, start, Math.max(last + 1, h + headerRows), h, headerRows),
      guess: { headerRow: h, headerRows, firstDataRow: first, lastDataRow: end, ...(skip.size > 0 ? { skipRows: [...skip].sort((x, y) => x - y) } : {}) },
      hints: { ...hint },
      warnings: blockWarnings,
      doubts: [],
    });
    from = last + 1;
    upperHeader = rows[h]!;
  }
  gap(from, n, null, upperHeader);

  // Rows no block takes: rows that look like data form blocks of their own, other rows go with the block above.
  blocks.sort((x, y) => regionStartOf(x) - regionStartOf(y));
  const above = (r: number) => {
    let at: ReadBlock | null = null;
    for (const b of blocks) if (regionStartOf(b) < r) at = b;
    return at;
  };
  loose.sort((x, y) => x - y);
  const extra = placeLoose(rows, loose, above, warnings, sheetName);
  for (const b of extra) blocks.push(b);
  blocks.sort((x, y) => regionStartOf(x) - regionStartOf(y));
  for (const b of blocks) b.warnings.sort((x, y) => x.row - y.row);
  return { blocks, warnings };
}

/**
 * Rows no block takes, in row order, placed (rule 6.1): rows that look like data (two or more cells, not all text)
 * form blocks of their own, a run of them with nothing between being one block whose first row is its guessed header;
 * other rows (a note, a footer) are `after_last_row` of the block `owner` names. Rows with no block above are sheet
 * warnings (`not_placed`). Returns the new blocks.
 */
function placeLoose(rows: readonly string[][], loose: readonly number[], owner: (r: number) => ReadBlock | null, warnings: RowWarning[], sheetName: string | null): ReadBlock[] {
  const looksLikeData = (r: number) => nonBlank(rows[r]!) >= 2 && textShare(rows[r]!) < 1;
  const extra: ReadBlock[] = [];
  for (let k = 0; k < loose.length; k++) {
    const r = loose[k]!;
    const at = owner(r);
    if (!at) {
      warnings.push({ code: "not_placed", row: r });
      continue;
    }
    if (!looksLikeData(r)) {
      at.warnings.push({ code: "after_last_row", row: r });
      continue;
    }
    let e = r;
    while (k + 1 < loose.length && loose[k + 1] === e + 1 && looksLikeData(e + 1)) e = loose[++k]!;
    const shaped = finishShape(rows[r]!, rows.slice(r + 1, e + 1));
    extra.push({
      sheetName,
      title: null,
      headerRow: 0,
      headerRows: 1,
      headers: shaped.headers,
      rows: shaped.rows,
      firstDataSheetRow: r + 1,
      preview: previewRows(rows, r, e + 1, r, 1),
      guess: { headerRow: r, headerRows: 1, firstDataRow: r + 1, lastDataRow: e },
      hints: null,
      warnings: [],
      doubts: [],
    });
  }
  return extra;
}

/**
 * The guess over rows `from` to `to` (exclusive). The header search looks at the next 20 rows that are not blank (R3-6). When none of them
 * looks like a header, the first row of two or more cells with a row under it is the guessed header (R3-5): the block
 * holds numbers or dates, which no layout may know, but there is a guess to show and to correct by hints. A window with
 * no such row is reported row by row and the search goes on below it.
 */
export function guessRange(rows: readonly string[][], from: number, to: number, sheetName: string | null, noHeaderGuess = false, below = false): SheetRead {
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
      // Below a block, rows that look like data (two or more cells, not all text) are never a title (B-R7-1): such a
      // row heads a block of its own, which the person can correct, so a header further down cannot take it.
      if ((below || blocks.length > 0) && nonBlank(rows[i]!) >= 2 && textShare(rows[i]!) < 1) {
        h = i;
        break;
      }
      if (fallback === -1 && nonBlank(rows[i]!) >= 2) {
        let k = i + 1;
        while (k < n && nonBlank(rows[k]!) === 0) k++;
        if (k < n) fallback = i;
      }
    }
    // A header-like row with no data row under it ("Prepared by | Checked by" under a table whose header holds numbers)
    // is not the header when a row of two or more cells above it has rows under it (R4-6). A data row under it is the
    // row right under it, or, after blank rows, a row with a number or a date (rule 8.1, round 8).
    const dataUnder = (k: number) => {
      if (k + 1 < n && nonBlank(rows[k + 1]!) > 0) return true;
      let j = k + 1;
      while (j < n && nonBlank(rows[j]!) === 0) j++;
      return j < n && rows[j]!.some((c) => isValueCell(c));
    };
    if (h !== -1 && fallback !== -1 && !dataUnder(h)) h = noHeaderGuess ? -1 : fallback;
    else if (h === -1 && !noHeaderGuess) h = fallback;
    if (h === -1) {
      // No table in this window: its rows are reported, never dropped quietly, and the search goes on below. Below a
      // block they are placed as rows below a hinted block are (round 8): a note is the block's `after_last_row`.
      const loose: number[] = [];
      for (let r = pos; r < windowEnd; r++) if (nonBlank(rows[r]!) > 0) loose.push(r);
      const owner = blocks[blocks.length - 1] ?? null;
      for (const b of placeLoose(rows, loose, () => owner, warnings, sheetName)) blocks.push(b);
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

    // Rule 8.1: the table goes on across blank rows only while what follows fits it.
    const run = readTableRun(rows, rows[h]!, headerRows === 2 ? rows[h + 1]! : null, dataStart, n - 1);
    const left = new Set(run.skipped.map((w) => w.row));
    // A repeat of the header with no data under it is listed and read past.
    const end = Math.max(run.last + 1, ...run.skipped.map((w) => w.row + 1));
    const data = rows.slice(dataStart, end).map((r, k) => (left.has(dataStart + k) ? [] : r));
    for (const w of run.skipped) blockWarnings.push(w);
    pos = Math.max(end, dataStart);

    // Under a block with a number or date column, a header over at most one row of text and no row that looks like
    // data is no table (C33, as below a hinted block): a footer such as "Prepared by | Checked by". Its rows are
    // notes of the block above. Under a table of text columns only, rows below may be more of it (rule 8.1), so only a
    // header with no row under it is dropped.
    const upper = blocks[blocks.length - 1];
    if (upper && !upper.hints) {
      const under = data.filter((r) => nonBlank(r) > 0);
      const upperKinds = new ColumnKinds(0);
      for (const r of upper.rows) if (nonBlank(r) > 0) upperKinds.add(r);
      const footer = under.length < 2 && !under.some((r) => nonBlank(r) >= 2 && textShare(r) < 1);
      if (footer && (upperKinds.hasValueColumn() || under.length === 0)) {
        for (let r = start; r < end; r++) if (nonBlank(rows[r]!) > 0) upper.warnings.push({ code: "after_last_row", row: r });
        if (end === n) break;
        continue;
      }
    }
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
      // A header on the last row has no first data row in the sheet; as a hint it reads as a block with no rows.
      guess: { headerRow: h, headerRows, ...(dataStart < rows.length ? { firstDataRow: dataStart } : {}), lastDataRow: dataStart + data.length - 1, ...(left.size > 0 ? { skipRows: [...left].sort((x, y) => x - y) } : {}) },
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
  const read = opts.hints && opts.hints.length > 0 ? readByHints(rows, opts.hints, sheetName) : guessRange(rows, 0, rows.length, sheetName, opts.noHeaderGuess ?? false);
  return { blocks: withFollows(rows, read.blocks.map((b) => ({ ...b, width: regionWidth(b.headers, b.rows), gaps: gapsOf(b) }))), warnings: read.warnings };
}

/** Rule 8.1: fully blank rows inside a block's rows, not counting rows it left out (listed in its warnings). */
export function gapsOf(b: ReadBlock): number {
  const left = new Set(b.warnings.map((w) => w.row));
  let n = 0;
  b.rows.forEach((r, i) => {
    if (!left.has(b.firstDataSheetRow + i) && r.every((c) => c.trim() === "")) n++;
  });
  return n;
}

/**
 * A block that starts right after the block before it, with only blank rows between, carries
 * `follows: { block, gapRows, continues }`; every other block carries null. Blocks are in row order.
 * `continues` (rule 8.1, round 8): the block above has no number or date column, so it never went on across the
 * blank rows by itself; this block's title rows are single cells; and every filled cell of this block's region from
 * its header down sits inside the width of the block above. Only then is "It continues the table above" offered.
 */
export function withFollows(rows: readonly string[][], blocks: ReadBlock[]): ReadBlock[] {
  return blocks.map((b, i) => {
    if (i === 0) return { ...b, follows: null };
    const prev = blocks[i - 1]!;
    const prevEnd = Math.max(prev.guess.headerRow + prev.headerRows - 1, prev.guess.lastDataRow ?? -1);
    const start = regionStartOf(b);
    if (start <= prevEnd) return { ...b, follows: null };
    for (let r = prevEnd + 1; r < start; r++) if (nonBlank(rows[r]!) > 0) return { ...b, follows: null };
    const top = rows[prev.guess.headerRow]!;
    const kinds = new ColumnKinds(Math.max(filledWidth(top), prev.headerRows === 2 ? filledWidth(rows[prev.guess.headerRow + 1]!) : 0));
    for (const r of prev.rows) if (nonBlank(r) > 0) kinds.add(r);
    const end = Math.max(b.guess.headerRow + b.headerRows - 1, b.guess.lastDataRow ?? -1);
    let continues = !kinds.hasValueColumn();
    for (let r = start; continues && r < b.guess.headerRow; r++) if (nonBlank(rows[r]!) > 1) continues = false;
    for (let r = b.guess.headerRow; continues && r <= end; r++) if (filledWidth(rows[r]!) > kinds.width) continues = false;
    return { ...b, follows: { block: i - 1, gapRows: start - prevEnd - 1, continues } };
  });
}

/** The widest of `headers` and `rows`, each counted to its last filled cell (round 6, M-R5-2). */
export function regionWidth(headers: readonly string[], rows: readonly (readonly string[])[]): number {
  const to = (r: readonly string[]) => {
    for (let c = r.length - 1; c >= 0; c--) if ((r[c] ?? "").trim() !== "") return c + 1;
    return 0;
  };
  let w = to(headers);
  for (const r of rows) w = Math.max(w, to(r));
  return w;
}

/** The blocks of `readSheet`. */
export function findBlocks(matrix: readonly (readonly MatrixCell[])[], opts: FindBlocksOptions = {}): ReadBlock[] {
  return readSheet(matrix, opts).blocks;
}
