import { describe, expect, test } from "bun:test";

import { formatDay, formatDispatchDay, formatInstantDay } from "./dates";

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

describe("formatDispatchDay (the customer page's Recent dispatches date: the server's ship day, one rule everywhere)", () => {
  const today = "2026-10-30";
  test("a completed load reads the day it left, not the day it was planned", () => {
    expect(formatDispatchDay({ shipDay: { ymd: "2026-10-28", kind: "dispatched" }, createdAt: "2026-10-20T05:00:00Z" }, "en", "Asia/Kolkata", today)).toBe("28 Oct");
  });
  test("a load being built reads its entered ship date", () => {
    expect(formatDispatchDay({ shipDay: { ymd: "2026-10-31", kind: "ship" }, createdAt: "2026-10-20T05:00:00Z" }, "en", "Asia/Kolkata", today)).toBe("31 Oct");
  });
  test("with no ship day it reads the day the load was started, on the company's calendar", () => {
    expect(formatDispatchDay({ shipDay: null, createdAt: "2026-10-19T20:00:00Z" }, "en", "Asia/Kolkata", today)).toBe("20 Oct");
    expect(formatDispatchDay({ createdAt: "2026-10-19T20:00:00Z" }, "en", "Asia/Kolkata", today)).toBe("20 Oct");
  });
});
