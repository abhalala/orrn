import { describe, expect, test } from "bun:test";

import { acceptState, checkPlanDraft, furnaceLine, groupByDay, lineActions, parsePlanSearch, planRange, rangeIssue } from "./cast-plan-model";

describe("search", () => {
  test("keeps only plant days", () => {
    expect(parsePlanSearch({ from: "2026-11-01", to: "x" })).toEqual({ from: "2026-11-01" });
    expect(parsePlanSearch({})).toEqual({});
  });
  test("defaults to today plus six days", () => {
    expect(planRange({}, "2026-11-22")).toEqual({ from: "2026-11-22", to: "2026-11-28" });
    expect(planRange({ from: "2026-11-25" }, "2026-11-22")).toEqual({ from: "2026-11-25", to: "2026-12-01" });
    expect(planRange({ to: "2026-11-10" }, "2026-11-22")).toEqual({ from: "2026-11-04", to: "2026-11-10" });
    expect(planRange({ from: "2026-11-01", to: "2026-11-03" }, "2026-11-22")).toEqual({ from: "2026-11-01", to: "2026-11-03" });
  });
  test("range issues", () => {
    expect(rangeIssue({ from: "2026-11-05", to: "2026-11-04" })).toBe("backwards");
    expect(rangeIssue({ from: "2026-11-01", to: "2026-12-02" })).toBe("too_long");
    expect(rangeIssue({ from: "2026-11-01", to: "2026-12-01" })).toBeNull();
    expect(rangeIssue({ from: "2026-11-01", to: "2026-11-01" })).toBeNull();
  });
});

describe("accept form", () => {
  test("valid", () => {
    expect(checkPlanDraft({ kg: "2,500", day: "2026-11-22", note: " x " })).toEqual({ ok: true, kgG: 2_500_000, day: "2026-11-22", note: "x" });
    expect(checkPlanDraft({ kg: "800", day: "2026-11-22", note: "" })).toEqual({ ok: true, kgG: 800_000, day: "2026-11-22" });
  });
  test("invalid", () => {
    expect(checkPlanDraft({ kg: "", day: "2026-11-22", note: "" })).toEqual({ ok: false, issue: "kg" });
    expect(checkPlanDraft({ kg: "0.5", day: "2026-11-22", note: "" })).toEqual({ ok: false, issue: "kg" });
    expect(checkPlanDraft({ kg: "600000", day: "2026-11-22", note: "" })).toEqual({ ok: false, issue: "kg" });
    expect(checkPlanDraft({ kg: "10", day: "", note: "" })).toEqual({ ok: false, issue: "day" });
  });
  test("accept state", () => {
    expect(acceptState({ castG: 0, alloyId: "a" })).toBe("nothing");
    expect(acceptState({ castG: 5, alloyId: null })).toBe("no_alloy");
    expect(acceptState({ castG: 5, alloyId: "a" })).toBe("ready");
  });
});

describe("lines and rows", () => {
  test("actions by status", () => {
    expect(lineActions("accepted")).toEqual({ edit: true, drop: true, open: true, castLink: false });
    expect(lineActions("opened")).toEqual({ edit: false, drop: false, open: false, castLink: true });
    expect(lineActions("dropped")).toEqual({ edit: false, drop: false, open: false, castLink: false });
  });
  test("group by day", () => {
    const g = groupByDay([
      { day: "2026-11-23", alloy: "6063" },
      { day: "2026-11-22", alloy: "6082" },
      { day: "2026-11-22", alloy: "6063" },
    ]);
    expect(g.map((x) => [x.day, x.rows.map((r) => r.alloy)])).toEqual([["2026-11-22", ["6063", "6082"]], ["2026-11-23", ["6063"]]]);
  });
  test("furnace line", () => {
    expect(furnaceLine(8_000_000)).toBe("size");
    expect(furnaceLine(null)).toBe("unset");
    expect(furnaceLine(0)).toBe("unset");
  });
});
