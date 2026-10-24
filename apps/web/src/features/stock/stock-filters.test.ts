import { describe, expect, test } from "bun:test";

import { activeFilterCount, filterPatch, stockFilterInput, validateStockFilter, withoutFilters } from "./stock-filters";

describe("stock filters in the URL", () => {
  test("valid fields are kept, junk is dropped", () => {
    expect(
      validateStockFilter({ yard: "y1", customer: "c1", order: "o1", plant: "1", kind: "hollow", from: "2026-10-01", to: "2026-10-24", dieId: "d1", extra: "x" }),
    ).toEqual({ yard: "y1", customer: "c1", order: "o1", plant: true, kind: "hollow", from: "2026-10-01", to: "2026-10-24", dieId: "d1" });
    expect(validateStockFilter({ kind: "round", from: "2026-13-40", to: "yesterday", yard: "", plant: "0" })).toEqual({});
    expect(validateStockFilter({ yard: "x".repeat(65) })).toEqual({});
  });

  test("plant arrives as true, 1 or the strings the router leaves it as", () => {
    for (const v of [true, 1, "1", "true"]) expect(validateStockFilter({ plant: v }).plant).toBe(true);
    expect(validateStockFilter({ plant: false })).toEqual({});
  });

  test("an order needs its customer", () => {
    expect(validateStockFilter({ order: "o1" })).toEqual({});
  });

  test("server input: names, and a backwards date range is swapped", () => {
    expect(stockFilterInput({ yard: "y1", customer: "c1", order: "o1", kind: "solid", dieId: "d1", from: "2026-10-24", to: "2026-10-01" })).toEqual({
      locationId: "y1",
      customerId: "c1",
      salesOrderId: "o1",
      profileKind: "solid",
      packedFrom: "2026-10-01",
      packedTo: "2026-10-24",
      dieId: "d1",
    });
    expect(stockFilterInput({ plant: true })).toEqual({ plantStock: true });
    expect(stockFilterInput({})).toEqual({});
  });

  test("count and clearing leave the other keys alone", () => {
    expect(activeFilterCount({ yard: "y1", plant: true })).toBe(2);
    expect(withoutFilters({ status: "available", yard: "y1", kind: "hollow", q: "26J" } as never)).toEqual({ status: "available", q: "26J" });
  });

  test("changing the customer clears the order; plant stock and a customer exclude each other", () => {
    expect(filterPatch({ customer: "c1", order: "o1" }, { customer: "c2" })).toEqual({ customer: "c2", order: undefined, plant: undefined });
    expect(filterPatch({ customer: "c1", order: "o1" }, { customer: "c1" })).toEqual({ customer: "c1", plant: undefined });
    expect(filterPatch({ customer: "c1", order: "o1" }, { plant: true })).toEqual({ plant: true, customer: undefined, order: undefined });
  });
});
