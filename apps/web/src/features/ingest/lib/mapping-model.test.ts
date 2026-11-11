import { describe, expect, test } from "bun:test";

import {
  assignField, columnEntries, emptyColumnMap, initialColumnMap, initialLayoutName, isRateColumn, kindWords, mappingStatus, readEntries,
  recipeFromMap, saveCheck, sampleValues, setColumnDateFormat, setColumnUnit, targetSelect, toMappingRows,
} from "./mapping-model";
import { plantUnitsFor } from "./plant-units";

const block = {
  headers: ["Series", "Section code", "Min weight (kg/12ft)", "Max weight", "Rate", "Notes"],
  kinds: ["code", "code", "decimal", "decimal", "decimal", "text"] as const,
  sample: [
    ["R", "RCQCZ", "1.1", "1.2", "215", ""],
    ["R", "RCQCZ2", "", "1.3", "220", "old"],
    ["S", "SCQ", "1.4", "1.5", "230", "x".repeat(40)],
    ["T", "TCQ", "1.5", "1.6", "240", "later"],
  ],
};
const forMapping = { headers: block.headers, headerKey: "k", headerRow: 0, headerRows: 1 };
const mm = plantUnitsFor({ lengthUnit: "mm" });
const entries = (map = emptyColumnMap(block), canSeePrices = true, target: "dies" | "orders" | null = "dies") =>
  columnEntries(block as never, target, map, mm, canSeePrices);

