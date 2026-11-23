import { describe, expect, test } from "bun:test";

import {
  alloyNeedsHomogenizing,
  billetCutFigures,
  castingPlan,
  homogCutAllowance,
  homogRecipeError,
  homogSoak,
  HOMOG_DEFAULT_RECIPE,
  solveLp,
  suggestChargeMix,
  type ChargeSource,
} from "./foundryDepth";

const MIN = 60_000;
const kg = (n: number) => Math.round(n * 1000);

describe("homogenizing", () => {
  test("a soak counts each reading for at most 60 minutes and passes at the recipe time", () => {
    const inAt = 0;
    // Readings every hour at 580 °C from the first hour on: 6 hours in band.
    const readings = Array.from({ length: 7 }, (_, i) => ({ at: inAt + (i + 1) * 60 * MIN, tempCX10: 5_800 }));
    const s = homogSoak({ readings, recipe: HOMOG_DEFAULT_RECIPE, inAt, outAt: inAt + 7 * 60 * MIN, now: inAt + 8 * 60 * MIN });
    expect(s.inBandMin).toBe(360);
    expect(s.homogVerdict).toBe("ok");
  });

  test("a two-hour gap leaves an hour unknown and the soak short", () => {
    const readings = [
      { at: 60 * MIN, tempCX10: 5_800 },
      { at: 300 * MIN, tempCX10: 5_800 },
    ];
    const s = homogSoak({ readings, recipe: HOMOG_DEFAULT_RECIPE, inAt: 0, outAt: 400 * MIN, now: 500 * MIN });
    expect(s.inBandMin).toBe(120);
    expect(s.homogVerdict).toBe("short");
    expect(homogSoak({ readings: [], recipe: HOMOG_DEFAULT_RECIPE, inAt: 0, outAt: 10, now: 10 }).homogVerdict).toBe("no_readings");
  });

  test("over the band past the grace is over", () => {
    const readings = Array.from({ length: 8 }, (_, i) => ({ at: (i + 1) * 60 * MIN, tempCX10: 6_100 }));
    expect(homogSoak({ readings, recipe: HOMOG_DEFAULT_RECIPE, inAt: 0, outAt: 9 * 60 * MIN, now: 0 }).homogVerdict).toBe("over");
  });

  test("recipe limits, 6xxx detection and the cut allowance", () => {
    expect(homogRecipeError(HOMOG_DEFAULT_RECIPE)).toBeNull();
    expect(homogRecipeError({ ...HOMOG_DEFAULT_RECIPE, targetTempX10: 7_000 })).toBe("temp_range");
    expect(homogRecipeError({ ...HOMOG_DEFAULT_RECIPE, toleranceX10: 5 })).toBe("band_range");
    expect(homogRecipeError({ ...HOMOG_DEFAULT_RECIPE, soakMin: 5 })).toBe("soak_range");
    expect(alloyNeedsHomogenizing("6063")).toBe(true);
    expect(alloyNeedsHomogenizing("1100")).toBe(false);
    // Fix round 1: registry prefixes name the same 6xxx alloys; other series and look-alikes do not.
    for (const code of ["AA6063", "aa-6061", "EN AW-6063", "AW 6082", "6063T5"]) expect({ code, gated: alloyNeedsHomogenizing(code) }).toEqual({ code, gated: true });
    for (const code of ["AA1100", "EN AW-5052", "HE9", "60", "A6063X", ""]) expect({ code, gated: alloyNeedsHomogenizing(code) }).toEqual({ code, gated: false });
    expect(homogCutAllowance({ required: false, alloy: "6063", source: "melt", releasedPcs: 0, cutPcs: 0 })).toBeNull();
    expect(homogCutAllowance({ required: true, alloy: "1100", source: "melt", releasedPcs: 0, cutPcs: 0 })).toBeNull();
    expect(homogCutAllowance({ required: true, alloy: "6063", source: "melt", releasedPcs: 20, cutPcs: 5 })).toBe(15);
    expect(homogCutAllowance({ required: true, alloy: "6063", source: "melt", releasedPcs: 2, cutPcs: 5 })).toBe(0);
  });
});

describe("billet cutting", () => {
  test("end cuts are log kg minus billet kg; yield in basis points", () => {
    expect(billetCutFigures({ logPcs: 4, logG: kg(1_000), billetPcs: 36, billetG: kg(970), billetLengthMm: 600 })).toEqual({ ok: true, endG: kg(30), yieldBp: 9_700 });
  });
  test("refusals", () => {
    const base = { logPcs: 4, logG: kg(1_000), billetPcs: 36, billetG: kg(970), billetLengthMm: 600 };
    expect(billetCutFigures({ ...base, logPcs: 0 })).toEqual({ ok: false, error: "no_logs" });
    expect(billetCutFigures({ ...base, billetG: 0 })).toEqual({ ok: false, error: "no_billets" });
    expect(billetCutFigures({ ...base, billetG: kg(1_001) })).toEqual({ ok: false, error: "more_out_than_in" });
    expect(billetCutFigures({ ...base, billetLengthMm: 50 })).toEqual({ ok: false, error: "length_range" });
  });
});

