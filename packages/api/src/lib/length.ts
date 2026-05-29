export type LengthUnit = "mm" | "inch";

const MM_PER_INCH = 25.4;

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

export function parseLength(value: string, unit: LengthUnit): number {
  const num = parseFloat(value);
  if (isNaN(num)) return 0;
  if (unit === "inch") return Math.round(num * MM_PER_INCH);
  return Math.round(num);
}

export function parseLengthDecimal(value: string, unit: LengthUnit): number {
  const num = parseFloat(value);
  if (isNaN(num)) return 0;
  if (unit === "inch") return Math.round(num * MM_PER_INCH * 10) / 10;
  return Math.round(num * 10) / 10;
}

export function lengthUnitLabel(unit: LengthUnit): string {
  return unit === "inch" ? "in" : "mm";
}
