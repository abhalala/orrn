/** W3-AG-C ageing contracts: the oven's pure rules (spec 2026-10-24-orrn-fp-ageing-design.md §3, §6). */
import { describe, expect, test } from "bun:test";

import {
  AGEING_BATCH_STATUSES,
  AGEING_BATCH_TRANSITIONS,
  AGEING_LOAD_MAX_ROWS,
  AGEING_RECIPE_SUGGESTIONS,
  AGEING_REFUSAL_CODES,
  AGEING_REJECT_CODES,
  AGEING_ROW_STATUSES,
  AGEING_ROW_TRANSITIONS,
  AGEING_TEMP_AFTER_OUT_MS,
  BUNDLE_AGEING_STATES,
  BUNDLE_AGEING_TRANSITIONS,
  ageingBatchPhase,
  ageingBatchShouldClose,
  ageingBatchTotals,
  ageingCapacity,
  ageingDiscardGate,
  ageingDrawGate,
  ageingGasUsedMilli,
  ageingGasWarning,
  ageingHardnessGates,
  ageingHoldGates,
  ageingInBand,
  ageingLoadGates,
  ageingLoadKgG,
  ageingReadingGates,
  ageingRecipeErrors,
  ageingReleasePlan,
  ageingReworkPlan,
  ageingRowCountsValid,
  ageingRowRemaining,
  ageingSplitPlan,
  ageingStartGates,
  ageingTakeOutGates,
  ageingTimeGate,
  ageingVoidGates,
  bundleAgeingState,
  bundleEligibility,
  canMoveAgeingBatch,
  canMoveAgeingRow,
  dispatchAgeingRefusal,
  hardnessSamplePass,
  hardnessSummary,
  isOpenAgeingBatch,
  largestRemainder,
  medianX10,
  normalizeAgeingCode,
  ovenCurveLengthMin,
  ovenSimulatedCurve,
  ovenSimulatedTempAt,
  pressLineEligibility,
  soakCompliance,
  type AgeingReleaseRow,
  type AgeingStartGateInput,
} from "./ageing";
import { DEFAULT_REASON_CODES, REASON_CODE_KINDS } from "./reasonCodes";
import { FLOOR_SETTINGS_DEFAULTS, readFloorSettings } from "./settings";

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 24, 1, 50); // AG-38 in 24 Oct 2026 07:20 IST
const T5 = { targetTempX10: 1850, toleranceX10: 100, soakMin: 240, maxSoakMin: null };
const at = (m: number) => T0 + m * MIN;

describe("state machines", () => {
  test("batch: the spec's lifecycle, void only before the oven or after it with nothing packed", () => {
    expect(canMoveAgeingBatch("loading", "in_oven")).toBe(true);
    expect(canMoveAgeingBatch("loading", "void")).toBe(true);
    expect(canMoveAgeingBatch("in_oven", "void")).toBe(false);
    expect(canMoveAgeingBatch("in_oven", "out")).toBe(true);
    expect(canMoveAgeingBatch("out", "released")).toBe(true);
    expect(canMoveAgeingBatch("out", "held")).toBe(true);
    expect(canMoveAgeingBatch("released", "held")).toBe(true);
    expect(canMoveAgeingBatch("held", "released")).toBe(true);
    expect(canMoveAgeingBatch("released", "closed")).toBe(true);
    expect(canMoveAgeingBatch("closed", "released")).toBe(true); // a bundle void restores pieces
    expect(canMoveAgeingBatch("released", "void")).toBe(false);
    expect(AGEING_BATCH_TRANSITIONS.void).toEqual([]);
  });

  test("every status has a row in each table, and no move points at an unknown status", () => {
    for (const s of AGEING_BATCH_STATUSES) for (const to of AGEING_BATCH_TRANSITIONS[s]) expect(AGEING_BATCH_STATUSES).toContain(to);
    for (const s of AGEING_ROW_STATUSES) for (const to of AGEING_ROW_TRANSITIONS[s]) expect(AGEING_ROW_STATUSES).toContain(to);
    for (const s of BUNDLE_AGEING_STATES) for (const to of BUNDLE_AGEING_TRANSITIONS[s]) expect(BUNDLE_AGEING_STATES).toContain(to);
  });

  test("row: pending is judged at release; closed reopens on restore; void is final", () => {
    expect(canMoveAgeingRow("pending", "released")).toBe(true);
    expect(canMoveAgeingRow("pending", "held")).toBe(true);
    expect(canMoveAgeingRow("held", "released")).toBe(true);
    expect(canMoveAgeingRow("released", "closed")).toBe(true);
    expect(canMoveAgeingRow("closed", "released")).toBe(true);
    expect(canMoveAgeingRow("released", "pending")).toBe(false);
    expect(canMoveAgeingRow("void", "pending")).toBe(false);
  });

  test("open batches hold the trolley until close or void (Q6)", () => {
    expect(["loading", "in_oven", "out", "released", "held"].every((s) => isOpenAgeingBatch(s as never))).toBe(true);
    expect(isOpenAgeingBatch("closed")).toBe(false);
    expect(isOpenAgeingBatch("void")).toBe(false);
  });

  test("board phase splits in_oven by the soak clock", () => {
    expect(ageingBatchPhase({ status: "in_oven", soakStartedAt: null })).toBe("heating");
    expect(ageingBatchPhase({ status: "in_oven", soakStartedAt: at(15) })).toBe("soaking");
    expect(ageingBatchPhase({ status: "out", soakStartedAt: at(15) })).toBe("out");
    expect(ageingBatchPhase({ status: "loading", soakStartedAt: null })).toBe("loading");
  });
});

