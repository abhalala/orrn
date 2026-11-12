import { describe, expect, test } from "bun:test";

import { canonicalUnit, convertToCanonical, parseUnitToken, splitFeetInches, unitsFor, type UnitId } from "./units-adapter";
import type { UnitKind } from "./recipe";

const conv = (kind: UnitKind, unit: UnitId, decimal: string) => convertToCanonical({ kind, unit, decimal });

describe("canonical units", () => {
  test("each kind names its canonical unit and lists it", () => {
    for (const k of ["length", "mass", "linear_mass", "price_per_mass", "count", "dimension"] as const) {
      expect(unitsFor(k)).toContain(canonicalUnit(k) === "g/12ft" ? "kg/12ft" : canonicalUnit(k));
    }
    expect(canonicalUnit("mass")).toBe("g");
    expect(canonicalUnit("linear_mass")).toBe("g/12ft");
    expect(canonicalUnit("price_per_mass")).toBe("paise/kg");
  });
});

describe("parseUnitToken", () => {
  test("common office spellings", () => {
    expect(parseUnitToken("mass", "Kgs")).toBe("kg");
    expect(parseUnitToken("mass", "KG.")).toBe("kg");
    expect(parseUnitToken("mass", "(tonne)")).toBe("t");
    expect(parseUnitToken("mass", "qtl")).toBe("qtl");
    expect(parseUnitToken("length", "Mtr")).toBe("m");
    expect(parseUnitToken("length", "feet")).toBe("ft");
    expect(parseUnitToken("length", '"')).toBe("in");
    expect(parseUnitToken("linear_mass", "Kg / 12 ft")).toBe("kg/12ft");
    expect(parseUnitToken("linear_mass", "kg per 12'")).toBe("kg/12ft");
    expect(parseUnitToken("linear_mass", "kg/mtr")).toBe("kg/m");
    expect(parseUnitToken("price_per_mass", "Rs/Kg")).toBe("inr/kg");
    expect(parseUnitToken("price_per_mass", "₹ per tonne")).toBe("inr/t");
    expect(parseUnitToken("price_per_mass", "paise/kg")).toBe("paise/kg");
    expect(parseUnitToken("count", "Nos")).toBe("nos");
  });
  test("unknown or wrong-kind tokens give null", () => {
    expect(parseUnitToken("mass", "mm")).toBeNull();
    expect(parseUnitToken("length", "kg")).toBeNull();
    expect(parseUnitToken("mass", "")).toBeNull();
    expect(parseUnitToken("linear_mass", "kg")).toBeNull();
  });
});

