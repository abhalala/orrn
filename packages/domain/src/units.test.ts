import { describe, expect, test } from "bun:test";

import {
  MM_PER_FOOT,
  MM_PER_INCH,
  formatAxisTicksIN,
  formatCompactIN,
  formatKg,
  formatKgTotal,
  formatLength,
  gToKg,
  kgPer12ft,
  kgToG,
  lengthFromInput,
  parseDecimal,
  weightRange12ft,
  weightRange12ftFromMilli,
  weightRange12ftOf,
} from "./units";

describe("constants and weight conversion", () => {
  test("constants", () => {
    expect(MM_PER_INCH).toBe(25.4);
    expect(MM_PER_FOOT).toBe(304.8);
  });
  test("gToKg / kgToG", () => {
    expect(gToKg(52400)).toBe(52.4);
    expect(kgToG(52.4)).toBe(52400);
    expect(kgToG(0.0004)).toBe(0);
    expect(Number.isInteger(kgToG(2.4952))).toBe(true);
  });
});

describe("kgPer12ft", () => {
  test("52.4 kg over 21 pcs of 3658 mm is about 2.495", () => {
    const v = kgPer12ft({ weightG: 52400, pieces: 21, lengthMm: 3658 });
    expect(v).not.toBeNull();
    expect(Math.abs((v as number) - 2.495)).toBeLessThan(0.001);
  });
  test("a piece exactly 12 ft long weighs its own kg/12ft", () => {
    expect(kgPer12ft({ weightG: 3000, pieces: 1, lengthMm: 3657.6 })).toBeCloseTo(3, 9);
  });
  test("null when pieces or length are not positive", () => {
    expect(kgPer12ft({ weightG: 1000, pieces: 0, lengthMm: 3000 })).toBeNull();
    expect(kgPer12ft({ weightG: 1000, pieces: 5, lengthMm: 0 })).toBeNull();
    expect(kgPer12ft({ weightG: 1000, pieces: -1, lengthMm: 3000 })).toBeNull();
  });
});

describe("weightRange12ft", () => {
  test("floors to 0.1 with a 0.01 tolerance", () => {
    expect(weightRange12ft(2.522)).toBe(2.5);
    expect(weightRange12ft(2.388)).toBe(2.3);
    expect(weightRange12ft(1.786)).toBe(1.7);
    expect(weightRange12ft(1.813)).toBe(1.8);
    expect(weightRange12ft(2.499)).toBe(2.5);
  });

  test("exact boundaries x.x90 land in the upper band (float drift, PL-8 spec S-1)", () => {
    for (const [kg12, band] of [[2.09, 2.1], [2.19, 2.2], [2.59, 2.6], [8.79, 8.8], [2.089, 2.0], [0.99, 1.0]] as const) {
      expect(weightRange12ft(kg12)).toBe(band);
    }
  });

  test("from stored thousandths equals the decimal formula for every value 0.500 to 9.000", () => {
    expect(weightRange12ftFromMilli(2090)).toBe(2.1);
    expect(weightRange12ftFromMilli(2089)).toBe(2);
    expect(weightRange12ftFromMilli(2522)).toBe(2.5);
    const wrong: number[] = [];
    for (let milli = 500; milli <= 9000; milli += 1) {
      // Decimal truth: band tenths = floor((milli + 10) / 100), done on integers.
      const tenths = Math.floor((milli + 10) / 100);
      if (weightRange12ftFromMilli(milli) !== tenths / 10 || weightRange12ft(milli / 1000) !== tenths / 10) wrong.push(milli);
    }
    expect(wrong).toEqual([]);
  });
});

describe("kg formatting", () => {
  test("formatKg", () => {
    expect(formatKg(52.4)).toBe("52.40");
    expect(formatKg(2.4952, 3)).toBe("2.495");
    expect(formatKg(1234567.891)).toBe("12,34,567.89");
  });
  test("formatKgTotal", () => {
    expect(formatKgTotal(1234.56)).toBe("1,234.6");
    expect(formatKgTotal(52)).toBe("52.0");
    // en-IN lakh grouping, consistent with formatKg
    expect(formatKgTotal(1234567.8)).toBe("12,34,567.8");
  });
});

