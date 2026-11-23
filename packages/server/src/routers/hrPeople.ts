/**
 * XE parity lane HR, row 86: the people register, joining and leaving checklists, recruitment and the
 * retirement list. Spread into `hr` (routers/hr.ts). Bank numbers are masked in every read here; the full
 * number reaches only the bank sheet (payroll.view). PAN and Aadhaar keep their last four only.
 */
import { and, asc, eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";

import { plantMaster } from "@orrn/db/schema/admin";
import { hrCandidate, hrCandidateStages, hrChecklistItem, hrChecklistKinds, hrChecklistTick, hrEmployee, hrEmploymentKinds, hrOpening, hrRoster } from "@orrn/db/schema/hr";
import { membership } from "@orrn/db/schema/tenant";
import { isYmd, lastFour, maskAccount, retiringWithin } from "@orrn/domain";

import { router } from "../index";
import { atomicBatch } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { isUniqueOn } from "../lib/ageing";
import { bad, conflict, getEmployee, notFound, plantClock, rulesFor, type HrCtx } from "../lib/hr/core";
import { hrProcedure } from "../lib/hr/gate";

const id = z.string().trim().min(1).max(64);
const ymd = z.string().refine(isYmd, "Use a date like 2026-11-03");
const optText = (max: number) => z.string().trim().max(max).nullable().optional();
const audit = (ctx: HrCtx, action: string, subjectType: string, subjectId: string, meta: Record<string, unknown>) =>
  auditInsert(ctx as Parameters<typeof auditInsert>[0], { action, subjectType, subjectId, meta });

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const personInput = z.object({
  code: z.string().trim().min(1).max(16).transform((v) => v.toUpperCase()),
  name: z.string().trim().min(1).max(80),
  departmentId: id.nullable().optional(),
  designationId: id.nullable().optional(),
  joinedOn: ymd,
  dob: ymd.nullable().optional(),
  kind: z.enum(hrEmploymentKinds).default("permanent"),
  contractorName: optText(80),
  phone: z.string().trim().max(16).regex(/^[0-9+ -]*$/, "Use digits for the phone").nullable().optional(),
  membershipId: id.nullable().optional(),
  userId: id.nullable().optional(),
  deviceCode: z.string().trim().max(32).regex(/^[A-Za-z0-9_-]*$/).nullable().optional(),
  shiftId: z.string().trim().max(64).nullable().optional(),
  weeklyOffDow: z.number().int().min(0).max(6).nullable().optional(),
  bankName: optText(60),
  /** Omit to keep the stored number; null clears it. */
  bankAccountNo: z.string().trim().max(24).regex(/^[0-9 ]*$/, "Use digits for the account number").nullable().optional(),
  bankIfsc: z.string().trim().max(11).transform((v) => v.toUpperCase()).nullable().optional(),
  /** Typed in full or in part; only the last four are kept. */
  pan: z.string().trim().max(10).nullable().optional(),
  aadhaar: z.string().trim().max(14).nullable().optional(),
  uan: z.string().trim().max(12).regex(/^[0-9]*$/, "The UAN is 12 digits").nullable().optional(),
  esicIp: z.string().trim().max(10).regex(/^[0-9]*$/, "The ESIC number is 10 digits").nullable().optional(),
});

const blank = (v: string | null | undefined) => (v === undefined ? undefined : v === null || v === "" ? null : v);

async function checkLinks(ctx: HrCtx, input: z.infer<typeof personInput>) {
  const masterIds = [input.departmentId, input.designationId].filter((v): v is string => !!v);
  if (masterIds.length) {
    const rows = await ctx.db
      .select({ id: plantMaster.id, kind: plantMaster.kind })
      .from(plantMaster)
      .where(and(eq(plantMaster.companyId, ctx.companyId), inArray(plantMaster.id, masterIds)));
    if (input.departmentId && rows.find((r) => r.id === input.departmentId)?.kind !== "department") throw bad("Pick a department from the plant list");
    if (input.designationId && rows.find((r) => r.id === input.designationId)?.kind !== "designation") throw bad("Pick a designation from the plant list");
  }
  if (input.membershipId) {
    const [m] = await ctx.db.select({ id: membership.id }).from(membership).where(and(eq(membership.companyId, ctx.companyId), eq(membership.id, input.membershipId))).limit(1);
    if (!m) throw bad("That sign-in is not a member of this plant");
  }
  if (input.userId) {
    const [m] = await ctx.db.select({ id: membership.id }).from(membership).where(and(eq(membership.companyId, ctx.companyId), eq(membership.userId, input.userId))).limit(1);
    if (!m) throw bad("That press operator is not a member of this plant");
  }
  if (input.bankIfsc && !IFSC.test(input.bankIfsc)) throw bad("The IFSC is 11 characters, like SBIN0001234");
  if (input.uan && input.uan.length !== 12) throw bad("The UAN is 12 digits");
  if (input.esicIp && input.esicIp.length !== 10) throw bad("The ESIC number is 10 digits");
  if (input.dob && input.dob >= input.joinedOn) throw bad("The date of birth must be before joining");
}

function personValues(input: z.infer<typeof personInput>) {
  const v: Partial<typeof hrEmployee.$inferInsert> = {
    code: input.code,
    name: input.name,
    departmentId: input.departmentId ?? null,
    designationId: input.designationId ?? null,
    joinedOn: input.joinedOn,
    dob: input.dob ?? null,
    kind: input.kind,
    contractorName: input.kind === "contract" ? (blank(input.contractorName) ?? null) : null,
    phone: blank(input.phone) ?? null,
    membershipId: input.membershipId ?? null,
    userId: input.userId ?? null,
    deviceCode: blank(input.deviceCode) ?? null,
    shiftId: blank(input.shiftId) ?? null,
    weeklyOffDow: input.weeklyOffDow ?? null,
    bankName: blank(input.bankName) ?? null,
    bankIfsc: blank(input.bankIfsc) ?? null,
    uan: blank(input.uan) ?? null,
    esicIp: blank(input.esicIp) ?? null,
  };
  if (input.bankAccountNo !== undefined) v.bankAccountNo = input.bankAccountNo ? input.bankAccountNo.replace(/\s+/g, "") : null;
  if (input.pan !== undefined) v.panLast4 = lastFour(input.pan);
  if (input.aadhaar !== undefined) v.aadhaarLast4 = lastFour(input.aadhaar);
  return v;
}

/** What a list or a card shows: the bank number masked. */
function shown(r: typeof hrEmployee.$inferSelect, names: Map<string, string>) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    departmentId: r.departmentId,
    department: r.departmentId ? (names.get(r.departmentId) ?? null) : null,
    designationId: r.designationId,
    designation: r.designationId ? (names.get(r.designationId) ?? null) : null,
    joinedOn: r.joinedOn,
    dob: r.dob,
    kind: r.kind,
    contractorName: r.contractorName,
    phone: r.phone,
    membershipId: r.membershipId,
    userId: r.userId,
    deviceCode: r.deviceCode,
    shiftId: r.shiftId,
    weeklyOffDow: r.weeklyOffDow,
    bankName: r.bankName,
    bankAccountMasked: maskAccount(r.bankAccountNo),
    bankIfsc: r.bankIfsc,
    panLast4: r.panLast4,
    aadhaarLast4: r.aadhaarLast4,
    uan: r.uan,
    esicIp: r.esicIp,
    status: r.status,
    leftOn: r.leftOn,
    leavingReason: r.leavingReason,
  };
}

