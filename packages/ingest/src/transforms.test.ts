import { describe, expect, test } from "bun:test";

import { readNumber } from "./transforms";

describe("readNumber", () => {
  test("C5: a fractional piece count is refused, not rounded", () => {
    expect(readNumber("12.5", "count", "pcs")).toEqual({ ok: false, code: "not_whole" });
    expect(readNumber("0.5", "count", "nos")).toEqual({ ok: false, code: "not_whole" });
    expect(readNumber("0.4", "count", "pcs")).toEqual({ ok: false, code: "not_whole" });
    const whole = readNumber("12.0", "count", "pcs");
    expect(whole.ok && whole.value.canonical).toBe(12);
  });

  test("C28: Devanagari and Gujarati digits read like the registry reads them", () => {
    const hi = readNumber("१२.५", "mass", "kg");
    expect(hi.ok && hi.value.canonical).toBe(12_500);
    const gu = readNumber("૧૨.૫", "mass", "kg");
    expect(gu.ok && gu.value.canonical).toBe(12_500);
    // The entered text stays as the person typed it.
    expect(hi.ok && hi.value.entered).toBe("१२.५");
  });
});
