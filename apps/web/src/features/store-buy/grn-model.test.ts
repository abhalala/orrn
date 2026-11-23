import { describe, expect, test } from "bun:test";

import { EMPTY_GRN_BUY, grnBuyInput, parseAcceptedMilli } from "./grn-model";

describe("GRN buying fields", () => {
  test("all empty: a GRN without an order, as before", () => {
    expect(grnBuyInput(EMPTY_GRN_BUY, "kg", true)).toEqual({ ok: true, poLineId: null, ratePaise: null, rejectedMilli: null });
  });

  test("order line, rate and rejected quantity", () => {
    expect(grnBuyInput({ poLineId: "L1", rate: "84.50", rejected: "2.5" }, "kg", true)).toEqual({
      ok: true,
      poLineId: "L1",
      ratePaise: 8450,
      rejectedMilli: 2500,
    });
  });

  test("a zero rejected box sends nothing", () => {
    expect(grnBuyInput({ poLineId: null, rate: "", rejected: "0" }, "kg", true)).toMatchObject({ ok: true, rejectedMilli: null });
  });

  test("a bad rate or a part piece is refused", () => {
    expect(grnBuyInput({ poLineId: null, rate: "abc", rejected: "" }, "kg", true)).toEqual({ ok: false, rate: "invalid", rejected: undefined });
    expect(grnBuyInput({ poLineId: null, rate: "", rejected: "1.5" }, "piece", true)).toEqual({ ok: false, rate: undefined, rejected: "whole" });
  });

  test("a person who cannot set rates never sends one, even with a rate in the draft", () => {
    expect(grnBuyInput({ poLineId: "L1", rate: "84.50", rejected: "" }, "kg", false)).toEqual({
      ok: true,
      poLineId: "L1",
      ratePaise: null,
      rejectedMilli: null,
    });
    // A bad rate text is not their concern: it is ignored, not refused.
    expect(grnBuyInput({ poLineId: null, rate: "abc", rejected: "" }, "kg", false)).toMatchObject({ ok: true, ratePaise: null });
  });
});

describe("accepted quantity", () => {
  test("zero is refused unless something was rejected", () => {
    expect(parseAcceptedMilli("0", "kg", null)).toEqual({ ok: false, problem: "zero" });
    expect(parseAcceptedMilli("0", "kg", 0)).toEqual({ ok: false, problem: "zero" });
    expect(parseAcceptedMilli("0", "kg", 2500)).toEqual({ ok: true, milli: 0 });
  });
  test("every other check stays", () => {
    expect(parseAcceptedMilli("", "kg", 2500)).toEqual({ ok: false, problem: "empty" });
    expect(parseAcceptedMilli("abc", "kg", 2500)).toEqual({ ok: false, problem: "invalid" });
    expect(parseAcceptedMilli("1.5", "piece", 1000)).toEqual({ ok: false, problem: "whole" });
    expect(parseAcceptedMilli("3", "kg", 2500)).toEqual({ ok: true, milli: 3000 });
  });
});
