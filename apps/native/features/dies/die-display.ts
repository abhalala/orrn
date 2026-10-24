/** Die text for the list and the detail page; mirrors apps/web/src/features/dies/{die-display,die-model}.ts. */
import { MM_PER_INCH } from "@orrn/domain";

export type LengthUnitName = "mm" | "inch";

function trimNumber(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)));
}

/** "PATTI 14701": how the floor names a die. */
export function dieCode(d: { series: string; sectionCode: string }): string {
  return `${d.series} ${d.sectionCode}`;
}

/** Grams to kg text: "2.4", "2.65", never "2.4000000001". */
export function kgText(g: number): string {
  return trimNumber(g / 1000, 3);
}

/** Stored mm as text in the company unit: mm to 0.1, inches to 3 decimals. */
export function geometryText(mm: number | null | undefined, unit: LengthUnitName): string {
  if (mm === null || mm === undefined || !Number.isFinite(mm)) return "";
  return unit === "mm" ? trimNumber(mm, 1) : trimNumber(mm / MM_PER_INCH, 3);
}

/** "3.2 mm", or decimal inches for an inch company ("0.126 in"). */
export function measurementText(mm: number, unit: LengthUnitName, units: { mm: string; inch: string }): string {
  return unit === "mm" ? `${geometryText(mm, "mm")} ${units.mm}` : `${geometryText(mm, "inch")} ${units.inch}`;
}

export const GEOMETRY_FIELDS = ["width", "thickness", "oblique", "leg"] as const;
export type GeometryField = (typeof GEOMETRY_FIELDS)[number];

type DieGeometry = {
  widthMm?: number | null;
  thicknessMm?: number | null;
  obliqueMm?: number | null;
  legMm?: number | null;
  dimensions?: Record<string, unknown> | null;
};

const COLUMN = { width: "widthMm", thickness: "thicknessMm", oblique: "obliqueMm", leg: "legMm" } as const;

/** The measurements a die has, in display order. Older dies kept width and thickness only in `dimensions`. */
export function dieMeasurements(die: DieGeometry): { field: GeometryField; mm: number }[] {
  const out: { field: GeometryField; mm: number }[] = [];
  for (const field of GEOMETRY_FIELDS) {
    const column = COLUMN[field];
    const legacy = field === "width" || field === "thickness" ? die.dimensions?.[column] : undefined;
    const mm = die[column] ?? (typeof legacy === "number" ? legacy : null);
    if (mm !== null && mm !== undefined) out.push({ field, mm });
  }
  return out;
}
