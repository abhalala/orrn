import { DEFAULT_NUMBER_STYLE, MM_PER_INCH, parseAmount, roundHalfAway, type LengthUnit } from "@orrn/domain";

export type { LengthUnit };

export function formatLength(mm: number, unit: LengthUnit): string {
  if (unit === "inch") {
    const inches = mm / MM_PER_INCH;
    return `${inches.toFixed(2)} in`;
  }
  return `${mm} mm`;
}

export function formatLengthValue(mm: number, unit: LengthUnit): string {
  if (unit === "inch") {
    return (mm / MM_PER_INCH).toFixed(2);
  }
  return mm.toString();
}

/**
 * Exact amount of mm times `scale` (1 for whole mm, 10 for tenths), from text in `unit`, half away from zero.
 * Null for anything that is not a plain non-negative number: "12abc", "", "--1", "1e3". (The old reader used
 * `parseFloat`, which read "12abc" as 12.) 1 in is exactly 127/5 mm.
 */
function mmScaled(value: string, unit: LengthUnit, scale: bigint): number | null {
  const p = parseAmount(value, DEFAULT_NUMBER_STYLE);
  if (!p.ok) return null;
  const mmNum = unit === "inch" ? p.amount.num * 127n : p.amount.num;
  const mmDen = unit === "inch" ? p.amount.den * 5n : p.amount.den;
  const n = Number(roundHalfAway(mmNum * scale, mmDen));
  return Number.isSafeInteger(n) ? n : null;
}

/** Whole mm from text in the plant's unit; 0 when the text is not a number (callers treat 0 as "not a length"). */
export function parseLength(value: string, unit: LengthUnit): number {
  return mmScaled(value, unit, 1n) ?? 0;
}

/** mm to one decimal from text in the plant's unit; 0 when the text is not a number. */
export function parseLengthDecimal(value: string, unit: LengthUnit): number {
  const n = mmScaled(value, unit, 10n);
  return n === null ? 0 : n / 10;
}

export function lengthUnitLabel(unit: LengthUnit): string {
  return unit === "inch" ? "in" : "mm";
}