describe("pieces and kilograms (spec §8.2 fixture)", () => {
  const rows = [
    { status: "released" as const, pcs: 48, packedPcs: 5, scrapPcs: 0, reworkPcs: 0, kgG: 286_400 },
    { status: "released" as const, pcs: 20, packedPcs: 0, scrapPcs: 0, reworkPcs: 0, kgG: 238_640 },
    { status: "held" as const, pcs: 36, packedPcs: 0, scrapPcs: 0, reworkPcs: 0, kgG: 99_200 },
  ];

  test("AG-38: 104 loaded, 5 packed, 99 remaining, 63 packable, 36 held", () => {
    const t = ageingBatchTotals(rows);
    expect(t).toMatchObject({ loadedPcs: 104, packedPcs: 5, remainingPcs: 99, packablePcs: 63, heldPcs: 36, pendingPcs: 0, loadedKgG: 624_240 });
    expect(t.loadedPcs).toBe(t.packedPcs + t.scrapPcs + t.reworkPcs + t.remainingPcs);
  });

  test("theoretical kg on the rack is prorated by remaining pieces; void rows do not count", () => {
    const t = ageingBatchTotals([...rows, { status: "void", pcs: 10, packedPcs: 0, scrapPcs: 0, reworkPcs: 0, kgG: 50_000 }]);
    expect(t.loadedPcs).toBe(104);
    // floor(286400 × 43 / 48) = 256566, + 238640 + 99200
    expect(t.theoreticalRemainingKgG).toBe(256_566 + 238_640 + 99_200);
  });

  test("remaining is pcs − packed − scrap − rework and never negative", () => {
    expect(ageingRowRemaining({ pcs: 48, packedPcs: 5, scrapPcs: 2, reworkPcs: 1 })).toBe(40);
    expect(ageingRowRemaining({ pcs: 5, packedPcs: 6, scrapPcs: 0, reworkPcs: 0 })).toBe(0);
    expect(ageingRowCountsValid({ pcs: 5, packedPcs: 6, scrapPcs: 0, reworkPcs: 0 })).toBe(false);
    expect(ageingRowCountsValid({ pcs: 5, packedPcs: 2, scrapPcs: 1, reworkPcs: 2 })).toBe(true);
    expect(ageingRowCountsValid({ pcs: 5, packedPcs: 1.5, scrapPcs: 0, reworkPcs: 0 })).toBe(false);
  });

  test("largest remainder sums exactly and favours the bigger fraction", () => {
    expect(largestRemainder(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(largestRemainder(1_000, [3, 7])).toEqual([300, 700]);
    expect(largestRemainder(10, [0, 0])).toEqual([0, 10]);
    const parts = largestRemainder(624_241, [48, 20, 36]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(624_241);
  });

  test("loading a press line in two goes sums back to its good kg", () => {
    const line = { lineGoodG: 358_000, linePcs: 60 };
    const first = ageingLoadKgG({ ...line, loadedPcs: 0, loadedKgG: 0, takePcs: 25 });
    expect(first).toBe(149_167);
    const second = ageingLoadKgG({ ...line, loadedPcs: 25, loadedKgG: first, takePcs: 35 });
    expect(first + second).toBe(358_000);
    expect(ageingLoadKgG({ ...line, loadedPcs: 60, loadedKgG: 358_000, takePcs: 1 })).toBe(0);
  });

  test("capacity is a warning: near above 95 %, over above 100 %, unknown with no capacity", () => {
    expect(ageingCapacity(1_000_000, 2_000_000)).toBe("ok");
    expect(ageingCapacity(1_950_000, 2_000_000)).toBe("near");
    expect(ageingCapacity(2_000_001, 2_000_000)).toBe("over");
    expect(ageingCapacity(5, null)).toBe("unknown");
  });

  test("batch closes when every live row is empty", () => {
    expect(ageingBatchShouldClose([{ status: "released", pcs: 10, packedPcs: 10, scrapPcs: 0, reworkPcs: 0 }, { status: "void", pcs: 5, packedPcs: 0, scrapPcs: 0, reworkPcs: 0 }])).toBe(true);
    expect(ageingBatchShouldClose([{ status: "released", pcs: 10, packedPcs: 9, scrapPcs: 0, reworkPcs: 0 }])).toBe(false);
    expect(ageingBatchShouldClose([{ status: "void", pcs: 10, packedPcs: 0, scrapPcs: 0, reworkPcs: 0 }])).toBe(false);
  });
});

describe("soak compliance from the temperature log", () => {
  // AG-38 shape (spec §8.2): 02:05 below the band, 02:20 185 (soak starts), 04:00 186, 06:00 184; out 06:10
  // → 4 h 05 m. The spec's 176 °C first reading is inside 185 ± 10, so the fixture uses 170 °C.
  const log = [
    { at: at(15), tempCX10: 1700 },
    { at: at(30), tempCX10: 1850 },
    { at: at(130), tempCX10: 1860 },
    { at: at(250), tempCX10: 1840 },
  ];

  test("AG-38 meets 240 min: soak from the first in-band reading, min and max shown", () => {
    const c = soakCompliance({ readings: log, snapshot: T5, inAt: T0, outAt: at(275), now: at(300) });
    expect(c).toMatchObject({ verdict: "ok", met: true, soakStartedAt: at(30), inBandMin: 245, soakElapsedMin: 245, minX10: 1700, maxX10: 1860, readingCount: 4 });
  });

  test("band edges are inside (175.0 and 195.0 for 185 ± 10)", () => {
    expect(ageingInBand(1750, T5)).toBe(true);
    expect(ageingInBand(1950, T5)).toBe(true);
    expect(ageingInBand(1749, T5)).toBe(false);
    expect(ageingInBand(1951, T5)).toBe(false);
  });

  test("no readings → no_readings; never in band → under-aged with no soak start", () => {
    expect(soakCompliance({ readings: [], snapshot: T5, inAt: T0, outAt: at(275), now: at(300) }).verdict).toBe("no_readings");
    const cold = soakCompliance({ readings: [{ at: at(10), tempCX10: 1500 }], snapshot: T5, inAt: T0, outAt: at(275), now: at(300) });
    expect(cold).toMatchObject({ verdict: "under_aged", soakStartedAt: null, soakElapsedMin: 0 });
  });

  test("taken out early → under-aged (short soak blocks release, not take-out)", () => {
    expect(soakCompliance({ readings: log, snapshot: T5, inAt: T0, outAt: at(200), now: at(200) }).verdict).toBe("under_aged");
  });

  test("time out of band after the soak started does not count as soak", () => {
    const dip = [...log.slice(0, 2), { at: at(100), tempCX10: 1600 }, { at: at(160), tempCX10: 1850 }];
    const c = soakCompliance({ readings: dip, snapshot: T5, inAt: T0, outAt: at(275), now: at(300) });
    expect(c.belowBandMin).toBe(60);
    expect(c.inBandMin).toBe(70 + 115);
    expect(c.verdict).toBe("under_aged");
    expect(c.soakElapsedMin).toBe(245); // the wall clock still runs; the verdict uses time at temperature
  });

  test("above the band past the 15 min grace → over-aged; a short overshoot is fine", () => {
    const hot = [...log, { at: at(200), tempCX10: 2000 }, { at: at(220), tempCX10: 1850 }].sort((a, b) => a.at - b.at);
    expect(soakCompliance({ readings: hot, snapshot: T5, inAt: T0, outAt: at(300), now: at(300) }).verdict).toBe("over_aged");
    const blip = [...log, { at: at(200), tempCX10: 2000 }, { at: at(210), tempCX10: 1850 }].sort((a, b) => a.at - b.at);
    expect(soakCompliance({ readings: blip, snapshot: T5, inAt: T0, outAt: at(300), now: at(300) }).verdict).toBe("ok");
  });

  test("longer at temperature than maxSoakMin → over-aged", () => {
    const c = soakCompliance({ readings: log, snapshot: { ...T5, maxSoakMin: 241 }, inAt: T0, outAt: at(275), now: at(300) });
    expect(c.verdict).toBe("over_aged");
  });

  test("still in the oven: the window ends now; readings outside [in, end] are ignored", () => {
    const c = soakCompliance({ readings: [{ at: T0 - 10 * MIN, tempCX10: 1850 }, ...log], snapshot: T5, inAt: T0, outAt: null, now: at(100) });
    expect(c.readingCount).toBe(2);
    expect(c.inBandMin).toBe(70);
    expect(c.verdict).toBe("under_aged");
  });
});

describe("hardness (Q2, Q3)", () => {
  const rule = { method: "webster" as const, minX10: 80, maxX10: 150, sampleCount: 3 };
  const w = (...v: number[]) => v.map((readingX10) => ({ method: "webster" as const, readingX10 }));

  test("median of whole numbers; even count rounds half up", () => {
    expect(medianX10([90, 100, 90])).toBe(90);
    expect(medianX10([90, 101])).toBe(96);
    expect(medianX10([])).toBeNull();
  });

  test("Webster 9.0, 10.0, 9.0 passes; 7.0, 7.0, 6.0 fails (spec §8.2)", () => {
    expect(hardnessSummary(w(90, 100, 90), rule)).toMatchObject({ pass: true, reason: "ok", medianX10: 90, count: 3, warnHigh: false });
    expect(hardnessSummary(w(70, 70, 60), rule)).toMatchObject({ pass: false, reason: "below_min", medianX10: 70 });
  });

  test("one soft sample fails the line even when the median passes", () => {
    expect(hardnessSummary(w(100, 100, 70), rule)).toMatchObject({ pass: false, reason: "below_min", medianX10: 100 });
  });

  test("too few samples is not a pass; untested is null; the demo's flat 3.0 cannot pass", () => {
    expect(hardnessSummary(w(90, 100), rule)).toMatchObject({ pass: false, reason: "too_few" });
    expect(hardnessSummary([], rule)).toMatchObject({ pass: null, reason: "untested", medianX10: null });
    expect(hardnessSummary(w(30, 30, 30), rule).pass).toBe(false);
  });

  test("the other method is stored and shown but never decides; above max warns only", () => {
    const mixed = [...w(90, 90), { method: "hb" as const, readingX10: 800 }];
    expect(hardnessSummary(mixed, rule)).toMatchObject({ count: 2, reason: "too_few" });
    expect(hardnessSamplePass({ method: "hb", readingX10: 800 }, rule)).toBe(false);
    expect(hardnessSummary(w(90, 160, 90), rule)).toMatchObject({ pass: true, warnHigh: true });
  });
});

describe("release plan (FP-AG-08, 11, 14)", () => {
  const pass = { pass: true, reason: "ok" as const };
  const fail = { pass: false, reason: "below_min" as const };
  const untested = { pass: null, reason: "untested" as const };
  const row = (id: string, hardness: AgeingReleaseRow["hardness"], status: AgeingReleaseRow["status"] = "pending", holdKind: AgeingReleaseRow["holdKind"] = null): AgeingReleaseRow => ({
    id,
    status,
    hardness,
    holdKind,
  });

  test("mixed trolley: passed lines release, the failed one is held as hardness_low; batch released (Q11)", () => {
    const plan = ageingReleasePlan({ batchStatus: "out", soak: "ok", rows: [row("a", pass), row("b", pass), row("c", fail)], overrideApproved: false });
    expect(plan).toEqual({
      ok: true,
      batchStatus: "released",
      qcVerdict: "fail",
      overrideWouldHelp: true,
      moves: [
        { id: "a", to: "released", rejectCode: null },
        { id: "b", to: "released", rejectCode: null },
        { id: "c", to: "held", rejectCode: "hardness_low" },
      ],
    });
  });

  test("every line failed or untested → batch held", () => {
    const plan = ageingReleasePlan({ batchStatus: "out", soak: "ok", rows: [row("a", fail), row("b", untested)], overrideApproved: false });
    expect(plan).toMatchObject({ ok: true, batchStatus: "held", qcVerdict: "fail" });
    if (plan.ok) expect(plan.moves.map((m) => m.rejectCode)).toEqual(["hardness_low", "too_few_samples"]);
  });

  test("a short soak holds every judged line with the soak verdict, whatever the hardness", () => {
    const plan = ageingReleasePlan({ batchStatus: "out", soak: "under_aged", rows: [row("a", pass), row("b", fail)], overrideApproved: false });
    expect(plan).toMatchObject({ ok: true, batchStatus: "held", qcVerdict: "fail" });
    if (plan.ok) expect(plan.moves.every((m) => m.to === "held" && m.rejectCode === "under_aged")).toBe(true);
  });

  test("an approved override releases reject-held lines but never a hand hold (surface, bend, customer)", () => {
    const plan = ageingReleasePlan({
      batchStatus: "held",
      soak: "under_aged",
      rows: [row("a", pass, "held", "ageing_reject"), row("b", fail, "held", "ageing_hold")],
      overrideApproved: true,
    });
    expect(plan).toMatchObject({ ok: true, batchStatus: "released", qcVerdict: "override", overrideWouldHelp: false });
    if (plan.ok) expect(plan.moves).toEqual([{ id: "a", to: "released", rejectCode: null }]);
  });

  test("a passing retest from held releases without an override", () => {
    const plan = ageingReleasePlan({ batchStatus: "held", soak: "ok", rows: [row("a", pass, "held", "ageing_reject")], overrideApproved: false });
    expect(plan).toMatchObject({ ok: true, batchStatus: "released", qcVerdict: "pass" });
  });

  test("only from out or held; a batch with only void rows has nothing to release", () => {
    expect(ageingReleasePlan({ batchStatus: "in_oven", soak: "ok", rows: [row("a", pass)], overrideApproved: false })).toEqual({ ok: false, code: "wrong_status" });
    expect(ageingReleasePlan({ batchStatus: "out", soak: "ok", rows: [row("a", pass, "void")], overrideApproved: false })).toEqual({ ok: false, code: "no_rows" });
  });

  test("reject codes are seeded as reason codes of kind ageing_reject", () => {
    const codes = DEFAULT_REASON_CODES.ageing_reject.map((c) => c.code);
    for (const c of AGEING_REJECT_CODES) expect(codes).toContain(c);
    expect(codes.at(-1)).toBe("other");
  });
});

describe("gates", () => {
  const now = at(600);
  const start = (over: Partial<AgeingStartGateInput> = {}): AgeingStartGateInput => ({
    batchStatus: "loading",
    rowCount: 2,
    oven: { status: "active", busy: false, maxTempX10: 2500 },
    recipe: { status: "active", alloy: "6063", temper: "T5", targetTempX10: 1850, toleranceX10: 100 },
    trolleyStatus: "active",
    shiftsConfigured: true,
    shiftKnown: true,
    rows: [{ alloy: "6063", temper: "T5" }, { alloy: null, temper: null }],
    inAt: now - 5 * MIN,
    now,
    ...over,
  });

  test("start: a clean start has no refusals; a manual line with no cast never blocks", () => {
    expect(ageingStartGates(start())).toEqual([]);
  });

  test("start: busy or dead oven, inactive recipe, too hot, no shifts, alloy mismatch, future time", () => {
    expect(ageingStartGates(start({ oven: { status: "out_of_service", busy: true, maxTempX10: 1800 } }))).toEqual(["oven_not_active", "oven_busy", "oven_too_hot"]);
    expect(ageingStartGates(start({ recipe: { status: "draft", alloy: "6063", temper: "T5", targetTempX10: 1850, toleranceX10: 100 } }))).toEqual(["recipe_not_active"]);
    expect(ageingStartGates(start({ shiftsConfigured: false }))).toEqual(["no_shifts"]);
    expect(ageingStartGates(start({ shiftKnown: false }))).toEqual(["shift_unknown"]);
    expect(ageingStartGates(start({ rows: [{ alloy: "6061", temper: null }] }))).toEqual(["alloy_mismatch"]);
    expect(ageingStartGates(start({ rows: [{ alloy: "6063", temper: "t6" }] }))).toEqual(["temper_mismatch"]);
    expect(ageingStartGates(start({ inAt: now + 1 }))).toEqual(["time_future"]);
    expect(ageingStartGates(start({ batchStatus: "in_oven", rowCount: 0, oven: null, recipe: null }))).toEqual(["wrong_status", "no_rows", "oven_not_found", "recipe_not_found"]);
  });

  test("times: backdate at most 12 hours, never the future", () => {
    expect(ageingTimeGate(now - 12 * 3_600_000, now)).toBeNull();
    expect(ageingTimeGate(now - 12 * 3_600_000 - 1, now)).toBe("backdate_too_far");
    expect(ageingTimeGate(now + 1, now)).toBe("time_future");
  });

  test("load: trolley active and free, 1–40 rows, typed rows only with manualLoad", () => {
    const base = { batchStatus: null, trolleyStatus: "active" as const, trolleyBusy: false, rowCount: 3, manualRows: 0, manualLoad: true };
    expect(ageingLoadGates(base)).toEqual([]);
    expect(ageingLoadGates({ ...base, trolleyBusy: true, trolleyStatus: "out_of_service" })).toEqual(["trolley_not_active", "trolley_busy"]);
    expect(ageingLoadGates({ ...base, rowCount: 0 })).toEqual(["no_rows"]);
    expect(ageingLoadGates({ ...base, rowCount: AGEING_LOAD_MAX_ROWS + 1 })).toEqual(["too_many_rows"]);
    expect(ageingLoadGates({ ...base, manualRows: 1, manualLoad: false })).toEqual(["manual_off"]);
    expect(ageingLoadGates({ ...base, batchStatus: "in_oven" })).toEqual(["wrong_status"]);
  });

  test("press line: logged only, pieces within what is left, alloy and temper of the recipe", () => {
    const line = { runStatus: "logged", linePcs: 60, loadedPcs: 20, takePcs: 40, alloy: "6063", temper: "T5" };
    expect(pressLineEligibility(line)).toBeNull();
    expect(pressLineEligibility({ ...line, runStatus: "counting" })).toBe("run_not_logged");
    expect(pressLineEligibility({ ...line, takePcs: 41 })).toBe("over_line");
    expect(pressLineEligibility({ ...line, takePcs: 0 })).toBe("over_line");
    expect(pressLineEligibility({ ...line, recipe: { alloy: "6061", temper: "T6" } })).toBe("alloy_mismatch");
    expect(pressLineEligibility({ ...line, recipe: { alloy: "6063", temper: "T6" } })).toBe("temper_mismatch");
    expect(pressLineEligibility({ ...line, alloy: null, temper: null, recipe: { alloy: "6061", temper: "T6" } })).toBeNull();
  });

  test("bundle: packed and in stock, not yet aged, not on another trolley, alloy/temper match", () => {
    const b = { status: "available", ageingRowId: null, onOpenBatch: false, alloy: "6063", temper: "T6" };
    expect(bundleEligibility(b)).toBeNull();
    expect(bundleEligibility({ ...b, status: "reserved" })).toBe("bundle_not_available");
    expect(bundleEligibility({ ...b, status: "dispatched" })).toBe("bundle_not_available");
    expect(bundleEligibility({ ...b, onOpenBatch: true })).toBe("bundle_on_batch");
    expect(bundleEligibility({ ...b, ageingRowId: "row-1" })).toBe("bundle_already_aged");
    expect(bundleEligibility({ ...b, recipe: { alloy: "6063", temper: "T5" } })).toBe("temper_mismatch");
  });

  test("take-out: a reading, gas end ≥ start, out after in", () => {
    const base = { batchStatus: "in_oven" as const, readingCount: 3, gasStartMilli: 18_420_500, gasEndMilli: 18_431_200, inAt: at(0), outAt: at(260), now: at(270) };
    expect(ageingTakeOutGates(base)).toEqual([]);
    expect(ageingTakeOutGates({ ...base, readingCount: 0, gasEndMilli: 18_000_000, outAt: at(0) })).toEqual(["no_reading", "gas_end_below_start", "out_before_in"]);
    expect(ageingTakeOutGates({ ...base, batchStatus: "out" })).toEqual(["wrong_status"]);
    expect(ageingGasUsedMilli(18_420_500, 18_431_200)).toBe(10_700);
    expect(ageingGasUsedMilli(5, 4)).toBeNull();
  });

  test("gas going backwards is a warning unless the meter was reset (Q4)", () => {
    expect(ageingGasWarning({ gasStartMilli: 100, lastGasEndMilli: 200, meterReset: false })).toBe("gas_backwards");
    expect(ageingGasWarning({ gasStartMilli: 100, lastGasEndMilli: 200, meterReset: true })).toBeNull();
    expect(ageingGasWarning({ gasStartMilli: 300, lastGasEndMilli: 200, meterReset: false })).toBeNull();
  });

  test("readings: in the oven, or within 30 minutes after take-out; not before in, not ahead", () => {
    const out = at(260);
    expect(ageingReadingGates({ batchStatus: "in_oven", inAt: at(0), outAt: null, at: at(100), now: at(100) })).toEqual([]);
    expect(ageingReadingGates({ batchStatus: "out", inAt: at(0), outAt: out, at: out, now: out + AGEING_TEMP_AFTER_OUT_MS })).toEqual([]);
    expect(ageingReadingGates({ batchStatus: "out", inAt: at(0), outAt: out, at: out, now: out + AGEING_TEMP_AFTER_OUT_MS + 1 })).toEqual(["reading_closed"]);
    expect(ageingReadingGates({ batchStatus: "loading", inAt: null, outAt: null, at: at(1), now: at(2) })).toEqual(["wrong_status"]);
    expect(ageingReadingGates({ batchStatus: "in_oven", inAt: at(10), outAt: null, at: at(5), now: at(20) })).toEqual(["reading_before_in"]);
    expect(ageingReadingGates({ batchStatus: "in_oven", inAt: at(0), outAt: null, at: at(30), now: at(20) })).toEqual(["time_future"]);
  });

  test("hardness only once out, on a live row", () => {
    expect(ageingHardnessGates({ batchStatus: "out", rowStatus: "pending" })).toEqual([]);
    expect(ageingHardnessGates({ batchStatus: "held", rowStatus: "held" })).toEqual([]);
    expect(ageingHardnessGates({ batchStatus: "in_oven", rowStatus: "pending" })).toEqual(["wrong_status"]);
    expect(ageingHardnessGates({ batchStatus: "released", rowStatus: "void" })).toEqual(["wrong_status"]);
  });

  test("hold: whole trolley only before pack; a line already held; not before take-out", () => {
    const rows = [{ status: "released" as const, packedPcs: 5 }, { status: "released" as const, packedPcs: 0 }];
    expect(ageingHoldGates({ scope: "batch", batchStatus: "released", rows })).toEqual(["hold_after_pack"]);
    expect(ageingHoldGates({ scope: "batch", batchStatus: "out", rows: [{ status: "pending", packedPcs: 0 }] })).toEqual([]);
    expect(ageingHoldGates({ scope: "batch", batchStatus: "out", rows: [{ status: "pending", packedPcs: 4, source: "bundle" }] })).toEqual([]);
    expect(ageingHoldGates({ scope: "row", batchStatus: "released", rows, rowStatus: "held" })).toEqual(["already_held"]);
    expect(ageingHoldGates({ scope: "row", batchStatus: "released", rows, rowStatus: "released" })).toEqual([]);
    expect(ageingHoldGates({ scope: "row", batchStatus: "in_oven", rows, rowStatus: "pending" })).toEqual(["wrong_status"]);
  });

  test("void (abort): free while loading; never in the oven; out/held only with nothing packed and a reason", () => {
    expect(ageingVoidGates({ batchStatus: "loading", anyPacked: false, reasonGiven: false })).toEqual([]);
    expect(ageingVoidGates({ batchStatus: "in_oven", anyPacked: false, reasonGiven: true })).toEqual(["void_in_oven"]);
    expect(ageingVoidGates({ batchStatus: "out", anyPacked: true, reasonGiven: false })).toEqual(["void_after_pack", "void_reason_missing"]);
    expect(ageingVoidGates({ batchStatus: "held", anyPacked: false, reasonGiven: true })).toEqual([]);
    expect(ageingVoidGates({ batchStatus: "released", anyPacked: false, reasonGiven: true })).toEqual(["wrong_status"]);
  });

  test("draw and discard: released rows only for pack; never above remaining", () => {
    expect(ageingDrawGate({ rowStatus: "released", remainingPcs: 43, pcs: 43 })).toBeNull();
    expect(ageingDrawGate({ rowStatus: "released", remainingPcs: 43, pcs: 44 })).toBe("discard_over");
    expect(ageingDrawGate({ rowStatus: "held", remainingPcs: 36, pcs: 1 })).toBe("not_released");
    expect(ageingDiscardGate({ rowStatus: "held", remainingPcs: 36, pcs: 36 })).toBeNull();
    expect(ageingDiscardGate({ rowStatus: "closed", remainingPcs: 0, pcs: 1 })).toBe("wrong_status");
  });
});

describe("rework and split", () => {
  test("rework moves every held row's remaining pieces; the batch closes when nothing else is left", () => {
    const rows = [
      { id: "a", status: "released" as const, pcs: 48, packedPcs: 48, scrapPcs: 0, reworkPcs: 0, kgG: 286_400 },
      { id: "c", status: "held" as const, pcs: 36, packedPcs: 0, scrapPcs: 0, reworkPcs: 0, kgG: 99_200 },
    ];
    expect(ageingReworkPlan({ batchStatus: "released", rows })).toEqual({ ok: true, moves: [{ rowId: "c", pcs: 36, kgG: 99_200 }], closesBatch: true });
    expect(ageingReworkPlan({ batchStatus: "released", rows: rows.slice(0, 1) })).toEqual({ ok: false, code: "nothing_to_rework" });
    expect(ageingReworkPlan({ batchStatus: "out", rows })).toEqual({ ok: false, code: "wrong_status" });
  });

  test("split: off by default; conserves length × pieces within 25 mm; grams sum exactly", () => {
    const row = { pcs: 20, lengthMm: 7_315, kgG: 238_640, packedPcs: 0, status: "released" as const };
    const cuts = [{ lengthMm: 3_658, pcs: 20 }, { lengthMm: 3_657, pcs: 20 }];
    expect(ageingSplitPlan({ splitOn: false, row, cuts })).toEqual({ ok: false, code: "split_off" });
    const ok = ageingSplitPlan({ splitOn: true, row, cuts });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.parts.reduce((a, p) => a + p.kgG, 0)).toBe(238_640);
    expect(ageingSplitPlan({ splitOn: true, row: { ...row, packedPcs: 1 }, cuts })).toEqual({ ok: false, code: "split_after_pack" });
    expect(ageingSplitPlan({ splitOn: true, row, cuts: [{ lengthMm: 3_600, pcs: 20 }, { lengthMm: 3_600, pcs: 20 }] })).toEqual({ ok: false, code: "split_length" });
    expect(ageingSplitPlan({ splitOn: true, row, cuts: [{ lengthMm: 7_315, pcs: 20 }] })).toEqual({ ok: false, code: "split_length" });
  });
});

describe("bundle ageing state and dispatch", () => {
  test("derived state from the open row and bundle.ageing_row_id", () => {
    expect(bundleAgeingState({ ageingRowId: null, openRow: null })).toBe("not_aged");
    expect(bundleAgeingState({ ageingRowId: null, openRow: { status: "pending" } })).toBe("in_ageing");
    expect(bundleAgeingState({ ageingRowId: null, openRow: { status: "held" } })).toBe("held");
    expect(bundleAgeingState({ ageingRowId: "r1", openRow: { status: "released" } })).toBe("aged");
    expect(bundleAgeingState({ ageingRowId: "r1", openRow: null })).toBe("aged");
    expect(BUNDLE_AGEING_TRANSITIONS.aged).toEqual([]);
  });

  test("dispatch refuses metal in or held at the oven always; un-aged only when the plant requires it", () => {
    const base = { requireAgeing: false, requireAgeingSince: null, packedDay: "2026-10-24" };
    expect(dispatchAgeingRefusal({ ...base, state: "in_ageing" })).toBe("bundle_in_ageing");
    expect(dispatchAgeingRefusal({ ...base, state: "held" })).toBe("bundle_ageing_held");
    expect(dispatchAgeingRefusal({ ...base, state: "not_aged" })).toBeNull();
    expect(dispatchAgeingRefusal({ ...base, state: "not_aged", requireAgeing: true })).toBe("bundle_not_aged");
    expect(dispatchAgeingRefusal({ ...base, state: "aged", requireAgeing: true })).toBeNull();
  });

  test("bundles packed before requireAgeingSince stay dispatchable", () => {
    const on = { state: "not_aged" as const, requireAgeing: true, requireAgeingSince: "2026-10-25" };
    expect(dispatchAgeingRefusal({ ...on, packedDay: "2026-10-24" })).toBeNull();
    expect(dispatchAgeingRefusal({ ...on, packedDay: "2026-10-25" })).toBe("bundle_not_aged");
  });

  test("settings: requireAgeing defaults off; a malformed since is ignored", () => {
    expect(FLOOR_SETTINGS_DEFAULTS.ageing).toEqual({ manualLoad: true, split: false, requireForPack: false, requireAgeing: false, requireAgeingSince: null });
    expect(readFloorSettings({ ageing: { requireAgeing: true, requireAgeingSince: "2026-10-25" } }).ageing).toMatchObject({ requireAgeing: true, requireAgeingSince: "2026-10-25" });
    expect(readFloorSettings({ ageing: { requireAgeing: "yes", requireAgeingSince: "25/10/2026" } }).ageing).toMatchObject({ requireAgeing: false, requireAgeingSince: null });
    expect(readFloorSettings(null).ageing.manualLoad).toBe(true);
  });
});

describe("masters", () => {
  test("floor codes are upper case, letters digits dash, at most 16", () => {
    expect(normalizeAgeingCode(" ov 1 ")).toBe("OV-1");
    expect(normalizeAgeingCode("t-12")).toBe("T-12");
    expect(normalizeAgeingCode("")).toBeNull();
    expect(normalizeAgeingCode("-T1")).toBeNull();
    expect(normalizeAgeingCode("A".repeat(17))).toBeNull();
  });

  test("recipe cross-field rules", () => {
    const r = { targetTempX10: 1850, toleranceX10: 100, soakMin: 240, maxSoakMin: null, hardnessMinX10: 80, hardnessMaxX10: 150, sampleCount: 3 };
    expect(ageingRecipeErrors(r)).toEqual([]);
    expect(ageingRecipeErrors({ ...r, maxSoakMin: 240, hardnessMaxX10: 80 })).toEqual(["recipe_max_soak_below_soak", "recipe_hardness_max_below_min"]);
  });

  test("six suggested drafts: full and top-up for 6063 T5/T6 and 6061 T6, each valid", () => {
    expect(AGEING_RECIPE_SUGGESTIONS).toHaveLength(6);
    expect(AGEING_RECIPE_SUGGESTIONS.map((s) => `${s.alloy}-${s.temper}-${s.kind}`)).toEqual([
      "6063-T5-full",
      "6063-T6-full",
      "6061-T6-full",
      "6063-T5-top_up",
      "6063-T6-top_up",
      "6061-T6-top_up",
    ]);
    for (const s of AGEING_RECIPE_SUGGESTIONS) expect(ageingRecipeErrors(s)).toEqual([]);
    expect(AGEING_RECIPE_SUGGESTIONS[0]).toMatchObject({ targetTempX10: 1850, soakMin: 240, hardnessMinX10: 80, toleranceX10: 100, sampleCount: 3 });
  });

  test("reason kinds: ageing_abort and ageing_reject exist, each ends with other", () => {
    expect(REASON_CODE_KINDS).toContain("ageing_abort");
    expect(REASON_CODE_KINDS).toContain("ageing_reject");
    expect(DEFAULT_REASON_CODES.ageing_abort.at(-1)!.code).toBe("other");
  });

  test("refusal codes are unique snake case", () => {
    expect(new Set(AGEING_REFUSAL_CODES).size).toBe(AGEING_REFUSAL_CODES.length);
    for (const c of AGEING_REFUSAL_CODES) expect(c).toMatch(/^[a-z]+(?:_[a-z]+)*$/);
  });
});

describe("oven simulator curve", () => {
  const base = { targetTempX10: 1850, toleranceX10: 100, soakMin: 240, startMs: T0, seed: "batch-1" };
  const judge = (profile: "normal" | "under" | "over" | "dip") => {
    const curve = ovenSimulatedCurve({ ...base, profile });
    return soakCompliance({ readings: curve, snapshot: T5, inAt: T0, outAt: curve.at(-1)!.at, now: curve.at(-1)!.at });
  };

  test("deterministic for a seed; readings every 15 minutes from in_at", () => {
    const a = ovenSimulatedCurve(base);
    expect(ovenSimulatedCurve(base)).toEqual(a);
    expect(a[0]!.at).toBe(T0);
    expect(a[1]!.at - a[0]!.at).toBe(15 * MIN);
    expect(a.at(-1)!.at).toBe(T0 + ovenCurveLengthMin(base) * MIN);
  });

  test("ramp stays below the band; the hold stays inside it", () => {
    for (let m = 0; m < 45; m += 5) expect(ageingInBand(ovenSimulatedTempAt(base, m), T5)).toBe(false);
    for (let m = 45; m < 280; m += 5) expect(ageingInBand(ovenSimulatedTempAt(base, m), T5)).toBe(true);
  });

  test("each profile gives the verdict it is named for", () => {
    expect(judge("normal").verdict).toBe("ok");
    expect(judge("under").verdict).toBe("under_aged");
    expect(judge("over").verdict).toBe("over_aged");
    expect(judge("dip").verdict).toBe("under_aged");
  });
});
