import { describe, expect, test } from "bun:test";

import { createI18n } from "@orrn/i18n";

import { categoryLabel, countedIn, purposeLabel, qtyProblemText, qtyText, unitName, unitShort } from "./store-labels";
import { ISSUE_PURPOSES, STORE_CATEGORIES, STORE_UNITS, type QtyProblem } from "./store-qty";

const PROBLEMS: QtyProblem[] = ["empty", "invalid", "zero", "decimals", "whole", "tooBig"];

describe("store labels resolve in both languages", () => {
  for (const locale of ["en", "hi"] as const) {
    const { t } = createI18n(locale);
    test(`${locale}: every unit, category, purpose and quantity problem has a real string`, () => {
      const all = [
        ...STORE_UNITS.flatMap((u) => [unitShort(t, u, 1000), unitShort(t, u), unitName(t, u)]),
        ...STORE_CATEGORIES.map((c) => categoryLabel(t, c)),
        ...[...ISSUE_PURPOSES, "exchange"].map((p) => purposeLabel(t, p)),
        ...PROBLEMS.map((p) => qtyProblemText(t, p)),
      ];
      expect(all.filter((s) => s.startsWith("store.") || s.includes("{"))).toEqual([]);
    });
  }
});

describe("quantity text", () => {
  const { t } = createI18n("en");

  test("number then short unit, singular for exactly one", () => {
    expect(qtyText(t, 12_500, "kg")).toBe("12.5 kg");
    expect(qtyText(t, 1000, "box")).toBe("1 box");
    expect(qtyText(t, 3000, "box")).toBe("3 boxes");
    expect(qtyText(t, 250, "litre")).toBe("0.25 L");
  });

  test("unknown values from older rows fall back instead of showing a key", () => {
    expect(categoryLabel(t, "mystery")).toBe("Other");
    expect(purposeLabel(t, "mystery")).toBe("Other");
  });

  test("counted-in line", () => {
    expect(countedIn(t, { category: "chemical", unit: "kg" })).toBe("Chemical, counted in kg");
  });
});
