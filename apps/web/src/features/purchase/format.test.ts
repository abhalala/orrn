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
    expect(instantDateText("2026-10-03T08:30:00Z", "en")).toMatch(/3 Oct.*2:00/);
    expect(instantDateText("2026-10-03T08:30:00Z", "en", "Not/AZone")).toMatch(/3 Oct.*2:00/);
  });
});