describe("parseDecimal", () => {
  test("accepts plain and grouped numbers", () => {
    expect(parseDecimal("1,234.5")).toBe(1234.5);
    expect(parseDecimal(" 12 ")).toBe(12);
    expect(parseDecimal("0.25")).toBe(0.25);
    expect(parseDecimal("0")).toBe(0);
  });
  test("rejects exponent, empty, negative and junk", () => {
    expect(parseDecimal("1e3")).toBeNull();
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("   ")).toBeNull();
    expect(parseDecimal("-5")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("1.2.3")).toBeNull();
  });
});

describe("lengthFromInput", () => {
  test("inch company: 11 ft 6 in is 3505 mm", () => {
    expect(lengthFromInput({ unit: "inch", feet: "11", inches: "6" })).toBe(3505);
  });
  test("inch company: feet only, inches only", () => {
    expect(lengthFromInput({ unit: "inch", feet: "12" })).toBe(3658);
    expect(lengthFromInput({ unit: "inch", inches: "6" })).toBe(152);
  });
  test("mm company", () => {
    expect(lengthFromInput({ unit: "mm", mm: "3658" })).toBe(3658);
    expect(lengthFromInput({ unit: "mm", mm: "3,658.4" })).toBe(3658);
  });
  test("never reads mm text as inches (25.4x guard)", () => {
    expect(lengthFromInput({ unit: "inch", mm: "3658" })).toBeNull();
    expect(lengthFromInput({ unit: "mm", feet: "12", inches: "0" })).toBeNull();
  });
  test("invalid or empty input is null", () => {
    expect(lengthFromInput({ unit: "mm", mm: "" })).toBeNull();
    expect(lengthFromInput({ unit: "mm", mm: "0" })).toBeNull();
    expect(lengthFromInput({ unit: "mm", mm: "1e3" })).toBeNull();
    expect(lengthFromInput({ unit: "inch", feet: "", inches: "" })).toBeNull();
    expect(lengthFromInput({ unit: "inch", feet: "x", inches: "6" })).toBeNull();
  });
});

describe("formatLength", () => {
  test("mm", () => {
    expect(formatLength(3658, "mm")).toBe("3658 mm");
  });
  test("inch", () => {
    expect(formatLength(3658, "inch")).toBe("12 ft");
    expect(formatLength(3505, "inch")).toBe("11 ft 6 in");
    expect(formatLength(152, "inch")).toBe("6 in");
  });
  test("rounding carries into the next foot", () => {
    // 3656 mm = 143.94 in -> 144 in = 12 ft, not 11 ft 12 in
    expect(formatLength(3656, "inch")).toBe("12 ft");
  });
  test("inches round to the nearest 0.25", () => {
    // 11 ft 6.25 in = 138.25 in = 3511.55 mm
    expect(formatLength(3512, "inch")).toBe("11 ft 6.25 in");
  });
});

describe("compact en-IN formatting for chart axes", () => {
  test("small numbers stay whole", () => {
    expect(formatCompactIN(0)).toBe("0");
    expect(formatCompactIN(950)).toBe("950");
    expect(formatCompactIN(999.4)).toBe("999");
  });
  test("thousands use k with at most one decimal", () => {
    expect(formatCompactIN(1000)).toBe("1k");
    expect(formatCompactIN(1500)).toBe("1.5k");
    expect(formatCompactIN(12000)).toBe("12k");
    expect(formatCompactIN(12500)).toBe("12.5k");
    expect(formatCompactIN(99_000)).toBe("99k");
  });
  test("lakh and crore, Indian grouping not millions", () => {
    expect(formatCompactIN(1_00_000)).toBe("1L");
    expect(formatCompactIN(1_20_000)).toBe("1.2L");
    expect(formatCompactIN(12_50_000)).toBe("12.5L");
    expect(formatCompactIN(1_00_00_000)).toBe("1Cr");
    expect(formatCompactIN(1_10_00_000)).toBe("1.1Cr");
    expect(formatCompactIN(2_50_00_00_000)).toBe("250Cr");
    expect(formatCompactIN(12_34_56_78_900)).toBe("1,235Cr");
  });
  test("rounding never shows 100k or 100L: it moves up a unit", () => {
    expect(formatCompactIN(99_990)).toBe("1L");
    expect(formatCompactIN(99_99_000)).toBe("1Cr");
  });
  test("negative values keep the sign", () => {
    expect(formatCompactIN(-1500)).toBe("-1.5k");
    expect(formatCompactIN(-2_00_000)).toBe("-2L");
  });
});