async function masterNames(ctx: HrCtx, ids: (string | null)[]) {
  const list = [...new Set(ids.filter((v): v is string => !!v))];
  if (!list.length) return new Map<string, string>();
  const rows = await ctx.db.select({ id: plantMaster.id, name: plantMaster.name }).from(plantMaster).where(and(eq(plantMaster.companyId, ctx.companyId), inArray(plantMaster.id, list.slice(0, 90))));
  return new Map(rows.map((r) => [r.id, r.name]));
}

const people = router({
  list: hrProcedure("hr.view")
    .input(
      z
        .object({
          status: z.enum(["active", "left", "all"]).default("active"),
          q: z.string().trim().max(60).optional(),
          departmentId: id.optional(),
          limit: z.number().int().min(1).max(200).default(100),
          offset: z.number().int().min(0).default(0),
        })
        .default({ status: "active", limit: 100, offset: 0 }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(hrEmployee.companyId, ctx.companyId),
        input.status === "all" ? undefined : eq(hrEmployee.status, input.status),
        input.departmentId ? eq(hrEmployee.departmentId, input.departmentId) : undefined,
        input.q ? or(like(hrEmployee.name, `%${input.q}%`), like(hrEmployee.code, `%${input.q.toUpperCase()}%`)) : undefined,
      );
      const rows = await ctx.db.select().from(hrEmployee).where(where).orderBy(asc(hrEmployee.name)).limit(input.limit).offset(input.offset);
      const [{ n } = { n: 0 }] = await ctx.db.select({ n: sql<number>`count(*)` }).from(hrEmployee).where(where);
      const names = await masterNames(ctx, rows.flatMap((r) => [r.departmentId, r.designationId]));
      return { items: rows.map((r) => shown(r, names)), total: Number(n) };
    }),

  get: hrProcedure("hr.view")
    .input(z.object({ id }))
    .query(async ({ ctx, input }) => {
      const r = await getEmployee(ctx.db, ctx.companyId, input.id);
      const names = await masterNames(ctx, [r.departmentId, r.designationId]);
      return shown(r, names);
    }),

  /** Active people for pickers (attendance, roster, leave, training): code, name, default shift. */
  options: hrProcedure("hr.view", "attendance.mark", "leave.approve")
    .input(z.object({ includeLeft: z.boolean().default(false) }).default({ includeLeft: false }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ id: hrEmployee.id, code: hrEmployee.code, name: hrEmployee.name, shiftId: hrEmployee.shiftId, status: hrEmployee.status, kind: hrEmployee.kind })
        .from(hrEmployee)
        .where(and(eq(hrEmployee.companyId, ctx.companyId), input.includeLeft ? undefined : eq(hrEmployee.status, "active")))
        .orderBy(asc(hrEmployee.name))
        .limit(1000);
      return rows;
    }),

  create: hrProcedure("hr.manage")
    .input(personInput)
    .mutation(async ({ ctx, input }) => {
      await checkLinks(ctx, input);
      const rowId = crypto.randomUUID();
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(hrEmployee).values({ id: rowId, companyId: ctx.companyId, createdBy: ctx.session.user.id, ...personValues(input) } as typeof hrEmployee.$inferInsert),
          audit(ctx, "hr.person.create", "hr_employee", rowId, { code: input.code, name: input.name, kind: input.kind }),
        ]);
      } catch (e) {
        throw uniqueRefusal(e) ?? e;
      }
      return { id: rowId };
    }),

  update: hrProcedure("hr.manage")
    .input(personInput.extend({ id }))
    .mutation(async ({ ctx, input }) => {
      const had = await getEmployee(ctx.db, ctx.companyId, input.id);
      await checkLinks(ctx, input);
      const values = personValues(input);
      const changed = Object.keys(values).filter((k) => (values as Record<string, unknown>)[k] !== (had as Record<string, unknown>)[k]);
      try {
        await atomicBatch(ctx.db, [
          ctx.db.update(hrEmployee).set(values).where(and(eq(hrEmployee.companyId, ctx.companyId), eq(hrEmployee.id, input.id))),
          // Field names only: bank, PAN and Aadhaar values never go into the audit log.
          audit(ctx, "hr.person.update", "hr_employee", input.id, { code: input.code, changed }),
        ]);
      } catch (e) {
        throw uniqueRefusal(e) ?? e;
      }
      return { id: input.id };
    }),

  /** Leaving: a date and a reason. Attendance and the roster close from the next day. */
  leave: hrProcedure("hr.manage")
    .input(z.object({ id, leftOn: ymd, reason: z.string().trim().min(1).max(300) }))
    .mutation(async ({ ctx, input }) => {
      const had = await getEmployee(ctx.db, ctx.companyId, input.id);
      if (had.status === "left") throw conflict("This person has already left");
      if (input.leftOn < had.joinedOn) throw bad("The leaving date cannot be before joining");
      await atomicBatch(ctx.db, [
        ctx.db
          .update(hrEmployee)
          .set({ status: "left", leftOn: input.leftOn, leavingReason: input.reason })
          .where(and(eq(hrEmployee.companyId, ctx.companyId), eq(hrEmployee.id, input.id), eq(hrEmployee.status, "active"))),
        ctx.db.delete(hrRoster).where(and(eq(hrRoster.companyId, ctx.companyId), eq(hrRoster.employeeId, input.id), sql`${hrRoster.day} > ${input.leftOn}`)),
        audit(ctx, "hr.person.leave", "hr_employee", input.id, { code: had.code, leftOn: input.leftOn, reason: input.reason }),
      ]);
      return { id: input.id };
    }),

  /** Undo a leaving entered by mistake (before full and final). */
  rejoin: hrProcedure("hr.manage")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const had = await getEmployee(ctx.db, ctx.companyId, input.id);
      if (had.status !== "left") throw conflict("This person has not left");
      await atomicBatch(ctx.db, [
        ctx.db.update(hrEmployee).set({ status: "active", leftOn: null, leavingReason: null }).where(and(eq(hrEmployee.companyId, ctx.companyId), eq(hrEmployee.id, input.id))),
        audit(ctx, "hr.person.rejoin", "hr_employee", input.id, { code: had.code }),
      ]);
      return { id: input.id };
    }),

  /** People who reach the retirement age in the next `days` days (default 90). */
  retiring: hrProcedure("hr.view")
    .input(z.object({ days: z.number().int().min(1).max(366).default(90) }).default({ days: 90 }))
    .query(async ({ ctx, input }) => {
      const clock = await plantClock(ctx.db, ctx.companyId);
      const { value: rules } = await rulesFor(ctx.db, ctx.companyId, clock.today.slice(0, 7));
      const rows = await ctx.db
        .select({ id: hrEmployee.id, code: hrEmployee.code, name: hrEmployee.name, dob: hrEmployee.dob })
        .from(hrEmployee)
        .where(and(eq(hrEmployee.companyId, ctx.companyId), eq(hrEmployee.status, "active")))
        .limit(2000);
      const items = rows
        .map((r) => ({ id: r.id, code: r.code, name: r.name, retiresOn: retiringWithin(r.dob, rules.retirementAge, clock.today, input.days) }))
        .filter((r): r is typeof r & { retiresOn: string } => r.retiresOn !== null)
        .sort((a, b) => a.retiresOn.localeCompare(b.retiresOn));
      return { retirementAge: rules.retirementAge, items };
    }),
});

