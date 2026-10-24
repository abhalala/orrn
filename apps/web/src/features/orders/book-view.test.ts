import { describe, expect, test } from "bun:test";

import {
  activeBookFilters,
  barSegments,
  bookQueryInput,
  dispatchedPct,
  lateRuleKey,
  nothingPlanned,
  parseBookSearch,
  withBookFilter,
  type Bar,
} from "./book-view";

describe("the URL filters", () => {
  test("clean values pass, unknown or malformed ones are dropped, the open default is omitted", () => {
    expect(parseBookSearch({ show: "late", city: " Surat ", party: "c1", from: "2026-10-01", to: "2026-10-31", stage: "in_stock", q: "PO-4", page: "3" })).toEqual({
      show: "late",
      city: "Surat",
      party: "c1",
      from: "2026-10-01",
      to: "2026-10-31",
      stage: "in_stock",
      q: "PO-4",
      page: 3,
    });
    expect(parseBookSearch({ show: "open", stage: "nope", from: "yesterday", page: "-1", q: "  ", city: 5 })).toEqual({});
    expect(parseBookSearch({})).toEqual({});
  });

  test("a filter change goes back to page 1 and clears with an empty value", () => {
    const now = parseBookSearch({ city: "Surat", page: 4, stage: "planned" });
    expect(withBookFilter(now, { stage: "pressed" })).toEqual({ city: "Surat", stage: "pressed" });
    expect(withBookFilter(now, { city: "" })).toEqual({ stage: "planned" });
    expect(withBookFilter(now, { page: 2 })).toEqual({ city: "Surat", stage: "planned", page: 2 });
  });

  test("filters count apart from the status chip and the page", () => {
    expect(activeBookFilters({ show: "late", page: 2 })).toBe(0);
    expect(activeBookFilters({ city: "Surat", party: "c1", stage: "planned" })).toBe(3);
  });

  test("the list asks for exactly what is chosen", () => {
    expect(bookQueryInput({})).toEqual({ openOnly: true });
    expect(bookQueryInput({ show: "late" })).toEqual({ late: true });
    expect(bookQueryInput({ show: "closed", city: "Surat", party: "c1", from: "2026-10-01", to: "2026-10-31", stage: "over", q: "SO-2" })).toEqual({
      status: "closed",
      search: "SO-2",
      customerId: "c1",
      city: "Surat",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-31",
      stage: "over",
    });
    expect(bookQueryInput({ show: "dispatching" })).toEqual({ status: "dispatching" });
  });
});

describe("the bar", () => {
  const bar: Bar = { dispatchedG: 120_000, inStockG: 240_000, pressedG: 0, plannedG: 240_000, restG: 1_200_000, overG: 0, dispatchedBp: 667 };

  test("segments in bar order with CSS widths that follow the server's kg", () => {
    const segs = barSegments(bar, 1_800_000);
    expect(segs.map((s) => [s.key, s.grams])).toEqual([
      ["dispatched", 120_000],
      ["inStock", 240_000],
      ["pressed", 0],
      ["planned", 240_000],
      ["rest", 1_200_000],
    ]);
    expect(segs.reduce((n, s) => n + s.width, 0)).toBeCloseTo(100, 6);
    expect(segs[0]!.width).toBeCloseTo(6.667, 2);
  });

  test("an order with nothing ordered has no widths; an idle bar is a plain grey one", () => {
    expect(barSegments({ ...bar, dispatchedG: 0, inStockG: 0, plannedG: 0, restG: 0 }, 0).every((s) => s.width === 0)).toBe(true);
    expect(nothingPlanned({ ...bar, dispatchedG: 0, inStockG: 0, plannedG: 0 })).toBe(true);
    expect(nothingPlanned(bar)).toBe(false);
  });

  test("the dispatched share is written to one decimal, never a bare figure", () => {
    expect(dispatchedPct(667)).toBe("6.7");
    expect(dispatchedPct(10_000)).toBe("100");
    expect(dispatchedPct(0)).toBe("0");
    expect(dispatchedPct(5_050)).toBe("50.5");
  });

  test("which date made an order late", () => {
    expect(lateRuleKey("expected_date")).toBe("orders.lateRule.expected_date");
    expect(lateRuleKey("order_date")).toBe("orders.lateRule.order_date");
    expect(lateRuleKey(null)).toBe("orders.lateRule.order_date");
  });
});
