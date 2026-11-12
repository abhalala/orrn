import { describe, expect, test } from "bun:test";

import { readSheet, type SheetRead } from "./blocks";
import { readCsv } from "./csv";

// Round 9, PORTAL-RULES-3 section 9: rule 8.1 tightened. Kinds are strict (a number column goes on only with a number
// or a blank, a date column only with a date or a blank). After a blank row, three signs mark the start of another
// table: a cell equal to its own column's name while the row is not a full repeat; three or more whole numbers rising
// by one; number cells only in columns that were blank in every row above. The cases are the checker's round 8
// reproductions (r8c, r8b). Synthetic rows only.

const filled = (rs: readonly (readonly string[])[]) => rs.filter((r) => r.some((c) => c !== ""));
const both = (m: string[][]): [string, SheetRead][] => [
  ["guess", readSheet(m)],
  ["hint", readSheet(m, { hints: [{ headerRow: 0 }] })],
  ["csv", readCsv(m.map((x) => x.join(",")).join("\n"))],
];

/** Every filled cell is in a header, a data row, a title, or a listed row, once. */
function accounted(m: readonly (readonly string[])[], r: SheetRead): boolean {
  const seen = new Map<number, number>();
  const add = (k: number) => seen.set(k, (seen.get(k) ?? 0) + 1);
  for (const b of r.blocks) {
    for (let k = b.guess.headerRow; k < b.guess.headerRow + b.headerRows; k++) add(k);
    b.rows.forEach((x, i) => x.some((c) => c !== "") && add(b.firstDataSheetRow + i));
    for (const w of b.warnings) add(w.row);
  }
  for (const w of r.warnings) add(w.row);
  return m.every((x, i) => (x.some((c) => c !== "") ? seen.get(i) === 1 : true));
}

/** The upper table ends at its own rows and the lower one is a block of its own with its own header. */
function splitAt(m: string[][], upperRows: number, lowerHeader: string[], lowerRows: number) {
  for (const [how, r] of both(m)) {
    const msg = `${how}: ${JSON.stringify(r.blocks.map((b) => [b.guess.headerRow, b.headers, b.rows.length]))}`;
    expect(filled(r.blocks[0]!.rows).length, msg).toBe(upperRows);
    const lower = r.blocks.find((b) => JSON.stringify(b.headers.slice(0, lowerHeader.length)) === JSON.stringify(lowerHeader));
    expect(lower, msg).toBeDefined();
    expect(filled(lower!.rows).length, msg).toBe(lowerRows);
    expect(accounted(m, r), msg).toBe(true);
  }
}

describe("9: strict kinds", () => {
  test("a date in a number column ends the table (the next week's header)", () => {
    const m = [["Party", "1/11/2026", "2/11/2026"], ["Om", "120", "0"], ["Shah", "0", "80"], [], ["Om", "8/11/2026", "9/11/2026"], ["Om", "60", "0"]];
    splitAt(m, 2, ["Om", "8/11/2026", "9/11/2026"], 1);
  });

  test("a number in a date column ends the table", () => {
    const m = [["Party", "Date", "Kg"], ["Om", "1/11/2026", "120"], ["Shah", "2/11/2026", "80"], [], ["Code", "12", "14"], ["T4012", "4", "5"]];
    splitAt(m, 2, ["Code", "12", "14"], 1);
  });

  test("a number or a date where it belongs still goes on", () => {
    const m = [["Party", "Date", "Kg"], ["Om", "1/11/2026", "120"], [], ["Shah", "2/11/2026", "80"], ["Patel", "", "90"]];
    for (const [how, r] of both(m)) {
      expect(r.blocks.length, how).toBe(1);
      expect(filled(r.blocks[0]!.rows).length, how).toBe(3);
    }
  });
});

const P = ["Party", "City", "Kg", "Rate"];
const pk = (n: number, rate = true) => [P, ...Array.from({ length: n }, (_, i) => ["Om " + i, "Rajkot", String(300 + i), rate ? "245" : ""])];

