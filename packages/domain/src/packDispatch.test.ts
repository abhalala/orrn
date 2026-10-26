import { describe, expect, test } from "bun:test";

import {
  BUNDLE_NUMBER_POLICIES,
  CAPACITY_NEAR_BP,
  capacityCheck,
  diffPackingListRevisions,
  formatPartyBundleNo,
  partyBundlePeriod,
  scaleStable,
  profileKindSummary,
  sortPackingListRows,
  weightNeedsReason,
} from "./packDispatch";

describe("party bundle numbers (FP-PK-07, C25)", () => {
  test("policies", () => {
    expect([...BUNDLE_NUMBER_POLICIES]).toEqual(["monthly", "fy", "lifelong"]);
  });

  test("monthly: plant format from the party's own counter; resets on the 1st (1 Nov rollover)", () => {
    expect(partyBundlePeriod("monthly", { year: 2026, month: 10 })).toBe("2026-10");
    expect(partyBundlePeriod("monthly", { year: 2026, month: 11 })).toBe("2026-11");
    expect(formatPartyBundleNo("monthly", "2026-10", 12)).toBe("26J12");
    expect(formatPartyBundleNo("monthly", "2026-11", 1)).toBe("26K1");
  });

  test("fy: resets 1 April (31 Mar 2027 is still 2026-27; 1 Apr 2027 is 2027-28)", () => {
    expect(partyBundlePeriod("fy", { year: 2027, month: 3 })).toBe("2026-27");
    expect(partyBundlePeriod("fy", { year: 2027, month: 4 })).toBe("2027-28");
    expect(formatPartyBundleNo("fy", "2026-27", 12)).toBe("2026-27/12");
  });

  test("lifelong: one period, unpadded seq", () => {
    expect(partyBundlePeriod("lifelong", { year: 2026, month: 10 })).toBe("life");
    expect(partyBundlePeriod("lifelong", { year: 2031, month: 1 })).toBe("life");
    expect(formatPartyBundleNo("lifelong", "life", 4086)).toBe("4086");
  });

  test("bad sequence is refused", () => {
    expect(() => formatPartyBundleNo("lifelong", "life", 0)).toThrow();
  });
});

describe("vehicle capacity (FP-PK-12: warn only; complete over capacity needs a reason)", () => {
  test("no capacity set: nothing to say", () => {
    expect(capacityCheck({ loadedG: 5_000_000, capacityG: null })).toEqual({ state: "none", fillBp: null, overG: 0, needsReason: false });
  });

  test("2,000 kg truck: 1,950 kg is near (>= 95 %), 2,000 is ok-near, 2,000.001 is over", () => {
    expect(CAPACITY_NEAR_BP).toBe(9_500);
    expect(capacityCheck({ loadedG: 1_000_000, capacityG: 2_000_000 })).toEqual({ state: "ok", fillBp: 5_000, overG: 0, needsReason: false });
    expect(capacityCheck({ loadedG: 1_950_000, capacityG: 2_000_000 })).toEqual({ state: "near", fillBp: 9_750, overG: 0, needsReason: false });
    expect(capacityCheck({ loadedG: 2_000_000, capacityG: 2_000_000 }).state).toBe("near");
    expect(capacityCheck({ loadedG: 2_000_001, capacityG: 2_000_000 })).toEqual({ state: "over", fillBp: 10_000, overG: 1, needsReason: true });
  });

  test("adding a bundle is checked after the add", () => {
    expect(capacityCheck({ loadedG: 1_900_000, capacityG: 2_000_000, addG: 143_200 }).state).toBe("over");
  });
});

describe("typed weight (FP-PK-02)", () => {
  test("a reason is needed only when a scale node is configured and the weight was typed", () => {
    expect(weightNeedsReason({ weightSource: "manual", scaleConfigured: true })).toBe(true);
    expect(weightNeedsReason({ weightSource: "manual", scaleConfigured: false })).toBe(false);
    expect(weightNeedsReason({ weightSource: "scale", scaleConfigured: true })).toBe(false);
  });
});

