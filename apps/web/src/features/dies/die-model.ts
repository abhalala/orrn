/**
 * Die form model (plan Task 23, audit N6/W9, spec Q1).
 *
 * - The weight range is edited in kg per 12 ft and stored as whole grams (`kgToG`).
 * - Width, thickness and leg are typed in the company's length unit and stored in mm at
 *   0.1 mm precision (ruling R16).
 * - N6: a field the person didn't touch is sent with its stored value exactly, never re-derived
 *   from its display text. An inch company opening a die with a 10 mm thickness and saving it
 *   untouched must still store 10 mm (an inch display rounds, and a round trip would drift).
 */
import { kgToG, MM_PER_INCH, parseDecimal, type LengthUnit } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

export type DieStatus = "active" | "archived";

/** The fields of a stored die the form reads (die.get). */
export type StoredDie = {
  series: string;
  sectionCode: string;
  name: string | null;
  legMm: number | null;
  widthMm: number | null;
  thicknessMm: number | null;
  dimensions: Record<string, unknown> | null;
  weightMinG: number;
  weightMaxG: number;
  status: DieStatus;
  notes: string | null;
};

export type DieDraft = {
  series: string;
  sectionCode: string;
  name: string;
  weightMin: string;
  weightMax: string;
  status: DieStatus;
  notes: string;
  width: string;
  thickness: string;
  leg: string;
};

/** 25.4 mm as an exact integer number of tenths. */
const TENTHS_MM_PER_INCH = MM_PER_INCH * 10;

export const GEOMETRY_FIELDS = ["width", "thickness", "leg"] as const;
export type GeometryField = (typeof GEOMETRY_FIELDS)[number];

const GEOMETRY_COLUMN = {
  width: "widthMm",
  thickness: "thicknessMm",
  leg: "legMm",
} as const satisfies Record<GeometryField, keyof StoredDie>;

export const EMPTY_DIE_DRAFT: DieDraft = {
  series: "",
  sectionCode: "",
  name: "",
  weightMin: "",
  weightMax: "",
  status: "active",
  notes: "",
  width: "",
  thickness: "",
  leg: "",
};

/** What die.create / die.update take. */
export type DieInput = {
  series: string;
  sectionCode: string;
  name: string | null;
  weightMinG: number;
  weightMaxG: number;
  status: DieStatus;
  notes: string | null;
  widthMm: number | null;
  thicknessMm: number | null;
  legMm: number | null;
  dimensions: Record<string, unknown>;
};

function trimNumber(n: number, digits: number): string {
  return String(Number(n.toFixed(digits)));
}

/** Grams to kg text: "2.4", "2.65", never "2.4000000001". */
export function kgText(g: number): string {
  return trimNumber(g / 1000, 3);
}

/** Stored mm as text in the company unit: mm to 0.1, inches to 3 decimals. */
export function geometryText(mm: number | null | undefined, unit: LengthUnit): string {
  if (mm === null || mm === undefined || !Number.isFinite(mm)) return "";
  return unit === "mm" ? trimNumber(mm, 1) : trimNumber(mm / MM_PER_INCH, 3);
}

/** Commas only as digit grouping: 1,250.5 and the Indian 1,25,000, never a leading 0 group. */
const DIGIT_GROUPING = /^(?:[1-9]\d{0,2}(?:,\d{3})+|[1-9]\d?(?:,\d{2})*,\d{3})(?:\.\d*)?$/;

/**
 * A typed number, or null. `parseDecimal` drops every comma, so "2,65" (a decimal comma) would read
 * as 265; a comma is accepted only as digit grouping here.
 */
export function readDecimal(text: string): number | null {
  const s = text.trim();
  if (s.includes(",") && !DIGIT_GROUPING.test(s)) return null;
  return parseDecimal(s);
}

/** Text in the company unit to mm at 0.1 mm; null when empty, "invalid" when not a number. */
export function parseGeometry(text: string, unit: LengthUnit): number | null | "invalid" {
  if (text.trim() === "") return null;
  const n = readDecimal(text);
  if (n === null) return "invalid";
  // Inches x 254 is tenths of a mm, rounded to the 0.1 mm the server keeps (R16): 1/8 in is
  // 31.75 tenths, so it is stored as 3.2 mm and reads back as 0.126 in.
  return unit === "mm" ? Math.round(n * 10) / 10 : Math.round(n * TENTHS_MM_PER_INCH) / 10;
}

