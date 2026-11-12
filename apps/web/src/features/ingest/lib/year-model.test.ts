import { describe, expect, test } from "bun:test";

import { defaultAsOf, financialYears, fileYearTargets, formatDay, guessSource, needsYearLine, parseDay, yearLine, yearProblems } from "./year-model";

const day = (iso: string) => `day(${iso})`;
const base = { target: "orders", questions: [], period: null, periodConfirmed: null } as never;

describe("the year line (M8)", () => {
  test("only for orders and bundles, or an open period_needed question", () => {
    expect(needsYearLine({ target: "dies", questions: [] })).toBe(false);
    expect(needsYearLine({ target: "customers", questions: [] })).toBe(false);
    expect(needsYearLine({ target: "orders", questions: [] })).toBe(true);
    expect(needsYearLine({ target: "bundles", questions: [] })).toBe(true);
    expect(needsYearLine({ target: "dies", questions: [{ code: "period_needed", subject: "", params: {}, answer: null, open: true }] })).toBe(true);
    expect(yearLine({ target: "dies", questions: [], period: null, periodConfirmed: null } as never, day)).toEqual({ show: false });
  });

  test("the guess and where it came from, the last five years with the guess preselected", () => {
    const line = yearLine(
      { ...base, period: { fy: "2025-26", asOf: "2026-03-31", confidence: "medium", sources: [{ kind: "file_name", value: "2025-26" }] } },
      day,
      new Date("2026-11-11T00:00:00Z"),
    );
    expect(line).toMatchObject({ show: true, mode: "ask", fy: "2025-26", asOf: "2026-03-31" });
    if (line.show && line.mode === "ask") {
      expect(line.guess).toEqual({ key: "ingest.period.guess", vars: { fy: "2025-26" }, varKeys: { source: "ingest.period.source.file_name" } });
      expect(line.options.map((o) => o.value)).toEqual(["2026-27", "2025-26", "2024-25", "2023-24", "2022-23"]);
      expect(line.why).toEqual({ key: "ingest.period.whyOrders" });
    }
  });

  test("nothing in the file to tell the year: say so, preselect nothing", () => {
    const line = yearLine({ ...base, target: "bundles", period: { fy: null, asOf: null, confidence: "unknown", sources: [{ kind: "legacy_code", value: "pre_cutover" }] } }, day, new Date("2026-11-11T00:00:00Z"));
    expect(line).toMatchObject({ mode: "ask", fy: "", guess: { key: "ingest.period.noGuess" }, why: { key: "ingest.period.whyBundles" } });
  });

  test("asked once: after the person saves, every import of the file shows the saved line", () => {
    const line = yearLine({ ...base, periodConfirmed: { fy: "2025-26", asOf: "2026-03-31" } }, day);
    expect(line).toEqual({
      show: true, mode: "saved", saved: { key: "ingest.period.done", vars: { fy: "2025-26", date: "day(2026-03-31)" } }, change: { key: "ingest.period.change" },
    });
  });

  test("the source is the first that gave a year; a legacy code gives none", () => {
    expect(guessSource({ fy: "2025-26", asOf: null, confidence: "high", sources: [{ kind: "title", value: "x" }, { kind: "file_name", value: "y" }] })).toBe("title");
    expect(guessSource({ fy: null, asOf: null, confidence: "unknown", sources: [{ kind: "legacy_code", value: "pre_cutover" }] })).toBeNull();
    expect(guessSource(null)).toBeNull();
  });
});

describe("financial years", () => {
  test("a year runs April to March", () => {
    expect(financialYears("2026-03-31", null)[0]!.value).toBe("2025-26");
    expect(financialYears("2026-04-01", null)[0]!.value).toBe("2026-27");
    expect(financialYears("2026-11-11", null)).toHaveLength(5);
  });
  test("an older guess is added to the list so it can stay selected", () => {
    expect(financialYears("2026-11-11", "2019-20").map((o) => o.value).at(-1)).toBe("2019-20");
    expect(financialYears("2026-11-11", "2025-26")).toHaveLength(5);
  });
  test("the as-on date starts at the guess, else the end of the year, never a day to come", () => {
    expect(defaultAsOf("2025-26", "2026-01-15", "2026-11-11")).toBe("2026-01-15");
    expect(defaultAsOf("2024-25", null, "2026-11-11")).toBe("2025-03-31");
    expect(defaultAsOf("2026-27", null, "2026-11-11")).toBe("2026-11-11");
    expect(defaultAsOf(null, null, "2026-11-11")).toBe("");
  });
});

describe("saving a year", () => {
  test("a date outside the year is said before it is sent", () => {
    expect(yearProblems({ fy: "2025-26", asOf: "2026-03-31" })).toEqual({});
    expect(yearProblems({ fy: "2025-26", asOf: "2026-04-01" })).toEqual({ asOf: { key: "ingest.period.mismatch", vars: { fy: "2025-26" } } });
    expect(yearProblems({ fy: "", asOf: "" })).toEqual({ fy: { key: "common.required" }, asOf: { key: "common.required" } });
  });
  test("a day is written day first: 31/03/2026 is 2026-03-31, and what is not a real day is said in words", () => {
    expect(parseDay("31/03/2026")).toBe("2026-03-31");
    expect(parseDay(" 1-4-2026 ")).toBe("2026-04-01");
    expect(parseDay("31.03.2026")).toBe("2026-03-31");
    expect(parseDay("31/02/2026")).toBeNull();
    expect(parseDay("03/31/26")).toBeNull();
    expect(formatDay("2026-03-31")).toBe("31/03/2026");
    expect(formatDay("31/0")).toBe("31/0");
    expect(yearProblems({ fy: "2025-26", asOf: "31/0" })).toEqual({ asOf: { key: "ingest.period.badDate" } });
  });
  test("the file screen shows the year once, only when the file has orders or bundles", () => {
    expect(fileYearTargets([{ candidates: [{ target: "dies" }] }, { candidates: [{ target: "orders" }] }])).toBe(true);
    expect(fileYearTargets([{ candidates: [{ target: "dies" }, { target: null }] }])).toBe(false);
  });
});
