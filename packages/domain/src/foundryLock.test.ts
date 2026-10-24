import { describe, expect, test } from "bun:test";

import {
  ALLOY_LIMIT_SEEDS,
  FURNACE_SEED,
  SpectroRefusal,
  castTail,
  furnaceLoad,
  meltBalance,
  meltLockGates,
  percentToPpm,
  spectroCheck,
  spectroVerdict,
  type SpectroPpm,
} from "./foundry";
import { bpPercent1 } from "./pressRun";

const KG = 1000;

describe("meltBalance, lock shape (spec E4)", () => {
  test("demo: 6,150 in, 5,974 out -> burn 176 kg, 2.86 % shown 2.9 %, yield 95.3 %", () => {
    // In: lots 5,800 + streams 350. Out: logs 5,861 + dross 95 + Fe 18 = 5,974.
    const b = meltBalance({ lotsG: 5_800 * KG, streamsG: 350 * KG, logsG: 5_861 * KG, drossG: 95 * KG, feG: 18 * KG });
    expect(b).toEqual({ metalInG: 6_150 * KG, burnG: 176 * KG, balanceBp: 286, yieldBp: 9530, needsReason: false, negativeBurn: false });
    expect(bpPercent1(b.balanceBp!)).toBe("2.9");
    expect(bpPercent1(b.yieldBp!)).toBe("95.3");
  });

  test("|balance| above 3 % needs a reason; negative burn flags too", () => {
    expect(meltBalance({ lotsG: 1_000 * KG, streamsG: 0, logsG: 960 * KG, drossG: 9 * KG, feG: 0 }).needsReason).toBe(true); // 3.1 %
    expect(meltBalance({ lotsG: 1_000 * KG, streamsG: 0, logsG: 960 * KG, drossG: 10 * KG, feG: 0 }).needsReason).toBe(false); // 3.0 %
    const neg = meltBalance({ lotsG: 1_000 * KG, streamsG: 0, logsG: 1_040 * KG, drossG: 0, feG: 0 });
    expect([neg.burnG, neg.balanceBp, neg.needsReason, neg.negativeBurn]).toEqual([-40 * KG, -400, true, true]);
  });

  test("returned charge streams count as output", () => {
    expect(meltBalance({ lotsG: 1_000 * KG, streamsG: 0, logsG: 950 * KG, drossG: 10 * KG, feG: 0, returnsG: 20 * KG }).burnG).toBe(20 * KG);
  });

  test("metal in 0: no bp (the lock refuses)", () => {
    expect(meltBalance({ lotsG: 0, streamsG: 0, logsG: 0, drossG: 0, feG: 0 })).toMatchObject({ metalInG: 0, balanceBp: null, yieldBp: null });
  });

  test("the PL5 shape still answers the PL5 way", () => {
    expect(meltBalance({ inputG: 10_000 * KG, outputG: 9_800 * KG }).lossBp).toBe(200);
  });
});

describe("castTail, close shape (spec E4)", () => {
  test("tail = produced - on hand - credited; within 3 % closes without approval", () => {
    expect(castTail({ producedG: 10_000 * KG, onHandG: 2_000 * KG, creditedG: 7_800 * KG })).toEqual({ tailG: 200 * KG, tailBp: 200, needsApproval: false });
    expect(castTail({ producedG: 10_000 * KG, onHandG: 2_000 * KG, creditedG: 7_700 * KG })).toEqual({ tailG: 300 * KG, tailBp: 300, needsApproval: false });
  });

  test("above 3 % (either way) needs tail_reason + cast_close approval", () => {
    expect(castTail({ producedG: 10_000 * KG, onHandG: 2_000 * KG, creditedG: 7_690 * KG }).needsApproval).toBe(true);
    expect(castTail({ producedG: 10_000 * KG, onHandG: 3_000 * KG, creditedG: 7_400 * KG })).toEqual({ tailG: -400 * KG, tailBp: -400, needsApproval: true });
    expect(castTail({ producedG: 0, onHandG: 0, creditedG: 0 })).toEqual({ tailG: 0, tailBp: null, needsApproval: false });
  });
});

