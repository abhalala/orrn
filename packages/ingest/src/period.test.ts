import { describe, expect, test } from "bun:test";

import { detectPeriod, fyEnd, fyOf, fyOfIso, periodRequired } from "./period";
import { EXAMPLE_BAKI_RECIPE, EXAMPLE_DIE_RECIPE } from "./recipe-fixtures";

const now = { currentYear: 2026 };

describe("financial year", () => {
  test("April to March", () => {
    expect(fyOf(2025, 4)).toBe("2025-26");
    expect(fyOf(2026, 3)).toBe("2025-26");
    expect(fyOf(2026, 4)).toBe("2026-27");
    expect(fyOfIso("2025-10-31")).toBe("2025-26");
    expect(fyOf(1999, 12)).toBe("1999-00");
    expect(fyEnd("2025-26")).toBe("2026-03-31");
  });
});

describe("detectPeriod sources", () => {
  test("file name: FY range, FY26, month-year, full date", () => {
    expect(detectPeriod({ fileName: "Baki 2025-26.xlsx", ...now })).toMatchObject({ fy: "2025-26", asOf: null, confidence: "medium" });
    expect(detectPeriod({ fileName: "Baki 2025-2026.xlsx", ...now }).fy).toBe("2025-26");
    expect(detectPeriod({ fileName: "stock FY26.csv", ...now }).fy).toBe("2025-26");
    expect(detectPeriod({ fileName: "Baki Oct-25.xlsx", ...now })).toMatchObject({ fy: "2025-26", asOf: null });
    expect(detectPeriod({ fileName: "baki Mar 2026.xlsx", ...now }).fy).toBe("2025-26");
    expect(detectPeriod({ fileName: "baki Apr 2026.xlsx", ...now }).fy).toBe("2026-27");
    expect(detectPeriod({ fileName: "baki 31.10.2025.xlsx", ...now })).toMatchObject({ fy: "2025-26", asOf: "2025-10-31" });
    expect(detectPeriod({ fileName: "baki 2025-10-31.xlsx", ...now })).toMatchObject({ fy: "2025-26", asOf: "2025-10-31" });
    expect(detectPeriod({ fileName: "baki 31-Oct-25.xlsx", ...now })).toMatchObject({ fy: "2025-26", asOf: "2025-10-31" });
  });
  test("C10: FY with a two-digit range starts at the first year", () => {
    expect(detectPeriod({ fileName: "Baki FY 25-26.xlsx", ...now }).fy).toBe("2025-26");
    expect(detectPeriod({ fileName: "Baki FY25-26.xlsx", ...now }).fy).toBe("2025-26");
    expect(detectPeriod({ fileName: "Baki FY 24-25.xlsx", ...now }).fy).toBe("2024-25");
    expect(detectPeriod({ fileName: "Baki FY 2025-26.xlsx", ...now }).fy).toBe("2025-26");
  });

  test("title rows and sheet names", () => {
    expect(detectPeriod({ titles: ["PENDING ORDER LIST AS ON 31.10.2025"], ...now })).toMatchObject({ fy: "2025-26", asOf: "2025-10-31", confidence: "medium" });
    expect(detectPeriod({ sheetNames: ["Oct 25"], ...now })).toMatchObject({ fy: "2025-26", asOf: null });
  });
  test("date columns use the FY of the max", () => {
    const g = detectPeriod({ dateRange: { min: "2025-02-01", max: "2025-10-31" }, ...now });
    expect(g.fy).toBe("2025-26");
    expect(g.sources).toEqual([{ kind: "date_column", value: "2025-02-01..2025-10-31" }]);
  });
  test("plant bundle numbers give the FY; month-only numbers give nothing", () => {
    expect(detectPeriod({ bundleNos: ["25J12", "26B7", "J540"], ...now })).toMatchObject({ fy: "2025-26", confidence: "medium" });
    expect(detectPeriod({ bundleNos: ["J540"], ...now }).confidence).toBe("unknown");
  });
  test("legacy cuid and BG codes are a marker, not a year", () => {
    const g = detectPeriod({ codes: ["cm1abcdefghijklmnopqrstu", "BG-000001-B001"], ...now });
    expect(g.sources).toContainEqual({ kind: "legacy_code", value: "pre_cutover" });
    expect(g.fy).toBeNull();
    expect(g.confidence).toBe("unknown");
  });
  test("two-digit years: at or below current + 1 is 20yy, above is 19yy", () => {
    expect(detectPeriod({ fileName: "a 31.10.27.xlsx", currentYear: 2026 }).asOf).toBe("2027-10-31");
    expect(detectPeriod({ fileName: "a 31.10.28.xlsx", currentYear: 2026 }).asOf).toBe("1928-10-31");
  });
});

describe("detectPeriod confidence", () => {
  test("two independent sources that agree: high", () => {
    const g = detectPeriod({ fileName: "Baki Oct-25.xlsx", titles: ["AS ON 31.10.2025"], ...now });
    expect(g).toMatchObject({ fy: "2025-26", asOf: "2025-10-31", confidence: "high" });
    expect(g.sources.map((s) => s.kind).sort()).toEqual(["file_name", "title"]);
  });
  test("one source: medium. The same kind twice is still one source", () => {
    expect(detectPeriod({ fileName: "Baki 2025-26 Oct-25.xlsx", ...now }).confidence).toBe("medium");
  });
  test("sources that disagree on the FY: low, and the title wins the suggestion", () => {
    const g = detectPeriod({ fileName: "Baki 2024-25.xlsx", titles: ["AS ON 31.10.2025"], ...now });
    expect(g.confidence).toBe("low");
    expect(g.fy).toBe("2025-26");
  });
  test("two different as-of dates: low", () => {
    const g = detectPeriod({ fileName: "baki 30.09.2025.xlsx", titles: ["AS ON 31.10.2025"], ...now });
    expect(g.confidence).toBe("low");
    expect(g.asOf).toBe("2025-10-31");
  });
  test("no source: unknown with no guess", () => {
    expect(detectPeriod({ fileName: "list.xlsx", titles: ["PENDING ORDER LIST"], ...now })).toEqual({ fy: null, asOf: null, confidence: "unknown", sources: [] });
  });
  test("a date inside the file name does not also count as a month-year", () => {
    const g = detectPeriod({ fileName: "baki 31-10-2025.xlsx", ...now });
    expect(g.sources.length).toBe(1);
  });
});

describe("periodRequired", () => {
  test("only for orders without an order date column", () => {
    expect(periodRequired(EXAMPLE_BAKI_RECIPE)).toBe(false);
    expect(periodRequired(EXAMPLE_DIE_RECIPE)).toBe(false);
    const noDate = structuredClone(EXAMPLE_BAKI_RECIPE);
    noDate.fields = noDate.fields.filter((f) => f.field !== "orderDate");
    expect(periodRequired(noDate)).toBe(true);
    noDate.fields.push({ field: "orderDate", source: { kind: "period_as_of" }, steps: [] });
    expect(periodRequired(noDate)).toBe(true);
  });
});
