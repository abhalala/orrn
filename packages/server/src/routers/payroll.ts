/**
 * XE parity lane HR, rows 86 (full and final) and 88: payroll (module `payroll`, opt-in, needs `hr`).
 * Every read and write needs both modules and its action; salary figures need `payroll.view`, and the
 * buddy never reaches this router. Salary changes are audited by field and month, never by figure
 * (the audit log is readable with `audit.read`).
 */
import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";

import { hrEmployee, hrSettlement, payAdjustment, payAdjustmentKinds, payRun, paySlip, payStructure } from "@orrn/db/schema/hr";
import {
  bankCsv,
  DEFAULT_STATUTORY_NOTE,
  DEFAULT_STATUTORY_RATES,
  ecrText,
  esicCsv,
  finalSettlement,
  isMonth,
  serviceLength,
  statutoryRatesError,
  type PayLine,
} from "@orrn/domain";

import { router } from "../index";
import { atomicBatch } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { bad, conflict, getEmployee, myEmployee, notFound, ratesFor, rulesFor, settingHistory, type HrCtx } from "../lib/hr/core";
import { payrollProcedure } from "../lib/hr/gate";
import { assertPayMonthOpen, checkRun, computeRun, getRun, lockRun, reopenRun, type SlipFigures } from "../lib/hr/payroll";
import { saveDated } from "./hrMore";

const id = z.string().trim().min(1).max(64);
const month = z.string().refine(isMonth, "Use a month like 2026-11");
const paise = z.number().int().min(0).max(100_000_000_00);
const audit = (ctx: HrCtx, action: string, subjectType: string, subjectId: string, meta: Record<string, unknown>) =>
  auditInsert(ctx as Parameters<typeof auditInsert>[0], { action, subjectType, subjectId, meta });

const structures = router({
  /** A person's salary structures, newest first. */
  list: payrollProcedure("payroll.view")
    .input(z.object({ employeeId: id }))
    .query(async ({ ctx, input }) => {
      await getEmployee(ctx.db, ctx.companyId, input.employeeId);
      return ctx.db.select().from(payStructure).where(and(eq(payStructure.companyId, ctx.companyId), eq(payStructure.employeeId, input.employeeId))).orderBy(desc(payStructure.effectiveFrom)).limit(60);
    }),

  /** The structure in force for everyone this month (the salary register). */
  register: payrollProcedure("payroll.view")
    .input(z.object({ month }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ s: payStructure, code: hrEmployee.code, name: hrEmployee.name, status: hrEmployee.status })
        .from(payStructure)
        .innerJoin(hrEmployee, eq(hrEmployee.id, payStructure.employeeId))
        .where(and(eq(payStructure.companyId, ctx.companyId), lt(payStructure.effectiveFrom, `${input.month}~`)))
        .orderBy(asc(hrEmployee.code), desc(payStructure.effectiveFrom))
        .limit(5000);
      const seen = new Set<string>();
      return rows.filter((r) => (seen.has(r.s.employeeId) ? false : (seen.add(r.s.employeeId), true))).map((r) => ({ ...r.s, code: r.code, name: r.name, status: r.status }));
    }),

  save: payrollProcedure("payroll.run")
    .input(
      z.object({
        employeeId: id,
        effectiveFrom: month,
        basicPaise: paise.refine((v) => v > 0, "Enter the basic"),
        daPaise: paise.default(0),
        hraPaise: paise.default(0),
        otherPaise: paise.default(0),
        perDay: z.boolean().default(false),
        pfMember: z.boolean().default(true),
        pfOnActual: z.boolean().default(false),
        esicMember: z.boolean().default(true),
        esicCovered: z.boolean().nullable().default(null),
        ptApplies: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const person = await getEmployee(ctx.db, ctx.companyId, input.employeeId);
      await assertPayMonthOpen(ctx.db, ctx.companyId, input.effectiveFrom);
      const { employeeId, effectiveFrom, ...figures } = input;
      const rowId = crypto.randomUUID();
      await atomicBatch(ctx.db, [
        ctx.db
          .insert(payStructure)
          .values({ id: rowId, companyId: ctx.companyId, employeeId, effectiveFrom, ...figures, createdBy: ctx.session.user.id })
          .onConflictDoUpdate({ target: [payStructure.companyId, payStructure.employeeId, payStructure.effectiveFrom], set: { ...figures, createdBy: ctx.session.user.id } }),
        // No figures in the audit: the log is readable beyond payroll.view.
        audit(ctx, "payroll.structure.save", "hr_employee", person.id, { code: person.code, effectiveFrom, perDay: input.perDay }),
      ]);
      return { effectiveFrom };
    }),
});

