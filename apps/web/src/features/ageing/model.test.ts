import { describe, expect, test } from "bun:test";

import {
  batchByOven,
  batchByTrolley,
  canDiscardRow,
  canHoldRow,
  canLoad,
  canRequestOverride,
  canRework,
  gasFromText,
  gasText,
  hardnessReadings,
  lineFitsRecipe,
  lineKgG,
  loadTotals,
  minutesParts,
  nextAction,
  nextActionPermission,
  phaseTone,
  pickOf,
  pressRowsOf,
  previewMedianX10,
  rowsToTest,
  soakProgress,
  sparkline,
  stageIndex,
  voidPermission,
  wholeFromText,
  x10FromText,
  x10Text,
} from "./model";

const row = (o: Partial<Parameters<typeof canHoldRow>[1]> = {}) =>
  ({ id: "r", status: "pending", source: "press", packedPcs: 0, scrapPcs: 0, reworkPcs: 0, remainingPcs: 10, pcs: 10, hardnessReadingX10: null, hardnessPass: null, ...o }) as Parameters<typeof canHoldRow>[1];

describe("typed numbers", () => {
  test("temperature and hardness are x10 integers with one decimal at most", () => {
    expect(x10Text(1850)).toBe("185.0");
    expect(x10Text(null)).toBe("-");
    expect(x10FromText("185")).toBe(1850);
    expect(x10FromText("10.5")).toBe(105);
    expect(x10FromText("10.55")).toBeNull();
    expect(x10FromText("")).toBeNull();
    expect(x10FromText("abc")).toBeNull();
  });

  test("the gas meter is thousandths", () => {
    expect(gasText(1209350)).toBe("1209.350");
    expect(gasFromText("1500.5")).toBe(1500500);
    expect(gasFromText("1500.5555")).toBeNull();
    expect(gasFromText("")).toBeNull();
  });

  test("whole numbers and minutes", () => {
    expect(wholeFromText("12")).toBe(12);
    expect(wholeFromText("1.5")).toBeNull();
    expect(wholeFromText("")).toBeNull();
    expect(minutesParts(245)).toEqual({ h: 4, m: 5 });
    expect(minutesParts(45)).toEqual({ h: 0, m: 45 });
  });
});

describe("the stage stepper and the one action", () => {
  const withRows = (status: Parameters<typeof nextAction>[0]["status"], rows: ReturnType<typeof row>[], overrideApprovalId: string | null = null) => ({ status, rows, overrideApprovalId });

  test("loading starts, in the oven takes out, out tests then releases", () => {
    expect(nextAction(withRows("loading", [row()]))).toBe("start");
    expect(nextAction(withRows("loading", []))).toBe("none");
    expect(nextAction(withRows("in_oven", [row()]))).toBe("takeOut");
    expect(nextAction(withRows("out", [row()]))).toBe("hardness");
    expect(nextAction(withRows("out", [row({ hardnessReadingX10: 105, hardnessPass: true })]))).toBe("release");
    expect(nextAction(withRows("released", [row({ status: "released" })]))).toBe("none");
    expect(nextAction(withRows("closed", []))).toBe("none");
  });

  test("a held batch releases again only after an approval", () => {
    expect(nextAction(withRows("held", [row({ status: "held" })]))).toBe("none");
    expect(nextAction(withRows("held", [row({ status: "held" })], "ap-1"))).toBe("release");
  });

  test("each action is somebody's permission", () => {
    expect(nextActionPermission("start")).toBe("ageing.load");
    expect(nextActionPermission("takeOut")).toBe("ageing.load");
    expect(nextActionPermission("hardness")).toBe("ageing.record");
    expect(nextActionPermission("release")).toBe("ageing.release");
    expect(nextActionPermission("none")).toBeNull();
  });

  test("the stepper stands where the batch stands", () => {
    expect(stageIndex({ status: "loading", rows: [] })).toBe(0);
    expect(stageIndex({ status: "in_oven", rows: [] })).toBe(1);
    expect(stageIndex({ status: "out", rows: [row()] })).toBe(2);
    expect(stageIndex({ status: "out", rows: [row({ hardnessReadingX10: 100 })] })).toBe(3);
    expect(stageIndex({ status: "held", rows: [] })).toBe(4);
    expect(stageIndex({ status: "closed", rows: [] })).toBe(4);
  });

  test("rows to test are the pending ones with no hardness yet", () => {
    expect(rowsToTest({ rows: [row(), row({ hardnessReadingX10: 100 }), row({ status: "released" })] })).toHaveLength(1);
  });
});

