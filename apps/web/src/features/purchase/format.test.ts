import { describe, expect, test } from "bun:test";

import { bookDateText, kgText, pctText } from "./format";

describe("kgText", () => {
  test("grams as kg, Indian grouping, no trailing zeros, up to 3 decimals", () => {
    expect(kgText(12_450_000)).toBe("12,450");
    expect(kgText(12_450_500)).toBe("12,450.5");
    expect(kgText(187_300)).toBe("187.3");
    expect(kgText(1_234_567_891)).toBe("12,34,567.891");
    expect(kgText(0)).toBe("0");
  });
});

describe("pctText", () => {
  test("basis points as a percent with up to 2 decimals", () => {
    expect(pctText(50)).toBe("0.5%");
    expect(pctText(336)).toBe("3.36%");
    expect(pctText(10_000)).toBe("100%");
  });
});

describe("bookDateText", () => {
  test("a book date reads as a calendar date, never shifted by time zone", () => {
    expect(bookDateText("2026-10-03", "en")).toBe("3 Oct 2026");
    expect(bookDateText("2026-01-31", "en")).toBe("31 Jan 2026");
  });

  test("Hindi uses Hindi month names with Latin digits", () => {
    expect(bookDateText("2026-10-03", "hi")).toMatch(/^3 \S+ 2026$/);
  });

  test("junk passes through", () => {
    expect(bookDateText("soon", "en")).toBe("soon");
  });
});

describe("bookDayText", () => {
  test("lists drop the year inside the plant's current year and keep it otherwise", async () => {
    const { bookDayText } = await import("./format");
    expect(bookDayText("2026-10-04", "en", "2026-10-04")).toBe("4 Oct");
    expect(bookDayText("2026-01-31", "en", "2026-10-04")).toBe("31 Jan");
    expect(bookDayText("2025-12-30", "en", "2026-01-02")).toBe("30 Dec 2025");
    expect(bookDayText("2026-10-04", "hi", "2026-10-04")).toMatch(/^4 \S+$/);
    expect(bookDayText("soon", "en", "2026-10-04")).toBe("soon");
  });
});

describe("instantDateText", () => {
  test("shows the plant's wall clock and survives a bad zone", async () => {
    const { instantDateText } = await import("./format");
    // 3 Oct 2026 08:30 UTC is 14:00 in India.
    expect(instantDateText("2026-10-03T08:30:00Z", "en")).toMatch(/3 Oct.*14:00/);
    expect(instantDateText("2026-10-03T08:30:00Z", "en", "Not/AZone")).toMatch(/3 Oct.*14:00/);
  });

  test("24-hour clock; the year only outside the plant's current year (C2 spec dates)", async () => {
    const { instantDateText } = await import("./format");
    const now = Date.parse("2026-10-04T06:00:00Z");
    // 30 Dec 2025 16:42 UTC is 22:12 in India.
    expect(instantDateText("2025-12-30T16:42:00Z", "en", "Asia/Kolkata", now)).toBe("30 Dec 2025 at 22:12");
    expect(instantDateText("2026-10-03T08:30:00Z", "en", "Asia/Kolkata", now)).toBe("3 Oct at 14:00");
    expect(instantDateText("2026-10-03T19:00:00Z", "en", "Asia/Kolkata", now)).toBe("4 Oct at 00:30");
    expect(instantDateText("2025-12-30T16:42:00Z", "hi", "Asia/Kolkata", now)).toMatch(/^30 \S+ 2025, 22:12$/);
    // 31 Dec 2025 19:00 UTC is already 1 Jan 2026 in India: the plant's year, so no year.
    expect(instantDateText("2025-12-31T19:00:00Z", "en", "Asia/Kolkata", Date.parse("2026-01-02T06:00:00Z"))).toBe("1 Jan at 00:30");
  });
});

describe("slashBreaks", () => {
  test("a zero-width space after each slash, so PATTA/ROTTER/HEATSINK wraps at a slash, not mid-word", async () => {
    const { slashBreaks } = await import("./format");
    expect(slashBreaks("PATTA/ROTTER/HEATSINK, grade B")).toBe("PATTA/​ROTTER/​HEATSINK, grade B");
    expect(slashBreaks("SOFT CABLE, grade A")).toBe("SOFT CABLE, grade A");
  });
});
