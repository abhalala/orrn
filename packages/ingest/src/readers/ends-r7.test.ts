import { describe, expect, test } from "bun:test";

import { chooseHeaderInSheet } from "../header";
import { HintError, readSheet, regionStartOf, type SheetRead } from "./blocks";
import { readCsv } from "./csv";

// Round 7, rule 6.1 (B-R6-1): a hinted block with no last row ends at the first fully blank row. What lies below is
// read by the normal path as further blocks, so a second table is never swallowed. A block that follows another with
// only blank rows between says so, and the header check offers to join it. Synthetic sheets only.

const H = ["Party", "Order No", "PO", "Section", "Kg", "Rate"];
const data = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ["Om", String(100 + from + i), `PO${from + i}`, "T4012", "340", "245"]);
const SUB = [["Section", "Pcs", "Kg"], ["T4012", "12", "340"], ["T4013", "8", "210"], ["T4014", "9", "220"]];
const blank = (n: number) => Array.from({ length: n }, () => [] as string[]);
const filledRows = (m: readonly (readonly string[])[]) => m.filter((r) => r.some((c) => c !== "")).length;

/** Every filled row is a header, title or data row of a block, or a warning of a block. Never a sheet warning. */
function placed(m: readonly (readonly string[])[], r: SheetRead): number {
  const seen = new Set<number>();
  for (const b of r.blocks) {
    for (let k = regionStartOf(b); k < b.guess.headerRow + b.headerRows; k++) seen.add(k);
    b.rows.forEach((_, i) => seen.add(b.firstDataSheetRow + i));
    for (const w of b.warnings) seen.add(w.row);
  }
  return m.filter((row, i) => row.some((c) => c !== "") && seen.has(i)).length;
}

