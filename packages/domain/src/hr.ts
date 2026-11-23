/**
 * XE parity lane HR (rows 86, 87, 90, 93): people, attendance, punches, leave and retirement rules.
 * Pure functions; the server computes every derived number from them (AGENTS "Pure rules go in
 * packages/domain"). Times are LOCAL wall clock in the plant's time zone, as epoch-like milliseconds
 * (the server converts with `zonedOffsetMs`), so a day boundary is a plain UTC day boundary here.
 * Days are counted in halves (`*Halves`) so a half day never needs a float.
 */
import { addDaysYmd } from "./pricing";
import { shiftLengthMin, type Shift } from "./shifts";



export const HR_EMPLOYMENT_KINDS = ["permanent", "contract", "apprentice", "casual"] as const;
export type HrEmploymentKind = (typeof HR_EMPLOYMENT_KINDS)[number];

export const HR_ATTENDANCE_STATUSES = ["present", "absent", "half_day", "leave", "weekly_off", "holiday"] as const;
export type HrAttendanceStatus = (typeof HR_ATTENDANCE_STATUSES)[number];

export const HR_CANDIDATE_STAGES = ["applied", "called", "interviewed", "offered", "joined", "dropped"] as const;
export type HrCandidateStage = (typeof HR_CANDIDATE_STAGES)[number];

export const HR_LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type HrLeaveStatus = (typeof HR_LEAVE_STATUSES)[number];

export const MINUTE_MS = 60_000;
const pad2 = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` of a local wall millisecond. */
export function ymdOfLocal(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Local wall millisecond of `YYYY-MM-DD` 00:00. */
export function localMsOfYmd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

/** Days of `YYYY-MM`, in order. */
export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${pad2(i + 1)}`);
}

/** 0 = Sunday. */
export function dayOfWeek(ymd: string): number {
  return new Date(localMsOfYmd(ymd)).getUTCDay();
}

