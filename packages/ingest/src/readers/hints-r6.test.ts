import { describe, expect, test } from "bun:test";

import { readSheet } from "./blocks";

// Round 6, item 3 (M-R5-1): a hinted block with no last data row runs to the last filled row of its region (up to
// the next hinted header, or the end of the sheet), across any number of blank rows. Nothing after the header is
// left as a warning outside every block. Synthetic sheets only.

describe("round 6: a hint with no last row runs to the last filled row", () => {
  for (const blanks of [2, 3, 7]) {
    test(`${blanks} blank rows inside the data do not end the block`, () => {
      const m = [["Order book"], ["Party", "Kg"], ["Om", "12"], ...Array.from({ length: blanks }, () => []), ["Mehta", "8"], [], [], ["Total", "20"]];
      const r = readSheet(m, { hints: [{ headerRow: 1 }] });
      expect(r.blocks.length).toBe(1);
      const b = r.blocks[0]!;
      expect(b.guess.lastDataRow).toBe(m.length - 1);
      expect(b.rows.filter((x) => x.some((c) => c !== "")).map((x) => x[0])).toEqual(["Om", "Mehta", "Total"]);
      // The title row above the header is kept as the title; no row after the header is a warning.
      expect(b.warnings.filter((w) => w.row > 1)).toEqual([]);
      expect(r.warnings).toEqual([]);
    });
  }

  test("the block stops before the next hinted header, however many blank rows lie between", () => {
    const m = [["Party", "Kg"], ["Om", "12"], [], [], [], ["Mehta", "8"], [], [], ["Section", "Kg"], ["T4012", "3.5"]];
    const r = readSheet(m, { hints: [{ headerRow: 0 }, { headerRow: 8 }] });
    expect(r.blocks.map((b) => [b.guess.headerRow, b.guess.lastDataRow])).toEqual([[0, 5], [8, 9]]);
    expect(r.warnings).toEqual([]);
  });
});
