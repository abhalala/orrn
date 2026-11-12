/**
 * Decimal comma in a plain number box (units sweep 3, M3). Before: every form parser dropped every comma, so "2,5" kg stored
 * 25 kg, "12,5" stored 125 kg and "4,50" stored 450. Now, for every plant, a comma is accepted only as digit grouping
 * (`withoutGrouping` in `@orrn/domain`): the last group is exactly three digits, a group before it two or three, then an
 * optional decimal point part. These are the nine parsers the sweep named, plus the shared one they read through, and the
 * other form parsers that kept their own digit pattern. The one intended difference from before is the REFUSED list below.
 */
import { describe, expect, test } from "bun:test";

import { parseDecimal } from "@orrn/domain";

import { kgFromText } from "@/features/ageing/model";
import { readDecimal } from "@/features/dies/die-model";
import { parseGrams, parseKgToMilli, parseWallTenths, parseWholeKgToGrams } from "@/features/die-room/die-room-model";
import { parseCapacityKg } from "@/features/dispatch/transport";
import { countedBillets } from "@/features/foundry/model";
import { kgToG as meltKgToG } from "@/features/foundry/melt-form";
import { parseKgPer12ftMilli, parsePercentBp, parseWholeNumber } from "@/features/masters/masters-model";
import { parseKgG } from "@/features/orders/line-model";
import { kgTextToG as pressKgTextToG } from "@/features/press/model";
import { kgTextToG as kantaKgTextToG } from "@/features/purchase/kanta";
import { parseQtyMilli } from "@/features/store/store-qty";

/** The one intended difference from before: each of these was read ten or a hundred times too large. */
const REFUSED = ["2,5", "4,50", "1,2,3", "12,5"];
/** Read exactly as before. */
const GROUPED = [
  { text: "1,000", kg: 1000 },
  { text: "1,00,000", kg: 100_000 },
  { text: "12,345.5", kg: 12_345.5 },
];

const grams = (kg: number) => Math.round(kg * 1000);

/** Each parser: how it answers for a number of kg that reads fine, and how it says "not a number". */
const PARSERS: { name: string; read: (text: string) => unknown; ok: (kg: number) => unknown; refused: unknown }[] = [
  { name: "shared parseDecimal", read: parseDecimal, ok: (kg) => kg, refused: null },
  { name: "orders parseKgG", read: parseKgG, ok: grams, refused: null },
  { name: "press kgTextToG", read: pressKgTextToG, ok: grams, refused: null },
  { name: "purchase kanta kgTextToG", read: kantaKgTextToG, ok: grams, refused: null },
  { name: "foundry melt-form kgToG", read: meltKgToG, ok: grams, refused: null },
  { name: "dispatch parseCapacityKg", read: parseCapacityKg, ok: grams, refused: undefined },
  { name: "ageing kgFromText", read: kgFromText, ok: grams, refused: null },
  { name: "die-room parseWholeKgToGrams", read: (t) => parseWholeKgToGrams(t), ok: (kg) => (Number.isInteger(kg) ? grams(kg) : null), refused: null },
  { name: "die-model readDecimal", read: readDecimal, ok: (kg) => kg, refused: null },
];

describe("every kg parser reads correct grouping as before", () => {
  for (const p of PARSERS) {
    for (const g of GROUPED) {
      test(`${p.name}: "${g.text}"`, () => {
        expect(p.read(g.text)).toEqual(p.ok(g.kg));
        // The same figure typed without commas reads the same, so grouping changes nothing.
        expect(p.read(g.text)).toEqual(p.read(String(g.kg)));
      });
    }
  }
  test("store parseQtyMilli: grouping and spaces read as before", () => {
    expect(parseQtyMilli("1,000", null)).toMatchObject({ ok: true, milli: 1_000_000 });
    expect(parseQtyMilli("1,00,000", null)).toMatchObject({ ok: true, milli: 100_000_000 });
    expect(parseQtyMilli("12,345.5", null)).toMatchObject({ ok: true, milli: 12_345_500 });
    expect(parseQtyMilli("1 000", null)).toMatchObject({ ok: true, milli: 1_000_000 });
  });
});

describe("a decimal comma or stray comma is refused with the field's own 'enter a number' answer", () => {
  for (const p of PARSERS) {
    for (const text of REFUSED) {
      test(`${p.name}: "${text}"`, () => {
        expect(p.read(text)).toBe(p.refused as never);
      });
    }
  }
  test("store parseQtyMilli: refused as invalid, never 25 or 450 units", () => {
    for (const text of REFUSED) expect(parseQtyMilli(text, null)).toEqual({ ok: false, problem: "invalid" });
    expect(parseQtyMilli("2,5", "kg")).toEqual({ ok: false, problem: "invalid" });
    expect(parseQtyMilli("", null)).toEqual({ ok: false, problem: "empty" });
    expect(parseQtyMilli("   ", null)).toEqual({ ok: false, problem: "empty" });
  });
  test("die-room parseKgToMilli (kg per 12 ft, at most 500): 2,5 was read as 25 kg, now refused", () => {
    expect(parseKgToMilli("2.5")).toBe(2500);
    for (const text of REFUSED) expect(parseKgToMilli(text)).toBeNull();
    // A grouped figure is over the 500 kg cap, as it was.
    expect(parseKgToMilli("1,000")).toBeNull();
  });
});

describe("the other form parsers with their own digit pattern follow the same rule", () => {
  test("die-room wall tenths and grams", () => {
    expect(parseWallTenths("1.5")).toBe(15);
    expect(parseWallTenths("1,5")).toBeNull();
    expect(parseGrams("1,000")).toBe(1000);
    expect(parseGrams("2,5")).toBeNull();
    expect(parseGrams("1,00,000")).toBe(100_000);
  });
  test("foundry closing count: pieces and kg", () => {
    expect(countedBillets("1,200", "12,345.5")).toEqual({ ok: true, billetsOnHand: { count: 1200, kgG: 12_345_500 } });
    expect(countedBillets("2,5", "10")).toEqual({ ok: false, issue: "pcs" });
    expect(countedBillets("10", "2,5")).toEqual({ ok: false, issue: "kg" });
  });
  test("masters: percent, kg per 12 ft, whole numbers", () => {
    expect(parsePercentBp("88.5")).toEqual({ ok: true, value: 8850 });
    expect(parsePercentBp("88,5").ok).toBe(false);
    expect(parseKgPer12ftMilli("1.842")).toEqual({ ok: true, value: 1842 });
    expect(parseKgPer12ftMilli("1,842").ok).toBe(false);
    expect(parseWholeNumber("1,000", { min: 1, max: 5000 })).toEqual({ ok: true, value: 1000 });
    expect(parseWholeNumber("2,5", { min: 1, max: 5000 }).ok).toBe(false);
  });
});
