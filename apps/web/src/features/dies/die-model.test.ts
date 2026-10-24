import { describe, expect, test } from "bun:test";

import { dieToDraft, draftToDieInput, EMPTY_DIE_DRAFT, geometryText, kgText, parseGeometry, validateDieDraft, type StoredDie } from "./die-model";

const DIE: StoredDie = {
  series: "PATTI",
  sectionCode: "14701",
  name: 'Patti 1" x 1/8"',
  legMm: null,
  widthMm: 25,
  thicknessMm: 10,
  dimensions: { widthMm: 25, thicknessMm: 10, heightMm: 4 },
  weightMinG: 2400,
  weightMaxG: 2650,
  status: "active",
  notes: null,
};

describe("kgText", () => {
  test("grams to kg text without float noise or trailing zeros", () => {
    expect(kgText(2400)).toBe("2.4");
    expect(kgText(2650)).toBe("2.65");
    expect(kgText(2455)).toBe("2.455");
    expect(kgText(3000)).toBe("3");
  });
});

describe("geometryText and parseGeometry", () => {
  test("mm companies see mm, inch companies see inches to 3 decimals", () => {
    expect(geometryText(10, "mm")).toBe("10");
    expect(geometryText(3.2, "mm")).toBe("3.2");
    expect(geometryText(10, "inch")).toBe("0.394");
    expect(geometryText(25.4, "inch")).toBe("1");
    expect(geometryText(3.2, "inch")).toBe("0.126");
    expect(geometryText(null, "inch")).toBe("");
  });

  test("text back to mm at the server's 0.1 mm precision", () => {
    expect(parseGeometry("10", "mm")).toBe(10);
    expect(parseGeometry("3.25", "mm")).toBe(3.3);
    expect(parseGeometry("0.125", "inch")).toBe(3.2);
    expect(parseGeometry("1", "inch")).toBe(25.4);
    expect(parseGeometry("", "inch")).toBeNull();
    expect(parseGeometry("  ", "mm")).toBeNull();
    expect(parseGeometry("1.2.3", "mm")).toBe("invalid");
    expect(parseGeometry("abc", "mm")).toBe("invalid");
  });
});

describe("dieToDraft", () => {
  test("weights in kg/12ft, geometry in the company unit", () => {
    expect(dieToDraft(DIE, "inch")).toEqual({
      series: "PATTI",
      sectionCode: "14701",
      name: 'Patti 1" x 1/8"',
      weightMin: "2.4",
      weightMax: "2.65",
      status: "active",
      notes: "",
      width: "0.984",
      thickness: "0.394",
      leg: "",
    });
  });

  test("width and thickness fall back to the legacy dimensions blob", () => {
    const legacy = { ...DIE, widthMm: null, thicknessMm: null, dimensions: { widthMm: 30, thicknessMm: 2 } };
    expect(dieToDraft(legacy, "mm")).toMatchObject({ width: "30", thickness: "2" });
  });
});

