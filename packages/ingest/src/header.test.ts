import { describe, expect, test } from "bun:test";

import { chooseHeader, type HeaderInput } from "./header";
import type { LearnedHole } from "./fit";
import { EXAMPLE_BAKI_RECIPE, BAKI_SHEET_HEADERS } from "./recipe-fixtures";
import { layoutOf } from "./readers/trust-helpers";

/** A preview from raw rows, numbered from `from`. */
function input(rows: string[][], guess: number, headerRows: 1 | 2 = 1, from = 0): HeaderInput {
  return { preview: rows.map((cells, i) => ({ row: from + i, cells })), guess: { headerRow: guess, headerRows } };
}

const DIE_HEADER = ["Series", "Section code", "Min weight (kg/12ft)", "Max weight (kg/12ft)"];
const DIE_ROWS = [
  ["40", "4012", "2.2", "2.5"],
  ["25", "2105", "1.1", "1.4"],
  ["40", "4013", "3.0", "3.3"],
];
const CUSTOMER_HEADER = ["Name", "Phone", "City"];
const CUSTOMER_ROWS = [
  ["Om Metals", "9825012345", "Rajkot"],
  ["Kamal Bros", "9825054321", "Morbi"],
];

describe("chooseHeader: a row that fits", () => {
  test("the guess fits a built-in layout", () => {
    const r = chooseHeader(input([DIE_HEADER, ...DIE_ROWS], 0));
    expect(r.kind).toBe("fits");
    if (r.kind !== "fits") return;
    expect(r.headerRow).toBe(0);
    expect(r.headerRows).toBe(1);
    expect(r.fit.target).toBe("dies");
    expect(r.fit.fit).toBe("exact");
  });

  test("a letterhead above the real header: the real header fits, the letterhead does not", () => {
    const r = chooseHeader(input([["Fourcubes Extrusions", "Rajkot", "Gujarat", "India"], DIE_HEADER, ...DIE_ROWS], 0));
    expect(r).toMatchObject({ kind: "fits", headerRow: 1, headerRows: 1 });
  });

  test("a title line above the real header, row numbers from the sheet", () => {
    const r = chooseHeader(input([["Customer list"], CUSTOMER_HEADER, ...CUSTOMER_ROWS], 4, 1, 4));
    expect(r).toMatchObject({ kind: "fits", headerRow: 5, headerRows: 1 });
  });

  test("a column-number row under the header, guessed as the header", () => {
    const r = chooseHeader(input([DIE_HEADER, ["1", "2", "3", "4"], ...DIE_ROWS], 1));
    expect(r).toMatchObject({ kind: "fits", headerRow: 0, headerRows: 1 });
  });

  // Round 5, rule 5.1 (M2): a two-row header fits only as an exact fit of an approved two-row layout. This pinned a
  // built-in fit as two rows; now it pins "ask", and "fits" once the plant has approved the two-row layout.
  test("a two-row header asks, and fits as two rows once the two-row layout is approved", () => {
    const rows = [["Series", "Section code", "Weight (kg/12ft)", ""], ["", "", "Min", "Max"], ...DIE_ROWS];
    expect(chooseHeader(input(rows, 0, 1)).kind).toBe("ask");
    const two = layoutOf(["Series", "Section code", "Weight (kg/12ft) Min", "Weight (kg/12ft) Max"], "dies-two", 2);
    expect(chooseHeader(input(rows, 0, 1), { learned: [two] })).toMatchObject({ kind: "fits", headerRow: 0, headerRows: 2 });
  });

  test("an approved layout of the plant fits, and beats a built-in near fit", () => {
    const hole: LearnedHole = { holeId: "h", holeVersionId: "hv", name: "Baki", version: 1, recipe: EXAMPLE_BAKI_RECIPE };
    const data = ["1", "Om Metals", "PO-12", "14/10/2025", "T 4012", "1.8", "2500", "0", "2500", "210", ""];
    const r = chooseHeader(input([["Baki register 2025-26"], [...BAKI_SHEET_HEADERS], data, data], 0), { learned: [hole] });
    expect(r).toMatchObject({ kind: "fits", headerRow: 1 });
    if (r.kind === "fits") expect(r.fit.learned).toBe(true);
  });

  // Round 5, rule 5.1 (M1): the top-most exact fit wins. This pinned "the guess wins a tie"; now the top row wins,
  // and an exact row below the guess's data rows is asked about.
  test("two rows of the same layout: the top-most wins, and a lower one under the guess's rows asks", () => {
    const rows = [CUSTOMER_HEADER, ...CUSTOMER_ROWS, CUSTOMER_HEADER, ...CUSTOMER_ROWS];
    expect(chooseHeader(input(rows, 3))).toMatchObject({ kind: "fits", headerRow: 0 });
    expect(chooseHeader(input(rows, 0))).toMatchObject({ kind: "fits", headerRow: 0 });
  });

  // Round 5, rule 5.1: a near fit is never trusted. This pinned an exact row below a near guess as the fit; the exact
  // row sits under the guess's own rows, so it may be a second table, and the answer is "ask" naming it.
  test("a near guess over an exact row lower down: ask, naming the exact row", () => {
    const rows = [["Name", "Phone", "Received", "Issued"], ["Om Metals", "1", "2", "3"], [], DIE_HEADER, ...DIE_ROWS];
    const r = chooseHeader(input(rows, 0));
    expect(r.kind).toBe("ask");
    if (r.kind !== "ask") return;
    expect(r.resembles).toMatchObject({ headerRow: 3, fit: "exact", target: "dies" });
    expect(r.candidates[0]).toEqual({ headerRow: 3, headerRows: 1 });
  });
});

