import { describe, expect, test } from "bun:test";

import { chooseHeader } from "../header";
import { readSheet } from "./blocks";

// PORTAL-RULES-3 section 5.2: a hinted sheet read never splits at a blank row (B5, s2.ts of the round 4 check).
const ORDER = ["Party", "Order No", "PO", "Section", "Cut Length (mm)", "Pcs", "Kg", "Rate"];
const S2 = [
  ORDER,
  ["Om Metals", "101", "PO1", "T4012", "3660", "120", "340", "245"],
  ["Mehta", "102", "PO2", "T4013", "3660", "80", "210", "245"],
  [],
  ["Shree Ganesh", "103", "PO3", "T4014", "", "", "pending", ""],
  ["Jay Ambe", "104", "PO4", "T4015", "3660", "60", "150", "250"],
  ["Patel", "105", "PO5", "T4016", "3660", "40", "100", "250"],
];

describe("5.2: hints are exact across blank rows", () => {
  // Round 7, rule 6.1 replaced rule 5.2 for a hint with no last row: the block ends at the first blank row. These
  // tests pinned one block across a blank row; they now pin that the rows below are a block that follows it, and
  // that the hint with its last row (the web's join) reads every row exactly, as rule 5.2 wanted.
  // Round 8, rule 8.1: s2 still splits, because the row after the blank row holds "pending" in the Kg column (text in
  // a number column). `follows` now carries `continues: false`: the table above has number columns.
  test("s2: rows after a blank follow in their own block; the join with the last row reads them all", () => {
    const r = readSheet(S2, { hints: [{ headerRow: 0 }] });
    expect(r.blocks.map((b) => [b.guess.headerRow, b.rows.length])).toEqual([[0, 2], [4, 2]]);
    expect(r.blocks[1]!.follows).toEqual({ block: 0, gapRows: 1, continues: false });
    expect(r.warnings).toEqual([]);
    const j = readSheet(S2, { hints: [{ headerRow: 0, lastDataRow: 6 }] });
    expect(j.blocks.length).toBe(1);
    const b = j.blocks[0]!;
    expect(b.headers).toEqual(ORDER);
    expect(b.rows.map((x) => x[0] ?? "")).toEqual(["Om Metals", "Mehta", "", "Shree Ganesh", "Jay Ambe", "Patel"]);
    expect(b.guess.lastDataRow).toBe(6);
    expect(j.warnings).toEqual([]);
  });

  test("a header-like row after one blank row is a second table, never swallowed (B-R6-1)", () => {
    const m = [["Party", "Kg"], ["Om", "12"], [], ["Section", "Kg"], ["T4012", "3.5"]];
    const r = readSheet(m, { hints: [{ headerRow: 0 }] });
    expect(r.blocks.map((b) => [b.headers, b.rows])).toEqual([[["Party", "Kg"], [["Om", "12"]]], [["Section", "Kg"], [["T4012", "3.5"]]]]);
    expect(r.blocks[1]!.follows).toEqual({ block: 0, gapRows: 1, continues: false });
    // The join, when the person says it is one table, still reads every row.
    expect(readSheet(m, { hints: [{ headerRow: 0, lastDataRow: 4 }] }).blocks[0]!.rows).toEqual([["Om", "12"], [], ["Section", "Kg"], ["T4012", "3.5"]]);
  });

  test("two blank rows end the region too; a hint on the table below keeps it hinted", () => {
    const m = [["Party", "Kg"], ["Om", "12"], [], [], ["Section", "Kg"], ["T4012", "3.5"], ["T4013", "4.5"]];
    const one = readSheet(m, { hints: [{ headerRow: 0 }] });
    expect(one.blocks.map((b) => [b.guess.headerRow, b.rows.length, b.hints !== null])).toEqual([[0, 1, true], [4, 2, false]]);
    const r = readSheet(m, { hints: [{ headerRow: 0 }, { headerRow: 4 }] });
    expect(r.blocks.map((b) => b.headers)).toEqual([["Party", "Kg"], ["Section", "Kg"]]);
    expect(r.blocks[0]!.rows).toEqual([["Om", "12"]]);
    const l = readSheet(m, { hints: [{ headerRow: 0, lastDataRow: 1 }] });
    expect(l.blocks.map((b) => b.headers)).toEqual([["Party", "Kg"], ["Section", "Kg"]]);
    expect(l.blocks[1]!.hints).toBeNull();
  });

  // Round 7, rule 6.1: rows after a given last row that look like data are a block of their own, never only a
  // warning. This pinned them as `after_last_row`; it now pins the block that follows.
  test("a given last row is followed exactly, across blank rows; the rows after it are a block", () => {
    const r = readSheet(S2, { hints: [{ headerRow: 0, lastDataRow: 4 }] });
    expect(r.blocks[0]!.rows.map((x) => x[0] ?? "")).toEqual(["Om Metals", "Mehta", "", "Shree Ganesh"]);
    expect(r.blocks[0]!.warnings).toEqual([]);
    expect(r.blocks.length).toBe(2);
    expect([r.blocks[1]!.guess.headerRow, r.blocks[1]!.guess.lastDataRow]).toEqual([5, 6]);
    expect(r.blocks[1]!.follows).toEqual({ block: 0, gapRows: 0, continues: false });
  });
});

describe("5.2: a guessed split shows the rows around it", () => {
  const m = [
    ["Party", "Kg"],
    ...Array.from({ length: 14 }, (_, i) => ["Om " + i, String(10 + i)]),
    [],
    ["Section", "Min", "Max"],
    ["T4012", "0.41", "0.45"],
    ["T4013", "0.50", "0.54"],
  ];
  test("both previews hold the last rows above the split and the first rows below it", () => {
    const r = readSheet(m);
    expect(r.blocks.length).toBe(2);
    const [a, b] = r.blocks;
    const ra = a!.preview.map((p) => p.row);
    const rb = b!.preview.map((p) => p.row);
    for (const row of [13, 14, 15, 16, 17]) expect(ra).toContain(row);
    for (const row of [13, 14, 15, 16, 17]) expect(rb).toContain(row);
    expect(b!.guess.headerRow).toBe(16);
  });

  test("the rows of the table above in the second preview are never trusted as its header", () => {
    const r = readSheet(m);
    const c = chooseHeader(r.blocks[1]!);
    if (c.kind === "fits") expect(c.headerRow).toBe(16);
  });
});
