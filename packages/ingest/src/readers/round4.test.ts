import { describe, expect, test } from "bun:test";

import { readSheet } from "./blocks";
import { readCsvBlocks } from "./csv";
import { readPdfText, type TextItem } from "./pdf-text";
import { PREVIEW_ROWS } from "./types";

// PORTAL-RULES-3 section 4.1: a block carries a guess, a preview, rows and warnings. No confidence.
const it = (str: string, x: number, y: number, width = str.length * 5): TextItem => ({ str, x, y, width, height: 10 });

describe("round 4, item 2: no confidence on a block", () => {
  test("sheet, CSV and PDF blocks carry no confidence and no reasons", () => {
    const sheet = readSheet([["Party", "Qty"], ["Om Metals", 12]]).blocks[0]!;
    const csv = readCsvBlocks("Party,Qty\nOm Metals,12\n")[0]!;
    const pdf = readPdfText([[it("Party", 50, 770), it("Qty", 150, 770), it("Om Metals", 50, 755), it("12", 150, 755)]]).blocks[0]!;
    for (const b of [sheet, csv, pdf]) {
      expect("confidence" in b).toBe(false);
      expect("reasons" in b).toBe(false);
      expect(b.guess.headerRow).toBe(0);
    }
  });

  test("PDF preview rows carry the page", () => {
    const blank: TextItem[] = [];
    const pdf = readPdfText([blank, [it("Party", 50, 770), it("Qty", 150, 770), it("Om Metals", 50, 755), it("12", 150, 755)]]).blocks[0]!;
    expect(pdf.preview[0]).toEqual({ row: 0, page: 2, cells: ["Party", "Qty"] });
  });

  test("R4-7: a long title moves the preview window so the guessed header and the rows under it are inside", () => {
    const title = Array.from({ length: 14 }, (_, i) => [`Note line ${i + 1}`]);
    const read = readSheet([...title, ["Party", "Qty"], ["Om Metals", 12], ["Kamal", 6]]);
    const b = read.blocks[0]!;
    expect(b.guess.headerRow).toBe(14);
    expect(b.preview.length).toBeLessThanOrEqual(PREVIEW_ROWS);
    const rows = b.preview.map((p) => p.row);
    expect(rows).toContain(14);
    expect(rows).toContain(15);
    expect(rows).toContain(16);
    expect(rows).toContain(13);
  });

  test("R4-7: the same for a PDF page", () => {
    const lines: TextItem[] = [];
    for (let i = 0; i < 14; i++) lines.push(it(`Note line ${i + 1}`, 50, 800 - i * 15));
    lines.push(it("Party", 50, 590), it("Qty", 150, 590), it("Om Metals", 50, 575), it("12", 150, 575), it("Kamal", 50, 560), it("6", 150, 560));
    const b = readPdfText([lines]).blocks[0]!;
    expect(b.guess.headerRow).toBe(14);
    const rows = b.preview.map((p) => p.row);
    expect(b.preview.length).toBeLessThanOrEqual(PREVIEW_ROWS);
    expect(rows).toContain(14);
    expect(rows).toContain(15);
  });

  test("a blank-value word is not text when the reader looks for the header", () => {
    // R4 minor: "R 2105 | -" is a data row, not the header under "Stock statement".
    const read = readSheet([["Stock statement"], ["Item", 12], ["K 1100", 963], ["T 4012", 926], ["R 2105", "-"], ["K 1100", 815]]);
    expect(read.blocks[0]!.guess.headerRow).toBe(1);
    expect(read.blocks[0]!.rows.length).toBe(4);
  });
});
