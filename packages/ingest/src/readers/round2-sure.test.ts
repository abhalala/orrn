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

describe("R3-4: a footer of two cells right under the last row is not sure", () => {
  test("sheet", () => {
    const m = [["Party", "Section", "Qty"], ["Om Metals", "T 4012", 12], ["Kamal", "R 2105", 20], ["Prepared by", "Checked by", ""]];
    const [b] = readSheet(m).blocks;
    expect(b!.confidence).toBe("unsure");
    expect(b!.reasons).toContain("last_row_not_data");
    const [h] = readSheet(m, { hints: [{ headerRow: 0, lastDataRow: 2 }] }).blocks;
    expect(h!.rows).toEqual([["Om Metals", "T 4012", "12"], ["Kamal", "R 2105", "20"]]);
  });

  test("PDF, at the row pitch and a little below", () => {
    for (const gap of [15, 25]) {
      const page = [...line(770, "Party", "Section", "Qty", "Kg"), ...line(755, "Om Metals", "R 2105", "12", "1200"), ...line(740, "Kamal", "R 2106", "5", "500"), ...line(740 - gap, "Prepared by", "Checked by")];
      const r = readPdfText([page]);
      for (const b of r.blocks) expect(b.confidence).toBe("unsure");
      const h = readPdfText([page], { hints: [{ page: 1, headerRow: 0, lastDataRow: 2 }] });
      expect(h.blocks[0]!.rows).toEqual([["Om Metals", "R 2105", "12", "1200"], ["Kamal", "R 2106", "5", "500"]]);
    }
  });

  test("a total row with numbers stays a row and does not make it unsure", () => {
    const [b] = readSheet([["Party", "Section", "Qty"], ["Om Metals", "T 4012", 12], ["Kamal", "R 2105", 20], ["Total", "", 32]]).blocks;
    expect(b!.reasons).not.toContain("last_row_not_data");
  });
});

describe("R3-5: a table whose header holds numbers or dates still gives a guess", () => {
  test("stock by length", () => {
    const m = [["Section", 12, 14, 16], ["T 4012", 1, 2, 3], ["R 2105", 4, 5, 6]];
    const r = readSheet(m);
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.confidence).toBe("unsure");
    expect(r.blocks[0]!.reasons).toContain("header_not_text");
    expect(r.blocks[0]!.headers).toEqual(["Section", "12", "14", "16"]);
    expect(r.blocks[0]!.rows).toEqual([["T 4012", "1", "2", "3"], ["R 2105", "4", "5", "6"]]);
    expect(r.blocks[0]!.preview.map((p) => p.row)).toEqual([0, 1, 2]);
    expect(r.warnings).toEqual([]);
  });

  test("month-wise", () => {
    const m = [["Party", apr, new Date(Date.UTC(2025, 4, 1))], ["Om Metals", 12, 13], ["Asha", 3, 4]];
    const [b] = readSheet(m).blocks;
    expect(b!.confidence).toBe("unsure");
    expect(b!.headers).toEqual(["Party", "2025-04-01", "2025-05-01"]);
    expect(b!.rows.length).toBe(2);
  });

  test("PDF page with only such a table", () => {
    const page = [...line(770, "Section", "12", "14", "16"), ...line(755, "T 4012", "1", "2", "3"), ...line(740, "R 2105", "4", "5", "6")];
    const r = readPdfText([page]);
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.confidence).toBe("unsure");
    expect(r.blocks[0]!.headers).toEqual(["Section", "12", "14", "16"]);
    expect(r.blocks[0]!.rows.length).toBe(2);
  });

  test("a row of numbers with nothing under it is still no table", () => {
    const r = readSheet([["Total", 12]]);
    expect(r.blocks).toEqual([]);
    expect(r.warnings).toEqual([{ code: "not_placed", row: 0 }]);
  });
});

describe("R3-6: blank rows do not count toward the header search", () => {
  const blanks = (k: number) => Array.from({ length: k }, () => [] as string[]);

  test("a table after 30 blank rows", () => {
    const r = readSheet([...blanks(30), ["Party", "Qty"], ["Om", 12], ["Kamal", 20]]);
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.headers).toEqual(["Party", "Qty"]);
    expect(r.blocks[0]!.confidence).toBe("sure");
  });

  test("a second table 30 blank rows under the first", () => {
    const r = readSheet([["Party", "Qty"], ["Om", 12], ["Kamal", 20], ...blanks(30), ["Section", "Kg"], ["T 4012", 3.5], ["R 2105", 4.5]]);
    expect(r.blocks.map((b) => b.headers)).toEqual([["Party", "Qty"], ["Section", "Kg"]]);
    for (const b of r.blocks) expect(b.confidence).toBe("unsure");
  });

  test("rows no block takes make every block of the sheet unsure", () => {
    const notes = Array.from({ length: 25 }, (_, i) => [`note ${i}`]);
    const r = readSheet([...notes, ["Party", "Qty"], ["Om", 12], ["Kamal", 20]]);
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.headers).toEqual(["Party", "Qty"]);
    expect(r.blocks[0]!.reasons).toContain("line_not_placed");
    expect(r.warnings.length).toBeGreaterThan(0);
    const listed = new Set([...r.warnings.map((w) => w.row), ...r.blocks[0]!.preview.map((p) => p.row)]);
    for (let i = 0; i < 25; i++) expect(listed.has(i)).toBe(true);
  });
});
