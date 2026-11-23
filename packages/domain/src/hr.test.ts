import { describe, expect, test } from "bun:test";

import {
  attendanceFigures,
  leaveBalance,
  leaveHalves,
  maskAccount,
  lastFour,
  overtimeMinutes,
  pairPunches,
  parsePunchFile,
  retirementDate,
  retiringWithin,
  serviceLength,
  timesheet,
  trainingExpiry,
  trainingState,
  weekStart,
} from "./hr";
import type { Shift } from "./shifts";

const DAY: Shift = { id: "d", name: "Day", seq: 1, startMin: 8 * 60, endMin: 20 * 60 };
const NIGHT: Shift = { id: "n", name: "Night", seq: 2, startMin: 20 * 60, endMin: 8 * 60 };
const SHIFTS = [DAY, NIGHT];
const at = (ymd: string, hhmm: string) => Date.parse(`${ymd}T${hhmm}:00Z`);

describe("punch pairing", () => {
  test("a day shift: in and out, a double tap is one punch", () => {
    const days = pairPunches([at("2026-11-03", "07:52"), at("2026-11-03", "07:53"), at("2026-11-03", "20:41")], SHIFTS);
    expect(days).toEqual([{ day: "2026-11-03", shiftId: "d", inMs: at("2026-11-03", "07:52"), outMs: at("2026-11-03", "20:41"), punches: 2 }]);
  });

  test("a night shift across midnight belongs to the evening's day", () => {
    const days = pairPunches([at("2026-11-04", "08:06"), at("2026-11-03", "19:55")], SHIFTS);
    expect(days).toEqual([{ day: "2026-11-03", shiftId: "n", inMs: at("2026-11-03", "19:55"), outMs: at("2026-11-04", "08:06"), punches: 2 }]);
    const fig = attendanceFigures(days[0]!.inMs, days[0]!.outMs, NIGHT);
    expect(fig).toEqual({ workedMin: 731, overtimeMin: 0 });
  });

  test("two night shifts in a row pair separately; a lone punch has no out", () => {
    const days = pairPunches(
      [at("2026-11-03", "19:58"), at("2026-11-04", "08:02"), at("2026-11-04", "19:59"), at("2026-11-05", "09:10"), at("2026-11-06", "07:58")],
      SHIFTS,
    );
    expect(days.map((d) => [d.day, d.shiftId, d.outMs !== null])).toEqual([
      ["2026-11-03", "n", true],
      ["2026-11-04", "n", true],
      ["2026-11-06", "d", false],
    ]);
    expect(attendanceFigures(days[1]!.inMs, days[1]!.outMs, NIGHT).overtimeMin).toBe(60);
  });

  test("no shifts set: the calendar day", () => {
    expect(pairPunches([at("2026-11-03", "09:00"), at("2026-11-03", "17:30")], [])[0]).toMatchObject({ day: "2026-11-03", shiftId: null });
  });
});

describe("overtime", () => {
  test("whole steps from the minimum", () => {
    expect(overtimeMinutes(720 + 29, 720)).toBe(0);
    expect(overtimeMinutes(720 + 30, 720)).toBe(30);
    expect(overtimeMinutes(720 + 89, 720)).toBe(60);
    expect(overtimeMinutes(600, 720)).toBe(0);
    expect(overtimeMinutes(720 + 7, 720, { minMinutes: 0, stepMinutes: 1 })).toBe(7);
  });
});

describe("device file", () => {
  test("a date-time column, a header, bad lines named", () => {
    const text = "EmpCode,Punch\n101,2026-11-03 07:52:10\n102,03/11/2026 08:01\n103,garbage\n,2026-11-03 08:00";
    const ymd = parsePunchFile(text, { code: 0, dateTime: 1, dateOrder: "ymd", delimiter: ",", hasHeader: true });
    expect(ymd.punches).toEqual([{ line: 2, code: "101", localMs: Date.parse("2026-11-03T07:52:10Z") }]);
    expect(ymd.errors.map((e) => [e.line, e.reason])).toEqual([[3, "time"], [4, "time"], [5, "code"]]);
  });

  test("separate date and time columns, day first, tabs, pm", () => {
    const r = parsePunchFile("7\t31-10-2026\t08:15 pm", { code: 0, date: 1, time: 2, dateOrder: "dmy", delimiter: "\t", hasHeader: false });
    expect(r.punches[0]).toMatchObject({ code: "7", localMs: Date.parse("2026-10-31T20:15:00Z") });
    expect(parsePunchFile("7\t31-02-2026\t08:15", { code: 0, date: 1, time: 2, dateOrder: "dmy", delimiter: "\t", hasHeader: false }).errors).toHaveLength(1);
  });
});

