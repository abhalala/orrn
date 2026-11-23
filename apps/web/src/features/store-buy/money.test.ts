import { describe, expect, test } from "bun:test";

import { bpText, gstBpFromText, MAX_RATE_PAISE, paiseToText, ratePaiseFromText, rupees } from "./money";

describe("store buying money", () => {
  test("typed rupees become exact integer paise", () => {
    expect(ratePaiseFromText("84.50")).toBe(8450);
    expect(ratePaiseFromText("84.5")).toBe(8450);
    expect(ratePaiseFromText("0.1")).toBe(10);
    expect(ratePaiseFromText(" 12 ")).toBe(1200);
    expect(ratePaiseFromText("0")).toBe(0);
  });

  test("empty, words, negatives and over the cap are refused", () => {
    expect(ratePaiseFromText("")).toBeNull();
    expect(ratePaiseFromText("abc")).toBeNull();
    expect(ratePaiseFromText("-5")).toBeNull();
    expect(ratePaiseFromText(String(MAX_RATE_PAISE / 100 + 1))).toBeNull();
  });

  test("GST percent becomes basis points, at most 28", () => {
    expect(gstBpFromText("18")).toBe(1800);
    expect(gstBpFromText("12.5")).toBe(1250);
    expect(gstBpFromText("0")).toBe(0);
    expect(gstBpFromText("29")).toBeNull();
    expect(gstBpFromText("")).toBeNull();
  });

  test("display", () => {
    expect(rupees(12345678)).toBe("₹1,23,456.78");
    expect(paiseToText(8450)).toBe("84.50");
    expect(bpText(1800)).toBe("18");
    expect(bpText(1250)).toBe("12.5");
  });
});
