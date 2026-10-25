import { describe, expect, test } from "bun:test";

import { formatDay, isoDayInput, parseDayInput } from "./format";

const NOW = new Date("2026-10-03T06:00:00Z");

describe("formatDay", () => {
  test("d MMM this year, with the year otherwise", () => {
    expect(formatDay("2026-10-04T00:00:00.000Z", { now: NOW })).toBe("4 Oct");
    expect(formatDay(new Date("2025-12-30T00:00:00Z"), { now: NOW })).toBe("30 Dec 2025");
  });
  test("uses the company time zone for the calendar day", () => {
    expect(formatDay("2026-10-03T20:00:00Z", { now: NOW, timeZone: "Asia/Kolkata" })).toBe("4 Oct");
    expect(formatDay("2026-10-03T20:00:00Z", { now: NOW, timeZone: "UTC" })).toBe("3 Oct");
  });
  test("Hindi month names keep Latin digits", () => {
    expect(formatDay("2026-10-04T00:00:00Z", { now: NOW, locale: "hi" })).toMatch(/^4 \S+$/);
  });
  test("Gujarati month names keep Latin digits", () => {
    const s = formatDay("2026-10-04T00:00:00Z", { now: NOW, locale: "gu" });
    expect(s).toMatch(/^4 [\u0A80-\u0AFF]+$/);
  });
  test("no date is null", () => {
    expect(formatDay(null, { now: NOW })).toBeNull();
    expect(formatDay("not a date", { now: NOW })).toBeNull();
  });
});

describe("ship date input", () => {
  test("round-trips a calendar day through the stored instant", () => {
    const ms = parseDayInput("2026-10-04");
    expect(ms).toBe(Date.UTC(2026, 9, 4));
    expect(isoDayInput(ms!)).toBe("2026-10-04");
  });
  test("blank or junk is no date", () => {
    expect(parseDayInput("")).toBeNull();
    expect(parseDayInput("04/10/2026")).toBeNull();
  });
});
