import { describe, expect, test } from "bun:test";

import { bpPercent1 } from "@orrn/domain";
import { createI18n } from "@orrn/i18n";

import {
  activeBookFilters,
  barSegments,
  bookQueryInput,
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
  const bar: Bar = { dispatchedG: 120_000, inStockG: 240_000, inStockBarG: 240_000, heldG: 0, pressedG: 0, plannedG: 240_000, restG: 1_200_000, overG: 0, dispatchedBp: 667 };

  test("segments in bar order carry the server's kg (drawn as flex-grow, nothing divided here)", () => {
    const segs = barSegments({ ...bar, heldG: 60_000, restG: 1_140_000 });
    expect(segs.map((s) => [s.key, s.grams])).toEqual([
      ["dispatched", 120_000],
      ["inStock", 240_000],
      ["held", 60_000],
      ["pressed", 0],
      ["planned", 240_000],
      ["rest", 1_140_000],
    ]);
    expect(segs.map((s) => s.stage)).toEqual(["dispatched", "in_stock", "held", "pressed", "planned", "unplanned"]);
  });

  test("BACKLOG 52: in stock past the baki is drawn capped but labelled whole (the line strip's figure)", () => {
    // SO-5 line 3: ordered 250, dispatched 184.546, in stock 105.895 of which 65.454 fits the bar.
    const segs = barSegments({ dispatchedG: 184_546, inStockG: 105_895, inStockBarG: 65_454, heldG: 0, pressedG: 0, plannedG: 0, restG: 0, overG: 40_441, dispatchedBp: 7382 });
    const inStock = segs.find((s) => s.key === "inStock")!;
    expect(inStock.grams).toBe(65_454);
    expect(inStock.labelG).toBe(105_895);
    expect(segs.reduce((acc, s) => acc + s.grams, 0)).toBe(250_000);
    expect(segs.filter((s) => s.key !== "inStock").every((s) => s.labelG === s.grams)).toBe(true);
    // Fully dispatched with stock left over: nothing drawn for it, but it is still named.
    const full = barSegments({ dispatchedG: 250_000, inStockG: 50_000, inStockBarG: 0, heldG: 0, pressedG: 0, plannedG: 0, restG: 0, overG: 50_000, dispatchedBp: 10_000 });
    expect(full.find((s) => s.key === "inStock")).toMatchObject({ grams: 0, labelG: 50_000 });
  });

  test("an idle bar is a plain grey one; held stock is not idle", () => {
    expect(nothingPlanned({ ...bar, dispatchedG: 0, inStockG: 0, plannedG: 0 })).toBe(true);
    expect(nothingPlanned({ ...bar, dispatchedG: 0, inStockG: 0, plannedG: 0, heldG: 1 })).toBe(false);
    expect(nothingPlanned(bar)).toBe(false);
  });

  test("the dispatched share is the server's basis points written to one decimal (bpPercent1)", () => {
    expect(bpPercent1(667)).toBe("6.7");
    expect(bpPercent1(10_000)).toBe("100.0");
    expect(bpPercent1(0)).toBe("0.0");
  });

  test("which date made an order late", () => {
    expect(lateRuleKey("expected_date")).toBe("orders.lateRule.expected_date");
    expect(lateRuleKey("order_date")).toBe("orders.lateRule.order_date");
    expect(lateRuleKey(null)).toBe("orders.lateRule.order_date");
  });
});

describe("one word per figure (review round 1, m3)", () => {
  test("the bar's legend and the stage filter say the same words as the book header strip (en and hi)", () => {
    const segs = barSegments({ dispatchedG: 1, inStockG: 1, inStockBarG: 1, heldG: 1, pressedG: 1, plannedG: 1, restG: 1, overG: 0, dispatchedBp: 0 });
    for (const lang of ["en", "hi"] as const) {
      const t = createI18n(lang).t;
      expect(t(segs.find((x) => x.key === "inStock")!.labelKey)).toBe(t("orders.book.strip.inStock"));
      expect(t(segs.find((x) => x.key === "held")!.labelKey)).toBe(t("orders.book.strip.held"));
    }
    expect(createI18n("en").t("orders.book.strip.inStock")).toBe("Allocated to orders");
    expect(createI18n("en").t("orders.book.strip.held")).toBe("Held for orders");
  });
});
