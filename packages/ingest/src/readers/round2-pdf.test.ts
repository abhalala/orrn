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
