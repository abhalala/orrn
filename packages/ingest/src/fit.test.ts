import { describe, expect, test } from "bun:test";

import { fingerprint, headerKey, normalizeHeaders } from "./fingerprint";
import { fitBlock, nearAllowed, nearScore, rebaseRecipe, type LearnedHole } from "./fit";
import type { BlockShape, CellKind, Recipe } from "./recipe";
import { BAKI_SHEET_HEADERS, DIE_SHEET_HEADERS, EXAMPLE_BAKI_RECIPE } from "./recipe-fixtures";

function shape(headers: string[], kinds: CellKind[]): BlockShape {
  const normalized = normalizeHeaders(headers);
  return { headers, kinds, columnCount: headers.length, headerKey: headerKey(normalized), headerRow: 0, headerRows: 1 };
}

const bakiRows = [
  ["1", "Shree Ganesh Aluminium", "PO-11", "12/10/2025", "R 2105", "2.4", "5000", "1200", "3800", "214.5", ""],
  ["2", "Om Metals", "PO-12", "14/10/2025", "T 4012", "1.8", "2500", "0", "2500", "210", "urgent"],
];

function learnedBaki(): LearnedHole {
  return { holeId: "h1", holeVersionId: "hv1", name: "Baki", version: 1, recipe: EXAMPLE_BAKI_RECIPE };
}

describe("fitBlock: built-in holes", () => {
  test("the die template is an exact built-in fit with score 950", () => {
    const fp = fingerprint({ headers: DIE_SHEET_HEADERS, rows: [["40", "4012", "2.2", "2.5", "Frame", "44.5", "1.2", "", "active", ""]] });
    const r = fitBlock(fp, []);
    expect(r.fit).toBe("exact");
    expect(r.score).toBe(950);
    expect(r.target).toBe("dies");
    expect(r.holeRef).toBe("builtin:dies@1");
    expect(r.recipe!.fields.length).toBe(10);
  });

  test("a required numeric field with no unit in its header is a near fit with one question", () => {
    const fp = fingerprint({ headers: ["Series", "Section code", "Min weight", "Max weight (kg/12ft)"], rows: [["40", "4012", "2.2", "2.5"]] });
    const r = fitBlock(fp, []);
    expect(r.fit).toBe("near");
    expect(r.diff!.unitless).toEqual(["weightMinG"]);
    expect(r.score).toBe(950);
  });

  test("a renamed required header is a near fit", () => {
    const fp = fingerprint({ headers: ["Series", "Section codes", "Min weight (kg/12ft)", "Max weight (kg/12ft)"], rows: [["40", "4012", "2.2", "2.5"]] });
    const r = fitBlock(fp, []);
    expect(r.fit).toBe("near");
    expect(r.diff!.renamed).toEqual([{ col: 1, from: "section code", to: "Section codes" }]);
    expect(r.score).toBe(880);
  });

  test("a baki sheet is not an exact customers sheet just because it has Party Name", () => {
    const fp = fingerprint({ headers: BAKI_SHEET_HEADERS, rows: bakiRows });
    expect(fitBlock(fp, []).fit).toBe("none");
  });

  test("a sheet with no known columns is none", () => {
    expect(fitBlock(fingerprint({ headers: ["Foo", "Bar"], rows: [["a", "b"]] }), []).fit).toBe("none");
  });
});

