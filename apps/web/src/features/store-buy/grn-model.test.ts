import { describe, expect, test } from "bun:test";

import { EMPTY_GRN_BUY, grnBuyInput, grnHeldByGoneLine, parseAcceptedMilli, poLineGone } from "./grn-model";
import { createRequestIds } from "../store/request-id";

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

describe("an order line that closed while the form was open", () => {
  const open = { items: [{ lineId: "l-2" }] };

  test("is gone only once the open lines loaded and no longer have it", () => {
    expect(poLineGone(open, "l-1")).toBe(true);
    expect(poLineGone(open, "l-2")).toBe(false);
    expect(poLineGone(undefined, "l-1")).toBe(false);
    expect(poLineGone(open, null)).toBe(false);
  });

  test("holds a new submit back, but lets the resend of a submit with no answer go out with the same id", () => {
    const sig = "receive|flux|25000||||l-1|92.35|";
    expect(grnHeldByGoneLine(true, sig, null)).toBe(true);
    expect(grnHeldByGoneLine(true, sig, "receive|flux|1000||||l-1|92.35|")).toBe(true);
    expect(grnHeldByGoneLine(true, sig, sig)).toBe(false);
    expect(grnHeldByGoneLine(false, sig, null)).toBe(false);
    // The draft is never changed by the refresh, so the resend's signature, and with it the request id, stay.
    const ids = createRequestIds(() => crypto.randomUUID());
    const first = ids.idFor(sig);
    expect(ids.idFor(sig)).toBe(first);
  });
});
