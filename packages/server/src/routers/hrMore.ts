/**
 * XE parity lane HR, rows 89 and 90: leave kinds and requests, the training register, performance notes,
 * the incentive sheet, the plant's dated HR rules and the self-service screens (`me`) for a signed-in
 * person linked to an employee. Spread into `hr` (routers/hr.ts). Self-service never takes an employee
 * id: the person comes from the session.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { hrEmployee, hrLeaveKind, hrLeaveRequest, hrLeaveStatuses, hrReview, hrSetting, hrTraining, hrTrainingPerson } from "@orrn/db/schema/hr";
import { DEFAULT_HR_RULES, DEFAULT_INCENTIVE_RULE, incentiveCsv, isMonth, isYmd, trainingExpiry, trainingState } from "@orrn/domain";

import { router } from "../index";
import { atomicBatch, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { isUniqueOn } from "../lib/ageing";
import { bad, conflict, getEmployee, myEmployee, notFound, plantClock, settingHistory, type HrCtx } from "../lib/hr/core";
import { hrProcedure } from "../lib/hr/gate";
import { incentiveSheet } from "../lib/hr/incentive";
import { applyLeave, balancesFor, cancelLeave } from "../lib/hr/leave";
import { personMonth } from "./hrAttendance";

const id = z.string().trim().min(1).max(64);
const ymd = z.string().refine(isYmd, "Use a date like 2026-11-03");
const month = z.string().refine(isMonth, "Use a month like 2026-11");
const audit = (ctx: HrCtx, action: string, subjectType: string, subjectId: string, meta: Record<string, unknown>) =>
  auditInsert(ctx as Parameters<typeof auditInsert>[0], { action, subjectType, subjectId, meta });

const applyInput = z.object({ kindId: id, from: ymd, to: ymd, halfDay: z.boolean().default(false), reason: z.string().trim().max(300).nullable().optional() });

async function requestRows(ctx: HrCtx, where: Parameters<typeof and>[0], limit = 200) {
  const rows = await ctx.db
    .select({ r: hrLeaveRequest, code: hrEmployee.code, name: hrEmployee.name, kindCode: hrLeaveKind.code, kindName: hrLeaveKind.name, paid: hrLeaveKind.paid })
    .from(hrLeaveRequest)
    .innerJoin(hrEmployee, eq(hrEmployee.id, hrLeaveRequest.employeeId))
    .innerJoin(hrLeaveKind, eq(hrLeaveKind.id, hrLeaveRequest.kindId))
    .where(and(eq(hrLeaveRequest.companyId, ctx.companyId), where))
    .orderBy(desc(hrLeaveRequest.fromDay))
    .limit(limit);
  return rows.map((x) => ({ ...x.r, code: x.code, name: x.name, kindCode: x.kindCode, kindName: x.kindName, paid: x.paid }));
}

const leave = router({
  kinds: hrProcedure("hr.view", "leave.apply", "leave.approve").query(({ ctx }) =>
    ctx.db.select().from(hrLeaveKind).where(eq(hrLeaveKind.companyId, ctx.companyId)).orderBy(asc(hrLeaveKind.code)).limit(30),
  ),

  saveKind: hrProcedure("hr.manage")
    .input(
      z.object({
        id: id.optional(),
        code: z.string().trim().min(1).max(6).regex(/^[A-Za-z]+$/, "Use letters for the code, like CL").transform((v) => v.toUpperCase()),
        name: z.string().trim().min(1).max(40),
        paid: z.boolean(),
        quotaHalves: z.number().int().min(0).max(730),
        carryCapHalves: z.number().int().min(0).max(730),
        active: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rowId = input.id ?? crypto.randomUUID();
      if (input.id) {
        const [had] = await ctx.db.select({ id: hrLeaveKind.id }).from(hrLeaveKind).where(and(eq(hrLeaveKind.companyId, ctx.companyId), eq(hrLeaveKind.id, input.id))).limit(1);
        if (!had) throw notFound();
      }
      const values = { code: input.code, name: input.name, paid: input.paid, quotaHalves: input.quotaHalves, carryCapHalves: input.carryCapHalves, active: input.active };
      try {
        await atomicBatch(ctx.db, [
          input.id ? ctx.db.update(hrLeaveKind).set(values).where(and(eq(hrLeaveKind.companyId, ctx.companyId), eq(hrLeaveKind.id, input.id))) : ctx.db.insert(hrLeaveKind).values({ id: rowId, companyId: ctx.companyId, ...values }),
          audit(ctx, "hr.leaveKind.save", "hr_leave_kind", rowId, values),
        ]);
      } catch (e) {
        if (isUniqueOn(e, "hr_leave_kind")) throw conflict(`${input.code} is already a leave kind`);
        throw e;
      }
      return { id: rowId };
    }),

  requests: hrProcedure("hr.view", "leave.approve")
    .input(z.object({ status: z.enum([...hrLeaveStatuses, "all"]).default("pending"), employeeId: id.optional() }).default({ status: "pending" }))
    .query(({ ctx, input }) =>
      requestRows(ctx, and(input.status === "all" ? undefined : eq(hrLeaveRequest.status, input.status), input.employeeId ? eq(hrLeaveRequest.employeeId, input.employeeId) : undefined)),
    ),

  balances: hrProcedure("hr.view", "leave.approve")
    .input(z.object({ employeeId: id, year: z.number().int().min(2000).max(2100) }))
    .query(async ({ ctx, input }) => {
      const person = await getEmployee(ctx.db, ctx.companyId, input.employeeId);
      return balancesFor(ctx.db, ctx.companyId, person, input.year);
    }),

  /** Apply for someone else (a supervisor for a floor worker who never signs in). */
  applyFor: hrProcedure("leave.approve")
    .input(applyInput.extend({ employeeId: id }))
    .mutation(async ({ ctx, input }) => {
      const person = await getEmployee(ctx.db, ctx.companyId, input.employeeId);
      return applyLeave(ctx, person, { kindId: input.kindId, from: input.from, to: input.to, halfDay: input.halfDay, reason: input.reason ?? null });
    }),

  cancel: hrProcedure("leave.approve")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(hrLeaveRequest).where(and(eq(hrLeaveRequest.companyId, ctx.companyId), eq(hrLeaveRequest.id, input.id))).limit(1);
      if (!row) throw notFound();
      await cancelLeave(ctx, row);
      return { id: input.id };
    }),
});