/** Monday of the week holding `ymd`. */
export function isMonth(v: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

// ---------------------------------------------------------------------------
// Masking (personal data: no full Aadhaar, bank numbers masked in lists)
// ---------------------------------------------------------------------------

/** `XXXXXX1234` style: every digit but the last four hidden. Empty stays empty. */
export function maskAccount(no: string | null | undefined): string {
  const digits = (no ?? "").replace(/\s+/g, "");
  if (!digits) return "";
  if (digits.length <= 4) return digits;
  return `${"X".repeat(Math.min(8, digits.length - 4))}${digits.slice(-4)}`;
}

/** Only the last four digits of PAN or Aadhaar are ever stored. */
export function lastFour(v: string | null | undefined): string | null {
  const t = (v ?? "").replace(/\s+/g, "").toUpperCase();
  if (!t) return null;
  return t.slice(-4);
}

// ---------------------------------------------------------------------------
// Overtime and attendance from a shift
// ---------------------------------------------------------------------------

/** Plant overtime rule: minutes past the shift count in whole steps once they reach the minimum. */
export type OvertimeRule = { minMinutes: number; stepMinutes: number };
export const DEFAULT_OVERTIME_RULE: OvertimeRule = { minMinutes: 30, stepMinutes: 30 };

/** Overtime minutes for a worked span against the shift length (never negative). */
export function overtimeMinutes(workedMin: number, shiftMin: number, rule: OvertimeRule = DEFAULT_OVERTIME_RULE): number {
  const extra = Math.max(0, Math.floor(workedMin) - shiftMin);
  if (extra < Math.max(0, rule.minMinutes) || extra === 0) return 0;
  const step = Math.max(1, rule.stepMinutes);
  return Math.floor(extra / step) * step;
}

/** Status from an in and out: under half the shift is a half day. */
export function statusFromSpan(workedMin: number | null, shiftMin: number): "present" | "half_day" {
  if (workedMin === null) return "present";
  return workedMin * 2 < shiftMin ? "half_day" : "present";
}

/** Worked minutes and overtime for one marked day (supervisor screen, punch pairing). */
export function attendanceFigures(
  inMs: number | null,
  outMs: number | null,
  shift: Pick<Shift, "startMin" | "endMin"> | null,
  rule: OvertimeRule = DEFAULT_OVERTIME_RULE,
): { workedMin: number | null; overtimeMin: number } {
  if (inMs === null || outMs === null || outMs <= inMs) return { workedMin: null, overtimeMin: 0 };
  const workedMin = Math.floor((outMs - inMs) / MINUTE_MS);
  return { workedMin, overtimeMin: shift ? overtimeMinutes(workedMin, shiftLengthMin(shift), rule) : 0 };
}

// ---------------------------------------------------------------------------
// Punch pairing (row 93)
// ---------------------------------------------------------------------------

export type PairedDay = {
  /** Day of the shift's start (a night shift that ends next morning belongs to the evening's day). */
  day: string;
  shiftId: string | null;
  inMs: number;
  outMs: number | null;
  punches: number;
};

/** Two taps within this many minutes are one punch. */
export const PUNCH_DEBOUNCE_MIN = 2;
/** A punch this long after the in (past the shift length) starts a new day. */
export const PUNCH_MAX_EXTRA_MIN = 6 * 60;
/** How early before a shift start an in punch may come. */
export const PUNCH_EARLY_MIN = 3 * 60;

/** The shift instance an in punch belongs to: the nearest start no more than PUNCH_EARLY_MIN after it, or the one it falls in. */
export function shiftForIn(inMs: number, shifts: readonly Shift[]): { day: string; shift: Shift | null } {
  if (shifts.length === 0) return { day: ymdOfLocal(inMs), shift: null };
  const calendar = ymdOfLocal(inMs);
  let best: { day: string; shift: Shift; dist: number } | null = null;
  for (const offset of [-1, 0, 1]) {
    const day = addDaysYmd(calendar, offset);
    for (const s of shifts) {
      const start = localMsOfYmd(day) + s.startMin * MINUTE_MS;
      const end = start + shiftLengthMin(s) * MINUTE_MS;
      if (inMs < start - PUNCH_EARLY_MIN * MINUTE_MS || inMs >= end) continue;
      const dist = Math.abs(inMs - start);
      if (!best || dist < best.dist) best = { day, shift: s, dist };
    }
  }
  return best ? { day: best.day, shift: best.shift } : { day: calendar, shift: null };
}

/**
 * Pair one person's punches into days. Sorted and de-bounced first; the first punch of a day is the in,
 * the last punch within the shift length plus PUNCH_MAX_EXTRA_MIN is the out, and the next punch starts
 * the next day. A day with a single punch has no out (shown as "out missing").
 */
export function pairPunches(punchesMs: readonly number[], shifts: readonly Shift[]): PairedDay[] {
  const sorted = [...punchesMs].sort((a, b) => a - b);
  const taps: number[] = [];
  for (const p of sorted) {
    if (taps.length && p - taps[taps.length - 1]! < PUNCH_DEBOUNCE_MIN * MINUTE_MS) continue;
    taps.push(p);
  }
  const days: PairedDay[] = [];
  let i = 0;
  while (i < taps.length) {
    const inMs = taps[i]!;
    const { day, shift } = shiftForIn(inMs, shifts);
    const spanMin = (shift ? shiftLengthMin(shift) : 8 * 60) + PUNCH_MAX_EXTRA_MIN;
    let j = i + 1;
    let outMs: number | null = null;
    while (j < taps.length && taps[j]! - inMs <= spanMin * MINUTE_MS) {
      outMs = taps[j]!;
      j += 1;
    }
    days.push({ day, shiftId: shift?.id ?? null, inMs, outMs, punches: j - i });
    i = j;
  }
  // One row per day: a second session on the same day keeps the first in and the later out.
  const merged: PairedDay[] = [];
  for (const d of days) {
    const prev = merged[merged.length - 1];
    if (prev && prev.day === d.day) {
      prev.outMs = d.outMs ?? d.inMs;
      prev.punches += d.punches;
    } else merged.push({ ...d });
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Device export files (row 93)
// ---------------------------------------------------------------------------

/** Column map saved once per device: zero-based column numbers and the time format of the file. */
export type PunchColumnMap = {
  code: number;
  /** One column with date and time, or a date column and a time column. */
  dateTime?: number;
  date?: number;
  time?: number;
  /** `ymd` = 2026-11-03, `dmy` = 03/11/2026 or 03-11-2026. */
  dateOrder: "ymd" | "dmy";
  delimiter: "," | "\t" | ";" | "|";
  hasHeader: boolean;
};

export type ParsedPunch = { line: number; code: string; localMs: number };
export type PunchFileError = { line: number; reason: "columns" | "code" | "time" };

export const PUNCH_FILE_MAX_ROWS = 5000;

function parseDate(v: string, order: "ymd" | "dmy"): [number, number, number] | null {
  const parts = v.trim().split(/[-/.]/).map((p) => Number(p));
  if (parts.length !== 3 || parts.some((p) => !Number.isInteger(p))) return null;
  const [a, b, c] = parts as [number, number, number];
  const [y, m, d] = order === "ymd" ? [a, b, c] : [c < 100 ? 2000 + c : c, b, a];
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return [y, m, d];
}

function parseTime(v: string): [number, number, number] | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(v.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(m[3] ?? 0);
  const ap = m[4]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || min > 59 || s > 59) return null;
  return [h, min, s];
}

/** Parse a device export with its column map. Bad lines are returned, never guessed. */
export function parsePunchFile(text: string, map: PunchColumnMap): { punches: ParsedPunch[]; errors: PunchFileError[] } {
  const lines = text.split(/\r?\n/);
  const punches: ParsedPunch[] = [];
  const errors: PunchFileError[] = [];
  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    if (map.hasHeader && idx === 0) return;
    if (!raw.trim()) return;
    const cols = raw.split(map.delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));
    const code = cols[map.code];
    if (code === undefined) return errors.push({ line: lineNo, reason: "columns" });
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(code)) return errors.push({ line: lineNo, reason: "code" });
    let dateText: string | undefined;
    let timeText: string | undefined;
    if (map.dateTime !== undefined) {
      const dt = cols[map.dateTime];
      if (dt === undefined) return errors.push({ line: lineNo, reason: "columns" });
      const [d, ...rest] = dt.split(/[ T]+/);
      dateText = d;
      timeText = rest.join(" ");
    } else {
      dateText = map.date !== undefined ? cols[map.date] : undefined;
      timeText = map.time !== undefined ? cols[map.time] : undefined;
    }
    if (dateText === undefined || timeText === undefined) return errors.push({ line: lineNo, reason: "columns" });
    const date = parseDate(dateText, map.dateOrder);
    const time = parseTime(timeText);
    if (!date || !time) return errors.push({ line: lineNo, reason: "time" });
    const localMs = Date.UTC(date[0], date[1] - 1, date[2], time[0], time[1], time[2]);
    if (ymdOfLocal(localMs) !== `${date[0]}-${pad2(date[1])}-${pad2(date[2])}`) return errors.push({ line: lineNo, reason: "time" });
    punches.push({ line: lineNo, code, localMs });
  });
  return { punches, errors };
}

