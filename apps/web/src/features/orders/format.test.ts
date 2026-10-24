import { describe, expect, test } from "bun:test";

import { dayTimeText, kgFieldText, milliText, orderKgText, pcsText, rateText } from "./format";

describe("orders number text", () => {
  test("kg to three decimals with Indian grouping", () => {
    expect(orderKgText(553_500)).toBe("553.500");
    expect(orderKgText(1_280_000)).toBe("1,280.000");
    expect(orderKgText(12_345_678)).toBe("12,345.678");
    expect(orderKgText(0)).toBe("0.000");
  });

  test("pieces are whole numbers", () => {
    expect(pcsText(667)).toBe("667");
    expect(pcsText(1_20_000)).toBe("1,20,000");
  });

  test("basis in milli kg per 12 ft", () => {
    expect(milliText(12_300)).toBe("12.300");
    expect(milliText(1_672)).toBe("1.672");
  });

  test("a kg field keeps no grouping", () => {
    expect(kgFieldText(1_234_567)).toBe("1234.567");
  });

  test("rate from paise", () => {
    expect(rateText(20_150)).toBe("201.50");
  });
});

describe("dayTimeText in the plant's zone (review m-9)", () => {
  test("a time is written on the company's clock, not the browser's", () => {
    const at = Date.UTC(2026, 9, 24, 19, 0); // 25 Oct 00:30 in India
    // The joiner between day and time differs by ICU build ("," or "at"); the day and time are the point.
    expect(dayTimeText(at, "en", "Asia/Kolkata")).toMatch(/^25 Oct\b.*\b00:30$/);
    expect(dayTimeText(at, "en", "UTC")).toMatch(/^24 Oct\b.*\b19:00$/);
  });
});
