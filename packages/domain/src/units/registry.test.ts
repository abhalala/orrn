import { describe, expect, test } from "bun:test";

import {
  aliasesOf, BASE_UNIT, entryDecimals, factorBetween, findUnit, KINDS, normalizeUnitText, UNIT_IDS, UNITS, unitsOf,
  type UnitId,
} from "./registry";
import { toBase } from "./convert";
import { ratio } from "./rational";
import { DEFINITION_FACTOR, decimalToFrac } from "./test-support";

describe("factors are pinned to the definitions", () => {
  for (const [id, text] of Object.entries(DEFINITION_FACTOR)) {
    test(`${id} is ${text} of its base unit`, () => {
      const u = UNITS[id as UnitId];
      const f = decimalToFrac(text!);
      expect(u.num * f.d).toBe(f.n * u.den);
    });
  }
  test("factors are reduced and positive", () => {
    for (const id of UNIT_IDS) {
      const u = UNITS[id];
      expect(u.num > 0n && u.den > 0n).toBe(true);
    }
  });
  test("the pound, the inch and 12 ft, in the stated fractions", () => {
    expect([UNITS.lb.num, UNITS.lb.den]).toEqual([45359237n, 100000n]);
    expect([UNITS.in.num, UNITS.in.den]).toEqual([127n, 5n]);
    expect(UNITS.ft.num * 12n * 10n).toBe(36576n * UNITS.ft.den); // 12 ft is 36576/10 mm
    expect([UNITS.lb_ft.num, UNITS.lb_ft.den]).toEqual([136077711n, 25000n]);
  });
  test("psi from the pound-force and the square inch", () => {
    // 1 lbf = 0.45359237 kg x 9.80665 = 4.4482216152605 N (13 decimals); 1 in2 = 0.00064516 m2.
    expect(45359237n * 980665n).toBe(44482216152605n);
    // psi in deci bar = 4.4482216152605 / 0.00064516 / 10000 = 44482216152605 / 64516000000000
    expect(UNITS.psi.num * 64516000000000n).toBe(44482216152605n * UNITS.psi.den);
  });
  test("temperature: 32 F is 0, 212 F is 1000, -40 F is -400 (tenths of a degree C)", () => {
    for (const [f, deciC] of [[32n, 0n], [212n, 1000n], [-40n, -400n]] as const) {
      expect(toBase(ratio(f), "f")).toEqual(ratio(deciC));
    }
    expect(toBase(ratio(25n), "c")).toEqual(ratio(250n));
  });
  test("one 12 ft section: kg/12ft to kg/m to lb/ft", () => {
    // 2.090 kg per 12 ft is 0.5714 kg/m (exact 2090 / 3657.6) and 0.3839 lb/ft
    const kgm = factorBetween("g_12ft", "kg_m");
    expect(Number(2090n * kgm.num) / Number(kgm.den)).toBeCloseTo(0.5714, 3);
  });
});