const training = router({
  list: hrProcedure("hr.view")
    .input(z.object({ employeeId: id.optional() }).default({}))
    .query(async ({ ctx, input }) => {
      const clock = await plantClock(ctx.db, ctx.companyId);
      const sessions = await ctx.db.select().from(hrTraining).where(eq(hrTraining.companyId, ctx.companyId)).orderBy(desc(hrTraining.day)).limit(300);
      const people = await ctx.db
        .select({ trainingId: hrTrainingPerson.trainingId, employeeId: hrTrainingPerson.employeeId, code: hrEmployee.code, name: hrEmployee.name, status: hrEmployee.status })
        .from(hrTrainingPerson)
        .innerJoin(hrEmployee, eq(hrEmployee.id, hrTrainingPerson.employeeId))
        .where(and(eq(hrTrainingPerson.companyId, ctx.companyId), input.employeeId ? eq(hrTrainingPerson.employeeId, input.employeeId) : undefined))
        .limit(5000);
      return sessions
        .map((s) => {
          const expiresOn = trainingExpiry(s.day, s.validityMonths);
          return { ...s, expiresOn, state: trainingState(expiresOn, clock.today), people: people.filter((p) => p.trainingId === s.id) };
        })
        .filter((s) => !input.employeeId || s.people.length > 0);
    }),

  /** Who is due for a refresher: per person and course, the latest session expired or expiring within 30 days. */
  due: hrProcedure("hr.view").query(async ({ ctx }) => {
    const clock = await plantClock(ctx.db, ctx.companyId);
    const rows = await ctx.db
      .select({ course: hrTraining.course, day: hrTraining.day, validityMonths: hrTraining.validityMonths, employeeId: hrEmployee.id, code: hrEmployee.code, name: hrEmployee.name })
      .from(hrTrainingPerson)
      .innerJoin(hrTraining, eq(hrTraining.id, hrTrainingPerson.trainingId))
      .innerJoin(hrEmployee, eq(hrEmployee.id, hrTrainingPerson.employeeId))
      .where(and(eq(hrTrainingPerson.companyId, ctx.companyId), eq(hrEmployee.status, "active")))
      .limit(5000);
    const latest = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const k = `${r.employeeId}|${r.course.toLowerCase()}`;
      const had = latest.get(k);
      if (!had || had.day < r.day) latest.set(k, r);
    }
    return [...latest.values()]
      .map((r) => {
        const expiresOn = trainingExpiry(r.day, r.validityMonths);
        return { employeeId: r.employeeId, code: r.code, name: r.name, course: r.course, lastOn: r.day, expiresOn, state: trainingState(expiresOn, clock.today) };
      })
      .filter((r) => r.state === "expired" || r.state === "due_soon")
      .sort((a, b) => (a.expiresOn ?? "").localeCompare(b.expiresOn ?? ""));
  }),

  save: hrProcedure("hr.manage")
    .input(
      z.object({
        course: z.string().trim().min(1).max(80),
        day: ymd,
        trainer: z.string().trim().max(80).nullable().optional(),
        validityMonths: z.number().int().min(0).max(120),
        note: z.string().trim().max(300).nullable().optional(),
        employeeIds: z.array(id).min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ids = [...new Set(input.employeeIds)];
      const found = await ctx.db.select({ id: hrEmployee.id }).from(hrEmployee).where(and(eq(hrEmployee.companyId, ctx.companyId), inArray(hrEmployee.id, ids.slice(0, 90))));
      const rest = ids.length > 90 ? await ctx.db.select({ id: hrEmployee.id }).from(hrEmployee).where(and(eq(hrEmployee.companyId, ctx.companyId), inArray(hrEmployee.id, ids.slice(90)))) : [];
      if (found.length + rest.length !== ids.length) throw notFound();
      const rowId = crypto.randomUUID();
      const stmts: SqliteBatchItem[] = [
        ctx.db.insert(hrTraining).values({ id: rowId, companyId: ctx.companyId, course: input.course, day: input.day, trainer: input.trainer ?? null, validityMonths: input.validityMonths, note: input.note ?? null, createdBy: ctx.session.user.id }),
      ];
      for (let i = 0; i < ids.length; i += 20) {
        stmts.push(ctx.db.insert(hrTrainingPerson).values(ids.slice(i, i + 20).map((e) => ({ id: crypto.randomUUID(), companyId: ctx.companyId, trainingId: rowId, employeeId: e }))));
      }
      stmts.push(audit(ctx, "hr.training.save", "hr_training", rowId, { course: input.course, day: input.day, people: ids.length }));
      await atomicBatch(ctx.db, stmts);
      return { id: rowId };
    }),
});

