import { describe, expect, test } from "bun:test";

import { createI18n } from "@orrn/i18n";

import { lateCheck, lateExtras, lateStartDate } from "../features/dispatch/late-entry";
import { completeRefusalText } from "../features/dispatch/off-band";

const TZ = "Asia/Kolkata";
// 2026-11-10 11:30 in Kolkata.
const NOW = Date.UTC(2026, 10, 10, 6, 0);
const { t } = createI18n("en");
const err = (message: string, code = "PRECONDITION_FAILED") => ({ message, data: { code } });

describe("arch 52: late packing list on the phone (parity with web)", () => {
  test("a date and 24 hour time on the plant's clock within 72 hours, with a reason, are sent as that instant", () => {
    const check = lateCheck("2026-11-10", "06:30", " Line down ", TZ, NOW);
    expect(check).toEqual({ kind: "ok", occurredAt: Date.UTC(2026, 10, 10, 1, 0), reason: "Line down" });
    expect(lateExtras(check)).toEqual({ occurredAt: Date.UTC(2026, 10, 10, 1, 0), lateReason: "Line down" });
    expect(lateExtras(null)).toEqual({});
  });

  test("bad or missing time, the future, more than 72 hours back, and no reason are each named", () => {
    expect(lateCheck("2026-11-10", "6.30", "Line down", TZ, NOW)).toEqual({ kind: "error", field: "time", key: "dispatch.late.noTime" });
    expect(lateCheck("2026-11-10", "12:00", "Line down", TZ, NOW)).toEqual({ kind: "error", field: "time", key: "dispatch.late.future" });
    expect(lateCheck("2026-11-07", "11:29", "Line down", TZ, NOW)).toEqual({ kind: "error", field: "time", key: "dispatch.late.tooOld" });
    expect(lateCheck("2026-11-07", "11:30", "Line down", TZ, NOW).kind).toBe("ok");
    expect(lateCheck("2026-11-10", "09:00", "", TZ, NOW)).toEqual({ kind: "error", field: "reason", key: "dispatch.late.noReason" });
    expect(lateExtras(lateCheck("2026-11-10", "09:00", "", TZ, NOW))).toEqual({});
  });

  test("the date starts on today on the plant's calendar", () => {
    expect(lateStartDate(TZ, Date.UTC(2026, 10, 9, 19, 0))).toBe("2026-11-10");
  });

  test("the server's late refusals are said in the floor's words", () => {
    expect(completeRefusalText(t, err("Entered late: a second person has to approve the dispatch time before this dispatch can complete."))).toBe(
      "A manager has to approve the time the truck left. Press Dispatch again once it is approved.",
    );
    expect(completeRefusalText(t, err("The dispatch time can't be in the future.", "BAD_REQUEST"))).toBe("That time is in the future. Check the date and time.");
    expect(completeRefusalText(t, err("A late packing list can go back at most 72 hours.", "BAD_REQUEST"))).toBe("A late packing list can go back at most 72 hours.");
    expect(completeRefusalText(t, err("Dispatch is empty", "BAD_REQUEST"))).toBeNull();
  });
});
