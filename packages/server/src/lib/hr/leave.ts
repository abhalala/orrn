/**
 * XE parity lane HR, row 90: leave requests and their approval (`leave_request`). Applying opens the
 * request and its approval in one batch; deciding is `approval.decide` (the applier below). An approved
 * leave writes `leave` attendance on its working days (never over a day the person was marked present,
 * and never in a locked payroll month); cancelling an approved leave takes those rows back out.
 */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { approval } from "@orrn/db/schema/approval";
import { hrAttendance, hrEmployee, hrLeaveKind, hrLeaveRequest, payRun } from "@orrn/db/schema/hr";
import { leaveBalance, leaveHalves, leaveWorkingDays } from "@orrn/domain";

import { atomicBatch, type OrrnDb, type SqliteBatchItem } from "../atomic";
import { requestApprovalInsert } from "../approval";
import type { ApplyCtx, ApprovalApplier } from "../approvalApply";
import { decisionLanded } from "./decision";
import { auditInsert, auditInsertGuarded } from "../audit";
import { now } from "../clock";
import { nextCompanySeq } from "../sequence";
import { bad, conflict, holidaySet, notFound, rulesFor, type HrCtx } from "./core";

export const MAX_LEAVE_DAYS = 62;

export async function takenByYear(db: OrrnDb, companyId: string, employeeId: string, kindId: string, statuses: readonly ("pending" | "approved")[] = ["approved"]) {
  const rows = await db
    .select({ year: sql<string>`substr(${hrLeaveRequest.fromDay}, 1, 4)`, halves: sql<number>`sum(${hrLeaveRequest.halves})` })
    .from(hrLeaveRequest)
    .where(and(eq(hrLeaveRequest.companyId, companyId), eq(hrLeaveRequest.employeeId, employeeId), eq(hrLeaveRequest.kindId, kindId), inArray(hrLeaveRequest.status, [...statuses])))
    .groupBy(sql`substr(${hrLeaveRequest.fromDay}, 1, 4)`);
  return new Map(rows.map((r) => [Number(r.year), Number(r.halves)]));
}

/** Every live leave kind's balance for a person in a calendar year (approved leave; pending shown apart). */
export async function balancesFor(db: OrrnDb, companyId: string, person: { id: string; joinedOn: string }, year: number) {
  const kinds = await db.select().from(hrLeaveKind).where(and(eq(hrLeaveKind.companyId, companyId), eq(hrLeaveKind.active, true))).limit(30);
  const fromYear = Number(person.joinedOn.slice(0, 4));
  const out = [];
  for (const k of kinds) {
    const taken = await takenByYear(db, companyId, person.id, k.id);
    const pending = await takenByYear(db, companyId, person.id, k.id, ["pending"]);
    const b = leaveBalance({ quotaHalves: k.quotaHalves, carryCapHalves: k.carryCapHalves }, taken, fromYear, year);
    out.push({ kindId: k.id, code: k.code, name: k.name, paid: k.paid, ...b, pendingHalves: pending.get(year) ?? 0 });
  }
  return out;
}

