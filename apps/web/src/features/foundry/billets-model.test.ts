import { describe, expect, test } from "bun:test";

import { blankCut, blankIssue, castsAt, checkCut, checkIssue, cutPreview, groupPlaces, isHomogRefusal, linesWithFloor, mmOf, parseBilletsSearch, pcsOf, tabOf, yieldText, type PressLine, type StockPlace } from "./billets-model";

const place = (p: Partial<StockPlace> & Pick<StockPlace, "id" | "code" | "kind">): StockPlace => ({ name: p.code, pressLineId: null, pressLineCode: null, active: true, kgG: 0, casts: [], ...p });
const cast = (castId: string, number: string, kgG: number) => ({ castId, number, alloy: "6063", source: "melt" as const, kgG });
const lines: PressLine[] = [
  { id: "p1", code: "P1", name: "Press 1", status: "active" },
  { id: "p2", code: "P2", name: "Press 2", status: "active" },
];
const places: StockPlace[] = [
  place({ id: "s", code: "BILLET", kind: "billet_store", kgG: 5_000_000, casts: [cast("c1", "K31", 3_000_000), cast("c2", "K32", 2_000_000)] }),
  place({ id: "r", code: "RACK1", kind: "billet_rack", kgG: 800_000, casts: [cast("c1", "K31", 800_000)] }),
  place({ id: "f1", code: "FLOOR1", kind: "press_floor", pressLineId: "p1", pressLineCode: "P1", kgG: 400_000, casts: [cast("c1", "K31", 400_000)] }),
  place({ id: "f1b", code: "FLOOR1B", kind: "press_floor", pressLineId: "p1", pressLineCode: "P1", kgG: 100_000 }),
  place({ id: "fx", code: "FLOORX", kind: "press_floor", kgG: 0 }),
  place({ id: "old", code: "OLDRACK", kind: "billet_rack", active: false, kgG: 0 }),
];

describe("search and tabs", () => {
  test("the stock tab stays out of the URL; cut and issue are kept; junk is dropped", () => {
    expect(parseBilletsSearch({ tab: "cut" })).toEqual({ tab: "cut" });
    expect(parseBilletsSearch({ tab: "issue" })).toEqual({ tab: "issue" });
    expect(parseBilletsSearch({ tab: "stock" })).toEqual({});
    expect(parseBilletsSearch({ tab: 7 })).toEqual({});
    expect([tabOf({}), tabOf({ tab: "cut" })]).toEqual(["stock", "cut"]);
  });
});

describe("grouping places", () => {
  const g = groupPlaces(places, lines);
  test("store, rack and one section per press; a retired empty place drops out", () => {
    expect(g.store.map((p) => p.code)).toEqual(["BILLET"]);
    expect(g.rack.map((p) => p.code)).toEqual(["RACK1"]);
    expect(g.floors.map((f) => [f.code, f.places.map((p) => p.code), f.kgG])).toEqual([
      ["P1", ["FLOOR1", "FLOOR1B"], 500_000],
      ["P2", [], 0],
      [null, ["FLOORX"], 0],
    ]);
  });
  test("a retired place that still holds metal stays visible", () => {
    const held = groupPlaces([place({ id: "o", code: "OLD", kind: "billet_rack", active: false, kgG: 10 })], lines);
    expect(held.rack).toHaveLength(1);
  });
});

describe("casts at places", () => {
  test("logs from the store, rack casts for issue; empty and retired are left out; sorted by cast number", () => {
    expect(castsAt(places, ["billet_store"]).map((c) => [c.number, c.locationCode, c.kgG])).toEqual([["K31", "BILLET", 3_000_000], ["K32", "BILLET", 2_000_000]]);
    expect(castsAt(places, ["billet_rack"]).map((c) => c.value)).toEqual(["c1:r"]);
    expect(castsAt(places, ["billet_rack", "press_floor"]).map((c) => c.locationCode)).toEqual(["FLOOR1", "RACK1"]);
  });
});

