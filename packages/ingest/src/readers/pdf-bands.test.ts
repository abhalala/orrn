import { describe, expect, test } from "bun:test";

import { chooseHeader } from "../header";
import { readPdfText, type TextItem } from "./pdf-text";
import { layoutOf } from "./trust-helpers";

// PORTAL-RULES-3 section 5.3: PDF columns are the header's cells, items go to the band of their centre, and doubt is
// marked on the row. Synthetic pages only (P2, p2.ts, p3.ts and the close cells case of the round 4 check).
const CW = 5;
const it = (str: string, x: number, y: number): TextItem => ({ str, x, y, width: str.length * CW, height: 10 });
type Align = "l" | "r" | "c";
const place = (s: string, x0: number, w: number, a: Align) => (a === "l" ? x0 : a === "r" ? x0 + w - s.length * CW : x0 + (w - s.length * CW) / 2);
function table(headers: string[], rows: string[][], cols: [number, number][], ha: Align[], va: Align[], y0 = 700, pitch = 14) {
  const items: TextItem[] = [];
  let y = y0;
  headers.forEach((h, i) => h && items.push(it(h, place(h, cols[i]![0], cols[i]![1], ha[i]!), y)));
  for (const r of rows) {
    y -= pitch;
    r.forEach((c, i) => c && items.push(it(c, place(c, cols[i]![0], cols[i]![1], va[i]!), y)));
  }
  return items;
}

const P1_ROWS = [["T4012", "Om", "12", "340.50"], ["T4013", "Shree", "8", "1,210.00"], ["T4014", "Mehta Metals Pvt", "100", "5.25"]];
const P1 = table(["Section", "Party Name", "Pcs", "Weight"], P1_ROWS, [[50, 120], [180, 120], [310, 60], [380, 80]], ["c", "c", "c", "c"], ["l", "l", "r", "r"]);

describe("5.3: the columns are the header's cells", () => {
  test("P1: centred headers over left text and right numbers, hinted and guessed", () => {
    for (const hints of [[{ page: 1, headerRow: 0 }], undefined]) {
      const b = readPdfText([P1], hints ? { hints } : {}).blocks[0]!;
      expect(b.headers).toEqual(["Section", "Party Name", "Pcs", "Weight"]);
      expect(b.rows).toEqual(P1_ROWS);
      expect(b.doubts).toEqual([]);
    }
  });

  test("P2: left-aligned numbers under centred headers", () => {
    const rows = [["T4012", "12.5", "245"], ["T4013", "1210.75", "250"]];
    const items = table(["Section", "Kg", "Rate"], rows, [[50, 100], [160, 100], [270, 80]], ["l", "c", "c"], ["l", "l", "l"]);
    for (const hints of [[{ page: 1, headerRow: 0 }], undefined]) {
      const b = readPdfText([items], hints ? { hints } : {}).blocks[0]!;
      expect(b.headers).toEqual(["Section", "Kg", "Rate"]);
      expect(b.rows).toEqual(rows);
    }
  });

  test("p2 (B3): a centred header right of left-aligned values", () => {
    const items = [it("Party", 77.5, 780), it("Kg", 185, 780), it("Om1", 40, 766), it("12", 160, 766), it("Mehta Metals2", 40, 752), it("1,234.50", 160, 752), it("Shree3", 40, 738), it("7", 160, 738)];
    const b = readPdfText([items], { hints: [{ page: 1, headerRow: 0 }] }).blocks[0]!;
    expect(b.headers).toEqual(["Party", "Kg"]);
    expect(b.rows).toEqual([["Om1", "12"], ["Mehta Metals2", "1,234.50"], ["Shree3", "7"]]);
  });

  test("right-aligned headers over right-aligned numbers", () => {
    const rows = [["Om Metals", "12", "2,940"], ["Mehta", "1,210", "296,450"]];
    const items = table(["Party", "Kg", "Amount"], rows, [[50, 120], [180, 80], [270, 100]], ["l", "r", "r"], ["l", "r", "r"]);
    const b = readPdfText([items], { hints: [{ page: 1, headerRow: 0 }] }).blocks[0]!;
    expect(b.rows).toEqual(rows);
  });

  test("a value under a blank header cell goes to a named column and the row is marked", () => {
    const items = [it("Party", 50, 700), it("Kg", 250, 700), it("Om", 50, 686), it("note", 150, 686), it("12", 250, 686)];
    const b = readPdfText([items], { hints: [{ page: 1, headerRow: 0 }] }).blocks[0]!;
    expect(b.headers).toEqual(["Party", "Kg"]);
    expect(b.rows[0]!.length).toBe(2);
    expect(b.doubts.map((d) => [d.row, d.code])).toContainEqual([0, "cells_joined"]);
  });
});

