import { describe, expect, test } from "bun:test";

import { checkMagnitude, toCanonical } from "./canonical";
import { numberToDecimalText, parseAmount, parseLengthText } from "./parse";
import { ratio, ratioToString } from "./rational";
import { rng } from "./test-support";
import type { NumberStyle } from "./style";

const IN: NumberStyle = { grouping: "indian", decimal: ".", group: "," };
const INTL: NumberStyle = { grouping: "international", decimal: ".", group: "," };
const NONE: NumberStyle = { grouping: "none", decimal: ".", group: "," };
const EU: NumberStyle = { grouping: "international", decimal: ",", group: "." };
const SPACE: NumberStyle = { grouping: "international", decimal: ",", group: " " };

const amount = (text: string, style = IN) => {
  const r = parseAmount(text, style);
  return r.ok ? ratioToString(r.amount) : r.problem;
};

describe("parseAmount", () => {
  test("plain, grouped the Indian way, grouped the western way", () => {
    expect(amount("12")).toBe("12");
    expect(amount("12.5")).toBe("25/2");
    expect(amount(".5")).toBe("1/2");
    expect(amount("12.")).toBe("12");
    expect(amount("12,34,567.5")).toBe("2469135/2");
    expect(amount("1,234,567.5")).toBe("2469135/2");
    expect(amount("1,234,567.5", INTL)).toBe("2469135/2");
    expect(amount("12,34,567", INTL)).toBe("1234567");
  });
  test("bad grouping, junk, empty", () => {
    expect(amount("1,23,4567")).toBe("grouping");
    expect(amount("12,3")).toBe("grouping");
    expect(amount("1,234", NONE)).toBe("grouping");
    expect(amount("")).toBe("empty");
    expect(amount("   ")).toBe("empty");
    expect(amount("abc")).toBe("invalid");
    expect(amount("1.2.3")).toBe("invalid");
    expect(amount("12abc")).toBe("invalid");
    expect(amount("1e5")).toBe("invalid");
    expect(amount("-")).toBe("invalid");
    expect(amount("."), "lone mark").toBe("invalid");
    expect(amount("1".repeat(40))).toBe("tooBig");
  });
  test("sign: negative is a problem unless allowed", () => {
    expect(amount("-5")).toBe("negative");
    const r = parseAmount("-5.5", IN, { negative: true });
    expect(r.ok && ratioToString(r.amount)).toBe("-11/2");
    expect(r.ok && r.text).toBe("-5.5");
    expect(amount("+5")).toBe("5");
  });
  test("decimal comma and space grouping", () => {
    expect(amount("1.234,5", EU)).toBe("2469/2");
    expect(amount("1 234,5", SPACE)).toBe("2469/2");
    expect(amount("1 234,5", SPACE)).toBe("2469/2");
    expect(amount("1,5", EU)).toBe("3/2");
  });
  test("Hindi and Gujarati digits read as Latin digits", () => {
    expect(amount("१२५.५")).toBe("251/2");
    expect(amount("૧૨૫")).toBe("125");
  });
  test("returns the cleaned plain text", () => {
    const r = parseAmount(" 0012500.250 ");
    expect(r.ok && r.text).toBe("12500.25");
  });
  test("never throws on random garbage", () => {
    const r = rng(3);
    const alphabet = "0123456789.,-+ eE'\"ftin/%₹x";
    for (let i = 0; i < 2000; i++) {
      let s = "";
      for (let j = 0, n = Math.floor(r() * 14); j < n; j++) s += alphabet[Math.floor(r() * alphabet.length)];
      expect(() => parseAmount(s, IN)).not.toThrow();
      expect(() => parseLengthText(s, "mm")).not.toThrow();
      expect(() => toCanonical("bundle.length", s, "ft_in", { mode: "round" })).not.toThrow();
    }
  });
});

describe("numberToDecimalText", () => {
  test("shortest text, exponents spelled out", () => {
    expect(numberToDecimalText(12.5)).toBe("12.5");
    expect(numberToDecimalText(1.2e-7)).toBe("0.00000012");
    expect(numberToDecimalText(1.5e21)).toBe("1500000000000000000000");
    expect(numberToDecimalText(-3.25e-3)).toBe("-0.00325");
    expect(numberToDecimalText(Number.NaN)).toBeNull();
    expect(numberToDecimalText(Infinity)).toBeNull();
  });
});

