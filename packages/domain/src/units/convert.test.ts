import { describe, expect, test } from "bun:test";

import { toCanonical } from "./canonical";
import { convertStorage, convertStorageBig, fromStorage, toStorage, toStorageBig } from "./convert";
import { mulRatio, ratio } from "./rational";
import { BASE_UNIT, KINDS, UNIT_IDS, UNITS, entryDecimals, factorBetween, unitsOf, type Kind, type UnitId } from "./registry";
import { formatStorage } from "./format";
import { DEFINITION_FACTOR, randDecimal, randInt, refStore, rng } from "./test-support";
import { type ConvertTarget } from "./canonical";
import { convertText } from "./canonical";

const PLAIN = { grouping: "none", decimal: ".", group: "," } as const;
const refUnits = (kind: Kind) => unitsOf(kind).map((u) => u.id).filter((id) => DEFINITION_FACTOR[id] !== undefined);

describe("exact conversion", () => {
  test("kg to g and back", () => {
    expect(toStorage(ratio(525n, 10n), "kg", "g")).toEqual({ value: 52500, exact: true, residue: ratio(0n) });
    expect(fromStorage(52500, "g", "kg")).toEqual(ratio(105n, 2n));
  });
  test("pounds: 1 lb is 453.59237 g, stored 454, residue is exact", () => {
    const r = toStorage(ratio(1n), "lb", "g");
    expect(r.value).toBe(454);
    expect(r.exact).toBe(false);
    expect(r.residue).toEqual(ratio(-40763n, 100000n));
  });
  test("half rounds away from zero, once", () => {
    expect(toStorage(ratio(1n, 2n), "g", "g").value).toBe(1);
    expect(toStorage(ratio(5n, 2n), "g", "g").value).toBe(3);
    expect(toStorage(ratio(-5n, 2n), "g", "g").value).toBe(-3);
    expect(toStorage(ratio(499n, 1000n), "g", "g").value).toBe(0);
    // 0.0005 kg is 0.5 g: rounds up to 1 g in one step
    expect(toStorage(ratio(5n, 10000n), "kg", "g").value).toBe(1);
  });
  test("one rounding, not two: 1.2345 kg/m goes straight to g per 12 ft", () => {
    // 1.2345 x 3657.6 = 4515.2... computed once; chaining through kg/12ft at 3 places would give 4515.
    const v = toStorage(ratio(12345n, 10000n), "kg_m", "g_12ft");
    expect(v.value).toBe(Number((12345n * 18288n * 1n) / (10000n * 5n)));
  });
  test("negative zero never appears", () => {
    expect(Object.is(toStorage(ratio(1n, 1000n), "g", "g").value, 0)).toBe(true);
  });
  test("programmer errors throw RangeError", () => {
    expect(() => toStorage(ratio(1n), "kg", "mm")).toThrow(RangeError);
    expect(() => fromStorage(1.5, "g", "kg")).toThrow(RangeError);
    expect(() => convertStorage(1.5, "g", "kg")).toThrow(RangeError);
    expect(() => toStorage(ratio(1n), "nope" as UnitId, "g")).toThrow(RangeError);
    expect(() => toStorage(ratio(10n ** 20n), "g", "g")).toThrow(RangeError);
  });
  test("temperature is affine: 77 F is 250 tenths of C, and back", () => {
    expect(toStorage(ratio(77n), "f", "deci_c").value).toBe(250);
    expect(fromStorage(250, "deci_c", "f")).toEqual(ratio(77n));
    expect(toStorage(ratio(-40n), "f", "deci_c").value).toBe(-400);
  });
});