export async function applyLeave(
  ctx: HrCtx,
  person: typeof hrEmployee.$inferSelect,
  input: { kindId: string; from: string; to: string; halfDay: boolean; reason: string | null },
): Promise<{ id: string; approvalId: string; halves: number }> {
  if (person.status === "left") throw bad(`${person.name} has left`);
  if (input.to < input.from) throw bad("The last day is before the first");
  if (input.from.slice(0, 4) !== input.to.slice(0, 4)) throw bad("Split a leave that runs into the next year");
  if ((Date.parse(input.to) - Date.parse(input.from)) / 86_400_000 + 1 > MAX_LEAVE_DAYS) throw bad(`A leave can be at most ${MAX_LEAVE_DAYS} days; split it`);
  if (input.from < person.joinedOn) throw bad(`${person.name} joined on ${person.joinedOn}`);
  const [kind] = await ctx.db.select().from(hrLeaveKind).where(and(eq(hrLeaveKind.companyId, ctx.companyId), eq(hrLeaveKind.id, input.kindId), eq(hrLeaveKind.active, true))).limit(1);
  if (!kind) throw notFound();
  const { value: rules } = await rulesFor(ctx.db, ctx.companyId, input.from.slice(0, 7));
  const hols = await holidaySet(ctx.db, ctx.companyId, input.from, input.to);
  const halves = leaveHalves({ from: input.from, to: input.to, halfDay: input.halfDay, weeklyOffDow: person.weeklyOffDow ?? rules.weeklyOffDow, holidays: hols });
  if (halves === 0) throw bad("Those days are all holidays or weekly offs");
  const [overlap] = await ctx.db
    .select({ id: hrLeaveRequest.id })
    .from(hrLeaveRequest)
    .where(
      and(
        eq(hrLeaveRequest.companyId, ctx.companyId),
        eq(hrLeaveRequest.employeeId, person.id),
        inArray(hrLeaveRequest.status, ["pending", "approved"]),
        lte(hrLeaveRequest.fromDay, input.to),
        gte(hrLeaveRequest.toDay, input.from),
      ),
    )
    .limit(1);
  if (overlap) throw conflict("A leave on these days is already asked or approved");
  if (kind.paid && kind.quotaHalves > 0) {
    const year = Number(input.from.slice(0, 4));
    const taken = await takenByYear(ctx.db, ctx.companyId, person.id, kind.id, ["pending", "approved"]);
    const b = leaveBalance({ quotaHalves: kind.quotaHalves, carryCapHalves: kind.carryCapHalves }, taken, Number(person.joinedOn.slice(0, 4)), year);
    if (b.balanceHalves < halves) throw bad(`Only ${Math.max(0, b.balanceHalves) / 2} days of ${kind.code} are left`);
  }
  const rowId = crypto.randomUUID();
  const seq = await nextCompanySeq(ctx, ctx.companyId);
  const req = requestApprovalInsert(ctx, {
    kind: "leave_request",
    subjectId: rowId,
    serverSeq: seq,
    requestNote: input.reason,
    meta: { employeeId: person.id, code: person.code, name: person.name, leaveKind: kind.code, from: input.from, to: input.to, halves },
    guard: { from: hrLeaveRequest, where: and(eq(hrLeaveRequest.companyId, ctx.companyId), eq(hrLeaveRequest.id, rowId)) },
  });
  await atomicBatch(ctx.db, [
    ctx.db.insert(hrLeaveRequest).values({
      id: rowId,
      companyId: ctx.companyId,
      employeeId: person.id,
      kindId: kind.id,
      fromDay: input.from,
      toDay: input.to,
      halfDay: input.halfDay,
      halves,
      reason: input.reason,
      status: "pending",
      approvalId: null,
      requestedBy: ctx.session.user.id,
    }),
    req.statement,
    ctx.db.update(hrLeaveRequest).set({ approvalId: req.id }).where(and(eq(hrLeaveRequest.companyId, ctx.companyId), eq(hrLeaveRequest.id, rowId))),
    auditInsert(ctx as Parameters<typeof auditInsert>[0], { action: "hr.leave.apply", subjectType: "hr_leave_request", subjectId: rowId, meta: { code: person.code, leaveKind: kind.code, from: input.from, to: input.to, halves } }),
  ]);
  return { id: rowId, approvalId: req.id, halves };
}

/** Cancel a pending (withdraws its approval) or approved leave (takes its attendance rows out). */
export async function cancelLeave(ctx: HrCtx, row: typeof hrLeaveRequest.$inferSelect): Promise<void> {
  if (row.status !== "pending" && row.status !== "approved") throw conflict("Only a waiting or approved leave can be cancelled");
  const locked = await ctx.db.select({ month: payRun.month }).from(payRun).where(and(eq(payRun.companyId, ctx.companyId), eq(payRun.status, "locked"))).limit(400);
  const lockedMonths = new Set(locked.map((l) => l.month));
  if (row.status === "approved" && (lockedMonths.has(row.fromDay.slice(0, 7)) || lockedMonths.has(row.toDay.slice(0, 7)))) throw bad(`The payroll for ${row.fromDay.slice(0, 7)} is locked; corrections go in the next month`);
  const seq = await nextCompanySeq(ctx, ctx.companyId);
  const stmts: SqliteBatchItem[] = [
    ctx.db
      .update(hrLeaveRequest)
      .set({ status: "cancelled" })
      .where(and(eq(hrLeaveRequest.companyId, ctx.companyId), eq(hrLeaveRequest.id, row.id), eq(hrLeaveRequest.status, row.status))),
  ];
  if (row.status === "pending" && row.approvalId) {
    stmts.push(
      ctx.db
        .update(approval)
        .set({ status: "rejected", decidedAt: now(), note: "Withdrawn: the leave was cancelled.", serverSeq: seq })
        .where(and(eq(approval.companyId, ctx.companyId), eq(approval.id, row.approvalId), eq(approval.status, "pending"))),
    );
  }
  if (row.status === "approved") {
    stmts.push(
      ctx.db
        .delete(hrAttendance)
        .where(and(eq(hrAttendance.companyId, ctx.companyId), eq(hrAttendance.leaveRequestId, row.id), eq(hrAttendance.source, "leave"))),
    );
  }
  stmts.push(
    auditInsertGuarded(ctx as Parameters<typeof auditInsert>[0], { action: "hr.leave.cancel", subjectType: "hr_leave_request", subjectId: row.id, meta: { from: row.fromDay, to: row.toDay, was: row.status } }, {
      from: hrLeaveRequest,
      where: and(eq(hrLeaveRequest.companyId, ctx.companyId), eq(hrLeaveRequest.id, row.id), eq(hrLeaveRequest.status, "cancelled")),
    }),
  );
  await atomicBatch(ctx.db, stmts);
}

