/**
 * `validateRecipe(recipe, block, origin)` (plan B2): the bounds the SDK strips from the schema, the column checks, the
 * catalogue checks and, for a recipe made by the bot, the no-constant-on-a-number rule. Returns codes, never throws.
 */
import { RECIPE_LIMITS, type BlockShape, type Recipe } from "./recipe";
import { TARGETS } from "./targets";
import { unitsFor } from "./units-adapter";
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
] as const;
export type RecipeErrorCode = (typeof RECIPE_ERROR_CODES)[number];

export type RecipeError = { code: RecipeErrorCode; path: string; field?: string };
export type RecipeOrigin = "bot" | "person" | "builtin";

export function validateRecipe(recipe: Recipe, block: Pick<BlockShape, "headers" | "columnCount">, origin: RecipeOrigin): RecipeError[] {
  const errors: RecipeError[] = [];
  const err = (code: RecipeErrorCode, path: string, field?: string) => errors.push(field === undefined ? { code, path } : { code, path, field });
  const target = TARGETS[recipe.target];

  if (recipe.headerRows !== 1 && recipe.headerRows !== 2) err("bad_header_rows", "headerRows");
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
    } else if (f.source.kind === "constant" && origin === "bot" && def && !["text", "enum", "date"].includes(def.kind)) {
      err("constant_on_numeric", `${path}.source`, f.field);
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
