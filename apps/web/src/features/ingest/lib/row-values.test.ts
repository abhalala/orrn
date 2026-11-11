import { describe, expect, test } from "bun:test";

import { listFormat } from "./list-model";
import { groupBareNumber, plantUnitsFor } from "./plant-units";
import { rawCells, rowColumns, rupeesFromPaise, valueCells } from "./row-values";

const row = (over: Record<string, unknown>) => ({ values: null, entered: null, rateHidden: false, ...over }) as never;
const mm = plantUnitsFor({ lengthUnit: "mm" });
const inch = plantUnitsFor({ lengthUnit: "inch" });
const cell = (target: Parameters<typeof valueCells>[0], r: ReturnType<typeof row>, field: string, plant = mm) =>
  valueCells(target, r, plant).find((c) => c.field === field)!;

describe("row values: the plant's unit first", () => {
  test("paise become rupees with two decimals, exactly", () => {
    expect(rupeesFromPaise(21500)).toBe("215.00");
    expect(rupeesFromPaise(21550)).toBe("215.50");
    expect(rupeesFromPaise(5)).toBe("0.05");
    expect(rupeesFromPaise(-120)).toBe("-1.20");
  });

  // Work order section 4: 58400 g with "58.4 kg" in the file shows "58.4 kg" and nothing else.
  test("58400 g that the file wrote as 58.4 kg shows 58.4 kg and no second line", () => {
    const c = cell("bundles", row({ values: { weightG: 58400 }, entered: { weightG: { text: "58.4", unit: "kg" } } }), "weightG");
    expect(c).toMatchObject({ kind: "number", text: "58.4", unit: "kg", mono: true, align: "end", fileSaid: null });
  });

  test("kg up to 3 decimals with trailing zeros dropped, never a raw gram count", () => {
    expect(cell("bundles", row({ values: { weightG: 58437 } }), "weightG").text).toBe("58.437");
    expect(cell("bundles", row({ values: { weightG: 58400 } }), "weightG").text).toBe("58.4");
    expect(cell("bundles", row({ values: { weightG: 58000 } }), "weightG").text).toBe("58");
    expect(cell("bundles", row({ values: { weightG: 1_234_567 } }), "weightG").text).toBe("1,234.567");
  });

  test("the file's own value shows only when its unit differs from the plant's", () => {
    const c = cell("bundles", row({ values: { weightG: 58400 }, entered: { weightG: { text: "58,400", unit: "g" } } }), "weightG");
    expect(c).toMatchObject({ text: "58.4", unit: "kg", fileSaid: "58,400 g" });
  });

  test("a file number gets the plant's digit grouping", () => {
    const c = cell("bundles", row({ values: { weightG: 2_00_00_000 }, entered: { weightG: { text: "20000000", unit: "g" } } }), "weightG");
    expect(c.fileSaid).toBe("2,00,00,000 g");
  });

  // Work order section 4 note: 3658 mm with "12 ft" in the file.
  test("3658 mm with 12 ft in the file: mm plant shows 3,658 mm first and File said 12 ft", () => {
    const r = row({ values: { lengthMm: 3658 }, entered: { lengthMm: { text: "12", unit: "ft" } } });
    expect(cell("bundles", r, "lengthMm", mm)).toMatchObject({ text: "3,658", unit: "mm", fileSaid: "12 ft" });
  });

  test("3658 mm with 12 ft in the file: a feet and inches plant shows 12 ft and nothing else", () => {
    const r = row({ values: { lengthMm: 3658 }, entered: { lengthMm: { text: "12", unit: "ft" } } });
    expect(cell("bundles", r, "lengthMm", inch)).toMatchObject({ text: "12 ft", unit: "", fileSaid: null });
  });

  test("a cell that carries its own unit is shown as typed", () => {
    const r = row({ values: { lengthMm: 3810 }, entered: { lengthMm: { text: `12' 6"`, unit: "ft_in" } } });
    expect(cell("bundles", r, "lengthMm", mm).fileSaid).toBe(`12' 6"`);
  });

  test("a section weight reads in kg per 12 ft, with the file's grams per 12 ft beside it", () => {
    const c = cell("dies", row({ values: { weightMinG: 2400, series: "R" }, entered: { weightMinG: { text: "2400", unit: "g/12ft" } } }), "weightMinG");
    expect(c).toMatchObject({ text: "2.4", unit: "kg/12ft", fileSaid: "2,400 g/12ft" });
    const same = cell("dies", row({ values: { weightMinG: 2400 }, entered: { weightMinG: { text: "2.4", unit: "kg/12ft" } } }), "weightMinG");
    expect(same.fileSaid).toBeNull();
  });

  test("a count and a die width", () => {
    expect(cell("bundles", row({ values: { quantity: 1400 } }), "quantity")).toMatchObject({ text: "1,400", unit: "pcs" });
    expect(cell("dies", row({ values: { widthMm: 12.5 } }), "widthMm")).toMatchObject({ text: "12.5", unit: "mm" });
    expect(cell("dies", row({ values: { widthMm: 12.5 } }), "widthMm", inch)).toMatchObject({ unit: "in" });
  });

  test("text typed the same as it is stored shows once", () => {
    const cells = valueCells("customers", row({ values: { name: "Shree" }, entered: { name: { text: "Shree", unit: null } } }), mm);
    expect(cells[0]).toMatchObject({ kind: "text", text: "Shree", mono: false, fileSaid: null });
  });

  test("codes stay as the file wrote them, in mono", () => {
    expect(cell("bundles", row({ values: { legacyId: "26I4086", sectionCode: "RCQCZ" } }), "legacyId")).toMatchObject({ text: "26I4086", mono: true });
    expect(cell("dies", row({ values: { name: "Die 1" } }), "name").mono).toBe(false);
  });

  test("an enum shows its words, and a value the dictionary lacks never shows as its code", () => {
    expect(cell("dies", row({ values: { status: "active" } }), "status")).toMatchObject({ kind: "enum", textKey: "ingest.enumValue.active", text: "" });
    const odd = cell("dies", row({ values: { status: "at_odd_place" } }), "status");
    expect(odd).toMatchObject({ textKey: null, text: "At odd place" });
  });

  test("a date is written the plant's way", () => {
    expect(cell("orders", row({ values: { orderDate: "2025-04-01" } }), "orderDate")).toMatchObject({ kind: "date", text: "1 Apr 2025", mono: false });
  });
});

