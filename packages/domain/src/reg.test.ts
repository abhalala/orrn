import { describe, expect, test } from "bun:test";

import {
  billetNeed,
  complaintNext,
  COMPLAINT_MOVES,
  DEFAULT_RECOVERY_BP,
  morningSummaryDue,
  morningSummaryLines,
  planGap,
  readMorningSummarySettings,
  reconcileMaterial,
  recutLossG,
  wipHeadline,
  wipStages,
} from "./reg";

describe("complaint status flow", () => {
  test("open -> investigating -> replied -> closed, and replied can go back to investigating", () => {
    expect(complaintNext("open", "investigating")).toBe(true);
    expect(complaintNext("investigating", "replied")).toBe(true);
    expect(complaintNext("replied", "closed")).toBe(true);
    expect(complaintNext("replied", "investigating")).toBe(true);
    expect(complaintNext("open", "closed")).toBe(true);
  });
  test("closed is final and nothing moves back to open", () => {
    expect(COMPLAINT_MOVES.closed).toEqual([]);
    for (const from of ["investigating", "replied", "closed"] as const) expect(complaintNext(from, "open")).toBe(false);
  });
});

describe("recutLossG", () => {
  test("cut-off part at the bundle's own kg per mm", () => {
    // 100 kg at 5,000 mm cut from 5,500 mm: 500 mm more of the same section = 10 kg.
    expect(recutLossG({ weightG: 100_000, lengthMm: 5_000, fromLengthMm: 5_500 })).toBe(10_000);
  });
  test("no loss when not shorter or a length is missing", () => {
    expect(recutLossG({ weightG: 100_000, lengthMm: 5_000, fromLengthMm: 5_000 })).toBe(0);
    expect(recutLossG({ weightG: 100_000, lengthMm: 5_000, fromLengthMm: null })).toBe(0);
    expect(recutLossG({ weightG: 100_000, lengthMm: 0, fromLengthMm: 10 })).toBe(0);
  });
});

describe("wipStages", () => {
  const base = { orderedG: 1_000_000, plannedG: 0, onPressG: 0, pressedG: 0, agedG: 0, releasedG: 0, packedG: 0, dispatchedG: 0, producedG: 0 };
  test("every kg sits in one stage and the stages add up to ordered", () => {
    const s = wipStages({ ...base, plannedG: 300_000, onPressG: 100_000, pressedG: 50_000, agedG: 150_000, releasedG: 40_000, packedG: 120_000, dispatchedG: 200_000, producedG: 320_000 });
    expect(s).toEqual({ orderedG: 1_000_000, notPlanned: 180_000, planned: 200_000, onPress: 100_000, ageing: 110_000, unpacked: 90_000, packed: 120_000, dispatched: 200_000, overG: 0 });
    const sum = s.notPlanned + s.planned + s.onPress + s.ageing + s.unpacked + s.packed + s.dispatched;
    expect(sum).toBe(s.orderedG);
  });
  test("over-produced lines show over and nothing left to plan", () => {
    const s = wipStages({ ...base, packedG: 400_000, dispatchedG: 700_000, producedG: 1_100_000 });
    expect(s.notPlanned).toBe(0);
    expect(s.overG).toBe(100_000);
  });
  test("on press never exceeds planned, released never exceeds aged", () => {
    const s = wipStages({ ...base, plannedG: 50_000, onPressG: 90_000, agedG: 10_000, releasedG: 30_000 });
    expect(s.onPress).toBe(50_000);
    expect(s.planned).toBe(0);
    expect(s.ageing).toBe(0);
    expect(s.unpacked).toBe(10_000);
  });
  test("headline is the stage nearest the customer with kg waiting", () => {
    expect(wipHeadline(wipStages({ ...base }))).toBe("notPlanned");
    expect(wipHeadline(wipStages({ ...base, plannedG: 10 }))).toBe("planned");
    expect(wipHeadline(wipStages({ ...base, plannedG: 10, packedG: 10 }))).toBe("packed");
    expect(wipHeadline(wipStages({ ...base, dispatchedG: 1_000_000, producedG: 1_000_000 }))).toBe("dispatched");
  });
});

describe("planGap", () => {
  test("short of plan is negative with the share achieved", () => {
    expect(planGap(1_000_000, 900_000)).toEqual({ gapG: -100_000, achievedBp: 9_000 });
    expect(planGap(0, 5)).toEqual({ gapG: 5, achievedBp: null });
  });
});