describe("what a person may do to a line or a batch", () => {
  test("hold needs a judged batch and a line nobody packed from", () => {
    expect(canHoldRow({ status: "out" }, row())).toBe(true);
    expect(canHoldRow({ status: "released" }, row({ status: "released" }))).toBe(true);
    expect(canHoldRow({ status: "in_oven" }, row())).toBe(false);
    expect(canHoldRow({ status: "released" }, row({ status: "released", packedPcs: 2 }))).toBe(false);
    expect(canHoldRow({ status: "released" }, row({ status: "released", source: "bundle" }))).toBe(false);
  });

  test("discard and rework need a judged line with pieces left", () => {
    expect(canDiscardRow({ status: "held" }, row({ status: "held" }))).toBe(true);
    expect(canDiscardRow({ status: "held" }, row({ status: "held", remainingPcs: 0 }))).toBe(false);
    expect(canRework({ status: "held", rows: [row({ status: "held" })], successorBatchId: null })).toBe(true);
    expect(canRework({ status: "held", rows: [row({ status: "held" })], successorBatchId: "s" })).toBe(false);
    expect(canRework({ status: "released", rows: [row({ status: "released" })], successorBatchId: null })).toBe(false);
  });

  test("an approval is asked once, and only for a batch with a held line", () => {
    expect(canRequestOverride({ status: "held", overrideApprovalId: null, pendingOverrideId: null }, true)).toBe(true);
    expect(canRequestOverride({ status: "held", overrideApprovalId: null, pendingOverrideId: "p" }, true)).toBe(false);
    expect(canRequestOverride({ status: "held", overrideApprovalId: "a", pendingOverrideId: null }, true)).toBe(false);
    expect(canRequestOverride({ status: "held", overrideApprovalId: null, pendingOverrideId: null }, false)).toBe(false);
  });

  test("void is the loader's while loading and the supervisor's after take-out", () => {
    expect(voidPermission({ status: "loading" })).toBe("ageing.load");
    // Undoing a rework (a successor still loading) is the supervisor's.
    expect(voidPermission({ status: "loading", reworkOfBatchId: "b0" })).toBe("ageing.release");
    expect(voidPermission({ status: "out" })).toBe("ageing.release");
    expect(voidPermission({ status: "in_oven" })).toBeNull();
    expect(voidPermission({ status: "closed" })).toBeNull();
  });
});

describe("status colours", () => {
  test("amber in the oven, blue out, green released, red held", () => {
    expect(phaseTone("heating")).toBe("amber");
    expect(phaseTone("soaking")).toBe("amber");
    expect(phaseTone("out")).toBe("blue");
    expect(phaseTone("released")).toBe("green");
    expect(phaseTone("held")).toBe("red");
    expect(phaseTone("closed")).toBe("neutral");
  });
});

describe("the board", () => {
  const batches = [
    { id: "b1", status: "in_oven" as const, ovenId: "o1", trolleyId: "t1" },
    { id: "b2", status: "out" as const, ovenId: "o1", trolleyId: "t2" },
    { id: "b3", status: "closed" as const, ovenId: "o1", trolleyId: "t3" },
    { id: "b4", status: "loading" as const, ovenId: null, trolleyId: "t4" },
  ];
  test("an oven holds only the batch that is in it", () => {
    expect(batchByOven(batches).get("o1")?.id).toBe("b1");
  });
  test("a trolley carries any batch that is not closed or void", () => {
    const m = batchByTrolley(batches);
    expect([...m.keys()].sort()).toEqual(["t1", "t2", "t4"]);
  });
  test("the soak timer reads minutes against the recipe", () => {
    expect(soakProgress(null, 240, 1000)).toBeNull();
    expect(soakProgress(0, 240, 120 * 60_000)).toEqual({ elapsedMin: 120, ratio: 0.5 });
    expect(soakProgress(0, 240, 999 * 60_000)?.ratio).toBe(1);
  });
});