// ---------------------------------------------------------------------------
// Timesheet and paid days (rows 87, 88)
// ---------------------------------------------------------------------------

export type DayMark = { day: string; status: HrAttendanceStatus; overtimeMin: number; paidLeave?: boolean };

export type Timesheet = {
  days: number;
  presentHalves: number;
  absent: number;
  halfDays: number;
  leavePaid: number;
  leaveUnpaid: number;
  weeklyOff: number;
  holiday: number;
  notMarked: number;
  overtimeMin: number;
  /** Loss of pay, in halves: absent, unpaid leave, the missing half of a half day, unmarked working days, days outside service. */
  lopHalves: number;
  paidHalves: number;
};

/**
 * Month totals for one person. Days outside service (before joining, after leaving) are unpaid and not
 * counted as marked. An unmarked day on the person's weekly off or a plant holiday is paid; any other
 * unmarked day is loss of pay and counted in `notMarked` so the payroll check names it.
 */
export function timesheet(input: {
  month: string;
  marks: readonly DayMark[];
  joinedOn: string | null;
  leftOn: string | null;
  weeklyOffDow: number;
  holidays: ReadonlySet<string>;
}): Timesheet {
  const byDay = new Map(input.marks.map((m) => [m.day, m]));
  const t: Timesheet = { days: 0, presentHalves: 0, absent: 0, halfDays: 0, leavePaid: 0, leaveUnpaid: 0, weeklyOff: 0, holiday: 0, notMarked: 0, overtimeMin: 0, lopHalves: 0, paidHalves: 0 };
  for (const day of daysOfMonth(input.month)) {
    t.days += 1;
    if ((input.joinedOn && day < input.joinedOn) || (input.leftOn && day > input.leftOn)) {
      t.lopHalves += 2;
      continue;
    }
    const m = byDay.get(day);
    if (!m) {
      if (input.holidays.has(day)) t.holiday += 1;
      else if (dayOfWeek(day) === input.weeklyOffDow) t.weeklyOff += 1;
      else {
        t.notMarked += 1;
        t.lopHalves += 2;
      }
      continue;
    }
    t.overtimeMin += Math.max(0, m.overtimeMin);
    switch (m.status) {
      case "present":
        t.presentHalves += 2;
        break;
      case "half_day":
        t.halfDays += 1;
        t.presentHalves += 1;
        t.lopHalves += 1;
        break;
      case "absent":
        t.absent += 1;
        t.lopHalves += 2;
        break;
      case "leave":
        if (m.paidLeave === false) {
          t.leaveUnpaid += 1;
          t.lopHalves += 2;
        } else t.leavePaid += 1;
        break;
      case "weekly_off":
        t.weeklyOff += 1;
        break;
      case "holiday":
        t.holiday += 1;
        break;
    }
  }
  t.paidHalves = Math.max(0, t.days * 2 - t.lopHalves);
  return t;
}

