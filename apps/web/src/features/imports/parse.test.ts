import { describe, expect, test } from "bun:test";

import { parseImport, readHeader, toCsv } from "./parse";

const mm = { companyUnit: "mm" as const };
const inch = { companyUnit: "inch" as const };

const bundle = (over: Record<string, string> = {}) => ({
  "Die series": "1000",
  "Section code": "A101",
  Pieces: "12",
  "Weight (kg)": "45.5",
  "Length (mm)": "3658",
  ...over,
});

describe("readHeader: the unit comes from the column name", () => {
  test("parenthesised and suffixed units", () => {
    expect(readHeader("Length (mm)")).toEqual({ name: "length", unit: "mm" });
    expect(readHeader("Length (in)")).toEqual({ name: "length", unit: "in" });
    expect(readHeader("Length (ft)")).toEqual({ name: "length", unit: "ft" });
    expect(readHeader("Weight (kg)")).toEqual({ name: "weight", unit: "kg" });
    expect(readHeader("Weight (g)")).toEqual({ name: "weight", unit: "g" });
    expect(readHeader("Min weight (kg/12ft)")).toEqual({ name: "min weight", unit: "kg" });
    expect(readHeader("Weight in kg")).toEqual({ name: "weight", unit: "kg" });
  });

  test("old camelCase sample headers keep working", () => {
    expect(readHeader("lengthMm")).toEqual({ name: "length", unit: "mm" });
    expect(readHeader("weightG")).toEqual({ name: "weight", unit: "g" });
    expect(readHeader("dimensionsWidthIn")).toEqual({ name: "dimensions width", unit: "in" });
    expect(readHeader("dieSectionCode")).toEqual({ name: "die section code", unit: null });
  });

  test("unit-less headers carry no unit; non-unit brackets are dropped", () => {
    expect(readHeader("Length")).toEqual({ name: "length", unit: null });
    expect(readHeader("Pieces (nos)")).toEqual({ name: "pieces", unit: null });
    expect(readHeader("  PO no. ")).toEqual({ name: "po no", unit: null });
  });
});

