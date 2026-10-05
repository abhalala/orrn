import { describe, expect, test } from "bun:test";

import { formatWhen } from "./format";

// 4 Oct 2026, 09:30 in the plant (IST).
const NOW = Date.parse("2026-10-04T04:00:00Z");

describe("formatWhen (C2 spec section 2: d MMM, 24h, year when not current, company zone)", () => {
  test("24-hour time in the company zone, no year in the current year", () => {
    expect(
      formatWhen("2026-10-03T16:42:00Z", {
        locale: "en",
        timeZone: "Asia/Kolkata",
        now: NOW,
      }),
    ).toBe("3 Oct, 22:12");
  });

  test("the same instant reads the same on a device in another zone", () => {
    // The device zone never matters: the company zone is passed in.
    expect(
      formatWhen("2026-10-03T16:42:00Z", {
        locale: "en",
        timeZone: "Asia/Kolkata",
        now: NOW,
      }),
    ).not.toMatch(/am|pm/i);
    expect(
      formatWhen("2026-10-03T16:42:00Z", {
        locale: "en",
        timeZone: "America/Phoenix",
        now: NOW,
      }),
    ).toBe("3 Oct, 09:42");
  });

  test("an entry from another year carries the year (GRN numbers restart every financial year)", () => {
    expect(
      formatWhen("2025-03-31T04:12:00Z", {
        locale: "en",
        timeZone: "Asia/Kolkata",
        now: NOW,
      }),
    ).toBe("31 Mar 2025, 09:42");
  });

  test("the year is the company's: 31 Dec 23:00 UTC is already next year in IST", () => {
    const newYear = Date.parse("2027-01-01T06:00:00Z");
    expect(
      formatWhen("2026-12-31T20:00:00Z", {
        locale: "en",
        timeZone: "Asia/Kolkata",
        now: newYear,
      }),
    ).toBe("1 Jan, 01:30");
  });

  test("Hindi keeps Latin digits and the 24-hour clock", () => {
    const text = formatWhen("2026-10-03T16:42:00Z", {
      locale: "hi",
      timeZone: "Asia/Kolkata",
      now: NOW,
    });
    expect(text).toMatch(/^3 .+, 22:12$/);
    expect(text).not.toMatch(/[०-९]/);
    expect(text).not.toMatch(/am|pm/i);
  });

  test("an unknown zone falls back to the device instead of throwing", () => {
    expect(() => formatWhen(NOW, { locale: "en", timeZone: "Mars/Olympus", now: NOW })).not.toThrow();
  });
});
