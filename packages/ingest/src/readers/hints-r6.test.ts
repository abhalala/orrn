import { describe, expect, test } from "bun:test";

import { HintError, readSheet } from "./blocks";

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

// Round 6, item 5 (minors H5 and H12): a hint on a blank row fails with the hint error, and a first data row past the
// end is named in the error text.
describe("round 6: hint errors", () => {
  const m = [["Order book"], [], ["Party", "Kg"], ["Om", "12"], ["Mehta", "8"]];
  const err = (f: () => unknown): HintError | null => {
    try {
      f();
    } catch (e) {
      return e as HintError;
    }
    return null;
  };

  test("a header hint on a blank row is out of range", () => {
    const e = err(() => readSheet(m, { hints: [{ headerRow: 1 }] }));
    expect(e).toBeInstanceOf(HintError);
    expect(e!.code).toBe("hint_out_of_range");
    expect(e!.message).toContain("header row 1 is blank");
    // Two header rows that are both blank fail too; a blank top row over a filled one is a header.
    expect(err(() => readSheet([["a", "b"], [], [], ["Om", "1"]], { hints: [{ headerRow: 1, headerRows: 2 }] }))!.code).toBe("hint_out_of_range");
    expect(err(() => readSheet(m, { hints: [{ headerRow: 1, headerRows: 2 }] }))).toBeNull();
  });

  test("a first data row past the end names the first data row", () => {
    const e = err(() => readSheet(m, { hints: [{ headerRow: 2, firstDataRow: 9 }] }));
    expect(e).toBeInstanceOf(HintError);
    expect(e!.code).toBe("hint_out_of_range");
    expect(e!.message).toBe("first data row 9 is not in the sheet");
    // A header on the last row with no data rows is still a block with no rows.
    expect(readSheet([["Party", "Kg"]], { hints: [{ headerRow: 0 }] }).blocks[0]!.rows).toEqual([]);
  });
});