describe("9: the signs of another table after a blank row", () => {
  test("r8c: a second week headed 'Party | 8/11/2026 | ...' is its own table", () => {
    const m = [["Party", "1/11/2026", "2/11/2026", "3/11/2026"], ["Om Metals", "120", "0", "80"], ["Mehta Bros", "0", "40", "0"], [], ["Party", "8/11/2026", "9/11/2026", "10/11/2026"], ["Om Metals", "60", "0", "20"], ["Mehta Bros", "40", "20", "0"]];
    splitAt(m, 2, ["Party", "8/11/2026", "9/11/2026", "10/11/2026"], 2);
  });

  test("month numbers: 'Section | 1 | 2 | 3' then 'Section | 4 | 5 | 6'", () => {
    const m = [["Section", "1", "2", "3"], ["T4012", "10", "11", "12"], ["T4013", "5", "6", "7"], [], ["Section", "4", "5", "6"], ["T4012", "13", "14", "15"], ["T4013", "8", "9", "10"]];
    splitAt(m, 2, ["Section", "4", "5", "6"], 2);
  });

  test("years: 'Party | 2025 | 2026' then 'Party | 2026 | 2027'", () => {
    const m = [["Party", "2025", "2026"], ["Om", "120", "130"], ["Shah", "80", "90"], [], ["Party", "2026", "2027"], ["Om", "130", "140"], ["Shah", "90", "95"]];
    splitAt(m, 2, ["Party", "2026", "2027"], 2);
  });

  test("alloys as column names: 'Grade | | 6063 | 6061' then 'Grade | | 6082 | 6005'", () => {
    const m = [["Grade", "", "6063", "6061"], ["T4", "", "12", "13"], ["T6", "", "14", "15"], [], ["Grade", "", "6082", "6005"], ["T4", "", "4", "5"], ["T6", "", "6", "7"]];
    splitAt(m, 2, ["Grade", "", "6082", "6005"], 2);
  });

  test("lengths as column names: 'Section | 12 | 14 | 16' then 'Section | 18 | 20 | 22'", () => {
    const m = [["Section", "12", "14", "16"], ["T4012", "4", "5", "6"], ["T4013", "1", "0", "3"], [], ["Section", "18", "20", "22"], ["T4012", "2", "0", "1"]];
    splitAt(m, 2, ["Section", "18", "20", "22"], 1);
  });

  test("lengths that rise by one: ' | 12 | 13 | 14' under a party table", () => {
    const m = [...pk(6), [], ["", "12", "13", "14"], ["T4012", "4", "5", "6"], ["T4013", "1", "0", "3"]];
    splitAt(m, 6, ["", "12", "13", "14"], 2);
  });

  test("a row of column numbers '1 | 2 | 3 | 4' under a party table", () => {
    const m = [...pk(6), [], ["1", "2", "3", "4"], ["Shah", "Morbi", "200", "250"]];
    splitAt(m, 6, ["1", "2", "3", "4"], 1);
  });

  test("number cells only in a column blank in every row above: 'Vehicle | Driver | | 12'", () => {
    const m = [...pk(6, false), [], ["Vehicle", "Driver", "", "12"], ["GJ03AB1234", "Ramesh", "4520", "3"]];
    splitAt(m, 6, ["Vehicle", "Driver", "", "12"], 1);
  });

  test("a full repeat is still left out and listed, and ordinary rows still go on", () => {
    const m = [...pk(3), [], P, ...pk(3).slice(1).map((r) => [r[0] + "x", ...r.slice(1)]), [], ["Om 9", "Morbi", "350", "250"]];
    for (const [how, r] of both(m)) {
      expect(r.blocks.length, how).toBe(1);
      expect(filled(r.blocks[0]!.rows).length, how).toBe(7);
      expect(accounted(m, r), how).toBe(true);
    }
  });
});