describe("fitBlock: learned holes", () => {
  test("same headerKey and compatible kinds is exact 1000 and beats the built-in customers hole", () => {
    const fp = fingerprint({ headers: BAKI_SHEET_HEADERS, rows: bakiRows });
    const r = fitBlock(fp, [learnedBaki()]);
    expect(r.fit).toBe("exact");
    expect(r.score).toBe(1000);
    expect(r.target).toBe("orders");
    expect(r.holeRef).toBe("learned:hv1");
  });

  test("an exact fit refreshes the column header text to the block's own spelling", () => {
    const headers = BAKI_SHEET_HEADERS.map((h) => h.toUpperCase());
    const fp = fingerprint({ headers, rows: bakiRows });
    expect(fp.headerKey).toBe(learnedBaki().recipe.match.headerKey.length ? fp.headerKey : "");
    const r = fitBlock(fp, [learnedBaki()]);
    expect(r.fit).toBe("exact");
    const f = r.recipe!.fields.find((x) => x.field === "customer")!;
    expect(f.source.kind === "columns" && f.source.cols[0]!.header).toBe("PARTY NAME");
  });

  test("same headerKey but a numeric column holding text is near, not exact", () => {
    const rows = bakiRows.map((r) => r.map((c, i) => (i === 6 ? "see note" : c)));
    const fp = fingerprint({ headers: BAKI_SHEET_HEADERS, rows });
    const r = fitBlock(fp, [learnedBaki()]);
    expect(r.fit).toBe("near");
    expect(r.diff!.kindMismatch.length).toBe(1);
    expect(r.score).toBe(960);
  });

  test("an extra column makes it near and moves nothing", () => {
    const headers = [...BAKI_SHEET_HEADERS, "Truck"];
    const fp = fingerprint({ headers, rows: bakiRows.map((r) => [...r, "GJ01"]) });
    const r = fitBlock(fp, [learnedBaki()]);
    expect(r.fit).toBe("near");
    expect(r.diff!.extra).toEqual([{ col: 11, header: "Truck" }]);
    expect(r.score).toBe(940);
  });

  test("a renamed header is matched and the new recipe points at the block's columns", () => {
    const headers = BAKI_SHEET_HEADERS.map((h) => (h === "Party Name" ? "Party Names" : h));
    const fp = fingerprint({ headers, rows: bakiRows });
    const r = fitBlock(fp, [learnedBaki()]);
    expect(r.fit).toBe("near");
    expect(r.diff!.renamed).toEqual([{ col: 1, from: "party name", to: "Party Names" }]);
    expect(r.recipe!.match.headerKey).toBe(fp.headerKey);
    expect(r.score).toBe(880);
  });

  test("a moved column is found by its header", () => {
    const order = [1, 0, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const headers = order.map((i) => BAKI_SHEET_HEADERS[i]!);
    const rows = bakiRows.map((r) => order.map((i) => r[i]!));
    const r = fitBlock(fingerprint({ headers, rows }), [learnedBaki()]);
    expect(r.fit).toBe("near");
    const f = r.recipe!.fields.find((x) => x.field === "customer")!;
    expect(f.source.kind === "columns" && f.source.cols[0]).toEqual({ col: 0, header: "Party Name" });
    expect(r.score).toBe(1000);
  });

  test("a missing required column is none", () => {
    const headers = BAKI_SHEET_HEADERS.filter((h) => h !== "Party Name");
    const rows = bakiRows.map((r) => r.filter((_, i) => i !== 1));
    expect(fitBlock(fingerprint({ headers, rows }), [learnedBaki()]).fit).toBe("none");
  });

  test("newest learned version first: a later list entry never beats an earlier one of equal score", () => {
    const newer: LearnedHole = { ...learnedBaki(), holeVersionId: "hv2", version: 2 };
    const fp = fingerprint({ headers: BAKI_SHEET_HEADERS, rows: bakiRows });
    expect(fitBlock(fp, [newer, learnedBaki()]).holeRef).toBe("learned:hv2");
  });
});

// A synthetic learned hole on target customers: col 0 name (required), cols 1..5 optional.
const H6 = ["customer name", "phone number", "email address", "city town", "notes remarks", "gst number"];
const FIELDS = ["name", "phone", "email", "city", "notes", "taxId"];
function customersRecipe(): Recipe {
  return {
    schemaVersion: 1, target: "customers", headerRow: 0, headerRows: 1,
    match: { headerKey: headerKey(H6), headers: H6 },
    fields: FIELDS.map((f, i) => ({ field: f, source: { kind: "columns" as const, cols: [{ col: i, header: H6[i]! }] }, steps: [{ op: "trim" as const }] })),
    filters: [], keys: ["name"], onExisting: "ask", unclear: [],
  };
}
const hole6: LearnedHole = { holeId: "c", holeVersionId: "c1", name: "Custs", version: 1, recipe: customersRecipe() };
const text6: CellKind[] = ["text", "text", "text", "text", "text", "text"];

function fit6(headers: string[]) {
  return fitBlock(shape(headers, headers.map(() => "text")), [hole6], []);
}

describe("fit thresholds at every B3 boundary", () => {
  test("renamed: 2 passes, 3 fails", () => {
    const two = [...H6];
    two[1] = "phone numbers";
    two[2] = "email addresses";
    expect(fit6(two).fit).toBe("near");
    expect(fit6(two).score).toBe(760);
    const three = [...two];
    three[3] = "city towns";
    expect(fit6(three).fit).toBe("none");
  });
  test("extra: 3 passes, 4 fails", () => {
    expect(fit6([...H6, "x1", "x2", "x3"]).fit).toBe("near");
    expect(fit6([...H6, "x1", "x2", "x3"]).score).toBe(820);
    expect(fit6([...H6, "x1", "x2", "x3", "x4"]).fit).toBe("none");
  });
  test("missing optional: 2 passes, 3 fails", () => {
    expect(fit6(H6.slice(0, 4)).fit).toBe("near");
    expect(fit6(H6.slice(0, 4)).score).toBe(820);
    expect(fit6(H6.slice(0, 3)).fit).toBe("none");
  });
  test("renamed + extra + missing: 4 passes, 5 fails", () => {
    const four = [...H6.slice(0, 5)];
    four[1] = "phone numbers";
    four[2] = "email addresses";
    expect(fit6([...four, "x1"]).fit).toBe("near");
    expect(fit6([...four, "x1"]).score).toBe(1000 - 240 - 60 - 90);
    expect(fit6([...four, "x1", "x2"]).fit).toBe("none");
  });
  test("the score floor: 600 passes, 599 or less fails", () => {
    expect(nearScore({ renamed: 1, extra: 0, missing: 0, kindMismatch: 7 })).toBe(600);
    expect(nearAllowed({ renamed: 1, extra: 0, missing: 0, kindMismatch: 7 })).toBe(true);
    expect(nearAllowed({ renamed: 1, extra: 0, missing: 0, kindMismatch: 8 })).toBe(false);
    expect(nearScore({ renamed: 1, extra: 0, missing: 0, kindMismatch: 8 })).toBe(560);
  });
  test("the score floor through a real fit: 7 kind mismatches pass, 8 fail", () => {
    const H = ["customer name", "order date", "series", "section code", "kg per 12ft", "cut length", "pcs", "ordered kg", "rate"];
    const recipe: Recipe = {
      schemaVersion: 1, target: "orders", headerRow: 0, headerRows: 1,
      match: { headerKey: headerKey(H), headers: H },
      fields: [
        { field: "customer", source: { kind: "columns", cols: [{ col: 0, header: H[0]! }] }, steps: [{ op: "trim" }] },
        ...H.slice(1).map((h, i) => ({
          field: ["orderDate", "series", "sectionCode", "kgPer12ft", "cutLength", "pcs", "orderedKg", "rate"][i]!,
          source: { kind: "columns" as const, cols: [{ col: i + 1, header: h }] },
          steps: i === 0 ? [{ op: "date" as const, format: "dmy" as const }] : [{ op: "number" as const, kind: "mass" as const, unit: "kg" }],
        })),
      ],
      filters: [], keys: [], onExisting: "ask", unclear: [],
    };
    const hole: LearnedHole = { holeId: "o", holeVersionId: "o1", name: "Orders", version: 1, recipe };
    const renamed = [...H];
    renamed[0] = "customer names";
    // Expected kinds: col 1 a date, cols 2..8 numbers: 8 columns. All text gives 8 mismatches.
    const allText: CellKind[] = Array(9).fill("text");
    const r8 = fitBlock(shape(renamed, allText), [hole], []);
    expect(r8.fit).toBe("none");
    // One numeric column fits: 7 mismatches and one rename is exactly 600.
    const oneNumber: CellKind[] = [...allText];
    oneNumber[2] = "decimal";
    const r7 = fitBlock(shape(renamed, oneNumber), [hole], []);
    expect(r7.fit).toBe("near");
    expect(r7.diff!.kindMismatch.length).toBe(7);
    expect(r7.score).toBe(600);
  });
});

describe("fitBlock: choosing", () => {
  test("two different targets within 50 points give none, with both listed", () => {
    // A header set that fits the built-in customers (950) and, through a learned hole, a vendors layout at 940.
    const H = ["name", "gstin"];
    const vendorsHole: LearnedHole = {
      holeId: "v", holeVersionId: "v1", name: "Vendors", version: 1,
      recipe: {
        schemaVersion: 1, target: "vendors", headerRow: 0, headerRows: 1,
        match: { headerKey: headerKey(["name", "gstin", "zz"]), headers: ["name", "gstin", "zz"] },
        fields: [
          { field: "name", source: { kind: "columns", cols: [{ col: 0, header: "name" }] }, steps: [] },
          { field: "gstin", source: { kind: "columns", cols: [{ col: 1, header: "gstin" }] }, steps: [] },
        ],
        filters: [], keys: ["name"], onExisting: "ask", unclear: [],
      },
    };
    const r = fitBlock(shape(H, ["text", "text"]), [vendorsHole]);
    expect(r.fit).toBe("none");
    expect(r.tie).toBe(true);
    expect(r.alternatives.map((a) => a.target).sort()).toEqual(["customers", "vendors"]);
  });

  test("rebaseRecipe leaves constants and period sources alone", () => {
    const base = customersRecipe();
    base.fields.push({ field: "notes", source: { kind: "constant", value: "x" }, steps: [] });
    const out = rebaseRecipe(base, new Map([[0, 0]]), shape(H6, text6));
    expect(out.fields.at(-1)!.source).toEqual({ kind: "constant", value: "x" });
  });
});
