/**
 * Which row holds the column names (PORTAL-RULES-3 section 4.1). The reader only guesses. A header is trusted when it
 * fits a layout the plant already knows (an approved layout of the plant, or a built-in one), or when a person picked
 * it. `chooseHeader` tries the reader's guess, then every other preview row as a one-row header and, with the row
 * under it, as a two-row header, and fits each against the given layouts. Pure: the browser and the server run the
 * same code, and the server never trusts a browser's answer.
 */
import { BUILTIN_HOLES } from "./builtins";
import type { BuiltinHole } from "./builtins/types";
import { fingerprint } from "./fingerprint";
import { candidatesFor, recipeColumns, type FitCandidate, type LearnedHole } from "./fit";
import { cellKind } from "./cells";
import { combineHeaders, isHeaderLike } from "./readers/blocks";
import type { PreviewRow } from "./readers/types";

/** What `chooseHeader` reads from a block: its preview and the reader's guess. A `ReadBlock` fits this shape. */
export type HeaderInput = {
  preview: readonly PreviewRow[];
  guess: { headerRow: number; headerRows?: 1 | 2 };
};

/** The layouts to fit against. `learned`: the plant's approved layouts, newest first. `builtins`: default all of them. */
export type HeaderHoles = {
  learned?: readonly LearnedHole[];
  builtins?: readonly BuiltinHole[];
};

/** A header as hints take it: the raw row (the number in the preview) and one or two rows. */
export type HeaderPick = { headerRow: number; headerRows: 1 | 2 };

export type HeaderChoice =
  | { kind: "fits"; headerRow: number; headerRows: 1 | 2; fit: FitCandidate }
  | { kind: "ask"; guess: HeaderPick; candidates: HeaderPick[] };

/** A near fit counts only when this many of its columns carry a layout's column name exactly. */
export const NEAR_NAMED_MIN = 2;

const isTextCell = (c: string) => {
  const k = cellKind(c);
  return k === "text" || k === "code";
};

const filled = (cells: readonly string[]) => cells.filter((c) => c.trim() !== "").length;

function firstFilledCell(cells: readonly string[]): number {
  return cells.findIndex((c) => c.trim() !== "");
}

function lastFilledCell(cells: readonly string[]): number {
  for (let i = cells.length - 1; i >= 0; i--) if (cells[i]!.trim() !== "") return i;
  return -1;
}

/**
 * The header names for a pick, built the way the readers build them: the row's cells for one row, `combineHeaders` of
 * the two rows for two. Null when the pick is not a header at all: fewer than two names, or (two rows) a blank row.
 */
function namesFor(preview: readonly PreviewRow[], at: number, headerRows: 1 | 2): string[] | null {
  const top = preview[at]?.cells.map((c) => c.trim());
  if (!top) return null;
  if (headerRows === 1) {
    if (filled(top) < 2) return null;
    // The row under it names a column this row leaves blank and holds no number or date: this row is the top of a
    // two-row header, and alone it would leave that column without its name.
    const next = preview[at + 1];
    if (next && next.row === preview[at]!.row + 1) {
      const cells = next.cells.map((c) => c.trim());
      const namesBlank = cells.some((c, i) => c !== "" && (top[i] ?? "") === "");
      if (namesBlank && cells.every((c) => c === "" || isTextCell(c))) return null;
    }
    return top;
  }
  const bottom = preview[at + 1]?.cells.map((c) => c.trim());
  if (!bottom || preview[at + 1]!.row !== preview[at]!.row + 1) return null;
  if (filled(top) === 0 || filled(bottom) === 0) return null;
  // The top row has the shape of group names: each filled top cell sits over a blank bottom cell ("Party" over
  // nothing) or spans the bottom cells to its right ("Weight" over "Min | Max"), and one of them spans. A key and value
  // line ("Phone | 98250...") over a header does not.
  const spansRight = (i: number) => (top[i + 1] ?? "") === "" && (bottom[i + 1] ?? "") !== "";
  let spans = false;
  for (let i = 0; i < top.length; i++) {
    if (top[i] === "") continue;
    if (spansRight(i)) spans = true;
    else if ((bottom[i] ?? "") !== "") return null;
  }
  if (!spans) return null;
  const names = combineHeaders(top, bottom);
  return filled(names) >= 2 ? names : null;
}

/**
 * How many columns the fit found by their own name, not by a close spelling. A near fit needs two: close spellings
 * ("Customer list" for "customer", "Name: Om" for "name") and a key and value line ("Name | Om Metals") are a title
 * or a letterhead, not column names.
 */
