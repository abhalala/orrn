import { describe, expect, test } from "bun:test";

import { UNIT_KINDS, type UnitKind } from "./recipe";
import { canonicalToUnitText, canonicalUnit, convertToCanonical, unitsFor, type UnitId } from "./units-adapter";

/** Small deterministic generator, so a failure repeats. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomDecimal(next: () => number): string {
  const whole = Math.floor(next() ** 3 * 100000);
  const places = Math.floor(next() * 5);
  if (places === 0) return String(whole);
  const frac = Math.floor(next() * 10 ** places).toString().padStart(places, "0");
  return `${whole}.${frac}`;
}

const conv = (kind: UnitKind, unit: UnitId, decimal: string) => convertToCanonical({ kind, unit, decimal });

describe("round trips", () => {
  for (const kind of UNIT_KINDS) {
    for (const unit of unitsFor(kind)) {
      if (unit === "ft_in") continue;
      test(`${kind} ${unit}: value to canonical to text to canonical is stable`, () => {
        const next = rng(kind.length * 977 + unit.length);
        for (let n = 0; n < 200; n++) {
          const d = randomDecimal(next);
          const a = conv(kind, unit, d);
          expect(a.ok).toBe(true);
          if (!a.ok) continue;
          const text = canonicalToUnitText(kind, unit, a.canonical, 12)!;
          const b = conv(kind, unit, text);
          expect(b.ok && b.canonical).toBe(a.canonical);
        }
      });
    }
  }
});

describe("order and exactness", () => {
  test("conversion never reverses order", () => {
    for (const kind of UNIT_KINDS) {
      for (const unit of unitsFor(kind)) {
        if (unit === "ft_in") continue;
        const next = rng(7 + unit.length);
        let prev = -1;
        for (let x = 0; x < 300; x++) {
          const r = conv(kind, unit, (x * 0.37).toFixed(2));
          if (!r.ok) throw new Error("not ok");
          expect(r.canonical).toBeGreaterThanOrEqual(prev);
          prev = r.canonical;
        }
        void next;
      }
    }
  });

  test("kg to grams matches moving the decimal point three places, with half-up on the digits", () => {
    const next = rng(42);
    for (let n = 0; n < 500; n++) {
      const d = randomDecimal(next);
      const [w, f = ""] = d.split(".");
      const padded = f.padEnd(4, "0");
      let grams = BigInt(w + padded.slice(0, 3));
      if (padded[3]! >= "5") grams += 1n;
      const r = conv("mass", "kg", d);
      expect(r.ok && r.canonical).toBe(Number(grams));
    }
  });

  test("a whole number of grams written in kg converts back exactly and is not flagged rounded", () => {
    for (let g = 0; g < 5000; g += 7) {
      const text = canonicalToUnitText("mass", "kg", g, 3)!;
      expect(conv("mass", "kg", text)).toEqual({ ok: true, canonical: g, rounded: false });
    }
  });

  test("units that are exact multiples agree: 1 t is 1000 kg is 10 qtl", () => {
    for (const q of ["0.001", "1", "2.345", "12.5"]) {
      const t = conv("mass", "t", q);
      const kg = conv("mass", "kg", (Number(q) * 1000).toFixed(3));
      expect(t.ok && kg.ok && t.canonical).toBe(kg.ok ? kg.canonical : -1);
    }
    expect(conv("mass", "qtl", "10")).toEqual(conv("mass", "t", "1"));
  });

  test("kg/12ft and g/12ft agree, and kg/ft is twelve times kg/12ft per piece of length", () => {
    expect(conv("linear_mass", "kg/12ft", "2.4")).toEqual(conv("linear_mass", "g/12ft", "2400"));
    expect(conv("linear_mass", "kg/ft", "1")).toEqual(conv("linear_mass", "kg/12ft", "12"));
  });

  test("price: INR per tonne is a thousandth of INR per kg, to the paisa after one rounding", () => {
    expect(conv("price_per_mass", "inr/t", "214500")).toEqual({ ok: true, canonical: 21450, rounded: false });
    expect(conv("price_per_mass", "inr/qtl", "21450")).toEqual({ ok: true, canonical: 21450, rounded: false });
    expect(conv("price_per_mass", "inr/t", "214504.99")).toEqual({ ok: true, canonical: 21450, rounded: true });
    expect(conv("price_per_mass", "inr/t", "214505")).toEqual({ ok: true, canonical: 21451, rounded: true });
  });

  test("the canonical unit of each kind converts to itself exactly", () => {
    for (const kind of UNIT_KINDS) {
      const u = canonicalUnit(kind);
      const r = conv(kind, u, "123");
      expect(r.ok && r.canonical).toBe(123);
      expect(r.ok && r.rounded).toBe(false);
    }
  });

  test("no float on the path: values a double cannot hold still round exactly", () => {
    // 0.1 + 0.2 style traps: 1.005 kg is 1005 g exactly. 8.205 t is 8205000 g. 4.35 kg is 4350 g.
    expect(conv("mass", "kg", "1.005")).toEqual({ ok: true, canonical: 1005, rounded: false });
    expect(conv("mass", "t", "8.205")).toEqual({ ok: true, canonical: 8_205_000, rounded: false });
    expect(conv("mass", "kg", "0.0005")).toEqual({ ok: true, canonical: 1, rounded: true });
    expect(conv("mass", "kg", "9007199254740.991")).toEqual({ ok: true, canonical: 9_007_199_254_740_991, rounded: false });
    expect(conv("mass", "kg", "9007199254740.992")).toEqual({ ok: false, code: "out_of_range" });
  });
});
