import { describe, expect, test } from "bun:test";

import { entryState, entryTone, exchangePartner, recentItemIds, signedQty, type EntryLike } from "./store-entries";

const base: EntryLike = {
  id: "t1",
  kind: "grn",
  number: "GRN-1",
  itemId: "flux",
  qtyMilli: 12_500,
  exchangeId: null,
  cancelledAt: null,
};

describe("entryState and entryTone", () => {
  test("a GRN is received (green), an MRS issued (neutral)", () => {
    expect(entryState(base)).toBe("received");
    expect(entryTone(base)).toBe("green");
    expect(entryState({ ...base, kind: "mrs" })).toBe("issued");
    expect(entryTone({ ...base, kind: "mrs" })).toBe("neutral");
  });

  test("a cancelled entry is cancelled (red) whatever its kind", () => {
    const at = new Date("2026-10-03T08:00:00Z");
    expect(entryState({ ...base, cancelledAt: at })).toBe("cancelled");
    expect(entryTone({ ...base, kind: "mrs", cancelledAt: at.toISOString() })).toBe("red");
  });
});

describe("signedQty", () => {
  test("GRN adds, MRS takes away", () => {
    expect(signedQty(base)).toBe(12_500);
    expect(signedQty({ ...base, kind: "mrs" })).toBe(-12_500);
  });

  test("a cancelled entry no longer moves stock", () => {
    expect(signedQty({ ...base, cancelledAt: 1 })).toBe(0);
  });
});

describe("exchangePartner", () => {
  const out: EntryLike = { ...base, id: "o", kind: "mrs", number: "MRS-4", exchangeId: "x1" };
  const inn: EntryLike = { ...base, id: "i", kind: "grn", number: "GRN-9", exchangeId: "x1" };
  const other: EntryLike = { ...base, id: "z", exchangeId: "x2" };

  test("finds the other leg of the same exchange", () => {
    expect(exchangePartner(out, [other, out, inn])?.number).toBe("GRN-9");
    expect(exchangePartner(inn, [other, out, inn])?.number).toBe("MRS-4");
  });

  test("no exchange, or the other leg not loaded: undefined", () => {
    expect(exchangePartner(base, [base, inn])).toBeUndefined();
    expect(exchangePartner(out, [out, other])).toBeUndefined();
  });
});

describe("recentItemIds", () => {
  test("distinct items in the order of the newest entries, capped", () => {
    const rows = ["a", "b", "a", "c", "d", "b", "e"].map((itemId, i) => ({ ...base, id: String(i), itemId }));
    expect(recentItemIds(rows, 3)).toEqual(["a", "b", "c"]);
    expect(recentItemIds(rows)).toEqual(["a", "b", "c", "d", "e"]);
    expect(recentItemIds([])).toEqual([]);
  });
});