describe("cut form", () => {
  const logs = castsAt(places, ["billet_store"]);
  const good = { ...blankCut(), cast: "c1:s", logPcs: "20", logKg: "1,000", lengthMm: "800", billetPcs: "60", billetKg: "940" };
  test("a full form gives the end cut and the yield from the domain figures", () => {
    const r = checkCut(good, logs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.endG).toBe(60_000);
      expect(r.yieldBp).toBe(9_400);
      expect(r.input).toMatchObject({ castId: "c1", fromLocationId: "s", logPcs: 20, logG: 1_000_000, billetLengthMm: 800, billetPcs: 60, billetG: 940_000, machine: "saw" });
    }
  });
  test("the first missing field is named, in form order", () => {
    expect(checkCut(blankCut(), logs)).toEqual({ ok: false, issue: "cast" });
    expect(checkCut({ ...good, logPcs: "" }, logs)).toEqual({ ok: false, issue: "logPcs" });
    expect(checkCut({ ...good, logPcs: "2.5" }, logs)).toEqual({ ok: false, issue: "logPcs" });
    expect(checkCut({ ...good, logKg: "0" }, logs)).toEqual({ ok: false, issue: "logKg" });
    expect(checkCut({ ...good, lengthMm: "" }, logs)).toEqual({ ok: false, issue: "lengthMm" });
    expect(checkCut({ ...good, billetPcs: "0" }, logs)).toEqual({ ok: false, issue: "billetPcs" });
    expect(checkCut({ ...good, billetKg: "" }, logs)).toEqual({ ok: false, issue: "billetKg" });
  });
  test("range and weight rules match the server", () => {
    expect(checkCut({ ...good, lengthMm: "99" }, logs)).toEqual({ ok: false, issue: "length_range" });
    expect(checkCut({ ...good, lengthMm: "2001" }, logs)).toEqual({ ok: false, issue: "length_range" });
    expect(checkCut({ ...good, billetKg: "1001" }, logs)).toEqual({ ok: false, issue: "more_out_than_in" });
    expect(checkCut({ ...good, logKg: "3000.5", billetKg: "100" }, logs)).toEqual({ ok: false, issue: "more_than_stock" });
  });
  test("the preview needs only the two weights and never goes negative", () => {
    expect(cutPreview({ logKg: "1000", billetKg: "940" })).toEqual({ endG: 60_000, yieldBp: 9_400 });
    expect(cutPreview({ logKg: "1000", billetKg: "1100" })).toBeNull();
    expect(cutPreview({ logKg: "", billetKg: "5" })).toBeNull();
    expect(yieldText(9_412)).toBe("94.1");
    expect(yieldText(null)).toBe("-");
  });
  test("whole numbers", () => {
    expect([pcsOf("12"), pcsOf("0"), pcsOf("1.5"), pcsOf("100001"), pcsOf("")]).toEqual([12, null, null, null, null]);
    expect([mmOf("800"), mmOf("800.4"), mmOf("x")]).toEqual([800, 800, null]);
  });
  test("the homogenizing refusal is recognised", () => {
    expect(isHomogRefusal("Homogenize the logs of K31 before cutting them")).toBe(true);
    expect(isHomogRefusal("Only 3 logs of K31 have been homogenized and not cut")).toBe(true);
    expect(isHomogRefusal("Add a billet rack location first")).toBe(false);
  });
});

describe("issue form", () => {
  const rack = castsAt(places, ["billet_rack"]);
  const ok = { ...blankIssue(), cast: "c1:r", pressLineId: "p1", pcs: "10", kg: "250" };
  test("a full form names the rack the metal comes from", () => {
    expect(checkIssue(ok, rack)).toEqual({ ok: true, input: { castId: "c1", pressLineId: "p1", fromLocationId: "r", pcs: 10, kgG: 250_000 } });
  });
  test("each missing field and the stock limit", () => {
    expect(checkIssue(blankIssue(), rack)).toEqual({ ok: false, issue: "cast" });
    expect(checkIssue({ ...ok, pressLineId: "" }, rack)).toEqual({ ok: false, issue: "press" });
    expect(checkIssue({ ...ok, pcs: "" }, rack)).toEqual({ ok: false, issue: "pcs" });
    expect(checkIssue({ ...ok, kg: "0" }, rack)).toEqual({ ok: false, issue: "kg" });
    expect(checkIssue({ ...ok, kg: "800.001" }, rack)).toEqual({ ok: false, issue: "more_than_stock" });
  });
  test("only presses with a floor are offered", () => {
    expect(linesWithFloor(lines, places).map((l) => l.code)).toEqual(["P1"]);
  });
});
