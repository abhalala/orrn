import { describe, expect, test } from "bun:test";

import { findBlocks, readSheet, toCellText } from "./blocks";
import { CsvParser, detectDelimiter, parseCsv, readCsvBlocks } from "./csv";
import { readPdfTextBlocks, textItemsToMatrix, type TextItem } from "./pdf-text";
import { fingerprint } from "../fingerprint";
import { asked } from "./trust-helpers";

describe("toCellText", () => {
  test("plain values only", () => {
    expect(toCellText(null)).toBe("");
    expect(toCellText(12.5)).toBe("12.5");
    expect(toCellText(true)).toBe("TRUE");
    expect(toCellText("  a b ")).toBe("a b");
    expect(toCellText(new Date(Date.UTC(2025, 9, 31)))).toBe("2025-10-31");
    expect(toCellText(new Date(Date.UTC(2025, 9, 31, 14, 30)))).toBe("2025-10-31T14:30:00");
    expect(toCellText(new Date("nope"))).toBe("");
  });
});

describe("findBlocks", () => {
  test("title, header, data and a total row (plan example 2 layout)", () => {
    const m = [
      ["PENDING ORDER LIST AS ON 31.10.2025"],
      ["Sr", "Party Name", "Order No", "Date", "Baki (Kg)"],
      [1, "Shree Ganesh", "PO-1", "12/10/2025", 3800],
      [2, "Om Metals", "PO-2", "14/10/2025", 2500],
      ["", "TOTAL", "", "", 6300],
    ];
    const [b, ...rest] = findBlocks(m, { sheetName: "Baki" });
    expect(rest).toEqual([]);
    expect(b).toMatchObject({ sheetName: "Baki", title: "PENDING ORDER LIST AS ON 31.10.2025", headerRow: 1, headerRows: 1, firstDataSheetRow: 2 });
    expect(b!.headers).toEqual(["Sr", "Party Name", "Order No", "Date", "Baki (Kg)"]);
    expect(b!.rows.length).toBe(3);
    expect(b!.rows[0]).toEqual(["1", "Shree Ganesh", "PO-1", "12/10/2025", "3800"]);
  });

  test("the header must come within the first 20 rows", () => {
    const junk = Array.from({ length: 21 }, () => ["only one cell"]);
    // R3-5, R3-6: past 20 rows with no header the search goes on; the rows are reported and the block is unsure.
    const late = readSheet([...junk, ["A", "B"], ["x", "y"]]);
    expect(late.blocks.map((b) => b.headers)).toEqual([["A", "B"]]);
    expect(asked(late.blocks[0]!)).toBe(true);
    expect(late.warnings.map((w) => w.row)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    const ok = Array.from({ length: 19 }, () => ["note"]);
    expect(findBlocks([...ok, ["A", "B"], ["1", "2"]]).length).toBe(1);
  });

  test("a row of numbers is not a header", () => {
    const [b] = findBlocks([["1", "2", "3"], ["Name", "Qty"], ["a", "5"]]);
    expect(b!.headers).toEqual(["Name", "Qty"]);
    expect(b!.title).toBe("1 2 3");
  });

  test("a two-row header with merged cells combines as top and bottom", () => {
    const m = [
      ["Section", "Weight", "", "Rate"],
      ["", "Min", "Max", ""],
      ["R2105", 2.1, 2.4, 200],
      ["R2106", 2.2, 2.5, 210],
    ];
    const [b] = findBlocks(m);
    expect(b!.headerRows).toBe(2);
    expect(b!.headers).toEqual(["Section", "Weight Min", "Weight Max", "Rate"]);
    expect(b!.rows.length).toBe(2);
    expect(b!.firstDataSheetRow).toBe(2);
  });

  test("a second header row is not taken when the first has no gaps", () => {
    const m = [["Name", "City"], ["Asha", "Surat"], ["Ravi", "Pune"]];
    const [b] = findBlocks(m);
    expect(b!.headerRows).toBe(1);
    expect(b!.rows.length).toBe(2);
  });

  test("a blank row then a new header-like row starts a new block, with its own title", () => {
    const m = [
      ["Series", "Section", "Qty"],
      ["R", "2105", 4],
      ["R", "2106", 5],
      [],
      ["Pending dispatch"],
      ["Party", "Section", "Qty"],
      ["Om Metals", "2105", 7],
    ];
    const blocks = findBlocks(m);
    expect(blocks.length).toBe(2);
    expect(blocks[1]).toMatchObject({ title: "Pending dispatch", headers: ["Party", "Section", "Qty"] });
    expect(blocks[0]!.rows.length).toBe(2);
    expect(blocks[1]!.firstDataSheetRow).toBe(6);
  });

  test("a blank row inside a table of text only does not split it", () => {
    const m = [["Name", "City"], ["Asha", "Surat"], [], ["Ravi", "Pune"]];
    const blocks = findBlocks(m);
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.rows.length).toBe(3);
  });

  test("trailing blank columns and rows are cut", () => {
    const [b] = findBlocks([["A", "B", "", ""], ["x", "y", "", ""], [], []]);
    expect(b!.headers).toEqual(["A", "B"]);
    expect(b!.rows).toEqual([["x", "y"]]);
  });

  test("the fingerprint of the block is the fingerprint of the same table without the title", () => {
    const a = findBlocks([["TITLE"], ["A", "B"], ["1", "x"]])[0]!;
    const b = findBlocks([["A", "B"], ["1", "x"]])[0]!;
    expect(fingerprint(a).headerKey).toBe(fingerprint(b).headerKey);
  });
});

