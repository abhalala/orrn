import { describe, expect, test } from "bun:test";

import { filterLines, filterOptions, inStage, lineFilterActive, matchesLine, NO_LINE_FILTER, shownTotals, showLineFilters, type FilterableLine, type FilterableStrip } from "./line-filter";

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
const strip = (over: Partial<FilterableStrip> = {}): FilterableStrip => ({ dispatchedG: 0, inStockG: 0, pressedG: 0, plannedG: 0, planableG: 120_000, overG: 0, ...over });

describe("line filters (FP-OP-05)", () => {
  test("offered only on orders with 20 or more lines", () => {
    expect(showLineFilters(19)).toBe(false);
    expect(showLineFilters(20)).toBe(true);
  });

  test("die, cut length, stage and has baki each narrow the lines", () => {
    const lines = [
      line("a"),
      line("b", { sectionId: "d2", sectionCode: "11250", cutLengthMm: 5486, bakiG: 0 }),
      line("c", { cutLengthMm: 5486 }),
    ];
    const strips = new Map<string, FilterableStrip>([
      ["a", strip({ inStockG: 100_000 })],
      ["b", strip({ dispatchedG: 120_000, planableG: 0 })],
      ["c", strip({ plannedG: 120_000, planableG: 0 })],
    ]);
    const ids = (f: Partial<typeof NO_LINE_FILTER>) => filterLines(lines, strips, { ...NO_LINE_FILTER, ...f }).map((l) => l.lineId);
    expect(ids({})).toEqual(["a", "b", "c"]);
    expect(ids({ die: "d2" })).toEqual(["b"]);
    expect(ids({ length: "5486" })).toEqual(["b", "c"]);
    expect(ids({ stage: "in_stock" })).toEqual(["a"]);
    expect(ids({ stage: "planned" })).toEqual(["c"]);
    expect(ids({ stage: "dispatched" })).toEqual(["b"]);
    expect(ids({ stage: "unplanned" })).toEqual(["a"]);
    expect(ids({ hasBaki: true })).toEqual(["a", "c"]);
    expect(ids({ length: "5486", hasBaki: true, stage: "planned" })).toEqual(["c"]);
  });

  test("a line with no strip is in no stage", () => {
    expect(inStage(undefined, "in_stock")).toBe(false);
    expect(matchesLine(line("a"), undefined, { ...NO_LINE_FILTER, stage: "over" })).toBe(false);
    expect(matchesLine(line("a"), undefined, NO_LINE_FILTER)).toBe(true);
  });

  test("options list each die and length once; totals count the lines shown", () => {
    const lines = [line("a"), line("b", { cutLengthMm: 5486 }), line("c", { orderedPcs: null, orderedG: 50_000 })];
    expect(filterOptions(lines)).toEqual({ dies: [{ id: "d1", label: "14701 Patti" }], lengths: [3658, 5486] });
    expect(shownTotals(lines)).toEqual({ lines: 3, pcs: 20, orderedG: 290_000 });
    expect(lineFilterActive(NO_LINE_FILTER)).toBe(false);
    expect(lineFilterActive({ ...NO_LINE_FILTER, hasBaki: true })).toBe(true);
  });
});
