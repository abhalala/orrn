/**
 * XE parity lane HR, row 88: the monthly payroll run. Draft (recomputed from attendance as often as the
 * office likes), checked (figures frozen at a version; approval `payroll_run` opened), approved (by a
 * manager or admin through `approval.decide`), locked (never changes; corrections go in the next month).
 * Reads are bulk (one query per table for the month), so a run of a few hundred people stays a handful
 * of statements. Approval meta carries the month, head count and version only, never money.
 */
import { and, asc, eq, gte, inArray, lte, lt, sql } from "drizzle-orm";

import { plantMaster } from "@orrn/db/schema/admin";
import { approval } from "@orrn/db/schema/approval";
import { hrAttendance, hrEmployee, payAdjustment, payRun, paySlip, payStructure } from "@orrn/db/schema/hr";
import {
  computePayslip,
  datedFor,
  daysOfMonth,
  esicCoveredFor,
  esicPeriodStart,
  maskAccount,
  serviceLength,
  timesheet,
  type PayLine,
  type Payslip,
  type SalaryStructure,
} from "@orrn/domain";

import { abortBatchUnless, atomicBatch, isBatchAbort, pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "../atomic";
import { requestApprovalInsert } from "../approval";
import type { ApprovalApplier } from "../approvalApply";
import { decisionLanded } from "./decision";
import { auditInsert } from "../audit";
import { now } from "../clock";
import { nextCompanySeq } from "../sequence";
import { bad, conflict, holidaySet, notFound, ratesFor, rulesFor, type HrCtx } from "./core";
import { incentiveSheet } from "./incentive";

export type SlipFigures = Payslip & {
  person: { code: string; name: string; uan: string | null; esicIp: string | null; department: string | null; designation: string | null; bankMasked: string; joinedOn: string; leftOn: string | null };
  ncpDays: number;
  notMarked: number;
  structureFrom: string;
};

export async function getRun(db: OrrnDb, companyId: string, runId: string) {
  const [run] = await db.select().from(payRun).where(and(eq(payRun.companyId, companyId), eq(payRun.id, runId))).limit(1);
  if (!run) throw notFound();
  return run;
}

/** People on the rolls in `month` (joined by its last day, not left before its first). */
async function peopleOfMonth(db: OrrnDb, companyId: string, first: string, last: string) {
  return db
    .select()
    .from(hrEmployee)
    .where(and(eq(hrEmployee.companyId, companyId), lte(hrEmployee.joinedOn, last), sql`(${hrEmployee.leftOn} is null or ${hrEmployee.leftOn} >= ${first})`))
    .orderBy(asc(hrEmployee.code))
    .limit(2000);
}

function ageAt(dob: string | null, day: string): number | null {
  return dob ? serviceLength(dob, day).years : null;
}

/** Every payslip of a month, computed from the month's attendance, the dated rules and rates, and adjustments. */
export async function computeSlips(db: OrrnDb, companyId: string, month: string): Promise<{ employeeId: string; figures: SlipFigures }[]> {
  const days = daysOfMonth(month);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  const people = await peopleOfMonth(db, companyId, first, last);
  if (!people.length) return [];
  const structures = await db.select().from(payStructure).where(and(eq(payStructure.companyId, companyId), lte(payStructure.effectiveFrom, month))).limit(10_000);
  const marks = await db
    .select({ employeeId: hrAttendance.employeeId, day: hrAttendance.day, status: hrAttendance.status, overtimeMin: hrAttendance.overtimeMin, paidLeave: hrAttendance.paidLeave })
    .from(hrAttendance)
    .where(and(eq(hrAttendance.companyId, companyId), gte(hrAttendance.day, first), lte(hrAttendance.day, last)))
    .limit(70_000);
  const adjustments = await db.select().from(payAdjustment).where(and(eq(payAdjustment.companyId, companyId), eq(payAdjustment.month, month))).limit(5000);
  const { value: rules } = await rulesFor(db, companyId, month);
  const { value: rates } = await ratesFor(db, companyId, month);
  const hols = await holidaySet(db, companyId, first, last);
  const incentive = await incentiveSheet(db, companyId, month);
  const incentiveOn = incentive.effectiveFrom !== null;
  const periodStart = esicPeriodStart(month);
  const earlier = await db
    .select({ employeeId: paySlip.employeeId, month: paySlip.month, grossPaise: paySlip.grossPaise })
    .from(paySlip)
    .innerJoin(payRun, eq(payRun.id, paySlip.runId))
    .where(and(eq(paySlip.companyId, companyId), gte(paySlip.month, periodStart), lt(paySlip.month, month), inArray(payRun.status, ["approved", "locked"])))
    .orderBy(asc(paySlip.month))
    .limit(10_000);
  const names = new Map(
    (await db.select({ id: plantMaster.id, name: plantMaster.name }).from(plantMaster).where(eq(plantMaster.companyId, companyId)).limit(500)).map((r) => [r.id, r.name]),
  );
  const out: { employeeId: string; figures: SlipFigures }[] = [];
  for (const p of people) {
    const st = datedFor(structures.filter((s) => s.employeeId === p.id), month);
    if (!st) continue;
    const structure: SalaryStructure = { basicPaise: st.basicPaise, daPaise: st.daPaise, hraPaise: st.hraPaise, otherPaise: st.otherPaise, perDay: st.perDay, pfOnActual: st.pfOnActual, pfMember: st.pfMember, esicMember: st.esicMember, ptApplies: st.ptApplies };
    const sheet = timesheet({
      month,
      marks: marks.filter((m) => m.employeeId === p.id).map((m) => ({ day: m.day, status: m.status, overtimeMin: m.overtimeMin, paidLeave: m.paidLeave ?? undefined })),
      joinedOn: p.joinedOn,
      leftOn: p.leftOn,
      weeklyOffDow: p.weeklyOffDow ?? rules.weeklyOffDow,
      holidays: hols,
    });
    const mine = adjustments.filter((a) => a.employeeId === p.id);
    const extra: PayLine[] = mine.filter((a) => a.kind === "earning").map((a) => ({ code: "earning", label: a.label ?? undefined, paise: a.amountPaise }));
    if (incentiveOn) {
      const inc = incentive.byPerson.find((b) => b.employeeId === p.id);
      if (inc && inc.paise > 0) extra.push({ code: "incentive", paise: inc.paise });
    }
    const deductions: PayLine[] = mine.filter((a) => a.kind !== "earning").map((a) => ({ code: a.kind, label: a.label ?? undefined, paise: a.amountPaise }));
    const base = { month, structure, sheet, rules, rates, ageAtMonthStart: ageAt(p.dob, first), extraEarnings: extra, deductions };
    let slip = computePayslip({ ...base, esicCovered: true });
    const firstGross = earlier.find((e) => e.employeeId === p.id)?.grossPaise ?? null;
    const covered = esicCoveredFor({ coveredFlag: st.esicCovered ?? null, firstGrossPaise: firstGross, thisGrossPaise: slip.grossPaise, ceilingPaise: rates.esicWageCeilingPaise });
    if (!covered) slip = computePayslip({ ...base, esicCovered: false });
    out.push({
      employeeId: p.id,
      figures: {
        ...slip,
        person: {
          code: p.code,
          name: p.name,
          uan: p.uan,
          esicIp: p.esicIp,
          department: p.departmentId ? (names.get(p.departmentId) ?? null) : null,
          designation: p.designationId ? (names.get(p.designationId) ?? null) : null,
          bankMasked: maskAccount(p.bankAccountNo),
          joinedOn: p.joinedOn,
          leftOn: p.leftOn,
        },
        ncpDays: Math.ceil(sheet.lopHalves / 2),
        notMarked: sheet.notMarked,
        structureFrom: st.effectiveFrom,
      },
    });
  }
  return out;
}

/** Make or recompute a month's draft run. */
export async function computeRun(ctx: HrCtx, month: string): Promise<{ id: string; version: number; headcount: number }> {
  const [had] = await ctx.db.select().from(payRun).where(and(eq(payRun.companyId, ctx.companyId), eq(payRun.month, month))).limit(1);
  if (had && had.status !== "draft") throw conflict(had.status === "locked" ? `The payroll for ${month} is locked; corrections go in the next month` : "This run is checked; reopen it to change it");
  const slips = await computeSlips(ctx.db, ctx.companyId, month);
  const runId = had?.id ?? crypto.randomUUID();
  const version = (had?.version ?? 0) + 1;
  const gross = slips.reduce((a, s) => a + s.figures.grossPaise, 0);
  const net = slips.reduce((a, s) => a + s.figures.netPaise, 0);
  const stmts: SqliteBatchItem[] = [];
  if (had) {
    stmts.push(
      ctx.db
        .update(payRun)
        .set({ version, headcount: slips.length, grossPaise: gross, netPaise: net })
        .where(and(eq(payRun.companyId, ctx.companyId), eq(payRun.id, runId), eq(payRun.status, "draft"), eq(payRun.version, had.version))),
      abortBatchUnless(ctx.db, sql`changes() > 0`),
      ctx.db.delete(paySlip).where(and(eq(paySlip.companyId, ctx.companyId), eq(paySlip.runId, runId))),
    );
  } else {
    stmts.push(ctx.db.insert(payRun).values({ id: runId, companyId: ctx.companyId, month, status: "draft", version, headcount: slips.length, grossPaise: gross, netPaise: net, createdBy: ctx.session.user.id }));
  }
  const createdAt = now();
  pushChunkedInserts(
    stmts,
    (rows) => ctx.db.insert(paySlip).values(rows),
    slips.map((s) => ({ id: crypto.randomUUID(), companyId: ctx.companyId, runId, employeeId: s.employeeId, month, grossPaise: s.figures.grossPaise, netPaise: s.figures.netPaise, figures: s.figures as unknown as Record<string, unknown>, createdAt })),
  );
  stmts.push(auditInsert(ctx as Parameters<typeof auditInsert>[0], { action: "payroll.run.compute", subjectType: "pay_run", subjectId: runId, meta: { month, version, headcount: slips.length } }));
  try {
    await atomicBatch(ctx.db, stmts);
  } catch (e) {
    if (isBatchAbort(e)) throw conflict("Someone changed this run just now; open it again");
    if (String((e as Error)?.message ?? e).includes("UNIQUE") || String((e as { cause?: Error })?.cause?.message ?? "").includes("pay_run")) throw conflict("Someone started this month's run just now; open it again");
    throw e;
  }
  return { id: runId, version, headcount: slips.length };
}

/** Freeze the figures at `version` and ask a manager or admin to approve (approval payroll_run). */
export async function checkRun(ctx: HrCtx, runId: string, version: number, note: string | null) {
  const run = await getRun(ctx.db, ctx.companyId, runId);
  if (run.status !== "draft") throw conflict("Only a draft run can be checked");
  if (run.version !== version) throw conflict("The figures changed since you opened them; look again");
  if (run.headcount === 0) throw bad("No one has a salary structure for this month");
  const seq = await nextCompanySeq(ctx, ctx.companyId);
  const req = requestApprovalInsert(ctx, {
    kind: "payroll_run",
    subjectId: run.id,
    serverSeq: seq,
    requestNote: note,
    meta: { month: run.month, headcount: run.headcount, version },
    guard: { from: payRun, where: and(eq(payRun.companyId, ctx.companyId), eq(payRun.id, run.id), eq(payRun.status, "draft"), eq(payRun.version, version)) },
  });
  try {
    await atomicBatch(ctx.db, [
      // The approval first (the run's approval_id points at it), then the run, guarded the same way.
      req.statement,
      ctx.db
        .update(payRun)
        .set({ status: "checked", checkedBy: ctx.session.user.id, checkedAt: now(), approvalId: req.id })
        .where(and(eq(payRun.companyId, ctx.companyId), eq(payRun.id, run.id), eq(payRun.status, "draft"), eq(payRun.version, version))),
      abortBatchUnless(ctx.db, sql`changes() > 0`),
      auditInsert(ctx as Parameters<typeof auditInsert>[0], { action: "payroll.run.check", subjectType: "pay_run", subjectId: run.id, meta: { month: run.month, version } }),
    ]);
  } catch (e) {
    if (isBatchAbort(e)) throw conflict("Someone changed this run just now; open it again");
    throw e;
  }
  return { approvalId: req.id };
}

/** Back to draft from checked (withdraws a waiting approval) or approved (before the lock). */
export async function reopenRun(ctx: HrCtx, runId: string) {
  const run = await getRun(ctx.db, ctx.companyId, runId);
  if (run.status !== "checked" && run.status !== "approved") throw conflict(run.status === "locked" ? `The payroll for ${run.month} is locked; corrections go in the next month` : "This run is already a draft");
  const seq = await nextCompanySeq(ctx, ctx.companyId);
  const stmts: SqliteBatchItem[] = [
    ctx.db
      .update(payRun)
      .set({ status: "draft", approvalId: null, checkedBy: null, checkedAt: null })
      .where(and(eq(payRun.companyId, ctx.companyId), eq(payRun.id, run.id), eq(payRun.status, run.status))),
    abortBatchUnless(ctx.db, sql`changes() > 0`),
  ];
  if (run.approvalId) {
    stmts.push(
      ctx.db
        .update(approval)
        .set({ status: "rejected", decidedAt: now(), note: "Withdrawn: the run was reopened.", serverSeq: seq })
        .where(and(eq(approval.companyId, ctx.companyId), eq(approval.id, run.approvalId), eq(approval.status, "pending"))),
    );
  }
  stmts.push(auditInsert(ctx as Parameters<typeof auditInsert>[0], { action: "payroll.run.reopen", subjectType: "pay_run", subjectId: run.id, meta: { month: run.month, was: run.status } }));
  try {
    await atomicBatch(ctx.db, stmts);
  } catch (e) {
    if (isBatchAbort(e)) throw conflict("Someone changed this run just now; open it again");
    throw e;
  }
}

export async function lockRun(ctx: HrCtx, runId: string) {
  const run = await getRun(ctx.db, ctx.companyId, runId);
  if (run.status !== "approved") throw conflict("Only an approved run can be locked");
  try {
    await atomicBatch(ctx.db, [
      ctx.db
        .update(payRun)
        .set({ status: "locked", lockedBy: ctx.session.user.id, lockedAt: now() })
        .where(and(eq(payRun.companyId, ctx.companyId), eq(payRun.id, run.id), eq(payRun.status, "approved"))),
      abortBatchUnless(ctx.db, sql`changes() > 0`),
      auditInsert(ctx as Parameters<typeof auditInsert>[0], { action: "payroll.run.lock", subjectType: "pay_run", subjectId: run.id, meta: { month: run.month, version: run.version } }),
    ]);
  } catch (e) {
    if (isBatchAbort(e)) throw conflict("Someone changed this run just now; open it again");
    throw e;
  }
}

/** Approved: the run checked under this very request becomes approved. Rejected: back to draft. */
export const payrollRunDecision: ApprovalApplier = (ctx, row, decision) => {
  const landed = decisionLanded(ctx, row.id, decision);
  return [
    ctx.db
      .update(payRun)
      .set(decision === "approved" ? { status: "approved" } : { status: "draft", approvalId: null, checkedBy: null, checkedAt: null })
      .where(and(eq(payRun.companyId, ctx.companyId), eq(payRun.id, row.subjectId), eq(payRun.status, "checked"), eq(payRun.approvalId, row.id), landed)),
  ];
};

/** A month is open for payroll inputs (structures from it, adjustments in it) while its run is a draft or absent. */
export async function assertPayMonthOpen(db: OrrnDb, companyId: string, month: string) {
  const [run] = await db.select({ status: payRun.status }).from(payRun).where(and(eq(payRun.companyId, companyId), eq(payRun.month, month))).limit(1);
  if (run?.status === "locked") throw bad(`The payroll for ${month} is locked; corrections go in the next month`);
  if (run && run.status !== "draft") throw conflict("This month's run is checked; reopen it to change it");
}
