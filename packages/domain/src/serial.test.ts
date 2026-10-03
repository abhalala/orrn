import { describe, expect, test } from "bun:test";

import { normalizeSerial, parseScan, splitPastedSerials } from "./serial";

describe("normalizeSerial", () => {
  test("trims, uppercases, strips surrounding quotes", () => {
    expect(normalizeSerial("  bg-000001-b001 ")).toBe("BG-000001-B001");
    expect(normalizeSerial('"bg-000001-b001"')).toBe("BG-000001-B001");
    expect(normalizeSerial("'bg-1'")).toBe("BG-1");
    expect(normalizeSerial(' "a" ')).toBe("A");
  });
});

describe("parseScan", () => {
  test("bare serial", () => {
    expect(parseScan("bg-000001-b001")).toEqual({ kind: "serial", serial: "BG-000001-B001" });
  });
  test("URL ending /b/<serial>", () => {
    expect(parseScan("https://orrn.in/b/bg-000001-b001")).toEqual({
      kind: "serial",
      serial: "BG-000001-B001",
    });
    expect(parseScan("https://app.orrn.in/b/BG-000001-B002/?x=1#y")).toEqual({
      kind: "serial",
      serial: "BG-000001-B002",
    });
  });
  test("unknown", () => {
    expect(parseScan("https://example.com/other")).toEqual({ kind: "unknown", raw: "https://example.com/other" });
    expect(parseScan("")).toEqual({ kind: "unknown", raw: "" });
    expect(parseScan("two words")).toEqual({ kind: "unknown", raw: "two words" });
  });
});

describe("splitPastedSerials", () => {
  test("splits, dedupes, normalises", () => {
    expect(splitPastedSerials("a\nb, a")).toEqual(["A", "B"]);
    expect(splitPastedSerials("x1\ty2 z3\r\n\r\nx1,,")).toEqual(["X1", "Y2", "Z3"]);
    expect(splitPastedSerials("")).toEqual([]);
  });
});
