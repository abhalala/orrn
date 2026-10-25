import { describe, expect, test } from "bun:test";

import { parseAgeingReportSearch, parseHistorySearch, parseLoadSearch } from "./search";

describe("ageing search params", () => {
  test("history keeps good days, ids and statuses and drops the rest", () => {
    expect(parseHistorySearch({ from: "2026-10-01", to: "2026-10-25", oven: "o1", status: "held", recipe: "6063", offset: "50" })).toEqual({ from: "2026-10-01", to: "2026-10-25", oven: "o1", status: "held", recipe: "6063", offset: 50 });
    expect(parseHistorySearch({ from: "yesterday", status: "nope", offset: "-3", oven: "x".repeat(80) })).toEqual({});
  });
  test("the report takes shift and grouping, no recipe", () => {
    expect(parseAgeingReportSearch({ from: "2026-10-01", shift: "s1", group: "oven", recipe: "6063" })).toEqual({ from: "2026-10-01", shift: "s1", group: "oven" });
    expect(parseAgeingReportSearch({ group: "year" })).toEqual({});
  });
  test("load takes a trolley and a batch id", () => {
    expect(parseLoadSearch({ trolley: "t1", batch: "b1" })).toEqual({ trolley: "t1", batch: "b1" });
    expect(parseLoadSearch({ trolley: 5 })).toEqual({});
  });
});
