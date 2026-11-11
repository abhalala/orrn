import { describe, expect, test } from "bun:test";

import { discardReduce, discardWords, DISCARD_START } from "./discard";
import { actionFocusKey, focusAfterListAction, focusAfterRowDecision, MERGE_BAR_FOCUS, nextFocus, progressStep, rowFocusKey } from "./place";

describe("keeping the person's place (M13)", () => {
  test("the neighbour after, else before, else nothing", () => {
    expect(nextFocus(["a", "b", "c"], "a")).toBe("b");
    expect(nextFocus(["a", "b", "c"], "c")).toBe("b");
    expect(nextFocus(["a"], "a")).toBeNull();
    expect(nextFocus([], "a")).toBeNull();
    expect(nextFocus(["x", "y"], "gone")).toBe("x");
  });

  test("after a row decision: the same row while it stays in the view, else the next row", () => {
    expect(focusAfterRowDecision(["r1", "r2", "r3"], "r2", true)).toBe("r2");
    expect(focusAfterRowDecision(["r1", "r2", "r3"], "r2", false)).toBe("r3");
    expect(focusAfterRowDecision(["r1"], "r1", false)).toBeNull();
    expect(rowFocusKey("r2")).toBe("row:r2");
  });

  test("after Approve, Hold or Discard on a list row: the next row's action, or the merge bar when none is left", () => {
    expect(focusAfterListAction(["c1", "c2"], "c1")).toBe(actionFocusKey("c2"));
    expect(focusAfterListAction(["c1", "c2"], "c2")).toBe(actionFocusKey("c1"));
    expect(focusAfterListAction(["c1"], "c1")).toBe(MERGE_BAR_FOCUS);
    expect(focusAfterListAction([], "c1")).toBe(MERGE_BAR_FOCUS);
  });
});

describe("telling a screen reader once", () => {
  test("a long read announces at 0, 25, 50, 75 and 100 percent, once each", () => {
    expect(progressStep(null, 0)).toBe(0);
    expect(progressStep(0, 0.1)).toBeNull();
    expect(progressStep(0.1, 0.26)).toBe(25);
    expect(progressStep(0.26, 0.4)).toBeNull();
    expect(progressStep(0.4, 0.51)).toBe(50);
    expect(progressStep(0.51, 0.99)).toBe(75);
    expect(progressStep(0.99, 1)).toBe(100);
    expect(progressStep(1, 1)).toBeNull();
    expect(progressStep(0.1, null)).toBeNull();
  });
});

describe("discard behind a confirm (M16)", () => {
  test("ask, confirm, done closes it", () => {
    let s = discardReduce(DISCARD_START, { type: "ask" });
    expect(s).toEqual({ step: "asking" });
    s = discardReduce(s, { type: "confirm" });
    expect(s).toEqual({ step: "working" });
    expect(discardReduce(s, { type: "done" })).toEqual({ step: "idle" });
  });
  test("cancel closes it, but not while the server works", () => {
    expect(discardReduce({ step: "asking" }, { type: "cancel" })).toEqual({ step: "idle" });
    expect(discardReduce({ step: "working" }, { type: "cancel" })).toEqual({ step: "working" });
    expect(discardReduce({ step: "working" }, { type: "confirm" })).toEqual({ step: "working" });
  });
  test("a failure keeps the dialog open with the error, and the person may try again", () => {
    const error = new Error("x");
    const failed = discardReduce({ step: "working" }, { type: "fail", error });
    expect(failed).toEqual({ step: "failed", error });
    expect(discardReduce(failed, { type: "confirm" })).toEqual({ step: "working" });
    expect(discardReduce(failed, { type: "cancel" })).toEqual({ step: "idle" });
    expect(discardReduce({ step: "idle" }, { type: "confirm" })).toEqual({ step: "idle" });
  });
  test("the dialog's words name the target and the row count", () => {
    const words = discardWords({ target: "dies", sheetName: null, fileName: "dies.csv", counts: { total: 1400 } as never }, (n) => n.toLocaleString("en-IN"));
    expect(words.title).toEqual({ key: "ingest.discard.title", varKeys: { name: "ingest.target.dies" } });
    expect(words.body).toEqual({ key: "ingest.discard.body", vars: { count: "1,400" } });
    expect(discardWords({ target: null, sheetName: "Old list", fileName: "x.xlsx", counts: { total: 1 } as never }).title.vars).toEqual({ name: "Old list" });
    expect(discardWords({ target: null, sheetName: null, fileName: "x.xlsx", counts: { total: 1 } as never }).title.vars).toEqual({ name: "x.xlsx" });
  });
});
