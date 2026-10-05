import { describe, expect, test } from "bun:test";

import {
  canCancelEntry,
  entrySignature,
  entrySource,
  entryState,
  entryTone,
  exchangePartner,
  focusAfterPage,
  itemActions,
  pickerOrder,
  recentItemIds,
  savedOutcome,
  showMore,
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

describe("entrySignature (RP18: the values that decide the request id)", () => {
  const issue = { mode: "issue" as const, itemId: "flux", milli: 8_000, purpose: "melt", ref: "K31", note: "" };

  test("the same values give the same signature; spaces around text do not count", () => {
    expect(entrySignature(issue)).toBe(entrySignature({ ...issue, ref: "  K31 ", note: " " }));
  });

  test("any value that changes the entry changes the signature", () => {
    const a = entrySignature(issue);
    expect(entrySignature({ ...issue, milli: 8_001 })).not.toBe(a);
    expect(entrySignature({ ...issue, purpose: "other" })).not.toBe(a);
    expect(entrySignature({ ...issue, itemId: "ldo" })).not.toBe(a);
    expect(entrySignature({ ...issue, ref: "K32" })).not.toBe(a);
    expect(entrySignature({ ...issue, note: "x" })).not.toBe(a);
    expect(entrySignature({ ...issue, mode: "receive" })).not.toBe(a);
  });

  test("a separator inside a typed value cannot make two entries look alike", () => {
    expect(entrySignature({ ...issue, ref: "a|b", note: "" })).not.toBe(
      entrySignature({ ...issue, ref: "a", note: "b" }),
    );
  });

  test("an exchange is keyed by both quantities", () => {
    const x = { mode: "exchange" as const, itemId: "belt", outMilli: 1_000, inMilli: 1_000 };
    expect(entrySignature(x)).not.toBe(entrySignature({ ...x, inMilli: 2_000 }));
  });
});

describe("showMore (the register's 'Show older entries')", () => {
  test("shown while a full page came back and the cap is not reached", () => {
    expect(showMore({ shown: 10, limit: 10, max: 500, isPlaceholderData: false })).toEqual({
      button: true,
      atCap: false,
    });
    expect(showMore({ shown: 7, limit: 10, max: 500, isPlaceholderData: false })).toEqual({
      button: false,
      atCap: false,
    });
  });

  test("stays while the next page loads, so keyboard focus is never dropped", () => {
    // limit already 60, the 10 rows on screen are the previous page (placeholder).
    expect(showMore({ shown: 10, limit: 60, max: 500, isPlaceholderData: true }).button).toBe(true);
  });

  test("at the cap it says the list is the latest entries only", () => {
    expect(showMore({ shown: 500, limit: 500, max: 500, isPlaceholderData: false })).toEqual({
      button: false,
      atCap: true,
    });
    expect(showMore({ shown: 420, limit: 500, max: 500, isPlaceholderData: false })).toEqual({
      button: false,
      atCap: false,
    });
  });
});

describe("focusAfterPage", () => {
  const ids = ["a", "b", "c", "d"];

  test("focus goes to the first newly loaded row", () => {
    expect(focusAfterPage(2, ids)).toBe("c");
  });

  test("no new rows: the last row, never nothing", () => {
    expect(focusAfterPage(4, ids)).toBe("d");
    expect(focusAfterPage(9, ids)).toBe("d");
    expect(focusAfterPage(0, [])).toBeNull();
  });
});

describe("pickerOrder (item picker for entries that take stock out)", () => {
  const items = [
    { id: "soda", name: "Caustic soda", balanceMilli: 0 },
    { id: "flux", name: "Cover flux", balanceMilli: 207_500 },
    { id: "ldo", name: "LDO", balanceMilli: 82_000 },
  ];

  test("Issue and Exchange put empty items last, keeping the order otherwise", () => {
    expect(pickerOrder(items, true).map((i) => i.id)).toEqual(["flux", "ldo", "soda"]);
  });

  test("Receive keeps the order: an empty item is exactly what takes a delivery", () => {
    expect(pickerOrder(items, false).map((i) => i.id)).toEqual(["soda", "flux", "ldo"]);
  });
});
