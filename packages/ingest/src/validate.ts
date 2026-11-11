/**
 * `validateRecipe(recipe, block, origin)` (plan B2): the bounds the SDK strips from the schema, the column checks, the
 * catalogue checks and, for a recipe made by the bot, the no-constant-on-a-number rule. Returns codes, never throws.
 */
import { unitFromHeaderText } from "./builtins/instantiate";
import { RECIPE_LIMITS, type BlockShape, type Recipe, type RecipeField, type UnitKind } from "./recipe";
import { TARGETS } from "./targets";
import { parseUnitToken, unitsFor, type UnitId } from "./units-adapter";
import { resolveUnit } from "./transforms";

export const RECIPE_ERROR_CODES = [
  "no_cols",
  "too_many_cols",
  "too_many_steps",
  "too_many_pick_pairs",
  "too_many_filters",
  "too_many_filter_values",
  "too_many_keys",
  "too_many_unclear",
  "bad_header_row",
  "bad_header_rows",
  "col_out_of_range",
  "header_mismatch",
  "unknown_field",
  "duplicate_field",
  "missing_required",
  "pick_not_in_enum",
  "kind_mismatch",
  "unit_not_for_kind",
  "resolver_mismatch",
  "constant_on_numeric",
  "period_not_date",
  "on_existing_not_ask",
  "unit_not_shown",
  "unit_header_mismatch",
  "constant_not_allowed",
] as const;
export type RecipeErrorCode = (typeof RECIPE_ERROR_CODES)[number];

export type RecipeError = { code: RecipeErrorCode; path: string; field?: string };
export type RecipeOrigin = "bot" | "person" | "builtin";

export type ValidateOptions = {
  /** The person's note sent with the file. A unit it names counts as shown for a bot recipe. */
  note?: string | null;
};

/** Does the note name this unit? Looks at every run of one to four words. */
function noteNamesUnit(note: string, kind: UnitKind, unit: UnitId): boolean {
  const words = note.split(/[\s,;:()[\]]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 4 && i + n <= words.length; n++) {
      if (parseUnitToken(kind, words.slice(i, i + n).join(" ")) === unit) return true;
    }
  }
  return false;
}

/**
 * Where a bot's number step names a unit, does the file show it? `mismatch` when a source column's header names a
 * different unit, `not_shown` when no header and no note names it, `null` when it is shown. Counts are not checked.
 */
export function botUnitProblem(
  f: RecipeField,
  step: { kind: UnitKind; unit: string | null },
  block: Pick<BlockShape, "headers">,
  note?: string | null,
): "mismatch" | "not_shown" | null {
  if (step.unit === null || step.kind === "count" || f.source.kind !== "columns") return null;
  const unit = resolveUnit(step.kind, step.unit);
  if (unit === null) return null; // unit_not_for_kind reports it
  const shown = f.source.cols.map((c) => unitFromHeaderText(block.headers[c.col] ?? c.header, step.kind));
  if (shown.some((u) => u !== null && u !== unit)) return "mismatch";
  if (shown.some((u) => u === unit)) return null;
  if (note && noteNamesUnit(note, step.kind, unit)) return null;
  return "not_shown";
}

/**
 * A bot recipe with every unit the file does not show set to null, and `unit_unknown` added for those fields, so
 * the person is asked. For the last bot attempt, when a retry would not help.
 */
export function nullUnshownUnits(recipe: Recipe, block: Pick<BlockShape, "headers">, note?: string | null): Recipe {
  const unclear = [...recipe.unclear];
  const fields = recipe.fields.map((f) => {
    let changed = false;
    const steps = f.steps.map((s) => {
      if (s.op !== "number" || botUnitProblem(f, s, block, note) === null) return s;
      changed = true;
      return { ...s, unit: null };
    });
    if (changed && !unclear.some((u) => u.field === f.field && u.code === "unit_unknown")) unclear.push({ field: f.field, code: "unit_unknown" });
    return changed ? { ...f, steps } : f;
  });
  return { ...recipe, fields, unclear };
}