function storedGeometry(die: StoredDie, field: GeometryField): number | null {
  const column = die[GEOMETRY_COLUMN[field]] as number | null;
  if (column !== null && column !== undefined) return column;
  // Older dies kept width and thickness only in the dimensions blob.
  if (field === "width" || field === "thickness") {
    const legacy = die.dimensions?.[GEOMETRY_COLUMN[field]];
    if (typeof legacy === "number" && Number.isFinite(legacy)) return legacy;
  }
  return null;
}

export function dieToDraft(die: StoredDie, unit: LengthUnit): DieDraft {
  return {
    series: die.series,
    sectionCode: die.sectionCode,
    name: die.name ?? "",
    weightMin: kgText(die.weightMinG),
    weightMax: kgText(die.weightMaxG),
    status: die.status,
    notes: die.notes ?? "",
    width: geometryText(storedGeometry(die, "width"), unit),
    thickness: geometryText(storedGeometry(die, "thickness"), unit),
    leg: geometryText(storedGeometry(die, "leg"), unit),
  };
}

function kgToGrams(text: string): number {
  return kgToG(readDecimal(text) ?? 0);
}

/**
 * The die.create / die.update input. With `original` (an edit), any field whose text still equals
 * the text the form opened with is sent exactly as stored (N6).
 */
export function draftToDieInput(draft: DieDraft, unit: LengthUnit, original?: StoredDie): DieInput {
  const opened = original ? dieToDraft(original, unit) : null;
  const untouched = (field: keyof DieDraft) => opened !== null && draft[field].trim() === opened[field].trim();

  const geometry = {} as Record<GeometryField, number | null>;
  for (const field of GEOMETRY_FIELDS) {
    if (original && untouched(field)) {
      geometry[field] = storedGeometry(original, field);
    } else {
      const mm = parseGeometry(draft[field], unit);
      geometry[field] = mm === "invalid" ? null : mm;
    }
  }

  const dimensions: Record<string, unknown> = { ...(original?.dimensions ?? {}) };
  for (const field of ["width", "thickness"] as const) {
    const key = GEOMETRY_COLUMN[field];
    if (geometry[field] === null) delete dimensions[key];
    else dimensions[key] = geometry[field];
  }

  const name = draft.name.trim();
  const notes = draft.notes.trim();
  return {
    series: draft.series.trim(),
    sectionCode: draft.sectionCode.trim(),
    name: name || null,
    weightMinG: original && untouched("weightMin") ? original.weightMinG : kgToGrams(draft.weightMin),
    weightMaxG: original && untouched("weightMax") ? original.weightMaxG : kgToGrams(draft.weightMax),
    status: draft.status,
    notes: notes || null,
    widthMm: geometry.width,
    thicknessMm: geometry.thickness,
    legMm: geometry.leg,
    dimensions,
  };
}

export type DieDraftErrors = Partial<Record<keyof DieDraft, MessageKey>>;

/** Field errors as message keys; an empty object when the draft can be saved. */
export function validateDieDraft(draft: DieDraft, unit: LengthUnit): DieDraftErrors {
  const errors: DieDraftErrors = {};
  if (!draft.series.trim()) errors.series = "errors.required";
  if (!draft.sectionCode.trim()) errors.sectionCode = "errors.required";

  const weight = (field: "weightMin" | "weightMax"): number | null => {
    const text = draft[field];
    if (!text.trim()) {
      errors[field] = "errors.required";
      return null;
    }
    const n = readDecimal(text);
    if (n === null) {
      errors[field] = "errors.invalidNumber";
      return null;
    }
    // Stored as whole grams, at least 1 g.
    if (kgToG(n) < 1) {
      errors[field] = "errors.notPositive";
      return null;
    }
    return n;
  };
  const min = weight("weightMin");
  const max = weight("weightMax");
  if (min !== null && max !== null && max < min) errors.weightMax = "dies.form.rangeOrder";

  for (const field of GEOMETRY_FIELDS) {
    if (parseGeometry(draft[field], unit) === "invalid") errors[field] = "errors.invalidNumber";
  }
  return errors;
}
