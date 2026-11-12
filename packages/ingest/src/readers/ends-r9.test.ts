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
