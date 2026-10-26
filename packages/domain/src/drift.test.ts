import { describe, expect, test } from "bun:test";

import {
  DRIFT_AMBER_MAX_BP,
  DRIFT_GREEN_MAX_BP,
  bandPosition,
  driftBp,
  driftPercentText,
  driftPercentTenths,
  driftTone,
  kgPerMetre,
  kgPerMetreToG12ft,
  recoveryTone,
  suggestFirstCopy,
} from "./drift";

describe("driftPercentTenths (FP-DR-06: (latest - band start) / band start, tenths of a %, half up)", () => {
  test("spec examples", () => {
    expect(driftPercentTenths(10_333, 10_000)).toBe(33); // +3.3 %
    expect(driftPercentTenths(12_502, 12_000)).toBe(42); // +4.2 %
    expect(driftPercentTenths(5_967, 5_900)).toBe(11); // +1.1 %
    expect(driftPercentTenths(6_480, 5_900)).toBe(98); // +9.8 %
  });

  test("half rounds up; below the band start is negative", () => {
    expect(driftPercentTenths(10_005, 10_000)).toBe(1); // 0.05 % is half a tenth: up to 0.1 %
    expect(driftPercentTenths(10_004, 10_000)).toBe(0); // 0.04 % rounds down
    expect(driftPercentTenths(9_995, 10_000)).toBe(0); // -0.05 % is half: up, to 0.0 %
    expect(driftPercentTenths(9_900, 10_000)).toBe(-10);
    expect(driftPercentTenths(10_000, 10_000)).toBe(0);
  });

  test("text: +1.1%, -1.0%, +0.0%", () => {
    expect(driftPercentText(11)).toBe("+1.1%");
    expect(driftPercentText(-10)).toBe("-1.0%");
    expect(driftPercentText(0)).toBe("+0.0%");
  });

  test("no band start: null", () => {
    expect(driftPercentTenths(5_967, 0)).toBeNull();
    expect(driftBp(5_967, 0)).toBeNull();
  });

  test("bp, half up: 6.480 over 5.900 is 983 bp", () => {
    expect(driftBp(6_480, 5_900)).toBe(983);
    expect(driftBp(5_967, 5_900)).toBe(114);
  });
});

describe("driftTone (green <= 800 bp, amber <= 1000 bp, red above, under below start)", () => {
  test("defaults are the tenant setting defaults", () => {
    expect(DRIFT_GREEN_MAX_BP).toBe(800);
    expect(DRIFT_AMBER_MAX_BP).toBe(1000);
  });

  test("spec examples", () => {
    expect(driftTone({ latestMilli: 5_967, bandStartMilli: 5_900 })).toBe("green");
    expect(driftTone({ latestMilli: 6_480, bandStartMilli: 5_900 })).toBe("amber");
    expect(driftTone({ latestMilli: 5_800, bandStartMilli: 5_900 })).toBe("under");
    expect(driftTone({ latestMilli: null, bandStartMilli: 5_900 })).toBe("none");
  });

  test("edges are exact, not rounded: 8.00 % is green, 8.01 % is amber, 10.00 % amber, above red", () => {
    expect(driftTone({ latestMilli: 10_800, bandStartMilli: 10_000 })).toBe("green");
    expect(driftTone({ latestMilli: 10_801, bandStartMilli: 10_000 })).toBe("amber");
    expect(driftTone({ latestMilli: 11_000, bandStartMilli: 10_000 })).toBe("amber");
    expect(driftTone({ latestMilli: 11_001, bandStartMilli: 10_000 })).toBe("red");
  });

  test("tenant bands override the defaults", () => {
    const bands = { greenMaxBp: 300, amberMaxBp: 500 };
    expect(driftTone({ latestMilli: 10_300, bandStartMilli: 10_000, bands })).toBe("green");
    expect(driftTone({ latestMilli: 10_400, bandStartMilli: 10_000, bands })).toBe("amber");
    expect(driftTone({ latestMilli: 10_501, bandStartMilli: 10_000, bands })).toBe("red");
  });
});

