/**
 * XE parity lane HR, row 88: payroll. Structure, draft run from attendance, check (approval opened),
 * approve through approval.decide, lock; locked-month refusals; bank, ECR and ESIC files; full and final;
 * self-service payslips; tenancy, permission and the hr-off refusal.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { approval, auditLog, hrAttendance } from "@orrn/db/schema";
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

const SHIFTS = [{ id: "day", name: "Day", seq: 1, startMin: 480, endMin: 1200 }];
const NOW = new Date("2026-11-20T06:30:00Z");

async function plant(modules: string[] = ["hr", "payroll"]) {
  const { companyId, users } = await env.seedCompany({ modules, settings: { shifts: SHIFTS } });
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  return { companyId, users, as, manager: as("manager"), office: as("office") };
}
type Plant = Awaited<ReturnType<typeof plant>>;

/** One person on 12,000 basic + 3,000 HRA, present every working day of October 2026 (Sundays off). */
async function octoberPerson(p: Plant) {
  const { id } = await p.manager.hr.people.create({
    code: "E001",
    name: "Ramesh Patel",
    joinedOn: "2020-01-06",
    dob: "1980-05-10",
    kind: "permanent",
    shiftId: "day",
    userId: p.users.packer.id,
    bankName: "SBI",
    bankAccountNo: "30123456789",
    bankIfsc: "SBIN0001234",
    uan: "100200300400",
    esicIp: "3112345678",
  });
  await p.office.payroll.structures.save({ employeeId: id, effectiveFrom: "2026-04", basicPaise: 12_000_00, hraPaise: 3_000_00 });
  const rows = [];
  for (let d = 1; d <= 31; d += 1) {
    const day = `2026-10-${String(d).padStart(2, "0")}`;
    if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) continue;
    rows.push({ id: crypto.randomUUID(), companyId: p.companyId, employeeId: id, day, status: "present" as const, shiftId: "day" });
  }
  for (let i = 0; i < rows.length; i += 10) await env.db.insert(hrAttendance).values(rows.slice(i, i + 10));
  return id;
}

