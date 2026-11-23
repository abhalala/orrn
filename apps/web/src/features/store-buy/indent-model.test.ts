import { describe, expect, test } from "bun:test";

import { blankLine, checkIndent, indentActions, indentTone, isDay, knownStatus } from "./indent-model";

const units = (id: string) => (id === "a" ? "kg" : id === "b" ? "piece" : null);
const base = { department: " Press ", neededBy: "", reason: " for die bath " };

describe("checkIndent", () => {
  test("builds the exact input", () => {
    const r = checkIndent(
      { ...base, neededBy: "2026-12-05", lines: [{ key: "1", itemId: "a", qty: "12.5" }, { key: "2", itemId: "b", qty: "3" }] },
      units,
    );
    expect(r).toEqual({
      ok: true,
      input: {
        department: "Press",
        neededBy: "2026-12-05",
        reason: "for die bath",
        lines: [{ itemId: "a", qtyMilli: 12500 }, { itemId: "b", qtyMilli: 3000 }],
      },
    });
  });
  test("empty needed-by is null", () => {
    const r = checkIndent({ ...base, lines: [{ key: "1", itemId: "a", qty: "1" }] }, units);
    expect(r.ok && r.input.neededBy).toBeNull();
  });
  test("flags each problem", () => {
    const r = checkIndent(
      {
        department: " ",
        neededBy: "2026-02-30",
        reason: "",
        lines: [
          { key: "1", itemId: null, qty: "1" },
          { key: "2", itemId: "b", qty: "1.5" },
          { key: "3", itemId: "a", qty: "" },
          { key: "4", itemId: "a", qty: "2" },
        ],
      },
      units,
    );
    expect(r).toEqual({ ok: false, department: true, neededBy: true, noLines: false, lines: { "1": "item", "2": "whole", "3": "empty", "4": "twice" } });
  });
  test("the same item twice is flagged on the second line", () => {
    const r = checkIndent(
      { ...base, lines: [{ key: "1", itemId: "a", qty: "1" }, { key: "2", itemId: "a", qty: "1" }] },
      units,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.lines).toEqual({ "2": "twice" });
  });
  test("no lines", () => {
    const r = checkIndent({ ...base, lines: [] }, units);
    expect(r.ok === false && r.noLines).toBe(true);
    expect(blankLine("k")).toEqual({ key: "k", itemId: null, qty: "" });
  });
});

describe("isDay", () => {
  test("real days only", () => {
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2026-02-29")).toBe(false);
    expect(isDay("05/12/2026")).toBe(false);
  });
});

describe("indentActions", () => {
  const mine = { createdBy: "u1" };
  const other = { createdBy: "u2" };
  const none = { userId: "u1", decide: false, manageOrders: false };
  test("open: only a decider approves or rejects; the raiser cancels", () => {
    expect(indentActions("open", mine, none)).toEqual({ approve: false, reject: false, cancel: true, makeOrder: false });
    expect(indentActions("open", other, none).cancel).toBe(false);
    expect(indentActions("open", other, { ...none, decide: true })).toEqual({ approve: true, reject: true, cancel: true, makeOrder: false });
  });
  test("approved: purchase order for po.manage, cancel for the raiser or a decider", () => {
    expect(indentActions("approved", other, { ...none, manageOrders: true })).toEqual({ approve: false, reject: false, cancel: false, makeOrder: true });
    expect(indentActions("approved", mine, none).cancel).toBe(true);
  });
  test("finished statuses show nothing", () => {
    const all = { userId: "u1", decide: true, manageOrders: true };
    for (const s of ["rejected", "ordered", "cancelled"]) {
      expect(indentActions(s, mine, all)).toEqual({ approve: false, reject: false, cancel: false, makeOrder: false });
    }
  });
  test("no user id never counts as the raiser", () => {
    expect(indentActions("open", mine, { userId: null, decide: false, manageOrders: false }).cancel).toBe(false);
  });
});

test("tones and unknown statuses", () => {
  expect(indentTone("open")).toBe("amber");
  expect(indentTone("ordered")).toBe("blue");
  expect(knownStatus("weird")).toBe("open");
  expect(knownStatus("rejected")).toBe("rejected");
});
