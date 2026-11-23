import { describe, expect, test } from "bun:test";

import {
  addDays,
  alloyShort,
  applyQaSettingsEdit,
  calibrationState,
  dimensionInputError,
  dimensionVerdict,
  firstPieceRefusal,
  inProcessDue,
  isTemperCode,
  kindAllowsSubject,
  lotChargeRefusal,
  mechanicalVerdict,
  newPlantQaSettings,
  nextCalibrationDue,
  planBreaches,
  processLimitsError,
  QA_SETTINGS_DEFAULTS,
  readQaSettings,
  substitutesFor,
  temperLimitsError,
} from "./qa";

describe("qa settings", () => {
  test("defaults: every gate off, nothing stamped", () => {
    expect(readQaSettings({})).toEqual(QA_SETTINGS_DEFAULTS);
    expect(readQaSettings(null).requireLotInspection).toBe(false);
  });

  test("malformed values take their default", () => {
    const s = readQaSettings({ qa: { firstPieceBlocksPack: "yes", inProcessEveryBundles: 0, inProcessEveryMinutes: 2.5, lotInspectionSince: "22-11-2026" } });
    expect(s).toEqual(QA_SETTINGS_DEFAULTS);
  });

  test("a new plant starts with lot inspection on from its first day", () => {
    expect(readQaSettings({ qa: newPlantQaSettings("2026-11-22") })).toMatchObject({ requireLotInspection: true, lotInspectionSince: "2026-11-22" });
  });

  test("turning a gate on stamps today; keeping it on keeps the first day; off clears it", () => {
    const on = applyQaSettingsEdit(QA_SETTINGS_DEFAULTS, { firstPieceBlocksPack: true, requireLotInspection: true }, "2026-11-22");
    expect(on.firstPieceSince).toBe("2026-11-22");
    expect(on.lotInspectionSince).toBe("2026-11-22");
    const again = applyQaSettingsEdit(on, { firstPieceBlocksPack: true, inProcessEveryBundles: 5 }, "2026-11-30");
    expect(again.firstPieceSince).toBe("2026-11-22");
    expect(again.inProcessEveryBundles).toBe(5);
    expect(applyQaSettingsEdit(again, { requireLotInspection: false }, "2026-12-01").lotInspectionSince).toBeNull();
  });
});

describe("kinds and subjects", () => {
  test("first piece belongs to a press run only; incoming to lots and store receipts", () => {
    expect(kindAllowsSubject("first_piece", "press_run")).toBe(true);
    expect(kindAllowsSubject("first_piece", "bundle")).toBe(false);
    expect(kindAllowsSubject("incoming", "purchase_lot")).toBe(true);
    expect(kindAllowsSubject("incoming", "store_grn")).toBe(true);
    expect(kindAllowsSubject("incoming", "press_run")).toBe(false);
  });
});

describe("row 22: lot charge gate", () => {
  const base = { required: true, since: "2026-11-01", receivedDay: "2026-11-10" };
  test("waiting, failed and passed", () => {
    expect(lotChargeRefusal({ ...base, latest: null })).toBe("lot_waiting");
    expect(lotChargeRefusal({ ...base, latest: "fail" })).toBe("lot_failed");
    expect(lotChargeRefusal({ ...base, latest: "pass" })).toBeNull();
  });
  test("off, or a lot received before the switch, is never gated", () => {
    expect(lotChargeRefusal({ ...base, required: false, latest: null })).toBeNull();
    expect(lotChargeRefusal({ ...base, receivedDay: "2026-10-31", latest: null })).toBeNull();
  });
});

describe("row 24: first piece gate", () => {
  test("waits for a pass on runs started on or after the switch", () => {
    expect(firstPieceRefusal({ required: true, since: "2026-11-01", run: { startedDay: "2026-11-01", latest: null } })).toBe("first_piece_waiting");
    expect(firstPieceRefusal({ required: true, since: "2026-11-01", run: { startedDay: "2026-11-02", latest: "fail" } })).toBe("first_piece_failed");
    expect(firstPieceRefusal({ required: true, since: "2026-11-01", run: { startedDay: "2026-11-02", latest: "pass" } })).toBeNull();
  });
  test("no run to name, an older run, or the switch off", () => {
    expect(firstPieceRefusal({ required: true, since: null, run: null })).toBeNull();
    expect(firstPieceRefusal({ required: true, since: "2026-11-05", run: { startedDay: "2026-11-04", latest: null } })).toBeNull();
    expect(firstPieceRefusal({ required: false, since: null, run: { startedDay: "2026-11-04", latest: null } })).toBeNull();
  });
});

