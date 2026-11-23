/**
 * XE-HR screens: the pure rules behind the People pages (status words and tones, halves to days, the
 * attendance draft of one shift, the late-entry rule, week and month stepping, the HR rules and incentive
 * forms, the device column map). No view code, no tRPC calls, no clock: the pages pass today in.
 */
import { addDaysYmd, DEFAULT_HR_RULES, isMonth, isYmd, parseDecimal, weekStart, type HrAttendanceStatus, type HrRules, type PunchColumnMap } from "@orrn/domain";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

type Out = inferRouterOutputs<AppRouter>["hr"];
export type ShiftSheet = Out["attendance"]["shift"];
export type SheetRow = ShiftSheet["rows"][number];
export type PersonCard = Out["people"]["get"];

export type Tone = "green" | "blue" | "amber" | "red" | "neutral";

/** The six marks a supervisor can give, in the order of the big buttons. */
export const MARK_STATUSES: readonly HrAttendanceStatus[] = ["present", "absent", "half_day", "leave", "weekly_off", "holiday"];

export function markTone(status: HrAttendanceStatus): Tone {
  switch (status) {
    case "present":
      return "green";
    case "half_day":
    case "leave":
      return "amber";
    case "absent":
      return "red";
    default:
      return "neutral";
  }
}

/** Halves on the wire as days on screen: 3 is "1.5", 4 is "2". */
export function halvesToDays(halves: number): string {
  const whole = Math.trunc(halves / 2);
  return halves % 2 === 0 ? String(whole) : `${halves < 0 && whole === 0 ? "-" : ""}${whole}.5`;
}

/** Minutes as "1h 30m" words are spelled by the screen; this gives the parts. */
export function hoursMinutes(min: number): { h: number; m: number } {
  const safe = Math.max(0, Math.round(min));
  return { h: Math.floor(safe / 60), m: safe % 60 };
}

/** Days in a text box ("1.5", "2") to halves; null when it is not a whole or half day. */
export function daysToHalves(text: string): number | null {
  const n = parseDecimal(text);
  if (n === null || n < 0) return null;
  const halves = n * 2;
  return Number.isInteger(halves) ? halves : null;
}

/** Paid days of a month: paid halves over two. */
export function paidDaysText(paidHalves: number): string {
  return halvesToDays(paidHalves);
}

export { addDaysYmd, weekStart };

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i));
}

export function monthOf(ymd: string): string {
  return ymd.slice(0, 7);
}

/** The month `delta` months from `month` ("2026-11", -1 is "2026-10"). */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The last `count` months ending at `month`, newest first. */
export function recentMonths(month: string, count = 12): string[] {
  return Array.from({ length: count }, (_, i) => shiftMonth(month, -i));
}

/** Years to offer for the holiday list and leave balances: this year and the two before, then next year. */
export function yearChoices(today: string): number[] {
  const y = Number(today.slice(0, 4));
  return [y + 1, y, y - 1, y - 2];
}

export type DayState = "ok" | "late" | "future" | "bad";

/**
 * What marking `day` is: today and yesterday are normal, an older day is a late entry (attendance.manage),
 * a day that has not come is refused.
 */
export function dayState(day: string, today: string): DayState {
  if (!isYmd(day)) return "bad";
  if (day > today) return "future";
  return day < addDaysYmd(today, -1) ? "late" : "ok";
}

/** Whether this person may save a shift on `day` (the server decides again). */
export function canSaveDay(state: DayState, canManage: boolean): boolean {
  if (state === "bad" || state === "future") return false;
  return state === "ok" || canManage;
}

/** What is typed for one person before Save. `status: null` means untouched: nothing is sent for them. */
export type MarkDraft = { status: HrAttendanceStatus | null; inTime: string; outTime: string };
export type Drafts = Record<string, MarkDraft>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isHhmm = (v: string): boolean => HHMM.test(v);

/** Start the draft from what is already marked; `timeOf` turns a stored instant into the plant's HH:MM. */
export function draftsFromRows(rows: readonly SheetRow[], timeOf: (at: Date | string | null | undefined) => string): Drafts {
  const out: Drafts = {};
  for (const r of rows) {
    out[r.employeeId] = r.mark
      ? { status: r.mark.status, inTime: timeOf(r.mark.inAt), outTime: timeOf(r.mark.outAt) }
      : { status: r.rosteredOff ? "weekly_off" : null, inTime: "", outTime: "" };
  }
  return out;
}