describe("parseImport bundles: lengths never 25.4x off (Review Focus 4)", () => {
  test("a mm sheet imported into an inch company keeps 3658 mm", () => {
    const res = parseImport("bundles", [bundle({ "Length (mm)": "3658" })], inch);
    expect(res.rejected).toEqual([]);
    expect(res.ok[0]!.lengthMm).toBe(3658);
  });

  test("Length (in) 144 is 3658 mm, in a mm company too", () => {
    const row = { ...bundle(), "Length (in)": "144" } as Record<string, string>;
    delete row["Length (mm)"];
    expect(parseImport("bundles", [row], mm).ok[0]!.lengthMm).toBe(3658);
    expect(parseImport("bundles", [row], inch).ok[0]!.lengthMm).toBe(3658);
  });

  test("Length (ft) 12 is 3658 mm; 11.5 ft is 3505 mm", () => {
    const rows = [{ "Die series": "1", "Section code": "A", Pieces: "1", "Weight (kg)": "1", "Length (ft)": "12" }];
    expect(parseImport("bundles", rows, mm).ok[0]!.lengthMm).toBe(3658);
    rows[0]!["Length (ft)"] = "11.5";
    expect(parseImport("bundles", rows, mm).ok[0]!.lengthMm).toBe(3505);
  });

  test("unit-less Length falls back to the company unit", () => {
    const row = (length: string) => ({ "Die series": "1", "Section code": "A", Pieces: "1", "Weight (kg)": "1", Length: length });
    expect(parseImport("bundles", [row("3658")], mm).ok[0]!.lengthMm).toBe(3658);
    // Inch company: a plain number is inches; feet-and-inches notation is read as written.
    expect(parseImport("bundles", [row("144")], inch).ok[0]!.lengthMm).toBe(3658);
    expect(parseImport("bundles", [row("11 ft 6 in")], inch).ok[0]!.lengthMm).toBe(3505);
    expect(parseImport("bundles", [row(`11' 6"`)], inch).ok[0]!.lengthMm).toBe(3505);
    expect(parseImport("bundles", [row("12 ft")], inch).ok[0]!.lengthMm).toBe(3658);
  });

  test("a mm column never reads feet notation as mm", () => {
    const res = parseImport("bundles", [bundle({ "Length (mm)": "12 ft" })], inch);
    expect(res.ok).toEqual([]);
    expect(res.rejected[0]).toMatchObject({ row: 2, reason: "imports.reason.notNumber", column: "Length (mm)" });
  });

  test("weights: kg and g columns both land in whole grams", () => {
    expect(parseImport("bundles", [bundle({ "Weight (kg)": "45.5" })], mm).ok[0]!.weightG).toBe(45500);
    const g = { ...bundle(), "Weight (g)": "45500.4" } as Record<string, string>;
    delete g["Weight (kg)"];
    expect(parseImport("bundles", [g], mm).ok[0]!.weightG).toBe(45500);
    // Unit-less weight is kg (weights are always kg in orrn).
    const plain = { ...bundle(), Weight: "45.5" } as Record<string, string>;
    delete plain["Weight (kg)"];
    expect(parseImport("bundles", [plain], mm).ok[0]!.weightG).toBe(45500);
  });

  test("old camelCase sample sheet still imports in grams and mm", () => {
    const res = parseImport(
      "bundles",
      [{ dieSeries: "1000", dieSectionCode: "A101", quantity: "12", weightG: "4500", lengthMm: "6000", notes: "x" }],
      inch,
    );
    expect(res.ok).toEqual([
      { dieSeries: "1000", dieSectionCode: "A101", quantity: 12, weightG: 4500, lengthMm: 6000, poNumber: null },
    ]);
    expect(res.ignoredColumns).toEqual(["notes"]);
  });

  test("a blank weight row is rejected with a reason, the rest still import", () => {
    const res = parseImport("bundles", [bundle(), bundle({ "Weight (kg)": "  " }), bundle()], mm);
    expect(res.ok).toHaveLength(2);
    expect(res.okRows).toEqual([2, 4]);
    expect(res.rejected).toEqual([{ row: 3, reason: "imports.reason.blank", column: "Weight (kg)" }]);
  });

  test("1e3 is rejected, never read as 1000", () => {
    const res = parseImport("bundles", [bundle({ "Weight (kg)": "1e3" })], mm);
    expect(res.ok).toEqual([]);
    expect(res.rejected).toEqual([{ row: 2, reason: "imports.reason.notNumber", column: "Weight (kg)" }]);
  });

  test("signs, junk, zero and fractional pieces are rejected (no parseInt truncation)", () => {
    const res = parseImport(
      "bundles",
      [
        bundle({ "Weight (kg)": "-4" }),
        bundle({ "Length (mm)": "abc" }),
        bundle({ "Length (mm)": "0" }),
        bundle({ Pieces: "12.5" }),
        bundle({ Pieces: "0" }),
        bundle({ "Weight (kg)": "0.0004" }),
        bundle({ "Die series": "" }),
      ],
      mm,
    );
    expect(res.ok).toEqual([]);
    expect(res.rejected.map((r) => [r.row, r.reason, r.column])).toEqual([
      [2, "imports.reason.notNumber", "Weight (kg)"],
      [3, "imports.reason.notNumber", "Length (mm)"],
      [4, "imports.reason.notPositive", "Length (mm)"],
      [5, "imports.reason.notWhole", "Pieces"],
      [6, "imports.reason.notPositive", "Pieces"],
      [7, "imports.reason.notPositive", "Weight (kg)"],
      [8, "imports.reason.blank", "Die series"],
    ]);
  });

  test("thousands commas are fine; fully blank rows are skipped, not rejected, and keep row numbers", () => {
    const blank = { "Die series": "", "Section code": "", Pieces: "", "Weight (kg)": "", "Length (mm)": "" };
    const res = parseImport("bundles", [blank, bundle({ "Weight (kg)": "1,234.5" })], mm);
    expect(res.rejected).toEqual([]);
    expect(res.blankRows).toBe(1);
    expect(res.okRows).toEqual([3]);
    expect(res.ok[0]!.weightG).toBe(1234500);
  });

  test("PO number is optional and trimmed; overlong text is rejected", () => {
    const res = parseImport("bundles", [bundle({ "PO no": " 4512 " }), bundle({ "PO no": "x".repeat(501) })], mm);
    expect(res.ok[0]!.poNumber).toBe("4512");
    expect(res.rejected[0]).toMatchObject({ row: 3, reason: "imports.reason.tooLong", column: "PO no" });
  });

  test("a sheet without a required column reports it and parses nothing", () => {
    const res = parseImport("bundles", [{ "Die series": "1", "Section code": "A", Pieces: "1", "Length (mm)": "3658" }], mm);
    expect(res.missingColumns).toEqual(["weight"]);
    expect(res.ok).toEqual([]);
    expect(res.rejected).toEqual([]);
  });

  test("a column whose unit does not fit the field is not used", () => {
    const row = { ...bundle(), "Weight (mm)": "3" } as Record<string, string>;
    delete row["Weight (kg)"];
    const res = parseImport("bundles", [row], mm);
    expect(res.missingColumns).toEqual(["weight"]);
    expect(res.ignoredColumns).toEqual(["Weight (mm)"]);
  });

  test("the first matching column wins; a second one for the same field is ignored", () => {
    const res = parseImport("bundles", [{ ...bundle(), "Length (in)": "1" }], mm);
    expect(res.ok[0]!.lengthMm).toBe(3658);
    expect(res.ignoredColumns).toEqual(["Length (in)"]);
    expect(res.columns.find((c) => c.field === "length")).toEqual({ field: "length", header: "Length (mm)", unit: "mm" });
  });

  test("the first data row number can be moved (Excel sheets that start lower)", () => {
    const res = parseImport("bundles", [bundle({ Pieces: "" })], { ...mm, firstDataRow: 5 });
    expect(res.rejected[0]!.row).toBe(5);
  });
});

