import { describe, expect, test } from "bun:test";

import { findBlocks } from "./blocks";
import { readPdfText, type TextItem } from "./pdf-text";
import type { BlockHints, MatrixCell, ReadBlock } from "./types";
import { chooseHeader } from "../header";
import { headerKey, normalizeHeaders, usedWidth } from "../fingerprint";

// PORTAL-RULES-3 section 3: every named case of the earlier reviews (C14 to C17, C-new-1 to C-new-7) and the three
// R-new cases comes out right, or unsure with the right answer reachable by hints. Synthetic data only.

type Want = { title?: string | null; headers: string[]; rows: string[][] };
const view = (b: ReadBlock, w: Want) => ({ ...(w.title !== undefined ? { title: b.title } : {}), headers: b.headers, rows: b.rows });

/** Right as guessed, or every block that is wrong is not trusted (the web asks) and the hints give the right blocks. */
function rightOrReachable(guessed: ReadBlock[], want: Want[], hinted: () => ReadBlock[]): "right" | "hinted" {
  const right = guessed.length === want.length && guessed.every((b, i) => Bun.deepEquals(view(b, want[i]!), { ...want[i]! }));
  if (right) return "right";
  guessed.forEach((b, i) => {
    const w = want[i];
    if (!w || !Bun.deepEquals(view(b, w), { ...w })) {
      // Rule 4.1: a wrong block is trusted only when its header really carries a true table's column names.
      const c = chooseHeader(b);
      // A column with no name and no cell in the preview is not part of the names chooseHeader sees.
      const trueKey = (x: Want) => headerKey(normalizeHeaders(x.headers, usedWidth(x.headers, [])));
      if (c.kind === "fits") expect(want.some((x) => trueKey(x) === c.fit.recipe.match.headerKey), JSON.stringify(b.headers)).toBe(true);
    }
  });
  const h = hinted();
  expect(h.map((b, i) => view(b, want[i] ?? { headers: [], rows: [] }))).toEqual(want.map((w) => ({ ...w })));
  return "hinted";
}

function sheet(m: MatrixCell[][], want: Want[], hints: BlockHints[]) {
  return rightOrReachable(findBlocks(m), want, () => findBlocks(m, { hints }));
}

function pdf(pages: TextItem[][], want: Want[], hints: BlockHints[]) {
  return rightOrReachable(readPdfText(pages).blocks, want, () => readPdfText(pages, { hints }).blocks);
}

