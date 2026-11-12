import {
  INGEST_TARGETS,
  parseDate,
  readNumber,
  TARGETS,
  type DateFormat,
  type IngestTarget,
  type Recipe,
  type UnitKind,
} from "@orrn/ingest";

import { TARGET_KEY, unitLabelKey, type UnitChoice, type Words } from "./model";
import type { PlantUnits } from "./plant-units";
import { enumValueKey } from "./row-values";
import {
  buildRecipe,
  checkRecipe,
  fieldLabelKey,
  isNumericKind,
  mappingProblems,
  targetFields,
  unitGuess,
  type BlockForMapping,
  type MappingRow,
} from "./recipe-builder";
import { unitsFor } from "@orrn/ingest";
import type { CandidateDetail } from "./types";

/**
 * The mapping editor's model (work order 3.4, M9). The editor lists every column of the file, in file order, with
 * what it holds, a sample, what it goes into, its unit and what orrn would store for the first sample. The state is
 * one entry per file column (`ColumnMap`); `toMappingRows` turns it into the field-first rows `buildRecipe` takes, so
 * the recipe code is the same as before. Nothing here writes: the screen calls `actions.saveShape`.
 */

/** One entry per column of the file, by index. `field` null is "Not used". */
export type ColumnMap = { field: string | null; unit: string | null; dateFormat: DateFormat }[];

/** A rate cell: the header reads as a rate (the same rule the server uses to blank those cells for a person without `order.price`). */
const RATE_HEADER = /\b(rate|rates|price|prices)\b|\brs\.?\s*(\/|per)\s*(kg|kgs|t|ton|tonne|qtl)\b|₹/i;

export const SAMPLE_COUNT = 3;
export const SAMPLE_CUT = 32;

export type SampleView = {
  /** The first three non-blank values, each cut at 32 characters. Empty when masked. */
  values: string[];
  /** The column is a rate and the person may not see rates: show `ingest.rate.hidden` and no values. */
  masked: boolean;
  /** Numbers are set in mono, comma separated. */
  mono: boolean;
};

const cut = (text: string): string => (text.length > SAMPLE_CUT ? `${text.slice(0, SAMPLE_CUT - 3)}...` : text);

/** The kind words of a column from the server's cell kind. */
export function kindWords(kind: CandidateDetail["block"]["kinds"][number] | undefined): { key: string; numeric: boolean } {
  switch (kind) {
    case "int":
    case "decimal":
      return { key: "ingest.kind.number", numeric: true };
    case "date":
      return { key: "ingest.kind.date", numeric: false };
    case "empty":
      return { key: "ingest.kind.empty", numeric: false };
    default:
      return { key: "ingest.kind.text", numeric: false };
  }
}

/** Is this column a rate for a person who may not see rates? By its header, or by the field it is mapped to. */
export function isRateColumn(header: string, field: string | null, target: IngestTarget | null): boolean {
  if (RATE_HEADER.test(header)) return true;
  if (!field || !target) return false;
  const def = TARGETS[target].fields.find((f) => f.name === field);
  return def?.kind === "price_per_mass";
}

/** Sample values of one column: the first three non-blank, cut, and masked when it is a rate the person may not see. */
export function sampleValues(
  block: Pick<CandidateDetail["block"], "sample" | "kinds">,
  col: number,
  masked: boolean,
): SampleView {
  const mono = block.kinds[col] === "int" || block.kinds[col] === "decimal" || block.kinds[col] === "code";
  if (masked) return { values: [], masked: true, mono };
  const values: string[] = [];
  for (const row of block.sample) {
    const v = (row[col] ?? "").trim();
    if (v === "") continue;
    values.push(cut(v));
    if (values.length === SAMPLE_COUNT) break;
  }
  return { values, masked: false, mono };
}

