/** Wave 2 contracts: cast numbering, settings, die copy on trial (FP-FD-02, FP-DR-17). */
import { describe, expect, test } from "bun:test";

import { canIssueDie, dieCopyNext, newCopyStatus } from "./dieRoom";
import { castNumberParts, isSeriesCastCode, parseCastCode } from "./serial";
import { FLOOR_SETTINGS_DEFAULTS, castSeriesFirstSeq, readCastSeriesStart, readFloorSettings } from "./settings";

describe("cast numbers (month letter + seq; year stored, never printed)", () => {
  test("parts from the series period", () => {
    expect(castNumberParts("2026-11", 31)).toEqual({ year: 2026, month: 11, seq: 31, number: "K31" });
    expect(castNumberParts("2027-01", 1)).toEqual({ year: 2027, month: 1, seq: 1, number: "A1" });
    expect(() => castNumberParts("2026-13x", 1)).toThrow();
  });

  test("parse and the legacy-code rule", () => {
    expect(parseCastCode(" k31 ")).toEqual({ month: 11, seq: 31 });
    expect(parseCastCode("L4")).toEqual({ month: 12, seq: 4 });
    expect(parseCastCode("M4")).toBeNull();
    expect(parseCastCode("K0")).toBeNull();
    expect(isSeriesCastCode("F31")).toBe(true);
    expect(isSeriesCastCode("OLD-F31")).toBe(false);
  });

  test("castSeriesStart continues the paper book only in its month", () => {
    const start = readCastSeriesStart({ period: "2026-11", start: 32 });
    expect(start).toEqual({ period: "2026-11", start: 32 });
    expect(castSeriesFirstSeq(start, "2026-11")).toBe(32);
    expect(castSeriesFirstSeq(start, "2026-12")).toBe(1);
    expect(castSeriesFirstSeq(null, "2026-11")).toBe(1);
    expect(readCastSeriesStart({ period: "2026-13", start: 3 })).toBeNull();
    expect(readCastSeriesStart({ period: "2026-11", start: 0 })).toBeNull();
    expect(readCastSeriesStart("K31")).toBeNull();
  });
});

describe("floor settings (Wave 2 keys)", () => {
  test("defaults: new copies on trial, no cast book start", () => {
    expect(FLOOR_SETTINGS_DEFAULTS.dieRoom).toEqual({ newCopyOnTrial: true });
    expect(readFloorSettings({}).dieRoom.newCopyOnTrial).toBe(true);
    expect(readFloorSettings({}).castSeriesStart).toBeNull();
  });

  test("reads the plant's choice; malformed falls back", () => {
    expect(readFloorSettings({ dieRoom: { newCopyOnTrial: false } }).dieRoom.newCopyOnTrial).toBe(false);
    expect(readFloorSettings({ dieRoom: { newCopyOnTrial: "no" } }).dieRoom.newCopyOnTrial).toBe(true);
    expect(readFloorSettings({ castSeriesStart: { period: "2026-10", start: 12 } }).castSeriesStart).toEqual({ period: "2026-10", start: 12 });
  });
});

describe("die copy on trial (FP-DR-17)", () => {
  test("new copy / maker receive start on trial while the setting is on", () => {
    expect(newCopyStatus(FLOOR_SETTINGS_DEFAULTS)).toBe("on_trial");
    expect(newCopyStatus({ dieRoom: { newCopyOnTrial: false } })).toBe("available");
    expect(dieCopyNext("at_maker", "makerReceiveTrial")).toBe("on_trial");
  });

  test("trial moves: issue to a trial run, return, pass, manager release, back to maker, retire", () => {
    expect(dieCopyNext("on_trial", "trialIssue")).toBe("in_use");
    expect(dieCopyNext("in_use", "trialReturn")).toBe("on_trial");
    expect(dieCopyNext("on_trial", "trialPass")).toBe("available");
    expect(dieCopyNext("on_trial", "trialRelease")).toBe("available");
    expect(dieCopyNext("on_trial", "trialToMaker")).toBe("at_maker");
    expect(dieCopyNext("on_trial", "trialRetire")).toBe("retired");
    // Production moves never take an on_trial copy.
    expect(dieCopyNext("on_trial", "issue")).toBeNull();
    expect(dieCopyNext("on_trial", "makerSend")).toBeNull();
    expect(dieCopyNext("on_trial", "retire")).toBeNull();
  });

  test("issue: production refuses an on_trial copy; a die_trial run takes it", () => {
    const base = { openIssueForCopy: false, pressLineId: "p1", run: { status: "queued", sectionId: "s", pressLineId: "p1" } };
    const onTrial = { status: "on_trial" as const, sectionId: "s" };
    expect(canIssueDie({ ...base, copy: onTrial })).toEqual({ ok: false, refusal: "copy_on_trial" });
    expect(canIssueDie({ ...base, copy: onTrial, purpose: "production" })).toEqual({ ok: false, refusal: "copy_on_trial" });
    expect(canIssueDie({ ...base, copy: onTrial, purpose: "die_trial" })).toEqual({ ok: true });
    expect(canIssueDie({ ...base, copy: { status: "available", sectionId: "s" }, purpose: "die_trial" })).toEqual({ ok: true });
  });
});
