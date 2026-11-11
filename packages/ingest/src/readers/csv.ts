/**
 * CSV reader: push-based so a 50 MB file never has to be one string. Handles quotes, doubled quotes, newlines inside
 * quotes, CRLF and a BOM, across chunk boundaries.
 */
import { readSheet, type SheetRead } from "./blocks";
import type { BlockHints, ReadBlock } from "./types";

export type CsvDelimiter = "," | ";" | "\t" | "|";

/**
 * The delimiter that splits the first lines evenly, header included (M7). Quoted text is ignored.
 * Round 6 (M-R5-4): the delimiter that gives every line, from the first line that holds it to the end of the sample,
 * the same count wins, so a remark with a semicolon or a pipe does not make it the delimiter. Of those, the one that
 * starts highest wins (a title line above the table holds none, C35), then the larger count, then tab, semicolon,
 * pipe, comma. A comma between two digits ("1,200", "12,5") is skipped only when counting it leaves the lines uneven.
 * A last line the sample cut short is left out of that test. With no even delimiter, the most consistent count wins
 * as before; comma when nothing is clear.
 */
export function detectDelimiter(sample: string): CsvDelimiter {
  const lines: string[] = [];
  let cur = "";
  let inQ = false;
  let cutShort = false;
  for (const ch of sample) {
    if (ch === '"') inQ = !inQ;
    if (!inQ && (ch === "\n" || ch === "\r")) {
      if (cur.trim() !== "") lines.push(cur);
      cur = "";
      if (lines.length >= 8) break;
    } else cur += ch;
  }
  if (cur.trim() !== "" && lines.length < 8) {
    lines.push(cur);
    cutShort = true;
  }
  const digit = (ch: string | undefined) => ch !== undefined && ch >= "0" && ch <= "9";
  const countsOf = (d: CsvDelimiter, skipDigits: boolean) =>
    lines.map((l) => {
      let c = 0;
      let q = false;
      for (let i = 0; i < l.length; i++) {
        const ch = l[i]!;
        if (ch === '"') q = !q;
        else if (!q && ch === d && !(skipDigits && digit(l[i - 1]) && digit(l[i + 1]))) c++;
      }
      return c;
    });
  /** The first line that holds the delimiter and its count, when every line from there has that count. */
  const even = (counts: number[]): { start: number; count: number } | null => {
    const checked = cutShort && counts.length > 2 ? counts.slice(0, -1) : counts;
    const start = checked.findIndex((c) => c > 0);
    if (start === -1 || checked.length - start < 2) return null;
    const count = checked[start]!;
    return checked.slice(start).every((c) => c === count) ? { start, count } : null;
  };
  const order = ["\t", ";", "|", ","] as const;
  let pick: { d: CsvDelimiter; start: number; count: number } | null = null;
  for (const d of order) {
    const e = even(countsOf(d, false)) ?? (d === "," ? even(countsOf(d, true)) : null);
    if (!e) continue;
    if (!pick || e.start < pick.start || (e.start === pick.start && e.count > pick.count)) pick = { d, ...e };
  }
  if (pick) return pick.d;

  let best: CsvDelimiter = ",";
  let bestScore = 0;
  for (const d of order) {
    const counts = countsOf(d, d === ",");
    // Score over the lines that hold the delimiter, so a title line above the table does not hide it (C35).
    const used = counts.filter((c) => c > 0);
    if (used.length === 0) continue;
    const freq = new Map<number, number>();
    for (const c of used) freq.set(c, (freq.get(c) ?? 0) + 1);
    let mode = used[0]!;
    for (const [c, f] of freq) if (f > freq.get(mode)! || (f === freq.get(mode)! && c > mode)) mode = c;
    const consistent = freq.get(mode)! / counts.length;
    const score = consistent * mode;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

export type CsvOptions = { delimiter?: CsvDelimiter };

export class CsvParser {
  private delimiter: CsvDelimiter | null;
  private row: string[] = [];
  private field = "";
  private inQuotes = false;
  /** A quote was the last character inside a quoted field: either an escaped quote or the end of the field. */
  private quoteSeen = false;
  private afterCr = false;
  private started = false;
  private pendingText = "";
  readonly rows: string[][] = [];

  constructor(opts: CsvOptions = {}) {
    this.delimiter = opts.delimiter ?? null;
  }

  /** Feed the next piece of text. Rows are available in `rows` as they complete. */
  push(chunk: string): void {
    let text = chunk;
    if (!this.started) {
      // Keep the first piece until the delimiter can be chosen from enough text.
      this.pendingText += text;
      if (this.delimiter === null && this.pendingText.length < 4096) return;
      this.started = true;
      text = this.pendingText.replace(/^﻿/, "");
      this.pendingText = "";
      if (this.delimiter === null) this.delimiter = detectDelimiter(text);
    }
    this.parse(text);
  }

  /** The last row has no newline: close it. */
  end(): string[][] {
    if (!this.started) {
      this.started = true;
      const text = this.pendingText.replace(/^﻿/, "");
      this.pendingText = "";
      if (this.delimiter === null) this.delimiter = detectDelimiter(text);
      this.parse(text);
    }
    if (this.field !== "" || this.row.length > 0 || this.inQuotes || this.quoteSeen) this.endRow();
    return this.rows;
  }

  private endRow() {
    this.row.push(this.field);
    this.field = "";
    this.rows.push(this.row);
    this.row = [];
    this.inQuotes = false;
    this.quoteSeen = false;
  }

  private parse(text: string) {
    const d = this.delimiter!;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (this.afterCr) {
        this.afterCr = false;
        if (ch === "\n") continue;
      }
      if (this.inQuotes) {
        if (this.quoteSeen) {
          this.quoteSeen = false;
          if (ch === '"') {
            this.field += '"';
            continue;
          }
          this.inQuotes = false;
          // fall through: the quote closed the field and this is the next character.
        } else if (ch === '"') {
          this.quoteSeen = true;
          continue;
        } else {
          this.field += ch;
          continue;
        }
      }
      if (ch === '"' && this.field === "") {
        this.inQuotes = true;
      } else if (ch === d) {
        this.row.push(this.field);
        this.field = "";
      } else if (ch === "\n") {
        this.endRow();
      } else if (ch === "\r") {
        this.endRow();
        this.afterCr = true;
      } else {
        this.field += ch;
      }
    }
  }
}

export function parseCsv(text: string, opts: CsvOptions = {}): string[][] {
  const p = new CsvParser(opts);
  p.push(text);
  return p.end();
}

export type CsvReadOptions = CsvOptions & { sheetName?: string | null; hints?: readonly BlockHints[] | null };

/**
 * A CSV file as one sheet: its blocks and the rows no block took. The file may still hold a title and several tables.
 * With `hints` (raw rows of the file, 0-based) the reader follows them and guesses nothing.
 */
export function readCsv(text: string, opts: CsvReadOptions = {}): SheetRead {
  return readSheet(parseCsv(text, opts), { sheetName: opts.sheetName ?? null, hints: opts.hints ?? null });
}

/** The blocks of `readCsv`. */
export function readCsvBlocks(text: string, opts: CsvReadOptions = {}): ReadBlock[] {
  return readCsv(text, opts).blocks;
}