describe("spectroVerdict (spec E4, FP-FD-10)", () => {
  const good6063: SpectroPpm = { si: 4_500, fe: 2_000, cu: 300, mn: 200, mg: 5_500, zn: 100, ti: 150, cr: 50 };
  const limits = ALLOY_LIMIT_SEEDS["6063"];

  test("all eight inside limits: pass; Al is the balance", () => {
    const c = spectroCheck(good6063, limits);
    expect(c.verdict).toBe("pass");
    expect(c.sumEightPpm).toBe(12_800);
    expect([c.alPpm, c.alSource]).toEqual([987_200, "balance"]);
    expect(c.readings.al).toBe("no_limit");
  });

  test("one element out: fail, even with others missing", () => {
    expect(spectroVerdict({ ...good6063, mg: 4_000 }, limits)).toBe("fail");
    expect(spectroVerdict({ si: 9_000 }, limits)).toBe("fail");
  });

  test("a missing element: incomplete; Al not derived", () => {
    const { mg: _mg, ...seven } = good6063;
    const c = spectroCheck(seven, limits);
    expect([c.verdict, c.alPpm, c.alSource, c.readings.mg]).toEqual(["incomplete", null, null, "missing"]);
  });

  test("measured Al is kept and checked when it has a limit", () => {
    const c = spectroCheck({ ...good6063, al: 980_000 }, [...limits, { element: "al", minPpm: 985_000, maxPpm: null }]);
    expect([c.alPpm, c.alSource, c.verdict]).toEqual([980_000, "measured", "fail"]);
  });

  test("an element without a limit reads no_limit and never fails", () => {
    const c = spectroCheck(good6063, limits.filter((l) => l.element !== "zn"));
    expect([c.readings.zn, c.verdict]).toEqual(["no_limit", "pass"]);
  });

  test("Σ eight above 1,000,000 ppm is refused; non-integer ppm is refused", () => {
    const over: SpectroPpm = { si: 200_000, fe: 200_000, cu: 200_000, mn: 200_000, mg: 200_000, zn: 1, ti: 0, cr: 0 };
    expect(() => spectroVerdict(over, limits)).toThrow(SpectroRefusal);
    try {
      spectroVerdict(over, limits);
    } catch (e) {
      expect((e as SpectroRefusal).code).toBe("over_million");
    }
    expect(() => spectroVerdict({ si: 45.5 }, limits)).toThrow(SpectroRefusal);
    // Exactly 1,000,000 is allowed (Al balance 0).
    expect(spectroCheck({ si: 500_000, fe: 500_000, cu: 0, mn: 0, mg: 0, zn: 0, ti: 0, cr: 0 }, []).alPpm).toBe(0);
  });

  test("seeds: 6063 and 6061 limits from the spec, ppm", () => {
    const mg6063 = ALLOY_LIMIT_SEEDS["6063"].find((l) => l.element === "mg");
    const cr6061 = ALLOY_LIMIT_SEEDS["6061"].find((l) => l.element === "cr");
    expect(mg6063).toEqual({ element: "mg", minPpm: 4_500, maxPpm: 9_000 });
    expect(cr6061).toEqual({ element: "cr", minPpm: 400, maxPpm: 3_500 });
    expect(ALLOY_LIMIT_SEEDS["6063"]).toHaveLength(8);
    expect(ALLOY_LIMIT_SEEDS["6061"]).toHaveLength(8);
  });

  test("percent text to ppm", () => {
    expect(percentToPpm("0.45")).toBe(4_500);
    expect(percentToPpm("1.2")).toBe(12_000);
    expect(percentToPpm("0.0035")).toBe(35);
    expect(percentToPpm("")).toBeNull();
    expect(percentToPpm("0.00001")).toBeNull();
    expect(percentToPpm("-1")).toBeNull();
  });
});

describe("furnace load and the lock gate", () => {
  test("F1 6 t: over refuses, above 95 % is near", () => {
    expect(FURNACE_SEED.capacityG).toBe(6_000_000);
    expect(furnaceLoad(6_150 * KG, FURNACE_SEED.capacityG)).toBe("over");
    expect(furnaceLoad(5_800 * KG, FURNACE_SEED.capacityG)).toBe("near");
    expect(furnaceLoad(5_700 * KG, FURNACE_SEED.capacityG)).toBe("ok");
    expect(furnaceLoad(6_000 * KG, FURNACE_SEED.capacityG)).toBe("near");
  });

  const balance = meltBalance({ lotsG: 5_500 * KG, streamsG: 300 * KG, logsG: 5_600 * KG, drossG: 30 * KG, feG: 10 * KG });
  const base = {
    status: "draft" as const,
    inputsG: [5_500 * KG, 300 * KG],
    logLinesG: [5_600 * KG],
    chargingStartMs: 1_000,
    castingEndMs: 2_000,
    capacityG: FURNACE_SEED.capacityG,
    balance,
    spectroVerdict: "pass" as const,
  };

  test("a complete draft locks", () => {
    expect(meltLockGates(base)).toEqual([]);
  });

  test("no spectro pass needs a reason; times; capacity; draft only", () => {
    expect(meltLockGates({ ...base, spectroVerdict: null })).toEqual(["spectro_reason_missing"]);
    expect(meltLockGates({ ...base, spectroVerdict: "fail", spectroReason: "retest booked" })).toEqual([]);
    expect(meltLockGates({ ...base, castingEndMs: 500 })).toEqual(["casting_before_charging"]);
    expect(meltLockGates({ ...base, chargingStartMs: null })).toEqual(["no_charging_start"]);
    expect(meltLockGates({ ...base, capacityG: 5_000_000 })).toEqual(["over_capacity"]);
    expect(meltLockGates({ ...base, status: "locked" })).toEqual(["not_draft"]);
    expect(meltLockGates({ ...base, logLinesG: [] })).toEqual(["no_logs"]);
    expect(meltLockGates({ ...base, alloyDiffersFromCast: true })).toEqual(["alloy_reason_missing"]);
  });

  test("balance above 3 % needs balance_reason", () => {
    const off = meltBalance({ lotsG: 1_000 * KG, streamsG: 0, logsG: 900 * KG, drossG: 0, feG: 0 });
    expect(meltLockGates({ ...base, inputsG: [1_000 * KG], logLinesG: [900 * KG], balance: off })).toEqual(["balance_reason_missing"]);
    expect(meltLockGates({ ...base, inputsG: [1_000 * KG], logLinesG: [900 * KG], balance: off, balanceReason: "spill at tap" })).toEqual([]);
  });
});
