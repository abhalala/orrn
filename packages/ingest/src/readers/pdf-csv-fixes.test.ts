import { describe, expect, test } from "bun:test";

import { detectDelimiter } from "./csv";
import { readPdfText, readPdfTextBlocks, textItemsToMatrix, type TextItem } from "./pdf-text";

// Synthetic pages for the review 1 findings. No real plant data.
const it = (str: string, x: number, y: number, width = str.length * 5): TextItem => ({ str, x, y, width, height: 10 });
const header = (y: number) => [it("Sr", 50, y), it("Section", 100, y), it("Qty", 240, y), it("Weight", 300, y)];
const row = (y: number, sr: string, sec: string, qty: string, wt: string) => [it(sr, 50, y), it(sec, 100, y), it(qty, 245, y), it(wt, 320, y)];
const page1 = [it("PACKING LIST 31.10.2025", 50, 800), ...header(770), ...row(755, "1", "R 2105", "25", "1200"), ...row(740, "2", "R 2106", "8", "980")];

describe("C16: a continuation page with no repeated header keeps its rows", () => {
  test("page 2 with data rows only", () => {
    const page2 = [...row(800, "3", "T 4012", "5", "410"), ...row(785, "4", "T 4013", "6", "420")];
    const r = readPdfText([page1, page2]);
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.rows.map((x) => x[0])).toEqual(["1", "2", "3", "4"]);
    expect(r.warnings).toEqual([]);
    expect(readPdfTextBlocks([page1, page2])[0]!.rows.length).toBe(4);
  });

  test("a page with text that gives no block and no rows is a warning", () => {
    const r = readPdfText([page1, [it("Thank you for your business", 50, 500)]]);
    expect(r.blocks[0]!.rows.length).toBe(2);
    expect(r.warnings).toEqual(["page 2: text but no table"]);
  });
});

describe("C17: page footers and wrapped cell lines", () => {
  test("'Page 1 of 3' far below the table is not a row", () => {
    const r = readPdfTextBlocks([[...page1, it("Page 1 of 3", 250, 100)]]);
    expect(r[0]!.rows.length).toBe(2);
  });

  test("a two-cell footer does not block the merge with page 2", () => {
    const footer = [it("Printed 10/11/2025", 50, 100), it("Page 1 of 3", 300, 100)];
    const page2 = [...header(800), ...row(785, "3", "T 4012", "5", "410")];
    const r = readPdfTextBlocks([[...page1, ...footer], page2]);
    expect(r.length).toBe(1);
    expect(r[0]!.rows.map((x) => x[0])).toEqual(["1", "2", "3"]);
  });

  test("a wrapped line in one cell joins the cell above", () => {
    const items = [...header(770), ...row(755, "1", "R 2105 long", "25", "1200"), it("description", 100, 746), ...row(735, "2", "R 2106", "8", "980")];
    const m = textItemsToMatrix(items);
    expect(m).toEqual([
      ["Sr", "Section", "Qty", "Weight"],
      ["1", "R 2105 long description", "25", "1200"],
      ["2", "R 2106", "8", "980"],
    ]);
  });
});

describe("C35: delimiter detection under a title line", () => {
  test("a titled semicolon CSV is semicolon", () => {
    expect(detectDelimiter("Stock list\nSeries;Section;Qty\nR;2105;4\nR;2106;5\n")).toBe(";");
  });
  test("plain comma CSV stays comma", () => {
    expect(detectDelimiter("a,b,c\n1,2,3\n")).toBe(",");
  });
});
