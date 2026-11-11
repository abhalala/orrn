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
});
