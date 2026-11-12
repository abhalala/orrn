import { describe, expect, test } from "bun:test";

import { canonicalUnit, convertToCanonical, parseUnitToken, unitsFor, type UnitKind } from "./portal";
import { UNITS } from "./registry";

/** The kinds and units of plan B11, one row each. */
const B11: { kind: UnitKind; canonical: string; units: string[] }[] = [
  { kind: "length", canonical: "mm", units: ["mm", "cm", "m", "in", "ft", "ft_in"] },
  { kind: "mass", canonical: "g", units: ["g", "kg", "t", "quintal"] },
  { kind: "linear_mass", canonical: "g_12ft", units: ["kg_12ft", "g_12ft", "kg_m"] },
  { kind: "price_per_mass", canonical: "paise_kg", units: ["inr_kg", "paise_kg", "inr_t"] },
  { kind: "count", canonical: "pcs", units: ["pcs"] },
  { kind: "dimension", canonical: "mm", units: ["mm", "in"] },
];

describe("unitsFor, canonicalUnit", () => {
  for (const row of B11) {
    test(`${row.kind}: canonical ${row.canonical}, offers its units`, () => {
      expect(canonicalUnit(row.kind)).toBe(row.canonical as never);
      const offered = unitsFor(row.kind);
      for (const u of row.units) expect(offered).toContain(u as never);
      for (const u of offered) expect(UNITS[u]).toBeDefined();
    });
  }
  test("the design's own kind names work too", () => {
    expect(unitsFor("money_per_mass")).toEqual(unitsFor("price_per_mass"));
    expect(canonicalUnit("money_per_mass")).toBe("paise_kg");
    expect(unitsFor("temperature")).toEqual(["c", "f"]);
    expect(unitsFor("ratio")).toEqual(["ppm", "bp", "pct"]);
    expect(canonicalUnit("temperature")).toBe("deci_c");
  });
  test("the first release offers kg, tonne, lb; ft-in, mm, m; kg/12ft, kg/m, lb/ft", () => {
    expect(unitsFor("mass")).toEqual(expect.arrayContaining(["kg", "t", "lb"]));
    expect(unitsFor("length")).toEqual(expect.arrayContaining(["ft_in", "mm", "m"]));
    expect(unitsFor("linear_mass")).toEqual(expect.arrayContaining(["kg_12ft", "kg_m", "lb_ft"]));
  });
});

describe("parseUnitToken", () => {
  const cases: [UnitKind, string, string | null][] = [
    ["mass", "Kgs", "kg"], ["mass", "KG", "kg"], ["mass", "qtl", "quintal"], ["mass", "Quintals", "quintal"], ["mass", "t", "t"],
    ["mass", "MT", "t"], ["mass", "lbs", "lb"], ["mass", "grams", "g"], ["mass", "mm", null], ["mass", "", null],
    ["length", "mm", "mm"], ["length", "cm", "cm"], ["length", "Mtr", "m"], ["length", "inch", "in"], ["length", "ft", "ft"],
    ["length", "ft-in", "ft_in"], ["length", "kg", null], ["length", "ft+in", "ft_in"],
    ["linear_mass", "kg/12ft", "kg_12ft"], ["linear_mass", "Kg / 12 ft", "kg_12ft"], ["linear_mass", "g/12ft", "g_12ft"],
    ["linear_mass", "kg/m", "kg_m"], ["linear_mass", "kg/mtr", "kg_m"], ["linear_mass", "kg", null],
    ["price_per_mass", "INR/kg", "inr_kg"], ["price_per_mass", "Rs/kg", "inr_kg"], ["price_per_mass", "paise/kg", "paise_kg"],
    ["price_per_mass", "INR/t", "inr_t"], ["price_per_mass", "INR/tonne", "inr_t"], ["price_per_mass", "₹/kg", "inr_kg"],
    ["price_per_mass", "kg", null],
    ["count", "pcs", "pcs"], ["count", "nos", "pcs"], ["count", "Nos.", "pcs"], ["count", "kg", null],
    ["dimension", "mm", "mm"], ["dimension", "in", "in"], ["dimension", "ft", null],
  ];
  for (const [kind, text, want] of cases) test(`${kind} "${text}" is ${want}`, () => expect(parseUnitToken(kind, text)).toBe(want as never));
});

