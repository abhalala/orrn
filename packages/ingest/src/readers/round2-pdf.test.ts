import { describe, expect, test } from "bun:test";

import { readPdfText, type TextItem } from "./pdf-text";

// Fix round 3, round 2: PDF pages where a table the reader could not head was dropped or joined while sure (R3-3), and
// a later data row taken as a header (R3-9). Synthetic pages only.

const it = (str: string, x: number, y: number): TextItem => ({ str, x, y, width: str.length * 5, height: 10 });
const L = (y: number, cells: [string, number][]) => cells.map(([s, x]) => it(s, x, y));
const X = [50, 150, 250, 300];
const line = (y: number, ...cells: string[]) => cells.flatMap((s, i) => (s === "" ? [] : [it(s, X[i]!, y)]));

/** Every line of every page is in a block's region or in rowWarnings. */
function everyLineAccounted(pages: TextItem[][]) {
  const r = readPdfText(pages);
  const seen = new Set(r.rowWarnings.map((w) => `${w.page}:${w.row}`));
  for (const b of r.blocks) {
    for (const p of b.preview) seen.add(`${b.guess.page}:${p.row}`);
    for (let n = b.guess.headerRow; n <= (b.guess.lastPage === b.guess.page ? (b.guess.lastDataRow ?? 0) : 999); n++) seen.add(`${b.guess.page}:${n}`);
    for (const w of b.warnings) seen.add(`${w.page}:${w.row}`);
  }
  return { r, seen };
}

describe("R3-3: a table the reader cannot head is never dropped or joined while sure", () => {
  test("a table with a number header above another table", () => {
    const page = [
      ...L(800, [["Section", 50], ["12", 160], ["14", 260]]),
      ...L(785, [["T 4012", 50], ["20", 160], ["30", 260]]),
      ...L(770, [["R 2105", 50], ["5", 160], ["6", 260]]),
      ...L(755, [["K 1100", 50], ["7", 160], ["8", 260]]),
      ...L(710, [["Die", 50], ["Hours", 260]]),
      ...L(695, [["D 1", 50], ["3", 260]]),
      ...L(680, [["D 2", 50], ["4", 260]]),
    ];
    const { r, seen } = everyLineAccounted([page]);
    for (const b of r.blocks) expect(b.confidence).toBe("unsure");
    for (let n = 0; n < 7; n++) expect(seen.has(`1:${n}`)).toBe(true);
    const h = readPdfText([page], { hints: [{ page: 1, headerRow: 0, lastDataRow: 3 }, { page: 1, headerRow: 4 }] });
    expect(h.blocks.map((b) => b.headers)).toEqual([["Section", "12", "14"], ["Die", "Hours"]]);
    expect(h.blocks[0]!.rows.length).toBe(3);
  });

  test("rows with no header above a table", () => {
    const page = [
      ...L(800, [["T4012", 50], ["20", 160], ["30", 260]]),
      ...L(785, [["R2105", 50], ["5", 160], ["6", 260]]),
      ...L(740, [["Party", 50], ["Section", 160], ["Qty", 260]]),
      ...L(725, [["Om Metals", 50], ["T 4012", 160], ["30", 260]]),
    ];
    const { r, seen } = everyLineAccounted([page]);
    for (const b of r.blocks) expect(b.confidence).toBe("unsure");
    for (let n = 0; n < 4; n++) expect(seen.has(`1:${n}`)).toBe(true);
  });

  test("a new table on page 2 at the same x is not joined to page 1", () => {
    const pages = [
      [...L(800, [["Party", 50], ["Section", 160], ["Qty", 260]]), ...L(785, [["Om Metals", 50], ["T 4012", 160], ["30", 260]]), ...L(770, [["Kamal", 50], ["R 2105", 160], ["6", 260]])],
      [...L(800, [["Section", 50], ["12", 160], ["14", 260]]), ...L(785, [["T 4012", 50], ["20", 160], ["30", 260]]), ...L(770, [["R 2105", 50], ["5", 160], ["6", 260]])],
    ];
    const r = readPdfText(pages);
    for (const b of r.blocks) expect(b.confidence).toBe("unsure");
    expect(r.blocks[0]!.rows).toEqual([["Om Metals", "T 4012", "30"], ["Kamal", "R 2105", "6"]]);
    expect(r.blocks.length).toBe(2);
    expect(r.blocks[1]!.headers).toEqual(["Section", "12", "14"]);
  });

  test("a page 2 continuation with no header of its own is unsure, and joined", () => {
    const pages = [
      [...line(770, "Party", "Section", "Qty", "Kg"), ...line(755, "Om Metals", "R 2105", "12", "1200"), ...line(740, "Kamal", "R 2106", "5", "500")],
      [...line(800, "Asha", "T 4012", "6", "600"), ...line(785, "Zenith", "K 1100", "7", "700")],
    ];
    const r = readPdfText(pages);
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.rows.length).toBe(4);
    expect(r.blocks[0]!.reasons).toContain("continued_without_header");
  });

  test("lines far under a table that make no table are listed", () => {
    const table = [...line(770, "Party", "Section", "Qty", "Kg"), ...line(755, "Om Metals", "R 2105", "12", "1200"), ...line(740, "Kamal", "R 2106", "5", "500")];
    const noted = readPdfText([[...table, it("Rajkot depot stock", 120, 600)]]);
    expect(noted.rowWarnings).toContainEqual({ code: "not_placed", row: 3, page: 1 });
    expect(noted.blocks[0]!.reasons).toContain("line_not_placed");
    // A signature or a thank-you note is left out on purpose and listed with the table.
    const thanked = readPdfText([[...table, it("Thank you", 120, 600)]]);
    expect(thanked.blocks[0]!.warnings).toContainEqual({ code: "footer_left_out", row: 3, page: 1 });
    expect(thanked.blocks[0]!.reasons).toContain("rows_left_out");
  });
});

