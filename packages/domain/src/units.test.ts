import { describe, expect, test } from "bun:test";

import {
  MM_PER_FOOT,
  MM_PER_INCH,
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