describe("axis ticks: one unit for the whole axis", () => {
  test("a lakh domain never mixes in k", () => {
    expect(formatAxisTicksIN([0, 50_000, 1_00_000, 1_50_000, 2_00_000])).toEqual(["0", "0.5L", "1L", "1.5L", "2L"]);
  });
  test("a k domain stays in k", () => {
    expect(formatAxisTicksIN([0, 2_000, 4_000, 6_000, 8_000, 10_000])).toEqual(["0", "2k", "4k", "6k", "8k", "10k"]);
    expect(formatAxisTicksIN([0, 500, 1_000, 1_500])).toEqual(["0", "0.5k", "1k", "1.5k"]);
  });
  test("a crore domain, with quarter steps", () => {
    expect(formatAxisTicksIN([0, 25_00_000, 50_00_000, 75_00_000, 1_00_00_000, 1_25_00_000])).toEqual([
      "0",
      "0.25Cr",
      "0.5Cr",
      "0.75Cr",
      "1Cr",
      "1.25Cr",
    ]);
  });
  test("crossing a unit boundary takes the larger unit for every tick", () => {
    expect(formatAxisTicksIN([0, 20_000, 40_000, 60_000, 80_000, 1_00_000, 1_20_000])).toEqual([
      "0",
      "0.2L",
      "0.4L",
      "0.6L",
      "0.8L",
      "1L",
      "1.2L",
    ]);
  });
  test("small domains are plain whole numbers", () => {
    expect(formatAxisTicksIN([0, 200, 400, 600])).toEqual(["0", "200", "400", "600"]);
  });
  test("custom suffixes (from i18n) and negative ticks", () => {
    expect(formatAxisTicksIN([-1_00_000, 0, 1_00_000], "hi", { thousand: "k", lakh: "लाख", crore: "Cr" })).toEqual([
      "-1लाख",
      "0",
      "1लाख",
    ]);
  });
  test("an empty axis", () => {
    expect(formatAxisTicksIN([])).toEqual([]);
  });
});

describe("weightRange12ftOf (Range /12' from the raw bundle, PL-8 review round 3)", () => {
  // 12 pcs of 10 ft (3,048 mm): raw kg/12ft = weightG / 10,000 exactly.
  const tenFt = (weightG: number) => weightRange12ftOf({ weightG, pieces: 12, lengthMm: 3_048 });

  test("the Excel formula on the raw value: 2.0895 -> 2.0 (its printed 2.090 would say 2.1), 2.090 -> 2.1", () => {
    expect(tenFt(20_895)).toBe(2.0);
    expect(tenFt(20_899)).toBe(2.0);
    expect(tenFt(20_900)).toBe(2.1);
    expect(tenFt(25_220)).toBe(2.5);
    expect(tenFt(23_880)).toBe(2.3);
    // 20.9 kg of 10 pcs at 3,658 mm is raw 2.08977 kg/12ft (printed 2.090): band 2.0.
    expect(weightRange12ftOf({ weightG: 20_900, pieces: 10, lengthMm: 3_658 })).toBe(2.0);
  });

  test("equals floor((weightG + 100) / 1000) / 10 for every weight 5,000..90,000 g at 12 pcs × 3,048 mm", () => {
    const wrong: number[] = [];
    for (let w = 5_000; w <= 90_000; w += 1) if (tenFt(w) !== Math.floor((w + 100) / 1000) / 10) wrong.push(w);
    expect(wrong).toEqual([]);
  });

  test("away from a band edge it agrees with weightRange12ft(kgPer12ft(...)); null without pieces or length", () => {
    expect(weightRange12ftOf({ weightG: 52_400, pieces: 21, lengthMm: 3_658 })).toBe(weightRange12ft(kgPer12ft({ weightG: 52_400, pieces: 21, lengthMm: 3_658 })!));
    expect(weightRange12ftOf({ weightG: 3_000, pieces: 1, lengthMm: 3_657.6 })).toBe(3.0);
    expect(weightRange12ftOf({ weightG: 1_000, pieces: 0, lengthMm: 3_000 })).toBeNull();
    expect(weightRange12ftOf({ weightG: 1_000, pieces: 5, lengthMm: 0 })).toBeNull();
  });
});