// ---------------------------------------------------------------------------
// Leave (row 90)
// ---------------------------------------------------------------------------

/** Halves a leave takes: each day from..to that is not a holiday or the weekly off; a one-day half leave is 1. */
export function leaveHalves(input: { from: string; to: string; halfDay: boolean; weeklyOffDow: number; holidays: ReadonlySet<string> }): number {
  if (input.to < input.from) return 0;
  if (input.halfDay) return input.from === input.to && !input.holidays.has(input.from) && dayOfWeek(input.from) !== input.weeklyOffDow ? 1 : 0;
  let halves = 0;
  for (let d = input.from; d <= input.to; d = addDaysYmd(d, 1)) {
    if (input.holidays.has(d) || dayOfWeek(d) === input.weeklyOffDow) continue;
    halves += 2;
  }
  return halves;
}

/** Days a leave covers that are working days (the attendance rows it writes when approved). */
export function leaveWorkingDays(input: { from: string; to: string; weeklyOffDow: number; holidays: ReadonlySet<string> }): string[] {
  const out: string[] = [];
  for (let d = input.from; d <= input.to; d = addDaysYmd(d, 1)) {
    if (input.holidays.has(d) || dayOfWeek(d) === input.weeklyOffDow) continue;
    out.push(d);
  }
  return out;
}

export type LeaveKindRule = { quotaHalves: number; carryCapHalves: number };

/**
 * Balance in a leave year (calendar year). Carry into a year = what was left the year before, up to the
 * cap, starting from `fromYear` (the joining year, or the year the kind was set up) with `openingHalves`.
 */
export function leaveBalance(rule: LeaveKindRule, takenByYear: ReadonlyMap<number, number>, fromYear: number, year: number, openingHalves = 0): {
  carryInHalves: number;
  quotaHalves: number;
  takenHalves: number;
  balanceHalves: number;
} {
  let carry = Math.max(0, openingHalves);
  for (let y = fromYear; y < year; y += 1) {
    const left = carry + rule.quotaHalves - (takenByYear.get(y) ?? 0);
    carry = Math.max(0, Math.min(rule.carryCapHalves, left));
  }
  const taken = takenByYear.get(year) ?? 0;
  return { carryInHalves: year < fromYear ? 0 : carry, quotaHalves: rule.quotaHalves, takenHalves: taken, balanceHalves: (year < fromYear ? 0 : carry) + rule.quotaHalves - taken };
}

// ---------------------------------------------------------------------------
// Retirement and training (rows 86, 90)
// ---------------------------------------------------------------------------

/** The day a person born on `dob` reaches `age` years. */
export function retirementDate(dob: string, age: number): string {
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y + age, m - 1, d));
  // 29 Feb on a non-leap year becomes 28 Feb.
  if (target.getUTCMonth() !== m - 1) return ymdOfLocal(Date.UTC(y + age, m, 0));
  return ymdOfLocal(target.getTime());
}

/** Retiring on or after `today` and within `days` days. */
export function retiringWithin(dob: string | null, age: number, today: string, days: number): string | null {
  if (!dob) return null;
  const on = retirementDate(dob, age);
  return on >= today && on <= addDaysYmd(today, days) ? on : null;
}

/** When a training expires (validity in months; 0 = never). */
export function trainingExpiry(on: string, validityMonths: number): string | null {
  if (validityMonths <= 0) return null;
  const [y, m, d] = on.split("-").map(Number) as [number, number, number];
  const lastOfTarget = new Date(Date.UTC(y, m - 1 + validityMonths + 1, 0)).getUTCDate();
  return ymdOfLocal(Date.UTC(y, m - 1 + validityMonths, Math.min(d, lastOfTarget)));
}

export function trainingState(expiry: string | null, today: string, soonDays = 30): "valid" | "due_soon" | "expired" | "no_expiry" {
  if (!expiry) return "no_expiry";
  if (expiry < today) return "expired";
  if (expiry <= addDaysYmd(today, soonDays)) return "due_soon";
  return "valid";
}

/** Completed service in years and months between two dates (inclusive of the joining day). */
export function serviceLength(joinedOn: string, until: string): { years: number; months: number; days: number } {
  const [y1, m1, d1] = joinedOn.split("-").map(Number) as [number, number, number];
  const [y2, m2, d2] = until.split("-").map(Number) as [number, number, number];
  let years = y2 - y1;
  let months = m2 - m1;
  let days = d2 - d1;
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(y2, m2 - 1, 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years: Math.max(0, years), months: Math.max(0, months), days: Math.max(0, days) };
}