const adjustments = router({
  list: payrollProcedure("payroll.view")
    .input(z.object({ month }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ a: payAdjustment, code: hrEmployee.code, name: hrEmployee.name })
        .from(payAdjustment)
        .innerJoin(hrEmployee, eq(hrEmployee.id, payAdjustment.employeeId))
        .where(and(eq(payAdjustment.companyId, ctx.companyId), eq(payAdjustment.month, input.month)))
        .orderBy(asc(hrEmployee.code))
        .limit(5000);
      return rows.map((r) => ({ ...r.a, code: r.code, name: r.name }));
    }),

  /** A deduction (advance recovery, canteen, other, TDS typed from the CA) or an extra earning for a month. */
  add: payrollProcedure("payroll.run")
    .input(z.object({ employeeId: id, month, kind: z.enum(payAdjustmentKinds), label: z.string().trim().max(60).nullable().optional(), amountPaise: paise.refine((v) => v > 0, "Enter an amount") }))
    .mutation(async ({ ctx, input }) => {
      const person = await getEmployee(ctx.db, ctx.companyId, input.employeeId);
      await assertPayMonthOpen(ctx.db, ctx.companyId, input.month);
      const rowId = crypto.randomUUID();
      await atomicBatch(ctx.db, [
        ctx.db.insert(payAdjustment).values({ id: rowId, companyId: ctx.companyId, employeeId: person.id, month: input.month, kind: input.kind, label: input.label ?? null, amountPaise: input.amountPaise, createdBy: ctx.session.user.id }),
        audit(ctx, "payroll.adjustment.add", "hr_employee", person.id, { code: person.code, month: input.month, kind: input.kind }),
      ]);
      return { id: rowId };
    }),

  remove: payrollProcedure("payroll.run")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(payAdjustment).where(and(eq(payAdjustment.companyId, ctx.companyId), eq(payAdjustment.id, input.id))).limit(1);
      if (!row) throw notFound();
      await assertPayMonthOpen(ctx.db, ctx.companyId, row.month);
      await atomicBatch(ctx.db, [
        ctx.db.delete(payAdjustment).where(and(eq(payAdjustment.companyId, ctx.companyId), eq(payAdjustment.id, input.id))),
        audit(ctx, "payroll.adjustment.remove", "hr_employee", row.employeeId, { month: row.month, kind: row.kind }),
      ]);
      return { id: input.id };
    }),
});

function slipOut(s: typeof paySlip.$inferSelect) {
  return { id: s.id, employeeId: s.employeeId, month: s.month, grossPaise: s.grossPaise, netPaise: s.netPaise, figures: s.figures as unknown as SlipFigures };
}

async function runSlips(ctx: HrCtx, runId: string) {
  return (await ctx.db.select().from(paySlip).where(and(eq(paySlip.companyId, ctx.companyId), eq(paySlip.runId, runId))).limit(5000)).map(slipOut).sort((a, b) => a.figures.person.code.localeCompare(b.figures.person.code));
}

async function fileRun(ctx: HrCtx, runId: string) {
  const run = await getRun(ctx.db, ctx.companyId, runId);
  if (run.status !== "approved" && run.status !== "locked") throw bad("Files are made from an approved run");
  return { run, slips: await runSlips(ctx, runId) };
}

const runs = router({
  list: payrollProcedure("payroll.view").query(({ ctx }) => ctx.db.select().from(payRun).where(eq(payRun.companyId, ctx.companyId)).orderBy(desc(payRun.month)).limit(60)),

  get: payrollProcedure("payroll.view")
    .input(z.object({ month }))
    .query(async ({ ctx, input }) => {
      const [run] = await ctx.db.select().from(payRun).where(and(eq(payRun.companyId, ctx.companyId), eq(payRun.month, input.month))).limit(1);
      if (!run) return { run: null, slips: [] };
      return { run, slips: await runSlips(ctx, run.id) };
    }),

  compute: payrollProcedure("payroll.run")
    .input(z.object({ month }))
    .mutation(({ ctx, input }) => computeRun(ctx, input.month)),

  check: payrollProcedure("payroll.run")
    .input(z.object({ id, version: z.number().int().min(1), note: z.string().trim().max(300).nullable().optional() }))
    .mutation(({ ctx, input }) => checkRun(ctx, input.id, input.version, input.note ?? null)),

  reopen: payrollProcedure("payroll.run")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      await reopenRun(ctx, input.id);
      return { id: input.id };
    }),

  lock: payrollProcedure("payroll.approve")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      await lockRun(ctx, input.id);
      return { id: input.id };
    }),

  slip: payrollProcedure("payroll.view")
    .input(z.object({ runId: id, employeeId: id }))
    .query(async ({ ctx, input }) => {
      const [s] = await ctx.db.select().from(paySlip).where(and(eq(paySlip.companyId, ctx.companyId), eq(paySlip.runId, input.runId), eq(paySlip.employeeId, input.employeeId))).limit(1);
      if (!s) throw notFound();
      return slipOut(s);
    }),
});

