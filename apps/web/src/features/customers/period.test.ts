import { describe, expect, test } from "bun:test";

import {
  DEFAULT_PERIOD,
  cadenceDays,
  companyTimeZone,
  lastDispatchPhrase,
  parsePeriod,
  periodRange,
  todayIn,
  trailingMonths,
} from "./period";

describe("todayIn", () => {
  test("is the company's calendar day, not UTC's", () => {
    // 20:00 UTC on 2 Oct is 01:30 on 3 Oct in IST.
    expect(todayIn("Asia/Kolkata", new Date("2026-10-02T20:00:00Z"))).toBe("2026-10-03");
    expect(todayIn("UTC", new Date("2026-10-02T20:00:00Z"))).toBe("2026-10-02");
  });

  test("an unknown zone falls back to IST instead of throwing", () => {
    expect(todayIn("Mars/Olympus", new Date("2026-10-02T20:00:00Z"))).toBe("2026-10-03");
  });
});

describe("companyTimeZone", () => {
  test("reads settings.timezone, IST by default", () => {
    expect(companyTimeZone({ timezone: "Asia/Dubai" })).toBe("Asia/Dubai");
    expect(companyTimeZone({})).toBe("Asia/Kolkata");
    expect(companyTimeZone(undefined)).toBe("Asia/Kolkata");
    expect(companyTimeZone({ timezone: 7 })).toBe("Asia/Kolkata");
  });
});

describe("periodRange (to is an inclusive calendar day: today)", () => {
  test("this month", () => {
    expect(periodRange("month", "2026-10-03")).toEqual({ from: "2026-10-01", to: "2026-10-03" });
  });

  test("this quarter follows Indian financial quarters (Apr, Jul, Oct, Jan)", () => {
    expect(periodRange("quarter", "2026-10-03")).toEqual({ from: "2026-10-01", to: "2026-10-03" });
    expect(periodRange("quarter", "2026-09-30")).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(periodRange("quarter", "2026-05-12")).toEqual({ from: "2026-04-01", to: "2026-05-12" });
    expect(periodRange("quarter", "2027-02-28")).toEqual({ from: "2027-01-01", to: "2027-02-28" });
  });

  test("this financial year starts on 1 April", () => {
    expect(periodRange("fy", "2026-10-03")).toEqual({ from: "2026-04-01", to: "2026-10-03" });
    expect(periodRange("fy", "2026-04-01")).toEqual({ from: "2026-04-01", to: "2026-04-01" });
    expect(periodRange("fy", "2027-03-31")).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(periodRange("fy", "2027-01-15")).toEqual({ from: "2026-04-01", to: "2027-01-15" });
  });
});

describe("trailingMonths", () => {
  test("12 calendar months ending with this (open) month", () => {
    const r = trailingMonths("2026-10-03");
    expect(r.from).toBe("2025-11-01");
    expect(r.to).toBe("2026-10-03");
    expect(r.monthStarts).toHaveLength(12);
    expect(r.monthStarts[0]).toBe("2025-11-01");
    expect(r.monthStarts[11]).toBe("2026-10-01");
  });

  test("crosses a year boundary from January", () => {
    const r = trailingMonths("2027-01-31", 3);
    expect(r.monthStarts).toEqual(["2026-11-01", "2026-12-01", "2027-01-01"]);
  });
});

describe("parsePeriod", () => {
  test("accepts the three periods, anything else is the default (financial year)", () => {
    expect(DEFAULT_PERIOD).toBe("fy");
    expect(parsePeriod("month")).toBe("month");
    expect(parsePeriod("quarter")).toBe("quarter");
    expect(parsePeriod("fy")).toBe("fy");
    expect(parsePeriod("year")).toBe("fy");
    expect(parsePeriod(undefined)).toBe("fy");
    expect(parsePeriod(3)).toBe("fy");
  });
});

describe("lastDispatchPhrase", () => {
  test("today, yesterday, then days ago; none without a dispatch", () => {
    expect(lastDispatchPhrase(0)).toEqual({ key: "customers.detail.lastToday" });
    expect(lastDispatchPhrase(1)).toEqual({ key: "customers.detail.lastYesterday" });
    expect(lastDispatchPhrase(12)).toEqual({ key: "customers.detail.lastDaysAgo", count: 12 });
    expect(lastDispatchPhrase(null)).toEqual({ key: "customers.detail.lastNever" });
  });
});

describe("cadenceDays", () => {
  test("rounds the median gap to whole days, never below one", () => {
    expect(cadenceDays(9.4)).toBe(9);
    expect(cadenceDays(8.5)).toBe(9);
    expect(cadenceDays(0.2)).toBe(1);
    expect(cadenceDays(null)).toBeNull();
  });
});