describe("chooseHeader: nothing fits", () => {
  test("a header no layout knows: ask, with the guess first", () => {
    const rows = [["Stock statement"], ["Item", "Opening", "Received", "Issued"], ["K 1100", "12", "4", "6"], ["T 4012", "9", "1", "2"]];
    const r = chooseHeader(input(rows, 1));
    expect(r.kind).toBe("ask");
    if (r.kind !== "ask") return;
    expect(r.guess).toEqual({ headerRow: 1, headerRows: 1 });
    expect(r.candidates[0]).toEqual({ headerRow: 1, headerRows: 1 });
    // Every row of two or more cells is a candidate; the one-cell title is not.
    expect(r.candidates.map((c) => c.headerRow).sort()).toEqual([1, 2, 3]);
  });

  test("a title that only looks like a column name does not fit", () => {
    const rows = [["Customer list", "Rajkot", "Gujarat", "India"], ["Firm", "Mob", "Town", "Since"], ["Om Metals", "98250", "Rajkot", "2019"]];
    expect(chooseHeader(input(rows, 0)).kind).toBe("ask");
  });

  test("a key and value line over a wider table does not fit", () => {
    const rows = [["Name", "Om Metals"], ["Firm", "Mob", "Town", "Since"], ["Om Metals", "98250", "Rajkot", "2019"], ["Kamal", "98251", "Morbi", "2020"]];
    expect(chooseHeader(input(rows, 1)).kind).toBe("ask");
  });

  test("a near fit with one column name is not enough", () => {
    const rows = [["Party", "Section", "Qty", "Kg"], ["Om Metals", "R 2105", "12", "1200"], ["Kamal", "T 4012", "6", "600"]];
    expect(chooseHeader(input(rows, 0)).kind).toBe("ask");
  });

  test("an empty preview asks with no candidates but the guess", () => {
    const r = chooseHeader({ preview: [], guess: { headerRow: 0 } });
    // Round 7 (rule 6.1) added the two join offers to every "ask". Round 8 (rule 8.1) removed `continuesAbove` (the
    // "continues" offer is `follows.continues` on the block); with no block above `sameColumnsAsAbove` is false.
    expect(r).toEqual({ kind: "ask", guess: { headerRow: 0, headerRows: 1 }, candidates: [], resembles: null, sameColumnsAsAbove: false });
  });
});
