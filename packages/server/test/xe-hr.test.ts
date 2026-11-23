/**
 * XE parity lane HR (rows 86, 87, 89, 90, 93): people, checklists, attendance, roster, punches (file and
 * device push), leave with approval, self-service, incentive. Every procedure family: tenancy (another
 * plant gets Not found), the permission refusal, the module gate, and the happy path.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { approval, auditLog, hrAttendance, hrRoster, pressRun } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;
let setClock: typeof import("../src/lib/clock").setClockForTests;
beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
}, 60_000);
afterEach(() => setClock(null));
afterAll(async () => {
  await env.dispose();
});

const SHIFTS = [
  { id: "day", name: "Day", seq: 1, startMin: 480, endMin: 1200 },
  { id: "night", name: "Night", seq: 2, startMin: 1200, endMin: 480 },
];
// 20 Nov 2026, 12:00 in Kolkata.
const NOW = new Date("2026-11-20T06:30:00Z");

async function plant(modules: string[] = ["hr", "payroll"]) {
  const { companyId, users } = await env.seedCompany({ modules, settings: { shifts: SHIFTS } });
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  return { companyId, users, as, manager: as("manager") };
}
type Plant = Awaited<ReturnType<typeof plant>>;

const person = (over: Record<string, unknown> = {}) => ({ code: "E001", name: "Ramesh Patel", joinedOn: "2020-01-06", dob: "1980-05-10", kind: "permanent" as const, shiftId: "day", ...over });
const audits = (companyId: string, action: string) => env.db.select().from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, action)));

describe("module gate (both opt-in; payroll needs hr)", () => {
  test("hr off: reads and writes refused; payroll on with hr off names hr", async () => {
    setClock(NOW);
    const off = await plant([]);
    await expect(off.manager.hr.people.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(off.manager.hr.people.create(person())).rejects.toMatchObject({ code: "FORBIDDEN" });
    const payOnly = await plant(["payroll"]);
    await expect(payOnly.manager.payroll.runs.list()).rejects.toMatchObject({ code: "FORBIDDEN", message: "Payroll needs the HR module on for this plant" });
    const hrOnly = await plant(["hr"]);
    expect((await hrOnly.manager.hr.people.list()).items).toEqual([]);
    await expect(hrOnly.manager.payroll.runs.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("hr.people (row 86)", () => {
  test("add, list masked, edit audited without values, leave closes the roster", async () => {
    setClock(NOW);
    const p = await plant();
    const { id } = await p.manager.hr.people.create(person({ bankName: "SBI", bankAccountNo: "3012 3456 789", bankIfsc: "sbin0001234", pan: "ABCDE1234F", aadhaar: "1234 5678 9012", uan: "100200300400", esicIp: "3112345678" }));
    const list = await p.as("office").hr.people.list();
    expect(list.items[0]).toMatchObject({ id, code: "E001", bankAccountMasked: "XXXXXXX6789", panLast4: "234F", aadhaarLast4: "9012" });
    expect(JSON.stringify(list)).not.toContain("30123456789");
    await p.manager.hr.people.update({ id, ...person({ bankAccountNo: "999988887777", name: "Ramesh K Patel" }) });
    const [a] = await audits(p.companyId, "hr.person.update");
    expect(JSON.stringify(a!.meta)).not.toContain("999988887777");
    expect((a!.meta as { changed: string[] }).changed).toContain("bankAccountNo");
    await expect(p.manager.hr.people.create(person({ name: "Other" }))).rejects.toMatchObject({ code: "CONFLICT" });
    await env.db.insert(hrRoster).values({ id: crypto.randomUUID(), companyId: p.companyId, employeeId: id, day: "2026-11-25", shiftId: "day" });
    await p.manager.hr.people.leave({ id, leftOn: "2026-11-21", reason: "Moved to another city" });
    expect(await env.db.select().from(hrRoster).where(eq(hrRoster.employeeId, id))).toEqual([]);
    expect((await p.manager.hr.people.retiring({ days: 90 })).items).toEqual([]);
  });

  test("permission: office and the floor cannot add; viewers cannot read", async () => {
    const p = await plant();
    for (const role of ["office", "supervisor", "packer"] as CompanyRole[]) await expect(p.as(role).hr.people.create(person({ code: `X${role.slice(0, 3)}` }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("viewer").hr.people.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("tenancy: another plant's person is Not found", async () => {
    const a = await plant();
    const b = await plant();
    const { id } = await a.manager.hr.people.create(person());
    await expect(b.manager.hr.people.get({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.manager.hr.people.update({ id, ...person() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await b.manager.hr.people.list()).items).toEqual([]);
  });

  test("checklists, recruitment and retirement", async () => {
    setClock(NOW);
    const p = await plant();
    const { id } = await p.manager.hr.people.create(person({ dob: "1968-12-15" }));
    const item = await p.manager.hr.checklists.saveItem({ kind: "joining", label: "Safety shoes given" });
    await p.manager.hr.checklists.tick({ employeeId: id, itemId: item.id, done: true });
    expect(await p.manager.hr.checklists.forPerson({ employeeId: id, kind: "joining" })).toMatchObject([{ label: "Safety shoes given", done: true }]);
    const o = await p.manager.hr.recruitment.saveOpening({ title: "Press helper", positions: 2 });
    await p.manager.hr.recruitment.saveCandidate({ openingId: o.id, name: "Suresh", stage: "interviewed" });
    expect((await p.manager.hr.recruitment.openings())[0]).toMatchObject({ title: "Press helper", candidates: 1 });
    expect((await p.manager.hr.people.retiring({ days: 90 })).items).toMatchObject([{ id, retiresOn: "2026-12-15" }]);
  });
});

async function twoPeople(p: Plant) {
  const a = await p.manager.hr.people.create(person({ deviceCode: "101" }));
  const b = await p.manager.hr.people.create(person({ code: "E002", name: "Asha Ben", shiftId: "night", deviceCode: "102" }));
  return { a: a.id, b: b.id };
}

describe("hr.attendance (row 87)", () => {
  test("a supervisor marks a shift; overtime comes from the shift; a night out after midnight", async () => {
    setClock(NOW);
    const p = await plant();
    const { a, b } = await twoPeople(p);
    const day = await p.as("supervisor").hr.attendance.shift({ day: "2026-11-20", shiftId: "day" });
    expect(day.rows.map((r) => r.employeeId)).toEqual([a]);
    const res = await p.as("supervisor").hr.attendance.markShift({ day: "2026-11-19", shiftId: "night", rows: [{ employeeId: b, status: "present", inTime: "19:55", outTime: "09:10" }] });
    expect(res).toMatchObject({ marked: 1, lateEntry: false });
    const [row] = await env.db.select().from(hrAttendance).where(eq(hrAttendance.employeeId, b));
    expect(row).toMatchObject({ day: "2026-11-19", workedMin: 795, overtimeMin: 60, source: "manual", lateEntry: false });
    await expect(p.as("supervisor").hr.attendance.markShift({ day: "2026-11-21", shiftId: "day", rows: [{ employeeId: a, status: "present" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("older than yesterday: supervisor refused, manager writes a late entry with the true time", async () => {
    setClock(NOW);
    const p = await plant();
    const { a } = await twoPeople(p);
    await expect(p.as("supervisor").hr.attendance.markShift({ day: "2026-11-16", shiftId: "day", rows: [{ employeeId: a, status: "absent" }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await p.manager.hr.attendance.markShift({ day: "2026-11-16", shiftId: "day", rows: [{ employeeId: a, status: "absent" }] })).toMatchObject({ lateEntry: true });
    expect((await audits(p.companyId, "hr.attendance.late")).length).toBe(1);
    const sheet = await p.manager.hr.attendance.timesheet({ employeeId: a, month: "2026-11" });
    expect(sheet.totals.absent).toBe(1);
  });

  test("permission and tenancy", async () => {
    setClock(NOW);
    const p = await plant();
    const q = await plant();
    const { a } = await twoPeople(p);
    await expect(p.as("packer").hr.attendance.markShift({ day: "2026-11-20", shiftId: "day", rows: [{ employeeId: a, status: "present" }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(q.as("supervisor").hr.attendance.markShift({ day: "2026-11-20", shiftId: "day", rows: [{ employeeId: a, status: "present" }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(q.manager.hr.attendance.timesheet({ employeeId: a, month: "2026-11" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("roster: a cell, then copy last week", async () => {
    setClock(NOW);
    const p = await plant();
    const { a } = await twoPeople(p);
    await p.as("supervisor").hr.roster.set({ employeeId: a, day: "2026-11-10", shiftId: "night" });
    await p.as("supervisor").hr.roster.set({ employeeId: a, day: "2026-11-15", shiftId: null });
    const res = await p.as("supervisor").hr.roster.copyLastWeek({ weekStart: "2026-11-17" });
    expect(res.cells).toBe(2);
    const week = await p.manager.hr.roster.week({ weekStart: "2026-11-18" });
    expect(week.weekStart).toBe("2026-11-16");
    expect(week.cells.map((c) => [c.day, c.shiftId]).sort()).toEqual([["2026-11-17", "night"], ["2026-11-22", null]]);
    await expect(p.as("packer").hr.roster.set({ employeeId: a, day: "2026-11-10", shiftId: "day" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("biometric punches (row 93)", () => {
  const map = { code: 0, dateTime: 1, dateOrder: "ymd" as const, delimiter: "," as const, hasHeader: true };
  const file = "Code,Time\n101,2026-11-18 07:52:00\n101,2026-11-18 20:40:00\n102,2026-11-18 19:58:00\n102,2026-11-19 08:05:00\n999,2026-11-18 08:00:00\nbad line";

  test("file: preview, import, duplicates ignored, a hand-marked day kept", async () => {
    setClock(NOW);
    const p = await plant();
    const { a, b } = await twoPeople(p);
    const dev = await p.manager.hr.devices.save({ name: "Gate", make: "Unknown", columnMap: map });
    const pre = await p.manager.hr.punches.preview({ deviceId: dev.id, text: file });
    expect(pre).toMatchObject({ total: 5, errorCount: 1, unknownCodes: ["999"] });
    await p.manager.hr.attendance.markShift({ day: "2026-11-18", shiftId: "day", rows: [{ employeeId: a, status: "absent" }] });
    const res = await p.manager.hr.punches.commit({ deviceId: dev.id, text: file });
    expect(res).toMatchObject({ inserted: 5, duplicates: 0, unknownCodes: ["999"] });
    const rows = await env.db.select().from(hrAttendance).where(eq(hrAttendance.companyId, p.companyId));
    expect(rows.find((r) => r.employeeId === a)).toMatchObject({ status: "absent", source: "manual" });
    expect(rows.find((r) => r.employeeId === b)).toMatchObject({ day: "2026-11-18", shiftId: "night", source: "punch", workedMin: 727, status: "present" });
    expect((await p.manager.hr.punches.commit({ deviceId: dev.id, text: file })).inserted).toBe(0);
    await expect(p.as("supervisor").hr.punches.commit({ deviceId: dev.id, text: file })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const q = await plant();
    await expect(q.manager.hr.punches.preview({ deviceId: dev.id, text: file })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("device push: the token names the plant; a wrong token is refused", async () => {
    setClock(NOW);
    const p = await plant();
    const { b } = await twoPeople(p);
    const dev = await p.manager.hr.devices.save({ name: "Gate push" });
    const { token } = await p.manager.hr.devices.newToken({ id: dev.id });
    const { handleHrPunchPush } = await import("../src/lib/hr/punches");
    const body = JSON.stringify({ punches: [{ code: "102", at: "2026-11-18T19:58:00+05:30" }, { code: "102", at: "2026-11-19T08:05:00+05:30" }] });
    expect((await handleHrPunchPush(env.db, { authorization: "Bearer hrd_wrongwrongwrongwrong", rawBody: body })).status).toBe(401);
    const ok = await handleHrPunchPush(env.db, { authorization: `Bearer ${token}`, rawBody: body });
    expect(ok).toMatchObject({ status: 200, body: { inserted: 2 } });
    expect((await env.db.select().from(hrAttendance).where(eq(hrAttendance.employeeId, b)))[0]).toMatchObject({ day: "2026-11-18", source: "punch" });
    expect((await handleHrPunchPush(env.db, { authorization: `Bearer ${token}`, rawBody: body })).body).toMatchObject({ inserted: 0, duplicates: 2 });
    expect((await handleHrPunchPush(env.db, { authorization: `Bearer ${token}`, rawBody: '{"punches":[{"code":"102","at":"2026-11-18 19:58"}]}' })).status).toBe(400);
  });
});

async function linkedPacker(p: Plant) {
  const { id } = await p.manager.hr.people.create(person({ code: "E010", name: "Packer Bhai", userId: p.users.packer.id, joinedOn: "2025-01-01" }));
  const cl = await p.manager.hr.leave.saveKind({ code: "CL", name: "Casual leave", paid: true, quotaHalves: 8, carryCapHalves: 0 });
  return { id, kindId: cl.id };
}

describe("leave and self-service (row 90)", () => {
  test("apply for myself, a supervisor approves, attendance gets the leave days", async () => {
    setClock(NOW);
    const p = await plant();
    const me = await linkedPacker(p);
    await p.manager.hr.holidays.save({ day: "2026-11-24", name: "Plant holiday" });
    const res = await p.as("packer").hr.me.applyLeave({ kindId: me.kindId, from: "2026-11-23", to: "2026-11-25" });
    expect(res.halves).toBe(4);
    await expect(p.as("packer").approval.decide({ id: res.approvalId, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("supervisor").approval.decide({ id: res.approvalId, decision: "approved" });
    const rows = await env.db.select().from(hrAttendance).where(eq(hrAttendance.employeeId, me.id));
    expect(rows.map((r) => [r.day, r.status, r.source, r.paidLeave]).sort()).toEqual([["2026-11-23", "leave", "leave", true], ["2026-11-25", "leave", "leave", true]]);
    const summary = await p.as("packer").hr.me.summary();
    expect(summary.balances[0]).toMatchObject({ code: "CL", takenHalves: 4, balanceHalves: 4 });
    await expect(p.as("packer").hr.me.applyLeave({ kindId: me.kindId, from: "2026-11-26", to: "2026-11-30" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.as("packer").hr.me.applyLeave({ kindId: me.kindId, from: "2026-11-25", to: "2026-11-25" })).rejects.toMatchObject({ code: "CONFLICT" });
    // Cancelling the approved leave (supervisor) takes its days out.
    await p.as("supervisor").hr.leave.cancel({ id: res.id });
    expect(await env.db.select().from(hrAttendance).where(eq(hrAttendance.employeeId, me.id))).toEqual([]);
  });

  test("approval meta carries no money; a rejected leave writes nothing; a waiting leave cancels and withdraws", async () => {
    setClock(NOW);
    const p = await plant();
    const me = await linkedPacker(p);
    const r1 = await p.as("packer").hr.me.applyLeave({ kindId: me.kindId, from: "2026-11-23", to: "2026-11-23" });
    const [ap] = await env.db.select().from(approval).where(eq(approval.id, r1.approvalId));
    expect(ap!.meta).toMatchObject({ code: "E010", leaveKind: "CL", halves: 2 });
    await p.manager.approval.decide({ id: r1.approvalId, decision: "rejected" });
    expect(await env.db.select().from(hrAttendance).where(eq(hrAttendance.employeeId, me.id))).toEqual([]);
    const r2 = await p.as("packer").hr.me.applyLeave({ kindId: me.kindId, from: "2026-11-27", to: "2026-11-27", halfDay: true });
    await p.as("packer").hr.me.cancelLeave({ id: r2.id });
    const [ap2] = await env.db.select().from(approval).where(eq(approval.id, r2.approvalId));
    expect(ap2).toMatchObject({ status: "rejected" });
  });

  test("self-service sees only the person's own data; an unlinked person is told to ask the office", async () => {
    setClock(NOW);
    const p = await plant();
    await linkedPacker(p);
    const other = await p.manager.hr.people.create(person({ code: "E011" }));
    await expect(p.as("operator").hr.me.summary()).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.as("packer").hr.attendance.timesheet({ employeeId: other.id, month: "2026-11" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("packer").hr.people.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await p.as("packer").hr.me.attendance({ month: "2026-11" })).person.code).toBe("E010");
    const q = await plant();
    await expect(q.as("packer").hr.me.summary()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("apply for a floor worker who never signs in, then decide; tenancy on cancel", async () => {
    setClock(NOW);
    const p = await plant();
    const { a } = await twoPeople(p);
    const cl = await p.manager.hr.leave.saveKind({ code: "SL", name: "Sick leave", paid: false, quotaHalves: 0, carryCapHalves: 0 });
    const r = await p.as("supervisor").hr.leave.applyFor({ employeeId: a, kindId: cl.id, from: "2026-11-23", to: "2026-11-23" });
    await expect(p.as("supervisor").approval.decide({ id: r.approvalId, decision: "approved" })).rejects.toThrow("Someone else has to approve your request");
    await p.manager.approval.decide({ id: r.approvalId, decision: "approved" });
    expect((await env.db.select().from(hrAttendance).where(eq(hrAttendance.employeeId, a)))[0]).toMatchObject({ status: "leave", paidLeave: false });
    const q = await plant();
    await expect(q.as("supervisor").hr.leave.cancel({ id: r.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.as("packer").hr.leave.applyFor({ employeeId: a, kindId: cl.id, from: "2026-11-26", to: "2026-11-26" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("training and reviews (rows 89, 90)", () => {
  test("a crane course with 12 months validity shows who is due", async () => {
    setClock(NOW);
    const p = await plant();
    const { a, b } = await twoPeople(p);
    await p.manager.hr.training.save({ course: "Crane", day: "2025-12-01", trainer: "Safety officer", validityMonths: 12, employeeIds: [a, b] });
    const due = await p.manager.hr.training.due();
    expect(due.map((d) => [d.code, d.state])).toEqual([["E001", "due_soon"], ["E002", "due_soon"]]);
    await p.manager.hr.reviews.add({ employeeId: a, period: "2026 H1", rating: 4, remarks: "Steady on the press" });
    expect((await p.as("office").hr.reviews.list({ employeeId: a }))[0]).toMatchObject({ rating: 4 });
    await expect(p.as("office").hr.reviews.add({ employeeId: a, period: "x", rating: 3 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("incentive (row 89)", () => {
  test("from logged press runs: per operator x day x shift, by the dated rule", async () => {
    setClock(NOW);
    const p = await plant();
    const dieId = await env.seedDie(p.companyId);
    const { id } = await p.manager.hr.people.create(person({ code: "OP1", name: "Operator One", userId: p.users.press.id }));
    const run = (n: number, goodG: number, inputG: number, rejectG: number, status: "logged" | "voided" = "logged") => ({
      id: crypto.randomUUID(),
      companyId: p.companyId,
      number: `R${n}`,
      period: "2026-27",
      status,
      sectionId: dieId,
      operatorId: p.users.press.id,
      productionDay: "2026-11-18",
      shiftId: "day",
      goodG,
      inputG,
      rejectG,
    });
    await env.db.insert(pressRun).values([run(1, 800_000, 1_000_000, 10_000), run(2, 600_000, 800_000, 10_000), run(3, 900_000, 900_000, 0, "voided")]);
    await p.manager.hr.settings.save({ kind: "incentive", effectiveFrom: "2026-04", value: { targetG: 1_000_000, ratePaisePerKg: 50, recoveryFloorBp: 7000, rejectPenaltyPaisePerKg: 100 } });
    const sheet = await p.manager.hr.incentive.sheet({ month: "2026-11" });
    expect(sheet.rows).toMatchObject([{ employeeId: id, day: "2026-11-18", shift: "Day", runs: 2, goodG: 1_400_000, inputG: 1_800_000, rejectG: 20_000, recoveryBp: 7778, paise: 180_00 }]);
    expect(sheet.byPerson).toEqual([{ employeeId: id, code: "OP1", name: "Operator One", paise: 180_00, goodG: 1_400_000 }]);
    expect((await p.manager.hr.incentive.csv({ month: "2026-11" })).csv.split("\n")[1]).toBe("OP1,Operator One,2026-11-18,Day,1400.000,1800.000,20.000,77.78,180.00");
    await expect(p.as("packer").hr.incentive.sheet({ month: "2026-11" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const q = await plant();
    expect((await q.manager.hr.incentive.sheet({ month: "2026-11" })).rows).toEqual([]);
  });
});
