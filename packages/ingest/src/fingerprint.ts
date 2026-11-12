/**
 * Fingerprint of a block (plan B3): normalized headers, their hash and the cell kinds. Pure; the browser and the
 * server run the same code, so the server never trusts a browser fit.
 */
import { inferKind } from "./cells";
import { sha256Hex } from "./hash";
import type { BlockInput, BlockShape, CellKind } from "./recipe";

const UNIT_TOKENS: [RegExp, string][] = [
  [/(?<![a-z0-9])(?:kgs|kilos?|kilograms?)(?![a-z0-9])/g, "kg"],
  [/(?<![a-z0-9])(?:mtrs?|meters?|metres?)(?![a-z0-9])/g, "m"],
  [/(?<![a-z0-9])(?:feet|foot)(?![a-z0-9])/g, "ft"],
  // Round 6 (owner's decision): count words are not folded together. "Pcs" and "Nos" are different names; only the
  // spellings of one word fold. "No." stays "no", so "Bundle No." is still an id column (C27).
  [/(?<![a-z0-9])(?:pc|pieces?)(?![a-z0-9])/g, "pcs"],
  [/(?<![a-z0-9])nos(?![a-z0-9])/g, "no"],
  [/(?<![a-z0-9])(?:rs|inr)(?![a-z0-9])|\u20b9/g, "inr"],
];

/** Every dash and minus character (rule 6.2): hyphen, non-breaking hyphen, figure dash, en dash, em dash, minus. */
const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2212\ufe58\ufe63\uff0d]/g;
/** Signs that are always kept as their own token (rule 6.2). "+" is kept too; "-" only where it is a sign. */
const KEPT = "+%#\u00b1<>\u2264\u2265";
const WORD = /[\p{L}\p{M}\p{N}]/u;

/**
 * The key form of a column name (PORTAL-RULES-3 rule 6.2, round 7). NFKC and lower case, so non-breaking and
 * full-width characters fold to their plain forms. Then:
 * - Every dash and minus folds to "-". A "-" or "/" between two words, spaced or not, is a separator ("Wt - Kg",
 *   "Wt-Kg" and "Wt Kg" are one name). A "-" at the end of the name, or right before a digit with no word right before
 *   it, is a sign and is kept ("Tol -", "Kg (-)", "-12"). "+" is always kept, and so are % # ± < > ≤ ≥.
 * - Dots, colons, brackets and every other punctuation count as a space; a dot between single letters joins them
 *   ("P.O. No" is "po no"). A trailing danda is punctuation.
 * - Letters, their marks and digits of every script are kept: a nukta or a matra is part of the letter (B2).
 * - The spellings of one unit fold ("Kgs" and "kg", "Pieces" and "pcs", "Nos" and "No."); count words do not fold
 *   together (round 6).
 * Blank stays "".
 */
