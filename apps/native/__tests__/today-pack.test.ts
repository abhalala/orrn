import { describe, expect, test } from "bun:test";

import { decideAfterCheck } from "../features/pack/save-check";
import {
  canLeaveDefaults,
  dieCode,
  draftOwner,
  hasRange,
  kgText,
  newBundleKey,
  parseBundleEntry,
  sessionTotals,
  type TypedBundle,
} from "../features/pack/pack-form";
import { TILE_META, todayTiles } from "../features/today/today-model";

const typed = (over: Partial<TypedBundle> = {}): TypedBundle => ({
  weight: "52.4",
  pieces: "21",
  override: false,
  lengthFields: { mm: "", feet: "", inches: "" },
  po: "",
  ...over,
});

describe("typed bundle", () => {
  test("weight in kg to grams, pieces whole; no override follows the session", () => {
    expect(parseBundleEntry("mm", typed())).toEqual({ ok: true, weightG: 52_400, pieces: 21, lengthMm: null, po: null });
    expect(parseBundleEntry("mm", typed({ weight: "52,4" }))).toMatchObject({ ok: true, weightG: 52_400 });
  });

  test("bad weight or pieces are reported per field", () => {
    expect(parseBundleEntry("mm", typed({ weight: "", pieces: "2.5" }))).toEqual({ ok: false, errors: { weight: true, pieces: true } });
  });

  test("an override keeps its own length and PO; a blank override length follows the session", () => {
    const own = typed({ override: true, lengthFields: { mm: "3505", feet: "", inches: "" }, po: " PO-9 " });
    expect(parseBundleEntry("mm", own)).toMatchObject({ ok: true, lengthMm: 3505, po: "PO-9" });
    expect(parseBundleEntry("mm", typed({ override: true, po: "PO-9" }))).toMatchObject({ ok: true, lengthMm: null, po: "PO-9" });
  });

  test("an override length in feet and inches", () => {
    const f = { mm: "", feet: "11", inches: "6" };
    expect(parseBundleEntry("inch", typed({ override: true, lengthFields: f }))).toMatchObject({ ok: true, lengthMm: 3505 });
  });

  test("a half-typed override length is an error, not the session length", () => {
    const r = parseBundleEntry("inch", typed({ override: true, lengthFields: { mm: "", feet: "", inches: "x" } }));
    expect(r).toEqual({ ok: false, errors: { length: true } });
  });

  test("a hidden override is ignored", () => {
    expect(parseBundleEntry("mm", typed({ override: false, lengthFields: { mm: "999", feet: "", inches: "" }, po: "X" }))).toMatchObject({
      lengthMm: null,
      po: null,
    });
  });
});

describe("die labels", () => {
  test("code, range edges and range presence", () => {
    expect(dieCode({ series: "PATTI", sectionCode: "14701" })).toBe("PATTI 14701");
    expect(kgText(5_900)).toBe("5.9");
    expect(kgText(2_350)).toBe("2.35");
    expect(hasRange({ weightMinG: 2_400, weightMaxG: 2_600 })).toBe(true);
    expect(hasRange({ weightMinG: 0, weightMaxG: 0 })).toBe(false);
    expect(hasRange({ weightMinG: 3_000, weightMaxG: 2_000 })).toBe(false);
  });
});

describe("session totals", () => {
  test("void bundles are listed but never counted", () => {
    const totals = sessionTotals([
      { status: "available", weightG: 50_000, quantity: 20 },
      { status: "void", weightG: 30_000, quantity: 10 },
      { status: "dispatched", weightG: 10_000, quantity: 5 },
    ]);
    expect(totals).toMatchObject({ bundles: 2, pieces: 25, weightG: 60_000, kg: 60, voidCount: 1 });
  });
});

describe("step one gate", () => {
  const die = { id: "d", label: "PATTI 1", weightMinG: 1, weightMaxG: 2 };
  test("needs a die and a cut length; a yard only when the company has yards", () => {
    expect(canLeaveDefaults({ die: null, lengthMm: 3658, yardCount: 0, locationId: null })).toBe(false);
    expect(canLeaveDefaults({ die, lengthMm: null, yardCount: 0, locationId: null })).toBe(false);
    expect(canLeaveDefaults({ die, lengthMm: 3658, yardCount: 0, locationId: null })).toBe(true);
    expect(canLeaveDefaults({ die, lengthMm: 3658, yardCount: 2, locationId: null })).toBe(false);
    expect(canLeaveDefaults({ die, lengthMm: 3658, yardCount: 2, locationId: "y1" })).toBe(true);
  });
});

describe("draft owner and keys", () => {
  test("owner is user:company, absent until both are known", () => {
    expect(draftOwner("u1", "c1")).toBe("u1:c1");
    expect(draftOwner(undefined, "c1")).toBeNull();
  });

  test("bundle keys do not repeat", () => {
    const keys = new Set(Array.from({ length: 50 }, () => newBundleKey(1)));
    expect(keys.size).toBe(50);
  });
});

describe("after an unsure save (never save blind)", () => {
  const save = { dieId: "d1", bundleCount: 3, startedAt: 1_000_000 };
  const row = (over = {}) => ({ id: "g1", dieId: "d1", bundleCount: 3, createdAt: 1_000_500, ...over });

  test("the session landed: open it instead of saving again", () => {
    expect(decideAfterCheck([row()], save)).toEqual({ kind: "landed", id: "g1" });
  });

  test("it did not land: Save may be offered again", () => {
    expect(decideAfterCheck([row({ bundleCount: 4 }), row({ dieId: "d2" }), row({ createdAt: 100 })], save)).toEqual({ kind: "notLanded" });
    expect(decideAfterCheck([], save)).toEqual({ kind: "notLanded" });
  });

  test("the re-read failed: still unknown, Save stays hidden", () => {
    expect(decideAfterCheck(null, save)).toEqual({ kind: "unknown" });
  });
});

describe("today tiles map to routes and tones", () => {
  test("every tile has copy and a route", () => {
    for (const tile of todayTiles({ user: { id: "u", name: "A" }, company: { id: "c", role: "owner", modules: [] }, isPlatformAdmin: false } as never)) {
      expect(TILE_META[tile].href.startsWith("/")).toBe(true);
    }
  });

  test("owners get every tile; operators pack but do not dispatch", () => {
    const meOf = (role: string) => ({ user: { id: "u", name: "A" }, company: { id: "c", role, modules: [] }, isPlatformAdmin: false }) as never;
    expect(todayTiles(meOf("owner"))).toEqual(["pack", "dispatch", "stock", "guides"]);
    expect(todayTiles(meOf("operator"))).toEqual(["pack", "stock", "guides"]);
    expect(todayTiles(null)).toEqual([]);
  });
});
