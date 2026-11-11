import { describe, expect, test } from "bun:test";

import { HintError } from "./blocks";
import { readPdfText, type TextItem } from "./pdf-text";
import { asked, fitsLayout, picked } from "./trust-helpers";

// PORTAL-RULES-3 section 3 for PDF text: sure or unsure, a preview of page lines, and hints. Synthetic pages only.
const it = (str: string, x: number, y: number, width = str.length * 5): TextItem => ({ str, x, y, width, height: 10 });
const header = (y: number) => [it("Party", 50, y), it("Section", 150, y), it("Qty", 250, y), it("Kg", 300, y)];
const row = (y: number, party: string, sec: string, qty: string, kg: string) => [
  it(party, 50, y),
  it(sec, 150, y),
  ...(qty ? [it(qty, 250, y)] : []),
  ...(kg ? [it(kg, 300, y)] : []),
];

describe("pdf blocks say sure or unsure", () => {
  test("a plain table is sure, with page lines as raw rows", () => {
    const r = readPdfText([[...header(770), ...row(755, "Om Metals", "R 2105", "12", "1200"), ...row(740, "Kamal", "R 2106", "5", "500")]]);
    const [b] = r.blocks;
    expect(fitsLayout(b!, ["Party", "Section", "Qty", "Kg"])).toBe(true);
    expect(b!.preview).toEqual([
      { row: 0, page: 1, cells: ["Party", "Section", "Qty", "Kg"] },
      { row: 1, page: 1, cells: ["Om Metals", "R 2105", "12", "1200"] },
      { row: 2, page: 1, cells: ["Kamal", "R 2106", "5", "500"] },
    ]);
    expect(b!.guess).toEqual({ page: 1, headerRow: 0, headerRows: 1, firstDataRow: 1, lastDataRow: 2, lastPage: 1 });
  });

  test("a title line makes it unsure, and the preview starts at the title", () => {
    const r = readPdfText([[it("PACKING LIST", 50, 800), ...header(770), ...row(755, "Om Metals", "R 2105", "12", "1200")]]);
    expect(asked(r.blocks[0]!)).toBe(true);
    expect(r.blocks[0]!.preview[0]).toEqual({ row: 0, page: 1, cells: ["PACKING LIST"] });
    expect(r.blocks[0]!.guess.headerRow).toBe(1);
  });

  test("a wrapped line or a one-cell row makes it unsure", () => {
    const r = readPdfText([[...header(770), ...row(755, "Om Metals", "R 2105", "12", "1200"), it("Zenith Traders", 50, 740), ...row(725, "Kamal", "R 2106", "5", "500")]]);
    expect(asked(r.blocks[0]!)).toBe(true);
  });

  test("a footer left out is listed and makes it unsure", () => {
    const r = readPdfText([[...header(770), ...row(755, "Om Metals", "R 2105", "12", "1200"), ...row(740, "Kamal", "R 2106", "5", "500"), it("Authorised Signatory", 50, 725)]]);
    expect(r.blocks[0]!.rows.length).toBe(2);
    expect(r.blocks[0]!.warnings).toEqual([{ code: "footer_left_out", row: 3, page: 1 }]);
    expect(asked(r.blocks[0]!)).toBe(true);
  });

  test("R-new-5: a word in a number column is unsure, and the hint gives one block with every row", () => {
    const page = [
      ...header(770),
      ...row(755, "Om Metals", "R 2105", "12", "1200"),
      ...row(740, "Shree Ganesh", "T 4012", "", "Cancelled"),
      ...row(725, "Kamal", "R 2106", "5", "500"),
      ...row(710, "Om", "T 4013", "6", "600"),
    ];
    const guessed = readPdfText([page]);
    for (const b of guessed.blocks) expect(asked(b)).toBe(true);
    const r = readPdfText([page], { hints: [{ page: 1, headerRow: 0 }] });
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.headers).toEqual(["Party", "Section", "Qty", "Kg"]);
    expect(r.blocks[0]!.rows).toEqual([
      ["Om Metals", "R 2105", "12", "1200"],
      ["Shree Ganesh", "T 4012", "", "Cancelled"],
      ["Kamal", "R 2106", "5", "500"],
      ["Om", "T 4013", "6", "600"],
    ]);
    expect(picked(r.blocks[0]!)).toBe(true);
    expect(r.blocks[0]!.hints).toEqual({ page: 1, headerRow: 0 });
  });
});

describe("pdf hints are followed exactly", () => {
  test("title, header, first and last data line; the rest is listed", () => {
    const page = [
      it("PACKING LIST", 50, 800),
      ...header(770),
      it("note", 50, 762),
      ...row(745, "Om Metals", "R 2105", "12", "1200"),
      ...row(730, "Kamal", "R 2106", "5", "500"),
      it("Prepared by", 50, 700),
    ];
    const r = readPdfText([page], { hints: [{ page: 1, headerRow: 1, firstDataRow: 3, lastDataRow: 4 }] });
    const [b] = r.blocks;
    expect(b!.title).toBe("PACKING LIST");
    expect(b!.rows).toEqual([
      ["Om Metals", "R 2105", "12", "1200"],
      ["Kamal", "R 2106", "5", "500"],
    ]);
    // Rule 4.1: the title line is listed too.
    expect(b!.warnings).toEqual([
      { code: "kept_as_title", row: 0, page: 1 },
      { code: "skipped_by_hint", row: 2, page: 1 },
      { code: "after_last_row", row: 5, page: 1 },
    ]);
  });

  test("a table over two pages, with the header repeated on page 2", () => {
    const p1 = [...header(770), ...row(755, "Om Metals", "R 2105", "12", "1200")];
    const p2 = [it("PACKING LIST", 50, 800), ...header(785), ...row(770, "Kamal", "R 2106", "5", "500"), it("Thank you", 50, 600)];
    const r = readPdfText([p1, p2], { hints: [{ page: 1, headerRow: 0, lastPage: 2, lastDataRow: 2 }] });
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.rows).toEqual([
      ["Om Metals", "R 2105", "12", "1200"],
      ["Kamal", "R 2106", "5", "500"],
    ]);
    expect(r.blocks[0]!.warnings.map((w) => w.code)).toEqual(["title_repeated", "title_repeated", "after_last_row"]);
  });

  test("pages a hint does not cover are still guessed", () => {
    const p1 = [...header(770), ...row(755, "Om Metals", "R 2105", "12", "1200")];
    const p2 = [it("Name", 50, 770), it("City", 200, 770), it("Asha", 50, 755), it("Surat", 200, 755)];
    const r = readPdfText([p1, p2], { hints: [{ page: 1, headerRow: 0 }] });
    expect(r.blocks.length).toBe(2);
    expect(r.blocks[0]!.hints).not.toBeNull();
    expect(r.blocks[1]!.hints).toBeNull();
    expect(r.blocks[1]!.headers).toEqual(["Name", "City"]);
  });

  test("a hint that cannot be followed is an error", () => {
    const p1 = [...header(770), ...row(755, "Om Metals", "R 2105", "12", "1200")];
    expect(() => readPdfText([p1], { hints: [{ page: 2, headerRow: 0 }] })).toThrow(HintError);
    expect(() => readPdfText([p1], { hints: [{ page: 1, headerRow: 9 }] })).toThrow(HintError);
  });
});