describe("convertToCanonical", () => {
  const ok = (kind: UnitKind, unit: string, decimal: string) => {
    const r = convertToCanonical({ kind, unit, decimal });
    return r.ok ? { canonical: r.canonical, rounded: r.rounded } : r.code;
  };
  test("mass: kg, g, tonne, quintal, pound", () => {
    expect(ok("mass", "kg", "12.5")).toEqual({ canonical: 12500, rounded: false });
    expect(ok("mass", "g", "12500")).toEqual({ canonical: 12500, rounded: false });
    expect(ok("mass", "t", "1.2345")).toEqual({ canonical: 1234500, rounded: false });
    expect(ok("mass", "quintal", "12.5")).toEqual({ canonical: 1250000, rounded: false });
    expect(ok("mass", "qtl", "12.5")).toEqual({ canonical: 1250000, rounded: false });
    expect(ok("mass", "lb", "1")).toEqual({ canonical: 454, rounded: true });
    expect(ok("mass", "kg", "0.0004")).toEqual({ canonical: 0, rounded: true });
    expect(ok("mass", "kg", "0.0005")).toEqual({ canonical: 1, rounded: true });
    expect(ok("mass", "g", "2.5")).toEqual({ canonical: 3, rounded: true });
  });
  test("length: mm, cm, m, in, ft, feet and inches", () => {
    expect(ok("length", "mm", "3658")).toEqual({ canonical: 3658, rounded: false });
    expect(ok("length", "cm", "365.8")).toEqual({ canonical: 3658, rounded: false });
    expect(ok("length", "m", "3.658")).toEqual({ canonical: 3658, rounded: false });
    expect(ok("length", "in", "144")).toEqual({ canonical: 3658, rounded: true });
    expect(ok("length", "ft", "12")).toEqual({ canonical: 3658, rounded: true });
    expect(ok("length", "ft_in", "12' 6\"")).toEqual({ canonical: 3810, rounded: false });
    expect(ok("length", "ft_in", "12-6")).toEqual({ canonical: 3810, rounded: false });
    expect(ok("length", "ft_in", "12 ft 6 in")).toEqual({ canonical: 3810, rounded: false });
    expect(ok("length", "mm", "12' 6\"")).toEqual({ canonical: 3810, rounded: false });
  });
  test("linear mass: kg/12ft, g/12ft, kg/m (3.6576 m per 12 ft), lb/ft", () => {
    expect(ok("linear_mass", "kg_12ft", "2.090")).toEqual({ canonical: 2090, rounded: false });
    expect(ok("linear_mass", "kg/12ft", "2.090")).toEqual({ canonical: 2090, rounded: false });
    expect(ok("linear_mass", "g_12ft", "2090")).toEqual({ canonical: 2090, rounded: false });
    expect(ok("linear_mass", "kg_m", "0.5714")).toEqual({ canonical: 2090, rounded: true });
    expect(ok("linear_mass", "kg_m", "1")).toEqual({ canonical: 3658, rounded: true });
    expect(ok("linear_mass", "lb_ft", "0.384")).toEqual({ canonical: 2090, rounded: true });
  });
  test("price per mass: INR/kg, paise/kg, INR/t, INR/quintal", () => {
    expect(ok("price_per_mass", "inr_kg", "250.5")).toEqual({ canonical: 25050, rounded: false });
    expect(ok("price_per_mass", "INR/kg", "250.5")).toEqual({ canonical: 25050, rounded: false });
    expect(ok("price_per_mass", "paise_kg", "25050")).toEqual({ canonical: 25050, rounded: false });
    expect(ok("price_per_mass", "paise/kg", "25050")).toEqual({ canonical: 25050, rounded: false });
    expect(ok("price_per_mass", "inr_t", "250500")).toEqual({ canonical: 25050, rounded: false });
    expect(ok("price_per_mass", "INR/t", "250505")).toEqual({ canonical: 25051, rounded: true });
    expect(ok("price_per_mass", "inr_quintal", "25050")).toEqual({ canonical: 25050, rounded: false });
    expect(ok("money_per_mass", "inr_kg", "1.005")).toEqual({ canonical: 101, rounded: true });
  });
  test("count and dimension (mm with one decimal)", () => {
    expect(ok("count", "pcs", "21")).toEqual({ canonical: 21, rounded: false });
    expect(ok("count", "nos", "21")).toEqual({ canonical: 21, rounded: false });
    expect(ok("count", "pcs", "21.5")).toEqual({ canonical: 22, rounded: true });
    expect(ok("dimension", "mm", "31.8")).toEqual({ canonical: 31.8, rounded: false });
    expect(ok("dimension", "mm", "31.75")).toEqual({ canonical: 31.8, rounded: true });
    expect(ok("dimension", "in", "1.25")).toEqual({ canonical: 31.8, rounded: true });
    expect(ok("dimension", "in", "1")).toEqual({ canonical: 25.4, rounded: false });
    expect(ok("dimension", "mm", "100")).toEqual({ canonical: 100, rounded: false });
  });
  test("bad_number", () => {
    for (const d of ["", " ", "abc", "1.2.3", "12abc", "1e5", "--1", "1,5", "NaN"]) expect([d, ok("mass", "kg", d)]).toEqual([d, "bad_number"]);
    expect(ok("length", "mm", "twelve")).toBe("bad_number");
  });
  test("unit_mismatch: a unit of another kind, an unknown unit, an unoffered unit", () => {
    expect(ok("mass", "mm", "5")).toBe("unit_mismatch");
    expect(ok("length", "kg", "5")).toBe("unit_mismatch");
    expect(ok("mass", "furlong", "5")).toBe("unit_mismatch");
    expect(ok("mass", "", "5")).toBe("unit_mismatch");
    expect(ok("count", "kg", "5")).toBe("unit_mismatch");
    expect(ok("dimension", "ft", "5")).toBe("unit_mismatch");
    expect(ok("gold" as never, "kg", "5")).toBe("unit_mismatch");
    expect(ok("mass", "um" as never, "5")).toBe("unit_mismatch");
  });
  test("out_of_range: a minus, past the safe integers, past the kind's cap", () => {
    expect(ok("mass", "kg", "-5")).toBe("out_of_range");
    expect(ok("mass", "t", "9".repeat(25))).toBe("out_of_range");
    expect(ok("mass", "t", "99999999999")).toBe("out_of_range");
    expect(ok("length", "m", "99999999")).toBe("out_of_range");
    expect(ok("count", "pcs", "99999999999")).toBe("out_of_range");
    expect(ok("dimension", "mm", "99999999")).toBe("out_of_range");
    expect(ok("mass", "t", "999999")).toEqual({ canonical: 999_999_000_000, rounded: false });
  });
  test("the entered text and unit come back for audit", () => {
    const r = convertToCanonical({ kind: "mass", unit: "qtl", decimal: "12.5" });
    expect(r.ok && r.entered).toEqual({ text: "12.5", unit: "quintal" });
    const l = convertToCanonical({ kind: "length", unit: "ft_in", decimal: "12-6" });
    expect(l.ok && l.entered).toEqual({ text: "12-6", unit: "ft_in" });
    const p = convertToCanonical({ kind: "mass", unit: "lb", decimal: "1" });
    expect(p.ok && p.residue).toBe("-40763/100000");
  });
  test("every offered unit of every B11 kind converts 1 of itself", () => {
    for (const row of B11) {
      for (const unit of unitsFor(row.kind)) {
        const r = convertToCanonical({ kind: row.kind, unit, decimal: "1" });
        expect([row.kind, unit, r.ok]).toEqual([row.kind, unit, true]);
      }
    }
  });
});
