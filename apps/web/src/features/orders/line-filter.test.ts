import { describe, expect, test } from "bun:test";

import { filterOptions, lineFilterActive, NO_LINE_FILTER, serverLineFilter, shownOf, showLineFilters, type FilterableLine } from "./line-filter";

const line = (id: string, over: Partial<FilterableLine> = {}): FilterableLine => ({
  lineId: id,
  sectionId: "d1",
  sectionCode: "14701",
  sectionName: "Patti",
  series: "Patti",
  cutLengthMm: 3658,
  orderedG: 120_000,
  orderedPcs: 10,
  bakiG: 120_000,
  ...over,
});

describe("line filters (FP-OP-05)", () => {
  test("offered only on orders with 20 or more lines", () => {
    expect(showLineFilters(19)).toBe(false);
    expect(showLineFilters(20)).toBe(true);
  });

  test("the choices become the server's lineFilter; the server picks and totals the lines (review r1 I-1)", () => {
    expect(serverLineFilter(NO_LINE_FILTER)).toEqual({});
    expect(serverLineFilter({ die: "d2", length: "5486", stage: "planned", hasBaki: true })).toEqual({ dieId: "d2", cutLengthMm: 5486, stage: "planned", hasBaki: true });
    expect(serverLineFilter({ ...NO_LINE_FILTER, length: "abc" })).toEqual({});
  });

  test("the lines shown are the server's ids, in line order", () => {
    const lines = [line("a"), line("b"), line("c")];
    expect(shownOf(lines, ["c", "a"]).map((l) => l.lineId)).toEqual(["a", "c"]);
    expect(shownOf(lines, undefined).map((l) => l.lineId)).toEqual(["a", "b", "c"]);
  });

  test("options list each die and length once", () => {
    const lines = [line("a"), line("b", { cutLengthMm: 5486 }), line("c", { orderedPcs: null, orderedG: 50_000 })];
    expect(filterOptions(lines)).toEqual({ dies: [{ id: "d1", label: "14701 Patti" }], lengths: [3658, 5486] });
    expect(lineFilterActive(NO_LINE_FILTER)).toBe(false);
    expect(lineFilterActive({ ...NO_LINE_FILTER, hasBaki: true })).toBe(true);
  });
});