type LeavePrepared = { days: string[]; paid: boolean; employeeId: string } | null;

/** Before the decision batch: the working days the leave covers (holidays read here), minus locked months. */
export async function leaveRequestPrepare(ctx: ApplyCtx, row: { subjectId: string }, decision: "approved" | "rejected"): Promise<LeavePrepared> {
  if (decision === "rejected") return null;
  const [req] = await ctx.db
    .select({ r: hrLeaveRequest, paid: hrLeaveKind.paid, weeklyOffDow: hrEmployee.weeklyOffDow })
    .from(hrLeaveRequest)
    .innerJoin(hrLeaveKind, eq(hrLeaveKind.id, hrLeaveRequest.kindId))
    .innerJoin(hrEmployee, eq(hrEmployee.id, hrLeaveRequest.employeeId))
    .where(and(eq(hrLeaveRequest.companyId, ctx.companyId), eq(hrLeaveRequest.id, row.subjectId)))
    .limit(1);
  if (!req) return null;
  const { value: rules } = await rulesFor(ctx.db, ctx.companyId, req.r.fromDay.slice(0, 7));
  const hols = await holidaySet(ctx.db, ctx.companyId, req.r.fromDay, req.r.toDay);
  const locked = await ctx.db.select({ month: payRun.month }).from(payRun).where(and(eq(payRun.companyId, ctx.companyId), eq(payRun.status, "locked"))).limit(400);
  const lockedMonths = new Set(locked.map((l) => l.month));
  const days = leaveWorkingDays({ from: req.r.fromDay, to: req.r.toDay, weeklyOffDow: req.weeklyOffDow ?? rules.weeklyOffDow, holidays: hols }).filter((d) => !lockedMonths.has(d.slice(0, 7)));
  return { days, paid: req.paid, employeeId: req.r.employeeId };
}

export const leaveRequestDecision: ApprovalApplier = (ctx, row, decision, prepared) => {
  const landed = decisionLanded(ctx, row.id, decision);
  const out: SqliteBatchItem[] = [
    ctx.db
      .update(hrLeaveRequest)
      .set({ status: decision })
      .where(and(eq(hrLeaveRequest.companyId, ctx.companyId), eq(hrLeaveRequest.id, row.subjectId), eq(hrLeaveRequest.status, "pending"), landed)),
  ];
  const p = prepared as LeavePrepared;
  if (decision !== "approved" || !p) return out;
  const at = ctx.decidedAt.getTime();
  for (const day of p.days) {
    // Keys follow hr_attendance's column order (insert-select rule). Never over a day the person worked.
    out.push(
      ctx.db
        .insert(hrAttendance)
        .select(
          ctx.db
            .select({
              id: sql<string>`${crypto.randomUUID()}`.as("id"),
              companyId: hrLeaveRequest.companyId,
              employeeId: hrLeaveRequest.employeeId,
              day: sql<string>`${day}`.as("day"),
              status: sql<string>`'leave'`.as("status"),
              shiftId: sql<string | null>`null`.as("shift_id"),
              inAt: sql<number | null>`null`.as("in_at"),
              outAt: sql<number | null>`null`.as("out_at"),
              workedMin: sql<number | null>`null`.as("worked_min"),
              overtimeMin: sql<number>`0`.as("overtime_min"),
              source: sql<string>`'leave'`.as("source"),
              leaveRequestId: hrLeaveRequest.id,
              paidLeave: sql<number>`${p.paid ? 1 : 0}`.as("paid_leave"),
              lateEntry: sql<number>`0`.as("late_entry"),
              note: sql<string | null>`null`.as("note"),
              markedBy: sql<string>`${ctx.userId}`.as("marked_by"),
              markedAt: sql<number>`${at}`.as("marked_at"),
            })
            .from(hrLeaveRequest)
            .where(and(eq(hrLeaveRequest.companyId, ctx.companyId), eq(hrLeaveRequest.id, row.subjectId), eq(hrLeaveRequest.status, "approved"), landed)),
        )
        .onConflictDoUpdate({
          target: [hrAttendance.companyId, hrAttendance.employeeId, hrAttendance.day],
          set: {
            status: sql`'leave'`,
            source: sql`'leave'`,
            leaveRequestId: sql`excluded.leave_request_id`,
            paidLeave: sql`excluded.paid_leave`,
            inAt: sql`null`,
            outAt: sql`null`,
            workedMin: sql`null`,
            overtimeMin: sql`0`,
            markedBy: sql`excluded.marked_by`,
            markedAt: sql`excluded.marked_at`,
          },
          setWhere: sql`${hrAttendance.status} not in ('present', 'half_day')`,
        }),
    );
  }
  return out;
};

