import { parseDecimal } from "@orrn/domain";

import { looksLikeDate } from "./dates";
import type { CellKind } from "./recipe";

/** A cell is cut to this many characters before it is staged (plan A9). */
export const MAX_CELL_CHARS = 200;

export function capCell(text: string, max = MAX_CELL_CHARS): { text: string; cut: boolean } {
  const chars = [...text];
  return chars.length > max ? { text: chars.slice(0, max).join(""), cut: true } : { text, cut: false };
}

export type SingleKind = "date" | "int" | "decimal" | "code" | "text";

/** Plan B3 test order: date, int, decimal, code, text. */
export function cellKind(raw: string): SingleKind | null {
  const t = raw.trim();
  if (t === "") return null;
  if (looksLikeDate(t)) return "date";
  const n = parseDecimal(t);
  if (n !== null) return /^[\d,]+$/.test(t) ? "int" : "decimal";
  if (/^[A-Za-z0-9]{1,12}$/.test(t) && /\d/.test(t)) return "code";
  return "text";
}

/** Up to 200 non-blank cells of a column: the first 100 plus 100 spread over the rest. */
export function sampleColumn(cells: readonly string[], first = 100, spread = 100): string[] {
  const nonBlank: string[] = [];
  for (const c of cells) if (c.trim() !== "") nonBlank.push(c);
  if (nonBlank.length <= first + spread) return nonBlank;
  const out = nonBlank.slice(0, first);
  const rest = nonBlank.length - first;
  for (let i = 0; i < spread; i++) out.push(nonBlank[first + Math.floor((i * rest) / spread)]!);
  return out;
}

/** A kind wins at 90% of the sample, else `mixed`; all blank is `empty`. Int and decimal together count as decimal. */
export function inferKind(cells: readonly string[]): CellKind {
  const sample = sampleColumn(cells);
  if (sample.length === 0) return "empty";
  const counts: Record<SingleKind, number> = { date: 0, int: 0, decimal: 0, code: 0, text: 0 };
  for (const c of sample) counts[cellKind(c)!]++;
  const need = sample.length * 0.9;
  for (const k of ["date", "int", "decimal", "code", "text"] as const) if (counts[k] >= need) return k;
  if (counts.int + counts.decimal >= need) return "decimal";
  return "mixed";
}

/** Equal, or int with decimal, or either side empty or mixed. */
export function kindsCompatible(a: CellKind, b: CellKind): boolean {
  if (a === b) return true;
  if (a === "empty" || b === "empty" || a === "mixed" || b === "mixed") return true;
  return (a === "int" && b === "decimal") || (a === "decimal" && b === "int");
}