function namedColumns(c: FitCandidate): number {
  return recipeColumns(c.recipe).length - c.diff.renamed.length;
}

/**
 * The best fit for one pick, or null. A pick counts only when the preview has a row under it, and most rows under it
 * are not wider than it on either side (a title or a key and value line over a wider table, or the second row of a
 * two-row header taken alone, is not the header), and a near fit names `NEAR_NAMED_MIN` columns exactly.
 */
function fitFor(preview: readonly PreviewRow[], at: number, headerRows: 1 | 2, holes: HeaderHoles): FitCandidate | null {
  const names = namesFor(preview, at, headerRows);
  if (!names) return null;
  const below = preview.slice(at + headerRows).map((p) => p.cells.map((c) => c.trim()));
  const dataRows = below.filter((r) => filled(r) > 0);
  // A header with no row under it in the preview has nothing to check its kinds against.
  if (dataRows.length === 0) return null;
  const last = headerRows === 2 ? names.length - 1 : lastFilledCell(names);
  const first = firstFilledCell(names);
  const wider = dataRows.filter((r) => lastFilledCell(r) > last || (firstFilledCell(r) !== -1 && firstFilledCell(r) < first)).length;
  if (wider * 2 > dataRows.length) return null;
  const fp = fingerprint({ headers: names, rows: dataRows, headerRow: preview[at]!.row, headerRows });
  let best: FitCandidate | null = null;
  for (const c of candidatesFor(fp, holes.learned ?? [], holes.builtins ?? BUILTIN_HOLES)) {
    if (c.fit === "near" && namedColumns(c) < NEAR_NAMED_MIN) continue;
    if (!best || better(c, best)) best = c;
  }
  return best;
}

/** Exact beats near, then the higher score. The earlier candidate (learned newest first, then built-ins) keeps a tie. */
function better(a: FitCandidate, b: FitCandidate): boolean {
  if (a.fit !== b.fit) return a.fit === "exact";
  return a.score > b.score;
}

/**
 * The header to trust, or the question to ask. Tries the guess first, then every other preview row as a one-row
 * header and, with the row under it, as a two-row header. Exact beats near; a near fit must clear the engine's
 * near-fit threshold (`nearAllowed` inside the fit functions); the guess wins ties; then one row beats two, then the
 * higher row. When nothing fits, `ask` carries the guess and the preview rows of two or more filled cells, best first
 * (the guess, then rows that read like a header, then the rest, each in sheet order).
 */
export function chooseHeader(input: HeaderInput, holes: HeaderHoles = {}): HeaderChoice {
  const preview = input.preview;
  const guess: HeaderPick = { headerRow: input.guess.headerRow, headerRows: input.guess.headerRows ?? 1 };
  type Hit = { at: number; headerRows: 1 | 2; fit: FitCandidate; isGuess: boolean };
  let best: Hit | null = null;
  const consider = (at: number, headerRows: 1 | 2) => {
    const fit = fitFor(preview, at, headerRows, holes);
    if (!fit) return;
    const hit: Hit = { at, headerRows, fit, isGuess: preview[at]!.row === guess.headerRow && headerRows === guess.headerRows };
    if (!best) {
      best = hit;
      return;
    }
    if (better(hit.fit, best.fit)) best = hit;
    else if (!better(best.fit, hit.fit) && !best.isGuess && (hit.isGuess || hit.headerRows < best.headerRows)) best = hit;
  };
  const guessAt = preview.findIndex((p) => p.row === guess.headerRow);
  if (guessAt !== -1) consider(guessAt, guess.headerRows);
  for (let at = 0; at < preview.length; at++) {
    for (const rows of [1, 2] as const) {
      if (at === guessAt && rows === guess.headerRows) continue;
      consider(at, rows);
    }
  }
  const won = best as Hit | null;
  if (won) return { kind: "fits", headerRow: preview[won.at]!.row, headerRows: won.headerRows, fit: won.fit };

  const candidates: HeaderPick[] = [];
  if (guessAt !== -1) candidates.push(guess);
  const rest = preview.filter((p) => filled(p.cells) >= 2 && !(p.row === guess.headerRow && guess.headerRows === 1));
  const looks = rest.filter((p) => isHeaderLike(p.cells.map((c) => c.trim())));
  const others = rest.filter((p) => !looks.includes(p));
  for (const p of [...looks, ...others]) candidates.push({ headerRow: p.row, headerRows: 1 });
  return { kind: "ask", guess, candidates };
}