describe("6.1: a hinted table ends at the first blank row", () => {
  for (const gap of [1, 2, 3, 10]) {
    test(`r6g: a second table ${gap} blank rows below is its own block, not rows of the order book`, () => {
      const m = [H, ...data(10), ...blank(gap), ...SUB];
      const r = readSheet(m, { hints: [{ headerRow: 0 }] });
      expect(r.blocks.map((b) => [b.guess.headerRow, b.rows.length, b.hints !== null])).toEqual([[0, 10, true], [11 + gap, 3, false]]);
      expect(r.blocks[1]!.headers).toEqual(["Section", "Pcs", "Kg"]);
      expect(r.blocks[1]!.follows).toEqual({ block: 0, gapRows: gap });
      expect(r.blocks[0]!.follows).toBeNull();
      expect(r.warnings).toEqual([]);
      expect(placed(m, r)).toBe(filledRows(m));
      const c = chooseHeaderInSheet(r.blocks, 1);
      expect(c.kind).toBe("ask");
      if (c.kind === "ask") expect([c.continuesAbove, c.sameColumnsAsAbove]).toEqual([false, false]);
    });
  }

  test("r6g: a titled second table keeps its title", () => {
    const m = [H, ...data(10), [], [], ["Summary by section"], ...SUB];
    const r = readSheet(m, { hints: [{ headerRow: 0 }] });
    expect(r.blocks.map((b) => [b.guess.headerRow, b.rows.length, b.title])).toEqual([[0, 10, null], [14, 3, "Summary by section"]]);
    expect(r.blocks[1]!.follows).toEqual({ block: 0, gapRows: 2 });
  });

  test("a second month in the same layout below: offered as the same columns, joined by lastDataRow and skipRows", () => {
    const m = [H, ...data(10), [], [], ["December"], H, ...data(4, 10)];
    const r = readSheet(m, { hints: [{ headerRow: 0 }] });
    expect(r.blocks.map((b) => [b.guess.headerRow, b.rows.length, b.title])).toEqual([[0, 10, null], [14, 4, "December"]]);
    const c = chooseHeaderInSheet(r.blocks, 1);
    expect(c.kind).toBe("ask");
    if (c.kind === "ask") expect([c.continuesAbove, c.sameColumnsAsAbove]).toEqual([false, true]);
    // The web's join: the upper hint again, with this block's last row and the title and repeated header left out.
    const j = readSheet(m, { hints: [{ headerRow: 0, lastDataRow: 18, skipRows: [13, 14] }] });
    expect(j.blocks.length).toBe(1);
    const b = j.blocks[0]!;
    expect(b.rows.length).toBe(18);
    expect(b.rows.filter((x) => x.some((c) => c !== "")).map((x) => x[1])).toEqual(Array.from({ length: 14 }, (_, i) => String(100 + i)));
    // Row i of rows is still sheet row firstDataSheetRow + i: a skipped row is blank in `rows` and listed.
    expect(b.rows[12]!.every((c) => c === "")).toBe(true);
    expect(b.rows[13]!.every((c) => c === "")).toBe(true);
    expect(b.warnings).toEqual([{ code: "skipped_by_hint", row: 13 }, { code: "skipped_by_hint", row: 14 }]);
  });

  test("rows of the same table after a blank row: a block of their own, offered as continuing the table above", () => {
    const m = [H, ...data(5), [], [], ...data(4, 5)];
    const r = readSheet(m, { hints: [{ headerRow: 0 }] });
    expect(r.blocks.map((b) => [b.guess.headerRow, b.rows.length])).toEqual([[0, 5], [8, 3]]);
    expect(r.blocks[1]!.follows).toEqual({ block: 0, gapRows: 2 });
    const c = chooseHeaderInSheet(r.blocks, 1);
    expect(c.kind).toBe("ask");
    if (c.kind === "ask") expect([c.continuesAbove, c.sameColumnsAsAbove]).toEqual([true, false]);
    // A hint with a last row reads across blank rows exactly, and the block below goes away.
    const j = readSheet(m, { hints: [{ headerRow: 0, lastDataRow: 11 }] });
    expect(j.blocks.length).toBe(1);
    expect(j.blocks[0]!.rows.map((x) => x[1] ?? "")).toEqual(["100", "101", "102", "103", "104", "", "", "105", "106", "107", "108"]);
    expect(j.warnings).toEqual([]);
  });

  test("one row of data after a blank row is a block too, never only a warning", () => {
    const m = [H, ...data(5), [], ...data(1, 5)];
    const r = readSheet(m, { hints: [{ headerRow: 0 }] });
    expect(r.blocks.length).toBe(2);
    expect(r.blocks[1]!.guess.headerRow).toBe(7);
    expect(r.blocks[1]!.follows).toEqual({ block: 0, gapRows: 1 });
    const c = chooseHeaderInSheet(r.blocks, 1);
    expect(c.kind === "ask" && c.continuesAbove).toBe(true);
    expect(placed(m, r)).toBe(filledRows(m));
  });

  test("a stray note far below is a warning of the block above, never a sheet warning", () => {
    const m = [H, ...data(5), ...blank(50), ["checked"]];
    const r = readSheet(m, { hints: [{ headerRow: 0 }] });
    expect(r.blocks.length).toBe(1);
    expect(r.blocks[0]!.rows.length).toBe(5);
    expect(r.blocks[0]!.warnings).toEqual([{ code: "after_last_row", row: 56 }]);
    expect(r.warnings).toEqual([]);
  });

  test("CSV reads the same way", () => {
    const csv = [H, ...data(3), [], ...SUB].map((r) => r.join(",")).join("\n");
    const r = readCsv(csv, { hints: [{ headerRow: 0 }] });
    expect(r.blocks.map((b) => [b.guess.headerRow, b.rows.length])).toEqual([[0, 3], [5, 3]]);
    expect(r.blocks[1]!.follows).toEqual({ block: 0, gapRows: 1 });
  });

  test("a skip row outside the block is a hint error", () => {
    const m = [H, ...data(5)];
    let e: unknown = null;
    try {
      readSheet(m, { hints: [{ headerRow: 0, skipRows: [9] }] });
    } catch (x) {
      e = x;
    }
    expect(e).toBeInstanceOf(HintError);
    expect((e as HintError).code).toBe("hint_out_of_range");
    expect(() => readSheet(m, { hints: [{ headerRow: 0, skipRows: [1.5] as number[] }] })).toThrow(HintError);
  });

  test("an unhinted sheet sets follows on a guessed split too", () => {
    const m = [H, ...data(3), [], ...SUB];
    const r = readSheet(m);
    expect(r.blocks.length).toBe(2);
    expect(r.blocks[1]!.follows).toEqual({ block: 0, gapRows: 1 });
  });

  // Found by the round 7 property (seeds 148, 16, 253): the guess below a hinted block must not take the next table.
  const LIST = (from: number, n: number) => Array.from({ length: n }, (_, i) => [`Party ${from + i}`, `98250${10000 + from + i}`, i % 2 ? "Rajkot" : "Morbi"]);
  test("a table that repeats the hinted header below, with no column of numbers, is a block of its own", () => {
    const head = ["Firm", "Contact", "Place"]; // no built-in layout has these names, so the check asks
    for (const title of [[], [["December"]]]) {
      const m = [head, ...LIST(0, 2), [], ...LIST(2, 3), [], [], [], ...title, head, ...LIST(5, 4)];
      const h2 = m.length - 5;
      const r = readSheet(m, { hints: [{ headerRow: 0 }] });
      const b2 = r.blocks.find((b) => b.guess.headerRow === h2);
      expect(b2, JSON.stringify(r.blocks.map((b) => b.guess))).toBeDefined();
      expect(b2!.rows.length).toBe(4);
      expect(b2!.follows).not.toBeNull();
      expect(r.blocks[0]!.rows.length).toBe(2);
      expect(placed(m, r)).toBe(filledRows(m));
      const c = chooseHeaderInSheet(r.blocks, r.blocks.indexOf(b2!));
      expect(c.kind === "ask" && c.sameColumnsAsAbove).toBe(false); // the block above it is the guessed one, not the hinted header
    }
  });

  test("the guess splits at a row that repeats its own header after blank rows", () => {
    const head = ["Firm", "Contact", "Place"]; // no built-in layout has these names, so the check asks
    const m = [head, ...LIST(0, 3), [], [], head, ...LIST(3, 3)];
    const r = readSheet(m);
    expect(r.blocks.map((b) => [b.guess.headerRow, b.rows.length])).toEqual([[0, 3], [6, 3]]);
    const c = chooseHeaderInSheet(r.blocks, 1);
    expect(c.kind === "ask" && c.sameColumnsAsAbove).toBe(true);
  });

  test("a units row under the second table's header does not turn the table into warnings", () => {
    const m = [["Date", "Party", "Kg"], ["2025-01-02", "Om", "21.05"], [], ["Party", "Order No", "Pcs", "Rate"], ["", "nos", "nos", "inr"], ["Om", "308", "218", "28.72"], ["Mehta", "119", "552", "6.55"]];
    const r = readSheet(m, { hints: [{ headerRow: 0 }] });
    expect(r.blocks.length).toBe(2);
    expect(regionStartOf(r.blocks[1]!)).toBe(3);
    expect(r.blocks[0]!.warnings).toEqual([]);
    expect(placed(m, r)).toBe(filledRows(m));
  });
});
