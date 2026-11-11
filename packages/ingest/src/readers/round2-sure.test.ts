import { describe, expect, test } from "bun:test";

import { readSheet } from "./blocks";
import { readCsv } from "./csv";
import { readPdfText, type TextItem } from "./pdf-text";

// Fix round 3, round 2: layouts the checker found sure and wrong. Each must come out unsure, and the right table must
// be reachable by hints. Synthetic sheets and pages only.

const it = (str: string, x: number, y: number): TextItem => ({ str, x, y, width: str.length * 5, height: 10 });
const X = [50, 150, 250, 300];
const line = (y: number, ...cells: string[]) => cells.flatMap((s, i) => (s === "" ? [] : [it(s, X[i]!, y)]));
const apr = new Date(Date.UTC(2025, 3, 1));

describe("R3-1: a text row above a header of numbers or dates is not sure", () => {
  test("colon line over lengths", () => {
    const m = [["Party: Om Metals", "City: Rajkot", "FY: 2025-26"], ["Section", 12, 16], ["T 4012", 20, 30], ["R 2105", 5, 6]];
    const [b] = readSheet(m).blocks;
    expect(b!.confidence).toBe("unsure");
    expect(b!.reasons).toContain("first_row_like_header");
    expect(b!.reasons).toContain("header_like_title");
    const [h] = readSheet(m, { hints: [{ headerRow: 1 }] }).blocks;
    expect(h!.headers).toEqual(["Section", "12", "16"]);
    expect(h!.rows).toEqual([["T 4012", "20", "30"], ["R 2105", "5", "6"]]);
  });

  test("letterhead over years", () => {
    const m = [["Fourcubes Extrusions", "Rajkot", "Gujarat"], ["Section", 2024, 2025], ["T 4012", 20, 30], ["R 2105", 5, 6]];
    const [b] = readSheet(m).blocks;
    expect(b!.confidence).toBe("unsure");
    expect(b!.reasons).toContain("first_row_like_header");
    expect(readSheet(m, { hints: [{ headerRow: 1 }] }).blocks[0]!.headers).toEqual(["Section", "2024", "2025"]);
  });

  test("two-cell title over a month date", () => {
    const m = [["Sales Summary", "Fourcubes"], ["Party", apr], ["Om Metals", 120], ["Asha", 30]];
    const [b] = readSheet(m).blocks;
    expect(b!.confidence).toBe("unsure");
    expect(b!.reasons).toContain("first_row_like_header");
    expect(readSheet(m, { hints: [{ headerRow: 1 }] }).blocks[0]!.headers).toEqual(["Party", "2025-04-01"]);
  });

  test("CSV letterhead over lengths", () => {
    const r = readCsv("Stock report, Fourcubes, Rajkot\nSection,12,16\nT 4012,1,2\n");
    expect(r.blocks[0]!.confidence).toBe("unsure");
    expect(r.blocks[0]!.reasons).toContain("first_row_like_header");
    const h = readCsv("Stock report, Fourcubes, Rajkot\nSection,12,16\nT 4012,1,2\n", { hints: [{ headerRow: 1 }] });
    expect(h.blocks[0]!.rows).toEqual([["T 4012", "1", "2"]]);
  });

  test("PDF colon line over lengths at the same x", () => {
    const page = [...line(785, "Party: Om", "City: Rajkot", "FY: 2025-26"), ...line(770, "Section", "12", "16"), ...line(755, "T 4012", "20", "30"), ...line(740, "R 2105", "5", "6")];
    const r = readPdfText([page]);
    expect(r.blocks.length).toBeGreaterThan(0);
    for (const b of r.blocks) expect(b.confidence).toBe("unsure");
    const h = readPdfText([page], { hints: [{ page: 1, headerRow: 1 }] });
    expect(h.blocks[0]!.headers).toEqual(["Section", "12", "16"]);
    expect(h.blocks[0]!.rows).toEqual([["T 4012", "20", "30"], ["R 2105", "5", "6"]]);
  });

  test("a letterhead or a key and value line over a header with one number", () => {
    for (const m of [
      [["Fourcubes Extrusions", "Rajkot"], ["Party", 12], ["Om Metals", 133], ["Asha", 222]],
      [["Customer", "Om Metals"], ["Phone", 9876543210], ["Party", 2023], ["Kamal Bros", 323]],
    ]) {
      const [b] = readSheet(m).blocks;
      expect(b!.confidence).toBe("unsure");
      expect(b!.reasons).toContain("first_row_like_header");
    }
  });

  test("a plain table with a serial column stays sure", () => {
    const [b] = readSheet([["Sr", "Party", "Qty"], [1, "Om Metals", 12], [2, "Kamal", 4]]).blocks;
    expect(b!.confidence).toBe("sure");
  });
});

describe("R3-2: column numbers or a second header row of numbers under the header are not sure", () => {
  test("column numbers under the names", () => {
    const m = [["Sr", "Party", "Qty"], [1, 2, 3], [1, "Om Metals", 12], [2, "Kamal", 4]];
    const [b] = readSheet(m).blocks;
    expect(b!.confidence).toBe("unsure");
    expect(b!.reasons).toContain("first_row_like_header");
    const [h] = readSheet(m, { hints: [{ headerRow: 0, firstDataRow: 2 }] }).blocks;
    expect(h!.rows).toEqual([["1", "Om Metals", "12"], ["2", "Kamal", "4"]]);
  });

  test("sizes under a repeated name", () => {
    const m = [["Section", "Qty", "Qty"], ["", 12, 16], ["T 4012", 4, 5], ["R 2105", 6, 7]];
    const [b] = readSheet(m).blocks;
    expect(b!.confidence).toBe("unsure");
    expect(b!.reasons).toContain("header_repeated");
    const [h] = readSheet(m, { hints: [{ headerRow: 0, headerRows: 2 }] }).blocks;
    expect(h!.headers).toEqual(["Section", "Qty 12", "Qty 16"]);
    expect(h!.rows).toEqual([["T 4012", "4", "5"], ["R 2105", "6", "7"]]);
  });

  test("PDF column numbers under the names", () => {
    const page = [...line(770, "Party", "Section", "Qty", "Kg"), ...line(755, "1", "2", "3", "4"), ...line(740, "Om Metals", "R 2105", "12", "1200"), ...line(725, "Kamal", "R 2106", "5", "500")];
    const r = readPdfText([page]);
    for (const b of r.blocks) expect(b.confidence).toBe("unsure");
    const h = readPdfText([page], { hints: [{ page: 1, headerRow: 0, firstDataRow: 2 }] });
    expect(h.blocks[0]!.rows).toEqual([["Om Metals", "R 2105", "12", "1200"], ["Kamal", "R 2106", "5", "500"]]);
  });
});
