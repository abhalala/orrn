import { describe, expect, test } from "bun:test";

import {
  SUGGESTED_SHIFTS,
  minuteText,
  productionDayStartMin,
  resolveShift,
  shiftAt,
  shiftLengthMin,
  validateShifts,
  type Shift,
} from "./shifts";

const dayNight: Shift[] = [
  { id: "day", name: "Day", seq: 1, startMin: 480, endMin: 1200 },
  { id: "night", name: "Night", seq: 2, startMin: 1200, endMin: 480 },
];

describe("validateShifts (C14: 1-4, no gap or overlap, union 24 h, touching ok)", () => {
  test("Day / Night is valid; the suggestion is the same shape", () => {
    expect(validateShifts(dayNight)).toEqual([]);
    expect(validateShifts(SUGGESTED_SHIFTS.map((s, i) => ({ ...s, id: `s${i}` })))).toEqual([]);
  });

  test("three shifts of 8 h, and one whole-day shift", () => {
    expect(
      validateShifts([
        { id: "a", name: "A shift", seq: 1, startMin: 360, endMin: 840 },
        { id: "b", name: "B shift", seq: 2, startMin: 840, endMin: 1320 },
        { id: "c", name: "C shift", seq: 3, startMin: 1320, endMin: 360 },
      ]),
    ).toEqual([]);
    expect(validateShifts([{ id: "x", name: "All day", seq: 1, startMin: 480, endMin: 480 }])).toEqual([]);
  });

  test("gaps, overlaps, counts, names, seq and minutes are refused", () => {
    expect(validateShifts([])).toEqual(["count"]);
    expect(validateShifts([{ ...dayNight[0]!, endMin: 1140 }, dayNight[1]!])).toEqual(["gap_or_overlap"]);
    expect(validateShifts([{ ...dayNight[0]!, endMin: 1260 }, dayNight[1]!])).toEqual(["gap_or_overlap"]);
    expect(validateShifts([dayNight[0]!, { ...dayNight[1]!, name: "day" }])).toEqual(["name_duplicate"]);
    expect(validateShifts([dayNight[0]!, { ...dayNight[1]!, name: "  " }])).toEqual(["name_empty"]);
    expect(validateShifts([dayNight[0]!, { ...dayNight[1]!, name: "N".repeat(41) }])).toEqual(["name_long"]);
    expect(validateShifts([dayNight[0]!, { ...dayNight[1]!, seq: 3 }])).toEqual(["seq"]);
    expect(validateShifts([dayNight[0]!, { ...dayNight[1]!, endMin: 1440 }])).toEqual(["minute_range"]);
    expect(validateShifts([dayNight[0]!, { ...dayNight[1]!, id: "day" }])).toEqual(["id"]);
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, seq: i + 1, startMin: i * 288, endMin: ((i + 1) * 288) % 1440 }));
    expect(validateShifts(five)).toContain("count");
  });
});

describe("shiftAt and the production day (C15)", () => {
  test("start inclusive, end exclusive, wrapping midnight", () => {
    expect(shiftAt(dayNight, 480)?.id).toBe("day");
    expect(shiftAt(dayNight, 1199)?.id).toBe("day");
    expect(shiftAt(dayNight, 1200)?.id).toBe("night");
    expect(shiftAt(dayNight, 0)?.id).toBe("night");
    expect(shiftAt(dayNight, 479)?.id).toBe("night");
    expect(shiftAt([], 600)).toBeNull();
    expect(shiftLengthMin(dayNight[1]!)).toBe(720);
  });

  test("02:00 on 24 Oct is production day 23 Oct, Night (seq 2); 09:10 is 24 Oct Day", () => {
    expect(resolveShift(dayNight, { year: 2026, month: 10, day: 24, minuteOfDay: 120 })).toEqual({
      productionDay: "2026-10-23",
      shiftId: "night",
      shiftSeq: 2,
      shiftName: "Night",
    });
    expect(resolveShift(dayNight, { year: 2026, month: 10, day: 24, minuteOfDay: 550 })).toEqual({
      productionDay: "2026-10-24",
      shiftId: "day",
      shiftSeq: 1,
      shiftName: "Day",
    });
  });

  test("before shift 1 on the 1st of a month / year rolls back across the boundary", () => {
    expect(resolveShift(dayNight, { year: 2027, month: 1, day: 1, minuteOfDay: 60 }).productionDay).toBe("2026-12-31");
    expect(resolveShift(dayNight, { year: 2027, month: 3, day: 1, minuteOfDay: 60 }).productionDay).toBe("2027-02-28");
  });

  test("no shifts: calendar midnight, no shift", () => {
    expect(resolveShift([], { year: 2026, month: 10, day: 24, minuteOfDay: 120 })).toEqual({
      productionDay: "2026-10-24",
      shiftId: null,
      shiftSeq: null,
      shiftName: null,
    });
    expect(productionDayStartMin([])).toBe(0);
    expect(productionDayStartMin(dayNight)).toBe(480);
  });

  test("minute text", () => {
    expect(minuteText(480)).toBe("08:00");
    expect(minuteText(1439)).toBe("23:59");
  });
});
