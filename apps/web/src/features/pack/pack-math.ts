import { MM_PER_INCH, kgToG, parseDecimal, type LengthUnit } from "@orrn/domain";

/**
 * Packing maths for the Pack screens. Weights are typed in kg and stored in
 * whole grams; lengths are typed in the company unit and stored in mm (the
 * conversions live in `@orrn/domain`, these wrap them for the bundle card).
 */

/** The most pieces one bundle can hold before it is surely a typo. */
export const MAX_PIECES = 100_000;

/** Weight field (kg, decimals and grouping commas allowed) to whole grams; null if not a positive weight. */
export function parseWeightG(text: string): number | null {
  const kg = parseDecimal(text);
  if (kg === null) return null;
  const g = kgToG(kg);
  return g > 0 ? g : null;
}

/** Pieces field to a whole positive count; null otherwise. */
export function parsePieces(text: string): number | null {
  const n = parseDecimal(text);
  if (n === null || !Number.isInteger(n) || n < 1 || n > MAX_PIECES) return null;
  return n;
}

export type LengthFields = { mm: string; feet: string; inches: string };

/** Stored mm back into the length fields for the company's unit (inches to the nearest 0.25, zero inches left blank). */
export function lengthToInput(mm: number, unit: LengthUnit): LengthFields {
  if (!(mm > 0)) return { mm: "", feet: "", inches: "" };
  if (unit === "mm") return { mm: String(Math.round(mm)), feet: "", inches: "" };
  const totalInches = Math.round(mm / MM_PER_INCH / 0.25) * 0.25;
  const feet = Math.floor(totalInches / 12);
  const inches = Number((totalInches - feet * 12).toFixed(2));
  return { mm: "", feet: feet > 0 ? String(feet) : "", inches: inches > 0 ? String(inches) : "" };
}

export type Totals = { bundles: number; pieces: number; weightG: number };

export function draftTotals(bundles: readonly { weightG: number; pieces: number }[]): Totals {
  let pieces = 0;
  let weightG = 0;
  for (const b of bundles) {
    pieces += b.pieces;
    weightG += b.weightG;
  }
  return { bundles: bundles.length, pieces, weightG };
}

export type YardOption = { id: string; code: string; name: string };

/**
 * The yards packed bundles can go to: active locations of kind `yard`, in
 * the server's order (sort order, then code). Empty for a company without
 * yards, which packs without one (the server only asks once yards exist).
 */
export function activeYards(
  items: readonly { id: string; code: string; name: string; kind: string; active: boolean }[] | undefined,
): YardOption[] {
  return (items ?? []).filter((l) => l.kind === "yard" && l.active).map(({ id, code, name }) => ({ id, code, name }));
}

/**
 * The yard tile that starts selected: the draft's own yard while it is still
 * active, else the yard last packed into on this device (a packing station
 * stays at one yard), else none. A retired yard is never offered.
 */
export function chooseYard(opts: {
  current: string | undefined;
  lastUsed: string | null;
  yards: readonly YardOption[];
}): string | undefined {
  const active = (id: string | null | undefined) => (id ? opts.yards.some((y) => y.id === id) : false);
  if (active(opts.current)) return opts.current;
  if (active(opts.lastUsed)) return opts.lastUsed ?? undefined;
  return undefined;
}