const files = router({
  /** Bank transfer sheet (full account numbers, payroll.view only). */
  bank: payrollProcedure("payroll.view")
    .input(z.object({ runId: id }))
    .query(async ({ ctx, input }) => {
      const { run, slips } = await fileRun(ctx, input.runId);
      const people = await ctx.db
        .select({ id: hrEmployee.id, accountNo: hrEmployee.bankAccountNo, ifsc: hrEmployee.bankIfsc })
        .from(hrEmployee)
        .where(eq(hrEmployee.companyId, ctx.companyId))
        .limit(5000);
      const bank = new Map(people.map((p) => [p.id, p]));
      const missing = slips.filter((s) => !bank.get(s.employeeId)?.accountNo).map((s) => s.figures.person.code);
      await atomicBatch(ctx.db, [audit(ctx, "payroll.file.bank", "pay_run", run.id, { month: run.month })]);
      return {
        filename: `bank-${run.month}.csv`,
        csv: bankCsv(slips.filter((s) => bank.get(s.employeeId)?.accountNo && s.netPaise > 0).map((s) => ({ code: s.figures.person.code, name: s.figures.person.name, accountNo: bank.get(s.employeeId)!.accountNo!, ifsc: bank.get(s.employeeId)!.ifsc ?? "", netPaise: s.netPaise }))),
        missing,
      };
    }),

  /** EPFO ECR text (members with a UAN and EPF on their slip). */
  ecr: payrollProcedure("payroll.view")
    .input(z.object({ runId: id }))
    .query(async ({ ctx, input }) => {
      const { run, slips } = await fileRun(ctx, input.runId);
      const pf = slips.filter((s) => s.figures.epf);
      const missing = pf.filter((s) => !s.figures.person.uan).map((s) => s.figures.person.code);
      const rows = pf.filter((s) => s.figures.person.uan).map((s) => ({ uan: s.figures.person.uan!, name: s.figures.person.name, grossPaise: s.grossPaise, epf: s.figures.epf!, ncpDays: s.figures.ncpDays }));
      const adminPaise = pf.reduce((a, s) => a + s.figures.epf!.adminPaise, 0);
      const { value: rates } = await ratesFor(ctx.db, ctx.companyId, run.month);
      return { filename: `ecr-${run.month}.txt`, text: ecrText(rows), missing, members: rows.length, adminPaise: rows.length ? Math.max(500_00, adminPaise) : 0, edliPaise: pf.reduce((a, s) => a + s.figures.epf!.edliPaise, 0), ceilingPaise: rates.epfWageCeilingPaise };
    }),

  /** ESIC monthly contribution sheet (members covered this month). */
  esic: payrollProcedure("payroll.view")
    .input(z.object({ runId: id }))
    .query(async ({ ctx, input }) => {
      const { run, slips } = await fileRun(ctx, input.runId);
      const covered = slips.filter((s) => s.figures.esic?.covered);
      const missing = covered.filter((s) => !s.figures.person.esicIp).map((s) => s.figures.person.code);
      const rows = covered
        .filter((s) => s.figures.person.esicIp)
        .map((s) => {
          const paidDays = Math.floor(s.figures.paidHalves / 2);
          const left = s.figures.person.leftOn && s.figures.person.leftOn.startsWith(run.month) ? s.figures.person.leftOn : null;
          // Reason 2 = left service (the portal's legend; the rest is an owner item to confirm on the portal).
          return { ipNumber: s.figures.person.esicIp!, name: s.figures.person.name, paidDays, wagesPaise: s.figures.esic!.wagesPaise, reasonCode: paidDays === 0 && left ? 2 : 0, lastWorkingDay: left };
        });
      return { filename: `esic-${run.month}.csv`, csv: esicCsv(rows), missing, members: rows.length };
    }),
});

