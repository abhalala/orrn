import { describe, expect, test } from "bun:test";

import { packedWhen } from "./format";

const IST = "Asia/Kolkata";
// 3 Oct 2026, 15:00 IST
const now = new Date("2026-10-03T09:30:00Z");

describe("packedWhen (day word or d MMM, 24h time, company timezone)", () => {
  test("today", () => {
    expect(packedWhen(new Date("2026-10-03T04:05:00Z"), { now, timeZone: IST })).toEqual({
      day: "today",
      date: "3 Oct",
      time: "09:35",
    });
  });

  test("the IST day boundary, not UTC's", () => {
    // 2 Oct 19:00 UTC is 3 Oct 00:30 IST: still today in the plant.
    expect(packedWhen(new Date("2026-10-02T19:00:00Z"), { now, timeZone: IST }).day).toBe("today");
    // 2 Oct 18:00 UTC is 2 Oct 23:30 IST: yesterday.
    expect(packedWhen(new Date("2026-10-02T18:00:00Z"), { now, timeZone: IST })).toEqual({
      day: "yesterday",
      date: "2 Oct",
      time: "23:30",
    });
  });

  test("older days show d MMM, and the year only when it isn't this year", () => {
    expect(packedWhen(new Date("2026-09-28T06:00:00Z"), { now, timeZone: IST })).toEqual({
      day: "date",
      date: "28 Sep",
      time: "11:30",
    });
    expect(packedWhen(new Date("2025-12-31T06:00:00Z"), { now, timeZone: IST }).date).toBe("31 Dec 2025");
  });

  test("an unknown timezone falls back instead of throwing", () => {
    expect(() => packedWhen(new Date(), { now, timeZone: "Mars/Olympus" })).not.toThrow();
  });

  test("Hindi keeps Latin digits", () => {
    const r = packedWhen(new Date("2026-09-28T06:00:00Z"), { now, timeZone: IST, locale: "hi" });
    expect(r.time).toBe("11:30");
    expect(r.date).toMatch(/^28 /);
  });
});
