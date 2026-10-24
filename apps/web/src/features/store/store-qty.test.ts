import { describe, expect, test } from "bun:test";

import {
  COUNTABLE_STORE_UNITS as SERVER_COUNTABLE,
  storeCategories,
  storeIssuePurposes,
  storeUnits,
  // @orrn/db is not a web dependency; the test reads the schema source directly.
} from "../../../../../packages/db/src/schema/store";
import { MAX_STORE_QTY_MILLI } from "@orrn/server/lib/store";

import {
  COUNTABLE_UNITS,
  ISSUE_PURPOSES,
  MAX_QTY_MILLI,
  STORE_CATEGORIES,
  STORE_UNITS,
  formatQty,
  isCountable,
  isShort,
  parseQtyMilli,
  qtyToText,
} from "./store-qty";

describe("constants mirror the server", () => {
  test("units, categories, purposes and the cap match @orrn/db and lib/store", () => {
    expect([...STORE_UNITS]).toEqual([...storeUnits]);
    expect([...COUNTABLE_UNITS]).toEqual([...SERVER_COUNTABLE]);
    expect([...STORE_CATEGORIES]).toEqual([...storeCategories]);
    // `exchange` is only the outgoing leg of store.exchange, never picked on the Issue form.
    expect([...ISSUE_PURPOSES]).toEqual(storeIssuePurposes.filter((p) => p !== "exchange"));
    expect(MAX_QTY_MILLI).toBe(MAX_STORE_QTY_MILLI);
  });
});

describe("parseQtyMilli", () => {
  test("whole and decimal kg become exact milli-units (no float drift)", () => {
    expect(parseQtyMilli("12", "kg")).toEqual({ ok: true, milli: 12_000 });
    expect(parseQtyMilli("12.5", "kg")).toEqual({ ok: true, milli: 12_500 });
    expect(parseQtyMilli("12.345", "kg")).toEqual({ ok: true, milli: 12_345 });
    expect(parseQtyMilli("0.001", "litre")).toEqual({ ok: true, milli: 1 });
    expect(parseQtyMilli("1.005", "kg")).toEqual({ ok: true, milli: 1_005 });
    expect(parseQtyMilli(".5", "kg")).toEqual({ ok: true, milli: 500 });
    expect(parseQtyMilli("3.", "kg")).toEqual({ ok: true, milli: 3_000 });
  });

  test("commas and spaces from typing are ignored", () => {
    expect(parseQtyMilli(" 1,250.75 ", "litre")).toEqual({ ok: true, milli: 1_250_750 });
  });

  test("empty, junk, zero, too many decimals", () => {
    expect(parseQtyMilli("", "kg")).toEqual({ ok: false, problem: "empty" });
    expect(parseQtyMilli("   ", "kg")).toEqual({ ok: false, problem: "empty" });
    expect(parseQtyMilli("12a", "kg")).toEqual({ ok: false, problem: "invalid" });
    expect(parseQtyMilli("-3", "kg")).toEqual({ ok: false, problem: "invalid" });
    expect(parseQtyMilli("1e3", "kg")).toEqual({ ok: false, problem: "invalid" });
    expect(parseQtyMilli("0", "kg")).toEqual({ ok: false, problem: "zero" });
    expect(parseQtyMilli("0.000", "kg")).toEqual({ ok: false, problem: "zero" });
    expect(parseQtyMilli("1.2345", "kg")).toEqual({ ok: false, problem: "decimals" });
  });

  test("countable units take whole numbers only", () => {
    expect(parseQtyMilli("4", "piece")).toEqual({ ok: true, milli: 4_000 });
    expect(parseQtyMilli("4.0", "box")).toEqual({ ok: true, milli: 4_000 });
    expect(parseQtyMilli("1.5", "piece")).toEqual({ ok: false, problem: "whole" });
    expect(parseQtyMilli("2.25", "bag")).toEqual({ ok: false, problem: "whole" });
    expect(parseQtyMilli("1.5", "metre")).toEqual({ ok: true, milli: 1_500 });
  });

  test("the server cap of 100,000 units per entry", () => {
    expect(parseQtyMilli("100000", "kg")).toEqual({ ok: true, milli: 100_000_000 });
    expect(parseQtyMilli("100000.001", "kg")).toEqual({ ok: false, problem: "tooBig" });
    expect(parseQtyMilli("99999999999999999999", "kg")).toEqual({ ok: false, problem: "tooBig" });
  });

  test("no unit yet (item not chosen) still parses decimals", () => {
    expect(parseQtyMilli("2.5", null)).toEqual({ ok: true, milli: 2_500 });
  });
});

describe("formatQty and qtyToText", () => {
  test("Indian grouping, up to three decimals, trailing zeros dropped, Latin digits", () => {
    expect(formatQty(12_500)).toBe("12.5");
    expect(formatQty(12_000)).toBe("12");
    expect(formatQty(1)).toBe("0.001");
    expect(formatQty(12_345_678_900)).toBe("1,23,45,678.9");
    expect(formatQty(0)).toBe("0");
  });

  test("negative balances (legacy data) keep the sign", () => {
    expect(formatQty(-2_500)).toBe("-2.5");
  });

  test("qtyToText round-trips into the input without grouping", () => {
    expect(qtyToText(1_250_750)).toBe("1250.75");
    expect(parseQtyMilli(qtyToText(1_250_750), "litre")).toEqual({ ok: true, milli: 1_250_750 });
  });
});

describe("isCountable and isShort", () => {
  test("countable units", () => {
    expect(isCountable("piece")).toBe(true);
    expect(isCountable("kg")).toBe(false);
  });

  test("an issue is short only when it takes more than the balance", () => {
    expect(isShort(5_000, 5_000)).toBe(false);
    expect(isShort(5_001, 5_000)).toBe(true);
    expect(isShort(1, 0)).toBe(true);
    expect(isShort(1, -10)).toBe(true);
  });
});
