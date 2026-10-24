/** Plant maths shared by server, web and native. All lengths are stored in mm, weights in g. */

export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;

export type LengthUnit = "mm" | "inch";

export function gToKg(g: number): number {
  return g / 1000;
}

/** Whole grams, as stored in the database. */
export function kgToG(kg: number): number {
  return Math.round(kg * 1000);
}

/**
 * Weight of one 12 ft piece: `(kg / pcs) / (lengthMm / 304.8) * 12`.
 * Null when the bundle has no pieces or no length.
 */
export function kgPer12ft(input: { weightG: number; pieces: number; lengthMm: number }): number | null {
  const { weightG, pieces, lengthMm } = input;
  if (!(pieces > 0) || !(lengthMm > 0)) return null;
  return (gToKg(weightG) / pieces / (lengthMm / MM_PER_FOOT)) * 12;
}

/**
 * Catalogue weight band /12': floor to 0.1 kg with a 0.01 tolerance, `floor((kg/12ft + 0.01) × 10) / 10`.
 * The 1e-9 keeps binary floating point from dropping an exact boundary one band low
 * (2.09 + 0.01 is 2.0999999999999996 in IEEE doubles; the band is 2.1).
 */
export function weightRange12ft(kg12ft: number): number {
  return Math.floor((kg12ft + 0.01) * 10 + 1e-9) / 10;
}

/** The same band from stored thousandths (grams per 12 ft), in exact integer arithmetic: 2090 → 2.1. */
export function weightRange12ftFromMilli(kgPer12ftMilli: number): number {
  return Math.floor((Math.round(kgPer12ftMilli) + 10) / 100) / 10;
}

/**
 * Range /12' of a bundle, from its RAW kg per 12 ft (PL-8 review round 3; rule in AGENTS.md under
 * "dispatch.pl_number … Range /12'"). This is the plant's Excel formula
 * `floor((kg12 + 0.01) × 10) / 10` on the unrounded value (the column the customer is billed on), not
 * on the 3-decimal kg/12ft printed beside it: raw 2.0895 is band 2.0 although it prints as 2.090.
 * With kg12 = weightG × 3657.6 / (1000 × pieces × lengthMm) the formula is evaluated exactly on
 * integers: tenths = floor((weightG × 36576 + 100 × pieces × lengthMm) / (1000 × pieces × lengthMm)).
 * Non-integer inputs fall back to `weightRange12ft(kgPer12ft(...))`. Null without pieces or length.
 */
export function weightRange12ftOf(input: { weightG: number; pieces: number; lengthMm: number }): number | null {
  const { weightG, pieces, lengthMm } = input;
  if (!(pieces > 0) || !(lengthMm > 0)) return null;
  if (![weightG, pieces, lengthMm].every(Number.isSafeInteger)) {
    const kg12 = kgPer12ft(input);
    return kg12 === null ? null : weightRange12ft(kg12);
  }
  const den = 1000 * pieces * lengthMm;
  const num = weightG * 36_576 + 100 * pieces * lengthMm;
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) return weightRange12ft(kgPer12ft(input)!);
  const r = num % den;
  return (num - (r < 0 ? r + den : r)) / den / 10;
}

function fixedIN(value: number, digits: number): string {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function formatKg(kg: number, digits = 2): string {
  return fixedIN(kg, digits);
}

export function formatKgTotal(kg: number): string {
  return fixedIN(kg, 1);
}

/** Plain non-negative decimal, thousands commas allowed. No exponent, sign or junk. */
export function parseDecimal(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, "");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Reads the length fields for the company's unit and returns whole mm.
 * mm companies use `mm`; inch companies use `feet` + `inches` (either may be empty).
 * Fields belonging to the other unit are ignored, so a stray mm value is never read as inches.
 */
export function lengthFromInput(input: {
  unit: LengthUnit;
  mm?: string;
  feet?: string;
  inches?: string;
}): number | null {
  if (input.unit === "mm") {
    const mm = parseDecimal(input.mm ?? "");
    if (mm === null) return null;
    const rounded = Math.round(mm);
    return rounded > 0 ? rounded : null;
  }

  const feetText = (input.feet ?? "").trim();
  const inchesText = (input.inches ?? "").trim();
  if (feetText === "" && inchesText === "") return null;
  const feet = feetText === "" ? 0 : parseDecimal(feetText);
  const inches = inchesText === "" ? 0 : parseDecimal(inchesText);
  if (feet === null || inches === null) return null;
  const mm = Math.round((feet * 12 + inches) * MM_PER_INCH);
  return mm > 0 ? mm : null;
}

/** `"3658 mm"`, or for inch companies `"12 ft"` / `"11 ft 6 in"` with inches rounded to 0.25. */
export function formatLength(mm: number, unit: LengthUnit): string {
  if (unit === "mm") return `${Math.round(mm)} mm`;

  const totalInches = Math.round(mm / MM_PER_INCH / 0.25) * 0.25;
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches - feet * 12;
  const inchText = `${Number(inches.toFixed(2))} in`;
  if (feet === 0) return inchText;
  if (inches === 0) return `${feet} ft`;
  return `${feet} ft ${inchText}`;
}
