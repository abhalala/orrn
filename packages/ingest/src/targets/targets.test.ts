import { describe, expect, test } from "bun:test";

import { applyRecipe } from "../apply";
import type { IngestTarget, Recipe, RecipeStep } from "../recipe";

// C37: one good row and one refused row per target check, through applyRecipe.

type Col = { field: string; steps: RecipeStep[] };
const trim: RecipeStep[] = [{ op: "trim" }];
const num = (kind: "mass" | "length" | "count" | "linear_mass", unit: string): RecipeStep[] => [{ op: "number", kind, unit }];

function recipe(target: IngestTarget, cols: Col[]): Recipe {
  return {
    schemaVersion: 1,
    target,
    headerRow: 0,
    headerRows: 1,
    match: { headerKey: "", headers: [] },
    fields: cols.map((c, i) => ({ field: c.field, source: { kind: "columns", cols: [{ col: i, header: c.field }] }, steps: c.steps })),
    filters: [],
    keys: [],
    onExisting: "ask",
    unclear: [],
  };
}
const one = (r: Recipe, row: string[]) => applyRecipe(r, [row])[0]!;

describe("customers", () => {
  const r = recipe("customers", [
    { field: "name", steps: trim },
    { field: "taxId", steps: [{ op: "trim" }, { op: "case", to: "upper" }] },
    { field: "email", steps: trim },
  ]);
  test("good row", () => expect(one(r, ["Om Metals", "24abcde1234f1z5", "a@b.in"]).state).toBe("ok"));
  test("a 14-character GSTIN is refused", () => expect(one(r, ["Om Metals", "24ABCDE1234F1Z", ""]).refusals).toEqual([{ field: "taxId", code: "bad_gstin" }]));
  test("a bad email is refused", () => expect(one(r, ["Om Metals", "", "not-an-email"]).refusals).toEqual([{ field: "email", code: "bad_email" }]));
});

describe("vendors", () => {
  const r = recipe("vendors", [{ field: "name", steps: trim }, { field: "aliases", steps: trim }]);
  test("good row", () => expect(one(r, ["Shree Scrap", "SS; Shree"]).state).toBe("ok"));
  test("more than 20 aliases is refused", () => {
    const many = Array.from({ length: 21 }, (_, i) => `a${i}`).join(";");
    expect(one(r, ["Shree Scrap", many]).refusals).toEqual([{ field: "aliases", code: "too_many_aliases" }]);
  });
});

describe("bundles", () => {
  const r = recipe("bundles", [
    { field: "legacyId", steps: trim },
    { field: "series", steps: trim },
    { field: "sectionCode", steps: trim },
    { field: "quantity", steps: num("count", "pcs") },
    { field: "weightG", steps: num("mass", "kg") },
    { field: "lengthMm", steps: num("length", "mm") },
  ]);
  test("good row", () => expect(one(r, ["ck1", "R", "2105", "40", "125", "3658"]).state).toBe("ok"));
  test("a bundle over 5,000 kg is refused", () => expect(one(r, ["ck1", "R", "2105", "40", "5001", "3658"]).refusals).toEqual([{ field: "weightG", code: "weight_range" }]));
  test("a length under 1 ft is refused", () => expect(one(r, ["ck1", "R", "2105", "40", "125", "200"]).refusals).toEqual([{ field: "lengthMm", code: "length_range" }]));
  test("zero pieces is refused", () => expect(one(r, ["ck1", "R", "2105", "0", "125", "3658"]).refusals).toEqual([{ field: "quantity", code: "not_positive" }]));
});

describe("die copies", () => {
  const r = recipe("die_copies", [
    { field: "series", steps: trim },
    { field: "sectionCode", steps: trim },
    { field: "tierRank", steps: num("count", "pcs") },
    { field: "status", steps: [{ op: "trim" }, { op: "case", to: "lower" }] },
  ]);
  test("good row", () => expect(one(r, ["R", "2105", "2", "in_use"]).state).toBe("ok"));
  test("a status outside the list is refused", () => expect(one(r, ["R", "2105", "2", "broken"]).refusals).toEqual([{ field: "status", code: "not_in_enum" }]));
  test("tier rank 100 is refused", () => expect(one(r, ["R", "2105", "100", "in_use"]).refusals).toEqual([{ field: "tierRank", code: "out_of_range" }]));
});

describe("aliases", () => {
  for (const [target, owner] of [["customer_aliases", "customer"], ["vendor_aliases", "vendor"]] as const) {
    const r = recipe(target, [{ field: owner, steps: trim }, { field: "alias", steps: trim }]);
    test(`${target}: good row`, () => expect(one(r, ["Om Metals", "OM"]).state).toBe("ok"));
    test(`${target}: a blank alias is refused`, () => expect(one(r, ["Om Metals", ""]).refusals).toEqual([{ field: "alias", code: "blank_required" }]));
    test(`${target}: an alias over 500 characters is refused`, () => expect(one(r, ["Om Metals", "x".repeat(501)]).refusals).toEqual([{ field: "alias", code: "too_long" }]));
  }
});