function uniqueRefusal(e: unknown) {
  if (!isUniqueOn(e, "hr_employee")) return null;
  const m = String((e as Error)?.message ?? "") + String((e as { cause?: Error })?.cause?.message ?? "");
  if (m.includes("user_id")) return conflict("That press operator is already linked to another person");
  if (m.includes("membership_id")) return conflict("That sign-in is already linked to another person");
  if (m.includes("device_code")) return conflict("That device number is already used by another person");
  return conflict("That code is already used by another person");
}

const checklists = router({
  items: hrProcedure("hr.view")
    .input(z.object({ kind: z.enum(hrChecklistKinds) }))
    .query(({ ctx, input }) =>
      ctx.db
        .select()
        .from(hrChecklistItem)
        .where(and(eq(hrChecklistItem.companyId, ctx.companyId), eq(hrChecklistItem.kind, input.kind)))
        .orderBy(asc(hrChecklistItem.sortOrder), asc(hrChecklistItem.createdAt))
        .limit(100),
    ),

  saveItem: hrProcedure("hr.manage")
    .input(z.object({ id: id.optional(), kind: z.enum(hrChecklistKinds), label: z.string().trim().min(1).max(120), sortOrder: z.number().int().min(0).max(999).default(0), active: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      const rowId = input.id ?? crypto.randomUUID();
      if (input.id) {
        const [had] = await ctx.db.select({ id: hrChecklistItem.id }).from(hrChecklistItem).where(and(eq(hrChecklistItem.companyId, ctx.companyId), eq(hrChecklistItem.id, input.id))).limit(1);
        if (!had) throw notFound();
      }
      await atomicBatch(ctx.db, [
        input.id
          ? ctx.db.update(hrChecklistItem).set({ label: input.label, sortOrder: input.sortOrder, active: input.active }).where(and(eq(hrChecklistItem.companyId, ctx.companyId), eq(hrChecklistItem.id, input.id)))
          : ctx.db.insert(hrChecklistItem).values({ id: rowId, companyId: ctx.companyId, kind: input.kind, label: input.label, sortOrder: input.sortOrder, active: input.active }),
        audit(ctx, "hr.checklist.save", "hr_checklist_item", rowId, { kind: input.kind, label: input.label, active: input.active }),
      ]);
      return { id: rowId };
    }),

  /** A person's joining or leaving checklist: every live item and whether it is ticked. */
  forPerson: hrProcedure("hr.view")
    .input(z.object({ employeeId: id, kind: z.enum(hrChecklistKinds) }))
    .query(async ({ ctx, input }) => {
      await getEmployee(ctx.db, ctx.companyId, input.employeeId);
      const items = await ctx.db
        .select()
        .from(hrChecklistItem)
        .where(and(eq(hrChecklistItem.companyId, ctx.companyId), eq(hrChecklistItem.kind, input.kind), eq(hrChecklistItem.active, true)))
        .orderBy(asc(hrChecklistItem.sortOrder))
        .limit(100);
      const ticks = await ctx.db
        .select()
        .from(hrChecklistTick)
        .where(and(eq(hrChecklistTick.companyId, ctx.companyId), eq(hrChecklistTick.employeeId, input.employeeId)))
        .limit(200);
      const byItem = new Map(ticks.map((t) => [t.itemId, t]));
      return items.map((i) => ({ itemId: i.id, label: i.label, done: byItem.has(i.id), doneAt: byItem.get(i.id)?.doneAt ?? null }));
    }),

  tick: hrProcedure("hr.manage")
    .input(z.object({ employeeId: id, itemId: id, done: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await getEmployee(ctx.db, ctx.companyId, input.employeeId);
      const [item] = await ctx.db.select({ id: hrChecklistItem.id, label: hrChecklistItem.label }).from(hrChecklistItem).where(and(eq(hrChecklistItem.companyId, ctx.companyId), eq(hrChecklistItem.id, input.itemId))).limit(1);
      if (!item) throw notFound();
      await atomicBatch(ctx.db, [
        input.done
          ? ctx.db.insert(hrChecklistTick).values({ id: crypto.randomUUID(), companyId: ctx.companyId, employeeId: input.employeeId, itemId: input.itemId, doneBy: ctx.session.user.id }).onConflictDoNothing()
          : ctx.db.delete(hrChecklistTick).where(and(eq(hrChecklistTick.companyId, ctx.companyId), eq(hrChecklistTick.employeeId, input.employeeId), eq(hrChecklistTick.itemId, input.itemId))),
        audit(ctx, "hr.checklist.tick", "hr_employee", input.employeeId, { item: item.label, done: input.done }),
      ]);
      return { done: input.done };
    }),
});

const recruitment = router({
  openings: hrProcedure("hr.view")
    .input(z.object({ status: z.enum(["open", "closed", "all"]).default("open") }).default({ status: "open" }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(hrOpening)
        .where(and(eq(hrOpening.companyId, ctx.companyId), input.status === "all" ? undefined : eq(hrOpening.status, input.status)))
        .orderBy(asc(hrOpening.createdAt))
        .limit(200);
      const counts = rows.length
        ? await ctx.db
            .select({ openingId: hrCandidate.openingId, stage: hrCandidate.stage, n: sql<number>`count(*)` })
            .from(hrCandidate)
            .where(eq(hrCandidate.companyId, ctx.companyId))
            .groupBy(hrCandidate.openingId, hrCandidate.stage)
        : [];
      return rows.map((r) => ({ ...r, candidates: counts.filter((c) => c.openingId === r.id).reduce((a, c) => a + Number(c.n), 0), joined: Number(counts.find((c) => c.openingId === r.id && c.stage === "joined")?.n ?? 0) }));
    }),

  saveOpening: hrProcedure("hr.manage")
    .input(z.object({ id: id.optional(), title: z.string().trim().min(1).max(80), departmentId: id.nullable().optional(), positions: z.number().int().min(1).max(500).default(1), status: z.enum(["open", "closed"]).default("open"), note: optText(500) }))
    .mutation(async ({ ctx, input }) => {
      const rowId = input.id ?? crypto.randomUUID();
      if (input.id) {
        const [had] = await ctx.db.select({ id: hrOpening.id }).from(hrOpening).where(and(eq(hrOpening.companyId, ctx.companyId), eq(hrOpening.id, input.id))).limit(1);
        if (!had) throw notFound();
      }
      if (input.departmentId) {
        const [d] = await ctx.db.select({ kind: plantMaster.kind }).from(plantMaster).where(and(eq(plantMaster.companyId, ctx.companyId), eq(plantMaster.id, input.departmentId))).limit(1);
        if (d?.kind !== "department") throw bad("Pick a department from the plant list");
      }
      const values = { title: input.title, departmentId: input.departmentId ?? null, positions: input.positions, status: input.status, note: input.note ?? null };
      await atomicBatch(ctx.db, [
        input.id
          ? ctx.db.update(hrOpening).set(values).where(and(eq(hrOpening.companyId, ctx.companyId), eq(hrOpening.id, input.id)))
          : ctx.db.insert(hrOpening).values({ id: rowId, companyId: ctx.companyId, createdBy: ctx.session.user.id, ...values }),
        audit(ctx, "hr.opening.save", "hr_opening", rowId, { title: input.title, status: input.status }),
      ]);
      return { id: rowId };
    }),

  candidates: hrProcedure("hr.view")
    .input(z.object({ openingId: id }))
    .query(async ({ ctx, input }) =>
      ctx.db
        .select()
        .from(hrCandidate)
        .where(and(eq(hrCandidate.companyId, ctx.companyId), eq(hrCandidate.openingId, input.openingId)))
        .orderBy(asc(hrCandidate.createdAt))
        .limit(500),
    ),

  saveCandidate: hrProcedure("hr.manage")
    .input(z.object({ id: id.optional(), openingId: id, name: z.string().trim().min(1).max(80), phone: z.string().trim().max(16).nullable().optional(), stage: z.enum(hrCandidateStages).default("applied"), notes: optText(1000) }))
    .mutation(async ({ ctx, input }) => {
      const [o] = await ctx.db.select({ id: hrOpening.id }).from(hrOpening).where(and(eq(hrOpening.companyId, ctx.companyId), eq(hrOpening.id, input.openingId))).limit(1);
      if (!o) throw notFound();
      const rowId = input.id ?? crypto.randomUUID();
      if (input.id) {
        const [had] = await ctx.db.select({ id: hrCandidate.id }).from(hrCandidate).where(and(eq(hrCandidate.companyId, ctx.companyId), eq(hrCandidate.id, input.id))).limit(1);
        if (!had) throw notFound();
      }
      const values = { name: input.name, phone: input.phone ?? null, stage: input.stage, notes: input.notes ?? null };
      await atomicBatch(ctx.db, [
        input.id
          ? ctx.db.update(hrCandidate).set(values).where(and(eq(hrCandidate.companyId, ctx.companyId), eq(hrCandidate.id, input.id)))
          : ctx.db.insert(hrCandidate).values({ id: rowId, companyId: ctx.companyId, openingId: input.openingId, ...values }),
        audit(ctx, "hr.candidate.save", "hr_candidate", rowId, { stage: input.stage }),
      ]);
      return { id: rowId };
    }),
});

export const hrPeopleRouters = { people, checklists, recruitment };
