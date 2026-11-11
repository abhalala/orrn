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

// Review 2. A customer list with rows 15 units apart and text 10 units high.
const cust = (y: number, name: string, phone = "", city = "") =>
  [it(name, 50, y), ...(phone ? [it(phone, 200, y)] : []), ...(city ? [it(city, 300, y)] : [])];
const custHeader = (y: number) => [it("Name", 50, y), it("Phone", 200, y), it("City", 300, y)];

describe("C-new-2: continuation rows are placed by x, not by index", () => {
  const hdr = (y: number) => [it("Sr", 50, y), it("PO", 90, y), it("Section", 150, y), it("Pcs", 260, y), it("Wt", 320, y)];
  const line = (y: number, sr: string, po: string, sec: string, pcs: string, wt: string) => [
    it(sr, 50, y),
    ...(po ? [it(po, 90, y)] : []),
    it(sec, 150, y),
    it(pcs, 265, y),
    it(wt, 320, y),
  ];
  const first = [...hdr(770), ...line(755, "1", "P11", "R 2105", "25", "1200"), ...line(740, "2", "P12", "R 2106", "8", "980")];

  test("a page with a blank PO column keeps each value under its header", () => {
    const page2 = [...line(800, "3", "", "T 4013", "6", "420"), ...line(785, "4", "", "T 4014", "7", "430")];
    const r = readPdfText([first, page2]);
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.headers).toEqual(["Sr", "PO", "Section", "Pcs", "Wt"]);
    expect(r.blocks[0]!.rows.slice(2)).toEqual([
      ["3", "", "T 4013", "6", "420"],
      ["4", "", "T 4014", "7", "430"],
    ]);
    expect(r.warnings).toEqual([]);
  });

  test("a row whose cells do not line up with the table is left out with a warning", () => {
    const page2 = [...line(800, "3", "P13", "T 4013", "6", "420"), it("3", 50, 785), it("9", 520, 785), it("x", 600, 785)];
    const r = readPdfText([first, page2]);
    expect(r.blocks[0]!.rows.length).toBe(3);
    expect(r.warnings).toEqual(["page 2: 1 row did not line up with the table above"]);
  });
});

describe("C-new-3: a real one-cell row is not folded into the row above", () => {
  test("a customer with no phone and no city stays its own row", () => {
    const m = textItemsToMatrix([...custHeader(770), ...cust(755, "Asha", "9898", "Surat"), ...cust(740, "Zenith Traders"), ...cust(725, "Kamal", "9797", "Rajkot")]);
    expect(m).toEqual([
      ["Name", "Phone", "City"],
      ["Asha", "9898", "Surat"],
      ["Zenith Traders", "", ""],
      ["Kamal", "9797", "Rajkot"],
    ]);
  });
});

describe("C-new-4: a trailing one-cell row at the row pitch is data", () => {
  test("a last customer with only a name is kept", () => {
    const page = [...custHeader(770), ...cust(755, "Asha", "9898", "Surat"), ...cust(740, "Kamal", "9797", "Rajkot"), ...cust(720, "Om Traders")];
    const r = readPdfText([page]);
    expect(r.blocks[0]!.rows).toEqual([
      ["Asha", "9898", "Surat"],
      ["Kamal", "9797", "Rajkot"],
      ["Om Traders", "", ""],
    ]);
  });

  test("a one-cell line after a gap, or a signature line, is a footer", () => {
    const page = [...custHeader(770), ...cust(755, "Asha", "9898", "Surat"), ...cust(740, "Kamal", "9797", "Rajkot"), it("Thank you", 50, 650)];
    expect(readPdfText([page]).blocks[0]!.rows.length).toBe(2);
    const signed = [...custHeader(770), ...cust(755, "Asha", "9898", "Surat"), ...cust(740, "Kamal", "9797", "Rajkot"), it("Authorised Signatory", 50, 725)];
    expect(readPdfText([signed]).blocks[0]!.rows.length).toBe(2);
  });
});

// Review 3.
describe("C-new-6: a table and the line or table next to it keep their own columns", () => {
  test("two tables stacked with a one-cell Summary line between them", () => {
    const second = [
      it("Summary", 50, 725),
      it("Party", 50, 710), it("Bundles", 170, 710), it("Kg", 280, 710),
      it("Om Metals", 50, 695), it("12", 180, 695), it("2180", 280, 695),
      it("Shree Ganesh", 50, 680), it("4", 185, 680), it("640", 280, 680),
    ];
    const r = readPdfText([[...header(770), ...row(755, "1", "R 2105", "25", "1200"), ...row(740, "2", "R 2106", "8", "980"), ...second]]);
    expect(r.blocks.length).toBe(2);
    expect(r.blocks[0]!.headers).toEqual(["Sr", "Section", "Qty", "Weight"]);
    expect(r.blocks[0]!.rows).toEqual([
      ["1", "R 2105", "25", "1200"],
      ["2", "R 2106", "8", "980"],
    ]);
    expect(r.blocks[1]!.title).toBe("Summary");
    expect(r.blocks[1]!.headers).toEqual(["Party", "Bundles", "Kg"]);
    expect(r.blocks[1]!.rows).toEqual([
      ["Om Metals", "12", "2180"],
      ["Shree Ganesh", "4", "640"],
    ]);
  });

  test("a Party and Date line, a one-cell PACKING LIST line, then the table", () => {
    const top = [it("Party: Om Metals", 50, 800), it("Date: 31.10.2025", 300, 800), it("PACKING LIST", 150, 785)];
    const r = readPdfText([[...top, ...header(770), ...row(755, "1", "R 2105", "25", "1200"), ...row(740, "2", "R 2106", "8", "980")]]);
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.headers).toEqual(["Sr", "Section", "Qty", "Weight"]);
    expect(r.blocks[0]!.title).toBe("Party: Om Metals Date: 31.10.2025 PACKING LIST");
    expect(r.blocks[0]!.rows).toEqual([
      ["1", "R 2105", "25", "1200"],
      ["2", "R 2106", "8", "980"],
    ]);
  });

  test("a Party and Date line right above the header does not fuse the Sr and Section columns", () => {
    const top = [it("Party: Om Metals", 50, 785), it("Date: 31.10.2025", 300, 785)];
    const r = readPdfText([[...top, ...header(770), ...row(755, "1", "R 2105", "25", "1200"), ...row(740, "2", "R 2106", "8", "980")]]);
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.headers).toEqual(["Sr", "Section", "Qty", "Weight"]);
    expect(r.blocks[0]!.title).toBe("Party: Om Metals Date: 31.10.2025");
    expect(r.blocks[0]!.rows).toEqual([
      ["1", "R 2105", "25", "1200"],
      ["2", "R 2106", "8", "980"],
    ]);
    expect(r.warnings).toEqual([]);
  });
});

