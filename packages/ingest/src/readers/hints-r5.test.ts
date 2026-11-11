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
  test("s2: a text-only row after a blank is a row of the hinted block", () => {
    const r = readSheet(S2, { hints: [{ headerRow: 0 }] });
    expect(r.blocks.length).toBe(1);
    const b = r.blocks[0]!;
    expect(b.headers).toEqual(ORDER);
    expect(b.rows.map((x) => x[0] ?? "")).toEqual(["Om Metals", "Mehta", "", "Shree Ganesh", "Jay Ambe", "Patel"]);
    expect(b.guess.lastDataRow).toBe(6);
    expect(r.warnings).toEqual([]);
  });

  test("a header-like row after one blank row is still a row of the hinted block", () => {
    const m = [["Party", "Kg"], ["Om", "12"], [], ["Section", "Kg"], ["T4012", "3.5"]];
    const r = readSheet(m, { hints: [{ headerRow: 0 }] });
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.rows).toEqual([["Om", "12"], [], ["Section", "Kg"], ["T4012", "3.5"]]);
  });

  test("two or more blank rows end the region; the table below is still guessed", () => {
    const m = [["Party", "Kg"], ["Om", "12"], [], [], ["Section", "Kg"], ["T4012", "3.5"], ["T4013", "4.5"]];
    const r = readSheet(m, { hints: [{ headerRow: 0 }] });
    expect(r.blocks.map((b) => b.headers)).toEqual([["Party", "Kg"], ["Section", "Kg"]]);
    expect(r.blocks[0]!.rows).toEqual([["Om", "12"]]);
    expect(r.blocks[1]!.hints).toBeNull();
  });

  test("a given last row is followed exactly, across blank rows", () => {
    const r = readSheet(S2, { hints: [{ headerRow: 0, lastDataRow: 4 }] });
    expect(r.blocks[0]!.rows.map((x) => x[0] ?? "")).toEqual(["Om Metals", "Mehta", "", "Shree Ganesh"]);
    expect(r.blocks[0]!.warnings.map((w) => [w.code, w.row])).toEqual([["after_last_row", 5], ["after_last_row", 6]]);
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
