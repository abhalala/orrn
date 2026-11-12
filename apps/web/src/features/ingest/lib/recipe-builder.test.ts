import { describe, expect, test } from "bun:test";
import { INGEST_TARGETS, TARGETS, validateRecipe } from "@orrn/ingest";

import {
  addMapping, buildRecipe, changeColumn, changeField, checkRecipe, initialMappings, mappingProblems, targetFields, unitGuess,
  type BlockForMapping, type MappingRow,
} from "./recipe-builder";

const block = (headers: string[]): BlockForMapping => ({ headers, headerKey: "k".repeat(64), headerRow: 0, headerRows: 1 });
const row = (id: number, field: string, column: number | null, over: Partial<MappingRow> = {}): MappingRow => ({
  id, field, column, unit: null, dateFormat: "dmy", ...over,
});

describe("target field metadata", () => {
  test("every field of every target has a label key and numbers list their units", () => {
    for (const t of INGEST_TARGETS) {
      for (const f of targetFields(t)) {
        expect(f.labelKey).toBe(`ingest.field.${f.name}`);
        if (f.unitKind) expect(f.units.length).toBeGreaterThan(0);
        else expect(f.units).toEqual([]);
      }
    }
    const weight = targetFields("dies").find((f) => f.name === "weightMinG")!;
    expect(weight.unitKind).toBe("linear_mass");
    expect(weight.units).toContain("kg/12ft");
  });
});

describe("unit rule: a unit is read from the file or asked, never assumed", () => {
  test("the header can name the unit", () => {
    expect(unitGuess("dies", "weightMinG", "Min weight (kg/12ft)")).toBe("kg/12ft");
    expect(unitGuess("bundles", "weightG", "Weight (kg)")).toBe("kg");
    expect(unitGuess("bundles", "weightG", "Weight")).toBeNull();
    expect(unitGuess("customers", "name", "Name (kg)")).toBeNull();
  });
  test("a new row starts without a unit, and picking a column fills it only from the header", () => {
    const b = block(["Series", "Section code", "Weight"]);
    let rows = [row(1, "weightG", null)];
    expect(rows[0]!.unit).toBeNull();
    rows = changeColumn(rows, 1, 2, "bundles", b);
    expect(rows[0]!.unit).toBeNull();
    const withUnit = block(["Weight (kg)"]);
    expect(changeColumn([row(1, "weightG", null)], 1, 0, "bundles", withUnit)[0]!.unit).toBe("kg");
  });
  test("a unit the person chose is not overwritten by a later column change", () => {
    const b = block(["A (kg)", "B"]);
    const rows = changeColumn([row(1, "weightG", 0, { unit: "lb" })], 1, 1, "bundles", b);
    expect(rows[0]!.unit).toBe("lb");
  });
  test("changing the field resets the unit to what the column's header says", () => {
    const b = block(["Width (mm)"]);
    const rows = changeField([row(1, "weightG", 0, { unit: "kg" })], 1, "widthMm", "dies", b);
    expect(rows[0]!.unit).toBe("mm");
  });
});

