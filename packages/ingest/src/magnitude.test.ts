import { describe, expect, test } from "bun:test";

import { applyRecipe } from "./apply";
import { builtinBundles, instantiate } from "./builtins";
import { EXAMPLE_BAKI_RECIPE, EXAMPLE_DIE_RECIPE } from "./recipe-fixtures";
import type { Recipe } from "./recipe";

const baki = (cells: Partial<Record<number, string>>, units: Record<string, string> = { rate: "inr/kg" }) => {
  const r = ["1", "Om Metals", "PO-12", "14/10/2025", "T 4012", "1.8", "5000", "1000", "4000", "210", ""];
  for (const [i, v] of Object.entries(cells)) r[Number(i)] = v!;
  return applyRecipe(EXAMPLE_BAKI_RECIPE, [r], { units: units as never, currentYear: 2026 })[0]!;
};

describe("C8: values past the registry's hard limit are refused", () => {
  test("a per-tonne rate answered as INR per kg (2,85,000) is out of range", () => {
    const r = baki({ 9: "2,85,000" });
    expect(r.state).toBe("refused");
    expect(r.refusals).toContainEqual({ field: "rate", code: "out_of_range" });
  });

  test("an order weight past 5,000 t is out of range", () => {
    const recipe: Recipe = structuredClone(EXAMPLE_BAKI_RECIPE);
    recipe.fields.find((f) => f.field === "bakiKg")!.steps = [{ op: "number", kind: "mass", unit: "t" }];
    const r = applyRecipe(recipe, [["1", "Om Metals", "PO-12", "14/10/2025", "T 4012", "1.8", "", "", "6000", "210", ""]], { units: { rate: "inr/kg" } })[0]!;
    expect(r.refusals).toContainEqual({ field: "bakiKg", code: "out_of_range" });
  });

  test("order pieces must be a positive whole number, tier rank 1 to 99", () => {
    const recipe: Recipe = structuredClone(EXAMPLE_BAKI_RECIPE);
    recipe.fields = recipe.fields.filter((f) => f.field !== "note");
    recipe.fields.push({ field: "pcs", source: { kind: "columns", cols: [{ col: 10, header: "Remarks" }] }, steps: [{ op: "number", kind: "count", unit: "pcs" }] });
    const r = applyRecipe(recipe, [["1", "Om Metals", "PO-12", "14/10/2025", "T 4012", "1.8", "5000", "1000", "4000", "210", "0"]], { units: { rate: "inr/kg" } })[0]!;
    expect(r.refusals).toContainEqual({ field: "pcs", code: "not_positive" });
  });
});

describe("C19: values outside the plausible range are flagged for a person, never changed", () => {
  test("a 3 t bundle is flagged; a 2 t bundle is not", () => {
    const recipe = instantiate(builtinBundles, ["Legacy id", "Series", "Section code", "Pieces", "Weight (t)", "Length (mm)"]);
    const [three, two] = applyRecipe(recipe, [
      ["ck1", "R", "2105", "40", "3", "3658"],
      ["ck2", "R", "2105", "40", "2", "3658"],
    ]);
    expect(three!.state).toBe("ok");
    expect(three!.values.weightG).toBe(3_000_000);
    expect(three!.flags).toEqual([{ field: "weightG", code: "magnitude", side: "above", likelyUnit: null, likelyValue: null }]);
    expect(two!.flags).toEqual([]);
  });

  test("5000 typed as INR per kg is flagged above the plausible rate", () => {
    const r = baki({ 9: "5000" });
    expect(r.state).toBe("ok");
    expect(r.values.rate).toBe(500_000);
    expect(r.flags.map((f) => [f.field, f.side])).toEqual([["rate", "above"]]);
  });

  test("a die band typed in the wrong unit is flagged", () => {
    const flagged = applyRecipe(EXAMPLE_DIE_RECIPE, [["40", "4012", "0.3", "2.5", "Frame", "", "", "", "active", ""]])[0]!;
    expect(flagged.state).toBe("ok");
    expect(flagged.values.weightMinG).toBe(300);
    expect(flagged.flags).toEqual([{ field: "weightMinG", code: "magnitude", side: "below", likelyUnit: null, likelyValue: null }]);
  });

  test("when exactly one other unit lands in range it is offered, in the recipe spelling", () => {
    const r = baki({ 9: "250" }, { rate: "paise/kg" });
    expect(r.values.rate).toBe(250);
    expect(r.flags).toEqual([{ field: "rate", code: "magnitude", side: "below", likelyUnit: "inr/kg", likelyValue: 25_000 }]);
  });

  test("a normal row has no flags", () => {
    expect(baki({}).flags).toEqual([]);
  });
});
