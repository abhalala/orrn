/**
 * CSV reader: push-based so a 50 MB file never has to be one string. Handles quotes, doubled quotes, newlines inside
 * quotes, CRLF and a BOM, across chunk boundaries.
 */
import { readSheet, type SheetRead } from "./blocks";
import type { BlockHints, ReadBlock } from "./types";

export type CsvDelimiter = "," | ";" | "\t" | "|";

/** The delimiter that splits the first lines evenly. Quoted text is ignored. Comma when nothing is clear. */
export function detectDelimiter(sample: string): CsvDelimiter {
  const lines: string[] = [];
  let cur = "";
  let inQ = false;
  for (const ch of sample) {
    if (ch === '"') inQ = !inQ;
    if (!inQ && (ch === "\n" || ch === "\r")) {
      if (cur.trim() !== "") lines.push(cur);
      cur = "";
      if (lines.length >= 8) break;
    } else cur += ch;
  }
  if (cur.trim() !== "" && lines.length < 8) lines.push(cur);
  let best: CsvDelimiter = ",";
  let bestScore = 0;
  for (const d of [",", ";", "\t", "|"] as const) {
    const counts = lines.map((l) => {
      let c = 0;
      let q = false;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if (!q && ch === d) c++;
      }
      return c;
    });
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
