/**
 * Shared text-search helpers for list procedures (catalogue lists, ⌘K). Every pattern is ONE bound
 * parameter, so a search never grows the parameter count (D1 allows 100 per statement).
 */
import { sql, type AnyColumn, type SQL } from "drizzle-orm";

/** Escape LIKE wildcards so a search term is matched literally (paired with `ESCAPE '\\'`). */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** `%term%` with the term's own `%`, `_` and `\` taken literally. */
export function containsPattern(term: string): string {
  return `%${escapeLike(term)}%`;
}

/** `column LIKE '%term%' ESCAPE '\'` (ASCII case-insensitive, wildcards literal). */
export function likeContains(column: AnyColumn | SQL, term: string): SQL {
  return sql`${column} LIKE ${containsPattern(term)} ESCAPE '\\'`;
}

/** The fewest digits that make a term a phone search ("2457781", not "98"). */
const MIN_PHONE_DIGITS = 4;

/**
 * The digits of a term that looks like a phone number ("+91 98250-11234" → "919825011234"), or null
 * when it has letters or too few digits. Phones are stored as typed, so a dialled or pasted number
 * must be compared digits to digits.
 */
export function phoneDigits(term: string): string | null {
  if (!/^[\d\s+\-().]+$/.test(term)) return null;
  const digits = term.replace(/\D/g, "");
  return digits.length >= MIN_PHONE_DIGITS ? digits : null;
}

/** A stored phone with its spacing and punctuation dropped, inside SQL (no parameters bound). */
export function digitsOnly(column: AnyColumn): SQL {
  return sql`replace(replace(replace(replace(replace(replace(${column}, ' ', ''), '-', ''), '+', ''), '(', ''), ')', ''), '.', '')`;
}
