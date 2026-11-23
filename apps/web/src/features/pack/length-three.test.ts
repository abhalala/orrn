import { describe, expect, test as it } from "bun:test";

import { lengthBoxTexts, lengthMmOf, lengthTypedFromMm } from "./length-three";

describe("pack cut length, three boxes", () => {
  it("feet typed: inch and mm follow (12.5 ft = 150 in = 3810 mm)", () => {
    const v = { typed: "ft", text: "12.5" } as const;
    expect(lengthMmOf(v)).toBe(3810);
    expect(lengthBoxTexts(v)).toEqual({ ft: "12.5", in: "150", mm: "3810" });
  });
  it("inch typed with decimals", () => {
    const v = { typed: "in", text: "150" } as const;
    expect(lengthMmOf(v)).toBe(3810);
    expect(lengthBoxTexts(v)).toEqual({ ft: "12.5", in: "150", mm: "3810" });
    expect(lengthMmOf({ typed: "in", text: "10.5" })).toBe(267); // 266.7
  });
  it("mm typed: ft and in trimmed to 3 decimals", () => {
    expect(lengthBoxTexts({ typed: "mm", text: "3658" })).toEqual({ ft: "12.001", in: "144.016", mm: "3658" });
    expect(lengthMmOf({ typed: "mm", text: "3658.4" })).toBe(3658);
    expect(lengthMmOf({ typed: "mm", text: "3658.5" })).toBe(3659);
  });
  it("empty and junk give no length and no derived text", () => {
    expect(lengthMmOf({ typed: "ft", text: "" })).toBeNull();
    expect(lengthMmOf({ typed: "mm", text: "abc" })).toBeNull();
    expect(lengthBoxTexts({ typed: "in", text: "" })).toEqual({ ft: "", in: "", mm: "" });
  });
  it("a default in mm shows typed in the mm box", () => {
    expect(lengthTypedFromMm(3658)).toEqual({ typed: "mm", text: "3658" });
    expect(lengthTypedFromMm(0)).toEqual({ typed: "mm", text: "" });
  });
});
