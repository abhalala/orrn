import {
  normalizeHeaders,
  TARGETS,
  unitFromHeaderText,
  unitsFor,
  validateRecipe,
  type DateFormat,
  type IngestTarget,
  type Recipe,
  type RecipeError,
  type RecipeField,
  type TargetField,
  type UnitKind,
} from "@orrn/ingest";

/**
 * The manual mapping editor's logic (plan B2, B4), with no markup. The person picks, for each orrn field, the column
 * of the file that holds it and, for a number, the unit. `buildRecipe` turns those rows into a `Recipe` that passes
 * the engine's `validateRecipe`. A number whose unit nobody chose has `unit: null` in its step and an `unclear`
 * entry: the dry run asks the person ("which unit is it?"), nothing is ever assumed.
 */

export type MappingRow = {
  id: number;
  field: string;
  /** Index of the column in the block, or null for "Not used". */
  column: number | null;
  /** A unit id the person chose (or one read from the header), null when it is still to be asked. */
  unit: string | null;
  dateFormat: DateFormat;
};

/** What the editor needs to know about a block: its headers and where its header row is. */
export type BlockForMapping = {
  headers: readonly string[];
  headerKey: string;
  headerRow: number;
  headerRows: number;
};

const NUMERIC_KINDS: readonly string[] = ["length", "mass", "linear_mass", "price_per_mass", "count", "dimension"];

export type FieldMeta = {
  name: string;
  /** Dictionary key of the field's words, `ingest.field.<name>`. */
  labelKey: string;
  kind: TargetField["kind"];
  /** The unit kind of a number field, else null. */
  unitKind: UnitKind | null;
  /** Units the person may choose for a number field. */
  units: string[];
  required: boolean;
  resolver: TargetField["resolver"];
  enumValues: readonly string[] | null;
  isDate: boolean;
};

export const fieldLabelKey = (name: string) => `ingest.field.${name}`;

export function isNumericKind(kind: string): kind is UnitKind {
  return NUMERIC_KINDS.includes(kind);
}

/** The target's fields as the editor shows them, in the catalogue's order. */
export function targetFields(target: IngestTarget): FieldMeta[] {
  return TARGETS[target].fields.map((f) => ({
    name: f.name,
    labelKey: fieldLabelKey(f.name),
    kind: f.kind,
    unitKind: isNumericKind(f.kind) ? f.kind : null,
    units: isNumericKind(f.kind) ? unitsFor(f.kind) : [],
    required: f.required,
    resolver: f.resolver,
    enumValues: f.enum,
    isDate: f.kind === "date",
  }));
}

const fieldOf = (target: IngestTarget, name: string) => TARGETS[target].fields.find((f) => f.name === name);

/** The unit a header names for this field (`Weight (kg)`), or null. Read from the file, never a default. */
export function unitGuess(target: IngestTarget, field: string, header: string | undefined): string | null {
  const def = fieldOf(target, field);
  if (!def || !isNumericKind(def.kind) || !header) return null;
  return unitFromHeaderText(header, def.kind);
}

/** Rows to start from: the candidate's recipe if it has one for this target, else the required fields, unmapped. */
export function initialMappings(block: BlockForMapping, target: IngestTarget, recipe: Recipe | null): MappingRow[] {
  if (recipe && recipe.target === target) {
    return recipe.fields.map((field, index) => {
      const source = field.source.kind === "columns" ? field.source.cols[0] : undefined;
      const number = field.steps.find((s) => s.op === "number");
      const date = field.steps.find((s) => s.op === "date");
      return {
        id: index + 1,
        field: field.field,
        column: source?.col ?? null,
        unit: number && number.op === "number" ? number.unit : null,
        dateFormat: date && date.op === "date" ? date.format : "dmy",
      };
    });
  }
  return TARGETS[target].fields
    .filter((f) => f.required)
    .map((f, index) => ({ id: index + 1, field: f.name, column: null, unit: null, dateFormat: "dmy" as const }));
}

/** Adds the first field of the target that has no row yet. */
export function addMapping(rows: readonly MappingRow[], target: IngestTarget): MappingRow[] {
  const used = new Set(rows.map((r) => r.field));
  const next = TARGETS[target].fields.find((f) => !used.has(f.name));
  if (!next) return [...rows];
  return [...rows, { id: Math.max(0, ...rows.map((r) => r.id)) + 1, field: next.name, column: null, unit: null, dateFormat: "dmy" }];
}

export function updateMapping(rows: readonly MappingRow[], id: number, patch: Partial<Omit<MappingRow, "id">>): MappingRow[] {
  return rows.map((r) => (r.id === id ? { ...r, ...patch } : r));
}

/** Another field for a row: the unit starts again, to be read from the column's header or asked. */
export function changeField(rows: readonly MappingRow[], id: number, field: string, target: IngestTarget, block: BlockForMapping): MappingRow[] {
  return rows.map((r) =>
    r.id === id ? { ...r, field, unit: unitGuess(target, field, r.column === null ? undefined : block.headers[r.column]) } : r,
  );
}

