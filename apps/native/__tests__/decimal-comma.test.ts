/**
 * Decimal comma in a plain number box (units sweep 3, M3), on the phone. The phone reads typed numbers through the same
 * `@orrn/domain` rule as the web: a comma is digit grouping ("1,000", "1,00,000", "12,345.5") or the text is not a number.
 * "2,5" used to store 25, "4,50" 450 and "1,2,3" 123. The REFUSED list is the one intended difference from before.
 */
import { describe, expect, test } from "bun:test";

import { parseDecimal } from "@orrn/domain";

import { gasFromText, wholeFromText, x10FromText } from "../features/ageing/model";
import { parseKgToMilli } from "../features/dies/copy-model";
import { countedBillets } from "../features/foundry/foundry-model";
import { ftToMm, inchToTenth, kgToG, qtyToMilli } from "../features/foundry/melt-form";
import { parseKgG, parsePieces } from "../features/orders/booking-form";

const REFUSED = ["2,5", "4,50", "1,2,3", "12,5"];

describe("the phone's number parsers read correct grouping as before", () => {
  test("shared parseDecimal", () => {
    expect(parseDecimal("1,000")).toBe(1000);
    expect(parseDecimal("1,00,000")).toBe(100_000);
    expect(parseDecimal("12,345.5")).toBe(12_345.5);
  });
  test("melt form kg", () => {
    expect(kgToG("1,000")).toBe(1_000_000);
    expect(kgToG("1,00,000")).toBe(100_000_000);
    expect(kgToG("12,345.5")).toBe(12_345_500);
  });
  test("booking form kg and pieces", () => {
    expect(parseKgG("12,345.5")).toBe(12_345_500);
    expect(parsePieces("1,000")).toBe(1000);
  });
  test("ageing whole numbers", () => {
    expect(wholeFromText("1,000")).toBe(1000);
  });
  test("foundry closing count", () => {
    expect(countedBillets("1,200", "12,345.5")).toEqual({ ok: true, billetsOnHand: { count: 1200, kgG: 12_345_500 } });
  });
});

describe("a decimal comma or stray comma is not a number on the phone either", () => {
  for (const text of REFUSED) {
    test(`"${text}"`, () => {
      expect(parseDecimal(text)).toBeNull();
      expect(kgToG(text)).toBeNull();
      expect(ftToMm(text)).toBeNull();
      expect(inchToTenth(text)).toBeNull();
      expect(qtyToMilli(text)).toBeNull();
      expect(parseKgG(text)).toBeNull();
      expect(parsePieces(text)).toBeNull();
      expect(wholeFromText(text)).toBeNull();
      expect(x10FromText(text)).toBeNull();
      expect(gasFromText(text)).toBeNull();
      expect(parseKgToMilli(text)).toBeNull();
      expect(countedBillets("10", text)).toEqual({ ok: false, issue: "kg" });
      expect(countedBillets(text, "10")).toEqual({ ok: false, issue: "pcs" });
    });
  }
  test("a plain decimal point still works", () => {
    expect(kgToG("2.5")).toBe(2500);
    expect(parseKgToMilli("2.5")).toBe(2500);
  });
});
