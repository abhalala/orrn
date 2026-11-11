/**
 * Which row holds the column names (PORTAL-RULES-3 sections 4.1 and 5.1). The reader only guesses. A header is
 * trusted only when it fits a layout EXACTLY: an approved layout of the plant, or a built-in one with every column
 * found and nothing extra. A near fit is never trusted; it is named in the question so the screen can say "This looks
 * like <layout>. Is row N the column names?". Pure: the browser and the server run the same code, and the server never
 * trusts a browser's answer.
 */
import { BUILTIN_HOLES } from "./builtins";
import type { BuiltinHole } from "./builtins/types";
import { fingerprint } from "./fingerprint";
import { candidatesFor, recipeColumns, type FitCandidate, type LearnedHole } from "./fit";
import { cellKind } from "./cells";
import { combineHeaders, isHeaderLike } from "./readers/blocks";
import type { PreviewRow } from "./readers/types";
import type { IngestTarget } from "./states";

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

/**
 * The layout a row looks like when it is not trusted. `fit` is "near" for a near fit, or "exact" for an exact fit
 * that is not trusted because rows of the table above sit between it and the guess (M1). `name` is the layout's name
 * (a learned layout's name, or a built-in's id); `holeRef` is `learned:<versionId>` or `builtin:<id>`.
 */
export type HeaderResemblance = {
  headerRow: number;
  headerRows: 1 | 2;
  fit: "exact" | "near";
  name: string;
  target: IngestTarget;
  holeRef: string;
  learned: boolean;
  score: number;
};

export type HeaderChoice =
  | { kind: "fits"; headerRow: number; headerRows: 1 | 2; fit: FitCandidate }
  | { kind: "ask"; guess: HeaderPick; candidates: HeaderPick[]; resembles: HeaderResemblance | null };

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
 * The names run as wide as the widest data row, so a column with no name is part of the pick (M3).
 */