describe("row 39: in-process cadence", () => {
  test("every N bundles or N minutes", () => {
    expect(inProcessDue({ everyBundles: 5, everyMinutes: null, bundlesSinceLast: 5, minutesSinceLast: 3 })).toEqual({ due: true, reason: "bundles" });
    expect(inProcessDue({ everyBundles: 5, everyMinutes: 60, bundlesSinceLast: 2, minutesSinceLast: 61 })).toEqual({ due: true, reason: "minutes" });
    expect(inProcessDue({ everyBundles: 5, everyMinutes: 60, bundlesSinceLast: 4, minutesSinceLast: 59 })).toEqual({ due: false, reason: null });
    expect(inProcessDue({ everyBundles: null, everyMinutes: null, bundlesSinceLast: 99, minutesSinceLast: 999 }).due).toBe(false);
  });
});

describe("row 25: dimensions", () => {
  test("worked example: wall 1.20 -0.05 +0.10, width 40.00 +/-0.20", () => {
    const v = dimensionVerdict([
      { name: "Wall", nominalUm: 1200, minusUm: 50, plusUm: 100, measuredUm: 1140 },
      { name: "Width", nominalUm: 40_000, minusUm: 200, plusUm: 200, measuredUm: 40_150 },
    ]);
    expect(v.result).toBe("fail");
    expect(v.flagged).toEqual(["Wall"]);
    expect(v.rows[0]).toMatchObject({ deviationUm: -60, within: false, side: "under" });
    expect(v.rows[1]).toMatchObject({ deviationUm: 150, within: true, side: null });
  });
  test("the tolerance edge is inside", () => {
    expect(dimensionVerdict([{ name: "Wall", nominalUm: 1200, minusUm: 50, plusUm: 100, measuredUm: 1300 }]).result).toBe("pass");
    expect(dimensionVerdict([{ name: "Wall", nominalUm: 1200, minusUm: 50, plusUm: 100, measuredUm: 1301 }]).rows[0]!.side).toBe("over");
  });
  test("input errors", () => {
    expect(dimensionInputError([])).toBe("none");
    expect(dimensionInputError([{ name: "a", nominalUm: 0, minusUm: 0, plusUm: 0, measuredUm: 1 }])).toBe("bad_value");
    expect(
      dimensionInputError([
        { name: "Wall", nominalUm: 1, minusUm: 0, plusUm: 0, measuredUm: 1 },
        { name: "wall ", nominalUm: 1, minusUm: 0, plusUm: 0, measuredUm: 1 },
      ]),
    ).toBe("duplicate");
  });
});

describe("rows 26 and 35: mechanical against the temper", () => {
  const t6 = { hardnessMinX10: 800, tensileMinMpa: 205, yieldMinMpa: 170, elongationMinX10: 80 };
  test("pass, low and missing", () => {
    expect(mechanicalVerdict({ tensileMpa: 215, yieldMpa: 180, elongationX10: 95, hardnessX10: 820 }, t6)).toEqual({ result: "pass", low: [], missing: [], unchecked: [] });
    expect(mechanicalVerdict({ tensileMpa: 200, yieldMpa: 180, elongationX10: 95, hardnessX10: 820 }, t6)).toMatchObject({ result: "fail", low: ["tensile"] });
    expect(mechanicalVerdict({ tensileMpa: 215, yieldMpa: null, elongationX10: 95, hardnessX10: 820 }, t6)).toMatchObject({ result: "fail", missing: ["yield"] });
  });
  test("review S3: no temper records values as not checked, never pass; nothing typed fails", () => {
    expect(mechanicalVerdict({ tensileMpa: 1, yieldMpa: null, elongationX10: null, hardnessX10: null }, null).result).toBe("unchecked");
    expect(mechanicalVerdict({ tensileMpa: null, yieldMpa: null, elongationX10: null, hardnessX10: null }, null).result).toBe("fail");
  });
  test("review S2: hardness on another scale is not checked, never pass or fail", () => {
    const hbOnly = { hardnessMinX10: 600, tensileMinMpa: null, yieldMinMpa: null, elongationMinX10: null };
    // Webster 12.0 against an HB minimum of 60.0: not "low".
    expect(mechanicalVerdict({ tensileMpa: null, yieldMpa: null, elongationX10: null, hardnessX10: 120 }, hbOnly, { hardnessOtherScale: true })).toEqual({ result: "unchecked", low: [], missing: [], unchecked: ["hardness"] });
    // A soft batch on the other scale does not pass either.
    expect(mechanicalVerdict({ tensileMpa: null, yieldMpa: null, elongationX10: null, hardnessX10: 9999 }, hbOnly, { hardnessOtherScale: true }).result).toBe("unchecked");
    // The other values still decide.
    expect(mechanicalVerdict({ tensileMpa: 200, yieldMpa: 180, elongationX10: 95, hardnessX10: 120 }, t6, { hardnessOtherScale: true })).toMatchObject({ result: "fail", low: ["tensile"], unchecked: ["hardness"] });
    // The temper's hardness minimum went uncompared: not a pass, even with the rest good.
    expect(mechanicalVerdict({ tensileMpa: 215, yieldMpa: 180, elongationX10: 95, hardnessX10: 120 }, t6, { hardnessOtherScale: true })).toMatchObject({ result: "unchecked", unchecked: ["hardness"] });
    // No hardness minimum on the temper: the other values decide.
    expect(mechanicalVerdict({ tensileMpa: 215, yieldMpa: 180, elongationX10: 95, hardnessX10: 120 }, { ...t6, hardnessMinX10: null }, { hardnessOtherScale: true })).toMatchObject({ result: "pass", unchecked: ["hardness"] });
  });
  test("temper codes and limits", () => {
    expect(["T6", "T5", "T651", "O", "H14"].every(isTemperCode)).toBe(true);
    expect(["t6", "6T", "T-6", "", "T123456789"].some(isTemperCode)).toBe(false);
    expect(temperLimitsError({ ...t6, yieldMinMpa: 300 })).toBe("yield_above_tensile");
  });
});