/** "Mark all present": everyone not yet marked becomes present; a mark already given stays. */
export function markAllPresent(rows: readonly SheetRow[], drafts: Drafts): Drafts {
  const next: Drafts = { ...drafts };
  for (const r of rows) {
    const d = next[r.employeeId] ?? { status: null, inTime: "", outTime: "" };
    if (d.status === null) next[r.employeeId] = { ...d, status: "present" };
  }
  return next;
}

/** Give one person a status; times stay only where a worked status can use them. */
export function setStatus(drafts: Drafts, id: string, status: HrAttendanceStatus): Drafts {
  const d = drafts[id] ?? { status: null, inTime: "", outTime: "" };
  const worked = status === "present" || status === "half_day";
  return { ...drafts, [id]: { status, inTime: worked ? d.inTime : "", outTime: worked ? d.outTime : "" } };
}

export type MarkRow = { employeeId: string; status: HrAttendanceStatus; inTime: string | null; outTime: string | null };

/** The rows for `hr.attendance.markShift`: only people with a status; blank times go as null. */
export function markPayload(rows: readonly SheetRow[], drafts: Drafts): MarkRow[] {
  const out: MarkRow[] = [];
  for (const r of rows) {
    const d = drafts[r.employeeId];
    if (!d || d.status === null) continue;
    const worked = d.status === "present" || d.status === "half_day";
    out.push({ employeeId: r.employeeId, status: d.status, inTime: worked && d.inTime ? d.inTime : null, outTime: worked && d.outTime ? d.outTime : null });
  }
  return out;
}

/** People whose typed times are not HH:MM (the Save button says who). */
export function badTimes(rows: readonly SheetRow[], drafts: Drafts): string[] {
  return rows.filter((r) => {
    const d = drafts[r.employeeId];
    return d && ((d.inTime && !isHhmm(d.inTime)) || (d.outTime && !isHhmm(d.outTime)));
  }).map((r) => r.employeeId);
}

export type MarkCounts = Record<HrAttendanceStatus, number> & { unmarked: number };

export function markCounts(rows: readonly SheetRow[], drafts: Drafts): MarkCounts {
  const c: MarkCounts = { present: 0, absent: 0, half_day: 0, leave: 0, weekly_off: 0, holiday: 0, unmarked: 0 };
  for (const r of rows) {
    const s = drafts[r.employeeId]?.status ?? null;
    if (s === null) c.unmarked += 1;
    else c[s] += 1;
  }
  return c;
}

/** Whether the draft differs from what the server holds (the page warns before leaving unsaved). */
export function draftChanged(rows: readonly SheetRow[], drafts: Drafts, timeOf: (at: Date | string | null | undefined) => string): boolean {
  const base = draftsFromRows(rows, timeOf);
  return rows.some((r) => {
    const a = base[r.employeeId];
    const b = drafts[r.employeeId];
    return !!a && !!b && (a.status !== b.status || a.inTime !== b.inTime || a.outTime !== b.outTime);
  });
}

/** The roster cell to show: a stored cell wins; no cell means the person's own shift. `null` is the weekly off. */
export type RosterCell = { employeeId: string; day: string; shiftId: string | null };
export function cellFor(cells: readonly RosterCell[], employeeId: string, day: string): { set: boolean; shiftId: string | null } {
  const c = cells.find((x) => x.employeeId === employeeId && x.day === day);
  return c ? { set: true, shiftId: c.shiftId } : { set: false, shiftId: null };
}

/** Value of the roster picker: a shift id, "off", or "default". */
export function cellValue(cell: { set: boolean; shiftId: string | null }): string {
  return !cell.set ? "default" : cell.shiftId === null ? "off" : cell.shiftId;
}
export function cellInput(value: string): string | null {
  return value === "off" ? null : value;
}