describe("timesheet", () => {
  test("paid days: absences, half days, unpaid leave and unmarked working days are loss of pay", () => {
    const t = timesheet({
      month: "2026-02",
      marks: [
        { day: "2026-02-02", status: "present", overtimeMin: 60 },
        { day: "2026-02-03", status: "half_day", overtimeMin: 0 },
        { day: "2026-02-04", status: "absent", overtimeMin: 0 },
        { day: "2026-02-05", status: "leave", overtimeMin: 0, paidLeave: true },
        { day: "2026-02-06", status: "leave", overtimeMin: 0, paidLeave: false },
      ],
      joinedOn: "2026-02-02",
      leftOn: null,
      weeklyOffDow: 0,
      holidays: new Set(["2026-02-26"]),
    });
    // Feb 2026: 28 days, 1 day before joining, 4 Sundays (1, 8, 15, 22; the 1st is before joining), 1 holiday.
    expect(t).toMatchObject({ days: 28, presentHalves: 3, absent: 1, halfDays: 1, leavePaid: 1, leaveUnpaid: 1, weeklyOff: 3, holiday: 1, overtimeMin: 60 });
    // Unmarked working days: 28 - 1 (before joining) - 5 marked - 3 Sundays - 1 holiday = 18.
    expect(t.notMarked).toBe(18);
    expect(t.lopHalves).toBe(2 + 1 + 2 + 2 + 18 * 2);
    expect(t.paidHalves).toBe(56 - t.lopHalves);
  });
});

describe("leave", () => {
  const holidays = new Set(["2026-11-09"]);
  test("days skip the weekly off and holidays; a one-day half leave is half", () => {
    expect(leaveHalves({ from: "2026-11-06", to: "2026-11-10", halfDay: false, weeklyOffDow: 0, holidays })).toBe(6);
    expect(leaveHalves({ from: "2026-11-10", to: "2026-11-10", halfDay: true, weeklyOffDow: 0, holidays })).toBe(1);
    expect(leaveHalves({ from: "2026-11-08", to: "2026-11-08", halfDay: true, weeklyOffDow: 0, holidays })).toBe(0);
  });

  test("carry forward up to the cap", () => {
    const rule = { quotaHalves: 24, carryCapHalves: 10 };
    const taken = new Map([[2025, 4], [2026, 6]]);
    expect(leaveBalance(rule, taken, 2025, 2025)).toEqual({ carryInHalves: 0, quotaHalves: 24, takenHalves: 4, balanceHalves: 20 });
    expect(leaveBalance(rule, taken, 2025, 2026)).toEqual({ carryInHalves: 10, quotaHalves: 24, takenHalves: 6, balanceHalves: 28 });
    expect(leaveBalance(rule, taken, 2025, 2026, 4).carryInHalves).toBe(10);
  });
});

describe("people", () => {
  test("masking keeps the last four only", () => {
    expect(maskAccount("3012 3456 789")).toBe("XXXXXXX6789");
    expect(maskAccount("")).toBe("");
    expect(lastFour("1234 5678 9012")).toBe("9012");
  });

  test("retirement date and the 90-day list", () => {
    expect(retirementDate("1968-02-29", 58)).toBe("2026-02-28");
    expect(retiringWithin("1968-12-15", 58, "2026-11-22", 90)).toBe("2026-12-15");
    expect(retiringWithin("1969-12-15", 58, "2026-11-22", 90)).toBeNull();
  });

  test("training validity", () => {
    expect(trainingExpiry("2025-01-31", 12)).toBe("2026-01-31");
    expect(trainingExpiry("2025-08-31", 6)).toBe("2026-02-28");
    expect(trainingState("2026-12-01", "2026-11-22")).toBe("due_soon");
    expect(trainingState("2026-11-01", "2026-11-22")).toBe("expired");
    expect(trainingState(null, "2026-11-22")).toBe("no_expiry");
  });

  test("service length and week start", () => {
    expect(serviceLength("2019-06-10", "2026-01-05")).toEqual({ years: 6, months: 6, days: 26 });
    expect(weekStart("2026-11-22")).toBe("2026-11-16");
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
  });
});
