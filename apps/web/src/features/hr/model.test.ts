import { describe, expect, test } from "bun:test";

import { DEFAULT_HR_RULES } from "@orrn/domain";

import {
  badTimes,
  canSaveDay,
  cellFor,
  cellInput,
  cellValue,
  dayState,
  daysToHalves,
  draftChanged,
  draftsFromRows,
  emptyPerson,
  emptyMap,
  fileHead,
  formFromMap,
  formFromRules,
  guessDelimiter,
  halvesToDays,
  hoursMinutes,
  isHhmm,
  mapFromForm,
  markAllPresent,
  markCounts,
  markPayload,
  matchesPerson,
  monthOf,
  nextEffectiveMonth,
  paidDaysText,
  percentToBp,
  personInput,
  personProblems,
  recentMonths,
  rulesFromForm,
  setStatus,
  shiftMonth,
  weekDays,
  weekStart,
  type SheetRow,
} from "./model";
import { timesheetSearch } from "./search";

const TODAY = "2026-11-12";
const timeOf = (at: Date | string | null | undefined) => (at ? String(at).slice(0, 5) : "");

function row(id: string, over: Partial<SheetRow> = {}): SheetRow {
  return { employeeId: id, code: id.toUpperCase(), name: `Person ${id}`, rosteredOff: false, mark: null, ...over } as SheetRow;
}

describe("halves and days", () => {
  test("halves are shown as days", () => {
    expect([0, 1, 2, 3, 4, 25].map(halvesToDays)).toEqual(["0", "0.5", "1", "1.5", "2", "12.5"]);
    expect(paidDaysText(53)).toBe("26.5");
  });
  test("days typed come back as halves; a quarter day is refused", () => {
    expect(daysToHalves("12")).toBe(24);
    expect(daysToHalves("7.5")).toBe(15);
    expect(daysToHalves("0")).toBe(0);
    expect(daysToHalves("7.25")).toBeNull();
    expect(daysToHalves("abc")).toBeNull();
    expect(daysToHalves("-1")).toBeNull();
  });
  test("minutes split into hours and minutes", () => {
    expect(hoursMinutes(150)).toEqual({ h: 2, m: 30 });
    expect(hoursMinutes(-5)).toEqual({ h: 0, m: 0 });
  });
});

