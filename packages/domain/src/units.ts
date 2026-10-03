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

/** Catalogue weight band /12': floor to 0.1 kg with a 0.01 tolerance. */
export function weightRange12ft(kg12ft: number): number {
  return Math.floor((kg12ft + 0.01) * 10) / 10;
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
