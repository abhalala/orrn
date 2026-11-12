import { describe, expect, test } from "bun:test";

import { findBlocks, HintError, readSheet } from "./blocks";
import { readCsv } from "./csv";
import { asked, picked } from "./trust-helpers";

// PORTAL-RULES-3 section 3: with hints a reader does not guess. Synthetic sheets only.

describe("sheet hints are followed exactly", () => {
  // The reader's guess makes this a two-row header (R-new-3). The hint says one row.
  const ragged = [["Name", "Phone", "City"], ["Asha", "", "Surat", "vip"], ["Kamal", "9797", "Rajkot"]];

  test("a one-row header hint keeps the first data row", () => {
    const [b] = findBlocks(ragged, { hints: [{ headerRow: 0 }] });
    expect(b!.headerRows).toBe(1);
    expect(b!.headers).toEqual(["Name", "Phone", "City", ""]);
    expect(b!.rows).toEqual([
      ["Asha", "", "Surat", "vip"],
      ["Kamal", "9797", "Rajkot"],
    ]);
    expect(picked(b!)).toBe(true);
    expect(b!.hints).toEqual({ headerRow: 0 });
  });

  test("the header row, a two-row header, the first and the last data row", () => {
    const m = [
      ["Sales register"],
      ["Party", "Apr 2025", "", "May 2025", ""],
      ["", "Kg", "Pcs", "Kg", "Pcs"],
      ["note under the header"],
      ["Om", 1, 2, 3, 4],
      ["Asha", 5, 6, 7, 8],
      ["Prepared by"],
    ];
    const r = readSheet(m, { hints: [{ headerRow: 1, headerRows: 2, firstDataRow: 4, lastDataRow: 5 }] });
    const [b] = r.blocks;
    expect(b!.title).toBe("Sales register");
    expect(b!.headers).toEqual(["Party", "Apr 2025 Kg", "Apr 2025 Pcs", "May 2025 Kg", "May 2025 Pcs"]);
    expect(b!.rows).toEqual([
      ["Om", "1", "2", "3", "4"],
      ["Asha", "5", "6", "7", "8"],
    ]);
    expect(b!.firstDataSheetRow).toBe(4);
    expect(b!.headerRow).toBe(1);
    // Rule 4.1: every row of the region not in the rows is listed, the one-cell title too.
    expect(b!.warnings).toEqual([
      { code: "kept_as_title", row: 0 },
      { code: "skipped_by_hint", row: 3 },
      { code: "after_last_row", row: 6 },
    ]);
  });

  test("a word row the guess would take as a new header stays a row under a hint with its last row", () => {
    const m = [["Party", "Section", "Qty", "Kg"], ["Om", "R 2105", 12, 1200], [], ["Shree Ganesh", "T 4012", "Cancelled", ""], ["Kamal", "R 2106", 5, 500]];
    expect(findBlocks(m).length).toBe(2);
    // Round 5, rule 5.2 (B5) pinned one block holding every row with no last row. Round 7, rule 6.1: with no last
    // row the hinted block ends at the blank row and the rows below follow in a block of their own; with its last
    // row (below) it holds every row, as this test's title says.
    const open = findBlocks(m, { hints: [{ headerRow: 0 }] });
    expect(open.map((b) => b.rows.length)).toEqual([1, 1]);
    expect(open[1]!.follows).toEqual({ block: 0, gapRows: 1 });
    // Without hints the guess still splits, and the second block is asked about.
    expect(asked(findBlocks(m)[1]!)).toBe(true);
    const [b, ...rest] = findBlocks(m, { hints: [{ headerRow: 0, lastDataRow: 4 }] });
    expect(rest).toEqual([]);
    expect(b!.rows.length).toBe(4);
  });

  test("two hinted blocks; without a last row a block runs to the next header", () => {
    const m = [["A", "B"], [1, 2], ["Title two"], ["C", "D"], [3, 4]];
    const open = findBlocks(m, { hints: [{ headerRow: 0 }, { headerRow: 3 }] });
    expect(open.map((b) => b.rows)).toEqual([[["1", "2"], ["Title two"]], [["3", "4"]]]);
    const closed = findBlocks(m, { hints: [{ headerRow: 3 }, { headerRow: 0, lastDataRow: 1 }] });
    expect(closed.map((b) => b.rows)).toEqual([[["1", "2"]], [["3", "4"]]]);
    expect(closed[1]!.title).toBe("Title two");
  });

  test("the guess as hints gives the same block back", () => {
    const sheets = [
      [["PENDING ORDER LIST"], ["Sr", "Party", "Qty"], [1, "Om", 5], ["", "TOTAL", 5]],
      [["Section", "Weight", "", "Rate"], ["", "Min", "Max", ""], ["R2105", 2.1, 2.4, 200]],
      [["Series", "Section", "Qty"], ["R", "2105", 4], [], ["Pending"], ["Party", "Section", "Qty"], ["Om", "2105", 7]],
    ];
    for (const m of sheets) {
      const guessed = findBlocks(m);
      const again = findBlocks(m, { hints: guessed.map((b) => b.guess) });
      const pick = (b: (typeof guessed)[number]) => ({ title: b.title, headers: b.headers, rows: b.rows, headerRows: b.headerRows, firstDataSheetRow: b.firstDataSheetRow });
      expect(again.map(pick)).toEqual(guessed.map(pick));
    }
  });

  test("CSV takes the same hints", () => {
    const r = readCsv("Name,Phone,City\nAsha,,Surat,vip\nKamal,9797,Rajkot\n", { hints: [{ headerRow: 0 }] });
    expect(r.blocks[0]!.headers).toEqual(["Name", "Phone", "City", ""]);
    expect(r.blocks[0]!.rows.length).toBe(2);
  });

  test("a hint that cannot be followed is an error, not a guess", () => {
    expect(() => findBlocks([["A", "B"], [1, 2]], { hints: [{ headerRow: 5 }] })).toThrow(HintError);
    expect(() => findBlocks([["A", "B"], [1, 2], [3, 4]], { hints: [{ headerRow: 0, lastDataRow: 2 }, { headerRow: 1 }] })).toThrow(HintError);
    expect(() => findBlocks([["A", "B"], [1, 2]], { hints: [{ headerRow: 1, firstDataRow: 0 }] })).toThrow(HintError);
  });
});
