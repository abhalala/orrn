import { TARGETS, type IngestTarget, type Recipe, type TargetField } from "@orrn/ingest";

import type { PlantUnits } from "./plant-units";
import { fieldLabelKey } from "./recipe-builder";
import type { StagedRowView } from "./types";

/**
 * What a staged row shows for each mapped field (work order section 4). The value is in the plant's unit first,
 * grouped the plant's way, with its unit apart so the screen can mute it. The file's own value is a second line
 * only when the file's unit differs from the plant's. A rate is masked for a person without `order.price`: the
 * server sends no rate and no entered rate, `rateHidden` is true, and the cell is hidden, never zero. The server's
 * own working values (`_ids`, `_dupKey`, `_options`, `_magnitude`) are never shown, and a raw stored integer
 * (grams, paise, millimetres) is never shown as it is stored.
 */
export type ValueCell = {
  field: string;
  /** `ingest.field.<name>`. */
  labelKey: string;
  /** The rate is masked for this person: show `ingest.rate.hidden`, no unit, no file line. */
  hidden: boolean;
  kind: "number" | "text" | "date" | "enum";
  /** The value as text. Empty when `textKey` is set. For feet and inches it is the whole value with its unit. */
  text: string;
  /** An enum value's words (`ingest.enumValue.<value>`): translate it instead of showing `text`. */
  textKey: string | null;
  /** The unit after a number, in muted sans. Empty for text, dates and feet and inches. */
  unit: string;
  /** Numbers and codes are set in mono and numbers align to the right. Names and dates are not. */
  mono: boolean;
  align: "start" | "end";
  /** What the file said ("58,400 g"), only when its unit differs from the plant's. The screen puts `ingest.row.entered` before it. */
  fileSaid: string | null;
};

/** Paise to rupees as text with two decimals, without float arithmetic. */
export function rupeesFromPaise(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(paise));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Fields whose value is a code the person copies from the file, so it stays as written, in mono. */
const CODE_FIELDS = new Set(["series", "sectionCode", "legacyId", "poNumber", "oldOrderNo", "makerDieNo", "makerProjectNo", "taxId", "gstin"]);

const NUMERIC = new Set(["length", "mass", "linear_mass", "price_per_mass", "count", "dimension"]);
const isNumericDef = (def: TargetField | undefined): def is TargetField & { kind: "length" | "mass" | "linear_mass" | "price_per_mass" | "count" | "dimension" } =>
  !!def && NUMERIC.has(def.kind);

const plain = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

export const ENUM_VALUE_KEYS: readonly string[] = ["active", "archived", "available", "at_nitriding", "retired", "in_use", "at_maker", "on_trial"];

/** The words of an enum value, or null when the dictionary has none. */
export function enumValueKey(value: string): string | null {
  return ENUM_VALUE_KEYS.includes(value) ? `ingest.enumValue.${value}` : null;
}

/** "at_nitriding" as "At nitriding", for an enum value the dictionary does not know yet. Never the stored code. */
export function plainWords(value: string): string {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  return spaced === "" ? "" : spaced[0]!.toUpperCase() + spaced.slice(1);
}

const looksIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function blankCell(field: string, hidden: boolean): ValueCell {
  return { field, labelKey: fieldLabelKey(field), hidden, kind: "text", text: "", textKey: null, unit: "", mono: false, align: "start", fileSaid: null };
}

/** One stored field as a cell, or null when it is blank. */
export function valueCell(
  def: TargetField | undefined,
  name: string,
  raw: unknown,
  typed: { text: string; unit: string | null } | undefined,
  plant: PlantUnits,
): ValueCell | null {
  if ((raw === null || raw === undefined || raw === "") && !typed) return null;
  const base = blankCell(name, false);
  if (isNumericDef(def) && typeof raw === "number") {
    const q = plant.quantity(def.kind, raw);
    const said = typed ? plant.fileSaid(def.kind, typed) : null;
    const shown = q.unit ? `${q.text} ${q.unit}` : q.text;
    return { ...base, kind: "number", text: q.text, unit: q.unit, mono: true, align: "end", fileSaid: said !== null && said !== shown ? said : null };
  }
  if (def?.kind === "enum" && typeof raw === "string") {
    const key = enumValueKey(raw);
    return { ...base, kind: "enum", text: key ? "" : plainWords(raw), textKey: key };
  }
  if (def?.kind === "date" && looksIso(raw)) return { ...base, kind: "date", text: plant.day(raw) };
  return { ...base, kind: "text", text: plain(raw), mono: CODE_FIELDS.has(name) };
}

/** The cells of a row, in the catalogue's field order, then any extra stored value. Blank values are left out. */
export function valueCells(
  target: IngestTarget | null,
  row: Pick<StagedRowView, "values" | "entered" | "rateHidden">,
  plant: PlantUnits,
): ValueCell[] {
  const values = row.values ?? {};
  const entered = row.entered ?? {};
  const defs = target ? TARGETS[target].fields : [];
  // Keys that start with "_" are the server's own working values (`_ids`, `_dupKey`), not what the file said.
  const order = [...defs.map((d) => d.name), ...Object.keys(values).filter((k) => !k.startsWith("_") && !defs.some((d) => d.name === k))];
  const out: ValueCell[] = [];
  for (const name of order) {
    const def = defs.find((d) => d.name === name);
    if (row.rateHidden && (def?.kind === "price_per_mass" || name === "rate")) {
      out.push({ ...blankCell(name, true) });
      continue;
    }
    const cell = valueCell(def, name, values[name], entered[name], plant);
    if (cell) out.push(cell);
  }
  return out;
}

export type RowColumn = {
  field: string;
  labelKey: string;
  /** The plant's unit for the header ("Weight, kg"): empty for text, dates and feet and inches. */
  unit: string;
  numeric: boolean;
  mono: boolean;
  align: "start" | "end";
};

/**
 * One column per mapped field for the rows table. A person-made or bot-made layout has a recipe, and only the fields
 * it maps get a column. A known layout (no recipe on the candidate) shows every field of the target that any row has.
 */
export function rowColumns(target: IngestTarget | null, recipe: Recipe | null, plant: PlantUnits): RowColumn[] {
  if (!target) return [];
  const mapped = recipe && recipe.target === target ? new Set(recipe.fields.map((f) => f.field)) : null;
  return TARGETS[target].fields
    .filter((d) => (mapped ? mapped.has(d.name) : true))
    .map((d) => {
      const numeric = isNumericDef(d);
      return {
        field: d.name,
        labelKey: fieldLabelKey(d.name),
        unit: numeric ? plant.unitText(d.kind) : "",
        numeric,
        mono: numeric || CODE_FIELDS.has(d.name),
        align: numeric ? ("end" as const) : ("start" as const),
      };
    });
}

/** A raw cell of a row labelled by the file's own header, or "Column {n}" when the header is blank. */
export function rawCells(raw: readonly string[], headers: readonly string[]): { label: string | null; n: number; value: string }[] {
  return raw.map((value, index) => ({ label: headers[index]?.trim() ? headers[index]!.trim() : null, n: index + 1, value }));
}
