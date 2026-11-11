/**
 * Test helpers for the rule of PORTAL-RULES-3 section 4.1: a header is trusted when it fits a layout the plant knows
 * (`chooseHeader`), or when a person picked it (hints). Not exported from the package.
 */
import { headerKey, normalizeHeaders } from "../fingerprint";
import type { LearnedHole } from "../fit";
import { chooseHeader, type HeaderChoice, type HeaderHoles } from "../header";
import type { ReadBlock } from "./types";

/** An approved layout of the plant whose column names are exactly these headers (no fields: only the names count). */
export function layoutOf(headers: readonly string[], id = "t", headerRows: 1 | 2 = 1): LearnedHole {
  const normalized = normalizeHeaders(headers);
  return {
    holeId: id,
    holeVersionId: `${id}v`,
    name: id,
    version: 1,
    recipe: {
      schemaVersion: 1,
      target: "customers",
      headerRow: 0,
      headerRows,
      match: { headerKey: headerKey(normalized), headers: normalized },
      fields: [],
      filters: [],
      keys: [],
      onExisting: "ask",
      unclear: [],
    },
  };
}

/** `chooseHeader` for a block. */
export const trust = (b: ReadBlock, holes: HeaderHoles = {}): HeaderChoice => chooseHeader(b, holes);

/**
 * The old "unsure" in the new rule: the reader's guess is not trusted on its own. With the built-in layouts only, the
 * block's header fits nothing, so the web asks the person, with the guess offered first.
 */
export function asked(b: ReadBlock): boolean {
  const c = chooseHeader(b);
  return c.kind === "ask" && c.guess.headerRow === b.guess.headerRow;
}

/**
 * The old "sure" for a guessed block in the new rule: once the plant knows a layout with these column names, the
 * block's guessed header fits it, at the guessed row. With no known layout the web asks, the guess offered first.
 */
export function fitsLayout(b: ReadBlock, names: readonly string[]): boolean {
  const c = chooseHeader(b, { learned: [layoutOf(names)] });
  return c.kind === "fits" && c.headerRow === b.guess.headerRow && c.headerRows === b.headerRows && asked(b);
}

/** The old "sure" for a hinted block: a person's pick is trusted, so the block carries the hints it was read with. */
export const picked = (b: ReadBlock): boolean => b.hints !== null;

/**
 * Rule 5.5 for a PDF block against its true table: the columns are the true table's named columns (rule 5.3 never
 * makes a column with no name), no row is lost, and every row that differs from the truth carries a doubt. A true row
 * is right when the block's row equals it with the unnamed columns left out and those cells blank. Returns null when
 * the block passes, else what is wrong.
 */
export function pdfMismatch(b: ReadBlock, truth: { headers: readonly string[]; rows: readonly (readonly string[])[] }): string | null {
  const named = truth.headers.map((h, i) => (h.trim() !== "" ? i : -1)).filter((i) => i !== -1);
  const headers = named.map((i) => truth.headers[i]!);
  if (!Bun.deepEquals(b.headers, headers)) return `headers ${JSON.stringify(b.headers)} want ${JSON.stringify(headers)}`;
  if (b.rows.length !== truth.rows.length) return `rows ${b.rows.length} want ${truth.rows.length}`;
  const marked = new Set(b.doubts.map((d) => d.row));
  for (let r = 0; r < truth.rows.length; r++) {
    const t = truth.rows[r]!;
    const right = named.map((i) => t[i] ?? "");
    const blankElsewhere = t.every((c, i) => named.includes(i) || c === "");
    if (blankElsewhere && Bun.deepEquals(b.rows[r], right)) continue;
    if (!marked.has(r)) return `row ${r} ${JSON.stringify(b.rows[r])} want ${JSON.stringify(t)} with no doubt`;
  }
  return null;
}

/** How many rows of a PDF block carry a doubt. */
export const doubtedRows = (b: ReadBlock): number => new Set(b.doubts.map((d) => d.row)).size;