describe("casting plan", () => {
  test("stock and accepted lines are spent day by day per alloy; the rest is cast in furnace-sized casts", () => {
    const plan = castingPlan({
      needs: [
        { day: "2026-11-24", alloy: "6063", billetKgG: kg(4_000) },
        { day: "2026-11-23", alloy: "6063", billetKgG: kg(3_000) },
        { day: "2026-11-23", alloy: "6063", billetKgG: kg(1_000) },
        { day: "2026-11-23", alloy: "6061", billetKgG: kg(500) },
        { day: "2026-11-25", alloy: "6063", billetKgG: 0 },
      ],
      stockByAlloy: new Map([["6063", kg(2_500)]]),
      acceptedByAlloy: new Map([["6063", kg(1_000)]]),
      castSizeG: kg(3_000),
    });
    expect(plan.rows).toEqual([
      { day: "2026-11-23", alloy: "6061", needG: kg(500), coveredG: 0, castG: kg(500), casts: 1 },
      { day: "2026-11-23", alloy: "6063", needG: kg(4_000), coveredG: kg(3_500), castG: kg(500), casts: 1 },
      { day: "2026-11-24", alloy: "6063", needG: kg(4_000), coveredG: 0, castG: kg(4_000), casts: 2 },
    ]);
    expect(plan.totals.find((t) => t.alloy === "6063")).toEqual({ alloy: "6063", needG: kg(8_000), coveredG: kg(3_500), castG: kg(4_500), casts: 3 });
  });
  test("negative stock never covers a need", () => {
    const plan = castingPlan({ needs: [{ day: "2026-11-23", alloy: "6063", billetKgG: kg(100) }], stockByAlloy: new Map([["6063", -kg(50)]]), acceptedByAlloy: new Map(), castSizeG: null });
    expect(plan.rows[0]).toMatchObject({ coveredG: 0, castG: kg(100), casts: 1 });
  });
});

describe("solveLp", () => {
  test("a textbook minimum", () => {
    // min x + 2y st x + y >= 4, x <= 3 → x = 3, y = 1, value 5.
    const r = solveLp([1, 2], [
      { a: [1, 1], op: ">=", b: 4 },
      { a: [1, 0], op: "<=", b: 3 },
    ]);
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    expect(r.x[0]).toBeCloseTo(3);
    expect(r.x[1]).toBeCloseTo(1);
    expect(r.value).toBeCloseTo(5);
  });
  test("infeasible and equality rows", () => {
    expect(solveLp([1], [{ a: [1], op: "<=", b: 1 }, { a: [1], op: ">=", b: 2 }]).status).toBe("infeasible");
    const r = solveLp([3, 1], [{ a: [1, 1], op: "=", b: 1 }]);
    expect(r.status === "optimal" && r.x[1]).toBeCloseTo(1);
  });
});

describe("charge-mix suggestion", () => {
  // 6063: Si 0.20-0.60 %, Mg 0.45-0.90 %, Fe ≤ 0.35 %.
  const limits = [
    { element: "si" as const, minPpm: 2_000, maxPpm: 6_000 },
    { element: "mg" as const, minPpm: 4_500, maxPpm: 9_000 },
    { element: "fe" as const, minPpm: null, maxPpm: 3_500 },
    { element: "al" as const, minPpm: 980_000, maxPpm: null },
  ];
  const lot = (key: string, availKg: number, rate: number, ppm: ChargeSource["ppm"]): ChargeSource => ({ key, kind: "lot", label: key, availableG: kg(availKg), ratePaise: rate, ppm });

  test("picks the cheapest mix that keeps every element inside", () => {
    const r = suggestChargeMix({
      targetG: kg(1_000),
      limits,
      sources: [
        // Cheap but high iron: can only be part of the charge.
        lot("cheap-high-fe", 2_000, 15_000, { si: 4_000, mg: 5_000, fe: 6_000 }),
        lot("clean", 2_000, 20_000, { si: 4_000, mg: 6_000, fe: 1_000 }),
        { key: "stream", kind: "stream", label: "Plant scrap", availableG: kg(100), ratePaise: 0, ppm: { si: 4_500, mg: 5_000, fe: 2_000 } },
      ],
    });
    expect(r.status).toBe("ok");
    expect(r.lines.reduce((t, l) => t + l.kgG, 0)).toBe(kg(1_000));
    // The free stream is used in full; then iron caps the cheap lot.
    expect(r.lines.find((l) => l.key === "stream")!.kgG).toBe(kg(100));
    expect(r.predicted.every((p) => p.ok)).toBe(true);
    const fe = r.predicted.find((p) => p.element === "fe")!;
    expect(fe.ppm).toBeLessThanOrEqual(3_501);
    expect(fe.ppm).toBeGreaterThan(3_400);
    expect(r.predicted.some((p) => p.element === "al")).toBe(false);
  });

  test("no mix inside the limits: the closest mix, flagged with the element that is out", () => {
    const r = suggestChargeMix({ targetG: kg(500), limits, sources: [lot("lowmg", 1_000, 10_000, { si: 4_000, mg: 1_000, fe: 1_000 })] });
    expect(r.status).toBe("outside_limits");
    expect(r.lines).toEqual([{ key: "lowmg", kind: "lot", label: "lowmg", kgG: kg(500) }]);
    expect(r.predicted.find((p) => p.element === "mg")).toMatchObject({ ppm: 1_000, ok: false });
  });

  test("short metal, sources without chemistry, empty sources", () => {
    expect(suggestChargeMix({ targetG: kg(5_000), limits, sources: [lot("a", 100, 1, { si: 4_000, mg: 5_000 })] }).status).toBe("short_metal");
    const r = suggestChargeMix({ targetG: kg(100), limits, sources: [lot("nochem", 1_000, 1, null), lot("empty", 0, 1, { si: 1 })] });
    expect(r.status).toBe("no_sources");
    expect(r.skipped).toEqual([
      { key: "nochem", label: "nochem", reason: "no_chemistry" },
      { key: "empty", label: "empty", reason: "empty" },
    ]);
  });

  test("cost is Σ kg × rate", () => {
    const r = suggestChargeMix({ targetG: kg(200), limits: [], sources: [lot("a", 1_000, 18_500, {})] });
    expect(r.costPaise).toBe(200 * 18_500);
  });
});