export function normalizeHeader(h: string): string {
  let t = h.normalize("NFKC").replace(/\p{Cf}/gu, "").toLowerCase();
  t = t.replace(DASHES, "-").replace(/'/g, " ft ");
  for (const [re, to] of UNIT_TOKENS) t = t.replace(re, (m) => (m === "\u20b9" ? " inr " : to));
  // A dot between single letters joins them: "p.o." is "po".
  let prev = "";
  while (prev !== t) {
    prev = t;
    t = t.replace(/(?<![\p{L}\p{M}\p{N}])(\p{L}\p{M}*)\.(?=\p{L}\p{M}*(?:\.|[^\p{L}\p{M}\p{N}]|$))/u, "$1");
  }
  // Every other character that is not a word character, a space, "-", "/" or a kept sign is a space.
  t = t.replace(new RegExp(`[^\\p{L}\\p{M}\\p{N}\\s\\-/${KEPT}]`, "gu"), " ");
  // "/" is never a sign: a separator between words, else punctuation.
  t = t.replace(/\//g, " ");
  // "-": a sign at the end of the name, or right before a digit with no word right before it; else a space.
  t = t.replace(/-/g, (_m, i: number, str: string) => {
    const end = str.slice(i + 1).trim() === "";
    const beforeDigit = /\p{N}/u.test(str[i + 1] ?? "") && !WORD.test(str[i - 1] ?? "");
    return end || beforeDigit ? " - " : " ";
  });
  t = t.replace(new RegExp(`[${KEPT}]`, "g"), " $& ");
  return t.replace(/\s+/g, " ").trim();
}

/** A word that only names a unit, a count or a sign, alone or glued to a number ("12ft"). */
const UNIT_WORD =
  /^(?:\d+(?:\.\d+)?)?(?:kg|kgs|kilo|kilos|kilogram|kilograms|g|gm|gms|gram|grams|ton|tons|mt|m|mm|cm|mtr|ft|in|inch|inches|pc|pcs|piece|pieces|no|nos|inr|rs|%|#|\+|-|±|<|>|≤|≥)$/;

/**
 * Is a normalized header only unit words (round 6, B-R5-2)? "kg", "pcs", "kg/12ft", "%" and a blank are; a name with
 * any other word or a bare number ("Weight kg", "12 ft", "12") is a real name. A layout is trusted by `chooseHeader`
 * only through two real names.
 */
export function isUnitOnlyName(normalized: string): boolean {
  if (normalized === "" || /^_\d+$/.test(normalized)) return true;
  return normalized.split(/[\s/]+/).filter((t) => t !== "").every((t) => UNIT_WORD.test(t));
}

/**
 * How many leading columns count. Trailing columns with no header and no cell under them are dropped.
 */
export function usedWidth(headers: readonly string[], rows: readonly (readonly string[])[]): number {
  let width = headers.length;
  const colHasData = (c: number) => rows.some((r) => (r[c] ?? "").trim() !== "");
  while (width > 0 && headers[width - 1]!.trim() === "" && !colHasData(width - 1)) width--;
  return width;
}

/** Normalized headers of the first `width` columns; a blank one becomes `_` plus its index. */
export function normalizeHeaders(headers: readonly string[], width = headers.length): string[] {
  const out: string[] = [];
  for (let i = 0; i < width; i++) {
    const n = normalizeHeader(headers[i] ?? "");
    out.push(n === "" ? `_${i}` : n);
  }
  return out;
}

/**
 * Stored `match.headers` in normalized form. A bot or the mapping editor may store raw header text; a stored
 * blank placeholder (`_3`) stays as it is. Normalizing twice gives the same text.
 */
export function normalizeStoredHeaders(headers: readonly string[]): string[] {
  return headers.map((h, i) => (/^_\d+$/.test(h) ? h : normalizeHeader(h) || `_${i}`));
}

/** Hex SHA-256 of `"v1|"` plus the normalized headers joined by U+001F. Order matters. */
export function headerKey(normalized: readonly string[]): string {
  return sha256Hex(`v1|${normalized.join("\u001f")}`);
}

export function inferKinds(rows: readonly (readonly string[])[], width: number): CellKind[] {
  const kinds: CellKind[] = [];
  for (let c = 0; c < width; c++) kinds.push(inferKind(rows.map((r) => r[c] ?? "")));
  return kinds;
}

export type FingerprintInput = {
  headers: readonly string[];
  /** Data rows (any order; a sample is fine). */
  rows: readonly (readonly string[])[];
  headerRow?: number;
  headerRows?: number;
};

export type Fingerprint = BlockShape & { normalized: string[] };

export function fingerprint(input: FingerprintInput): Fingerprint {
  const width = usedWidth(input.headers, input.rows);
  const headers = input.headers.slice(0, width);
  const normalized = normalizeHeaders(headers, width);
  return {
    headers,
    normalized,
    columnCount: width,
    kinds: inferKinds(input.rows, width),
    headerKey: headerKey(normalized),
    headerRow: input.headerRow ?? 0,
    headerRows: input.headerRows ?? 1,
  };
}

export const SAMPLE_ROWS = 20;
export const SAMPLE_CELL_CHARS = 80;

/** The block as `artifact.putBlocks` takes it. `rows` is every data row; only a sample leaves with it. */
export function describeBlock(
  block: {
    sheetName: string | null;
    title: string | null;
    headerRow: number;
    headerRows: number;
    headers: readonly string[];
    rows: readonly (readonly string[])[];
  },
  ordinal: number,
): BlockInput {
  const fp = fingerprint(block);
  return {
    ordinal,
    sheetName: block.sheetName,
    title: block.title,
    headerRow: block.headerRow,
    headerRows: block.headerRows,
    headers: fp.headers,
    kinds: fp.kinds,
    headerKey: fp.headerKey,
    columnCount: fp.columnCount,
    rowCount: block.rows.length,
    sample: block.rows.slice(0, SAMPLE_ROWS).map((r) => fp.headers.map((_, i) => [...(r[i] ?? "")].slice(0, SAMPLE_CELL_CHARS).join(""))),
  };
}
