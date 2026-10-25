import { describe, expect, test } from "bun:test";

import { formatRupees, valueCardModel } from "./value-view";

describe("FP-OP-14 dispatch value card", () => {
  test("no value (rates off or no order.price): no card", () => {
    expect(valueCardModel(null)).toBeNull();
    expect(valueCardModel(undefined)).toBeNull();
  });
  test("rupees with Indian grouping and two decimals", () => {
    expect(formatRupees(9_371_293)).toBe("₹93,712.93");
    expect(formatRupees(1_23_45_678_90)).toBe("₹1,23,45,678.90");
    expect(formatRupees(0)).toBe("₹0.00");
  });
  test("missing rates are listed with their kg; all priced has none", () => {
    const m = valueCardModel({ valuePaise: 9_371_293, pricedItems: 2, pricedG: 220_501, rateMissing: 1, missingG: 80_000, complete: false });
    expect(m?.amount).toBe("₹93,712.93");
    expect(m?.missing?.count).toBe(1);
    expect(m?.missing?.kg).toBeTruthy();
    expect(valueCardModel({ valuePaise: 100, pricedItems: 1, pricedG: 1000, rateMissing: 0, missingG: 0, complete: true })?.missing).toBeNull();
  });
});
