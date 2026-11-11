import { describe, expect, test } from "bun:test";

import { fingerprint } from "./fingerprint";
import { RECIPE_ERROR_CODES, validateRecipe, type RecipeErrorCode } from "./validate";
import type { Recipe } from "./recipe";
import { BAKI_SHEET_HEADERS, DIE_SHEET_HEADERS, EXAMPLE_BAKI_RECIPE, EXAMPLE_DIE_RECIPE } from "./recipe-fixtures";

const dieBlock = fingerprint({ headers: DIE_SHEET_HEADERS, rows: [] });
const bakiBlock = fingerprint({ headers: BAKI_SHEET_HEADERS, rows: [] });

const clone = (r: Recipe) => structuredClone(r);
const codes = (r: Recipe, origin: "bot" | "person" | "builtin" = "person", block = dieBlock) => validateRecipe(r, block, origin).map((e) => e.code);

describe("validateRecipe", () => {
  test("both plan examples are clean", () => {
    expect(codes(EXAMPLE_DIE_RECIPE, "builtin")).toEqual([]);
    expect(codes(EXAMPLE_BAKI_RECIPE, "bot", bakiBlock)).toEqual([]);
  });

  // One mutation per error code. The test below checks every code in RECIPE_ERROR_CODES is covered.
  const cases: Record<RecipeErrorCode, () => { recipe: Recipe; origin?: "bot" | "person" }> = {
    no_cols: () => { const r = clone(EXAMPLE_DIE_RECIPE); r.fields[0]!.source = { kind: "columns", cols: [] }; return { recipe: r }; },
    too_many_cols: () => {
      const r = clone(EXAMPLE_DIE_RECIPE);
      r.fields[0]!.source = { kind: "columns", cols: [0, 1, 2, 3].map((c) => ({ col: c, header: DIE_SHEET_HEADERS[c]! })) };
      return { recipe: r };
    },
    too_many_steps: () => { const r = clone(EXAMPLE_DIE_RECIPE); r.fields[0]!.steps = Array(7).fill({ op: "trim" }); return { recipe: r }; },
    too_many_pick_pairs: () => {
      const r = clone(EXAMPLE_DIE_RECIPE);
      r.fields[8]!.steps = [{ op: "pick", map: Array.from({ length: 51 }, (_, i) => ({ from: `f${i}`, to: "active" })), otherwise: "refuse" }];
      return { recipe: r };
    },
    too_many_filters: () => {
      const r = clone(EXAMPLE_DIE_RECIPE);
      r.filters = Array(6).fill({ col: { col: 0, header: "Series" }, test: "not_blank", values: [], action: "keep" });
      return { recipe: r };
    },
    too_many_filter_values: () => {
      const r = clone(EXAMPLE_DIE_RECIPE);
      r.filters = [{ col: { col: 0, header: "Series" }, test: "in", values: Array(21).fill("x"), action: "drop" }];
      return { recipe: r };
    },
    too_many_keys: () => { const r = clone(EXAMPLE_DIE_RECIPE); r.keys = ["series", "sectionCode", "name", "notes"]; return { recipe: r }; },
    too_many_unclear: () => { const r = clone(EXAMPLE_DIE_RECIPE); r.unclear = Array(21).fill({ field: "name", code: "unit_unknown" }); return { recipe: r }; },
    bad_header_row: () => { const r = clone(EXAMPLE_DIE_RECIPE); r.headerRow = -1; return { recipe: r }; },
    bad_header_rows: () => { const r = clone(EXAMPLE_DIE_RECIPE); r.headerRows = 3; return { recipe: r }; },
    col_out_of_range: () => { const r = clone(EXAMPLE_DIE_RECIPE); r.fields[0]!.source = { kind: "columns", cols: [{ col: 10, header: "Series" }] }; return { recipe: r }; },
    header_mismatch: () => { const r = clone(EXAMPLE_DIE_RECIPE); r.fields[1]!.source = { kind: "columns", cols: [{ col: 2, header: "Section code" }] }; return { recipe: r }; },
    unknown_field: () => { const r = clone(EXAMPLE_DIE_RECIPE); r.fields[0]!.field = "colour"; return { recipe: r }; },
    duplicate_field: () => { const r = clone(EXAMPLE_DIE_RECIPE); r.fields.push(clone(EXAMPLE_DIE_RECIPE).fields[9]!); return { recipe: r }; },
    missing_required: () => { const r = clone(EXAMPLE_DIE_RECIPE); r.fields = r.fields.filter((f) => f.field !== "weightMaxG"); return { recipe: r }; },
    pick_not_in_enum: () => {
      const r = clone(EXAMPLE_DIE_RECIPE);
      r.fields[8]!.steps = [{ op: "pick", map: [{ from: "x", to: "deleted" }], otherwise: "refuse" }];
      return { recipe: r };
    },
    kind_mismatch: () => {
      const r = clone(EXAMPLE_DIE_RECIPE);
      r.fields[2]!.steps = [{ op: "number", kind: "mass", unit: "kg" }];
      return { recipe: r };
    },
    unit_not_for_kind: () => {
      const r = clone(EXAMPLE_DIE_RECIPE);
      r.fields[2]!.steps = [{ op: "number", kind: "linear_mass", unit: "mm" }];
      return { recipe: r };
    },
    resolver_mismatch: () => {
      const r = clone(EXAMPLE_DIE_RECIPE);
      r.fields[0]!.steps = [{ op: "lookup", resolver: "customer_by_name" }];
      return { recipe: r };
    },
    period_not_date: () => {
      const r = clone(EXAMPLE_DIE_RECIPE);
      r.fields[4]!.source = { kind: "period_as_of" };
      return { recipe: r };
    },
    constant_on_numeric: () => {
      const r = clone(EXAMPLE_DIE_RECIPE);
      r.fields[2]!.source = { kind: "constant", value: "2.2" };
      return { recipe: r, origin: "bot" };
    },
  };

  for (const code of RECIPE_ERROR_CODES) {
    test(`rejects ${code}`, () => {
      const { recipe, origin } = cases[code]();
      expect(codes(recipe, origin ?? "person")).toContain(code);
    });
  }

  test("a constant on a number is fine for a person, refused for the bot", () => {
    const { recipe } = cases.constant_on_numeric();
    expect(codes(recipe, "person")).not.toContain("constant_on_numeric");
    expect(codes(recipe, "bot")).toContain("constant_on_numeric");
  });

  test("C2, C9: the period as-of date may fill a date field only", () => {
    for (const field of ["rate", "orderedKg", "customer"]) {
      const r = clone(EXAMPLE_BAKI_RECIPE);
      const f = r.fields.find((x) => x.field === field)!;
      f.source = { kind: "period_as_of" };
      for (const origin of ["bot", "person", "builtin"] as const) expect(codes(r, origin, bakiBlock)).toContain("period_not_date");
    }
    const ok = clone(EXAMPLE_BAKI_RECIPE);
    ok.fields.find((x) => x.field === "orderDate")!.source = { kind: "period_as_of" };
    ok.fields.find((x) => x.field === "orderDate")!.steps = [];
    expect(codes(ok, "person", bakiBlock)).not.toContain("period_not_date");
  });

  test("a constant on text is fine for the bot", () => {
    const r = clone(EXAMPLE_DIE_RECIPE);
    r.fields[4]!.source = { kind: "constant", value: "Imported" };
    expect(codes(r, "bot")).toEqual([]);
  });

  test("an off-by-one column is caught by the header check", () => {
    const r = clone(EXAMPLE_DIE_RECIPE);
    r.fields[3]!.source = { kind: "columns", cols: [{ col: 4, header: "Max weight (kg/12ft)" }] };
    expect(codes(r)).toEqual(["header_mismatch"]);
  });

  test("header text must match the block's own spelling", () => {
    const r = clone(EXAMPLE_DIE_RECIPE);
    expect(validateRecipe(r, fingerprint({ headers: DIE_SHEET_HEADERS.map((h) => h.toUpperCase()), rows: [] }), "person").length).toBeGreaterThan(0);
  });
});