function namesFor(preview: readonly PreviewRow[], at: number, headerRows: 1 | 2): string[] | null {
  const top = preview[at]?.cells.map((c) => c.trim());
  if (!top) return null;
  if (headerRows === 1) {
    if (filled(top) < 2) return null;
    // The row under it names a column this row leaves blank and holds no number or date: this row is the top of a
    // two-row header, and alone it would leave that column without its name.
    const next = preview[at + 1];
    if (next && next.row === preview[at]!.row + 1 && next.page === preview[at]!.page) {
      const cells = next.cells.map((c) => c.trim());
      const namesBlank = cells.some((c, i) => c !== "" && (top[i] ?? "") === "");
      if (namesBlank && cells.every((c) => c === "" || isTextCell(c))) return null;
    }
    return top;
  }
  const below = preview[at + 1];
  if (!below || below.row !== preview[at]!.row + 1 || below.page !== preview[at]!.page) return null;
  const bottom = below.cells.map((c) => c.trim());
  if (filled(top) === 0 || filled(bottom) === 0) return null;
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

type PickFit = { exact: FitCandidate | null; near: FitCandidate | null };

/**
 * The fits of one pick. Needs a data row under it in the preview. Exact: the names, padded to the widest data row,
 * fit a layout exactly (a one-row layout for one row; for two rows only an approved two-row layout, M2). Near: the
 * best near fit of a one-row pick whose data rows are mostly not wider than it on either side, with
 * `NEAR_NAMED_MIN` columns found by their own name. A near fit only names a layout in the question.
 */
function fitsFor(preview: readonly PreviewRow[], at: number, headerRows: 1 | 2, holes: HeaderHoles): PickFit {
  const none: PickFit = { exact: null, near: null };
  const names = namesFor(preview, at, headerRows);
  if (!names) return none;
  const dataRows = preview
    .slice(at + headerRows)
    .filter((p) => p.page === preview[at]!.page)
    .map((p) => p.cells.map((c) => c.trim()))
    .filter((r) => filled(r) > 0);
  if (dataRows.length === 0) return none;
  const width = Math.max(names.length, ...dataRows.map((r) => lastFilledCell(r) + 1));
  const padded = [...names, ...Array<string>(width - names.length).fill("")];
  const fp = fingerprint({ headers: padded, rows: dataRows, headerRow: preview[at]!.row, headerRows });
  const learned = (holes.learned ?? []).filter((h) => (h.recipe.headerRows ?? 1) === headerRows);
  const builtins = headerRows === 1 ? (holes.builtins ?? BUILTIN_HOLES) : [];
  const all = candidatesFor(fp, learned, builtins);
  // A built-in layout has no unnamed column: a blank name over data is never an exact built-in fit.
  const unnamed = padded.slice(0, fp.columnCount).some((c) => c === "");
  const exact = all.find((c) => c.fit === "exact" && c.learned) ?? (unnamed ? null : all.find((c) => c.fit === "exact")) ?? null;
  if (headerRows === 2) return { exact, near: null };
  const last = lastFilledCell(names);
  const first = firstFilledCell(names);
  const wider = dataRows.filter((r) => lastFilledCell(r) > last || (firstFilledCell(r) !== -1 && firstFilledCell(r) < first)).length;
  let near: FitCandidate | null = null;
  // A cell that ends in a colon is a label of a key and value line ("Party:"), not a column name.
  const labels = names.some((c) => c.endsWith(":"));
  if (wider * 2 <= dataRows.length && !labels) {
    for (const c of all) {
      if (c.fit !== "near" || namedColumns(c) < NEAR_NAMED_MIN) continue;
      if (!near || nearer(c, near)) near = c;
    }
  }
  return { exact, near };
}

/** More columns found by their own name, then the higher score. */
function nearer(a: FitCandidate, b: FitCandidate): boolean {
  const d = namedColumns(a) - namedColumns(b);
  return d !== 0 ? d > 0 : a.score > b.score;
}

const resemblance = (p: PreviewRow, headerRows: 1 | 2, c: FitCandidate): HeaderResemblance => ({
  headerRow: p.row,
  headerRows,
  fit: c.fit,
  name: c.name,
  target: c.target,
  holeRef: c.holeRef,
  learned: c.learned,
  score: c.score,
});

/**
 * The header to trust, or the question to ask (PORTAL-RULES-3 section 5.1). Every preview row is tried as a one-row
 * header and, with the row under it, as a two-row header. Only an exact fit is trusted, and the top-most one wins
 * (M1). An exact fit below the guess is trusted only when no filled row sits between the guess's header rows and it:
 * otherwise it may be a second table under the first, and the answer is "ask". A preview with a gap in its row numbers
 * left rows out (a long letterhead, M6), and the answer is "ask" too. `ask` carries the guess and the preview rows of
 * two or more filled cells, best first: the row named in `resembles`, the guess, rows that read like a header, the
 * rest, each in sheet order. `resembles` is an untrusted exact fit, or else the best near fit (more columns found by name,
 * then the score; the guess wins a tie, then the higher row).
 */
export function chooseHeader(input: HeaderInput, holes: HeaderHoles = {}): HeaderChoice {
  const preview = input.preview;
  const guess: HeaderPick = { headerRow: input.guess.headerRow, headerRows: input.guess.headerRows ?? 1 };
  const guessAt = preview.findIndex((p) => p.row === guess.headerRow);
  const gap = preview.some((p, i) => i > 0 && p.page === preview[i - 1]!.page && p.row > preview[i - 1]!.row + 1);
  // A pick below the guess with a filled row between them is not trusted.
  const blocked = (at: number) => {
    if (guessAt === -1 || at < guessAt + guess.headerRows) return false;
    for (let i = guessAt + guess.headerRows; i < at; i++) if (filled(preview[i]!.cells) > 0) return true;
    return false;
  };
  let trusted: { at: number; headerRows: 1 | 2; fit: FitCandidate } | null = null;
  let untrusted: HeaderResemblance | null = null;
  let near: { at: number; headerRows: 1 | 2; fit: FitCandidate } | null = null;
  for (let at = 0; at < preview.length; at++) {
    for (const rows of [1, 2] as const) {
      const f = fitsFor(preview, at, rows, holes);
      if (f.exact) {
        if (!gap && !blocked(at)) {
          if (!trusted) trusted = { at, headerRows: rows, fit: f.exact };
        } else if (!untrusted) untrusted = resemblance(preview[at]!, rows, f.exact);
      }
      if (f.near) {
        const isGuess = (at: number, r: number) => at === guessAt && r === guess.headerRows;
        const tie = !nearer(f.near, near?.fit ?? f.near) && !nearer(near?.fit ?? f.near, f.near);
        if (!near || nearer(f.near, near.fit) || (tie && isGuess(at, rows) && !isGuess(near.at, near.headerRows))) {
          near = { at, headerRows: rows, fit: f.near };
        }
      }
    }
  }
  const won = trusted as { at: number; headerRows: 1 | 2; fit: FitCandidate } | null;
  if (won) return { kind: "fits", headerRow: preview[won.at]!.row, headerRows: won.headerRows, fit: won.fit };

  const n = near as { at: number; headerRows: 1 | 2; fit: FitCandidate } | null;
  const resembles = untrusted ?? (n ? resemblance(preview[n.at]!, n.headerRows, n.fit) : null);
  const candidates: HeaderPick[] = [];
  const add = (p: HeaderPick) => {
    if (!candidates.some((c) => c.headerRow === p.headerRow && c.headerRows === p.headerRows)) candidates.push(p);
  };
  if (resembles) add({ headerRow: resembles.headerRow, headerRows: resembles.headerRows });
  if (guessAt !== -1) add(guess);
  const rest = preview.filter((p) => filled(p.cells) >= 2);
  const looks = rest.filter((p) => isHeaderLike(p.cells.map((c) => c.trim())));
  const others = rest.filter((p) => !looks.includes(p));
  for (const p of [...looks, ...others]) add({ headerRow: p.row, headerRows: 1 });
  return { kind: "ask", guess, candidates, resembles };
}