describe("no float drift at large values", () => {
  test("tonnes of grams: 123456789.123456 t is 123456789123456 g", () => {
    const r = toCanonical("order.weight", "123456789.123456", "t", { mode: "round" });
    expect(r.ok).toBe(false); // above the field's hard cap, refused, not rounded wrong
    const raw = convertText({ kind: "mass", storage: "g" }, "123456789.123456", "t", { mode: "strict" });
    expect(raw.ok && raw.value).toBe(123456789123456);
    expect(raw.ok && raw.exact).toBe(true);
  });
  test("lakhs of rupees in paise: 99,99,999.99 INR is 999999999 paise, no 0.01 drift", () => {
    const r = toCanonical("order.amount", "9999999.99", "inr");
    expect(r.ok && r.value).toBe(999999999);
    const crore = toCanonical("order.amount", "123456789.07", "inr");
    expect(crore.ok && crore.value).toBe(12345678907);
  });
  test("a float multiply would drift here, the exact path does not", () => {
    // 1.005 x 100 is 100.49999999999999 in IEEE doubles; the old rate field read it as 100.
    expect(Math.round(1.005 * 100)).toBe(100);
    const r = toCanonical("order.rate", "1.005", "inr_kg", { mode: "round" });
    expect(r.ok && r.value).toBe(101);
    expect(r.ok && r.exact).toBe(false);
  });
  test("fast path equals the BigInt path on seeded large values for every same-kind pair", () => {
    const r = rng(20261110);
    for (const kind of KINDS) {
      const ids = unitsOf(kind).filter((u) => u.offNum === undefined).map((u) => u.id);
      for (const from of ids) {
        for (const to of ids) {
          for (let i = 0; i < 12; i++) {
            const mag = [1e3, 1e6, 1e9, 1e12, 1e15][randInt(r, 0, 4)]!;
            const v = Math.floor(r() * mag) * (r() < 0.2 ? -1 : 1);
            let big: { value: number; exact: boolean } | null = null;
            try {
              big = convertStorageBig(v, from, to);
            } catch {
              big = null;
            }
            if (big === null || !Number.isSafeInteger(big.value)) continue;
            expect([from, to, v, convertStorage(v, from, to)]).toEqual([from, to, v, big]);
          }
        }
      }
    }
  });
});

