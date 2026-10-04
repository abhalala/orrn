import { describe, expect, test } from "bun:test";

import {
  canCancelEntry,
  entrySource,
  entryState,
  entryTone,
  exchangePartner,
  itemActions,
  recentItemIds,
  savedOutcome,
  signedQty,
  type EntryLike,
} from "./store-entries";

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

describe("canCancelEntry (RP15, PL-7 review: draws another record made are cancelled there)", () => {
  test("a live entry the storekeeper typed can be cancelled", () => {
    expect(canCancelEntry(base)).toBe(true);
    expect(canCancelEntry({ ...base, kind: "mrs", sourceType: null })).toBe(true);
    expect(entrySource(base)).toBeNull();
  });

  test("an entry already cancelled cannot be cancelled again", () => {
    expect(canCancelEntry({ ...base, cancelledAt: "2026-10-03T08:00:00Z" })).toBe(false);
  });

  test("a melt's flux draw belongs to the melt: no cancel here", () => {
    const draw = { ...base, kind: "mrs" as const, sourceType: "melt" };
    expect(canCancelEntry(draw)).toBe(false);
    expect(entrySource(draw)).toBe("melt");
  });
});

describe("savedOutcome (RP18 replays)", () => {
  test("a new entry is saved", () => {
    expect(savedOutcome({ replayed: false })).toBe("saved");
    expect(savedOutcome({ replayed: false, cancelled: false })).toBe("saved");
  });

  test("a retry of a saved entry returns it: still saved, nothing posted twice", () => {
    expect(savedOutcome({ replayed: true })).toBe("saved");
    expect(savedOutcome({ replayed: true, cancelled: false })).toBe("saved");
  });

  test("a retry of an entry someone cancelled meanwhile must not read as stock moved", () => {
    expect(savedOutcome({ replayed: true, cancelled: true })).toBe("cancelled");
  });
});

describe("itemActions", () => {
  test("an item with stock leads with Issue, the storekeeper's everyday action", () => {
    expect(itemActions(207_500)).toEqual([
      { kind: "issue", primary: true },
      { kind: "receive", primary: false },
      { kind: "exchange", primary: false },
    ]);
  });

  test("an empty item leads with Receive: nothing can be issued or exchanged out of it", () => {
    expect(itemActions(0)).toEqual([
      { kind: "receive", primary: true },
      { kind: "issue", primary: false },
      { kind: "exchange", primary: false },
    ]);
    expect(itemActions(-1)[0]).toEqual({ kind: "receive", primary: true });
  });
});