describe("R3-9: a data row with a word in one number column is not taken as a header", () => {
  test("Nil and Cancelled under Qty and Kg stay a row", () => {
    const page = [...line(770, "Party", "Section", "Qty", "Kg"), ...line(755, "Om Metals", "R 2105", "12", "1200"), ...line(740, "Shree", "T 4012", "Nil", "Cancelled"), ...line(725, "Kamal", "R 2106", "5", "500")];
    const r = readPdfText([page]);
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.headers).toEqual(["Party", "Section", "Qty", "Kg"]);
    expect(r.blocks[0]!.rows).toEqual([["Om Metals", "R 2105", "12", "1200"], ["Shree", "T 4012", "Nil", "Cancelled"], ["Kamal", "R 2106", "5", "500"]]);
    expect(r.blocks[0]!.confidence).toBe("unsure");
    expect(r.blocks[0]!.reasons).toContain("word_in_number_column");
  });

  test("a second table's header right under the rows still starts a new table", () => {
    const page = [
      ...line(770, "Party", "Section", "Qty", "Kg"),
      ...line(755, "Om Metals", "R 2105", "12", "1200"),
      ...line(740, "Kamal", "R 2106", "5", "500"),
      ...line(725, "Party", "Bundles", "Pieces", "Total Kg"),
      ...line(710, "Om Metals", "3", "40", "1200"),
    ];
    const r = readPdfText([page]);
    expect(r.blocks.map((b) => b.headers[1])).toEqual(["Section", "Bundles"]);
  });
});

describe("a page that repeats the title of a table above but whose header differs", () => {
  test("both blocks are unsure: one of the two guesses is wrong", () => {
    const pages = [
      [
        it("Despatch Register 2025-26", 74, 800),
        it("Fourcubes Extrusions", 57, 775), it("Rajkot", 172, 775),
        it("Sr", 57, 758), it("Party", 102, 758), it("Section", 217, 758), it("Kg", 277, 758),
        it("1", 57, 741), it("Kamal Bros", 102, 741), it("R 2105", 217, 741), it("6889", 267, 741),
        it("2", 57, 724), it("Zenith Traders", 102, 724), it("R 2106", 217, 724), it("4699", 267, 724),
      ],
      [
        it("Despatch Register 2025-26 Fourcubes Extrusions Rajkot", 50, 800),
        it("Sr", 57, 778), it("Party", 102, 778), it("Section", 217, 778), it("Kg", 277, 778),
        it("3", 57, 761), it("Zenith Traders", 102, 761), it("R 2105", 217, 761), it("7989", 267, 761),
      ],
    ];
    const r = readPdfText(pages);
    for (const b of r.blocks) expect(b.confidence).toBe("unsure");
  });
});