const statutoryValue = z.object({
  epfEmployeeBp: z.number().int(),
  epsEmployerBp: z.number().int(),
  epfWageCeilingPaise: paise,
  edliBp: z.number().int(),
  epfAdminBp: z.number().int(),
  epsMaxAge: z.number().int().min(50).max(70),
  esicEmployeeBp: z.number().int(),
  esicEmployerBp: z.number().int(),
  esicWageCeilingPaise: paise,
  esicEmployeeExemptDailyPaise: paise,
  ptState: z.string().trim().min(2).max(4),
  ptSlabs: z.array(z.object({ fromPaise: paise, monthlyPaise: paise })).min(1).max(12),
  bonusEligibleCeilingPaise: paise,
  bonusCalcCeilingPaise: paise,
  bonusMinBp: z.number().int(),
  bonusMaxBp: z.number().int(),
  gratuityMinYears: z.number().int().min(1).max(10),
  gratuityCeilingPaise: paise,
});

const settings = router({
  /** Statutory rates, dated, with the defaults and their source note. */
  get: payrollProcedure("payroll.view").query(async ({ ctx }) => ({
    statutory: await settingHistory(ctx.db, ctx.companyId, "statutory"),
    defaults: DEFAULT_STATUTORY_RATES,
    defaultNote: DEFAULT_STATUTORY_NOTE,
  })),

  save: payrollProcedure("payroll.run")
    .input(z.object({ effectiveFrom: month, value: statutoryValue, note: z.string().trim().min(1, "Say where the figures come from").max(500) }))
    .mutation(async ({ ctx, input }) => {
      const error = statutoryRatesError(input.value);
      if (error) throw bad(error === "eps_over_epf" ? "The EPS rate cannot be above the EPF rate" : error === "bonus_range" ? "The bonus minimum cannot be above the maximum" : error === "pt_slabs" ? "Check the professional tax slabs" : "A rate is out of range");
      return saveDated(ctx, "statutory", input.effectiveFrom, input.value as unknown as Record<string, unknown>, input.note);
    }),
});

