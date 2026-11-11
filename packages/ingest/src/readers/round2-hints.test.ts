import { describe, expect, test } from "bun:test";

import { findBlocks, HintError, readSheet } from "./blocks";
import { readPdfText, type TextItem } from "./pdf-text";
import type { BlockHints } from "./types";
import { asked, picked } from "./trust-helpers";

// Fix round 3, round 2: hints that are not well formed fail with HintError (R3-8), and a hint for one block leaves
// the rest of the sheet to the guess (R3-7). Synthetic sheets and pages only.

const bad = (h: unknown) => h as BlockHints;

describe("R3-8: a hint that is not well formed is a HintError", () => {
  const m = [["Party: Om Metals", "City: Rajkot"], ["Section", 12, 16], ["T 4012", 20, 30], ["R 2105", 5, 6], [], ["Prepared by", "Checked by"]];
  const cases: [string, unknown][] = [
    ["three header rows", { headerRow: 1, headerRows: 3 }],
    ["no header rows", { headerRow: 1, headerRows: 0 }],
    ["a first data row that is not a number", { headerRow: 1, firstDataRow: Number.NaN }],
    ["a first data row between rows", { headerRow: 1, firstDataRow: 2.5 }],
    ["a last data row between rows", { headerRow: 1, lastDataRow: 3.5 }],
    ["a header row that is text", { headerRow: "1" }],
  ];
  for (const [name, h] of cases) {
    test(`sheet: ${name}`, () => {
      let err: unknown = null;
      try {
        readSheet(m, { hints: [bad(h)] });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(HintError);
      expect((err as HintError).code).toBe("hint_out_of_range");
    });
  }

  const it = (str: string, x: number, y: number): TextItem => ({ str, x, y, width: str.length * 5, height: 10 });
  const page = [it("Party", 50, 770), it("Qty", 150, 770), it("Om", 50, 755), it("12", 150, 755), it("Kamal", 50, 740), it("5", 150, 740)];
  for (const [name, h] of cases) {
    test(`pdf: ${name}`, () => {
      let err: unknown = null;
      try {
        const hb = h as BlockHints;
        readPdfText([page], { hints: [bad({ ...hb, page: 1, headerRow: typeof hb.headerRow === "number" ? 0 : hb.headerRow })] });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(HintError);
      expect((err as HintError).code).toBe("hint_out_of_range");
    });
  }
});

describe("R3-7: a hint for one block leaves the other blocks to the guess", () => {
  const m = [["Stock statement"], ["Party", "Qty"], ["Om", 1], ["Kamal", 2], [], ["Section", "Kg"], ["T 4012", 3], ["R 2105", 4]];

  test("a hint on the first table keeps the second table as guessed", () => {
    const r = readSheet(m, { hints: [{ headerRow: 1 }] });
    expect(r.blocks.map((b) => b.headers)).toEqual([["Party", "Qty"], ["Section", "Kg"]]);
    expect(r.blocks[0]!.rows).toEqual([["Om", "1"], ["Kamal", "2"]]);
    expect(r.blocks[0]!.title).toBe("Stock statement");
    expect(picked(r.blocks[0]!)).toBe(true);
    expect(r.blocks[1]!.rows).toEqual([["T 4012", "3"], ["R 2105", "4"]]);
    expect(r.blocks[1]!.hints).toBeNull();
    expect(asked(r.blocks[1]!)).toBe(true);
  });

  test("a hint on the second table keeps the first table as guessed", () => {
    const r = readSheet(m, { hints: [{ headerRow: 5 }] });
    expect(r.blocks.map((b) => b.headers)).toEqual([["Party", "Qty"], ["Section", "Kg"]]);
    expect(r.blocks[0]!.title).toBe("Stock statement");
    expect(r.blocks[0]!.rows).toEqual([["Om", "1"], ["Kamal", "2"]]);
    expect(r.blocks[1]!.title).toBeNull();
    expect(r.blocks[1]!.rows).toEqual([["T 4012", "3"], ["R 2105", "4"]]);
    expect(picked(r.blocks[1]!)).toBe(true);
  });

  test("a table the guess joined to the one above: the hint splits it, the part above is guessed again", () => {
    const merged = [["Party", "Qty"], ["Om", 1], ["Kamal", 2], ["Section", "Kg"], ["T 4012", 3]];
    expect(findBlocks(merged).length).toBe(1);
    const blocks = findBlocks(merged, { hints: [{ headerRow: 3 }] });
    expect(blocks.map((b) => [b.headers, b.rows, b.title])).toEqual([
      [["Party", "Qty"], [["Om", "1"], ["Kamal", "2"]], null],
      [["Section", "Kg"], [["T 4012", "3"]], null],
    ]);
    expect(asked(blocks[0]!)).toBe(true);
  });

  test("a row of two or more cells kept as the title of a hinted block is a warning", () => {
    const m2 = [["Fourcubes Extrusions", "Rajkot"], ["Section", 12, 16], ["T 4012", 20, 30]];
    const r = readSheet(m2, { hints: [{ headerRow: 1 }] });
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.title).toBe("Fourcubes Extrusions Rajkot");
    expect(r.blocks[0]!.warnings).toEqual([{ code: "kept_as_title", row: 0 }]);
    expect(r.warnings).toEqual([]);
  });
});

describe("hint cases the extended property found", () => {
  test("key and value lines above a hinted header are its title, not a table", () => {
    const m = [["Customer", "Om Metals"], ["Phone", 9876543210], ["Party", 12, 14, 16], ["Om Metals", 470, 30, 354], ["Asha", 136, 140, 6]];
    const r = readSheet(m, { hints: [{ headerRow: 2 }] });
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.title).toBe("Customer Om Metals Phone 9876543210");
    expect(r.blocks[0]!.headers).toEqual(["Party", "12", "14", "16"]);
  });

  test("pdf: skipped column numbers still give the row pitch, so a one-cell row stays a row", () => {
    const it = (str: string, x: number, y: number): TextItem => ({ str, x, y, width: str.length * 5, height: 10 });
    const page = [
      it("Party", 41, 800), it("Section", 136, 800), it("Pcs", 196, 800), it("Kg", 256, 800),
      it("1", 41, 789), it("2", 136, 789), it("3", 206, 789), it("4", 256, 789),
      it("Om Metals", 41, 778), it("R 2105", 136, 778), it("4449", 191, 778), it("9", 256, 778),
      it("Shree Ganesh", 41, 767),
    ];
    const r = readPdfText([page], { hints: [{ page: 1, headerRow: 0, firstDataRow: 2 }] });
    expect(r.blocks[0]!.rows).toEqual([["Om Metals", "R 2105", "4449", "9"], ["Shree Ganesh", "", "", ""]]);
  });
});