describe("seeded properties", () => {
  const signed = (kind: Kind, storage: UnitId): ConvertTarget => ({ kind, storage, hard: [-1e15, 1e15] });

  test("typed text, stored, shown at entry decimals: the same text, for every unit and storage pair", () => {
    const r = rng(7);
    let checked = 0;
    for (const kind of KINDS) {
      const typed = unitsOf(kind).filter((u) => !u.noEntry && !u.composite && u.id !== "in").map((u) => u.id);
      const storages = unitsOf(kind).map((u) => u.id).filter((id) => !UNITS[id].composite);
      for (const storage of storages) {
        for (const unit of typed) {
          const d = entryDecimals(unit, storage);
          // inches may also be typed on a 1/16 grid: the decimal rule here is the 1-decimal one
          for (let i = 0; i < 60; i++) {
            const text = randDecimal(r, 6, d);
            const res = convertText(signed(kind, storage), text, unit, { mode: "strict", style: PLAIN });
            expect([kind, unit, storage, text, res.ok]).toEqual([kind, unit, storage, text, true]);
            if (!res.ok) continue;
            const shown = formatStorage(res.value, storage, unit, d, PLAIN, { trim: true });
            const want = d >= 0 ? text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text : String(Number(text));
            expect([unit, storage, text, shown]).toEqual([unit, storage, text, want.replace(/^0+(?=\d)/, "") || "0"]);
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });

  test("a step finer than the entry decimals is refused in strict mode and rounded in round mode", () => {
    const r = rng(8);
    let seen = 0;
    for (const kind of KINDS) {
      const typed = unitsOf(kind).filter((u) => !u.noEntry && !u.composite && u.id !== "in");
      for (const u of typed) {
        const storage = BASE_UNIT[kind];
        const d = entryDecimals(u.id, storage);
        if (d < 0) continue;
        const text = `${randDecimal(r, 4, d)}7`.replace(/^(\d+)7$/, "$1.7");
        const finer = text.includes(".") ? text : `${text}.7`;
        const decimalsOf = (finer.split(".")[1] ?? "").length;
        if (decimalsOf <= d) continue;
        const strict = convertText(signed(kind, storage), finer, u.id, { mode: "strict", style: PLAIN });
        expect([u.id, strict.ok ? "ok" : strict.problem]).toEqual([u.id, "decimals"]);
        expect(convertText(signed(kind, storage), finer, u.id, { mode: "round", style: PLAIN }).ok).toBe(true);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(20);
  });

  test("storage integer, shown at entry decimals, read back, for units whose step is exactly one storage unit", () => {
    const r = rng(9);
    for (const kind of KINDS) {
      const ids = unitsOf(kind).map((u) => u.id).filter((id) => !UNITS[id].composite);
      for (const storage of ids) {
        for (const unit of ids) {
          if (UNITS[unit].noEntry || UNITS[unit].offNum !== undefined || UNITS[storage].offNum !== undefined) continue;
          const d = entryDecimals(unit, storage);
          if (d < 0) continue;
          // the step is one storage unit when 10^-d of the unit is exactly one storage unit
          const step = mulRatio(factorBetween(unit, storage), ratio(1n, 10n ** BigInt(d)));
          if (step.num !== 1n || step.den !== 1n) continue;
          for (let i = 0; i < 30; i++) {
            const v = randInt(r, 0, 10 ** 9);
            const text = formatStorage(v, storage, unit, d, PLAIN, { trim: true });
            const back = convertText(signed(kind, storage), text, unit, { mode: "strict", style: PLAIN });
            expect([storage, unit, v, back.ok && back.value]).toEqual([storage, unit, v, v]);
          }
        }
      }
    }
  });

  test("half-up exactly once: round mode equals an independent reference on every referenced pair", () => {
    const r = rng(10);
    let n = 0;
    for (const kind of KINDS) {
      const ids = refUnits(kind);
      for (const storage of ids) {
        for (const unit of ids) {
          if (UNITS[unit].composite) continue;
          for (let i = 0; i < 25; i++) {
            const text = randDecimal(r, 8, randInt(r, 0, 7));
            const want = refStore(text, unit, storage);
            const got = convertText({ kind, storage }, text, unit, { mode: "round", style: PLAIN });
            if (!got.ok) {
              expect([unit, storage, text, got.problem]).toEqual([unit, storage, text, "never"]);
              continue;
            }
            expect([unit, storage, text, BigInt(got.value), got.exact]).toEqual([unit, storage, text, want.value, want.exact]);
            n++;
          }
        }
      }
    }
    expect(n).toBeGreaterThan(5000);
  });

  test("round mode is idempotent on its own output: format at 12 places, read back, same integer", () => {
    const r = rng(11);
    for (const kind of KINDS) {
      const ids = unitsOf(kind).filter((u) => u.offNum === undefined && !u.composite).map((u) => u.id);
      for (const unit of ids) {
        for (const storage of ids) {
          const v = randInt(r, -(10 ** 7), 10 ** 7);
          const text = formatStorage(v, storage, unit, 12, PLAIN);
          const back = convertText(signed(kind, storage), text, unit, { mode: "round", style: PLAIN });
          expect([unit, storage, v, back.ok && back.value]).toEqual([unit, storage, v, v]);
        }
      }
    }
  });

  test("toStorageBig residue is the exact leftover", () => {
    const r = rng(12);
    for (let i = 0; i < 200; i++) {
      const text = randDecimal(r, 6, 6);
      const res = toStorageBig(ratio(BigInt(text.replace(".", "")), 10n ** 6n), "lb", "g");
      const exactNum = res.big * 100000n * 10n ** 6n + res.residue.num * 100000n * 10n ** 6n / res.residue.den;
      expect(exactNum).toBe(BigInt(text.replace(".", "")) * 45359237n);
      expect(UNIT_IDS.length).toBeGreaterThan(0);
    }
  });
});
