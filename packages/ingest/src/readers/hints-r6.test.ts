import { describe, expect, test } from "bun:test";

import { HintError, readSheet } from "./blocks";

// Round 6, item 3 (M-R5-1): rows after blank rows under a hinted header are never lost. Round 7, rule 6.1 replaced
// "runs to the last filled row": these tests pinned one block across the blank rows; they now pin that the block ends
// at the first blank row, that the rows below are in a block that follows it (never only a warning), and that a
// hint with the last row (the web's join) reads them all exactly. Synthetic sheets only.

describe("round 6, re-pinned by rule 6.1: rows after blank rows under a hint", () => {
  for (const blanks of [2, 3, 7]) {
    test(`${blanks} blank rows inside the data: the rows below follow in a block, and the join reads them all`, () => {
      const m = [["Order book"], ["Party", "Kg"], ["Om", "12"], ...Array.from({ length: blanks }, () => []), ["Mehta", "8"], [], [], ["Total", "20"]];
      const r = readSheet(m, { hints: [{ headerRow: 1 }] });
      expect(r.blocks.length).toBe(2);
      expect(r.blocks[0]!.guess.lastDataRow).toBe(2);
      expect(r.blocks[1]!.follows).toEqual({ block: 0, gapRows: blanks });
      expect(r.blocks[1]!.guess.headerRow).toBe(3 + blanks);
      expect(r.blocks[1]!.rows.filter((x) => x.some((c) => c !== "")).map((x) => x[0])).toEqual(["Total"]);
      expect(r.warnings).toEqual([]);
      const j = readSheet(m, { hints: [{ headerRow: 1, lastDataRow: m.length - 1 }] });
      expect(j.blocks.length).toBe(1);
      expect(j.blocks[0]!.rows.filter((x) => x.some((c) => c !== "")).map((x) => x[0])).toEqual(["Om", "Mehta", "Total"]);
      expect(j.warnings).toEqual([]);
    });
  }

  test("before the next hinted header: the rows between are kept (here as its title), never lost", () => {
    const m = [["Party", "Kg"], ["Om", "12"], [], [], [], ["Mehta", "8"], [], [], ["Section", "Kg"], ["T4012", "3.5"]];
    const r = readSheet(m, { hints: [{ headerRow: 0 }, { headerRow: 8 }] });
    expect(r.blocks.map((b) => [b.guess.headerRow, b.guess.lastDataRow])).toEqual([[0, 1], [8, 9]]);
    expect(r.blocks[1]!.warnings).toContainEqual({ code: "kept_as_title", row: 5 });
    expect(r.warnings).toEqual([]);
    const j = readSheet(m, { hints: [{ headerRow: 0, lastDataRow: 5 }, { headerRow: 8 }] });
    expect(j.blocks.map((b) => [b.guess.headerRow, b.guess.lastDataRow])).toEqual([[0, 5], [8, 9]]);
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
