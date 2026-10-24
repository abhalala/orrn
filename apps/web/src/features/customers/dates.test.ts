import { describe, expect, test } from "bun:test";

import { formatDay, formatInstantDay } from "./dates";

describe("formatDay (calendar dates)", () => {
  test("d MMM, with the year only when it isn't this year", () => {
    expect(formatDay("2026-04-01", "en", "2026-10-03")).toBe("1 Apr");
    expect(formatDay("2025-09-01", "en", "2026-10-03")).toBe("1 Sep 2025");
  });

  test("Hindi month names, Latin digits", () => {
    expect(formatDay("2026-04-01", "hi", "2026-10-03")).toBe("1 अप्रैल");
  });
});

describe("formatInstantDay (instants, on the company's calendar)", () => {
  test("an evening UTC instant is the next day in IST", () => {
    expect(formatInstantDay("2026-09-29T20:00:00Z", "en", "Asia/Kolkata", "2026-10-03")).toBe("30 Sep");
    expect(formatInstantDay(new Date("2025-12-31T20:00:00Z"), "en", "Asia/Kolkata", "2026-10-03")).toBe("1 Jan");
    expect(formatInstantDay(Date.parse("2025-12-30T20:00:00Z"), "en", "Asia/Kolkata", "2026-10-03")).toBe("31 Dec 2025");
  });
});