describe("weeks and months", () => {
  test("a week starts on Monday and has seven days", () => {
    expect(weekStart("2026-11-12")).toBe("2026-11-09");
    expect(weekStart("2026-11-15")).toBe("2026-11-09");
    expect(weekDays("2026-11-09")).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
  });
  test("months step over a year end and list newest first", () => {
    expect(shiftMonth("2026-11", 1)).toBe("2026-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(recentMonths("2026-02", 3)).toEqual(["2026-02", "2026-01", "2025-12"]);
    expect(monthOf(TODAY)).toBe("2026-11");
  });
  test("a rule change cannot start inside a locked month", () => {
    expect(nextEffectiveMonth(TODAY, null)).toBe("2026-11");
    expect(nextEffectiveMonth(TODAY, "2026-10")).toBe("2026-11");
    expect(nextEffectiveMonth(TODAY, "2026-11")).toBe("2026-12");
  });
});

describe("late entry (a day older than yesterday needs attendance.manage)", () => {
  test("today and yesterday are normal, older is late, tomorrow is refused", () => {
    expect(dayState("2026-11-12", TODAY)).toBe("ok");
    expect(dayState("2026-11-11", TODAY)).toBe("ok");
    expect(dayState("2026-11-10", TODAY)).toBe("late");
    expect(dayState("2026-11-13", TODAY)).toBe("future");
    expect(dayState("12/11/2026", TODAY)).toBe("bad");
    expect(dayState("", TODAY)).toBe("bad");
  });
  test("a supervisor saves normal days only; the office saves late days too", () => {
    expect(canSaveDay("ok", false)).toBe(true);
    expect(canSaveDay("late", false)).toBe(false);
    expect(canSaveDay("late", true)).toBe(true);
    expect(canSaveDay("future", true)).toBe(false);
    expect(canSaveDay("bad", true)).toBe(false);
  });
  test("the month rolls back over a year end for yesterday", () => {
    expect(dayState("2025-12-31", "2026-01-01")).toBe("ok");
    expect(dayState("2025-12-30", "2026-01-01")).toBe("late");
  });
});

describe("the attendance draft of one shift", () => {
  const rows = [
    row("a"),
    row("b", { mark: { status: "absent", inAt: null, outAt: null, workedMin: 0, overtimeMin: 0, source: "manual", lateEntry: false, note: null, markedAt: new Date() } as SheetRow["mark"] }),
    row("c", { rosteredOff: true }),
    row("d", { mark: { status: "present", inAt: "07:55:00", outAt: "16:05:00", workedMin: 490, overtimeMin: 10, source: "punch", lateEntry: false, note: null, markedAt: new Date() } as SheetRow["mark"] }),
  ];

  test("it starts from what is marked; a person rostered off starts as weekly off; the rest are untouched", () => {
    const d = draftsFromRows(rows, timeOf);
    expect(d.a).toEqual({ status: null, inTime: "", outTime: "" });
    expect(d.b?.status).toBe("absent");
    expect(d.c?.status).toBe("weekly_off");
    expect(d.d).toEqual({ status: "present", inTime: "07:55", outTime: "16:05" });
  });

  test("Mark all present gives a status only to people who have none", () => {
    const d = markAllPresent(rows, draftsFromRows(rows, timeOf));
    expect(d.a?.status).toBe("present");
    expect(d.b?.status).toBe("absent");
    expect(d.c?.status).toBe("weekly_off");
    expect(markCounts(rows, d)).toEqual({ present: 2, absent: 1, half_day: 0, leave: 0, weekly_off: 1, holiday: 0, unmarked: 0 });
  });

  test("a status that is not a worked one drops the typed times", () => {
    let d = draftsFromRows(rows, timeOf);
    d = { ...d, a: { status: "present", inTime: "08:00", outTime: "17:00" } };
    expect(setStatus(d, "a", "half_day").a).toEqual({ status: "half_day", inTime: "08:00", outTime: "17:00" });
    expect(setStatus(d, "a", "leave").a).toEqual({ status: "leave", inTime: "", outTime: "" });
  });

  test("only people with a status are sent, with blank times as null", () => {
    let d = draftsFromRows(rows, timeOf);
    d = setStatus(d, "a", "present");
    d = { ...d, a: { ...d.a!, inTime: "08:00" } };
    expect(markPayload(rows, d)).toEqual([
      { employeeId: "a", status: "present", inTime: "08:00", outTime: null },
      { employeeId: "b", status: "absent", inTime: null, outTime: null },
      { employeeId: "c", status: "weekly_off", inTime: null, outTime: null },
      { employeeId: "d", status: "present", inTime: "07:55", outTime: "16:05" },
    ]);
    // Nobody touched: nothing to send for the untouched person.
    expect(markPayload([row("z")], { z: { status: null, inTime: "", outTime: "" } })).toEqual([]);
  });

  test("times must be HH:MM; the people with a bad time are named", () => {
    expect(isHhmm("07:30")).toBe(true);
    expect(isHhmm("7:30")).toBe(false);
    expect(isHhmm("24:00")).toBe(false);
    expect(isHhmm("")).toBe(false);
    const d = { ...draftsFromRows(rows, timeOf), a: { status: "present" as const, inTime: "8", outTime: "" } };
    expect(badTimes(rows, d)).toEqual(["a"]);
  });

  test("the draft is changed only when it differs from the server", () => {
    const base = draftsFromRows(rows, timeOf);
    expect(draftChanged(rows, base, timeOf)).toBe(false);
    expect(draftChanged(rows, setStatus(base, "a", "present"), timeOf)).toBe(true);
    expect(draftChanged(rows, { ...base, d: { ...base.d!, outTime: "17:00" } }, timeOf)).toBe(true);
  });
});

describe("the roster cell", () => {
  const cells = [
    { employeeId: "a", day: "2026-11-09", shiftId: "s1" },
    { employeeId: "a", day: "2026-11-10", shiftId: null },
  ];
  test("a stored cell wins, no cell means the person's own shift, null is the weekly off", () => {
    expect(cellValue(cellFor(cells, "a", "2026-11-09"))).toBe("s1");
    expect(cellValue(cellFor(cells, "a", "2026-11-10"))).toBe("off");
    expect(cellValue(cellFor(cells, "a", "2026-11-11"))).toBe("default");
    expect(cellInput("off")).toBeNull();
    expect(cellInput("default")).toBe("default");
    expect(cellInput("s2")).toBe("s2");
  });
});

describe("people search", () => {
  test("name or code, any case", () => {
    expect(matchesPerson({ code: "E07", name: "Ramesh Patel" }, "ramesh")).toBe(true);
    expect(matchesPerson({ code: "E07", name: "Ramesh Patel" }, "e07")).toBe(true);
    expect(matchesPerson({ code: "E07", name: "Ramesh Patel" }, "x")).toBe(false);
    expect(matchesPerson({ code: "E07", name: "Ramesh Patel" }, "  ")).toBe(true);
  });
});

describe("the person form", () => {
  const base = { ...emptyPerson(TODAY), code: "e07", name: "Ramesh" };
  test("a plain person has no problem; the account, PAN and Aadhaar boxes stay out when empty (the stored number stays)", () => {
    expect(personProblems(base)).toEqual([]);
    const input = personInput(base);
    expect(input).not.toHaveProperty("bankAccountNo");
    expect(input).not.toHaveProperty("pan");
    expect(input).not.toHaveProperty("aadhaar");
    expect(input.departmentId).toBeNull();
    expect(input.contractorName).toBeNull();
  });
  test("typed numbers go to the server as typed", () => {
    const input = personInput({ ...base, bankAccountNo: "1234 5678", pan: "ABCDE1234F", aadhaar: "1234 5678 9012" });
    expect(input).toMatchObject({ bankAccountNo: "1234 5678", pan: "ABCDE1234F", aadhaar: "1234 5678 9012" });
  });
  test("every field check the server makes is made here first", () => {
    const f = { ...base, code: " ", name: "", joinedOn: "x", dob: "2030-01-01", phone: "ab", bankAccountNo: "12ab", bankIfsc: "SBIN123", uan: "123", esicIp: "12", kind: "contract" as const, contractorName: "" };
    expect(personProblems(f)).toEqual(["code", "name", "joinedOn", "phone", "account", "ifsc", "uan", "esic", "contractor"]);
    expect(personProblems({ ...base, dob: "2030-01-01" })).toEqual(["dob"]);
    expect(personProblems({ ...base, bankIfsc: "sbin0001234" })).toEqual([]);
  });
  test("the contractor name goes only with a contract", () => {
    expect(personInput({ ...base, kind: "permanent", contractorName: "X" }).contractorName).toBeNull();
    expect(personInput({ ...base, kind: "contract", contractorName: " Shiv Labour " }).contractorName).toBe("Shiv Labour");
  });
  test("a weekly off of Sunday (0) is kept, not treated as blank", () => {
    expect(personInput({ ...base, weeklyOffDow: "0" }).weeklyOffDow).toBe(0);
    expect(personInput({ ...base, weeklyOffDow: "" }).weeklyOffDow).toBeNull();
  });
});

describe("the HR rules form", () => {
  test("the defaults go into the form and come back unchanged", () => {
    const f = formFromRules(DEFAULT_HR_RULES);
    expect(f.overtimeRate).toBe("2");
    expect(f.bonusPercent).toBe("8.33");
    expect(f.monthDaysBasis).toBe("calendar");
    const out = rulesFromForm(f);
    expect(out).toEqual({ ok: true, value: DEFAULT_HR_RULES });
  });
  test("a rate of one and a half and a 26 day month", () => {
    const out = rulesFromForm({ ...formFromRules(DEFAULT_HR_RULES), overtimeRate: "1.5", monthDaysBasis: "26", bonusPercent: "20" });
    expect(out.ok && out.value).toMatchObject({ overtimeRateX100: 150, monthDaysBasis: 26, bonusBp: 2000 });
  });
  test("the limits of the server are the limits here", () => {
    const bad = rulesFromForm({ ...formFromRules(DEFAULT_HR_RULES), retirementAge: "44", overtimeRate: "0.5", hoursPerDay: "13", bonusPercent: "21", encashDivisor: "19", overtimeStepMinutes: "0", overtimeMinMinutes: "241" });
    expect(bad).toEqual({ ok: false, problems: ["retirementAge", "overtimeMinMinutes", "overtimeStepMinutes", "overtimeRate", "hoursPerDay", "bonusPercent", "encashDivisor"] });
    expect(rulesFromForm({ ...formFromRules(DEFAULT_HR_RULES), retirementAge: "58.5" }).ok).toBe(false);
    expect(rulesFromForm({ ...formFromRules(DEFAULT_HR_RULES), overtimeRate: "4" }).ok).toBe(true);
  });
  test("percent to basis points", () => {
    expect(percentToBp("80")).toBe(8000);
    expect(percentToBp("8.33")).toBe(833);
    expect(percentToBp("101")).toBeNull();
    expect(percentToBp("x")).toBeNull();
  });
});

describe("the device column map", () => {
  test("columns count from 1 on screen and from 0 on the wire", () => {
    const out = mapFromForm(emptyMap());
    expect(out).toEqual({ ok: true, value: { code: 0, dateTime: 1, dateOrder: "ymd", delimiter: ",", hasHeader: true } });
    const two = mapFromForm({ ...emptyMap(), mode: "two", code: "3", date: "1", time: "2", dateOrder: "dmy", delimiter: "\t", hasHeader: false });
    expect(two).toEqual({ ok: true, value: { code: 2, date: 0, time: 1, dateOrder: "dmy", delimiter: "\t", hasHeader: false } });
  });
  test("a saved map reads back into the form the same", () => {
    const saved = { code: 4, date: 0, time: 1, dateOrder: "dmy" as const, delimiter: ";" as const, hasHeader: true };
    const form = formFromMap(saved);
    expect(form).toMatchObject({ code: "5", mode: "two", date: "1", time: "2", dateOrder: "dmy", delimiter: ";" });
    expect(mapFromForm(form)).toEqual({ ok: true, value: saved });
    expect(formFromMap(null)).toEqual(emptyMap());
  });
  test("a bad column number is named, one date column only for the chosen mode", () => {
    expect(mapFromForm({ ...emptyMap(), code: "0" })).toEqual({ ok: false, problems: ["code"] });
    expect(mapFromForm({ ...emptyMap(), mode: "two", date: "", time: "99" })).toEqual({ ok: false, problems: ["date", "time"] });
    expect(mapFromForm({ ...emptyMap(), mode: "one", date: "", time: "" }).ok).toBe(true);
  });
  test("the first guess of the split character and the lines echoed", () => {
    expect(guessDelimiter("101;2026-11-03 07:52:10;IN")).toBe(";");
    expect(guessDelimiter("101\t2026-11-03\t07:52")).toBe("\t");
    expect(guessDelimiter("101,2026-11-03,07:52")).toBe(",");
    expect(guessDelimiter("")).toBe(",");
    expect(fileHead("\n\nA\nB\nC\nD\n", 3)).toEqual(["A", "B", "C"]);
  });
});

describe("the timesheet search", () => {
  test("a person and a month are kept; junk is dropped", () => {
    expect(timesheetSearch({ id: "e1", month: "2026-11" })).toEqual({ id: "e1", month: "2026-11" });
    expect(timesheetSearch({ id: "  ", month: "2026-13" })).toEqual({});
    expect(timesheetSearch({ id: "x".repeat(65), month: 5 })).toEqual({});
  });
});
