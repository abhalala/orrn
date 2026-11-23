import { describe, expect, test } from "bun:test";

import type { StockPlace } from "./billets-model";
import { blankReject, checkReject, kindOfSearch, noteRequired, parseRejectsSearch, rangeBackwards, reasonKindOf, rejectPlaceOptions, rejectReasonText, reasonShares, sumRejects } from "./rejects-model";

const place = (id: string, code: string, kind: StockPlace["kind"], kgG: number): StockPlace => ({ id, code, name: code, kind, pressLineId: null, pressLineCode: null, active: true, kgG, casts: [{ castId: "c1", number: "K31", alloy: "6063", source: "melt", kgG }] });
const places = [place("s", "BILLET", "billet_store", 900_000), place("r", "RACK1", "billet_rack", 500_000), place("f", "FLOOR1", "press_floor", 200_000)];
const reasons = [
  { id: "r1", code: "crack", requiresNote: false },
  { id: "r2", code: "other", requiresNote: false },
  { id: "r3", code: "porosity", requiresNote: true },
];

describe("search", () => {
  test("log is the default and stays out of the URL; billet, days and junk", () => {
    expect(parseRejectsSearch({ kind: "billet", from: "2026-11-01", to: "2026-11-22" })).toEqual({ kind: "billet", from: "2026-11-01", to: "2026-11-22" });
    expect(parseRejectsSearch({ kind: "log" })).toEqual({});
    expect(parseRejectsSearch({ from: "01-11-2026", to: 5 })).toEqual({});
    expect([kindOfSearch({}), kindOfSearch({ kind: "billet" })]).toEqual(["log", "billet"]);
    expect([reasonKindOf("log"), reasonKindOf("billet")]).toEqual(["log_reject", "billet_reject"]);
  });
  test("a backwards range is spotted", () => {
    expect(rangeBackwards({ from: "2026-11-10", to: "2026-11-01" })).toBe(true);
    expect([rangeBackwards({ from: "2026-11-01" }), rangeBackwards({ from: "2026-11-01", to: "2026-11-01" })]).toEqual([false, false]);
  });
});

describe("places by kind", () => {
  test("log rejects come from the billet store; billet rejects from the rack or a press floor", () => {
    expect(rejectPlaceOptions("log", places).map((p) => p.locationCode)).toEqual(["BILLET"]);
    expect(rejectPlaceOptions("billet", places).map((p) => p.locationCode)).toEqual(["FLOOR1", "RACK1"]);
  });
});

describe("the reject form", () => {
  const picks = rejectPlaceOptions("billet", places);
  const ok = { ...blankReject(), pick: "c1:r", reasonCode: "crack", pcs: "4", kg: "120" };
  test("note is required for other and for a reason that says so", () => {
    expect([noteRequired("other", false), noteRequired("porosity", true), noteRequired("crack", false), noteRequired("crack", null)]).toEqual([true, true, false, false]);
    expect(checkReject({ ...ok, reasonCode: "other" }, picks, reasons)).toEqual({ ok: false, issue: "note" });
    expect(checkReject({ ...ok, reasonCode: "other", note: "   " }, picks, reasons)).toEqual({ ok: false, issue: "note" });
    expect(checkReject({ ...ok, reasonCode: "porosity" }, picks, reasons)).toEqual({ ok: false, issue: "note" });
    expect(checkReject({ ...ok, reasonCode: "other", note: "bent" }, picks, reasons).ok).toBe(true);
  });
  test("a full form builds the server input; the stream and note are sent only when given", () => {
    expect(checkReject(ok, picks, reasons)).toEqual({ ok: true, input: { castId: "c1", locationId: "r", reasonCodeId: "r1", pcs: 4, kgG: 120_000 } });
    expect(checkReject({ ...ok, note: " x ", streamId: "st1" }, picks, reasons)).toEqual({ ok: true, input: { castId: "c1", locationId: "r", reasonCodeId: "r1", note: "x", pcs: 4, kgG: 120_000, streamId: "st1" } });
  });
  test("each missing field and the stock limit", () => {
    expect(checkReject(blankReject(), picks, reasons)).toEqual({ ok: false, issue: "pick" });
    expect(checkReject({ ...ok, reasonCode: "" }, picks, reasons)).toEqual({ ok: false, issue: "reason" });
    expect(checkReject({ ...ok, pcs: "" }, picks, reasons)).toEqual({ ok: false, issue: "pcs" });
    expect(checkReject({ ...ok, kg: "" }, picks, reasons)).toEqual({ ok: false, issue: "kg" });
    expect(checkReject({ ...ok, kg: "500.5" }, picks, reasons)).toEqual({ ok: false, issue: "more_than_stock" });
  });
});

describe("totals", () => {
  test("by reason, heaviest first, with shares that name the kg", () => {
    const rows = reasonShares([
      { code: "crack", label: "Crack", pcs: 3, kgG: 100_000 },
      { code: "bend", label: "Bend", pcs: 9, kgG: 300_000 },
    ]);
    expect(rows.map((r) => [r.code, r.shareBp])).toEqual([["bend", 7_500], ["crack", 2_500]]);
    expect(reasonShares([])).toEqual([]);
    expect(reasonShares([{ code: "x", label: "x", pcs: 0, kgG: 0 }])[0]!.shareBp).toBe(0);
  });
  test("sums", () => {
    expect(sumRejects([{ pcs: 2, kgG: 10 }, { pcs: 3, kgG: 5 }])).toEqual({ entries: 2, pcs: 5, kgG: 15 });
  });
});

describe("reason words", () => {
  const t = ((key: string) => (key === "reasons.log_reject.crack" ? "Crack (words)" : key)) as never;
  test("the translated code wins; else the stored label; else the code", () => {
    expect(rejectReasonText(t, "log", "crack", "Crack")).toBe("Crack (words)");
    expect(rejectReasonText(t, "billet", "crack", "Crack")).toBe("Crack");
    expect(rejectReasonText(t, "billet", "weird", null)).toBe("weird");
  });
});