describe("csv", () => {
  test("quotes, doubled quotes, newlines in quotes, CRLF, BOM, blank lines", () => {
    const text = '﻿Name,Note,Qty\r\n"Shree, Ganesh","said ""hi""\nthen left",5\r\n\r\nOm,plain,6';
    expect(parseCsv(text)).toEqual([
      ["Name", "Note", "Qty"],
      ["Shree, Ganesh", 'said "hi"\nthen left', "5"],
      [""],
      ["Om", "plain", "6"],
    ]);
  });
  test("chunk boundaries inside quotes, CRLF and doubled quotes change nothing", () => {
    const text = 'a,b\r\n"x ""y"" z","q\r\nr"\r\n1,2\r\n';
    const whole = parseCsv(text);
    for (const size of [1, 2, 3, 7]) {
      const p = new CsvParser({ delimiter: "," });
      for (let i = 0; i < text.length; i += size) p.push(text.slice(i, i + size));
      expect(p.end()).toEqual(whole);
    }
  });
  test("delimiter detection: semicolon, tab, pipe; a comma inside quotes is ignored", () => {
    expect(detectDelimiter("a;b;c\n1;2;3\n")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3\n")).toBe("\t");
    expect(detectDelimiter("a|b\n1|2\n")).toBe("|");
    expect(detectDelimiter('"a,b";c\n"1,2";3\n')).toBe(";");
    expect(detectDelimiter("single\n")).toBe(",");
  });
  test("readCsvBlocks finds the table under a title", () => {
    const [b] = readCsvBlocks("Stock list\nSeries,Section,Qty\nR,2105,4\nR,2106,5\n");
    expect(b).toMatchObject({ title: "Stock list", headers: ["Series", "Section", "Qty"] });
    expect(b!.rows.length).toBe(2);
  });
});

describe("pdf text items", () => {
  // Left-aligned text, right-aligned numbers. y grows upward like a PDF.
  const it = (str: string, x: number, y: number, w = str.length * 5): TextItem => ({ str, x, y, width: w, height: 10 });
  const page: TextItem[] = [
    it("PACKING LIST 31.10.2025", 50, 800),
    it("Sr", 50, 770), it("Section", 100, 770), it("Qty", 240, 770), it("Weight", 300, 770),
    it("1", 50, 755), it("R", 100, 755), it("2105", 112, 755), it("25", 250 - 10, 755, 10), it("1,200.5", 335 - 35, 755, 35),
    it("2", 50, 740), it("R", 100, 740), it("2106", 112, 740), it("8", 250 - 5, 740, 5), it("980", 335 - 15, 740, 15),
  ];
  test("lines, cells and columns; words close together are one cell", () => {
    const m = textItemsToMatrix(page);
    expect(m[0]).toEqual(["PACKING LIST 31.10.2025"]);
    expect(m[1]).toEqual(["Sr", "Section", "Qty", "Weight"]);
    expect(m[2]).toEqual(["1", "R 2105", "25", "1,200.5"]);
    expect(m[3]).toEqual(["2", "R 2106", "8", "980"]);
  });
  test("blocks: title, header and rows; a table continuing on page 2 is one block", () => {
    const page2: TextItem[] = [
      it("Sr", 50, 800), it("Section", 100, 800), it("Qty", 240, 800), it("Weight", 300, 800),
      it("3", 50, 785), it("T", 100, 785), it("4012", 112, 785), it("5", 250 - 5, 785, 5), it("410", 335 - 15, 785, 15),
    ];
    const blocks = readPdfTextBlocks([page, page2]);
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toMatchObject({ title: "PACKING LIST 31.10.2025", headers: ["Sr", "Section", "Qty", "Weight"] });
    expect(blocks[0]!.rows.length).toBe(3);
    expect(blocks[0]!.rows[2]).toEqual(["3", "T 4012", "5", "410"]);
  });
  test("yUp false reads top to bottom", () => {
    const flipped = page.map((p) => ({ ...p, y: 1000 - p.y }));
    expect(textItemsToMatrix(flipped, { yUp: false })).toEqual(textItemsToMatrix(page));
  });
  test("empty page", () => {
    expect(textItemsToMatrix([])).toEqual([]);
    expect(readPdfTextBlocks([[]])).toEqual([]);
  });
});
