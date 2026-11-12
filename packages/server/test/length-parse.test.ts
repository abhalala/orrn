/** `parseLength` and `parseLengthDecimal` read plain numbers exactly; the old `parseFloat` reader read "12abc" as 12. */
import { describe, expect, test } from "bun:test";

import { formatLength, parseLength, parseLengthDecimal } from "../src/lib/length";

describe("parseLength (units layer slice b)", () => {
  test("regression: trailing junk is not a number, so it reads 0 and not 12", () => {
    expect(parseLength("12abc", "mm")).toBe(0);
    expect(parseLength("12abc", "inch")).toBe(0);
    expect(parseLengthDecimal("12abc", "mm")).toBe(0);
    expect(parseLength("12 ft", "mm")).toBe(0);
    expect(parseLength("1e3", "mm")).toBe(0);
    expect(parseLength("--1", "mm")).toBe(0);
    expect(parseLength("-5", "mm")).toBe(0);
    expect(parseLength("", "mm")).toBe(0);
  });
  test("plain numbers read exactly: mm half away from zero, inches times 25.4 exactly", () => {
    expect(parseLength("3658", "mm")).toBe(3658);
    expect(parseLength("3,658.4", "mm")).toBe(3658);
    expect(parseLength("3658.5", "mm")).toBe(3659);
    expect(parseLength("144", "inch")).toBe(3658); // 3657.6
    expect(parseLength("322.5", "inch")).toBe(8192); // exactly 8191.5, the float product read 8191.499999999999
    expect(parseLengthDecimal("3658.46", "mm")).toBe(3658.5);
    expect(parseLengthDecimal("144", "inch")).toBe(3657.6);
    expect(parseLengthDecimal("0.05", "mm")).toBe(0.1);
  });
  test("a value past the safe integers is not a length", () => {
    expect(parseLength("99999999999999999999", "mm")).toBe(0);
  });
  test("the server's own formatLength is unchanged", () => {
    expect(formatLength(3658, "mm")).toBe("3658 mm");
    expect(formatLength(3658, "inch")).toBe("144.02 in");
  });
});