/** Another column for a row. When the unit is still open, the header may name it (`Weight (kg)`). */
export function changeColumn(rows: readonly MappingRow[], id: number, column: number | null, target: IngestTarget, block: BlockForMapping): MappingRow[] {
  return rows.map((r) => {
    if (r.id !== id) return r;
    const unit = r.unit ?? (column === null ? null : unitGuess(target, r.field, block.headers[column]));
    return { ...r, column, unit };
  });
}

export type MappingProblems = {
  /** Required fields with no mapped column: the recipe cannot be saved. */
  missingRequired: string[];
  /** The same column used for two fields is allowed; two rows for one field are not. */
  duplicateFields: string[];
  /** Number fields whose unit is open: the dry run will ask. Information, not a stop. */
  unitToAsk: string[];
};

export function mappingProblems(target: IngestTarget, rows: readonly MappingRow[]): MappingProblems {
  const mapped = rows.filter((r) => r.column !== null);
  const seen = new Set<string>();
  const duplicateFields: string[] = [];
  for (const r of mapped) {
    if (seen.has(r.field)) duplicateFields.push(r.field);
    seen.add(r.field);
  }
  return {
    missingRequired: TARGETS[target].fields.filter((f) => f.required && !seen.has(f.name)).map((f) => f.name),
    duplicateFields,
    unitToAsk: mapped.filter((r) => {
      const def = fieldOf(target, r.field);
      return def && isNumericKind(def.kind) && r.unit === null;
    }).map((r) => r.field),
  };
}

const UPPER_FIELDS = new Set(["taxId", "gstin", "series"]);

function stepsFor(def: TargetField, row: MappingRow, old: RecipeField | undefined): RecipeField["steps"] {
  const keep = (old?.steps ?? []).filter((s) => s.op !== "number" && s.op !== "date");
  if (isNumericKind(def.kind)) return [{ op: "number", kind: def.kind, unit: row.unit }];
  if (def.kind === "date") return [{ op: "date", format: row.dateFormat }];
  if (def.kind === "enum" && def.enum) {
    const pick = keep.find((s) => s.op === "pick");
    return [
      { op: "trim" },
      { op: "case", to: "lower" },
      pick ?? { op: "pick", map: def.enum.map((v) => ({ from: v, to: v })), otherwise: "refuse" },
    ];
  }
  const steps: RecipeField["steps"] = keep.length > 0 ? [...keep] : [{ op: "trim" }];
  if (UPPER_FIELDS.has(def.name) && !steps.some((s) => s.op === "case")) steps.push({ op: "case", to: "upper" });
  if (def.resolver && !steps.some((s) => s.op === "lookup")) steps.push({ op: "lookup", resolver: def.resolver });
  return steps;
}

/** The recipe for these rows. Rows with no column are left out; a number with no unit is asked, not guessed. */
export function buildRecipe(block: BlockForMapping, target: IngestTarget, rows: readonly MappingRow[], previous: Recipe | null): Recipe {
  const prev = previous && previous.target === target ? previous : null;
  const fields: RecipeField[] = [];
  const unclear: Recipe["unclear"] = [];
  for (const row of rows) {
    if (row.column === null) continue;
    const def = fieldOf(target, row.field);
    if (!def) continue;
    const old = prev?.fields.find((f) => f.field === row.field);
    fields.push({
      field: row.field,
      source: { kind: "columns", cols: [{ col: row.column, header: block.headers[row.column] ?? "" }] },
      steps: stepsFor(def, row, old),
    });
    if (isNumericKind(def.kind) && row.unit === null) unclear.push({ field: row.field, code: "unit_unknown" });
  }
  const names = new Set(fields.map((f) => f.field));
  for (const u of prev?.unclear ?? []) {
    if (u.code !== "unit_unknown" && names.has(u.field) && !unclear.some((x) => x.field === u.field && x.code === u.code)) unclear.push(u);
  }
  return {
    schemaVersion: 1,
    target,
    headerRow: block.headerRow,
    headerRows: block.headerRows === 2 ? 2 : 1,
    match: { headerKey: block.headerKey, headers: normalizeHeaders(block.headers) },
    fields,
    filters: prev?.filters ?? [],
    keys: (prev?.keys ?? TARGETS[target].keys).filter((k) => TARGETS[target].fields.some((f) => f.name === k)),
    onExisting: prev?.onExisting ?? "ask",
    unclear,
  };
}

/** The engine's own check of a person-made recipe against the block. Empty means it can be saved. */
export function checkRecipe(recipe: Recipe, block: Pick<BlockForMapping, "headers">): RecipeError[] {
  return validateRecipe(recipe, { headers: [...block.headers], columnCount: block.headers.length }, "person");
}
