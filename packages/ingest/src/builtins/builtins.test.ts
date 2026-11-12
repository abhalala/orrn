import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { DIE_SHEET_HEADERS, EXAMPLE_DIE_RECIPE } from "../recipe-fixtures";
import { applyRecipe } from "../apply";
import { fingerprint } from "../fingerprint";
import { fitBuiltin } from "../fit";
import { recipeSchema } from "../recipe";
import { analyzeBuiltin, builtinBundles, builtinCustomers, builtinDies, instantiate, IMPORT_FIELDS, readHeader, unitFromHeaderText } from "./index";

describe("instantiate", () => {
  test("the die hole on the template headers gives the plan B2 example 1 recipe", () => {
    const recipe = instantiate(builtinDies, DIE_SHEET_HEADERS);
    expect(recipe).toEqual(EXAMPLE_DIE_RECIPE);
    expect(recipeSchema.safeParse(recipe).success).toBe(true);
  });

  test("headerKey is the hex sha256 of v1| and the normalized headers joined by U+001F", () => {
    const recipe = instantiate(builtinDies, DIE_SHEET_HEADERS);
    const want = createHash("sha256").update(`v1|${recipe.match.headers.join("\u001f")}`).digest("hex");
    expect(recipe.match.headerKey).toBe(want);
    // Round 7, rule 6.2: "/" between two words is a separator. This pinned "kg/12ft"; it now pins "kg 12ft".
    expect(recipe.match.headers.slice(0, 4)).toEqual(["series", "section code", "min weight kg 12ft", "max weight kg 12ft"]);
  });

  test("a numeric header with no unit leaves unit null and flags unit_unknown", () => {
    const a = analyzeBuiltin(builtinDies, ["Series", "Section", "Min weight", "Max weight (kg/12ft)"]);
    expect(a.unitless).toEqual(["weightMinG"]);
    expect(a.recipe.unclear).toContainEqual({ field: "weightMinG", code: "unit_unknown" });
    const f = a.recipe.fields.find((x) => x.field === "weightMinG")!;
    expect(f.steps).toEqual([{ op: "number", kind: "linear_mass", unit: null }]);
  });

  test("units from headers", () => {
    expect(unitFromHeaderText("Weight (kg)", "mass")).toBe("kg");
    expect(unitFromHeaderText("Weight (g)", "mass")).toBe("g");
    expect(unitFromHeaderText("Weight in kg", "mass")).toBe("kg");
    expect(unitFromHeaderText("Length (ft)", "length")).toBe("ft");
    expect(unitFromHeaderText("Length (mm)", "length")).toBe("mm");
    expect(unitFromHeaderText("Min weight (kg)", "linear_mass")).toBe("kg/12ft");
    expect(unitFromHeaderText("Wt kg per 12 ft", "linear_mass")).toBe("kg/12ft");
    expect(unitFromHeaderText("Weight (kg/m)", "linear_mass")).toBe("kg/m");
    expect(unitFromHeaderText("Length", "length")).toBeNull();
    expect(unitFromHeaderText("Length (approx)", "length")).toBeNull();
    expect(unitFromHeaderText("Pieces", "count")).toBe("pcs");
  });

  test("a per-12-ft header is never the weight of a bundle", () => {
    const a = analyzeBuiltin(builtinBundles, ["Legacy id", "Die series", "Section code", "Pieces", "Weight Kg/12ft", "Length (mm)"]);
    expect(a.missingRequired).toEqual(["weightG"]);
  });

  test("the template sheets of the web parser map every required field", () => {
    // The bundle template needs its legacy id column (C1): it is the only key that finds a bundle already in orrn.
    expect(analyzeBuiltin(builtinBundles, ["Legacy id", "Die series", "Section code", "Pieces", "Weight (kg)", "Length (ft)", "PO number"]).missingRequired).toEqual([]);
    expect(analyzeBuiltin(builtinCustomers, ["Name", "Phone", "Email", "GSTIN", "Notes"]).missingRequired).toEqual([]);
  });

  // Round 7, rule 6.4 (M-R6-1): the legacy id column is optional in the layout, so the web's own bundle template
  // fits. This test pinned "misses a required field and does not fit"; it now pins the exact fit. The row-level
  // guard of C1 stays in the target: the next test still refuses a row with no legacy id.
  test("C1, rule 6.4: a bundle sheet with no legacy id column fits the layout exactly", () => {
    const headers = ["Die series", "Section code", "Pieces", "Weight (kg)", "Length (ft)", "PO number"];
    expect(analyzeBuiltin(builtinBundles, headers).missingRequired).toEqual([]);
    expect(fitBuiltin(fingerprint({ headers, rows: [["R", "2105", "4", "12.5", "12", ""]] }), builtinBundles)?.fit).toBe("exact");
  });

  test("C1, changed by rule 7.5: a bundle row with a blank legacy id is read; the server asks once before importing it", () => {
    const headers = ["Legacy id", "Die series", "Section code", "Pieces", "Weight (kg)", "Length (ft)"];
    const recipe = instantiate(builtinBundles, headers);
    const [blank, filled] = applyRecipe(recipe, [
      ["", "R", "2105", "4", "12.5", "12"],
      ["ck1", "R", "2105", "4", "12.5", "12"],
    ]);
    // The bundles_no_old_id question (server dry run) stands between this row and a second copy.
    expect(blank!.state).toBe("ok");
    expect(blank!.refusals).toEqual([]);
    expect(filled!.state).toBe("ok");
  });

  test("two columns for one field: the first is used and the field is flagged", () => {
    const a = analyzeBuiltin(builtinCustomers, ["Name", "Notes", "Remarks"]);
    expect(a.ambiguousFields).toEqual(["notes"]);
    expect(a.recipe.unclear).toContainEqual({ field: "notes", code: "column_meaning_unclear" });
  });
});

describe("parity data with the web parser", () => {
  test("readHeader reads names and units the way the old parser does", () => {
    expect(readHeader("Length (mm)")).toEqual({ name: "length", unit: "mm" });
    expect(readHeader("weightG")).toEqual({ name: "weight", unit: "g" });
    expect(readHeader("Weight Kg/12ft")).toEqual({ name: "weight", unit: "kg" });
    expect(readHeader("Length (approx)")).toEqual({ name: "length", unit: null, unknownUnit: "approx" });
  });
  test("IMPORT_FIELDS has the three kinds", () => {
    expect(Object.keys(IMPORT_FIELDS)).toEqual(["bundles", "dies", "customers"]);
  });
});