describe("draftToDieInput (N6: untouched fields keep the stored value exactly)", () => {
  test("an inch company saving an untouched die with 10 mm thickness still sends 10 mm", () => {
    const draft = dieToDraft(DIE, "inch");
    const input = draftToDieInput(draft, "inch", DIE);
    expect(input.thicknessMm).toBe(10);
    expect(input.widthMm).toBe(25);
    expect(input.weightMinG).toBe(2400);
    expect(input.weightMaxG).toBe(2650);
    // Without N6 the round trip would send 0.394 in = 10.0076 mm -> 10, but 0.984 in = 24.99 mm -> 25.0
    // only by luck; a 3.2 mm thickness shown as 0.126 in would come back as 3.2004 -> 3.2 and a
    // 9.9 mm one as 0.39 in -> 9.9. The rule is simple: untouched means unchanged.
    expect(input.dimensions).toEqual({ widthMm: 25, thicknessMm: 10, heightMm: 4 });
  });

  test("a stored value off the 0.1 mm grid goes back exactly when untouched", () => {
    // A legacy 1.27 mm (0.05 in) thickness shows as "0.05" in an inch plant and as "1.3" in a mm
    // plant; parsing either back would store 1.3 mm. Untouched must send 1.27.
    const legacy: StoredDie = { ...DIE, thicknessMm: null, dimensions: { thicknessMm: 1.27, widthMm: 25 } };
    for (const unit of ["inch", "mm"] as const) {
      const input = draftToDieInput(dieToDraft(legacy, unit), unit, legacy);
      expect(input.thicknessMm).toBe(1.27);
      expect(input.dimensions).toEqual({ thicknessMm: 1.27, widthMm: 25 });
    }
    // A stored weight in grams that kg text would round (2455.4 is not whole grams) is not rewritten either.
    const grams: StoredDie = { ...DIE, weightMinG: 2400.4 };
    expect(draftToDieInput(dieToDraft(grams, "mm"), "mm", grams).weightMinG).toBe(2400.4);
  });

  test("a changed field is converted from the company unit; other fields stay as stored", () => {
    const draft = { ...dieToDraft(DIE, "inch"), thickness: "0.125" };
    const input = draftToDieInput(draft, "inch", DIE);
    expect(input.thicknessMm).toBe(3.2);
    expect(input.widthMm).toBe(25);
    expect(input.dimensions).toEqual({ widthMm: 25, thicknessMm: 3.2, heightMm: 4 });
  });

  test("clearing a measurement sends null and drops it from dimensions", () => {
    const draft = { ...dieToDraft(DIE, "mm"), width: "" };
    const input = draftToDieInput(draft, "mm", DIE);
    expect(input.widthMm).toBeNull();
    expect(input.dimensions).toEqual({ thicknessMm: 10, heightMm: 4 });
  });

  test("weights typed in kg/12ft are stored as whole grams", () => {
    const draft = { ...dieToDraft(DIE, "mm"), weightMin: "2.45", weightMax: "2.7" };
    const input = draftToDieInput(draft, "mm", DIE);
    expect(input.weightMinG).toBe(2450);
    expect(input.weightMaxG).toBe(2700);
  });

  test("a new die converts everything and trims text", () => {
    const draft = {
      ...EMPTY_DIE_DRAFT,
      series: " TEE ",
      sectionCode: " 13090 ",
      name: "  ",
      weightMin: "2.7",
      weightMax: "2.9",
      width: "1.25",
    };
    expect(draftToDieInput(draft, "inch")).toEqual({
      series: "TEE",
      sectionCode: "13090",
      name: null,
      weightMinG: 2700,
      weightMaxG: 2900,
      status: "active",
      notes: null,
      widthMm: 31.8,
      thicknessMm: null,
      legMm: null,
      dimensions: { widthMm: 31.8 },
    });
  });
});

describe("validateDieDraft", () => {
  const ok = { ...EMPTY_DIE_DRAFT, series: "TEE", sectionCode: "13090", weightMin: "2.7", weightMax: "2.9" };

  test("a complete draft has no errors", () => {
    expect(validateDieDraft(ok, "mm")).toEqual({});
  });

  test("series, section code and both weights are required", () => {
    expect(validateDieDraft(EMPTY_DIE_DRAFT, "mm")).toEqual({
      series: "errors.required",
      sectionCode: "errors.required",
      weightMin: "errors.required",
      weightMax: "errors.required",
    });
  });

  test("weights must be above zero and max can't be below min", () => {
    expect(validateDieDraft({ ...ok, weightMin: "0" }, "mm")).toEqual({ weightMin: "errors.notPositive" });
    expect(validateDieDraft({ ...ok, weightMin: "3", weightMax: "2.9" }, "mm")).toEqual({ weightMax: "dies.form.rangeOrder" });
    expect(validateDieDraft({ ...ok, weightMin: "2.9", weightMax: "2.9" }, "mm")).toEqual({});
  });

  test("a comma is digit grouping only, never a decimal point (2,65 is not 265)", () => {
    expect(validateDieDraft({ ...ok, weightMin: "2,65" }, "mm")).toEqual({ weightMin: "errors.invalidNumber" });
    expect(validateDieDraft({ ...ok, weightMax: "2,9" }, "mm")).toEqual({ weightMax: "errors.invalidNumber" });
    expect(validateDieDraft({ ...ok, thickness: "0,125" }, "inch")).toEqual({ thickness: "errors.invalidNumber" });
    expect(validateDieDraft({ ...ok, width: "1,2,3" }, "mm")).toEqual({ width: "errors.invalidNumber" });
    // Real grouping still reads: 1,250.5 mm and the Indian 1,25,000.
    expect(validateDieDraft({ ...ok, width: "1,250.5" }, "mm")).toEqual({});
    expect(parseGeometry("1,250.5", "mm")).toBe(1250.5);
    expect(parseGeometry("1,25,000", "mm")).toBe(125000);
    expect(parseGeometry("0,125", "inch")).toBe("invalid");
  });

  test("measurements are optional but must be numbers", () => {
    expect(validateDieDraft({ ...ok, thickness: "1.2.3" }, "mm")).toEqual({ thickness: "errors.invalidNumber" });
    expect(validateDieDraft({ ...ok, thickness: "" }, "inch")).toEqual({});
  });
});
