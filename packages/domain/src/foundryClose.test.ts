import { describe, expect, test } from "bun:test";

import {
  castCloseCheck,
  chargeCostPaise,
  FURNACE_SEED,
  ldoUsedTenthIn,
  meltBalance,
  meltLockGates,
  MELT_TIME_KEYS,
} from "./foundry";

const KG = 1000;

/**
 * W2-FD-S: the close rule (billets produced − billets the press used − billets on hand = 0, else a
 * reason code; beyond 3 % of produced, or billets short, a second person), the lock's time order and
 * "more out than in" sanity, LDO use, and the charge cost read (FP-FD-20).
 */
describe("castCloseCheck (spec E4 tail + D22 billets short)", () => {
  test("produced 2,400 kg, the press used 310.4 + 296, 1,793.6 on hand: tail 0, closes with no reason", () => {
    expect(castCloseCheck({ producedG: 2_400 * KG, onHandG: 1_793_600, creditedG: 606_400 })).toEqual({
      tailG: 0,
      tailBp: 0,
      needsApproval: false,
      needsReason: false,
      shortG: 0,
    });
  });

  test("a tail inside 3 % needs a reason code but no second person", () => {
    expect(castCloseCheck({ producedG: 10_000 * KG, onHandG: 2_000 * KG, creditedG: 7_800 * KG })).toEqual({
      tailG: 200 * KG,
      tailBp: 200,
      needsApproval: false,
      needsReason: true,
      shortG: 0,
    });
  });

  test("a tail beyond 3 % (either sign) needs a reason and an approval", () => {
    expect(castCloseCheck({ producedG: 10_000 * KG, onHandG: 2_000 * KG, creditedG: 7_690 * KG })).toMatchObject({ needsApproval: true, needsReason: true });
    expect(castCloseCheck({ producedG: 10_000 * KG, onHandG: 3_000 * KG, creditedG: 7_400 * KG })).toMatchObject({ tailG: -400 * KG, needsApproval: true });
  });

  test("billets short (the press logged more than the store held, D22): reason + approval even at a zero tail", () => {
    // 2,400 produced, the press logged 2,500: on hand −100 kg, credited 2,500 -> tail 0, short 100 kg.
    expect(castCloseCheck({ producedG: 2_400 * KG, onHandG: -100 * KG, creditedG: 2_500 * KG })).toEqual({
      tailG: 0,
      tailBp: 0,
      needsApproval: true,
      needsReason: true,
      shortG: 100 * KG,
    });
  });

  test("an empty cast closes on a zero tail", () => {
    expect(castCloseCheck({ producedG: 0, onHandG: 0, creditedG: 0 })).toEqual({ tailG: 0, tailBp: null, needsApproval: false, needsReason: false, shortG: 0 });
  });
});

describe("meltLockGates: the five times in order, and more out than in", () => {
  const balance = meltBalance({ lotsG: 5_500 * KG, streamsG: 300 * KG, logsG: 5_600 * KG, drossG: 30 * KG, feG: 10 * KG });
  const base = {
    status: "draft" as const,
    inputsG: [5_500 * KG, 300 * KG],
    logLinesG: [5_600 * KG],
    chargingStartMs: 1_000,
    castingEndMs: 5_000,
    capacityG: FURNACE_SEED.capacityG,
    balance,
    spectroVerdict: "pass" as const,
  };

  test("the sheet's order is preheat, charging start, charging end, casting start, casting end", () => {
    expect(MELT_TIME_KEYS).toEqual(["preheatStart", "chargingStart", "chargingEnd", "castingStart", "castingEnd"]);
    expect(meltLockGates({ ...base, timesMs: [500, 1_000, 2_000, 3_000, 5_000] })).toEqual([]);
    // A blank time in the middle is allowed (only charging start and casting end are required).
    expect(meltLockGates({ ...base, timesMs: [null, 1_000, null, 3_000, 5_000] })).toEqual([]);
    expect(meltLockGates({ ...base, timesMs: [500, 1_000, 4_000, 3_000, 5_000] })).toEqual(["times_out_of_order"]);
    expect(meltLockGates({ ...base, timesMs: [1_500, 1_000, 2_000, 3_000, 5_000] })).toEqual(["times_out_of_order"]);
  });

  test("more kg out than in needs a balance reason even inside 3 % (the scale or a lot is wrong)", () => {
    const neg = meltBalance({ lotsG: 1_000 * KG, streamsG: 0, logsG: 1_010 * KG, drossG: 0, feG: 0 });
    expect([neg.balanceBp, neg.needsReason, neg.negativeBurn]).toEqual([-100, false, true]);
    const gates = { ...base, inputsG: [1_000 * KG], logLinesG: [1_010 * KG], balance: neg };
    expect(meltLockGates(gates)).toEqual(["balance_reason_missing"]);
    expect(meltLockGates({ ...gates, balanceReason: "weighbridge drift" })).toEqual([]);
  });
});

describe("LDO use and charge cost", () => {
  test("LDO used is start − end in tenths of an inch; a refill (end above start) is not a use", () => {
    expect(ldoUsedTenthIn(300, 250)).toBe(50);
    expect(ldoUsedTenthIn(250, 250)).toBe(0);
    expect(ldoUsedTenthIn(250, 300)).toBeNull();
    expect(ldoUsedTenthIn(null, 250)).toBeNull();
  });

  test("cost = Σ lot kg × rate per kg (paise), rounded per line; null when any lot has no rate", () => {
    // 5,800 kg at ₹185.00/kg + 350.5 kg at ₹120.50/kg.
    expect(chargeCostPaise([{ kgG: 5_800 * KG, ratePaise: 18_500 }, { kgG: 350_500, ratePaise: 12_050 }])).toBe(5_800 * 18_500 + 4_223_525);
    expect(chargeCostPaise([{ kgG: 1_000, ratePaise: 1 }])).toBe(1);
    expect(chargeCostPaise([{ kgG: 1_499, ratePaise: 1 }])).toBe(1);
    expect(chargeCostPaise([{ kgG: 5_800 * KG, ratePaise: 18_500 }, { kgG: 10 * KG, ratePaise: null }])).toBeNull();
    expect(chargeCostPaise([])).toBe(0);
  });
});
