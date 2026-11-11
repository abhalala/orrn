import { describe, expect, test } from "bun:test";

import { HintError, readSheet } from "./blocks";
import { readCsvBlocks } from "./csv";
import { readPdfText, type TextItem } from "./pdf-text";

// PORTAL-RULES-3 section 4.1, item 3: with hints the output follows them exactly, for sheets, CSV and PDF text.
const it = (str: string, x: number, y: number): TextItem => ({ str, x, y, width: str.length * 5, height: 10 });
/** Cells at x: "l" starts there, "r" ends there (right-aligned). */
const L = (y: number, cells: [string, number, "l" | "r"][]) => cells.map(([s, x, a]) => it(s, a === "l" ? x : x - s.length * 5, y));
const head = (y: number) => L(y, [["Party", 50, "l"], ["Section", 170, "l"], ["Pcs", 260, "l"], ["Kg", 340, "l"]]);
const row = (y: number, a: string, b: string, c: string, d: string) => L(y, [[a, 50, "l"], [b, 170, "l"], [c, 320, "r"], [d, 400, "r"]]);
const RIGHT_ALIGNED = [...head(800), ...row(785, "Om Metals", "R 2105", "12", "1200"), ...row(770, "Kamal", "T 4012", "6", "600"), ...row(755, "Asha", "K 1100", "140", "14000")];
const WANT = [
  ["Om Metals", "R 2105", "12", "1200"],
  ["Kamal", "T 4012", "6", "600"],
  ["Asha", "K 1100", "140", "14000"],
];

describe("R4-5: a hinted PDF header owns one column per header cell", () => {
  for (const hint of [{ page: 1, headerRow: 0 }, { page: 1, headerRow: 0, firstDataRow: 1, lastDataRow: 3 }]) {
    test(`right-aligned values under short left-aligned names, ${JSON.stringify(hint)}`, () => {
      const r = readPdfText([RIGHT_ALIGNED], { hints: [hint] });
      expect(r.blocks.length).toBe(1);
      expect(r.blocks[0]!.headers).toEqual(["Party", "Section", "Pcs", "Kg"]);
      expect(r.blocks[0]!.rows).toEqual(WANT);
      expect(r.blocks[0]!.warnings).toEqual([]);
    });
  }

  test("a two-row hinted header: a group name over two right-aligned columns", () => {
    const top = L(800, [["Party", 50, "l"], ["Weight", 260, "l"]]);
    const bottom = L(785, [["Min", 260, "l"], ["Max", 340, "l"]]);
    const data = [...L(770, [["Om", 50, "l"], ["2.10", 320, "r"], ["2.40", 400, "r"]]), ...L(755, [["Asha", 50, "l"], ["1.15", 320, "r"], ["1.30", 400, "r"]])];
    const r = readPdfText([[...top, ...bottom, ...data]], { hints: [{ page: 1, headerRow: 0, headerRows: 2 }] });
    expect(r.blocks[0]!.headers).toEqual(["Party", "Weight Min", "Weight Max"]);
    expect(r.blocks[0]!.rows).toEqual([
      ["Om", "2.10", "2.40"],
      ["Asha", "1.15", "1.30"],
    ]);
  });

  // Round 5, rule 5.3: the columns are exactly the header's cells. This pinned a column with no name for values under
  // a blank header cell; it now pins the header's three columns, the value joined into the next band, and the row marked.
  test("values under no header cell, between two named columns, join a named column and the row is marked", () => {
    const page = [...L(800, [["Party", 50, "l"], ["Section", 170, "l"], ["Kg", 340, "l"]]), ...L(785, [["Om", 50, "l"], ["R 2105", 170, "l"], ["12", 320, "r"], ["1200", 400, "r"]])];
    const r = readPdfText([page], { hints: [{ page: 1, headerRow: 0 }] });
    expect(r.blocks[0]!.headers).toEqual(["Party", "Section", "Kg"]);
    expect(r.blocks[0]!.rows).toEqual([["Om", "R 2105", "12 1200"]]);
    expect(r.blocks[0]!.warnings).toEqual([]);
    expect(r.blocks[0]!.doubts).toContainEqual({ row: 0, code: "cells_joined", line: 1, page: 1 });
  });

  test("when two cells of a line fall under one header cell, the block says so", () => {
    const page = [...L(800, [["Party name here", 50, "l"], ["Kg", 340, "l"]]), ...L(785, [["Om", 50, "l"], ["Metals", 80, "l"], ["1200", 350, "r"]])];
    const r = readPdfText([page], { hints: [{ page: 1, headerRow: 0 }] });
    expect(r.blocks[0]!.headers).toEqual(["Party name here", "Kg"]);
    expect(r.blocks[0]!.rows).toEqual([["Om Metals", "1200"]]);
    // Round 5, rule 5.3: a row in doubt is marked in `doubts`. This pinned the round 4 warning `columns_not_matched`.
    expect(r.blocks[0]!.warnings).toEqual([]);
    expect(r.blocks[0]!.doubts.map((d) => [d.row, d.code])).toContainEqual([0, "cells_joined"]);
  });

  // Round 5, rule 5.3: the last band runs to the page edge, never a column with no name. This pinned an unnamed fourth
  // column; it now pins the remark in the last band.
  test("a remark far right of the last header cell is in the last column", () => {
    const page = [...L(800, [["Name", 50, "l"], ["Phone", 200, "l"], ["City", 300, "l"]]), ...L(785, [["Asha", 50, "l"], ["9898", 200, "l"], ["Surat", 300, "l"]]), ...L(770, [["Zenith", 50, "l"], ["closed", 420, "l"]])];
    const r = readPdfText([page], { hints: [{ page: 1, headerRow: 0 }] });
    expect(r.blocks[0]!.headers).toEqual(["Name", "Phone", "City"]);
    expect(r.blocks[0]!.rows).toEqual([
      ["Asha", "9898", "Surat"],
      ["Zenith", "", "closed"],
    ]);
  });
});

describe("hints that cannot be followed fail with HintError", () => {
  test("two sheet hints on one header row: hint_overlap", () => {
    const m = [["Party", "Qty"], ["Om", 1], ["Kamal", 2]];
    let err: unknown;
    try {
      readSheet(m, { hints: [{ headerRow: 0 }, { headerRow: 0 }] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HintError);
    expect((err as HintError).code).toBe("hint_overlap");
  });

  test("a PDF hint whose first data line is past the end of the header page", () => {
    const p1 = [...head(800), ...row(785, "Om Metals", "R 2105", "12", "1200")];
    const p2 = [...row(800, "Kamal", "T 4012", "6", "600")];
    expect(() => readPdfText([p1, p2], { hints: [{ page: 1, headerRow: 0, firstDataRow: 9, lastPage: 2, lastDataRow: 0 }] })).toThrow(HintError);
  });

  test("CSV hints follow exactly", () => {
    const [b] = readCsvBlocks("Stock list,,\nParty,Qty,Kg\n1,2,3\nOm,4,40\nKamal,5,50\n", { hints: [{ headerRow: 1, firstDataRow: 3 }] });
    expect(b!.headers).toEqual(["Party", "Qty", "Kg"]);
    expect(b!.rows).toEqual([
      ["Om", "4", "40"],
      ["Kamal", "5", "50"],
    ]);
    expect(b!.warnings).toEqual([
      { code: "kept_as_title", row: 0 },
      { code: "skipped_by_hint", row: 2 },
    ]);
  });
});