describe("reconcileMaterial", () => {
  test("opening + in - out + gap = closing, with each document kind named", () => {
    const r = reconcileMaterial({
      openingG: 1_000,
      closingG: 1_150,
      groups: [
        { group: "pack", role: "flow", netG: 500 },
        { group: "dispatch", role: "flow", netG: -300 },
        { group: "void", role: "adjust", netG: -50 },
        { group: "melt", role: "flow", netG: 0 },
      ],
    });
    expect(r).toMatchObject({ inG: 500, outG: 300, gapG: -50, balanced: true });
    expect(r.inBy).toEqual([{ group: "pack", g: 500 }]);
    expect(r.gapBy).toEqual([{ group: "void", g: -50 }]);
  });
  test("a mismatch is reported, never hidden", () => {
    expect(reconcileMaterial({ openingG: 0, closingG: 10, groups: [] }).balanced).toBe(false);
  });
});

describe("billetNeed", () => {
  const history = new Map([["d1", { inputG: 1_000_000, goodG: 850_000, billetLengthMm: 600, billetG: 30_000 }]]);
  test("uses the die's own recovery and its usual billet", () => {
    const { rows } = billetNeed({
      lines: [{ key: "a", sectionId: "d1", alloy: "6063", kgG: 85_000, dieReady: true }],
      history,
      plant: { inputG: 0, goodG: 0 },
      stockByAlloy: new Map([["6063", 200_000]]),
    });
    expect(rows[0]).toMatchObject({ recoveryBp: 8_500, recoverySource: "die", billetKgG: 100_000, billets: 4, billetLengthMm: 600, billetsEnough: true, ready: true, stockAfterG: 100_000 });
  });
  test("falls back to the plant, then the default, and says so", () => {
    const one = (plant: { inputG: number; goodG: number }) =>
      billetNeed({ lines: [{ key: "a", sectionId: "x", alloy: "6063", kgG: 80_000, dieReady: true }], history, plant, stockByAlloy: new Map() }).rows[0]!;
    expect(one({ inputG: 100, goodG: 80 })).toMatchObject({ recoverySource: "plant", recoveryBp: 8_000, billets: null });
    expect(one({ inputG: 0, goodG: 0 })).toMatchObject({ recoverySource: "default", recoveryBp: DEFAULT_RECOVERY_BP, billetKgG: 100_000 });
  });
  test("billets enough is cumulative down the plan per alloy", () => {
    const { rows, totals } = billetNeed({
      lines: [
        { key: "a", sectionId: "d1", alloy: "6063", kgG: 85_000, dieReady: true },
        { key: "b", sectionId: "d1", alloy: "6063", kgG: 85_000, dieReady: true },
        { key: "c", sectionId: "d1", alloy: "6061", kgG: 8_500, dieReady: false },
        { key: "d", sectionId: "d1", alloy: null, kgG: 1, dieReady: true },
      ],
      history,
      plant: { inputG: 0, goodG: 0 },
      stockByAlloy: new Map([["6063", 150_000], ["6061", 50_000]]),
    });
    expect(rows.map((r) => r.billetsEnough)).toEqual([true, false, true, false]);
    expect(rows.map((r) => r.ready)).toEqual([true, false, false, false]);
    expect(totals.find((t) => t.alloy === "6063")).toMatchObject({ billetKgG: 200_000, billets: 8, stockG: 150_000 });
  });
});

describe("morning summary", () => {
  test("settings default to off at 07:00 and refuse a bad hour", () => {
    expect(readMorningSummarySettings(undefined)).toEqual({ enabled: false, hour: 7 });
    expect(readMorningSummarySettings({ enabled: true, hour: 24 })).toEqual({ enabled: true, hour: 7 });
    expect(readMorningSummarySettings({ enabled: true, hour: 6 })).toEqual({ enabled: true, hour: 6 });
  });
  test("due only when on and in the chosen hour", () => {
    expect(morningSummaryDue({ enabled: true, hour: 6 }, 6)).toBe(true);
    expect(morningSummaryDue({ enabled: true, hour: 6 }, 7)).toBe(false);
    expect(morningSummaryDue({ enabled: false, hour: 6 }, 6)).toBe(false);
  });
  test("the mail carries every figure and no rupee", () => {
    const lines = morningSummaryLines("Plant", {
      day: "2026-11-21",
      pressedG: 1_234_500,
      inputG: 1_500_000,
      recoveryBp: 8_230,
      runs: 3,
      trialG: 0,
      downtime: [{ reason: "Die change", minutes: 40 }],
      downtimeMinutes: 40,
      dispatches: 2,
      dispatchedG: 900_000,
      openLines: 5,
      bakiG: 4_000_000,
      failedCasts: [{ number: "K31", alloy: "6063" }],
    });
    const text = lines.join("\n");
    expect(text).toContain("1,234.5 kg in 3 runs, recovery 82.3 %");
    expect(text).toContain("Die change 40 min");
    expect(text).toContain("900.0 kg on 2 loads");
    expect(text).toContain("4,000.0 kg on 5 order lines");
    expect(text).toContain("K31 (6063)");
    expect(text).not.toMatch(/₹|Rs\.?|paise/);
  });
});