describe("buildRecipe", () => {
  const dieBlock = block(["Series", "Section code", "Min weight (kg/12ft)", "Max weight", "Name", "Status"]);

  test("a die sheet maps and passes the engine's validateRecipe", () => {
    const rows = [
      row(1, "series", 0), row(2, "sectionCode", 1), row(3, "weightMinG", 2, { unit: "kg/12ft" }),
      row(4, "weightMaxG", 3, { unit: "kg/12ft" }), row(5, "name", 4), row(6, "status", 5),
    ];
    const recipe = buildRecipe(dieBlock, "dies", rows, null);
    expect(checkRecipe(recipe, dieBlock)).toEqual([]);
    expect(validateRecipe(recipe, { headers: [...dieBlock.headers], columnCount: 6 }, "person")).toEqual([]);
    const min = recipe.fields.find((f) => f.field === "weightMinG")!;
    expect(min.steps).toEqual([{ op: "number", kind: "linear_mass", unit: "kg/12ft" }]);
    expect(recipe.unclear).toEqual([]);
    // an enum field is trimmed, lower-cased and picked from the allowed values, anything else refused
    const status = recipe.fields.find((f) => f.field === "status")!;
    expect(status.steps.map((s) => s.op)).toEqual(["trim", "case", "pick"]);
    expect(status.steps[2]).toMatchObject({ op: "pick", otherwise: "refuse" });
  });

  test("a number with no chosen unit has unit null and is flagged to be asked, and still validates", () => {
    const rows = [row(1, "series", 0), row(2, "sectionCode", 1), row(3, "weightMinG", 2), row(4, "weightMaxG", 3, { unit: "kg/12ft" })];
    const recipe = buildRecipe(dieBlock, "dies", rows, null);
    expect(recipe.fields.find((f) => f.field === "weightMinG")!.steps).toEqual([{ op: "number", kind: "linear_mass", unit: null }]);
    expect(recipe.unclear).toEqual([{ field: "weightMinG", code: "unit_unknown" }]);
    expect(checkRecipe(recipe, dieBlock)).toEqual([]);
  });

  test("every numeric step carries a unit or null, never a silent default", () => {
    for (const t of INGEST_TARGETS) {
      const headers = TARGETS[t].fields.map((f) => f.name);
      const b = block(headers);
      const rows = TARGETS[t].fields.map((f, i) => row(i + 1, f.name, i));
      const recipe = buildRecipe(b, t, rows, null);
      for (const f of recipe.fields) {
        for (const s of f.steps) if (s.op === "number") expect(s.unit).toBeNull();
      }
      const askedFields = recipe.unclear.filter((u) => u.code === "unit_unknown").map((u) => u.field).sort();
      const numeric = TARGETS[t].fields.filter((f) => ["length", "mass", "linear_mass", "price_per_mass", "count", "dimension"].includes(f.kind)).map((f) => f.name).sort();
      expect(askedFields).toEqual(numeric);
    }
  });

  test("every target's full mapping passes validateRecipe", () => {
    for (const t of INGEST_TARGETS) {
      const headers = TARGETS[t].fields.map((f) => f.name);
      const b = block(headers);
      const rows = TARGETS[t].fields.map((f, i) => row(i + 1, f.name, i, { unit: f.unit }));
      const recipe = buildRecipe(b, t, rows, null);
      expect({ t, errors: checkRecipe(recipe, b) }).toEqual({ t, errors: [] });
    }
  });

  test("a field with a resolver gets its lookup, and a GSTIN is upper-cased", () => {
    const b = block(["Party", "Section", "Date", "GSTIN"]);
    const orders = buildRecipe(b, "orders", [row(1, "customer", 0)], null);
    expect(orders.fields[0]!.steps.map((s) => s.op)).toEqual(["trim", "lookup"]);
    const customers = buildRecipe(block(["Name", "GSTIN"]), "customers", [row(1, "name", 0), row(2, "taxId", 1)], null);
    expect(customers.fields.find((f) => f.field === "taxId")!.steps).toEqual([{ op: "trim" }, { op: "case", to: "upper" }]);
  });

  test("rows with no column are left out and missing required fields are reported", () => {
    const rows = [row(1, "series", 0), row(2, "sectionCode", null)];
    const recipe = buildRecipe(dieBlock, "dies", rows, null);
    expect(recipe.fields.map((f) => f.field)).toEqual(["series"]);
    const p = mappingProblems("dies", rows);
    expect(p.missingRequired).toEqual(["sectionCode", "weightMinG", "weightMaxG"]);
    expect(checkRecipe(recipe, dieBlock).map((e) => e.code)).toContain("missing_required");
  });

  test("two rows for one field are reported", () => {
    expect(mappingProblems("dies", [row(1, "series", 0), row(2, "series", 1)]).duplicateFields).toEqual(["series"]);
  });

  test("an earlier recipe's filters, keys, onExisting and non-unit steps are kept", () => {
    const first = buildRecipe(dieBlock, "dies", [row(1, "series", 0), row(2, "name", 4)], null);
    const previous = {
      ...first,
      onExisting: "skip" as const,
      filters: [{ col: { col: 0, header: "Series" }, test: "not_blank" as const, values: [], action: "keep" as const }],
      fields: first.fields.map((f) => (f.field === "name" ? { ...f, steps: [{ op: "trim" as const }, { op: "case" as const, to: "title" as const }] } : f)),
    };
    const again = buildRecipe(dieBlock, "dies", [row(1, "series", 0), row(2, "name", 4)], previous);
    expect(again.onExisting).toBe("skip");
    expect(again.filters).toHaveLength(1);
    expect(again.fields.find((f) => f.field === "name")!.steps).toEqual([{ op: "trim" }, { op: "case", to: "title" }]);
  });

  test("a recipe for another target is not carried over", () => {
    const other = buildRecipe(block(["Name"]), "customers", [row(1, "name", 0)], null);
    const recipe = buildRecipe(dieBlock, "dies", [row(1, "series", 0)], other);
    expect(recipe.target).toBe("dies");
    expect(recipe.keys).toEqual(TARGETS.dies.keys);
  });

  test("a two-row header and the header row come from the block", () => {
    const b = { ...dieBlock, headerRow: 2, headerRows: 2 };
    const recipe = buildRecipe(b, "dies", [row(1, "series", 0)], null);
    expect([recipe.headerRow, recipe.headerRows]).toEqual([2, 2]);
  });
});

describe("initial rows", () => {
  test("a block with no recipe starts with the required fields, unmapped", () => {
    const rows = initialMappings(block(["a"]), "dies", null);
    expect(rows.map((r) => r.field)).toEqual(["series", "sectionCode", "weightMinG", "weightMaxG"]);
    expect(rows.every((r) => r.column === null && r.unit === null)).toBe(true);
  });
  test("a bot's recipe comes back as rows with its columns and units", () => {
    const recipe = buildRecipe(block(["Series", "Section code", "Min (kg/12ft)", "Max (kg/12ft)"]), "dies", [
      row(1, "series", 0), row(2, "sectionCode", 1), row(3, "weightMinG", 2, { unit: "kg/12ft" }), row(4, "weightMaxG", 3, { unit: "kg/12ft" }),
    ], null);
    const rows = initialMappings(block(["Series", "Section code", "Min (kg/12ft)", "Max (kg/12ft)"]), "dies", recipe);
    expect(rows.map((r) => [r.field, r.column, r.unit])).toEqual([
      ["series", 0, null], ["sectionCode", 1, null], ["weightMinG", 2, "kg/12ft"], ["weightMaxG", 3, "kg/12ft"],
    ]);
  });
  test("add picks the next field not yet used", () => {
    const rows = addMapping(initialMappings(block(["a"]), "customers", null), "customers");
    expect(rows.map((r) => r.field)).toEqual(["name", "taxId"]);
  });
});