const len = (text: string, plain = "mm" as const) => {
  const r = parseLengthText(text, plain);
  return r.ok ? `${ratioToString(r.amount)} ${r.unit}${r.explicit ? "*" : ""}` : r.problem;
};

describe("parseLengthText", () => {
  test("feet and inches in every written form: 12 ft 6 in is 150 in", () => {
    for (const t of ["12' 6\"", "12'6\"", "12' 6", "12-6", "12 - 6", "12 ft 6 in", "12ft 6in", "12ft6in", "12 feet 6 inches", "12 Ft 6 In", "12’ 6”", "12' 6''"]) {
      expect([t, len(t)]).toEqual([t, "150 in*"]);
    }
  });
  test("fractions of an inch", () => {
    expect(len("11 ft 6 1/4 in")).toBe("553/4 in*");
    expect(len("11' 6 1/4\"")).toBe("553/4 in*");
    expect(len("6 1/4 in")).toBe("25/4 in*");
    expect(len("1/4 in")).toBe("1/4 in*");
    expect(len("1/4\"")).toBe("1/4 in*");
    expect(len("12-6 1/2")).toBe("301/2 in*");
  });
  test("single parts and other units", () => {
    expect(len("12'")).toBe("12 ft*");
    expect(len("12 ft")).toBe("12 ft*");
    expect(len("6 in")).toBe("6 in*");
    expect(len("6\"")).toBe("6 in*");
    expect(len("3658 mm")).toBe("3658 mm*");
    expect(len("3.658 m")).toBe("1829/500 m*");
    expect(len("365.8 cm")).toBe("1829/5 cm*");
    expect(len("1,250 mm")).toBe("1250 mm*");
  });
  test("a bare number is read in the plain unit", () => {
    expect(len("3658")).toBe("3658 mm");
    expect(len("12", "ft")).toBe("12 ft");
    expect(len("12.5", "in")).toBe("25/2 in");
  });
  test("problems", () => {
    expect(len("")).toBe("empty");
    expect(len("abc")).toBe("invalid");
    expect(len("12 furlongs")).toBe("unit");
    expect(len("12' x")).toBe("invalid");
    expect(len("-12 ft")).toBe("negative");
    expect(len("1/0 in")).toBe("invalid");
    expect(len("12 ft in")).toBe("invalid");
  });
  test("negative when the field allows it", () => {
    const r = parseLengthText("-1' 6\"", "mm", { negative: true });
    expect(r.ok && ratioToString(r.amount)).toBe("-18");
  });
  test("grid 1/16 fractions parse exactly", () => {
    for (let i = 0; i < 16; i++) {
      const r = parseLengthText(`${i}/16 in`, "mm");
      expect(r.ok && ratioToString(r.amount)).toBe(ratioToString(ratio(BigInt(i), 16n)));
    }
  });
});

