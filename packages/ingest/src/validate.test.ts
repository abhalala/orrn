import { describe, expect, test } from "bun:test";

import { fingerprint } from "./fingerprint";
import { nullUnshownUnits, RECIPE_ERROR_CODES, validateRecipe, type RecipeErrorCode } from "./validate";
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
    on_existing_not_ask: () => {
      const r = clone(EXAMPLE_DIE_RECIPE);
      r.onExisting = "skip";
      return { recipe: r, origin: "bot" };
    },
    unit_not_shown: () => {
      const r = clone(EXAMPLE_DIE_RECIPE);
      r.fields[2]!.source = { kind: "columns", cols: [{ col: 4, header: "Name" }] };
      return { recipe: r, origin: "bot" };
    },
    unit_header_mismatch: () => {
      const r = clone(EXAMPLE_DIE_RECIPE);
      r.fields[2]!.steps = [{ op: "number", kind: "linear_mass", unit: "g/12ft" }];
      return { recipe: r, origin: "bot" };
    },
    constant_not_allowed: () => {
      const r = clone(EXAMPLE_BAKI_RECIPE);
      r.fields.find((f) => f.field === "orderDate")!.source = { kind: "constant", value: "2025-04-01" };
      return { recipe: r, origin: "bot" };
    },
    split_on_number: () => {
      const r = clone(EXAMPLE_DIE_RECIPE);
      r.fields[2]!.steps = [{ op: "split", sep: ",", index: 0 }, { op: "number", kind: "linear_mass", unit: "kg/12ft" }];
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

  test("C3: a bot recipe must ask about live records; a person or a built-in may choose", () => {
    for (const mode of ["skip", "fill_blanks"] as const) {
      const r = clone(EXAMPLE_DIE_RECIPE);
      r.onExisting = mode;
      expect(codes(r, "bot")).toContain("on_existing_not_ask");
      expect(codes(r, "person")).not.toContain("on_existing_not_ask");
      expect(codes(r, "builtin")).not.toContain("on_existing_not_ask");
    }
    expect(codes(clone(EXAMPLE_DIE_RECIPE), "bot")).not.toContain("on_existing_not_ask");
  });

  describe("C4, C20: a unit the bot names must show in the header or the note", () => {
    const block = (wt: string) => fingerprint({ headers: ["Series", "Section", wt], rows: [] });
    const recipe = (wt: string, unit: string | null): Recipe => ({
      schemaVersion: 1,
      target: "bundles",
      headerRow: 0,
      headerRows: 1,
      match: { headerKey: "", headers: [] },
      fields: [{ field: "weightG", source: { kind: "columns", cols: [{ col: 2, header: wt }] }, steps: [{ op: "number", kind: "mass", unit }] }],
      filters: [],
      keys: [],
      onExisting: "ask",
      unclear: [],
    });
    const unitCodes = (wt: string, unit: string | null, origin: "bot" | "person" = "bot", note?: string) =>
      validateRecipe(recipe(wt, unit), block(wt), origin, note === undefined ? {} : { note })
        .map((e) => e.code)
        .filter((c) => c === "unit_not_shown" || c === "unit_header_mismatch");

    test("'Wt' with kg is a guess", () => expect(unitCodes("Wt", "kg")).toEqual(["unit_not_shown"]));
    test("'Wt (kg)' with kg is shown", () => expect(unitCodes("Wt (kg)", "kg")).toEqual([]));
    test("'Wt (kg)' with g contradicts the header", () => expect(unitCodes("Wt (kg)", "g")).toEqual(["unit_header_mismatch"]));
    test("'Wt' with tonnes named in the person's note is shown", () => expect(unitCodes("Wt", "t", "bot", "weights are in tonnes")).toEqual([]));
    test("a note naming another unit does not help", () => expect(unitCodes("Wt", "t", "bot", "weights in kg")).toEqual(["unit_not_shown"]));
    test("unit null is the question, never an error", () => expect(unitCodes("Wt", null)).toEqual([]));
    test("a person may name a unit the header does not show", () => expect(unitCodes("Wt", "kg", "person")).toEqual([]));

    test("nullUnshownUnits turns a guessed unit into the unit question", () => {
      const out = nullUnshownUnits(recipe("Wt", "kg"), block("Wt"));
      expect(out.fields[0]!.steps).toEqual([{ op: "number", kind: "mass", unit: null }]);
      expect(out.unclear).toContainEqual({ field: "weightG", code: "unit_unknown" });
      const kept = nullUnshownUnits(recipe("Wt (kg)", "kg"), block("Wt (kg)"));
      expect(kept.fields[0]!.steps).toEqual([{ op: "number", kind: "mass", unit: "kg" }]);
    });
  });

  test("C23: the bot may not put a constant on a date or a looked-up name", () => {
    const date = cases.constant_not_allowed().recipe;
    expect(validateRecipe(date, bakiBlock, "bot").map((e) => e.code)).toContain("constant_not_allowed");
    expect(validateRecipe(date, bakiBlock, "person").map((e) => e.code)).not.toContain("constant_not_allowed");
    const name = clone(EXAMPLE_BAKI_RECIPE);
    name.fields.find((f) => f.field === "customer")!.source = { kind: "constant", value: "ACME EXTRUSIONS" };
    expect(validateRecipe(name, bakiBlock, "bot").map((e) => e.code)).toContain("constant_not_allowed");
  });

  test("C24: a comma split before a number is refused; a dash split is not", () => {
    expect(codes(cases.split_on_number().recipe)).toContain("split_on_number");
    const dash = clone(EXAMPLE_DIE_RECIPE);
    dash.fields[2]!.steps = [{ op: "split", sep: "-", index: 0 }, { op: "number", kind: "linear_mass", unit: "kg/12ft" }];
    expect(codes(dash)).not.toContain("split_on_number");
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