/** The first non-blank sample value of a column, uncut, for the preview. */
export function firstSample(block: Pick<CandidateDetail["block"], "sample">, col: number): string | null {
  for (const row of block.sample) {
    const v = (row[col] ?? "").trim();
    if (v !== "") return v;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

const blank = (): ColumnMap[number] => ({ field: null, unit: null, dateFormat: "dmy" });

/** A map with every column "Not used". */
export function emptyColumnMap(block: Pick<BlockForMapping, "headers">): ColumnMap {
  return block.headers.map(blank);
}

/** The columns a recipe uses (for a layout orrn or a person made, or a near fit), else nothing used. */
export function initialColumnMap(block: BlockForMapping, target: IngestTarget | null, recipe: Recipe | null): ColumnMap {
  const map = emptyColumnMap(block);
  if (!target || !recipe || recipe.target !== target) return map;
  for (const field of recipe.fields) {
    const source = field.source.kind === "columns" ? field.source.cols[0] : undefined;
    if (!source || source.col < 0 || source.col >= map.length) continue;
    const number = field.steps.find((s) => s.op === "number");
    const date = field.steps.find((s) => s.op === "date");
    map[source.col] = {
      field: field.field,
      unit: number && number.op === "number" ? number.unit : null,
      dateFormat: date && date.op === "date" ? date.format : "dmy",
    };
  }
  return map;
}

/**
 * Puts a field on a column. A field sits on one column: picking one that another column has moves it here and
 * leaves that column "Not used". The unit starts again, read from the header (`Weight (kg)`) or left to be asked.
 */
export function assignField(map: ColumnMap, col: number, field: string | null, target: IngestTarget, block: Pick<BlockForMapping, "headers">): ColumnMap {
  return map.map((entry, i) => {
    if (i === col) return field === null ? blank() : { field, unit: unitGuess(target, field, block.headers[i]), dateFormat: "dmy" as const };
    return field !== null && entry.field === field ? blank() : entry;
  });
}

export function setColumnUnit(map: ColumnMap, col: number, unit: string | null): ColumnMap {
  return map.map((entry, i) => (i === col ? { ...entry, unit } : entry));
}

export function setColumnDateFormat(map: ColumnMap, col: number, dateFormat: DateFormat): ColumnMap {
  return map.map((entry, i) => (i === col ? { ...entry, dateFormat } : entry));
}

/** The field-first rows `buildRecipe` takes. Unused columns are left out. */
export function toMappingRows(map: ColumnMap): MappingRow[] {
  const rows: MappingRow[] = [];
  map.forEach((entry, col) => {
    if (entry.field !== null) rows.push({ id: col + 1, field: entry.field, column: col, unit: entry.unit, dateFormat: entry.dateFormat });
  });
  return rows;
}

/** The recipe for this map. */
export function recipeFromMap(block: BlockForMapping, target: IngestTarget, map: ColumnMap, previous: Recipe | null): Recipe {
  return buildRecipe(block, target, toMappingRows(map), previous);
}

// ---------------------------------------------------------------------------------------------
// The target select and the layout name
// ---------------------------------------------------------------------------------------------

export type TargetChoice = { value: IngestTarget | ""; words: Words };

/**
 * The "What is this table?" select. It starts at "Choose" and is preselected only when the fit or orrn (the bot)
 * gave a target. `suggestedByOrrn` is true when the bot made the layout: the screen says "Suggested by orrn".
 */
export function targetSelect(candidate: Pick<CandidateDetail, "target" | "fit" | "holeName">): {
  value: IngestTarget | "";
  choices: TargetChoice[];
  suggestedByOrrn: boolean;
} {
  return {
    value: candidate.target ?? "",
    choices: [
      { value: "", words: { key: "ingest.shape.choose" } },
      ...INGEST_TARGETS.map((t) => ({ value: t, words: { key: TARGET_KEY(t) } })),
    ],
    suggestedByOrrn: candidate.target !== null && candidate.fit === "bot",
  };
}

/** The layout name starts empty, with an example as its placeholder. It is the person's name for the layout. */
export function initialLayoutName(candidate: Pick<CandidateDetail, "fit" | "holeName">): string {
  // A layout the person already named keeps its name when they open it again. Nothing else is a default.
  return candidate.fit === "manual" && candidate.holeName ? candidate.holeName : "";
}

// ---------------------------------------------------------------------------------------------
// The table, one entry per file column
// ---------------------------------------------------------------------------------------------

export type FieldOption = {
  /** "" for Not used. */
  value: string;
  words: Words;
  required: boolean;
  /** The file column that already has this field, when it is not this one. */
  usedBy: number | null;
};

export type Preview =
  | { kind: "willNotImport" }
  | { kind: "hidden" }
  | { kind: "ask" }
  /** `textKey` is an enum value's words (`ingest.enumValue.active`): say it instead of `text`. */
  | { kind: "value"; text: string; unit: string; mono: boolean; textKey?: string }
  | { kind: "error"; words: Words };

export type ColumnEntry = {
  col: number;
  header: string;
  /** The header is blank: use `ingest.rows.column` with `n`. */
  headerBlank: boolean;
  n: number;
  kind: { key: string; numeric: boolean };
  samples: SampleView;
  field: string | null;
  options: FieldOption[];
  /** A unit select for a number field; a date order select for a date field; null for the rest. */
  unit:
    | { kind: "number"; value: string | null; choices: UnitChoice[]; askKey: string }
    | { kind: "date"; value: DateFormat; choices: { value: DateFormat; text: string }[] }
    | null;
  preview: Preview;
  /** A column that is not used reads quieter. */
  muted: boolean;
};

const DATE_CHOICES: { value: DateFormat; text: string }[] = [
  { value: "dmy", text: "dd/mm/yyyy" },
  { value: "mdy", text: "mm/dd/yyyy" },
  { value: "ymd", text: "yyyy/mm/dd" },
];

function unitChoicesFor(kind: UnitKind): UnitChoice[] {
  return unitsFor(kind).map((value) => ({ value, labelKey: unitLabelKey(value) }));
}

function previewFor(
  block: Pick<CandidateDetail["block"], "sample">,
  col: number,
  entry: ColumnMap[number],
  target: IngestTarget,
  masked: boolean,
  plant: PlantUnits,
): Preview {
  if (entry.field === null) return { kind: "willNotImport" };
  if (masked) return { kind: "hidden" };
  const def = TARGETS[target].fields.find((f) => f.name === entry.field);
  const sample = firstSample(block, col);
  if (!def || sample === null) return { kind: "willNotImport" };
  if (isNumericKind(def.kind)) {
    if (entry.unit === null) return { kind: "ask" };
    const unit = unitsFor(def.kind).find((u) => u === entry.unit) ?? null;
    if (unit === null) return { kind: "ask" };
    const read = readNumber(sample, def.kind, unit);
    if (!read.ok) return { kind: "error", words: { key: `ingest.refuse.${read.code}`, vars: { field: "" }, varKeys: { field: fieldLabelKey(def.name) } } };
    const q = plant.quantity(def.kind, read.value.canonical);
    return { kind: "value", text: q.text, unit: q.unit, mono: true };
  }
  if (def.kind === "date") {
    const iso = parseDate(sample, entry.dateFormat);
    if (iso === null) return { kind: "error", words: { key: "ingest.refuse.bad_date", vars: { field: "" }, varKeys: { field: fieldLabelKey(def.name) } } };
    return { kind: "value", text: plant.day(iso), unit: "", mono: false };
  }
  if (def.kind === "enum") {
    // What orrn stores is a code ("active"); the person reads its label ("Active"), never the code.
    const key = enumValueKey(sample.trim().toLowerCase().replace(/[\s-]+/g, "_"));
    if (key) return { kind: "value", text: "", unit: "", mono: false, textKey: key };
  }
  return { kind: "value", text: sample.length > SAMPLE_CUT ? cut(sample) : sample, unit: "", mono: false };
}

/**
 * The table of the editor: one entry per file column, in file order. `canSeePrices` is `can(me, "order.price")`; a
 * person without it sees no sample and no preview of a rate column.
 */
export function columnEntries(
  block: Pick<CandidateDetail["block"], "headers" | "kinds" | "sample">,
  target: IngestTarget | null,
  map: ColumnMap,
  plant: PlantUnits,
  canSeePrices: boolean,
): ColumnEntry[] {
  const fields = target ? targetFields(target) : [];
  return block.headers.map((header, col): ColumnEntry => {
    const entry = map[col] ?? blank();
    const meta = fields.find((f) => f.name === entry.field);
    const masked = !canSeePrices && isRateColumn(header, entry.field, target);
    const options: FieldOption[] = [
      { value: "", words: { key: "ingest.shape.notUsed" }, required: false, usedBy: null },
      ...fields.map((f): FieldOption => {
        const owner = map.findIndex((m, i) => i !== col && m.field === f.name);
        const label = fieldLabelKey(f.name);
        const words: Words = owner >= 0
          ? { key: "ingest.shape.usedBy", vars: { column: block.headers[owner]?.trim() || String(owner + 1) }, varKeys: { label } }
          : f.required
            ? { key: "ingest.shape.required", varKeys: { label } }
            : { key: label };
        return { value: f.name, words, required: f.required, usedBy: owner >= 0 ? owner : null };
      }),
    ];
    let unit: ColumnEntry["unit"] = null;
    if (meta?.unitKind) unit = { kind: "number", value: entry.unit, choices: unitChoicesFor(meta.unitKind), askKey: "ingest.shape.unitAsk" };
    else if (meta?.isDate) unit = { kind: "date", value: entry.dateFormat, choices: DATE_CHOICES };
    return {
      col,
      header: header.trim(),
      headerBlank: header.trim() === "",
      n: col + 1,
      kind: kindWords(block.kinds[col]),
      samples: sampleValues(block, col, masked),
      field: entry.field,
      options,
      unit,
      preview: target ? previewFor(block, col, entry, target, masked, plant) : { kind: "willNotImport" },
      muted: entry.field === null,
    };
  });
}

/** The live line under the target select: still needed in amber, or all mapped in green. Always on. */
export function mappingStatus(target: IngestTarget | null, map: ColumnMap): { state: "needed" | "done" | "choose"; words: Words } {
  if (!target) return { state: "choose", words: { key: "ingest.shape.targetRequired" } };
  const problems = mappingProblems(target, toMappingRows(map));
  if (problems.missingRequired.length > 0) {
    return { state: "needed", words: { key: "ingest.shape.missingRequired", varLists: { fields: problems.missingRequired.map(fieldLabelKey) } } };
  }
  return { state: "done", words: { key: "ingest.shape.allMapped" } };
}

// ---------------------------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------------------------

/** Where focus goes for a problem: the name, the target, or the select of a column. */
export type ProblemFocus = { kind: "name" } | { kind: "target" } | { kind: "column"; col: number };

export type SaveProblem = { id: string; words: Words; focus: ProblemFocus };

export type SaveCheck = {
  ok: boolean;
  /** One line over the list: "Fix 2 things before you save". Null when ok. */
  summary: Words | null;
  problems: SaveProblem[];
  /** A message per column for `aria-invalid` and `aria-describedby` under the select. */
  byColumn: Record<number, Words>;
  recipe: Recipe | null;
};

/**
 * Every reason a Save would fail, so it never returns without a word (3.3.1, 3.3.3): no target, no name, required
 * fields not mapped, one field on two columns, a recipe the engine would refuse. A failed Save shows the summary,
 * focuses it, and each item links to its select.
 */
export function saveCheck(input: {
  target: IngestTarget | null;
  name: string;
  map: ColumnMap;
  block: BlockForMapping;
  previous: Recipe | null;
}): SaveCheck {
  const { target, name, map, block, previous } = input;
  const problems: SaveProblem[] = [];
  const byColumn: Record<number, Words> = {};
  if (!target) {
    problems.push({ id: "target", words: { key: "ingest.shape.targetRequired" }, focus: { kind: "target" } });
    return finish(problems, byColumn, null);
  }
  if (name.trim() === "") problems.push({ id: "name", words: { key: "ingest.shape.nameRequired" }, focus: { kind: "name" } });
  const rows = toMappingRows(map);
  const found = mappingProblems(target, rows);
  if (found.missingRequired.length > 0) {
    const firstUnused = map.findIndex((m) => m.field === null);
    problems.push({
      id: "missing",
      words: { key: "ingest.shape.missingRequired", varLists: { fields: found.missingRequired.map(fieldLabelKey) } },
      focus: firstUnused >= 0 ? { kind: "column", col: firstUnused } : { kind: "target" },
    });
  }
  for (const field of found.duplicateFields) {
    const cols = map.flatMap((m, i) => (m.field === field ? [i] : []));
    const words: Words = { key: "ingest.shape.duplicate", vars: { field: "" }, varKeys: { field: fieldLabelKey(field) } };
    problems.push({ id: `duplicate:${field}`, words, focus: { kind: "column", col: cols[0] ?? 0 } });
    for (const col of cols) byColumn[col] = words;
  }
  if (problems.length > 0) return finish(problems, byColumn, null);
  const recipe = buildRecipe(block, target, rows, previous);
  const errors = checkRecipe(recipe, block);
  if (errors.length > 0) {
    const words: Words = { key: "ingest.shape.recipeInvalid" };
    const badFields = new Set(errors.map((e) => e.field).filter((f): f is string => Boolean(f)));
    const cols = map.flatMap((m, i) => (m.field !== null && badFields.has(m.field) ? [i] : []));
    for (const col of cols) byColumn[col] = words;
    problems.push({ id: "recipe", words, focus: cols.length > 0 ? { kind: "column", col: cols[0]! } : { kind: "target" } });
    return finish(problems, byColumn, null);
  }
  return finish(problems, byColumn, recipe);
}

function finish(problems: SaveProblem[], byColumn: Record<number, Words>, recipe: Recipe | null): SaveCheck {
  return {
    ok: problems.length === 0,
    summary: problems.length === 0 ? null : { key: "ingest.shape.fixCount", vars: { count: problems.length } },
    problems,
    byColumn,
    recipe,
  };
}

/** The "How orrn read this file" table: the same entries, read only, for the layout the candidate has now. */
export function readEntries(
  candidate: Pick<CandidateDetail, "target" | "recipe" | "block">,
  plant: PlantUnits,
  canSeePrices: boolean,
): { entries: ColumnEntry[]; used: number; unused: number } {
  const block: BlockForMapping = {
    headers: candidate.block.headers,
    headerKey: candidate.block.headerKey,
    headerRow: candidate.block.headerRow,
    headerRows: candidate.block.headerRows,
  };
  const map = initialColumnMap(block, candidate.target, candidate.recipe as Recipe | null);
  const entries = columnEntries(candidate.block, candidate.target, map, plant, canSeePrices);
  const used = entries.filter((e) => e.field !== null).length;
  return { entries, used, unused: entries.length - used };
}
