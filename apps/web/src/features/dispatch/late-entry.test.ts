import { describe, expect, test } from "bun:test";

import { lateBounds, lateCheck } from "./late-entry";

const TZ = "Asia/Kolkata";
// 2026-11-10 11:30 in Kolkata.
const NOW = Date.UTC(2026, 10, 10, 6, 0);

describe("arch 52: the truck left earlier", () => {
  test("a time on the plant's clock within 72 hours and a reason are sent as that instant", () => {
    expect(lateCheck("2026-11-10T06:30", " Line down, paper PL ", TZ, NOW)).toEqual({
      kind: "ok",
      occurredAt: Date.UTC(2026, 10, 10, 1, 0),
      reason: "Line down, paper PL",
    });
  });

  test("no time, a time in the future, more than 72 hours back, and no reason are each named", () => {
    expect(lateCheck("", "Line down", TZ, NOW)).toEqual({ kind: "error", field: "time", key: "dispatch.late.noTime" });
    expect(lateCheck("2026-11-10T12:00", "Line down", TZ, NOW)).toEqual({ kind: "error", field: "time", key: "dispatch.late.future" });
    expect(lateCheck("2026-11-07T11:29", "Line down", TZ, NOW)).toEqual({ kind: "error", field: "time", key: "dispatch.late.tooOld" });
    expect(lateCheck("2026-11-10T09:00", "  ", TZ, NOW)).toEqual({ kind: "error", field: "reason", key: "dispatch.late.noReason" });
  });

  test("exactly 72 hours back is allowed", () => {
    expect(lateCheck("2026-11-07T11:30", "Line down", TZ, NOW).kind).toBe("ok");
  });

  test("the field runs from 72 hours back to now on the plant's clock", () => {
    expect(lateBounds(TZ, NOW)).toEqual({ min: "2026-11-07T11:30", max: "2026-11-10T11:30" });
  });
});