/** Pass a person to the next page by what they are searching: the code, upper-cased, or the name. */
export function matchesPerson(p: { code: string; name: string }, q: string): boolean {
  const needle = q.trim().toLowerCase();
  return needle === "" || p.name.toLowerCase().includes(needle) || p.code.toLowerCase().includes(needle);
}

// ---------------------------------------------------------------------------------------------------------------
// The person form
// ---------------------------------------------------------------------------------------------------------------

export type PersonForm = {
  code: string;
  name: string;
  departmentId: string;
  designationId: string;
  joinedOn: string;
  dob: string;
  kind: "permanent" | "contract" | "apprentice" | "casual";
  contractorName: string;
  phone: string;
  deviceCode: string;
  shiftId: string;
  weeklyOffDow: string;
  bankName: string;
  bankAccountNo: string;
  bankIfsc: string;
  pan: string;
  aadhaar: string;
  uan: string;
  esicIp: string;
};

export function emptyPerson(today: string): PersonForm {
  return {
    code: "", name: "", departmentId: "", designationId: "", joinedOn: today, dob: "", kind: "permanent", contractorName: "", phone: "", deviceCode: "", shiftId: "",
    weeklyOffDow: "", bankName: "", bankAccountNo: "", bankIfsc: "", pan: "", aadhaar: "", uan: "", esicIp: "",
  };
}

/** The form of a stored person. The bank account, PAN and Aadhaar boxes start empty: leaving them empty keeps what is stored. */
export function formFromPerson(p: PersonCard): PersonForm {
  return {
    code: p.code, name: p.name, departmentId: p.departmentId ?? "", designationId: p.designationId ?? "", joinedOn: p.joinedOn, dob: p.dob ?? "", kind: p.kind,
    contractorName: p.contractorName ?? "", phone: p.phone ?? "", deviceCode: p.deviceCode ?? "", shiftId: p.shiftId ?? "", weeklyOffDow: p.weeklyOffDow === null ? "" : String(p.weeklyOffDow),
    bankName: p.bankName ?? "", bankAccountNo: "", bankIfsc: p.bankIfsc ?? "", pan: "", aadhaar: "", uan: p.uan ?? "", esicIp: p.esicIp ?? "",
  };
}

export type PersonProblem = "code" | "name" | "joinedOn" | "dob" | "phone" | "account" | "ifsc" | "uan" | "esic" | "contractor";

/** What is wrong in the form, before the server says it. */
export function personProblems(f: PersonForm): PersonProblem[] {
  const out: PersonProblem[] = [];
  if (!f.code.trim()) out.push("code");
  if (!f.name.trim()) out.push("name");
  if (!isYmd(f.joinedOn)) out.push("joinedOn");
  if (f.dob && (!isYmd(f.dob) || f.dob >= f.joinedOn)) out.push("dob");
  if (f.phone && !/^[0-9+ -]*$/.test(f.phone)) out.push("phone");
  if (f.bankAccountNo && !/^[0-9 ]*$/.test(f.bankAccountNo)) out.push("account");
  if (f.bankIfsc && !/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(f.bankIfsc.trim())) out.push("ifsc");
  if (f.uan && !/^[0-9]{12}$/.test(f.uan)) out.push("uan");
  if (f.esicIp && !/^[0-9]{10}$/.test(f.esicIp)) out.push("esic");
  if (f.kind === "contract" && !f.contractorName.trim()) out.push("contractor");
  return out;
}

const orNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());

/**
 * The `hr.people.create` / `update` input. Bank account, PAN and Aadhaar are left out (undefined) when the box is
 * empty, so the stored number stays; typing a number replaces it.
 */