describe("row values: rates", () => {
  test("a rate shows in rupees with the plant's unit, and no file line when the unit is the same", () => {
    const c = cell("orders", row({ values: { rate: 21500 }, entered: { rate: { text: "215", unit: "inr/kg" } } }), "rate");
    expect(c).toMatchObject({ text: "215.00", unit: "₹/kg", hidden: false, fileSaid: null });
  });

  test("a rate the file wrote in paise shows what the file said", () => {
    const c = cell("orders", row({ values: { rate: 21500 }, entered: { rate: { text: "21500", unit: "paise/kg" } } }), "rate");
    expect(c.fileSaid).toBe("21,500 paise/kg");
  });

  test("a masked rate is hidden, with no unit and no file line, never zero", () => {
    const cells = valueCells("orders", row({ values: { series: "R" }, entered: { rate: { text: "215", unit: "inr/kg" } }, rateHidden: true }), mm);
    const r = cells.find((c) => c.field === "rate")!;
    expect(r).toMatchObject({ hidden: true, text: "", unit: "", fileSaid: null });
    expect(JSON.stringify(cells)).not.toContain("215");
  });
});

describe("row values: what is left out", () => {
  test("blank values are left out, and a stored field the catalogue lacks still shows", () => {
    const cells = valueCells("customers", row({ values: { name: "A", phone: "", extra: "x" } }), mm);
    expect(cells.map((c) => c.field)).toEqual(["name", "extra"]);
  });

  test("the server's working values (_ids, _dupKey, _options, _magnitude) are not shown as fields", () => {
    const values = { legacyId: "L1", _ids: { sectionCode: "x" }, _dupKey: "L1", _options: [], _magnitude: [{ field: "weightG" }] };
    expect(valueCells("bundles", row({ values }), mm).map((c) => c.field)).toEqual(["legacyId"]);
  });

  test("a row with no values (a refused row) shows nothing, and its raw cells are labelled by the file's headers", () => {
    expect(valueCells("dies", row({}), mm)).toEqual([]);
    expect(rawCells(["a", "b", "c"], ["Series", " ", "Weight"])).toEqual([
      { label: "Series", n: 1, value: "a" },
      { label: null, n: 2, value: "b" },
      { label: "Weight", n: 3, value: "c" },
    ]);
  });
});

describe("table columns", () => {
  test("one column per mapped field with the plant's unit in the header, numbers to the right", () => {
    const columns = rowColumns("bundles", null, mm);
    const weight = columns.find((c) => c.field === "weightG")!;
    expect(weight).toMatchObject({ unit: "kg", numeric: true, mono: true, align: "end" });
    expect(columns.find((c) => c.field === "lengthMm")).toMatchObject({ unit: "mm" });
    expect(columns.find((c) => c.field === "series")).toMatchObject({ unit: "", numeric: false, mono: true, align: "start" });
    expect(rowColumns("customers", null, mm).find((c) => c.field === "name")).toMatchObject({ mono: false, align: "start" });
  });

  test("a layout with a recipe shows only the fields it maps", () => {
    const recipe = { target: "bundles", fields: [{ field: "legacyId" }, { field: "weightG" }] } as never;
    expect(rowColumns("bundles", recipe, mm).map((c) => c.field)).toEqual(["legacyId", "weightG"]);
    expect(rowColumns(null, null, mm)).toEqual([]);
  });
});

describe("plant units", () => {
  test("counts and values use Indian grouping", () => {
    expect(mm.count(1400)).toBe("1,400");
    expect(mm.count(200000)).toBe("2,00,000");
    expect(mm.count(0)).toBe("0");
    expect(mm.quantity("count", 200000).text).toBe("2,00,000");
  });

  test("the unit text of a column header follows the plant", () => {
    expect(mm.unitText("mass")).toBe("kg");
    expect(mm.unitText("linear_mass")).toBe("kg/12ft");
    expect(mm.unitText("length")).toBe("mm");
    expect(inch.unitText("length")).toBe("");
  });

  test("the list writes a day without its year, in the plant's zone, and counts the plant's way", () => {
    const format = listFormat(mm);
    expect(format.date(Date.UTC(2026, 10, 11, 6, 0))).toBe("11 Nov");
    expect(format.count(1402)).toBe("1,402");
    expect(mm.day("2026-11-11")).toBe("11 Nov 2026");
  });

  test("a bare number is regrouped, anything else is left alone", () => {
    const style = mm.style;
    expect(groupBareNumber("58400", style)).toBe("58,400");
    expect(groupBareNumber("5,84,000", style)).toBe("5,84,000");
    expect(groupBareNumber("1234567.5", style)).toBe("12,34,567.5");
    expect(groupBareNumber("12 ft", style)).toBeNull();
    expect(groupBareNumber("", style)).toBeNull();
  });
});
