import { describe, expect, test } from "bun:test";

import { addDays, MELT_TIME_KEYS, nowTimeIn, resolveMeltTimes, splitInstant, todayIn, zonedEpoch } from "../features/foundry/melt-times";

const IST = "Asia/Kolkata";

describe("zonedEpoch", () => {
  test("reads a wall-clock date and time in the plant's zone", () => {
    expect(zonedEpoch("2026-10-03", "06:30", IST)).toBe(Date.UTC(2026, 9, 3, 1, 0));
    expect(zonedEpoch("2026-10-03", "00:10", IST)).toBe(Date.UTC(2026, 9, 2, 18, 40));
  });

  test("handles a zone with daylight saving on both sides of the change", () => {
    expect(zonedEpoch("2026-07-01", "12:00", "America/New_York")).toBe(Date.UTC(2026, 6, 1, 16, 0));
    expect(zonedEpoch("2026-12-01", "12:00", "America/New_York")).toBe(Date.UTC(2026, 11, 1, 17, 0));
  });

  test("refuses text that is not a date or a time", () => {
    expect(zonedEpoch("2026-13-01", "06:30", IST)).toBeNull();
    expect(zonedEpoch("2026-02-30", "06:30", IST)).toBeNull();
    expect(zonedEpoch("2026-10-03", "25:00", IST)).toBeNull();
    expect(zonedEpoch("", "06:30", IST)).toBeNull();
    expect(zonedEpoch("2026-10-03", "", IST)).toBeNull();
  });
});

describe("todayIn / nowTimeIn / splitInstant", () => {
  test("give the plant's calendar day and clock, not the browser's", () => {
    const at = Date.UTC(2026, 9, 3, 20, 5); // 01:35 IST on 4 Oct
    expect(todayIn(IST, at)).toBe("2026-10-04");
    expect(nowTimeIn(IST, at)).toBe("01:35");
    expect(splitInstant(at, IST)).toEqual({ date: "2026-10-04", time: "01:35" });
  });
  test("addDays crosses a month end", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("bad", 1)).toBe("bad");
  });
});

describe("resolveMeltTimes", () => {
  const times = { preheatStart: "18:00", chargingStart: "20:15", chargingEnd: "22:40", castingStart: "23:30", castingEnd: "02:10" };

  test("lists the five times in sheet order", () => {
    expect(MELT_TIME_KEYS).toEqual(["preheatStart", "chargingStart", "chargingEnd", "castingStart", "castingEnd"]);
  });

  test("a time earlier than the one before it is on the next day (the melt ran past midnight)", () => {
    const r = resolveMeltTimes("2026-10-03", times, IST);
    expect(r.missing).toEqual([]);
    expect(r.nextDay.castingEnd).toBe(true);
    expect(r.nextDay.castingStart).toBe(false);
    expect(r.epochs.castingEnd).toBe(zonedEpoch("2026-10-04", "02:10", IST));
    expect(r.epochs.preheatStart).toBe(zonedEpoch("2026-10-03", "18:00", IST));
  });

  test("equal times stay on the same day", () => {
    const r = resolveMeltTimes("2026-10-03", { ...times, chargingEnd: "20:15" }, IST);
    expect(r.nextDay.chargingEnd).toBe(false);
  });

  test("blank times are missing and the written ones still resolve (a draft may be half filled)", () => {
    const r = resolveMeltTimes("2026-10-03", { preheatStart: "", chargingStart: "07:10", chargingEnd: "", castingStart: "", castingEnd: "17:05" }, IST);
    expect(r.missing).toEqual(["preheatStart", "chargingEnd", "castingStart"]);
    expect(r.epochs.chargingStart).toBe(zonedEpoch("2026-10-03", "07:10", IST));
    expect(r.epochs.castingEnd).toBe(zonedEpoch("2026-10-03", "17:05", IST));
    expect(r.epochs.preheatStart).toBeNull();
  });

  test("text that is not a clock time is invalid, not missing", () => {
    const r = resolveMeltTimes("2026-10-03", { ...times, castingStart: "7:70" }, IST);
    expect(r.invalid).toEqual(["castingStart"]);
    expect(r.epochs.castingStart).toBeNull();
  });

  test("a bad date resolves nothing", () => {
    const r = resolveMeltTimes("", times, IST);
    expect(Object.values(r.epochs).every((e) => e === null)).toBe(true);
  });
});