export function personInput(f: PersonForm) {
  return {
    code: f.code.trim(),
    name: f.name.trim(),
    departmentId: orNull(f.departmentId),
    designationId: orNull(f.designationId),
    joinedOn: f.joinedOn,
    dob: orNull(f.dob),
    kind: f.kind,
    contractorName: f.kind === "contract" ? orNull(f.contractorName) : null,
    phone: orNull(f.phone),
    deviceCode: orNull(f.deviceCode),
    shiftId: orNull(f.shiftId),
    weeklyOffDow: f.weeklyOffDow === "" ? null : Number(f.weeklyOffDow),
    bankName: orNull(f.bankName),
    bankIfsc: orNull(f.bankIfsc),
    uan: orNull(f.uan),
    esicIp: orNull(f.esicIp),
    ...(f.bankAccountNo.trim() ? { bankAccountNo: f.bankAccountNo.trim() } : {}),
    ...(f.pan.trim() ? { pan: f.pan.trim() } : {}),
    ...(f.aadhaar.trim() ? { aadhaar: f.aadhaar.trim() } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// HR rules and the incentive rule
// ---------------------------------------------------------------------------------------------------------------

export type RulesForm = {
  retirementAge: string;
  weeklyOffDow: string;
  overtimeMinMinutes: string;
  overtimeStepMinutes: string;
  /** "2" is double pay; "1.5" is one and a half. */
  overtimeRate: string;
  overtimeBase: "basic_da" | "gross";
  hoursPerDay: string;
  monthDaysBasis: "calendar" | "26" | "30";
  /** Percent: "8.33". */
  bonusPercent: string;
  encashDivisor: string;
};

const trimNum = (n: number) => String(Number(n.toFixed(2)));

export function formFromRules(r: HrRules): RulesForm {
  return {
    retirementAge: String(r.retirementAge),
    weeklyOffDow: String(r.weeklyOffDow),
    overtimeMinMinutes: String(r.overtimeMinMinutes),
    overtimeStepMinutes: String(r.overtimeStepMinutes),
    overtimeRate: trimNum(r.overtimeRateX100 / 100),
    overtimeBase: r.overtimeBase,
    hoursPerDay: String(r.hoursPerDay),
    monthDaysBasis: r.monthDaysBasis === "calendar" ? "calendar" : (String(r.monthDaysBasis) as "26" | "30"),
    bonusPercent: trimNum(r.bonusBp / 100),
    encashDivisor: String(r.encashDivisor),
  };
}

export type RulesProblem = keyof RulesForm;

const intIn = (text: string, lo: number, hi: number): number | null => {
  const n = parseDecimal(text);
  return n !== null && Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

/** The wire value of the rules form, or the boxes that are wrong. Limits mirror `hr.settings.save`. */
export function rulesFromForm(f: RulesForm): { ok: true; value: HrRules } | { ok: false; problems: RulesProblem[] } {
  const problems: RulesProblem[] = [];
  const retirementAge = intIn(f.retirementAge, 45, 75);
  const weeklyOffDow = intIn(f.weeklyOffDow, 0, 6);
  const overtimeMinMinutes = intIn(f.overtimeMinMinutes, 0, 240);
  const overtimeStepMinutes = intIn(f.overtimeStepMinutes, 1, 120);
  const rate = parseDecimal(f.overtimeRate);
  const overtimeRateX100 = rate === null ? null : Math.round(rate * 100);
  const hoursPerDay = intIn(f.hoursPerDay, 4, 12);
  const bonus = parseDecimal(f.bonusPercent);
  const bonusBp = bonus === null ? null : Math.round(bonus * 100);
  const encashDivisor = intIn(f.encashDivisor, 20, 31);
  if (retirementAge === null) problems.push("retirementAge");
  if (weeklyOffDow === null) problems.push("weeklyOffDow");
  if (overtimeMinMinutes === null) problems.push("overtimeMinMinutes");
  if (overtimeStepMinutes === null) problems.push("overtimeStepMinutes");
  if (overtimeRateX100 === null || overtimeRateX100 < 100 || overtimeRateX100 > 400) problems.push("overtimeRate");
  if (hoursPerDay === null) problems.push("hoursPerDay");
  if (bonusBp === null || bonusBp < 0 || bonusBp > 2000) problems.push("bonusPercent");
  if (encashDivisor === null) problems.push("encashDivisor");
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    value: {
      retirementAge: retirementAge!, weeklyOffDow: weeklyOffDow!, overtimeMinMinutes: overtimeMinMinutes!, overtimeStepMinutes: overtimeStepMinutes!,
      overtimeRateX100: overtimeRateX100!, overtimeBase: f.overtimeBase, hoursPerDay: hoursPerDay!,
      monthDaysBasis: f.monthDaysBasis === "calendar" ? "calendar" : (Number(f.monthDaysBasis) as 26 | 30), bonusBp: bonusBp!, encashDivisor: encashDivisor!,
    },
  };
}

export { DEFAULT_HR_RULES };

/** Basis points as a percent text: 8000 is "80", 833 is "8.33". */
export function bpText(bp: number): string {
  return trimNum(bp / 100);
}

/** A percent typed ("80") to basis points; null when not a number from 0 to 100. */
export function percentToBp(text: string): number | null {
  const n = parseDecimal(text);
  if (n === null || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

/** The month rows of a dated setting, newest first, as the server returns them. */
export function nextEffectiveMonth(today: string, lockedThrough: string | null): string {
  const m = monthOf(today);
  return lockedThrough && m <= lockedThrough ? shiftMonth(lockedThrough, 1) : m;
}

// ---------------------------------------------------------------------------------------------------------------
// Devices and punches
// ---------------------------------------------------------------------------------------------------------------

export type MapForm = {
  code: string;
  mode: "one" | "two";
  dateTime: string;
  date: string;
  time: string;
  dateOrder: "ymd" | "dmy";
  delimiter: "," | "\t" | ";" | "|";
  hasHeader: boolean;
};

/** Columns are counted from 1 on screen and from 0 on the wire. */
export function emptyMap(): MapForm {
  return { code: "1", mode: "one", dateTime: "2", date: "2", time: "3", dateOrder: "ymd", delimiter: ",", hasHeader: true };
}

export function formFromMap(m: PunchColumnMap | null): MapForm {
  if (!m) return emptyMap();
  const one = m.dateTime !== undefined;
  return {
    code: String(m.code + 1),
    mode: one ? "one" : "two",
    dateTime: String((m.dateTime ?? 1) + 1),
    date: String((m.date ?? 1) + 1),
    time: String((m.time ?? 2) + 1),
    dateOrder: m.dateOrder,
    delimiter: m.delimiter,
    hasHeader: m.hasHeader,
  };
}

const col = (text: string): number | null => {
  const n = parseDecimal(text);
  return n !== null && Number.isInteger(n) && n >= 1 && n <= 51 ? n - 1 : null;
};

export type MapProblem = "code" | "dateTime" | "date" | "time";

export function mapFromForm(f: MapForm): { ok: true; value: PunchColumnMap } | { ok: false; problems: MapProblem[] } {
  const problems: MapProblem[] = [];
  const code = col(f.code);
  if (code === null) problems.push("code");
  const base = { dateOrder: f.dateOrder, delimiter: f.delimiter, hasHeader: f.hasHeader };
  if (f.mode === "one") {
    const dt = col(f.dateTime);
    if (dt === null) problems.push("dateTime");
    if (problems.length) return { ok: false, problems };
    return { ok: true, value: { code: code!, dateTime: dt!, ...base } };
  }
  const d = col(f.date);
  const tm = col(f.time);
  if (d === null) problems.push("date");
  if (tm === null) problems.push("time");
  if (problems.length) return { ok: false, problems };
  return { ok: true, value: { code: code!, date: d!, time: tm!, ...base } };
}

/** The first non-blank lines of a pasted file, for the "this is what I read" echo. */
export function fileHead(text: string, lines = 3): string[] {
  return text.split(/\r?\n/).filter((l) => l.trim() !== "").slice(0, lines);
}

/** The delimiter that a file's first line uses most, for the form's first guess. */
export function guessDelimiter(text: string): "," | "\t" | ";" | "|" {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  let best: "," | "\t" | ";" | "|" = ",";
  let n = 0;
  for (const d of [",", "\t", ";", "|"] as const) {
    const count = first.split(d).length - 1;
    if (count > n) {
      n = count;
      best = d;
    }
  }
  return best;
}

export const MAX_PUNCH_TEXT = 600_000;

// ---------------------------------------------------------------------------------------------------------------
// Incentive
// ---------------------------------------------------------------------------------------------------------------

export function recoveryText(bp: number | null): string {
  return bp === null ? "-" : `${bpText(bp)}%`;
}

export function validMonth(v: string): boolean {
  return isMonth(v);
}