describe("bandPosition and kg/m", () => {
  test("in / above / below by grams per 12 ft", () => {
    expect(bandPosition(5_967, 5_900, 6_200)).toBe("in");
    expect(bandPosition(6_200, 5_900, 6_200)).toBe("in");
    expect(bandPosition(6_480, 5_900, 6_200)).toBe("above");
    expect(bandPosition(5_899, 5_900, 6_200)).toBe("below");
    expect(bandPosition(null, 5_900, 6_200)).toBeNull();
  });

  test("kg/m = (milli / 1000) / (12 x 0.3048), 3 decimals: 5.967 kg/12ft is 1.631 kg/m", () => {
    expect(kgPerMetre(5_967)).toBe(1.631);
    expect(kgPerMetre(12_000)).toBe(3.281);
    expect(kgPerMetre(3_657.6)).toBe(1);
  });
});

describe("recoveryTone (tenant bands; no bands set means no colour)", () => {
  test("unset bands give none", () => {
    expect(recoveryTone(7_545, null)).toBe("none");
  });
  test("green at or above greenMinBp, amber at or above amberMinBp, red below", () => {
    const bands = { greenMinBp: 7_500, amberMinBp: 7_000 };
    expect(recoveryTone(7_545, bands)).toBe("green");
    expect(recoveryTone(7_200, bands)).toBe("amber");
    expect(recoveryTone(6_999, bands)).toBe("red");
    expect(recoveryTone(null, bands)).toBe("none");
  });
});

describe("suggestFirstCopy (FP-DR-15, C36: lightest in-band available copy, then best tier, then code)", () => {
  const band = { bandMinG: 5_900, bandMaxG: 6_200 };
  test("only available copies; lightest in band wins", () => {
    const pick = suggestFirstCopy([
      { id: "a", seqNo: 1, status: "in_use", tierRank: 1, latestMilli: 5_910, ...band },
      { id: "b", seqNo: 2, status: "available", tierRank: 2, latestMilli: 5_990, ...band },
      { id: "c", seqNo: 3, status: "available", tierRank: 3, latestMilli: 5_950, ...band },
      { id: "d", seqNo: 4, status: "at_maker", tierRank: 1, latestMilli: 5_900, ...band },
    ]);
    expect(pick?.id).toBe("c");
  });

  test("ties go to the better tier, then the lower copy number; out of band comes after in band", () => {
    const pick = suggestFirstCopy([
      { id: "x", seqNo: 7, status: "available", tierRank: 2, latestMilli: 5_950, ...band },
      { id: "y", seqNo: 9, status: "available", tierRank: 1, latestMilli: 5_950, ...band },
      { id: "z", seqNo: 1, status: "available", tierRank: 1, latestMilli: 6_480, ...band },
    ]);
    expect(pick?.id).toBe("y");
    expect(
      suggestFirstCopy([
        { id: "p", seqNo: 2, status: "available", tierRank: null, latestMilli: null, ...band },
        { id: "q", seqNo: 1, status: "available", tierRank: null, latestMilli: null, ...band },
      ])?.id,
    ).toBe("q");
  });

  test("nothing available: null", () => {
    expect(suggestFirstCopy([{ id: "a", seqNo: 1, status: "retired", tierRank: 1, latestMilli: 5_950, ...band }])).toBeNull();
  });
});

describe("kgPerMetreToG12ft (import of a kg/m catalogue)", () => {
  test("kg/m x 12 x 0.3048, nearest gram per 12 ft; round-trips with kgPerMetre at 3 dp", () => {
    expect(kgPerMetreToG12ft(1)).toBe(3_658); // 3,657.6 g rounds up
    expect(kgPerMetreToG12ft(0.5)).toBe(1_829); // 1,828.8
    expect(kgPerMetreToG12ft(1.631)).toBe(5_966); // 5,965.5 rounds half up
    expect(kgPerMetre(kgPerMetreToG12ft(1.631))).toBe(1.631);
    expect(kgPerMetreToG12ft(3.281)).toBe(12_001);
  });
});