describe("5.3: the preview and chooseHeader use the block's cells (M4)", () => {
  test("p3: a learned layout fits the centred header, and the block's columns are the layout's", () => {
    const items: TextItem[] = [it("Section", 85, 700), it("Party Name", 215, 700), it("Pcs", 332, 700), it("Weight", 405, 700)];
    P1_ROWS.forEach((r, i) => {
      const y = 686 - 14 * i;
      items.push(it(r[0]!, 50, y), it(r[1]!, 180, y), it(r[2]!, 370 - r[2]!.length * CW, y), it(r[3]!, 460 - r[3]!.length * CW, y));
    });
    const b = readPdfText([items]).blocks[0]!;
    expect(b.headers).toEqual(["Section", "Party Name", "Pcs", "Weight"]);
    expect(b.rows).toEqual(P1_ROWS);
    for (const p of b.preview) expect(p.cells.length).toBe(4);
    const c = chooseHeader(b, { learned: [layoutOf(["Section", "Party Name", "Pcs", "Weight"], "pdf-disp")] });
    expect(c).toMatchObject({ kind: "fits", headerRow: 0 });
  });
});

describe("5.3: doubt is marked on the row", () => {
  test("M5: close cells in two columns are split, and the row is marked", () => {
    const items = [it("Party", 50, 700), it("Rate", 290, 700), it("Vehicle", 318, 700), it("Om", 50, 686), it("245", 295, 686), it("GJ03AB1234", 318, 686), it("Mehta", 50, 672), it("250", 295, 672), it("GJ03AB9999", 340, 672)];
    for (const hints of [[{ page: 1, headerRow: 0 }], undefined]) {
      const b = readPdfText([items], hints ? { hints } : {}).blocks[0]!;
      expect(b.headers).toEqual(["Party", "Rate", "Vehicle"]);
      expect(b.rows).toEqual([["Om", "245", "GJ03AB1234"], ["Mehta", "250", "GJ03AB9999"]]);
      expect(b.doubts).toEqual([{ row: 0, code: "cells_close", line: 1, page: 1 }]);
    }
  });

  test("two close items merged into one cell are not one phrase (round 5 large run, seed 3184)", () => {
    // "44" right-aligned at the end of Order, "F3301" left-aligned at the start of Section, 8 apart: one PDF cell.
    const items = [it("Party", 50, 700), it("Order", 100, 700), it("Section", 158, 700), it("Om", 50, 686), it("44", 140, 686), it("F3301", 158, 686), it("Kamal", 50, 672), it("45", 140, 672), it("R2105", 158, 672)];
    const b = readPdfText([items], { hints: [{ page: 1, headerRow: 0 }] }).blocks[0]!;
    expect(b.headers).toEqual(["Party", "Order", "Section"]);
    expect(b.rows).toEqual([["Om", "44", "F3301"], ["Kamal", "45", "R2105"]]);
    expect(new Set(b.doubts.map((d) => d.row))).toEqual(new Set([0, 1]));
  });

  test("an item across a band edge is marked", () => {
    const items = [it("Party", 50, 700), it("Kg", 120, 700), it("Rate", 200, 700), it("Om", 50, 686), it("12", 120, 686), it("245", 200, 686), it("Shree Ganesh Metals", 50, 672), it("8", 120, 672), it("250", 200, 672)];
    const b = readPdfText([items], { hints: [{ page: 1, headerRow: 0 }] }).blocks[0]!;
    expect(b.doubts.map((d) => [d.row, d.code])).toContainEqual([1, "crosses_column"]);
  });

  test("a line that fills fewer than half the columns is marked", () => {
    const items = [it("Party", 50, 700), it("Section", 150, 700), it("Qty", 250, 700), it("Kg", 300, 700), it("Om", 50, 686), it("T4012", 150, 686), it("12", 250, 686), it("1200", 300, 686), it("Authorised Signatory", 50, 660)];
    const b = readPdfText([items], { hints: [{ page: 1, headerRow: 0 }] }).blocks[0]!;
    expect(b.rows[1]).toEqual(["Authorised Signatory", "", "", ""]);
    expect(b.doubts).toContainEqual({ row: 1, code: "few_columns", line: 2, page: 1 });
    expect(b.doubts.every((d) => d.row === 1)).toBe(true);
  });

  test("sheets and CSV carry no doubts", async () => {
    const { readSheet } = await import("./blocks");
    expect(readSheet([["Party", "Kg"], ["Om", 12]]).blocks[0]!.doubts).toEqual([]);
  });
});