describe("9: titles are listed as sections", () => {
  const H = ["Party", "Order No", "Section", "Pcs", "Kg"];
  const ob = (from: number, n: number) => Array.from({ length: n }, (_, i) => ["Om " + (from + i), String(100 + from + i), "T40" + (10 + i), "12", String(300 + i)]);
  // Rows: 0 header, 1-4 data, 5 blank, 6 "December", 7-9 data, 10 blank, 11 "Vehicle", 12-13 data.
  const m = [H, ...ob(0, 4), [], ["December"], ...ob(4, 3), [], ["Vehicle"], ["GJ03AB1234", "", "Morbi", "3", "4520"], ["GJ03AB9876", "", "Surat", "2", "3100"]];

  test("each skipped title is a section of the block, with its row and text", () => {
    for (const [how, r] of both(m)) {
      const b = r.blocks[0]!;
      expect(b.sections, how).toEqual([{ row: 6, text: "December" }, { row: 11, text: "Vehicle" }]);
      expect(filled(b.rows).length, how).toBe(9);
      expect(accounted(m, r), how).toBe(true);
    }
  });

  test("a table with no title after a gap has no sections", () => {
    const r = readSheet([H, ...ob(0, 3), [], ...ob(3, 2)]);
    expect(r.blocks[0]!.sections).toEqual([]);
  });

  test("'Start a new table here': lastDataRow set to the row before a section ends the table there exactly", () => {
    const r = readSheet(m, { hints: [{ headerRow: 0, lastDataRow: 10 }] });
    const b = r.blocks.find((x) => x.hints !== null)!;
    expect(b.rows.length).toBe(9); // rows 1 to 9; the blank row 10 is trailing and cut
    expect(filled(b.rows).map((x) => x.filter((c) => c !== ""))).toEqual([...ob(0, 4), ["December"], ...ob(4, 3)]);
    expect(b.guess.lastDataRow).toBe(9);
    const rest = r.blocks.filter((x) => x !== b);
    expect(rest.length).toBeGreaterThan(0);
    expect(rest.every((x) => regionStart(x) >= 11)).toBe(true);
    expect(rest.some((x) => x.title === "Vehicle" && [x.headers, ...x.rows].some((row) => row[0] === "GJ03AB1234"))).toBe(true);
    expect(accounted(m, r)).toBe(true);
    // Read again from the first section: the upper table ends at row 4, the rest are further blocks.
    const r2 = readSheet(m, { hints: [{ headerRow: 0, lastDataRow: 5 }] });
    const b2 = r2.blocks.find((x) => x.hints !== null)!;
    expect(filled(b2.rows)).toEqual(ob(0, 4));
    expect(r2.blocks.filter((x) => x !== b2).every((x) => regionStart(x) >= 6)).toBe(true);
    expect(r2.blocks.length).toBeGreaterThan(1);
    expect(accounted(m, r2)).toBe(true);
  });
});

const regionStart = (b: { guess: { headerRow: number }; headerRow: number }) => b.guess.headerRow - b.headerRow;

describe("9: a part split from the table above still knows its names", () => {
  // Found by the round 9 property (seeds 230 and 4071). A word in a number column splits the table; the part below has
  // a data row as its header. A second table headed with the first table's first name, after a blank row, must not
  // join that part.
  const H = ["Party", "Date", "Kg"];
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ["Om " + i, `2026-01-${String(i + 1).padStart(2, "0")}`, String(10 + i)]);
  test("a split part's rows, then 'Party | 2021 | 2022': the second table is its own block", () => {
    const nums = (n: number) => Array.from({ length: n }, (_, i) => ["Om " + i, String(40 + i), String(10 + i)]);
    const m = [["Party", "Kg", "Rate"], ...nums(3), [], ["Shah", "cancelled", ""], ...nums(3), [], ["Party", "2021", "2022"], ["T4012", "29", "8"], ["K1100", "13", "28"]];
    for (const [how, r] of both(m)) {
      const b = r.blocks.find((x) => x.guess.headerRow === 10);
      expect(b, `${how} ${JSON.stringify(r.blocks.map((x) => x.guess))}`).toBeDefined();
      expect(filled(b!.rows).length, how).toBe(2);
      expect(accounted(m, r), how).toBe(true);
    }
  });
  test("a split part of one row with a blank spacer under it, then 'Party | 3 | 4'", () => {
    const m = [H, ...rows(3), [], ["Shah", "cancelled", ""], [], [], ["Shah", "98", "Rajkot"], [], ["Party", "3", "4"], ["T4012", "29", "8"]];
    for (const [how, r] of both(m)) {
      const b = r.blocks.find((x) => x.guess.headerRow === 10);
      expect(b, `${how} ${JSON.stringify(r.blocks.map((x) => x.guess))}`).toBeDefined();
      expect(accounted(m, r), how).toBe(true);
    }
  });
});
