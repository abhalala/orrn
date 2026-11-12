import type { EngineHints } from "./reader-engine";
import type { ReadBlock } from "./reader-protocol";
import type { HeaderPickIn, HeaderResemblesOut } from "./types";

/**
 * The header step (owner decision, 2026-11-11): when the portal is not sure which row holds the column names it shows the
 * first rows of the table and asks "Which row has the column names?". This file is the plain logic: what the step shows
 * for one table waiting on the person, and what the person can answer. The screen draws it; `settle.ts` acts on it.
 */

/** What the person answered for one table. */
export type HeaderReply =
  /** The row with the column names, and whether the names take one row or two. */
  | { kind: "pick"; headerRow: number; headerRows: 1 | 2 }
  /** "It continues the table above": the rows below the gap belong to the table above. */
  | { kind: "continues" }
  /** "Same columns as the table above": the same, and the repeated column names are left out of the rows. */
  | { kind: "same" }
  /** "Do not import this table". */
  | { kind: "skip" };

/** One raw row of the preview as the step shows it. */
export type HeaderLine = {
  /** The raw row number, the one a hint uses. */
  row: number;
  /** The row number a person sees (the sheet's own, starting at 1). */
  n: number;
  cells: string[];
  /** Rows were left out between this row and the one above (a gap in the row numbers). */
  gapBefore: boolean;
};

export type HeaderOffer = "continues" | "same";

/** A table that waits on the person, as the server asked for it. */
export type HeaderQuestion = {
  /** The key of the table among the tables of the file, for grouping parts of one long table. */
  key: string;
  /** Every block (part) of the table. The first one is shown. */
  blocks: ReadBlock[];
  guess: HeaderPickIn;
  candidates: HeaderPickIn[];
  resembles: HeaderResemblesOut | null;
};

export type HeaderAskView = {
  /** "Table 2 of 3": the place among the tables waiting in this round. */
  position: number;
  total: number;
  sheetName: string | null;
  lines: HeaderLine[];
  /** The widest row of the preview, to size the table. */
  columns: number;
  /** The row and header size selected when the step opens. */
  preselected: HeaderPickIn;
  /** `{ name, n }` for "This looks like {name}. Is row {n} the column names?". */
  resembles: { name: string; n: number; rows: 1 | 2 } | null;
  /** The ways to join this table to the one above, first in the step. */
  offers: HeaderOffer[];
  /** The last pick could not be followed: "Pick another row". */
  hintError: boolean;
  /** How many times this table has been asked, so a second "Pick another row" is a new event for the screen. */
  attempt: number;
  /** How many rows of the file the table has, for the line under the title. */
  rowCount: number;
};

const norm = (cells: readonly string[]) => cells.map((c) => c.trim().toLowerCase().replace(/\s+/g, " "));

/** The names of the table above, when this table's first row repeats them exactly. Needs the guessed header of this table. */
export function repeatsTableAbove(lower: ReadBlock, upper: ReadBlock | undefined): boolean {
  if (!upper) return false;
  const here = lower.meta?.preview.find((p) => p.row === lower.meta?.guess.headerRow);
  if (!here) return false;
  const a = norm(here.cells).filter((c) => c !== "");
  const b = norm(upper.input.headers).filter((c) => c !== "");
  return a.length > 0 && a.length === b.length && a.every((c, i) => c === b[i]);
}

export function headerAskView(
  question: HeaderQuestion,
  place: { position: number; total: number },
  context: { upper?: ReadBlock; hintError: boolean; attempt?: number },
): HeaderAskView {
  const block = question.blocks[0]!;
  const meta = block.meta;
  const rowBase = meta?.rowBase ?? 0;
  const preview = [...(meta?.preview ?? block.input.preview ?? [])].sort((a, b) => a.row - b.row);
  let previous = -1;
  const lines: HeaderLine[] = preview.map((p) => {
    const line = { row: p.row, n: p.row + rowBase + 1, cells: p.cells, gapBefore: previous >= 0 && p.row - previous > 1 };
    previous = p.row;
    return line;
  });
  const columns = lines.reduce((m, l) => Math.max(m, l.cells.length), 0);
  // The question names a row ("Is row 4 the column names?"), so that row is the one selected; else the reader's guess.
  const r = question.resembles;
  const preselected: HeaderPickIn = r ? { headerRow: r.headerRow, headerRows: r.headerRows } : question.guess;
  const offers: HeaderOffer[] = [];
  if (meta?.follows) {
    offers.push("continues");
    if (repeatsTableAbove(block, context.upper)) offers.push("same");
  }
  return {
    position: place.position,
    total: place.total,
    sheetName: block.input.sheetName,
    lines,
    columns,
    preselected,
    resembles: r ? { name: r.name, n: r.headerRow + rowBase + 1, rows: r.headerRows } : null,
    offers,
    hintError: context.hintError,
    attempt: context.attempt ?? 0,
    rowCount: question.blocks.reduce((n, b) => n + b.input.rowCount, 0),
  };
}

/** A pick as the hint a reader takes. The header size is always given, so a hint never depends on a default. */
export const hintOfPick = (pick: HeaderPickIn): EngineHints => ({ headerRow: pick.headerRow, headerRows: pick.headerRows });

/** Whether a pick is the header the table was already read under, so no second read is needed. */
export function isCurrentHeader(block: ReadBlock, pick: HeaderPickIn): boolean {
  const g = block.meta?.guess;
  return g !== undefined && g.headerRow === pick.headerRow && (g.headerRows ?? 1) === pick.headerRows;
}

/** The row numbers a two-row header covers: its row and the next filled one, as far as the preview shows. */
export function twoRowsFrom(lines: readonly HeaderLine[], headerRow: number): [HeaderLine, HeaderLine | null] | null {
  const at = lines.findIndex((l) => l.row === headerRow);
  if (at < 0) return null;
  return [lines[at]!, lines[at + 1] && lines[at + 1]!.row === headerRow + 1 ? lines[at + 1]! : null];
}