describe("payroll gate", () => {
  test("payroll with hr off is refused in plain words; hr alone has no payroll", async () => {
    const off = await plant(["payroll"]);
    await expect(off.office.payroll.runs.list()).rejects.toThrow("Payroll needs the HR module on for this plant");
    const hrOnly = await plant(["hr"]);
    await expect(hrOnly.office.payroll.runs.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("payroll run (row 88)", () => {
  test("compute, check, approve, lock; figures from attendance and the default rates", async () => {
    setClock(NOW);
    const p = await plant();
    const id = await octoberPerson(p);
    const run = await p.office.payroll.runs.compute({ month: "2026-10" });
    expect(run).toMatchObject({ version: 1, headcount: 1 });
    const { slips } = await p.office.payroll.runs.get({ month: "2026-10" });
    const f = slips[0]!.figures;
    expect(f.grossPaise).toBe(15_000_00);
    expect(f.epf).toMatchObject({ employeePaise: 1_440_00 });
    expect(f.esic).toMatchObject({ employeePaise: 113_00, covered: true });
    expect(f.pt).toMatchObject({ paise: 200_00 });
    expect(slips[0]!.netPaise).toBe(15_000_00 - 1_440_00 - 113_00 - 200_00);
    expect(f.person.bankMasked).toBe("XXXXXXX6789");

    // A stale version is refused; the right one opens the approval with no money in it.
    await expect(p.office.payroll.runs.check({ id: run.id, version: 2 })).rejects.toMatchObject({ code: "CONFLICT" });
    const { approvalId } = await p.office.payroll.runs.check({ id: run.id, version: 1 });
    const [ap] = await env.db.select().from(approval).where(eq(approval.id, approvalId));
    expect(JSON.stringify(ap!.meta)).not.toContain("1500000");
    await expect(p.office.payroll.structures.save({ employeeId: id, effectiveFrom: "2026-10", basicPaise: 13_000_00 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p.manager.payroll.runs.lock({ id: run.id })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p.as("accountant").approval.decide({ id: approvalId, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.manager.approval.decide({ id: approvalId, decision: "approved" });
    await expect(p.office.payroll.runs.lock({ id: run.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.manager.payroll.runs.lock({ id: run.id });

    // Locked: nothing in October changes any more.
    await expect(p.office.payroll.runs.compute({ month: "2026-10" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p.office.payroll.structures.save({ employeeId: id, effectiveFrom: "2026-10", basicPaise: 13_000_00 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.office.payroll.adjustments.add({ employeeId: id, month: "2026-10", kind: "advance", amountPaise: 500_00 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.manager.hr.attendance.markShift({ day: "2026-10-05", shiftId: "day", rows: [{ employeeId: id, status: "absent" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.office.payroll.runs.reopen({ id: run.id })).rejects.toMatchObject({ code: "CONFLICT" });

    // The person sees their own locked payslip.
    const mine = await p.as("packer").payroll.me.payslips();
    expect(mine.map((s) => [s.month, s.netPaise])).toEqual([["2026-10", 13_247_00]]);
    await expect(p.as("operator").payroll.me.payslips()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("an advance comes off the next draft; reopen sends a checked run back to draft", async () => {
    setClock(NOW);
    const p = await plant();
    const id = await octoberPerson(p);
    await p.office.payroll.adjustments.add({ employeeId: id, month: "2026-10", kind: "advance", label: "Diwali advance", amountPaise: 2_000_00 });
    const run = await p.office.payroll.runs.compute({ month: "2026-10" });
    expect((await p.office.payroll.runs.get({ month: "2026-10" })).slips[0]!.netPaise).toBe(11_247_00);
    const { approvalId } = await p.office.payroll.runs.check({ id: run.id, version: run.version });
    await p.office.payroll.runs.reopen({ id: run.id });
    expect((await env.db.select().from(approval).where(eq(approval.id, approvalId)))[0]).toMatchObject({ status: "rejected" });
    expect((await p.office.payroll.runs.compute({ month: "2026-10" })).version).toBe(2);
  });

  test("structure audit carries no figures; permission and tenancy", async () => {
    setClock(NOW);
    const p = await plant();
    const q = await plant();
    const id = await octoberPerson(p);
    const [a] = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "payroll.structure.save")));
    expect(JSON.stringify(a!.meta)).not.toContain("1200000");
    for (const role of ["supervisor", "packer", "viewer"] as CompanyRole[]) await expect(p.as(role).payroll.runs.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("accountant").payroll.structures.save({ employeeId: id, effectiveFrom: "2026-11", basicPaise: 1 })).resolves.toBeDefined();
    const run = await p.office.payroll.runs.compute({ month: "2026-10" });
    await expect(q.office.payroll.runs.slip({ runId: run.id, employeeId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(q.office.payroll.files.bank({ runId: run.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(q.office.payroll.structures.list({ employeeId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await q.office.payroll.runs.get({ month: "2026-10" })).run).toBeNull();
  });
});

describe("statutory files (row 88)", () => {
  test("bank, ECR and ESIC files from an approved run", async () => {
    setClock(NOW);
    const p = await plant();
    await octoberPerson(p);
    const run = await p.office.payroll.runs.compute({ month: "2026-10" });
    const { approvalId } = await p.office.payroll.runs.check({ id: run.id, version: 1 });
    await p.manager.approval.decide({ id: approvalId, decision: "approved" });
    const bank = await p.office.payroll.files.bank({ runId: run.id });
    expect(bank.missing).toEqual([]);
    expect(bank.csv).toContain("30123456789");
    expect(bank.csv).toContain("13247.00");
    const ecr = await p.office.payroll.files.ecr({ runId: run.id });
    expect(ecr.text.split("\n")[0]!.split("#~#")).toHaveLength(11);
    expect(ecr.text).toStartWith("100200300400#~#RAMESH PATEL#~#");
    expect(ecr.adminPaise).toBe(500_00);
    const esic = await p.office.payroll.files.esic({ runId: run.id });
    expect(esic.members).toBe(1);
    expect(esic.csv).toContain("3112345678");
  });

  test("statutory rates are dated and need a source note", async () => {
    setClock(NOW);
    const p = await plant();
    const { defaults: rates } = await p.office.payroll.settings.get();
    await expect(p.office.payroll.settings.save({ effectiveFrom: "2026-12", value: rates, note: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.office.payroll.settings.save({ effectiveFrom: "2026-12", value: rates, note: "Confirmed with the CA" });
    expect((await p.office.payroll.settings.get()).statutory).toMatchObject([{ effectiveFrom: "2026-12", note: "Confirmed with the CA" }]);
    await expect(p.as("supervisor").payroll.settings.save({ effectiveFrom: "2026-12", value: rates, note: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("full and final (row 88)", () => {
  test("worked out by the office, made final by someone else", async () => {
    setClock(NOW);
    const p = await plant();
    const id = await octoberPerson(p);
    await expect(p.office.payroll.settlement.compute({ employeeId: id, unpaidHalves: 0, encashHalves: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.manager.hr.people.leave({ id, leftOn: "2026-11-10", reason: "Resigned" });
    const s = await p.office.payroll.settlement.compute({ employeeId: id, unpaidHalves: 16, encashHalves: 20, recoveries: [{ label: "Canteen", paise: 300_00 }] });
    expect(s.netPaise).toBeGreaterThan(0);
    const got = await p.office.payroll.settlement.get({ employeeId: id });
    expect(got!.figures).toMatchObject({ inputs: { unpaidHalves: 16, encashHalves: 20 } });
    await expect(p.office.payroll.settlement.finalize({ employeeId: id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.manager.payroll.settlement.finalize({ employeeId: id });
    await expect(p.office.payroll.settlement.compute({ employeeId: id, unpaidHalves: 0, encashHalves: 0 })).rejects.toMatchObject({ code: "CONFLICT" });
    const q = await plant();
    await expect(q.office.payroll.settlement.get({ employeeId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("the manager who worked it out cannot make it final", async () => {
    setClock(NOW);
    const p = await plant();
    const id = await octoberPerson(p);
    await p.manager.hr.people.leave({ id, leftOn: "2026-11-10", reason: "Resigned" });
    await p.manager.payroll.settlement.compute({ employeeId: id, unpaidHalves: 0, encashHalves: 0 });
    await expect(p.manager.payroll.settlement.finalize({ employeeId: id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.as("admin").payroll.settlement.finalize({ employeeId: id });
  });
});
