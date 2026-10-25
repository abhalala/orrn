import { describe, expect, test } from "bun:test";

import { parseCastSearch, parseInboxSearch, parseMeltSearch } from "./search";

describe("foundry search params", () => {
  test("cast page: only the trace tab and a plain bundle number", () => {
    expect(parseCastSearch({ tab: "trace", bundle: "26J1842" })).toEqual({ tab: "trace", bundle: "26J1842" });
    expect(parseCastSearch({ tab: "melts", bundle: "<x>" })).toEqual({});
  });
  test("melt page: a known step after the first", () => {
    expect(parseMeltSearch({ step: "charge" })).toEqual({ step: "charge" });
    expect(parseMeltSearch({ step: "times" })).toEqual({});
    expect(parseMeltSearch({ step: "nope" })).toEqual({});
  });
  test("inbox keeps working", () => {
    expect(parseInboxSearch({ tab: "handled" })).toEqual({ tab: "handled" });
  });
});