describe("the mapping editor (M9)", () => {
  test("one entry per file column, in file order, with kind, three samples, and nothing used at first", () => {
    const list = entries();
    expect(list.map((e) => e.header)).toEqual(block.headers);
    expect(list.every((e) => e.field === null && e.muted && e.preview.kind === "willNotImport")).toBe(true);
    expect(list[2]!.kind).toEqual({ key: "ingest.kind.number", numeric: true });
    expect(list[0]!.kind.key).toBe("ingest.kind.text");
    expect(list[2]!.samples).toEqual({ values: ["1.1", "1.4", "1.5"], masked: false, mono: true });
  });

  test("samples skip blanks, take three, and are cut at 32 characters", () => {
    expect(sampleValues(block as never, 5, false).values).toEqual(["old", "x".repeat(29) + "...", "later"]);
    expect(sampleValues(block as never, 4, false).values).toHaveLength(3);
  });

  test("kinds in words", () => {
    expect(kindWords("date").key).toBe("ingest.kind.date");
    expect(kindWords("int").numeric).toBe(true);
    expect(kindWords("mixed").key).toBe("ingest.kind.text");
    expect(kindWords("empty").key).toBe("ingest.kind.empty");
  });

  test("the field select starts at Not used; required fields say so; a taken field says which column has it", () => {
    let map = emptyColumnMap(block);
    map = assignField(map, 1, "sectionCode", "dies", forMapping);
    const options = entries(map)[0]!.options;
    expect(options[0]).toMatchObject({ value: "", words: { key: "ingest.shape.notUsed" } });
    expect(options.find((o) => o.value === "series")).toMatchObject({ required: true, words: { key: "ingest.shape.required", varKeys: { label: "ingest.field.series" } } });
    expect(options.find((o) => o.value === "name")!.words).toEqual({ key: "ingest.field.name" });
    expect(options.find((o) => o.value === "sectionCode")).toMatchObject({ usedBy: 1, words: { key: "ingest.shape.usedBy", vars: { column: "Section code" } } });
  });

  test("picking a field another column has moves it here", () => {
    let map = assignField(emptyColumnMap(block), 1, "sectionCode", "dies", forMapping);
    map = assignField(map, 0, "sectionCode", "dies", forMapping);
    expect(map[0]!.field).toBe("sectionCode");
    expect(map[1]!.field).toBeNull();
    map = assignField(map, 0, null, "dies", forMapping);
    expect(map[0]!.field).toBeNull();
  });

  test("a unit named in the header is read from it; a number with no unit is asked", () => {
    let map = assignField(emptyColumnMap(block), 2, "weightMinG", "dies", forMapping);
    expect(map[2]!.unit).toBe("kg/12ft");
    map = assignField(map, 3, "weightMaxG", "dies", forMapping);
    expect(map[3]!.unit).toBeNull();
    const list = entries(map);
    expect(list[3]!.unit).toMatchObject({ kind: "number", value: null, askKey: "ingest.shape.unitAsk" });
    expect(list[3]!.preview).toEqual({ kind: "ask" });
    expect((list[2]!.unit as { choices: { labelKey: string }[] }).choices.map((c) => c.labelKey)).toContain("ingest.unit.kg_12ft");
  });

  test("the preview is the first sample in the plant's unit", () => {
    let map = assignField(emptyColumnMap(block), 2, "weightMinG", "dies", forMapping);
    expect(entries(map)[2]!.preview).toEqual({ kind: "value", text: "1.1", unit: "kg/12ft", mono: true });
    map = setColumnUnit(map, 2, "g/12ft");
    expect(entries(map)[2]!.preview).toMatchObject({ kind: "value", text: "0.001" });
    map = assignField(map, 0, "series", "dies", forMapping);
    expect(entries(map)[0]!.preview).toEqual({ kind: "value", text: "R", unit: "", mono: false });
  });

  test("a sample the field cannot read says why, in words", () => {
    const map = assignField(emptyColumnMap(block), 5, "weightMinG", "dies", forMapping);
    const preview = entries(setColumnUnit(map, 5, "kg/12ft"))[5]!.preview;
    expect(preview).toEqual({ kind: "error", words: { key: "ingest.refuse.bad_number", vars: { field: "" }, varKeys: { field: "ingest.field.weightMinG" } } });
  });

  test("a date field gets the date order, and the preview follows it", () => {
    const dated = { ...block, headers: ["Date"], kinds: ["date"] as const, sample: [["03/04/2025"]] };
    let map = assignField(emptyColumnMap(dated), 0, "orderDate", "orders", { headers: dated.headers });
    expect(columnEntries(dated as never, "orders", map, mm, true)[0]!.unit).toMatchObject({ kind: "date", value: "dmy" });
    expect(columnEntries(dated as never, "orders", map, mm, true)[0]!.preview).toMatchObject({ text: "3 Apr 2025" });
    map = setColumnDateFormat(map, 0, "mdy");
    expect(columnEntries(dated as never, "orders", map, mm, true)[0]!.preview).toMatchObject({ text: "4 Mar 2025" });
  });

  test("a rate column is hidden for a person who may not see rates: no samples, no preview", () => {
    expect(isRateColumn("Rate", null, "orders")).toBe(true);
    expect(isRateColumn("Rs per kg", null, "orders")).toBe(true);
    expect(isRateColumn("Weight", "rate", "orders")).toBe(true);
    expect(isRateColumn("Weight", null, "orders")).toBe(false);
    const map = assignField(emptyColumnMap(block), 4, "rate", "orders", forMapping);
    const hidden = entries(setColumnUnit(map, 4, "inr/kg"), false, "orders")[4]!;
    expect(hidden.samples).toMatchObject({ masked: true, values: [] });
    expect(hidden.preview).toEqual({ kind: "hidden" });
    const shown = entries(setColumnUnit(map, 4, "inr/kg"), true, "orders")[4]!;
    expect(shown.preview).toEqual({ kind: "value", text: "215.00", unit: "₹/kg", mono: true });
  });

  test("with no target yet nothing is offered and nothing previews", () => {
    const list = entries(emptyColumnMap(block), true, null);
    expect(list[0]!.options).toHaveLength(1);
    expect(list.every((e) => e.preview.kind === "willNotImport")).toBe(true);
  });
});

describe("target and name", () => {
  test("the target select starts at Choose, and orrn's suggestion is marked", () => {
    const empty = targetSelect({ target: null, fit: "none", holeName: null });
    expect(empty).toMatchObject({ value: "", suggestedByOrrn: false });
    expect(empty.choices[0]).toEqual({ value: "", words: { key: "ingest.shape.choose" } });
    expect(empty.choices[1]).toEqual({ value: "customers", words: { key: "ingest.target.customers" } });
    expect(targetSelect({ target: "dies", fit: "bot", holeName: "x" })).toMatchObject({ value: "dies", suggestedByOrrn: true });
    expect(targetSelect({ target: "dies", fit: "manual", holeName: "x" }).suggestedByOrrn).toBe(false);
  });
  test("the layout name starts empty, never the file name", () => {
    expect(initialLayoutName({ fit: "none", holeName: null })).toBe("");
    expect(initialLayoutName({ fit: "bot", holeName: "Bot layout" })).toBe("");
    expect(initialLayoutName({ fit: "manual", holeName: "Die list" })).toBe("Die list");
  });
});

