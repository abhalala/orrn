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

import {
  classifyCode,
  formatBundleNo,
  formatCastCode,
  monthFromLetter,
  monthLetter,
  parseBundleNo,
} from "./serial";

describe("monthLetter", () => {
  test("A = Jan ... L = Dec, I = Sep", () => {
    expect(monthLetter(1)).toBe("A");
    expect(monthLetter(9)).toBe("I");
    expect(monthLetter(12)).toBe("L");
    expect(Array.from({ length: 12 }, (_, i) => monthFromLetter(monthLetter(i + 1)))).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });
  test("rejects out of range and non letters", () => {
    expect(() => monthLetter(0)).toThrow(RangeError);
    expect(() => monthLetter(13)).toThrow(RangeError);
    expect(() => monthLetter(1.5)).toThrow(RangeError);
    expect(monthFromLetter("M")).toBeNull();
    expect(monthFromLetter("")).toBeNull();
    expect(monthFromLetter("AB")).toBeNull();
    expect(monthFromLetter("i")).toBe(9);
  });
});

describe("formatBundleNo / parseBundleNo", () => {
  test("sample label 26I4086", () => {
    expect(formatBundleNo(2026, 9, 4086)).toBe("26I4086");
    expect(parseBundleNo("26I4086")).toEqual({ year: 2026, month: 9, seq: 4086 });
  });
  test("no padding, 2-digit year padded", () => {
    expect(formatBundleNo(2027, 1, 1)).toBe("27A1");
    expect(formatBundleNo(2005, 12, 99_999)).toBe("05L99999");
    expect(parseBundleNo("05L99999")).toEqual({ year: 2005, month: 12, seq: 99_999 });
  });
  test("old month-only style has no year", () => {
    expect(parseBundleNo("J540")).toEqual({ month: 10, seq: 540 });
    expect(parseBundleNo("j540")).toEqual({ month: 10, seq: 540 });
    expect(parseBundleNo(' "J540" ')).toEqual({ month: 10, seq: 540 });
  });
  test("round trips for every month", () => {
    for (let month = 1; month <= 12; month++) {
      for (const seq of [1, 9, 10, 540, 4086, 99_999]) {
        expect(parseBundleNo(formatBundleNo(2026, month, seq))).toEqual({ year: 2026, month, seq });
        expect(parseBundleNo(formatCastCode(month, seq))).toEqual({ month, seq });
      }
    }
  });
  test("rejects things that are not bundle numbers", () => {
    for (const bad of ["", "26M10", "26I", "26I0", "A0", "J", "26I123456", "BG-000001-B001", "2I40", "262I40", "12345"]) {
      expect(parseBundleNo(bad)).toBeNull();
    }
  });
  test("format rejects unscannable numbers", () => {
    expect(() => formatBundleNo(2026, 9, 0)).toThrow(RangeError);
    expect(() => formatBundleNo(2026, 9, 100_000)).toThrow(RangeError);
    expect(() => formatBundleNo(1999, 9, 1)).toThrow(RangeError);
    expect(() => formatBundleNo(2026, 13, 1)).toThrow(RangeError);
  });
});

describe("formatCastCode", () => {
  test("month letter + seq, no year", () => {
    expect(formatCastCode(11, 31)).toBe("K31");
    expect(formatCastCode(8, 24)).toBe("H24");
  });
});

describe("classifyCode", () => {
  test("plant number, bare and from the label QR", () => {
    const expected = { kind: "plant" as const, serial: "26I4086", year: 2026, month: 9, seq: 4086 };
    expect(classifyCode("26i4086")).toEqual(expected);
    expect(classifyCode("https://fourcubes.orrn.in/b/26I4086")).toEqual(expected);
  });
  test("old month-only number", () => {
    expect(classifyCode("J540")).toEqual({ kind: "monthOnly", serial: "J540", month: 10, seq: 540 });
  });
  test("legacy cuid (case preserved lower)", () => {
    expect(classifyCode("cmtibj86a00jvr101p2348h5o")).toEqual({ kind: "cuid", id: "cmtibj86a00jvr101p2348h5o" });
    expect(classifyCode("CMTIBJ86A00JVR101P2348H5O")).toEqual({ kind: "cuid", id: "cmtibj86a00jvr101p2348h5o" });
  });
  test("BG serial and unknowns", () => {
    expect(classifyCode("bg-000001-b001")).toEqual({ kind: "serial", serial: "BG-000001-B001" });
    expect(classifyCode("not a code!")).toEqual({ kind: "unknown", raw: "not a code!" });
    expect(classifyCode("")).toEqual({ kind: "unknown", raw: "" });
  });
});