describe("toCanonical: feet and inches golden cases", () => {
  const mm = (text: string, unit = "ft_in" as const, mode: "strict" | "round" = "strict") => {
    const r = toCanonical("bundle.length", text, unit, { mode });
    return r.ok ? r.value : r.problem;
  };
  test("12' 6\" is 3810 mm, however it is written", () => {
    for (const t of ["12' 6\"", "12-6", "12 ft 6 in", "12ft6in"]) expect(mm(t)).toBe(3810);
  });
  test("18 ft is 5486 mm (5486.4 stored whole)", () => {
    expect(mm("18'")).toBe(5486);
    expect(mm("18", "ft")).toBe(5486);
    const r = toCanonical("bundle.length", "18'", "ft_in");
    expect(r.ok && r.exact).toBe(false);
    expect(r.ok && r.residue).toBe("2/5");
  });
  test("11 ft 6 1/4 in is 3512 mm", () => expect(mm("11 ft 6 1/4 in")).toBe(3512));
  test("a stray unit in the text wins over the column unit, and is kept", () => {
    const r = toCanonical("bundle.length", "3658 mm", "ft");
    expect(r.ok && r.value).toBe(3658);
    expect(r.ok && r.entered).toEqual({ text: "3658 mm", unit: "mm" });
  });
  test("the entered pair is enough to repeat the conversion", () => {
    for (const t of ["12' 6\"", "12-6", "12.5", "6 1/4 in", "3.658 m"]) {
      const a = toCanonical("bundle.length", t, "ft_in", { mode: "round" });
      if (!a.ok) throw new Error(t);
      const b = toCanonical("bundle.length", a.entered.text, a.entered.unit, { mode: "round" });
      expect(b).toEqual(a);
    }
  });
  test("strict entry holds the inch grid: tenths or sixteenths, nothing finer", () => {
    expect(mm("6.25 in", "in")).toBe(159);
    expect(mm("6.3 in", "in")).toBe(160);
    expect(mm("6.33 in", "in")).toBe("decimals");
    expect(mm("12 ft 6.0625 in")).toBe(3812);
    expect(mm("12 ft 6.1 in")).toBe("decimals");
    expect(mm("12 ft 6 1/32 in")).toBe("decimals");
    expect(mm("12 ft 6.1 in", "ft_in", "round")).toBe(3813);
  });
  test("a kind slip is refused, not guessed", () => {
    const r = toCanonical("bundle.length", "5", "kg");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.problem).toBe("kind");
  });
});

describe("toCanonical: weights, rates and the other kinds", () => {
  test("strict refuses a fourth decimal of a kilogram, round takes it and flags it", () => {
    const s = toCanonical("bundle.weight", "12.3456", "kg");
    expect(!s.ok && s.problem).toBe("decimals");
    const r = toCanonical("bundle.weight", "12.3456", "kg", { mode: "round" });
    expect(r.ok && r.value).toBe(12346);
    expect(r.ok && r.exact).toBe(false);
    expect(r.ok && r.residue).toBe("-2/5");
  });
  test("pounds: two decimals typed, a gram stored", () => {
    const r = toCanonical("bundle.weight", "25.50", "lb");
    expect(r.ok && r.value).toBe(11567);
    expect(r.ok && r.exact).toBe(false);
  });
  test("INR per tonne goes in whole tens of rupees; the rate is paise per kg", () => {
    const a = toCanonical("order.rate", "250000", "inr_t");
    expect(a.ok && a.value).toBe(25000);
    expect(a.ok && a.exact).toBe(true);
    const b = toCanonical("order.rate", "250005", "inr_t");
    expect(!b.ok && b.problem).toBe("decimals");
    const c = toCanonical("order.rate", "250005", "inr_t", { mode: "round" });
    expect(c.ok && c.value).toBe(25001);
    expect(c.ok && c.exact).toBe(false);
    expect(toCanonical("order.rate", "250.00", "inr_kg").ok).toBe(true);
    expect(toCanonical("order.rate", "5230", "inr_quintal")).toMatchObject({ ok: true, value: 5230 });
  });
  test("kg per 12 ft to kg/m and lb/ft: one die, three ways to type it", () => {
    // 2.090 kg per 12 ft; 0.5714 kg/m reads 2090 g/12ft to the gram (0.5714 x 3657.6 = 2089.9)
    expect(toCanonical("die.band", "2.090", "kg_12ft")).toMatchObject({ ok: true, value: 2090, exact: true });
    expect(toCanonical("die.band", "0.571", "kg_m")).toMatchObject({ ok: true, value: 2088 });
    expect(toCanonical("die.band", "0.5714", "kg_m", { mode: "round" })).toMatchObject({ ok: true, value: 2090 });
    expect(toCanonical("die.band", "0.384", "lb_ft")).toMatchObject({ ok: true, value: 2090 });
    expect(toCanonical("die.band", "1", "kg_m")).toMatchObject({ ok: true, value: 3658 });
  });
  test("count fields are whole", () => {
    expect(toCanonical("bundle.pieces", "21", "pcs")).toMatchObject({ ok: true, value: 21 });
    const s = toCanonical("bundle.pieces", "21.5", "pcs");
    expect(!s.ok && s.problem).toBe("decimals");
    expect(toCanonical("bundle.pieces", "21.5", "pcs", { mode: "round" })).toMatchObject({ ok: true, value: 22, exact: false });
  });
  test("percent into basis points and ppm", () => {
    expect(toCanonical("customer.tolerance", "2.5", "pct")).toMatchObject({ ok: true, value: 250 });
    expect(toCanonical("foundry.fraction", "0.4500", "pct")).toMatchObject({ ok: true, value: 4500 });
    expect(toCanonical("foundry.fraction", "0.45001", "pct").ok).toBe(false);
  });
  test("temperature takes a sign, and the other scales", () => {
    expect(toCanonical("ageing.temperature", "-5.5", "c")).toMatchObject({ ok: true, value: -55 });
    expect(toCanonical("ageing.temperature", "185", "c")).toMatchObject({ ok: true, value: 1850 });
    expect(toCanonical("ageing.temperature", "365", "f")).toMatchObject({ ok: true, value: 1850 });
  });
  test("limits: unsigned fields refuse a minus, hard caps refuse a slip", () => {
    const n = toCanonical("bundle.weight", "-5", "kg");
    expect(!n.ok && n.problem).toBe("negative");
    const big = toCanonical("bundle.weight", "999999999", "t");
    expect(!big.ok && big.problem).toBe("tooBig");
    const huge = toCanonical("bundle.weight", "9".repeat(25), "t", { mode: "round" });
    expect(!huge.ok && huge.problem).toBe("tooBig");
  });
  test("a sheet number is a double: noise past 15 digits is dropped, integers pass whole", () => {
    expect(toCanonical("bundle.weight", 12.300000000000001, "kg")).toMatchObject({ ok: true, value: 12300, exact: true });
    expect(toCanonical("bundle.weight", 0.1 + 0.2, "kg", { mode: "round" })).toMatchObject({ ok: true, value: 300, exact: true });
    expect(toCanonical("bundle.weight", 1.2e-7, "kg", { mode: "round" })).toMatchObject({ ok: true, value: 0, exact: false });
    expect(toCanonical("bundle.weight", Number.NaN, "kg").ok).toBe(false);
    expect(toCanonical("bundle.weight", 5000000, "g")).toMatchObject({ ok: true, value: 5000000 });
  });
  test("unknown unit text is a unit problem; unknown field is a programmer error", () => {
    const r = toCanonical("bundle.weight", "5", "nope" as never);
    expect(!r.ok && r.problem).toBe("unit");
    expect(() => toCanonical("no.such" as never, "5", "kg")).toThrow(RangeError);
  });
});

