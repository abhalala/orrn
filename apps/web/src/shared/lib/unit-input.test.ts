import { describe, expect, test } from "bun:test";

import { formatterFor, screenPrefs, type FieldId, type ResolvedPrefs } from "@orrn/domain";
import { createI18n } from "@orrn/i18n";

import { readUnitEntry, stepUnitText, unitEntryText, unitProblemText } from "./unit-input";

const { t } = createI18n("en");
const IST = { locale: "en", timeZone: "Asia/Kolkata" } as const;
const fmtOf = (prefs: Parameters<typeof screenPrefs>[0] = {}) => formatterFor(screenPrefs(prefs), IST);

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe("typing in pounds stores exact grams and reads back the same text", () => {
  const lb = fmtOf({ units: { mass: "lb" } });
  test("115.6 lb is 52435 g, and 52435 g reads 115.6 again", () => {
    const e = readUnitEntry(lb, "bundle.weight", "115.6");
    expect(e).toMatchObject({ state: "ok", value: 52435 });
    expect(unitEntryText(lb, "bundle.weight", 52435)).toBe("115.6");
  });
  test("over 5,000 random pound texts of up to 2 decimals: text, stored grams, text", () => {
    const r = mulberry(42);
    for (let i = 0; i < 5000; i++) {
      const whole = Math.floor(r() * 2000);
      const dec = Math.floor(r() * 3);
      const frac = dec === 0 ? "" : String(Math.floor(r() * 10 ** dec)).padStart(dec, "0");
      const text = dec === 0 ? String(whole) : `${whole}.${frac}`;
      const e = readUnitEntry(lb, "bundle.weight", text);
      expect(e.state).toBe("ok");
      if (e.state !== "ok") continue;
      // What was typed, stored, shown at entry digits: the same number (trailing zeros trimmed).
      const want = dec === 0 ? String(whole) : `${whole}.${frac}`.replace(/\.?0+$/, "");
      expect(unitEntryText(lb, "bundle.weight", e.value)).toBe(want === "" ? "0" : want);
    }
  });
  test("text finer than 2 decimals of a pound is refused, with the unit and the places named", () => {
    const e = readUnitEntry(lb, "bundle.weight", "115.555");
    expect(e).toEqual({ state: "refused", problem: "decimals" });
    expect(unitProblemText(t, lb, "bundle.weight", "decimals")).toBe("Too many decimal places for lb. Use at most 2.");
    expect(stepUnitText(t, lb, "bundle.weight", "115.555").problem).toBe("Too many decimal places for lb. Use at most 2.");
    expect(stepUnitText(t, lb, "bundle.weight", "115.555").value).toBeNull();
  });
});

describe("the default plant (kg, mm)", () => {
  const kg = fmtOf();
  test("kg takes 3 decimals and refuses a fourth", () => {
    expect(readUnitEntry(kg, "order.weight", "12.345")).toMatchObject({ state: "ok", value: 12345 });
    expect(readUnitEntry(kg, "order.weight", "1,280.5")).toMatchObject({ state: "ok", value: 1_280_500 });
    expect(readUnitEntry(kg, "order.weight", "12.3456")).toEqual({ state: "refused", problem: "decimals" });
    expect(unitProblemText(t, kg, "order.weight", "decimals")).toBe("Too many decimal places for kg. Use at most 3.");
  });
  test("mm takes whole mm only", () => {
    expect(readUnitEntry(kg, "bundle.length", "3658")).toMatchObject({ state: "ok", value: 3658 });
    expect(readUnitEntry(kg, "bundle.length", "3658.5")).toEqual({ state: "refused", problem: "decimals" });
    expect(unitProblemText(t, kg, "bundle.length", "decimals")).toBe("mm takes whole numbers only.");
  });
  test("junk, minus and blank", () => {
    // "abc" after the 12 is read as a unit name nobody has, so it is refused: the old reader took 12.
    expect(readUnitEntry(kg, "bundle.length", "12abc")).toEqual({ state: "refused", problem: "unit" });
    expect(stepUnitText(t, kg, "bundle.length", "12abc").problem).toBe("That is not a number in mm.");
    expect(readUnitEntry(kg, "bundle.length", "1e3").state).toBe("refused");
    expect(readUnitEntry(kg, "order.weight", "-3")).toEqual({ state: "refused", problem: "negative" });
    expect(readUnitEntry(kg, "order.weight", "   ")).toEqual({ state: "blank" });
    expect(stepUnitText(t, kg, "order.weight", "").problem).toBeNull();
    expect(stepUnitText(t, kg, "order.weight", "", true).problem).toBe("Enter a value.");
  });
  test("pieces are whole", () => {
    expect(readUnitEntry(kg, "bundle.pieces", "21")).toMatchObject({ state: "ok", value: 21 });
    expect(readUnitEntry(kg, "bundle.pieces", "21.5").state).toBe("refused");
  });
  test("a rate in rupees per kg: 2 decimals, exact paise", () => {
    expect(readUnitEntry(kg, "order.rate", "201.5")).toMatchObject({ state: "ok", value: 20150 });
    expect(readUnitEntry(kg, "order.rate", "1.005")).toEqual({ state: "refused", problem: "decimals" });
    expect(readUnitEntry(kg, "order.rate", "1.01")).toMatchObject({ state: "ok", value: 101 });
  });
});