describe("unit table", () => {
  test("ids are append-only: this list may only grow", () => {
    expect([...UNIT_IDS].sort()).toEqual([
      "bar", "bp", "c", "cm", "deci_bar", "deci_c", "deci_mm_s", "f", "ft", "ft_in", "ft_min", "g", "g_12ft", "g_m", "h",
      "in", "inr", "inr_kg", "inr_quintal", "inr_t", "kg", "kg_12ft", "kg_ft", "kg_m", "kgf_cm2", "l", "lb", "lb_ft", "m",
      "m3", "m_min", "milli_pcs", "min", "ml", "mm", "mm_s", "mpa", "ms", "paise", "paise_kg", "pcs", "pct", "ppm", "psi",
      "quintal", "s", "t", "tenth_in", "tenth_mm", "um",
    ].sort() as UnitId[]);
  });
  test("every kind has a base unit with factor 1 and offset 0", () => {
    for (const k of KINDS) {
      const b = UNITS[BASE_UNIT[k]];
      expect(b.kind).toBe(k);
      expect([b.num, b.den]).toEqual([1n, 1n]);
      expect(b.offNum).toBeUndefined();
      expect(unitsOf(k).length).toBeGreaterThan(0);
    }
  });
  test("every unit id, symbol and alias reads back as that unit", () => {
    for (const id of UNIT_IDS) {
      const u = UNITS[id];
      for (const text of [id, u.symbol, ...u.aliases, ...u.aliases.map((a) => a.toUpperCase())]) {
        expect(findUnit(text, u.kind)).toBe(id);
      }
    }
  });
  test("no token means two units", () => {
    const seen = new Map<string, UnitId>();
    for (const id of UNIT_IDS) {
      for (const key of aliasesOf(id)) {
        const prev = seen.get(key);
        expect(prev === undefined || prev === id ? "" : `${key}: ${prev} and ${id}`).toBe("");
        seen.set(key, id);
      }
    }
  });
  test("tokens people really write", () => {
    const cases: [string, UnitId][] = [
      ["Kgs", "kg"], ["KG", "kg"], ["Kilograms", "kg"], ["MT", "t"], ["tonnes", "t"], ["Qtl", "quintal"], ["lbs", "lb"],
      ["Rs/Kg", "inr_kg"], ["INR / kg", "inr_kg"], ["₹/kg", "inr_kg"], ["Rs per kg", "inr_kg"], ["paise/kg", "paise_kg"],
      ["INR/t", "inr_t"], ["Rs/MT", "inr_t"], ["kg/12ft", "kg_12ft"], ["Kg / 12 ft", "kg_12ft"], ["kg per 12 ft", "kg_12ft"],
      ["kg/12'", "kg_12ft"], ["g/12ft", "g_12ft"], ["Kg/Mtr", "kg_m"], ["lb/ft", "lb_ft"], ["Nos", "pcs"], ["pcs.", "pcs"],
      ["mm", "mm"], ["MM", "mm"], ["Inch", "in"], ["\"", "in"], ["'", "ft"], ["feet", "ft"], ["Mtrs", "m"], ["°C", "c"], ["%", "pct"],
    ];
    for (const [text, id] of cases) expect([text, findUnit(text)]).toEqual([text, id]);
    expect(findUnit("furlong")).toBeNull();
    expect(findUnit("kg", "length")).toBeNull();
    expect(normalizeUnitText("  Kg  PER 12 ft. ")).toBe("kg/12ft");
  });
});

describe("entry decimals", () => {
  const cases: [UnitId, UnitId, number][] = [
    ["g", "g", 0], ["kg", "g", 3], ["quintal", "g", 5], ["t", "g", 6], ["lb", "g", 2],
    ["mm", "mm", 0], ["cm", "mm", 1], ["m", "mm", 3], ["in", "mm", 1], ["ft", "mm", 2],
    ["g_12ft", "g_12ft", 0], ["kg_12ft", "g_12ft", 3], ["kg_m", "g_12ft", 3], ["g_m", "g_12ft", 0], ["kg_ft", "g_12ft", 4],
    ["lb_ft", "g_12ft", 3], ["paise", "paise", 0], ["inr", "paise", 2], ["inr_kg", "paise_kg", 2], ["inr_quintal", "paise_kg", 0],
    ["inr_t", "paise_kg", -1], ["pct", "bp", 2], ["pct", "ppm", 4], ["bp", "bp", 0], ["c", "deci_c", 1], ["f", "deci_c", 0],
    ["bar", "deci_bar", 1], ["mpa", "deci_bar", 2], ["kgf_cm2", "deci_bar", 0], ["m_min", "deci_mm_s", 2], ["ft_min", "deci_mm_s", 1],
    ["l", "ml", 3], ["m3", "l", 3], ["s", "ms", 3], ["min", "min", 0], ["pcs", "pcs", 0],
    ["mm", "tenth_mm", 1], ["in", "tenth_mm", 2],
  ];
  for (const [u, s, d] of cases) test(`${u} into ${s}: ${d}`, () => expect(entryDecimals(u, s)).toBe(d));
  test("kind mismatch is a programmer error", () => {
    expect(() => entryDecimals("kg", "mm")).toThrow(RangeError);
  });
});
