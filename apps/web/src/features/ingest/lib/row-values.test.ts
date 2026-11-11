import { describe, expect, test } from "bun:test";

import { rupeesFromPaise, valueCells } from "./row-values";

const row = (over: Record<string, unknown>) => ({ values: null, entered: null, rateHidden: false, ...over }) as never;

describe("row values", () => {
  test("paise become rupees with two decimals, exactly", () => {
    expect(rupeesFromPaise(21500)).toBe("215.00");
    expect(rupeesFromPaise(21550)).toBe("215.50");
    expect(rupeesFromPaise(5)).toBe("0.05");
    expect(rupeesFromPaise(-120)).toBe("-1.20");
  });

  test("a number the file wrote with a unit shows both, entered next to converted", () => {
    const cells = valueCells("dies", row({ values: { weightMinG: 2400, series: "R" }, entered: { weightMinG: { text: "2.4", unit: "kg/12ft" } } }));
    const w = cells.find((c) => c.field === "weightMinG")!;
    expect(w.value).toBe("2400");
    expect(w.unit).toBeTruthy();
    expect(w.entered).toEqual({ text: "2.4", unit: "kg/12ft" });
    expect(cells.find((c) => c.field === "series")!.entered).toBeNull();
  });

  test("text typed the same as it is stored shows once", () => {
    const cells = valueCells("customers", row({ values: { name: "Shree" }, entered: { name: { text: "Shree", unit: null } } }));
    expect(cells[0]!.entered).toBeNull();
  });

  test("a rate shows in rupees with the Rs per kg label, and what the file said beside it", () => {
    const cells = valueCells("orders", row({ values: { rate: 21500 }, entered: { rate: { text: "215", unit: "inr/kg" } } }));
    const r = cells.find((c) => c.field === "rate")!;
    expect(r).toMatchObject({ value: "215.00", unitKey: "ingest.rate.unit", unit: null, hidden: false });
    expect(r.entered).toEqual({ text: "215", unit: "inr/kg" });
  });

  test("a masked rate is hidden in the value and in what the file said, never zero", () => {
    const cells = valueCells("orders", row({ values: { rate: 0, series: "R" }, entered: { rate: { text: "215", unit: "inr/kg" } }, rateHidden: true }));
    const r = cells.find((c) => c.field === "rate")!;
    expect(r).toMatchObject({ hidden: true, value: "", entered: null });
    expect(JSON.stringify(cells)).not.toContain("215");
  });

  test("blank values are left out, and a stored field the catalogue lacks still shows", () => {
    const cells = valueCells("customers", row({ values: { name: "A", phone: "", extra: "x" } }));
    expect(cells.map((c) => c.field)).toEqual(["name", "extra"]);
  });

  test("the server's working values (_ids, _dupKey) are not shown as fields", () => {
    const cells = valueCells("bundles", row({ values: { legacyId: "L1", _ids: { sectionCode: "x" }, _dupKey: "L1" } }));
    expect(cells.map((c) => c.field)).toEqual(["legacyId"]);
  });

  test("a row with no values (a refused row) shows nothing", () => {
    expect(valueCells("dies", row({}))).toEqual([]);
  });
});