describe("scale stability (Q-PK-3: 5 frames within 20 g, held 1 s, stale after 3 s, 0 is not a weight)", () => {
  const frames = (grams: number[], start = 0, step = 250) => grams.map((g, i) => ({ grams: g, at: start + i * step }));
  test("steady frames held a second are stable", () => {
    expect(scaleStable(frames([143_200, 143_210, 143_205, 143_200, 143_215]), 1_000)).toBe(true);
  });
  test("spread over 20 g, too few frames, too short a hold, stale or zero: not stable", () => {
    expect(scaleStable(frames([143_200, 143_230, 143_205, 143_200, 143_215]), 1_000)).toBe(false);
    expect(scaleStable(frames([143_200, 143_200, 143_200, 143_200]), 1_000)).toBe(false);
    expect(scaleStable(frames([143_200, 143_200, 143_200, 143_200, 143_200], 0, 100), 400)).toBe(false);
    expect(scaleStable(frames([143_200, 143_200, 143_200, 143_200, 143_200]), 4_100)).toBe(false);
    expect(scaleStable(frames([0, 0, 0, 0, 0]), 1_000)).toBe(false);
  });
});

describe("packing list v2 order and summary (FP-PK-13)", () => {
  test("section, then length, then party number (natural order)", () => {
    const rows = sortPackingListRows([
      { sectionCode: "4521", lengthMm: 3_658, partyNo: "26J10" },
      { sectionCode: "12170", lengthMm: 4_267, partyNo: "26J2" },
      { sectionCode: "12170", lengthMm: 3_658, partyNo: "26J10" },
      { sectionCode: "12170", lengthMm: 3_658, partyNo: "26J9" },
    ]);
    expect(rows.map((r) => `${r.sectionCode}/${r.lengthMm}/${r.partyNo}`)).toEqual([
      "4521/3658/26J10",
      "12170/3658/26J9",
      "12170/3658/26J10",
      "12170/4267/26J2",
    ]);
  });

  test("summary by profile kind omits zero kinds; null profile counts as solid", () => {
    expect(
      profileKindSummary([
        { profileKind: "hollow", weightG: 1_000, pcs: 10 },
        { profileKind: null, weightG: 500, pcs: 5 },
        { profileKind: "solid", weightG: 250, pcs: 2 },
      ]),
    ).toEqual([
      { kind: "hollow", bundles: 1, weightG: 1_000, pcs: 10 },
      { kind: "solid", bundles: 2, weightG: 750, pcs: 7 },
    ]);
  });
});

describe("packing list revision diff (C24: regenerate = new revision, same number)", () => {
  const prev = [
    { bundleId: "a", serial: "26J1", weightG: 100_000, pcs: 10, lengthMm: 3_658, partyNo: "26J1" },
    { bundleId: "b", serial: "26J2", weightG: 120_000, pcs: 12, lengthMm: 3_658, partyNo: "26J2" },
  ];

  test("added, removed and changed bundles, and the kg moved", () => {
    const next = [
      { bundleId: "a", serial: "26J1", weightG: 101_000, pcs: 10, lengthMm: 3_658, partyNo: "26J1" },
      { bundleId: "c", serial: "26J3", weightG: 90_000, pcs: 9, lengthMm: 3_658, partyNo: "26J3" },
    ];
    expect(diffPackingListRevisions(prev, next)).toEqual({
      added: ["26J3"],
      removed: ["26J2"],
      changed: [{ serial: "26J1", fields: ["weightG"] }],
      unchanged: 0,
      weightDeltaG: 101_000 + 90_000 - 220_000,
      same: false,
    });
  });

  test("an identical rebuild says so", () => {
    expect(diffPackingListRevisions(prev, prev)).toEqual({ added: [], removed: [], changed: [], unchanged: 2, weightDeltaG: 0, same: true });
  });
});

describe("dispatch weight check against the order line (Q36)", () => {
  test("0.1 kg/12ft either way is fine; past it is off; unknown figures never warn", async () => {
    const { bundleKgPer12ftMilli, offLineBand, DISPATCH_LINE_BAND_MILLI } = await import("./packDispatch");
    expect(DISPATCH_LINE_BAND_MILLI).toBe(100);
    expect(offLineBand(2_600, 2_500)).toEqual({ off: false, diffMilli: 100 });
    expect(offLineBand(2_401, 2_500)).toEqual({ off: false, diffMilli: -99 });
    expect(offLineBand(2_601, 2_500)).toEqual({ off: true, diffMilli: 101 });
    expect(offLineBand(2_399, 2_500)).toEqual({ off: true, diffMilli: -101 });
    expect(offLineBand(null, 2_500)).toBeNull();
    expect(offLineBand(2_500, null)).toBeNull();
    // 25.2 kg over 10 pieces of 12 ft is 2.520 kg/12ft.
    expect(bundleKgPer12ftMilli({ weightG: 25_200, pieces: 10, lengthMm: 3657.6 })).toBe(2_520);
    expect(bundleKgPer12ftMilli({ weightG: 25_200, pieces: 0, lengthMm: 3657.6 })).toBeNull();
  });
});
