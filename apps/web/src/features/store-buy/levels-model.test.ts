import { describe, expect, test } from "bun:test";

import { levelsInput } from "./levels-model";

describe("reorder levels input", () => {
  test("empty boxes clear the levels", () => {
    expect(levelsInput({ min: "", reorder: " " }, "kg")).toEqual({ ok: true, minMilli: null, reorderMilli: null });
  });

  test("quantities in the item's unit", () => {
    expect(levelsInput({ min: "25", reorder: "100.5" }, "kg")).toEqual({ ok: true, minMilli: 25000, reorderMilli: 100500 });
  });

  test("a counted item takes whole numbers only", () => {
    expect(levelsInput({ min: "2.5", reorder: "10" }, "piece")).toEqual({ ok: false, min: "whole", reorder: undefined });
  });
});
