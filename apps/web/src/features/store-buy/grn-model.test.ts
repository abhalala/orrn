import { describe, expect, test } from "bun:test";

import { EMPTY_GRN_BUY, grnBuyInput } from "./grn-model";

describe("GRN buying fields", () => {
  test("all empty: a GRN without an order, as before", () => {
    expect(grnBuyInput(EMPTY_GRN_BUY, "kg")).toEqual({ ok: true, poLineId: null, ratePaise: null, rejectedMilli: null });
  });

  test("order line, rate and rejected quantity", () => {
    expect(grnBuyInput({ poLineId: "L1", rate: "84.50", rejected: "2.5" }, "kg")).toEqual({
      ok: true,
      poLineId: "L1",
      ratePaise: 8450,
      rejectedMilli: 2500,
    });
  });

  test("a zero rejected box sends nothing", () => {
    expect(grnBuyInput({ poLineId: null, rate: "", rejected: "0" }, "kg")).toMatchObject({ ok: true, rejectedMilli: null });
  });

  test("a bad rate or a part piece is refused", () => {
    expect(grnBuyInput({ poLineId: null, rate: "abc", rejected: "" }, "kg")).toEqual({ ok: false, rate: "invalid", rejected: undefined });
    expect(grnBuyInput({ poLineId: null, rate: "", rejected: "1.5" }, "piece")).toEqual({ ok: false, rate: undefined, rejected: "whole" });
  });
});
