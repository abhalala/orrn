/** FP-OP-14 value on dispatch: `Σ round(weightG × ratePaise / 1000)`; a missing rate is counted, never zeroes the sum. */
import { describe, expect, test } from "bun:test";

import { dispatchValue, itemValuePaise } from "./orders";

describe("itemValuePaise", () => {
  test("₹425/kg on 1,234.567 kg weighed = ₹5,24,690.98 (paise, rounded once per item)", () => {
    // 1_234_567 g × 42_500 paise/kg / 1000 = 52_469_097.5 → 52_469_098 (half up)
    expect(itemValuePaise(1_234_567, 42_500)).toBe(52_469_098);
  });
  test("exact kg", () => {
    expect(itemValuePaise(100_000, 42_500)).toBe(4_250_000); // 100 kg × ₹425 = ₹42,500
  });
  test("a few grams still round to the nearest paisa", () => {
    expect(itemValuePaise(1, 42_500)).toBe(43); // 42.5 → 43
    expect(itemValuePaise(1, 1)).toBe(0);
  });
});

describe("dispatchValue", () => {
  test("sums rated items and counts the rest as rateMissing", () => {
    const v = dispatchValue([
      { weightG: 100_000, ratePaise: 42_500 },
      { weightG: 50_500, ratePaise: 41_000 },
      { weightG: 70_000, ratePaise: null },
      { weightG: 1_000, ratePaise: undefined },
    ]);
    expect(v.valuePaise).toBe(4_250_000 + 2_070_500);
    expect(v.pricedItems).toBe(2);
    expect(v.pricedG).toBe(150_500);
    expect(v.rateMissing).toBe(2);
    expect(v.missingG).toBe(71_000);
  });
  test("rounding is per item, not on the total", () => {
    // Two 1 g rows at ₹425/kg: 43 + 43 paise, not round(85) = 85.
    expect(dispatchValue([{ weightG: 1, ratePaise: 42_500 }, { weightG: 1, ratePaise: 42_500 }]).valuePaise).toBe(86);
  });
  test("no items, no value", () => {
    expect(dispatchValue([])).toEqual({ valuePaise: 0, pricedItems: 0, pricedG: 0, rateMissing: 0, missingG: 0 });
  });
  test("a zero rate is a rate (₹0), not a missing one", () => {
    const v = dispatchValue([{ weightG: 5_000, ratePaise: 0 }]);
    expect(v).toMatchObject({ valuePaise: 0, pricedItems: 1, rateMissing: 0 });
  });
});