describe("feet and inches", () => {
  const ftin = fmtOf({ units: { length: "ft_in" } });
  test("the written forms all read 12 ft 6 in", () => {
    for (const text of [`12 ft 6 in`, `12' 6"`, "12-6", "12 ft 6", "12ft6in"]) {
      expect(readUnitEntry(ftin, "bundle.length", text)).toMatchObject({ state: "ok", value: 3810 });
    }
  });
  test("sixteenths are the finest step", () => {
    expect(readUnitEntry(ftin, "bundle.length", "12 ft 6 1/16 in")).toMatchObject({ state: "ok" });
    expect(readUnitEntry(ftin, "bundle.length", "12 ft 6.33 in")).toEqual({ state: "refused", problem: "decimals" });
    expect(unitProblemText(t, ftin, "bundle.length", "decimals")).toBe("Too fine. Use steps of 1/16 in.");
  });
  test("a stored length reads back as the text a person would type", () => {
    expect(unitEntryText(ftin, "bundle.length", 3810)).toBe("12 ft 6 in");
    const text = unitEntryText(ftin, "bundle.length", 3658);
    expect(readUnitEntry(ftin, "bundle.length", text)).toMatchObject({ state: "ok", value: 3658 });
  });
  test("26 ft 10.5 in is 8192 mm (the float sum gave 8191)", () => {
    expect(readUnitEntry(ftin, "bundle.length", "26 ft 10.5 in")).toMatchObject({ state: "ok", value: 8192 });
  });
  test("metres: 3 decimals", () => {
    const m = fmtOf({ units: { length: "m" } });
    expect(readUnitEntry(m, "bundle.length", "3.658")).toMatchObject({ state: "ok", value: 3658 });
    expect(readUnitEntry(m, "bundle.length", "3.6584")).toEqual({ state: "refused", problem: "decimals" });
  });
});

describe("section weight and number style", () => {
  test("kg per metre and lb per foot to grams per 12 ft", () => {
    const km = fmtOf({ units: { linear_mass: "kg_m" } });
    expect(readUnitEntry(km, "die.band", "0.571")).toMatchObject({ state: "ok", value: 2088 }); // 0.571 x 3657.6 = 2088.4
    const lf = fmtOf({ units: { linear_mass: "lb_ft" } });
    expect(readUnitEntry(lf, "die.band", "0.384")).toMatchObject({ state: "ok" });
  });
  test("decimal comma and dot grouping", () => {
    const eu = fmtOf({ number: { grouping: "international", decimal: ",", group: "." } });
    expect(readUnitEntry(eu, "order.weight", "1.280,5")).toMatchObject({ state: "ok", value: 1_280_500 });
    expect(unitEntryText(eu, "order.weight", 1_280_500)).toBe("1280,5");
  });
});

describe("fields that are not on the default set stay put", () => {
  test("the resolved set for a plant that changed nothing reads kg and mm", () => {
    const prefs: ResolvedPrefs = screenPrefs({});
    expect(prefs.units.mass).toBe("kg");
    const f: FieldId = "bundle.weight";
    expect(fmtOf().entryText(f, 12_500)).toBe("12.5");
  });
});