const reviews = router({
  list: hrProcedure("hr.view")
    .input(z.object({ employeeId: id }))
    .query(async ({ ctx, input }) => {
      await getEmployee(ctx.db, ctx.companyId, input.employeeId);
      return ctx.db.select().from(hrReview).where(and(eq(hrReview.companyId, ctx.companyId), eq(hrReview.employeeId, input.employeeId))).orderBy(desc(hrReview.createdAt)).limit(100);
    }),

  add: hrProcedure("hr.manage")
    .input(z.object({ employeeId: id, period: z.string().trim().min(1).max(20), rating: z.number().int().min(1).max(5), remarks: z.string().trim().max(1000).nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const person = await getEmployee(ctx.db, ctx.companyId, input.employeeId);
      const rowId = crypto.randomUUID();
      await atomicBatch(ctx.db, [
        ctx.db.insert(hrReview).values({ id: rowId, companyId: ctx.companyId, employeeId: person.id, period: input.period, rating: input.rating, remarks: input.remarks ?? null, reviewedBy: ctx.session.user.id }),
        audit(ctx, "hr.review.add", "hr_employee", person.id, { code: person.code, period: input.period, rating: input.rating }),
      ]);
      return { id: rowId };
    }),
});

const incentive = router({
  sheet: hrProcedure("hr.view")
    .input(z.object({ month }))
    .query(({ ctx, input }) => incentiveSheet(ctx.db, ctx.companyId, input.month)),

  /** The sheet as CSV (for a plant without payroll, or for the office). */
  csv: hrProcedure("hr.view")
    .input(z.object({ month }))
    .query(async ({ ctx, input }) => {
      const sheet = await incentiveSheet(ctx.db, ctx.companyId, input.month);
      return { filename: `incentive-${input.month}.csv`, csv: incentiveCsv(sheet.rows.filter((r) => r.employeeId).map((r) => ({ code: r.code!, name: r.name!, day: r.day, shift: r.shift, goodG: r.goodG, inputG: r.inputG, rejectG: r.rejectG, paise: r.paise }))) };
    }),
});

const rulesValue = z.object({
  retirementAge: z.number().int().min(45).max(75),
  weeklyOffDow: z.number().int().min(0).max(6),
  overtimeMinMinutes: z.number().int().min(0).max(240),
  overtimeStepMinutes: z.number().int().min(1).max(120),
  overtimeRateX100: z.number().int().min(100).max(400),
  overtimeBase: z.enum(["basic_da", "gross"]),
  hoursPerDay: z.number().int().min(4).max(12),
  monthDaysBasis: z.union([z.literal("calendar"), z.literal(26), z.literal(30)]),
  bonusBp: z.number().int().min(0).max(2000),
  encashDivisor: z.number().int().min(20).max(31),
});
const incentiveValue = z.object({
  targetG: z.number().int().min(0).max(1_000_000_000),
  ratePaisePerKg: z.number().int().min(0).max(100_000),
  recoveryFloorBp: z.number().int().min(0).max(10_000),
  rejectPenaltyPaisePerKg: z.number().int().min(0).max(100_000),
});

const settings = router({
  /** The dated plant rules and incentive rule, newest first, with the defaults. */
  get: hrProcedure("hr.view").query(async ({ ctx }) => ({
    rules: await settingHistory(ctx.db, ctx.companyId, "rules"),
    incentive: await settingHistory(ctx.db, ctx.companyId, "incentive"),
    defaults: { rules: DEFAULT_HR_RULES, incentive: DEFAULT_INCENTIVE_RULE },
  })),

  save: hrProcedure("hr.manage")
    .input(z.discriminatedUnion("kind", [z.object({ kind: z.literal("rules"), effectiveFrom: month, value: rulesValue, note: z.string().trim().max(300).nullable().optional() }), z.object({ kind: z.literal("incentive"), effectiveFrom: month, value: incentiveValue, note: z.string().trim().max(300).nullable().optional() })]))
    .mutation(async ({ ctx, input }) => saveDated(ctx, input.kind, input.effectiveFrom, input.value, input.note ?? null)),
});

/** Write the dated row for `effectiveFrom` (replacing that month's row). A locked month's figures never change. */
export async function saveDated(ctx: HrCtx, kind: "rules" | "incentive" | "statutory", effectiveFrom: string, value: Record<string, unknown>, note: string | null) {
  const { payRun } = await import("@orrn/db/schema/hr");
  const [locked] = await ctx.db
    .select({ month: payRun.month })
    .from(payRun)
    .where(and(eq(payRun.companyId, ctx.companyId), eq(payRun.status, "locked")))
    .orderBy(desc(payRun.month))
    .limit(1);
  if (locked && effectiveFrom <= locked.month) throw bad(`The payroll for ${locked.month} is locked; a change can start from the month after`);
  const rowId = crypto.randomUUID();
  await atomicBatch(ctx.db, [
    ctx.db
      .insert(hrSetting)
      .values({ id: rowId, companyId: ctx.companyId, kind, effectiveFrom, value, note, createdBy: ctx.session.user.id })
      .onConflictDoUpdate({ target: [hrSetting.companyId, hrSetting.kind, hrSetting.effectiveFrom], set: { value, note, createdBy: ctx.session.user.id } }),
    audit(ctx, `hr.setting.${kind}`, "hr_setting", `${kind}:${effectiveFrom}`, { kind, effectiveFrom, note }),
  ]);
  return { effectiveFrom };
}

const me = router({
  /** The signed-in person's card: who they are, this month's attendance totals and leave balances. */
  summary: hrProcedure("leave.apply").query(async ({ ctx }) => {
    const person = await myEmployee(ctx);
    const clock = await plantClock(ctx.db, ctx.companyId);
    const sheet = await personMonth(ctx, person.id, clock.today.slice(0, 7));
    const balances = await balancesFor(ctx.db, ctx.companyId, person, Number(clock.today.slice(0, 4)));
    return { person: { id: person.id, code: person.code, name: person.name, joinedOn: person.joinedOn }, today: clock.today, month: sheet.month, totals: sheet.totals, balances };
  }),

  attendance: hrProcedure("leave.apply")
    .input(z.object({ month }))
    .query(async ({ ctx, input }) => {
      const person = await myEmployee(ctx);
      return personMonth(ctx, person.id, input.month);
    }),

  leave: hrProcedure("leave.apply").query(async ({ ctx }) => {
    const person = await myEmployee(ctx);
    return requestRows(ctx, eq(hrLeaveRequest.employeeId, person.id), 100);
  }),

  applyLeave: hrProcedure("leave.apply")
    .input(applyInput)
    .mutation(async ({ ctx, input }) => {
      const person = await myEmployee(ctx);
      return applyLeave(ctx, person, { kindId: input.kindId, from: input.from, to: input.to, halfDay: input.halfDay, reason: input.reason ?? null });
    }),

  cancelLeave: hrProcedure("leave.apply")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const person = await myEmployee(ctx);
      const [row] = await ctx.db
        .select()
        .from(hrLeaveRequest)
        .where(and(eq(hrLeaveRequest.companyId, ctx.companyId), eq(hrLeaveRequest.id, input.id), eq(hrLeaveRequest.employeeId, person.id)))
        .limit(1);
      if (!row) throw notFound();
      if (row.status !== "pending") throw conflict("Only a waiting leave can be cancelled here; ask your supervisor");
      await cancelLeave(ctx, row);
      return { id: input.id };
    }),
});

export const hrMoreRouters = { leave, training, reviews, incentive, settings, me };
