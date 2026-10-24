import { describe, expect, test } from "bun:test";

import {
  addDaysYmd,
  addRow,
  allLines,
  blockLines,
  blockProblems,
  blocksComplete,
  defaultExpectedDate,
  duplicateRow,
  newBlock,
  patchRow,
  patchShared,
  removeRow,
  rowHasQty,
  setBlockDie,
  shareText,
  todayYmd,
  totalsOf,
} from "./die-blocks";

const die = { id: "d1", label: "14701 Patti" };

describe("a die block", () => {
  test("rows take the block's die and copy; a new die resets the copy", () => {
    let b = newBlock("b1", "r1");
    b = setBlockDie(b, die);
    b = { ...b, copy: "tier:2" };
    b = addRow(b, "r2", "r1");
    expect(blockLines(b).map((l) => [l.key, l.die?.id, l.copy])).toEqual([
      ["r1", "d1", "tier:2"],
      ["r2", "d1", "tier:2"],
    ]);
    expect(setBlockDie(b, { id: "d2", label: "x" }).copy).toBe("any");
  });

  test("Enter adds a blank length right after the row, inheriting the die's alloy, finish and basis", () => {
    let b = setBlockDie(newBlock("b1", "r1"), die);
    b = patchShared(b, { alloy: "6063", temper: "T6", finish: "anodise", weightBasis: "band_start", rate: "201.5" });
    b = patchRow(b, "r1", { feet: "12", basis: "pcs", pcsText: "30" });
    b = addRow(b, "r2", "r1");
    b = addRow(b, "r3", "r1"); // between r1 and r2
    expect(b.rows.map((r) => r.key)).toEqual(["r1", "r3", "r2"]);
    const added = b.rows[1]!;
    expect(added).toMatchObject({ alloy: "6063", temper: "T6", finish: "anodise", weightBasis: "band_start", rate: "201.5", feet: "", pcsText: "", basis: null });
  });

  test("copy a length keeps its quantity; the last row cannot be removed", () => {
    let b = newBlock("b1", "r1");
    b = patchRow(b, "r1", { feet: "12", basis: "kg", kgText: "100" });
    b = duplicateRow(b, "r1", "r2");
    expect(b.rows.map((r) => [r.key, r.feet, r.kgText])).toEqual([
      ["r1", "12", "100"],
      ["r2", "12", "100"],
    ]);
    expect(removeRow(removeRow(b, "r2"), "r1").rows.map((r) => r.key)).toEqual(["r1"]);
  });

  test("shared fields change on every row of the die", () => {
    let b = addRow(newBlock("b1", "r1"), "r2");
    b = patchShared(b, { temper: "T5" });
    expect(b.rows.map((r) => r.temper)).toEqual(["T5", "T5"]);
  });

  test("the die problem is the block's; a row has its own length and quantity problems", () => {
    let b = addRow(newBlock("b1", "r1"), "r2");
    expect(blockProblems(b, "inch")).toEqual({ die: true, rows: { r1: { length: "orders.form.errors.length", qty: "orders.form.errors.qty" }, r2: { length: "orders.form.errors.length", qty: "orders.form.errors.qty" } } });
    b = setBlockDie(b, die);
    b = patchRow(b, "r1", { feet: "12", basis: "pcs", pcsText: "30" });
    expect(blocksComplete([b], "inch")).toBe(false);
    b = patchRow(b, "r2", { feet: "18", basis: "kg", kgText: "100" });
    expect(blocksComplete([b], "inch")).toBe(true);
    expect(allLines([b]).map((l) => l.key)).toEqual(["r1", "r2"]);
    expect(blocksComplete([], "inch")).toBe(false);
  });

  test("Enter only moves on once the row has a quantity", () => {
    const b = newBlock("b1", "r1");
    expect(rowHasQty(b.rows[0]!)).toBe(false);
    expect(rowHasQty({ ...b.rows[0]!, basis: "pcs", pcsText: "0" })).toBe(false);
    expect(rowHasQty({ ...b.rows[0]!, basis: "pcs", pcsText: "30" })).toBe(true);
    expect(rowHasQty({ ...b.rows[0]!, basis: "kg", kgText: "100.5" })).toBe(true);
  });
});

describe("live totals", () => {
  test("add up the quotes on screen and say when some are still on their way", () => {
    const t = totalsOf([
      { qty: { pcs: 30, kgG: 553_500 }, typed: true },
      { qty: { pcs: 10, kgG: 120_000 }, typed: true },
      { qty: null, typed: true },
      { qty: null, typed: false },
    ]);
    expect(t).toEqual({ lines: 2, pcs: 40, kgG: 673_500, pending: true });
    expect(totalsOf([])).toEqual({ lines: 0, pcs: 0, kgG: 0, pending: false });
  });

  test("a row's share of the order to one decimal", () => {
    expect(shareText(553_500, 673_500)).toBe("82.2");
    expect(shareText(500_000, 1_000_000)).toBe("50");
    expect(shareText(0, 1_000_000)).toBeNull();
    expect(shareText(1, 0)).toBeNull();
  });
});

describe("the expected date (Q8)", () => {
  test("order date plus the lead days, across month and year ends", () => {
    expect(defaultExpectedDate("2026-10-24", 15)).toBe("2026-11-08");
    expect(defaultExpectedDate("2026-12-20", 15)).toBe("2027-01-04");
    expect(defaultExpectedDate("2026-02-20", 15)).toBe("2026-03-07");
    expect(addDaysYmd("2026-10-24", 0)).toBe("2026-10-24");
  });

  test("today is the plant's calendar day", () => {
    // 20:00 UTC on 24 Oct is already 25 Oct 01:30 in India.
    expect(todayYmd("Asia/Kolkata", Date.UTC(2026, 9, 24, 20, 0))).toBe("2026-10-25");
    expect(todayYmd("UTC", Date.UTC(2026, 9, 24, 20, 0))).toBe("2026-10-24");
    expect(todayYmd("Not/AZone", Date.UTC(2026, 9, 24, 20, 0))).toBe("2026-10-24");
  });
});