describe("row 28: plan breaches", () => {
  const limits = { billetTempMinX10: 4600, billetTempMaxX10: 5000, exitTempMinX10: null, exitTempMaxX10: 5400, ramSpeedMinX10: null, ramSpeedMaxX10: 120 };
  test("low billet, high exit and speed", () => {
    expect(planBreaches(limits, { billetTempAvgX10: 4500, exitTempMaxX10: 5500, ramSpeedAvgX10: 90, ramSpeedMaxX10: 130 })).toEqual([
      { metric: "billet_temp", direction: "low", limitX10: 4600, valueX10: 4500 },
      { metric: "exit_temp", direction: "high", limitX10: 5400, valueX10: 5500 },
      { metric: "ram_speed", direction: "high", limitX10: 120, valueX10: 130 },
    ]);
  });
  test("missing readings never breach", () => {
    expect(planBreaches(limits, { billetTempAvgX10: null, exitTempMaxX10: null, ramSpeedAvgX10: null, ramSpeedMaxX10: null })).toEqual([]);
  });
  test("min above max is refused", () => {
    expect(processLimitsError({ ...limits, exitTempMinX10: 5500 })).toBe("exit_temp");
    expect(processLimitsError(limits)).toBeNull();
  });
});

describe("row 37: substitutes", () => {
  const rows = [
    { alloy: "6063", substitute: "6060", customerId: null },
    { alloy: "6063", substitute: "6463", customerId: "c1" },
    { alloy: "6061", substitute: "6082", customerId: null },
  ];
  test("the customer's own list wins, else the plant's", () => {
    expect(substitutesFor(rows, "6063", "c1").map((r) => r.substitute)).toEqual(["6463"]);
    expect(substitutesFor(rows, "6063", "c2").map((r) => r.substitute)).toEqual(["6060"]);
    expect(substitutesFor(rows, "6063", null).map((r) => r.substitute)).toEqual(["6060"]);
  });
  test("short when on hand is below what is left to press", () => {
    expect(alloyShort({ needG: 100_000, onHandG: 50_000 })).toBe(true);
    expect(alloyShort({ needG: 0, onHandG: 0 })).toBe(false);
  });
});

describe("row 38: calibration", () => {
  test("next due and state", () => {
    expect(nextCalibrationDue("2026-01-31", 30)).toBe("2026-03-02");
    expect(nextCalibrationDue(null, 30)).toBeNull();
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(calibrationState("2026-11-21", "2026-11-22")).toBe("overdue");
    expect(calibrationState("2026-11-22", "2026-11-22")).toBe("due_soon");
    expect(calibrationState("2026-11-29", "2026-11-22")).toBe("due_soon");
    expect(calibrationState("2026-11-30", "2026-11-22")).toBe("ok");
    expect(calibrationState(null, "2026-11-22")).toBe("unknown");
  });
});