describe("C-new-7: a wrapped line in a tightly spaced table folds into its cell", () => {
  test("rows 11 apart, a wrapped Section line 9 below its row", () => {
    const items = [
      ...header(770),
      ...row(759, "1", "R 2105 long", "25", "1200"),
      it("description", 100, 750),
      ...row(739, "2", "R 2106", "8", "980"),
      ...row(728, "3", "R 2107", "9", "990"),
    ];
    expect(textItemsToMatrix(items)).toEqual([
      ["Sr", "Section", "Qty", "Weight"],
      ["1", "R 2105 long description", "25", "1200"],
      ["2", "R 2106", "8", "980"],
      ["3", "R 2107", "9", "990"],
    ]);
  });

  test("a one-cell line in the key column at the pitch is still its own row", () => {
    const m = textItemsToMatrix([
      ...custHeader(770), ...cust(759, "Asha", "9898", "Surat"), ...cust(748, "Zenith Traders"), ...cust(737, "Kamal", "9797", "Rajkot"), ...cust(726, "Om", "9696", "Pune"),
    ]);
    expect(m[2]).toEqual(["Zenith Traders", "", ""]);
    expect(m.length).toBe(5);
  });
});

describe("one-cell lines at the top of a continuation page are placed or reported", () => {
  const hdr = (y: number) => [it("Party", 50, y), it("Section", 150, y), it("Kg", 260, y)];
  const line = (y: number, party: string, sec: string, kg: string) => [...(party ? [it(party, 50, y)] : []), it(sec, 150, y), it(kg, 260, y)];
  const first = [...hdr(770), ...line(755, "Om Metals", "T 4012", "120"), ...line(740, "", "T 4013", "80")];

  test("a party-only row at the top of page 2 is a row", () => {
    const page2 = [it("Shree Ganesh", 50, 800), ...line(785, "", "R 2105", "300"), ...line(770, "", "R 2106", "210")];
    const r = readPdfText([first, page2]);
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.rows).toEqual([
      ["Om Metals", "T 4012", "120"],
      ["", "T 4013", "80"],
      ["Shree Ganesh", "", ""],
      ["", "R 2105", "300"],
      ["", "R 2106", "210"],
    ]);
    expect(r.warnings).toEqual([]);
  });

  test("a party-only row between continuation rows is a row", () => {
    const page2 = [...line(800, "", "R 2105", "300"), it("Shree Ganesh", 50, 785), ...line(770, "", "R 2106", "210")];
    const r = readPdfText([first, page2]);
    expect(r.blocks[0]!.rows.slice(2)).toEqual([
      ["", "R 2105", "300"],
      ["Shree Ganesh", "", ""],
      ["", "R 2106", "210"],
    ]);
    expect(r.warnings).toEqual([]);
  });

  test("a one-cell line that fits no column is reported, not dropped", () => {
    const page2 = [it("see note", 600, 800), ...line(785, "", "R 2105", "300")];
    const r = readPdfText([first, page2]);
    expect(r.blocks[0]!.rows.length).toBe(3);
    expect(r.warnings).toEqual(["page 2: 1 line could not be placed"]);
  });

  test("the title repeated above the repeated header is not a row and not a warning", () => {
    const titled = [it("ORDER BOOK", 50, 800), ...first];
    const page2 = [it("ORDER BOOK", 50, 800), ...hdr(770), ...line(755, "Shree Ganesh", "R 2105", "300")];
    const r = readPdfText([titled, page2]);
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.rows.length).toBe(3);
    expect(r.warnings).toEqual([]);
  });

  test("a new title above the repeated header has nowhere to go and is reported", () => {
    const titled = [it("ORDER BOOK", 50, 800), ...first];
    const page2 = [it("Second shift", 50, 800), ...hdr(770), ...line(755, "Shree Ganesh", "R 2105", "300")];
    const r = readPdfText([titled, page2]);
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.rows.length).toBe(3);
    expect(r.warnings).toEqual(["page 2: 1 line could not be placed"]);
  });

  test("a party-only row that matches part of the title is still a row", () => {
    const titled = [it("Party: Om Metals", 50, 800), ...first];
    const page2 = [it("Om Metals", 50, 800), ...line(785, "", "R 2105", "300")];
    const r = readPdfText([titled, page2]);
    expect(r.blocks[0]!.rows.slice(2)).toEqual([
      ["Om Metals", "", ""],
      ["", "R 2105", "300"],
    ]);
  });
});