describe("the temperature line", () => {
  test("scales into the box with the band, newest on the right", () => {
    const readings = [
      { at: 0, tempCX10: 350 },
      { at: 60_000, tempCX10: 1850 },
      { at: 120_000, tempCX10: 1840 },
    ];
    const s = sparkline(readings, { width: 240, height: 56 }, { lowX10: 1750, highX10: 1950 })!;
    expect(s.points.split(" ")).toHaveLength(3);
    expect(s.band).not.toBeNull();
    expect(s.minX10).toBe(350);
    expect(s.maxX10).toBe(1950);
    expect(s.last!.x).toBeGreaterThan(200);
  });
  test("nothing logged draws nothing", () => {
    expect(sparkline([], { width: 100, height: 40 }, null)).toBeNull();
  });
  test("long logs are thinned, always ending on the last reading", () => {
    const readings = Array.from({ length: 500 }, (_, i) => ({ at: i * 60_000, tempCX10: 1800 + (i % 10) }));
    const s = sparkline(readings, { width: 240, height: 56 }, null, 100)!;
    expect(s.points.split(" ").length).toBeLessThanOrEqual(101);
    expect(s.last!.x).toBeGreaterThan(236);
  });
});

describe("the load picker", () => {
  const lines = [
    { pressRunLineId: "a", pcsLeft: 40, kgLeftG: 117_100 },
    { pressRunLineId: "b", pcsLeft: 10, kgLeftG: 29_275 },
  ];
  test("kg follow the pieces, the last pieces take what is left", () => {
    expect(lineKgG(lines[0]!, 10)).toBe(29_275);
    expect(lineKgG(lines[0]!, 40)).toBe(117_100);
    expect(lineKgG(lines[0]!, 0)).toBe(0);
  });
  test("a pick over the line is the problem, blank is nothing", () => {
    expect(pickOf("41", lines[0]!)).toEqual({ pcs: 41, error: "over" });
    expect(pickOf("x", lines[0]!)).toEqual({ pcs: 0, error: "invalid" });
    expect(pickOf("", lines[0]!)).toEqual({ pcs: 0, error: null });
    expect(pickOf(undefined, lines[0]!)).toEqual({ pcs: 0, error: null });
    expect(pickOf("40", lines[0]!)).toEqual({ pcs: 40, error: null });
  });
  test("totals count picked lines and bundles; a bad pick blocks", () => {
    const t = loadTotals(lines, { a: "10", b: "10" }, [{ pcs: 24, weightG: 48_000 }]);
    expect(t).toEqual({ lines: 3, pcs: 44, kgG: 29_275 + 29_275 + 48_000, problems: 0 });
    expect(canLoad(t, "t1")).toBe(true);
    expect(canLoad(t, null)).toBe(false);
    const bad = loadTotals(lines, { a: "99" }, []);
    expect(bad.problems).toBe(1);
    expect(canLoad(bad, "t1")).toBe(false);
    expect(canLoad(loadTotals(lines, {}, []), "t1")).toBe(false);
  });
  test("the request carries pieces only for good picks", () => {
    expect(pressRowsOf(lines, { a: "10", b: "11" })).toEqual([{ pressRunLineId: "a", pcs: 10 }]);
  });
  test("a recipe fits a line of its alloy and temper; unknown does not block (the server decides)", () => {
    const recipe = { alloy: "6063", temper: "T6" };
    expect(lineFitsRecipe({ alloy: "6063", temper: "T6" }, recipe)).toBe(true);
    expect(lineFitsRecipe({ alloy: "6063", temper: "T5" }, recipe)).toBe(false);
    expect(lineFitsRecipe({ alloy: "6061", temper: null }, recipe)).toBe(false);
    expect(lineFitsRecipe({ alloy: null, temper: null }, recipe)).toBe(true);
    expect(lineFitsRecipe({ alloy: "6063", temper: "T5" }, null)).toBe(true);
  });
});

describe("hardness entry", () => {
  test("blank fields are not samples; a bad one spoils the entry", () => {
    expect(hardnessReadings(["10", "10.5", ""])).toEqual([100, 105]);
    expect(hardnessReadings(["", "", ""])).toBeNull();
    expect(hardnessReadings(["10", "x"])).toBeNull();
  });
  test("the preview median is the middle one (mean of two, rounded up)", () => {
    expect(previewMedianX10([100, 105, 110])).toBe(105);
    expect(previewMedianX10([100, 105])).toBe(103);
    expect(previewMedianX10([])).toBeNull();
  });
});