describe("the live line and Save", () => {
  const required = (map = emptyColumnMap(block)) => {
    let m = assignField(map, 0, "series", "dies", forMapping);
    m = assignField(m, 1, "sectionCode", "dies", forMapping);
    m = assignField(m, 2, "weightMinG", "dies", forMapping);
    return assignField(m, 3, "weightMaxG", "dies", forMapping);
  };

  test("still needed in amber is always on; all mapped in green once the required ones are", () => {
    expect(mappingStatus("dies", emptyColumnMap(block))).toEqual({
      state: "needed",
      words: { key: "ingest.shape.missingRequired", varLists: { fields: ["ingest.field.series", "ingest.field.sectionCode", "ingest.field.weightMinG", "ingest.field.weightMaxG"] } },
    });
    expect(mappingStatus("dies", required())).toEqual({ state: "done", words: { key: "ingest.shape.allMapped" } });
    expect(mappingStatus(null, emptyColumnMap(block)).state).toBe("choose");
  });

  test("a Save that cannot go always says why, and where to look", () => {
    const none = saveCheck({ target: null, name: "", map: emptyColumnMap(block), block: forMapping, previous: null });
    expect(none).toMatchObject({ ok: false, problems: [{ id: "target", focus: { kind: "target" } }], recipe: null });

    const incomplete = saveCheck({ target: "dies", name: "", map: emptyColumnMap(block), block: forMapping, previous: null });
    expect(incomplete.ok).toBe(false);
    expect(incomplete.problems.map((p) => p.id)).toEqual(["name", "missing"]);
    expect(incomplete.problems[0]!.focus).toEqual({ kind: "name" });
    expect(incomplete.problems[1]!.focus).toEqual({ kind: "column", col: 0 });
    expect(incomplete.summary).toEqual({ key: "ingest.shape.fixCount", vars: { count: 2 } });
  });

  test("a complete map with a name saves, and gives the recipe the engine accepts", () => {
    const check = saveCheck({ target: "dies", name: "Die list", map: setColumnUnit(required(), 3, "kg/12ft"), block: forMapping, previous: null });
    expect(check).toMatchObject({ ok: true, summary: null, problems: [] });
    expect(check.recipe!.fields.map((f) => f.field)).toEqual(["series", "sectionCode", "weightMinG", "weightMaxG"]);
  });

  test("the rows buildRecipe takes come from the used columns only, in file order", () => {
    const rows = toMappingRows(required());
    expect(rows.map((r) => [r.field, r.column])).toEqual([["series", 0], ["sectionCode", 1], ["weightMinG", 2], ["weightMaxG", 3]]);
    expect(recipeFromMap(forMapping, "dies", required(), null).fields).toHaveLength(4);
  });
});

describe("how orrn read this file", () => {
  test("a recipe's columns come back as the map, with the count of used and unused columns", () => {
    const recipe = recipeFromMap(forMapping, "dies", setColumnUnit(assignField(assignField(assignField(assignField(emptyColumnMap(block), 0, "series", "dies", forMapping), 1, "sectionCode", "dies", forMapping), 2, "weightMinG", "dies", forMapping), 3, "weightMaxG", "dies", forMapping), 3, "kg/12ft"), null);
    const map = initialColumnMap(forMapping, "dies", recipe);
    expect(map.map((m) => m.field)).toEqual(["series", "sectionCode", "weightMinG", "weightMaxG", null, null]);
    expect(map[2]!.unit).toBe("kg/12ft");
    const read = readEntries({ target: "dies", recipe, block: { ...block, headerKey: "k", headerRow: 0, headerRows: 1 } } as never, mm, true);
    expect(read).toMatchObject({ used: 4, unused: 2 });
    expect(read.entries[5]!.muted).toBe(true);
  });
  test("a recipe for another target gives nothing used", () => {
    const recipe = { target: "customers", fields: [] } as never;
    expect(initialColumnMap(forMapping, "dies", recipe).every((m) => m.field === null)).toBe(true);
  });
});