const settlement = router({
  get: payrollProcedure("payroll.view")
    .input(z.object({ employeeId: id }))
    .query(async ({ ctx, input }) => {
      await getEmployee(ctx.db, ctx.companyId, input.employeeId);
      const [row] = await ctx.db.select().from(hrSettlement).where(and(eq(hrSettlement.companyId, ctx.companyId), eq(hrSettlement.employeeId, input.employeeId))).limit(1);
      return row ?? null;
    }),

  /** Work out (or work out again) a draft full and final for a person who left. */
  compute: payrollProcedure("payroll.run")
    .input(
      z.object({
        employeeId: id,
        unpaidHalves: z.number().int().min(0).max(124),
        encashHalves: z.number().int().min(0).max(730),
        recoveries: z.array(z.object({ label: z.string().trim().min(1).max(60), paise })).max(20).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const person = await getEmployee(ctx.db, ctx.companyId, input.employeeId);
      if (person.status !== "left" || !person.leftOn) throw bad("Full and final is for a person who has left; enter the leaving first");
      const [had] = await ctx.db.select().from(hrSettlement).where(and(eq(hrSettlement.companyId, ctx.companyId), eq(hrSettlement.employeeId, person.id))).limit(1);
      if (had?.status === "final") throw conflict("This full and final is already final");
      const leftMonth = person.leftOn.slice(0, 7);
      const [st] = await ctx.db
        .select()
        .from(payStructure)
        .where(and(eq(payStructure.companyId, ctx.companyId), eq(payStructure.employeeId, person.id), lt(payStructure.effectiveFrom, `${leftMonth}~`)))
        .orderBy(desc(payStructure.effectiveFrom))
        .limit(1);
      if (!st) throw bad("This person has no salary structure");
      const { value: rules } = await rulesFor(ctx.db, ctx.companyId, leftMonth);
      const { value: rates } = await ratesFor(ctx.db, ctx.companyId, leftMonth);
      const monthDays = rules.monthDaysBasis === "calendar" ? 30 : rules.monthDaysBasis;
      const fullBasicDa = st.perDay ? (st.basicPaise + st.daPaise) * monthDays : st.basicPaise + st.daPaise;
      const fullGross = st.perDay ? (st.basicPaise + st.daPaise + st.hraPaise + st.otherPaise) * monthDays : st.basicPaise + st.daPaise + st.hraPaise + st.otherPaise;
      // Bonus due: this financial year's accruals on the person's approved and locked slips.
      const [y, m] = leftMonth.split("-").map(Number) as [number, number];
      const fyStart = m >= 4 ? `${y}-04` : `${y - 1}-04`;
      const slips = await ctx.db
        .select({ figures: paySlip.figures })
        .from(paySlip)
        .innerJoin(payRun, eq(payRun.id, paySlip.runId))
        .where(and(eq(paySlip.companyId, ctx.companyId), eq(paySlip.employeeId, person.id), gte(paySlip.month, fyStart), inArray(payRun.status, ["approved", "locked"])))
        .limit(24);
      const bonusDue = slips.reduce((a, s) => a + Number((s.figures as { bonusAccrualPaise?: number }).bonusAccrualPaise ?? 0), 0);
      const recoveries: PayLine[] = input.recoveries.map((r) => ({ code: "recovery", label: r.label, paise: r.paise }));
      const service = serviceLength(person.joinedOn, person.leftOn);
      const f = finalSettlement({
        unpaidSalaryPaise: Math.round((fullGross * input.unpaidHalves) / 2 / monthDays),
        encashHalves: input.encashHalves,
        fullBasicDaPaise: fullBasicDa,
        divisor: rules.encashDivisor,
        service,
        bonusDuePaise: bonusDue,
        recoveries,
        rates,
      });
      const figures = { ...f, service, person: { code: person.code, name: person.name, joinedOn: person.joinedOn, leftOn: person.leftOn, reason: person.leavingReason }, inputs: { unpaidHalves: input.unpaidHalves, encashHalves: input.encashHalves }, fullBasicDaPaise: fullBasicDa, encashDivisor: rules.encashDivisor };
      const rowId = had?.id ?? crypto.randomUUID();
      await atomicBatch(ctx.db, [
        had
          ? ctx.db.update(hrSettlement).set({ netPaise: f.netPaise, figures: figures as unknown as Record<string, unknown> }).where(and(eq(hrSettlement.companyId, ctx.companyId), eq(hrSettlement.id, had.id), eq(hrSettlement.status, "draft")))
          : ctx.db.insert(hrSettlement).values({ id: rowId, companyId: ctx.companyId, employeeId: person.id, status: "draft", netPaise: f.netPaise, figures: figures as unknown as Record<string, unknown>, createdBy: ctx.session.user.id }),
        audit(ctx, "payroll.settlement.compute", "hr_employee", person.id, { code: person.code }),
      ]);
      return { id: rowId, netPaise: f.netPaise };
    }),

  finalize: payrollProcedure("payroll.approve")
    .input(z.object({ employeeId: id }))
    .mutation(async ({ ctx, input }) => {
      const person = await getEmployee(ctx.db, ctx.companyId, input.employeeId);
      const [had] = await ctx.db.select().from(hrSettlement).where(and(eq(hrSettlement.companyId, ctx.companyId), eq(hrSettlement.employeeId, person.id))).limit(1);
      if (!had) throw notFound();
      if (had.status === "final") throw conflict("This full and final is already final");
      if (had.createdBy === ctx.session.user.id) throw bad("The person who worked it out cannot make it final; ask a manager");
      await atomicBatch(ctx.db, [
        ctx.db.update(hrSettlement).set({ status: "final" }).where(and(eq(hrSettlement.companyId, ctx.companyId), eq(hrSettlement.id, had.id), eq(hrSettlement.status, "draft"))),
        audit(ctx, "payroll.settlement.final", "hr_employee", person.id, { code: person.code }),
      ]);
      return { id: had.id };
    }),
});

const me = router({
  /** The signed-in person's own payslips, from locked months only. */
  payslips: payrollProcedure("leave.apply").query(async ({ ctx }) => {
    const person = await myEmployee(ctx);
    const rows = await ctx.db
      .select({ s: paySlip })
      .from(paySlip)
      .innerJoin(payRun, eq(payRun.id, paySlip.runId))
      .where(and(eq(paySlip.companyId, ctx.companyId), eq(paySlip.employeeId, person.id), eq(payRun.status, "locked")))
      .orderBy(desc(paySlip.month))
      .limit(36);
    return rows.map((r) => slipOut(r.s));
  }),
});

export const payrollRouter = router({ structures, adjustments, runs, files, settings, settlement, me });

