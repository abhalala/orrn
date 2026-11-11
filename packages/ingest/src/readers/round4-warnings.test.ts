import { describe, expect, test } from "bun:test";

import { readSheet } from "./blocks";
import { readPdfText, type TextItem } from "./pdf-text";

// PORTAL-RULES-3 section 4.1, item 4: every line or row a reader does not put in a block's rows is a warning, with
// its sheet or page and row number.
const it = (str: string, x: number, y: number): TextItem => ({ str, x, y, width: str.length * 5, height: 10 });
const X = [50, 170, 260, 330, 400];
const line = (y: number, ...cells: string[]) => cells.flatMap((s, i) => (s === "" ? [] : [it(s, X[i]!, y)]));

/** Every page line is in a block's rows, header or a warning. */
function everyLineListed(pages: TextItem[][], r: ReturnType<typeof readPdfText>): string[] {
  const seen = new Set<string>(r.rowWarnings.map((w) => `${w.page}:${w.row}`));
  for (const b of r.blocks) {
    for (const w of b.warnings) seen.add(`${w.page}:${w.row}`);
    const g = b.guess;
    if (g.page === undefined) continue;
    for (let p = g.page; p <= (g.lastPage ?? g.page); p++) {
      const from = p === g.page ? g.headerRow : 0;
      const to = p === (g.lastPage ?? g.page) ? (g.lastDataRow ?? g.headerRow) : 999;
      for (let n = from; n <= to; n++) seen.add(`${p}:${n}`);
    }
  }
  const missing: string[] = [];
  pages.forEach((items, p) => {
    const ys = [...new Set(items.map((i) => i.y))].sort((a, b) => b - a);
    ys.forEach((_, n) => {
      if (!seen.has(`${p + 1}:${n}`)) missing.push(`${p + 1}:${n}`);
    });
  });
  return missing;
}

describe("R4-6: a number header with a two-cell footer under it still gives a block", () => {
  test("PDF page", () => {
    const page = [
      ...line(800, "Buyer", "3.6"),
      ...line(785, "Shree Ganesh", "1111"),
      ...line(770, "Kamal Bros", "297"),
      ...line(755, "Kamal Bros", "926"),
      ...line(740, "Shree Ganesh", "445"),
      ...line(725, "Prepared by", "Checked by"),
    ];
    const r = readPdfText([page]);
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.headers).toEqual(["Buyer", "3.6"]);
    // Rule 4.1: the footer is a row; the dry run and the person deal with it.
    expect(r.blocks[0]!.rows).toEqual([
      ["Shree Ganesh", "1111"],
      ["Kamal Bros", "297"],
      ["Kamal Bros", "926"],
      ["Shree Ganesh", "445"],
      ["Prepared by", "Checked by"],
    ]);
    expect(everyLineListed([page], r)).toEqual([]);
  });

  test("sheet", () => {
    const r = readSheet([["Profile", 12, 14, 16], ["T 4012", 1, 2, 3], ["R 2105", 4, 5, 6], ["Prepared by", "Checked by"]]);
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.guess.headerRow).toBe(0);
    expect(r.blocks[0]!.title).toBeNull();
    expect(r.blocks[0]!.rows).toEqual([
      ["T 4012", "1", "2", "3"],
      ["R 2105", "4", "5", "6"],
      ["Prepared by", "Checked by"],
    ]);
  });

  test("a PDF header with no rows under it is listed in the page warnings too", () => {
    const page = [...line(800, "Fourcubes Extrusions"), ...line(770, "Prepared by", "Checked by")];
    const r = readPdfText([page]);
    expect(r.blocks).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(everyLineListed([page], r)).toEqual([]);
  });
});

describe("R4-7: PDF title lines are warnings with page lines and the page", () => {
  test("lines above the header, after a gap, are kept_as_title at their page line", () => {
    const page = [
      ...line(800, "Stock statement"),
      ...line(785, "Fourcubes", "Rajkot"),
      ...line(740, "Item", "Qty", "Status"),
      ...line(725, "K 1100", "12", "Pending"),
      ...line(710, "T 4012", "9", "Done"),
    ];
    const r = readPdfText([page]);
    const b = r.blocks[0]!;
    expect(b.guess.headerRow).toBe(2);
    expect(b.warnings.filter((w) => w.code === "kept_as_title")).toEqual([
      { code: "kept_as_title", row: 0, page: 1 },
      { code: "kept_as_title", row: 1, page: 1 },
    ]);
    expect(everyLineListed([page], r)).toEqual([]);
  });

  test("a hinted PDF block lists the lines above its header", () => {
    const page = [...line(800, "Stock statement"), ...line(785, "Item", "Qty"), ...line(770, "K 1100", "12")];
    const r = readPdfText([page], { hints: [{ page: 1, headerRow: 1 }] });
    expect(r.blocks[0]!.warnings).toEqual([{ code: "kept_as_title", row: 0, page: 1 }]);
  });
});