describe("checkMagnitude", () => {
  test("a 5,000 kg bundle is flagged and grams are offered", () => {
    const v = checkMagnitude("bundle.weight", 5_000_000, { text: "5000", unit: "kg" });
    expect(v).toEqual({ ok: false, level: "flag", side: "above", likelyUnit: "g", likelyValue: 5000 });
  });
  test("0.4 typed in kg: tonnes and quintals both fit, so no single offer", () => {
    const v = checkMagnitude("bundle.weight", 400, { text: "0.4", unit: "kg" });
    expect(v).toEqual({ ok: false, level: "flag", side: "below" });
  });
  test("an ordinary value passes; a value past the hard cap is refused", () => {
    expect(checkMagnitude("bundle.weight", 52_400)).toEqual({ ok: true });
    expect(checkMagnitude("bundle.weight", 60_000_000_000)).toMatchObject({ ok: false, level: "refuse", side: "above" });
  });
  test("two candidates mean no offer", () => {
    // 5000 INR/kg is 500,000 paise/kg: too high. Read as paise/kg or as INR/quintal it is 5000: two fits, so no offer.
    const v = checkMagnitude("order.rate", 500_000, { text: "5000", unit: "inr_kg" });
    expect(v).toEqual({ ok: false, level: "flag", side: "above" });
  });
  test("no entered text, no offer", () => {
    expect(checkMagnitude("bundle.weight", 5_000_000)).toEqual({ ok: false, level: "flag", side: "above" });
  });
});