describe("convertToCanonical", () => {
  test("mass", () => {
    expect(conv("mass", "kg", "58.4")).toEqual({ ok: true, canonical: 58400, rounded: false });
    expect(conv("mass", "t", "1.2345")).toEqual({ ok: true, canonical: 1234500, rounded: false });
    expect(conv("mass", "qtl", "2")).toEqual({ ok: true, canonical: 200000, rounded: false });
    expect(conv("mass", "lb", "1")).toEqual({ ok: true, canonical: 454, rounded: true });
    expect(conv("mass", "g", "0.5")).toEqual({ ok: true, canonical: 1, rounded: true });
    expect(conv("mass", "g", "0.49")).toEqual({ ok: true, canonical: 0, rounded: true });
  });
  test("half-up on the exact boundary, applied once", () => {
    // 2.0005 kg is 2000.5 g: half-up gives 2001. A float path (2.0005 * 1000) can give 2000.4999999999998.
    expect(conv("mass", "kg", "2.0005")).toEqual({ ok: true, canonical: 2001, rounded: true });
    expect(conv("mass", "kg", "1.0015")).toEqual({ ok: true, canonical: 1002, rounded: true });
    expect(conv("mass", "kg", "4.35")).toEqual({ ok: true, canonical: 4350, rounded: false });
  });
  test("linear mass: kg/12ft is g per 12 ft, kg/m uses 3.6576 m per 12 ft", () => {
    expect(conv("linear_mass", "kg/12ft", "2.09")).toEqual({ ok: true, canonical: 2090, rounded: false });
    expect(conv("linear_mass", "g/12ft", "2090")).toEqual({ ok: true, canonical: 2090, rounded: false });
    expect(conv("linear_mass", "kg/m", "1")).toEqual({ ok: true, canonical: 3658, rounded: true });
    expect(conv("linear_mass", "kg/m", "0.5")).toEqual({ ok: true, canonical: 1829, rounded: true });
    expect(conv("linear_mass", "lb/ft", "1")).toEqual({ ok: true, canonical: 5443, rounded: true });
  });
  test("price", () => {
    expect(conv("price_per_mass", "inr/kg", "214.5")).toEqual({ ok: true, canonical: 21450, rounded: false });
    expect(conv("price_per_mass", "inr/t", "214500")).toEqual({ ok: true, canonical: 21450, rounded: false });
    expect(conv("price_per_mass", "paise/kg", "21450")).toEqual({ ok: true, canonical: 21450, rounded: false });
    expect(conv("price_per_mass", "inr/t", "214505")).toEqual({ ok: true, canonical: 21451, rounded: true });
  });
  test("length and dimension", () => {
    expect(conv("length", "ft", "12")).toEqual({ ok: true, canonical: 3658, rounded: true });
    expect(conv("length", "mm", "3658")).toEqual({ ok: true, canonical: 3658, rounded: false });
    expect(conv("length", "m", "3.658")).toEqual({ ok: true, canonical: 3658, rounded: false });
    expect(conv("length", "ft_in", "12 6")).toEqual({ ok: true, canonical: 3810, rounded: false });
    expect(conv("length", "ft_in", "11 6")).toEqual({ ok: true, canonical: 3505, rounded: true });
    expect(conv("dimension", "mm", "44.54")).toEqual({ ok: true, canonical: 44.5, rounded: true });
    expect(conv("dimension", "mm", "44.55")).toEqual({ ok: true, canonical: 44.6, rounded: true });
    expect(conv("dimension", "in", "1")).toEqual({ ok: true, canonical: 25.4, rounded: false });
  });
  test("count", () => {
    expect(conv("count", "pcs", "25")).toEqual({ ok: true, canonical: 25, rounded: false });
    expect(conv("count", "nos", "2.5")).toEqual({ ok: true, canonical: 3, rounded: true });
  });
  test("error codes", () => {
    expect(conv("mass", "kg", "abc")).toEqual({ ok: false, code: "bad_number" });
    expect(conv("mass", "kg", "-1")).toEqual({ ok: false, code: "bad_number" });
    expect(conv("mass", "kg", "1e3")).toEqual({ ok: false, code: "bad_number" });
    expect(conv("mass", "kg", "1,000")).toEqual({ ok: false, code: "bad_number" });
    expect(conv("mass", "kg", "")).toEqual({ ok: false, code: "bad_number" });
    expect(conv("mass", "mm", "1")).toEqual({ ok: false, code: "unit_mismatch" });
    expect(conv("length", "kg/12ft", "1")).toEqual({ ok: false, code: "unit_mismatch" });
    expect(conv("mass", "t", "9".repeat(30))).toEqual({ ok: false, code: "out_of_range" });
    expect(conv("mass", "t", "9".repeat(80))).toEqual({ ok: false, code: "bad_number" });
  });
  test("splitFeetInches", () => {
    expect(splitFeetInches(`12' 6"`)).toBe("12 6");
    expect(splitFeetInches("11 ft 6 in")).toBe("11 6");
    expect(splitFeetInches("12ft")).toBe("12 0");
    expect(splitFeetInches("6 in")).toBe("0 6");
    expect(splitFeetInches("12-6")).toBeNull();
    expect(splitFeetInches("hello")).toBeNull();
  });
});