describe("sheet cases", () => {
  test("R-new-3: a first data row with a cell right of the header", () => {
    sheet(
      [["Name", "Phone", "City"], ["Asha", "", "Surat", "vip"], ["Kamal", "9797", "Rajkot"]],
      [{ headers: ["Name", "Phone", "City", ""], rows: [["Asha", "", "Surat", "vip"], ["Kamal", "9797", "Rajkot"]] }],
      [{ headerRow: 0 }],
    );
    sheet(
      [["Code", "Party", "City", "State"], ["C001", "Om Metals", "", "Gujarat", "old account"], ["C002", "Shree Ganesh", "Surat", "Gujarat"]],
      [{ headers: ["Code", "Party", "City", "State", ""], rows: [["C001", "Om Metals", "", "Gujarat", "old account"], ["C002", "Shree Ganesh", "Surat", "Gujarat"]] }],
      [{ headerRow: 0 }],
    );
    sheet(
      [["Party", "Section", "Qty"], ["Om Metals", "", "", "see note"], ["", "R 2105", 12], ["", "R 2106", 5]],
      [{ headers: ["Party", "Section", "Qty", ""], rows: [["Om Metals", "", "", "see note"], ["", "R 2105", "12"], ["", "R 2106", "5"]] }],
      [{ headerRow: 0 }],
    );
  });

  test("R-new-4: a letterhead over a blank header cell, and month groups with no key column", () => {
    sheet(
      [["Despatch Register 2025-26", "", "", "", "Fourcubes Extrusions"], ["Sr", "Party", "Section", "Qty"], [1, "Om Metals", "T 4012", 20]],
      [{ title: "Despatch Register 2025-26 Fourcubes Extrusions", headers: ["Sr", "Party", "Section", "Qty"], rows: [["1", "Om Metals", "T 4012", "20"]] }],
      [{ headerRow: 1 }],
    );
    sheet(
      [["Despatch Register 2025-26", "", "", "Fourcubes Extrusions"], ["Sr", "Party", "Section", ""], [1, "Om Metals", "T 4012", 20]],
      [{ title: "Despatch Register 2025-26 Fourcubes Extrusions", headers: ["Sr", "Party", "Section", ""], rows: [["1", "Om Metals", "T 4012", "20"]] }],
      [{ headerRow: 1 }],
    );
    sheet(
      [["Apr 2025", "", "", "May 2025", ""], ["Kg", "Pcs", "Amt", "Kg", "Pcs"], [1, 2, 3, 4, 5]],
      [{ title: null, headers: ["Apr 2025 Kg", "Apr 2025 Pcs", "Apr 2025 Amt", "May 2025 Kg", "May 2025 Pcs"], rows: [["1", "2", "3", "4", "5"]] }],
      [{ headerRow: 0, headerRows: 2 }],
    );
  });

  test("C14: a header with a blank cell", () => {
    sheet(
      [["Customer", "Contact", "", "City"], ["Shree Ganesh", "Asha", "", "Surat"], ["Om Metals", "Ravi", "", "Pune"]],
      [{ headers: ["Customer", "Contact", "", "City"], rows: [["Shree Ganesh", "Asha", "", "Surat"], ["Om Metals", "Ravi", "", "Pune"]] }],
      [{ headerRow: 0 }],
    );
    sheet(
      [["Customer", "Contact", "", "City"], ["Shree Ganesh", "Asha", "Mumbai", "Surat"], ["Om Metals", "Ravi", "Delhi", "Pune"]],
      [{ headers: ["Customer", "Contact", "", "City"], rows: [["Shree Ganesh", "Asha", "Mumbai", "Surat"], ["Om Metals", "Ravi", "Delhi", "Pune"]] }],
      [{ headerRow: 0 }],
    );
  });

  test("C15: letterheads and titles over the header, and a real two-row header", () => {
    sheet(
      [["FOURCUBES EXTRUSIONS", "", "", "Date: 31/10/2025"], ["Sr", "Party", "Section", "Qty"], [1, "Om Metals", "T 4012", 20]],
      [{ title: "FOURCUBES EXTRUSIONS Date: 31/10/2025", headers: ["Sr", "Party", "Section", "Qty"], rows: [["1", "Om Metals", "T 4012", "20"]] }],
      [{ headerRow: 1 }],
    );
    sheet(
      [["Stock statement", "as on 31.10.2025"], ["Series", "Section", "Qty", "Weight"], ["R", "2105", 4, 12.5]],
      [{ title: "Stock statement as on 31.10.2025", headers: ["Series", "Section", "Qty", "Weight"], rows: [["R", "2105", "4", "12.5"]] }],
      [{ headerRow: 1 }],
    );
    sheet(
      [["Section", "Weight", "", "Rate"], ["", "Min", "Max", ""], ["R2105", 2.1, 2.4, 200]],
      [{ headers: ["Section", "Weight Min", "Weight Max", "Rate"], rows: [["R2105", "2.1", "2.4", "200"]] }],
      [{ headerRow: 0, headerRows: 2 }],
    );
  });

  test("C-new-1: month group labels with a year, and a letterhead with a bare year", () => {
    sheet(
      [["Party", "Apr 2025", "", "May 2025", ""], ["", "Kg", "Pcs", "Kg", "Pcs"], ["Shree Ganesh", 120, 4, 80, 3]],
      [{ title: null, headers: ["Party", "Apr 2025 Kg", "Apr 2025 Pcs", "May 2025 Kg", "May 2025 Pcs"], rows: [["Shree Ganesh", "120", "4", "80", "3"]] }],
      [{ headerRow: 0, headerRows: 2 }],
    );
    sheet(
      [["Sales register", "", "", "FY 2025"], ["Sr", "Party", "Section", "Qty"], [1, "Om Metals", "T 4012", 20]],
      [{ title: "Sales register FY 2025", headers: ["Sr", "Party", "Section", "Qty"], rows: [["1", "Om Metals", "T 4012", "20"]] }],
      [{ headerRow: 1 }],
    );
  });

  test("C-new-5: a letterhead with a year, and a month group repeated under Total", () => {
    sheet(
      [["Despatch Register 2025-26", "", "", "Fourcubes Extrusions"], ["Sr", "Party", "Section", "Qty"], [1, "Om Metals", "T 4012", 20]],
      [{ title: "Despatch Register 2025-26 Fourcubes Extrusions", headers: ["Sr", "Party", "Section", "Qty"], rows: [["1", "Om Metals", "T 4012", "20"]] }],
      [{ headerRow: 1 }],
    );
    sheet(
      [["Party", "Apr 2025", "", "Total", ""], ["", "Kg", "Pcs", "Kg", "Pcs"], ["Shree Ganesh", 120, 4, 120, 4]],
      [{ title: null, headers: ["Party", "Apr 2025 Kg", "Apr 2025 Pcs", "Total Kg", "Total Pcs"], rows: [["Shree Ganesh", "120", "4", "120", "4"]] }],
      [{ headerRow: 0, headerRows: 2 }],
    );
  });
});

