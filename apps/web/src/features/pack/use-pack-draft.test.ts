import { describe, expect, test } from "bun:test";

import {
  MAX_BUNDLES,
  PACK_DRAFT_KEY,
  addBundle,
  clearDraft,
  emptyDraft,
  reachableStep,
  readDraft,
  removeBundle,
  replaceBundle,
  toReceiptInput,
  writeDraft,
  type PackDraft,
} from "./use-pack-draft";

/** In-memory Storage (sessionStorage stand-in). */
function memoryStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

function draftWith(over: Partial<PackDraft> = {}): PackDraft {
  return { ...emptyDraft("co-1"), dieId: "die-1", defaults: { lengthMm: 3505, po: "PO-9" }, ...over };
}

describe("draft persistence (sessionStorage key orrn.packDraft)", () => {
  test("uses the agreed key", () => {
    expect(PACK_DRAFT_KEY).toBe("orrn.packDraft");
  });

  test("write then read round-trips the draft", () => {
    const s = memoryStorage();
    const d = addBundle(draftWith({ step: 1 }), { weightG: 52_400, pieces: 21 });
    writeDraft(s, d);
    expect(s.map.has("orrn.packDraft")).toBe(true);
    expect(readDraft(s, "co-1")).toEqual(d);
  });

  test("a draft from another company is ignored", () => {
    const s = memoryStorage();
    writeDraft(s, draftWith());
    expect(readDraft(s, "co-2")).toBeNull();
  });

  test("a draft typed by another person at this station is not theirs", () => {
    // Shared packing station: A types bundles, B signs in on the same tab.
    const s = memoryStorage();
    const mine = addBundle({ ...emptyDraft("co-1", "u-a"), dieId: "die-1", defaults: { lengthMm: 3505 } }, {
      weightG: 47_900,
      pieces: 20,
    });
    writeDraft(s, mine);
    expect(readDraft(s, "co-1", "u-b")).toBeNull();
    expect(readDraft(s, "co-1", "u-a")).toEqual(mine);
  });

  test("a draft from before drafts carried the packer still opens", () => {
    const s = memoryStorage();
    writeDraft(s, draftWith());
    expect(readDraft(s, "co-1", "u-a")?.dieId).toBe("die-1");
  });

  test("a non-string packer id is a corrupt draft", () => {
    const s = memoryStorage();
    s.setItem(PACK_DRAFT_KEY, JSON.stringify({ ...draftWith(), userId: 7 }));
    expect(readDraft(s, "co-1")).toBeNull();
  });

  test("corrupt or wrong-shaped JSON reads as no draft", () => {
    const s = memoryStorage();
    for (const junk of ["{", "null", "[]", '{"v":1}', '{"v":1,"companyId":"co-1","bundles":[{"weightG":"x"}]}']) {
      s.setItem(PACK_DRAFT_KEY, junk);
      expect(readDraft(s, "co-1")).toBeNull();
    }
  });

  test("storage that throws (private mode) never breaks the screen", () => {
    const throwing = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
      removeItem() {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(readDraft(throwing, "co-1")).toBeNull();
    expect(() => writeDraft(throwing, draftWith())).not.toThrow();
    expect(() => clearDraft(throwing)).not.toThrow();
  });

  test("an empty draft is removed rather than stored", () => {
    const s = memoryStorage();
    writeDraft(s, draftWith());
    writeDraft(s, emptyDraft("co-1"));
    expect(s.map.has(PACK_DRAFT_KEY)).toBe(false);
  });

  test("clearDraft removes it", () => {
    const s = memoryStorage();
    writeDraft(s, draftWith());
    clearDraft(s);
    expect(readDraft(s, "co-1")).toBeNull();
  });
});

describe("bundle list edits", () => {
  test("add, replace and remove keep order", () => {
    let d = draftWith();
    d = addBundle(d, { weightG: 1000, pieces: 1 });
    d = addBundle(d, { weightG: 2000, pieces: 2 });
    d = addBundle(d, { weightG: 3000, pieces: 3 });
    d = replaceBundle(d, 1, { weightG: 2500, pieces: 2, lengthMm: 3048 });
    expect(d.bundles.map((b) => b.weightG)).toEqual([1000, 2500, 3000]);
    d = removeBundle(d, 0);
    expect(d.bundles.map((b) => b.weightG)).toEqual([2500, 3000]);
  });

  test("never more than the server's 200 bundles per session", () => {
    let d = draftWith();
    for (let i = 0; i < MAX_BUNDLES + 5; i++) d = addBundle(d, { weightG: 1000 + i, pieces: 1 });
    expect(MAX_BUNDLES).toBe(200);
    expect(d.bundles).toHaveLength(200);
  });

  test("edits are immutable", () => {
    const d = draftWith();
    const next = addBundle(d, { weightG: 1000, pieces: 1 });
    expect(d.bundles).toHaveLength(0);
    expect(next).not.toBe(d);
  });
});

describe("toReceiptInput (bundle.createReceipt payload)", () => {
  test("session defaults fill each row; overrides win", () => {
    let d = draftWith();
    d = addBundle(d, { weightG: 52_400, pieces: 21 });
    d = addBundle(d, { weightG: 40_000, pieces: 20, lengthMm: 3048, po: "PO-ODD" });
    expect(toReceiptInput(d, "inch")).toEqual({
      dieId: "die-1",
      unit: "inch",
      purchaseOrderRef: "PO-9",
      rows: [
        { quantity: 21, weightG: 52_400, lengthMm: 3505, poNumber: null },
        { quantity: 20, weightG: 40_000, lengthMm: 3048, poNumber: "PO-ODD" },
      ],
    });
  });

  test("blank PO is sent as null", () => {
    const d = addBundle(draftWith({ defaults: { lengthMm: 3658, po: "  " } }), { weightG: 1000, pieces: 1 });
    expect(toReceiptInput(d, "mm")?.purchaseOrderRef).toBeNull();
  });

  test("40-bundle session builds 40 rows", () => {
    let d = draftWith();
    for (let i = 0; i < 40; i++) d = addBundle(d, { weightG: 50_000 + i * 10, pieces: 20 });
    expect(toReceiptInput(d, "inch")?.rows).toHaveLength(40);
  });

  test("null until the die, cut length and a bundle are there", () => {
    expect(toReceiptInput(draftWith(), "inch")).toBeNull();
    expect(toReceiptInput(addBundle(draftWith({ dieId: null }), { weightG: 1, pieces: 1 }), "inch")).toBeNull();
    expect(
      toReceiptInput(addBundle(draftWith({ defaults: { lengthMm: 0 } }), { weightG: 1, pieces: 1 }), "inch"),
    ).toBeNull();
  });
});

describe("yard (location) for the session", () => {
  test("the yard goes on the payload as locationId", () => {
    const d = addBundle(draftWith({ defaults: { lengthMm: 3505, locationId: "loc-y3" } }), { weightG: 47_900, pieces: 20 });
    expect(toReceiptInput(d, "inch")?.locationId).toBe("loc-y3");
  });

  test("no yard chosen sends no locationId (companies without yards)", () => {
    const d = addBundle(draftWith(), { weightG: 47_900, pieces: 20 });
    expect(toReceiptInput(d, "inch")).not.toHaveProperty("locationId");
  });

  test("a stored yard survives a reload; a non-string yard makes the draft unreadable", () => {
    const storage = memoryStorage();
    const d = addBundle(draftWith({ defaults: { lengthMm: 3505, locationId: "loc-y3" } }), { weightG: 1, pieces: 1 });
    writeDraft(storage, d);
    expect(readDraft(storage, "co-1")?.defaults.locationId).toBe("loc-y3");
    storage.setItem(PACK_DRAFT_KEY, JSON.stringify({ ...d, defaults: { lengthMm: 3505, locationId: 7 } }));
    expect(readDraft(storage, "co-1")).toBeNull();
  });

  test("reachableStep keeps the packer on step 1 until die, cut length and (when the company has yards) the yard are set", () => {
    const withBundle = addBundle(draftWith({ step: 2 }), { weightG: 1, pieces: 1 });
    expect(reachableStep(withBundle, { yardIds: [] })).toBe(2);
    expect(reachableStep(withBundle, { yardIds: ["loc-y1", "loc-y2"] })).toBe(0);
    const yard = { ...withBundle, defaults: { ...withBundle.defaults, locationId: "loc-y1" } };
    expect(reachableStep(yard, { yardIds: ["loc-y1", "loc-y2"] })).toBe(2);
    expect(reachableStep({ ...yard, bundles: [] }, { yardIds: ["loc-y1"] })).toBe(1);
    expect(reachableStep({ ...yard, dieId: null }, { yardIds: ["loc-y1"] })).toBe(0);
  });

  test("a yard retired since the draft was typed sends the packer back to pick another", () => {
    const d = addBundle(draftWith({ step: 1, defaults: { lengthMm: 3505, locationId: "loc-y6" } }), {
      weightG: 1,
      pieces: 1,
    });
    expect(reachableStep(d, { yardIds: ["loc-y1", "loc-y2"] })).toBe(0);
    // A company that has no yards any more packs without one; the stale id is not a blocker.
    expect(reachableStep(d, { yardIds: [] })).toBe(1);
  });

  test("toReceiptInput leaves out a yard the company no longer has yards for", () => {
    const d = addBundle(draftWith({ defaults: { lengthMm: 3505, locationId: "loc-y6" } }), { weightG: 1, pieces: 1 });
    expect(toReceiptInput(d, "inch", { yardIds: [] })).not.toHaveProperty("locationId");
    expect(toReceiptInput(d, "inch", { yardIds: ["loc-y6"] })?.locationId).toBe("loc-y6");
  });
});