export function validateRecipe(
  recipe: Recipe,
  block: Pick<BlockShape, "headers" | "columnCount">,
  origin: RecipeOrigin,
  opts: ValidateOptions = {},
): RecipeError[] {
  const errors: RecipeError[] = [];
  const err = (code: RecipeErrorCode, path: string, field?: string) => errors.push(field === undefined ? { code, path } : { code, path, field });
  const target = TARGETS[recipe.target];

  if (recipe.headerRows !== 1 && recipe.headerRows !== 2) err("bad_header_rows", "headerRows");
  // A file that disagrees with a live record is shown and asked (owner rule). The model may not pick skip or
  // fill_blanks, which would hide the disagreement in every later file of this shape.
  if (origin === "bot" && recipe.onExisting !== "ask") err("on_existing_not_ask", "onExisting");
  if (recipe.headerRow < 0) err("bad_header_row", "headerRow");

  const colRef = (c: { col: number; header: string }, path: string) => {
    if (c.col < 0 || c.col >= block.columnCount) {
      err("col_out_of_range", path);
      return;
    }
    if (block.headers[c.col] !== c.header) err("header_mismatch", path);
  };

  const seen = new Set<string>();
  recipe.fields.forEach((f, i) => {
    const path = `fields[${i}]`;
    const def = target.fields.find((d) => d.name === f.field);
    if (!def) err("unknown_field", path, f.field);
    if (seen.has(f.field)) err("duplicate_field", path, f.field);
    seen.add(f.field);

    if (f.source.kind === "columns") {
      if (f.source.cols.length === 0) err("no_cols", `${path}.source`, f.field);
      if (f.source.cols.length > RECIPE_LIMITS.colsPerSource) err("too_many_cols", `${path}.source`, f.field);
      f.source.cols.forEach((c, j) => colRef(c, `${path}.source.cols[${j}]`));
    } else if (f.source.kind === "period_as_of") {
      // The as-of date is an ISO date: it may only fill a date field, whoever wrote the recipe.
      if (def && def.kind !== "date") err("period_not_date", `${path}.source`, f.field);
    } else if (f.source.kind === "constant" && origin === "bot" && def && !["text", "enum", "date"].includes(def.kind)) {
      err("constant_on_numeric", `${path}.source`, f.field);
    } else if (f.source.kind === "constant" && origin === "bot" && def && (def.kind === "date" || def.resolver !== null)) {
      // A constant date or name lands on every row of every later file of this shape. Dates use period_as_of (C23).
      err("constant_not_allowed", `${path}.source`, f.field);
    }

    if (f.steps.length > RECIPE_LIMITS.steps) err("too_many_steps", `${path}.steps`, f.field);
    f.steps.forEach((s, j) => {
      const sp = `${path}.steps[${j}]`;
      if (s.op === "pick") {
        if (s.map.length > RECIPE_LIMITS.pickPairs) err("too_many_pick_pairs", sp, f.field);
        if (def && (def.enum === null || s.map.some((p) => !def.enum!.includes(p.to)))) err("pick_not_in_enum", sp, f.field);
      } else if (s.op === "number") {
        if (def && def.kind !== s.kind) err("kind_mismatch", sp, f.field);
        if (s.unit !== null && resolveUnit(s.kind, s.unit) === null && !unitsFor(s.kind).some((u) => u === s.unit)) err("unit_not_for_kind", sp, f.field);
        if (origin === "bot") {
          // Never guess a unit: the bot names one only when the header or the person's note shows it.
          const problem = botUnitProblem(f, s, block, opts.note);
          if (problem === "mismatch") err("unit_header_mismatch", sp, f.field);
          else if (problem === "not_shown") err("unit_not_shown", sp, f.field);
        }
      } else if (s.op === "date") {
        if (def && def.kind !== "date") err("kind_mismatch", sp, f.field);
      } else if (s.op === "lookup") {
        if (def && def.resolver !== s.resolver) err("resolver_mismatch", sp, f.field);
      }
    });
    // A numeric or date field with no step that reads it would store raw text where a number belongs.
    if (def && def.kind !== "text" && def.kind !== "enum") {
      const want = def.kind === "date" ? "date" : "number";
      if (f.source.kind !== "period_as_of" && !f.steps.some((s) => s.op === want)) err("kind_mismatch", `${path}.steps`, f.field);
    }
  });

  for (const d of target.fields) {
    if (d.required && !seen.has(d.name)) err("missing_required", "fields", d.name);
  }

  if (recipe.filters.length > RECIPE_LIMITS.filters) err("too_many_filters", "filters");
  recipe.filters.forEach((f, i) => {
    if (f.values.length > RECIPE_LIMITS.filterValues) err("too_many_filter_values", `filters[${i}]`);
    colRef(f.col, `filters[${i}].col`);
  });

  if (recipe.keys.length > RECIPE_LIMITS.keys) err("too_many_keys", "keys");
  recipe.keys.forEach((k, i) => {
    if (!target.fields.some((d) => d.name === k)) err("unknown_field", `keys[${i}]`, k);
  });
  if (recipe.unclear.length > RECIPE_LIMITS.unclear) err("too_many_unclear", "unclear");
  return errors;
}