// Pages: rows 15 units apart, text 10 units high.
const it = (str: string, x: number, y: number, width = str.length * 5): TextItem => ({ str, x, y, width, height: 10 });
const header = (y: number) => [it("Sr", 50, y), it("Section", 100, y), it("Qty", 240, y), it("Weight", 300, y)];
const row = (y: number, sr: string, sec: string, qty: string, wt: string) => [it(sr, 50, y), it(sec, 100, y), it(qty, 245, y), it(wt, 320, y)];
const page1 = [it("PACKING LIST 31.10.2025", 50, 800), ...header(770), ...row(755, "1", "R 2105", "25", "1200"), ...row(740, "2", "R 2106", "8", "980")];
const two = [["1", "R 2105", "25", "1200"], ["2", "R 2106", "8", "980"]];
const H = ["Sr", "Section", "Qty", "Weight"];
const cust = (y: number, name: string, phone = "", city = "") => [it(name, 50, y), ...(phone ? [it(phone, 200, y)] : []), ...(city ? [it(city, 300, y)] : [])];
const custHeader = (y: number) => [it("Name", 50, y), it("Phone", 200, y), it("City", 300, y)];

describe("pdf cases", () => {
  test("C16: a continuation page with no repeated header", () => {
    const page2 = [...row(800, "3", "T 4012", "5", "410"), ...row(785, "4", "T 4013", "6", "420")];
    pdf([page1, page2], [{ headers: H, rows: [...two, ["3", "T 4012", "5", "410"], ["4", "T 4013", "6", "420"]] }], [{ page: 1, headerRow: 1, lastPage: 2, lastDataRow: 1 }]);
  });

  test("C17: a page number, a two-cell footer, a wrapped line", () => {
    pdf([[...page1, it("Page 1 of 3", 250, 100)]], [{ headers: H, rows: two }], [{ page: 1, headerRow: 1 }]);
    const page2 = [...header(800), ...row(785, "3", "T 4012", "5", "410")];
    pdf([[...page1, it("Printed 10/11/2025", 50, 100), it("Page 1 of 3", 300, 100)], page2], [{ headers: H, rows: [...two, ["3", "T 4012", "5", "410"]] }], [
      { page: 1, headerRow: 1, lastPage: 2, lastDataRow: 1 },
    ]);
    const items = [...header(770), ...row(755, "1", "R 2105 long", "25", "1200"), it("description", 100, 746), ...row(735, "2", "R 2106", "8", "980")];
    pdf([items], [{ headers: H, rows: [["1", "R 2105 long description", "25", "1200"], ["2", "R 2106", "8", "980"]] }], [{ page: 1, headerRow: 0 }]);
  });

  test("C-new-2: continuation rows are placed by x", () => {
    const hdr = (y: number) => [it("Sr", 50, y), it("PO", 90, y), it("Section", 150, y), it("Pcs", 260, y), it("Wt", 320, y)];
    const line = (y: number, sr: string, po: string, sec: string, pcs: string, wt: string) => [it(sr, 50, y), ...(po ? [it(po, 90, y)] : []), it(sec, 150, y), it(pcs, 265, y), it(wt, 320, y)];
    const first = [...hdr(770), ...line(755, "1", "P11", "R 2105", "25", "1200"), ...line(740, "2", "P12", "R 2106", "8", "980")];
    const page2 = [...line(800, "3", "", "T 4013", "6", "420"), ...line(785, "4", "", "T 4014", "7", "430")];
    pdf(
      [first, page2],
      [{ headers: ["Sr", "PO", "Section", "Pcs", "Wt"], rows: [["1", "P11", "R 2105", "25", "1200"], ["2", "P12", "R 2106", "8", "980"], ["3", "", "T 4013", "6", "420"], ["4", "", "T 4014", "7", "430"]] }],
      [{ page: 1, headerRow: 0, lastPage: 2, lastDataRow: 1 }],
    );
  });

  test("C-new-3 and C-new-4: one-cell rows of a customer list", () => {
    pdf(
      [[...custHeader(770), ...cust(755, "Asha", "9898", "Surat"), ...cust(740, "Zenith Traders"), ...cust(725, "Kamal", "9797", "Rajkot")]],
      [{ headers: ["Name", "Phone", "City"], rows: [["Asha", "9898", "Surat"], ["Zenith Traders", "", ""], ["Kamal", "9797", "Rajkot"]] }],
      [{ page: 1, headerRow: 0 }],
    );
    pdf(
      [[...custHeader(770), ...cust(755, "Asha", "9898", "Surat"), ...cust(740, "Kamal", "9797", "Rajkot"), ...cust(720, "Om Traders")]],
      [{ headers: ["Name", "Phone", "City"], rows: [["Asha", "9898", "Surat"], ["Kamal", "9797", "Rajkot"], ["Om Traders", "", ""]] }],
      [{ page: 1, headerRow: 0 }],
    );
    pdf(
      [[...custHeader(770), ...cust(755, "Asha", "9898", "Surat"), ...cust(740, "Kamal", "9797", "Rajkot"), it("Authorised Signatory", 50, 725)]],
      [{ headers: ["Name", "Phone", "City"], rows: [["Asha", "9898", "Surat"], ["Kamal", "9797", "Rajkot"]] }],
      [{ page: 1, headerRow: 0, lastDataRow: 2 }],
    );
  });

  test("C-new-6: a table and the line or table next to it keep their own columns", () => {
    const second = [
      it("Summary", 50, 725),
      it("Party", 50, 710), it("Bundles", 170, 710), it("Kg", 280, 710),
      it("Om Metals", 50, 695), it("12", 180, 695), it("2180", 280, 695),
      it("Shree Ganesh", 50, 680), it("4", 185, 680), it("640", 280, 680),
    ];
    const t2 = { headers: ["Party", "Bundles", "Kg"], rows: [["Om Metals", "12", "2180"], ["Shree Ganesh", "4", "640"]] };
    pdf([[...header(770), ...row(755, "1", "R 2105", "25", "1200"), ...row(740, "2", "R 2106", "8", "980"), ...second]], [{ headers: H, rows: two }, { title: "Summary", ...t2 }], [
      { page: 1, headerRow: 0, lastDataRow: 2 },
      { page: 1, headerRow: 4 },
    ]);
    const top = [it("Party: Om Metals", 50, 800), it("Date: 31.10.2025", 300, 800), it("PACKING LIST", 150, 785)];
    pdf([[...top, ...header(770), ...row(755, "1", "R 2105", "25", "1200"), ...row(740, "2", "R 2106", "8", "980")]], [{ title: "Party: Om Metals Date: 31.10.2025 PACKING LIST", headers: H, rows: two }], [{ page: 1, headerRow: 2 }]);
    const near = [it("Party: Om Metals", 50, 785), it("Date: 31.10.2025", 300, 785)];
    pdf([[...near, ...header(770), ...row(755, "1", "R 2105", "25", "1200"), ...row(740, "2", "R 2106", "8", "980")]], [{ title: "Party: Om Metals Date: 31.10.2025", headers: H, rows: two }], [{ page: 1, headerRow: 1 }]);
    for (const gap of [15, 25]) {
      const y = 740 - gap;
      const bare = [
        it("Party", 50, y), it("Bundles", 170, y), it("Kg", 280, y),
        it("Om Metals", 50, y - 15), it("12", 180, y - 15), it("2180", 280, y - 15),
        it("Shree Ganesh", 50, y - 30), it("4", 185, y - 30), it("640", 280, y - 30),
      ];
      pdf([[...header(770), ...row(755, "1", "R 2105", "25", "1200"), ...row(740, "2", "R 2106", "8", "980"), ...bare]], [{ headers: H, rows: two }, t2], [
        { page: 1, headerRow: 0, lastDataRow: 2 },
        { page: 1, headerRow: 3 },
      ]);
    }
  });

  test("C-new-7: a wrapped line in a tightly spaced table, and a one-cell row in the key column", () => {
    pdf(
      [[...header(770), ...row(759, "1", "R 2105 long", "25", "1200"), it("description", 100, 750), ...row(739, "2", "R 2106", "8", "980"), ...row(728, "3", "R 2107", "9", "990")]],
      [{ headers: H, rows: [["1", "R 2105 long description", "25", "1200"], ["2", "R 2106", "8", "980"], ["3", "R 2107", "9", "990"]] }],
      [{ page: 1, headerRow: 0 }],
    );
    pdf(
      [[...custHeader(770), ...cust(759, "Asha", "9898", "Surat"), ...cust(748, "Zenith Traders"), ...cust(737, "Kamal", "9797", "Rajkot"), ...cust(726, "Om", "9696", "Pune")]],
      [{ headers: ["Name", "Phone", "City"], rows: [["Asha", "9898", "Surat"], ["Zenith Traders", "", ""], ["Kamal", "9797", "Rajkot"], ["Om", "9696", "Pune"]] }],
      [{ page: 1, headerRow: 0 }],
    );
  });

  test("R-new-5: a word in a number column", () => {
    const h4 = (y: number) => [it("Party", 50, y), it("Section", 150, y), it("Qty", 250, y), it("Kg", 300, y)];
    const r4 = (y: number, p: string, s: string, q: string, k: string) => [it(p, 50, y), it(s, 150, y), ...(q ? [it(q, 250, y)] : []), it(k, 300, y)];
    pdf(
      [[...h4(770), ...r4(755, "Om Metals", "R 2105", "12", "1200"), ...r4(740, "Shree Ganesh", "T 4012", "", "Cancelled"), ...r4(725, "Kamal", "R 2106", "5", "500"), ...r4(710, "Om", "T 4013", "6", "600")]],
      [{ headers: ["Party", "Section", "Qty", "Kg"], rows: [["Om Metals", "R 2105", "12", "1200"], ["Shree Ganesh", "T 4012", "", "Cancelled"], ["Kamal", "R 2106", "5", "500"], ["Om", "T 4013", "6", "600"]] }],
      [{ page: 1, headerRow: 0 }],
    );
    pdf(
      [[...custHeader(770), ...cust(755, "Asha", "9898", "Surat"), ...cust(740, "Zenith Traders", "not given", "Rajkot"), ...cust(725, "Kamal", "9797", "Rajkot"), ...cust(710, "Om", "9696", "Pune")]],
      [{ headers: ["Name", "Phone", "City"], rows: [["Asha", "9898", "Surat"], ["Zenith Traders", "not given", "Rajkot"], ["Kamal", "9797", "Rajkot"], ["Om", "9696", "Pune"]] }],
      [{ page: 1, headerRow: 0 }],
    );
    pdf(
      [[...custHeader(770), ...cust(755, "Asha", "9898", "Surat"), it("Zenith Traders", 50, 740), it("closed", 420, 740), ...cust(725, "Kamal", "9797", "Rajkot"), ...cust(710, "Om", "9696", "Pune")]],
      // Round 5, rule 5.3: never a column with no name. This pinned "closed" in an unnamed fourth column; it now pins it
      // in the last band, City, as the rule places it.
      [{ headers: ["Name", "Phone", "City"], rows: [["Asha", "9898", "Surat"], ["Zenith Traders", "", "closed"], ["Kamal", "9797", "Rajkot"], ["Om", "9696", "Pune"]] }],
      [{ page: 1, headerRow: 0 }],
    );
  });
});