describe("parseImport dies", () => {
  const die = (over: Record<string, string> = {}) => ({
    Series: "1000",
    "Section code": "A101",
    Name: "Standard box",
    "Min weight (kg/12ft)": "1.2",
    "Max weight (kg/12ft)": "1.4",
    ...over,
  });

  test("kg/12ft weights become grams; geometry keeps 0.1 mm and follows its header unit", () => {
    const res = parseImport("dies", [die({ "Width (mm)": "25.44", "Thickness (in)": "0.1", Oblique: "40" })], inch);
    expect(res.rejected).toEqual([]);
    expect(res.ok[0]).toEqual({
      series: "1000",
      sectionCode: "A101",
      name: "Standard box",
      weightMinG: 1200,
      weightMaxG: 1400,
      widthMm: 25.4,
      thicknessMm: 2.5,
      // Unit-less in an inch company: 40 in.
      obliqueMm: 1016,
      dimensions: {},
      status: "active",
      notes: null,
    });
  });

  test("old sample headers (weightMinG, dimensionsWidthMm) still work", () => {
    const res = parseImport(
      "dies",
      [{ series: "1000", sectionCode: "A101", name: "Box", weightMinG: "50", weightMaxG: "60", dimensionsWidthMm: "10", dimensionsHeightMm: "15", dimensionsThicknessMm: "2", notes: "n" }],
      inch,
    );
    expect(res.ok[0]).toMatchObject({ weightMinG: 50, weightMaxG: 60, widthMm: 10, thicknessMm: 2, dimensions: { heightMm: 15 }, notes: "n" });
  });

  test("blank weights are rejected (never sent as 0, which fails the whole import)", () => {
    const res = parseImport("dies", [die({ "Min weight (kg/12ft)": "" })], mm);
    expect(res.ok).toEqual([]);
    expect(res.rejected).toEqual([{ row: 2, reason: "imports.reason.blank", column: "Min weight (kg/12ft)" }]);
  });

  test("max below min, unknown status and a repeated die are rejected", () => {
    const res = parseImport(
      "dies",
      [die(), die({ "Max weight (kg/12ft)": "1.0", "Section code": "B1" }), die({ "Section code": "C1", Status: "gone" }), die()],
      mm,
    );
    expect(res.ok).toHaveLength(1);
    expect(res.rejected).toEqual([
      { row: 3, reason: "imports.reason.rangeOrder", column: "Max weight (kg/12ft)" },
      { row: 4, reason: "imports.reason.badStatus", column: "Status" },
      { row: 5, reason: "imports.reason.duplicate", column: "Section code", vars: { other: 2 } },
    ]);
  });

  test("status words are case-insensitive", () => {
    expect(parseImport("dies", [die({ Status: "Archived" })], mm).ok[0]!.status).toBe("archived");
  });
});

describe("parseImport customers", () => {
  test("name is required, email is checked, GSTIN maps to taxId", () => {
    const res = parseImport(
      "customers",
      [
        { Name: "Shree Metals", Email: "a@shree.in", Phone: "98250 11111", GSTIN: "24AAACS1234A1Z5", Notes: "" },
        { Name: "", Email: "", Phone: "1", GSTIN: "", Notes: "" },
        { Name: "Bad mail", Email: "not-an-email", Phone: "", GSTIN: "", Notes: "" },
      ],
      mm,
    );
    expect(res.ok).toEqual([
      { name: "Shree Metals", email: "a@shree.in", phone: "98250 11111", taxId: "24AAACS1234A1Z5", notes: null },
    ]);
    expect(res.rejected).toEqual([
      { row: 3, reason: "imports.reason.blank", column: "Name" },
      { row: 4, reason: "imports.reason.badEmail", column: "Email" },
    ]);
  });

  test("old sample headers (taxId) still work", () => {
    const res = parseImport("customers", [{ name: "Acme", email: "", phone: "", taxId: "X1", notes: "Net 30" }], mm);
    expect(res.ok[0]).toEqual({ name: "Acme", email: null, phone: null, taxId: "X1", notes: "Net 30" });
  });
});

describe("toCsv", () => {
  test("quotes cells with commas, quotes and newlines", () => {
    expect(toCsv(["Name", "Problem"], [["Shree, Surat", 'Says "hi"'], ["a\nb", "ok"]])).toBe(
      'Name,Problem\r\n"Shree, Surat","Says ""hi"""\r\n"a\nb",ok\r\n',
    );
  });

  test("neutralises spreadsheet formulas but leaves phone numbers and signed numbers alone", () => {
    expect(toCsv(["A"], [["=1+1"], ["@x"], ["+cmd|' /C calc'!A0"], ["+91 98250 11111"], ["-4"]])).toBe(
      "A\r\n'=1+1\r\n'@x\r\n'+cmd|' /C calc'!A0\r\n+91 98250 11111\r\n-4\r\n",
    );
  });
});
