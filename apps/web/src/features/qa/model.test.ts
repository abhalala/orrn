import { describe, expect, test } from "bun:test";

import { createI18n } from "@orrn/i18n";

import { checkDetail } from "./checks-tab";
import { runNeedsFlag } from "./flags";
import { dimensionsFromDrafts, draftsFromPlan, flagNames, kindTakesResult, mmText, optional, subjectsFor, tenthsFrom, tenthsText, umFromMm, wholeFrom } from "./model";
import { parseQaSearch } from "./search";
import { checkForStage } from "./waiting-tab";

describe("quality screens: reading what people type (XE parity lane QA)", () => {
  test("mm to µm keeps three decimals and refuses a decimal comma", () => {
    expect(umFromMm("2.45")).toBe(2450);
    expect(umFromMm("1,000")).toBe(1_000_000);
    expect(umFromMm("0.001")).toBe(1);
    expect(umFromMm("0.0005")).toBeNull();
    expect(umFromMm("2,5")).toBeNull();
    expect(umFromMm("")).toBeNull();
    expect(mmText(2450)).toBe("2.45");
    expect(mmText(2000)).toBe("2");
  });

  test("tenths, whole numbers and optional boxes", () => {
    expect(tenthsFrom("12.5")).toBe(125);
    expect(tenthsFrom("12.55")).toBeNull();
    expect(tenthsText(120)).toBe("12");
    expect(wholeFrom("230")).toBe(230);
    expect(wholeFrom("2.5")).toBeNull();
    expect(optional("", wholeFrom)).toEqual({ value: null, bad: false });
    expect(optional("x", wholeFrom)).toEqual({ value: null, bad: true });
    expect(optional("7", wholeFrom)).toEqual({ value: 7, bad: false });
  });

  test("dimension drafts: a wholly blank row is dropped, a half-filled one refuses the lot", () => {
    const good = { name: "Wall", nominal: "1.2", minus: "0.1", plus: "0.1", measured: "1.25" };
    const blank = { name: "", nominal: "", minus: "", plus: "", measured: "" };
    expect(dimensionsFromDrafts([good, blank])).toEqual([{ name: "Wall", nominalUm: 1200, minusUm: 100, plusUm: 100, measuredUm: 1250 }]);
    expect(dimensionsFromDrafts([{ ...good, measured: "" }])).toBeNull();
    // A plan has no measured box: it reads the nominal in its place.
    expect(dimensionsFromDrafts([{ ...good, measured: "" }], false)).toEqual([{ name: "Wall", nominalUm: 1200, minusUm: 100, plusUm: 100, measuredUm: 1200 }]);
    expect(draftsFromPlan([{ name: "Wall", nominalUm: 1200, minusUm: 100, plusUm: 50 }])).toEqual([{ name: "Wall", nominal: "1.2", minus: "0.1", plus: "0.05", measured: "" }]);
  });

  test("the server judges dimensions and mechanical tests; every other kind takes pass or fail", () => {
    expect(kindTakesResult("dimension")).toBe(false);
    expect(kindTakesResult("mechanical")).toBe(false);
    expect(kindTakesResult("first_piece")).toBe(true);
    expect(subjectsFor("incoming")).toEqual(["purchase_lot", "store_grn"]);
    expect(subjectsFor("first_piece")).toEqual(["press_run"]);
  });

  test("flags of a check row", () => {
    expect(flagNames({ flagged: ["Wall"], low: ["yield"] })).toEqual({ flagged: ["Wall"], low: ["yield"], unchecked: [] });
    expect(flagNames({ unchecked: ["hardness"] })).toEqual({ flagged: [], low: [], unchecked: ["hardness"] });
    expect(flagNames(null)).toEqual({ flagged: [], low: [], unchecked: [] });
  });
});

describe("quality screens: what a row says", () => {
  const { t } = createI18n("en");
  const say = t as unknown as (k: string, v?: Record<string, string | number>) => string;

  test("a check row lists flagged dimensions, low values by name, readings and the standard", () => {
    expect(checkDetail(say, { flags: { flagged: ["Wall", "Width"] }, values: {}, standard: null, operatorName: null, note: null })).toBe("Out of tolerance: Wall, Width");
    expect(checkDetail(say, { flags: { low: ["tensile", "yield"] }, values: {}, standard: null, operatorName: null, note: null })).toBe("Below the minimum: Tensile, Yield");
    // Review S2/S3: hardness on another scale, and a test with no temper limits.
    expect(checkDetail(say, { flags: { unchecked: ["hardness"] }, values: { tensileMpa: 90, limits: null }, standard: null, operatorName: null, note: null })).toBe(
      "Not compared (other hardness scale or no limits): Hardness; No temper limits to check against",
    );
    expect(checkDetail(say, { flags: {}, values: { readings: [{ name: "Exit", value: "520" }] }, standard: "ASTM B594", operatorName: "Ravi", note: null })).toBe("Exit: 520; Standard: ASTM B594; Operator: Ravi");
  });

  test("each waiting stage opens the check it needs", () => {
    const row = { subjectType: "purchase_lot" as const, subjectId: "l1", number: "LOT-4", station: null };
    expect(checkForStage("incoming", row)).toEqual({ kind: "incoming", subjectType: "purchase_lot", subject: { id: "l1", number: "LOT-4" } });
    expect(checkForStage("press", { ...row, subjectType: "press_run" }).kind).toBe("first_piece");
    const pack = checkForStage("pack", { ...row, subjectType: "press_run", station: { id: "s1", code: "P1", name: "Pack bay" } });
    expect(pack).toMatchObject({ kind: "clearance", stage: "pack", stationId: "s1" });
  });

  test("the press station flags a run only when there is something to say", () => {
    const calm = { firstPieceBlocksPack: false, firstPieceState: "waiting" as const, inProcessDue: { due: false, reason: null, everyBundles: null, everyMinutes: null, bundlesSince: 0 }, breaches: [] };
    expect(runNeedsFlag(calm)).toBe(false);
    expect(runNeedsFlag({ ...calm, firstPieceBlocksPack: true })).toBe(true);
    expect(runNeedsFlag({ ...calm, firstPieceBlocksPack: true, firstPieceState: "passed" })).toBe(false);
    expect(runNeedsFlag({ ...calm, firstPieceState: "failed" })).toBe(true);
    expect(runNeedsFlag({ ...calm, inProcessDue: { ...calm.inProcessDue, due: true } })).toBe(true);
    expect(runNeedsFlag({ ...calm, breaches: [{ metric: "exit_temp", direction: "high", limitX10: 5200, valueX10: 5350 }] })).toBe(true);
  });
});

describe("/qa search params", () => {
  test("keeps only known tabs, kinds, stages and lists; waiting is the default", () => {
    expect(parseQaSearch({})).toEqual({});
    expect(parseQaSearch({ tab: "waiting" })).toEqual({});
    expect(parseQaSearch({ tab: "checks", kind: "incoming", stage: "pack", run: "r1" })).toEqual({ tab: "checks", kind: "incoming", stage: "pack", run: "r1" });
    expect(parseQaSearch({ tab: "holds", log: "1" })).toEqual({ tab: "holds", log: true });
    expect(parseQaSearch({ tab: "nope", kind: "x", stage: "y", list: "z", run: "" })).toEqual({});
    expect(parseQaSearch({ tab: "lists", list: "plans" })).toEqual({ tab: "lists", list: "plans" });
  });
});
