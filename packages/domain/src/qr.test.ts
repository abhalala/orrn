import { describe, expect, test } from "bun:test";

import { bundleQrUrl, isCompanySlug } from "./qr";
import { parseScan } from "./serial";

describe("bundleQrUrl", () => {
  test("is origin/b/number?c=slug", () => {
    expect(bundleQrUrl({ origin: "https://orrn.in", number: "26I4086", companySlug: "fourcubes" })).toBe(
      "https://orrn.in/b/26I4086?c=fourcubes",
    );
  });

  test("a trailing slash on the origin is dropped and parts are encoded", () => {
    expect(bundleQrUrl({ origin: "https://orrn.in/", number: "BG-000001-B001", companySlug: "a b" })).toBe(
      "https://orrn.in/b/BG-000001-B001?c=a%20b",
    );
  });

  test("a scanner still reads the number back", () => {
    const url = bundleQrUrl({ origin: "https://orrn.in", number: "26I4086", companySlug: "fourcubes" });
    expect(parseScan(url)).toEqual({ kind: "serial", serial: "26I4086" });
  });
});

describe("isCompanySlug", () => {
  test("lowercase letters, digits and hyphens up to 64", () => {
    expect(isCompanySlug("fourcubes")).toBe(true);
    expect(isCompanySlug("orrn-demo-2")).toBe(true);
    expect(isCompanySlug("a".repeat(64))).toBe(true);
  });

  test("rejects everything else", () => {
    for (const bad of ["", "A", "a b", "a.b", "a/b", "a".repeat(65), "ü", 5, null, undefined]) {
      expect(isCompanySlug(bad)).toBe(false);
    }
  });
});
