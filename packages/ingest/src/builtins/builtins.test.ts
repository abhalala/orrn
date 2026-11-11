import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";

import { DIE_SHEET_HEADERS, EXAMPLE_DIE_RECIPE } from "../recipe-fixtures";
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
    expect(recipe.match.headers.slice(0, 4)).toEqual(["series", "section code", "min weight kg/12ft", "max weight kg/12ft"]);
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
    const a = analyzeBuiltin(builtinBundles, ["Die series", "Section code", "Pieces", "Weight Kg/12ft", "Length (mm)"]);
    expect(a.missingRequired).toEqual(["weightG"]);
  });

  test("the template sheets of the web parser map every required field", () => {
    expect(analyzeBuiltin(builtinBundles, ["Die series", "Section code", "Pieces", "Weight (kg)", "Length (ft)", "PO number"]).missingRequired).toEqual([]);
    expect(analyzeBuiltin(builtinCustomers, ["Name", "Phone", "Email", "GSTIN", "Notes"]).missingRequired).toEqual([]);
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
