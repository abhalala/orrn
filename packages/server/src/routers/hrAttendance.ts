/**
 * XE parity lane HR, rows 87 and 93: holidays, the weekly roster, daily attendance (a supervisor marks a
 * whole shift on one phone screen), the monthly timesheet, biometric devices and punch import. Spread into
 * `hr` (routers/hr.ts). The server computes worked and overtime minutes from the shift; clients send
 * only times and a status. A day older than yesterday is a late entry: `attendance.manage` only, the
 * true time kept in `marked_at`. A locked payroll month never changes.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";

import type { CompanyRole } from "@orrn/db/schema/tenant";
import { hrAttendance, hrAttendanceStatuses, hrDevice, hrEmployee, hrHoliday, hrRoster, payRun } from "@orrn/db/schema/hr";
import {
  addDaysYmd,
  attendanceFigures,
  daysOfMonth,
  isMonth,
  isYmd,
  parsePunchFile,
  PUNCH_FILE_MAX_ROWS,
  shiftLengthMin,
  timesheet,
  weekStart,
  type PunchColumnMap,
} from "@orrn/domain";

import { router } from "../index";
import { atomicBatch, pushChunkedInserts, type SqliteBatchItem } from "../lib/atomic";
import { auditInsert } from "../lib/audit";
import { isUniqueOn } from "../lib/ageing";
import { now } from "../lib/clock";
import { bad, conflict, getEmployee, holidaySet, notFound, plantClock, rulesFor, utcOf, type HrCtx, type PlantClock } from "../lib/hr/core";
import { hrProcedure } from "../lib/hr/gate";
import { fileToUtc, importPunches, sha256Hex } from "../lib/hr/punches";
import { can } from "../lib/permissions";

const id = z.string().trim().min(1).max(64);
const ymd = z.string().refine(isYmd, "Use a date like 2026-11-03");
const month = z.string().refine(isMonth, "Use a month like 2026-11");
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 07:30");
const audit = (ctx: HrCtx, action: string, subjectType: string, subjectId: string, meta: Record<string, unknown>) =>
  auditInsert(ctx as Parameters<typeof auditInsert>[0], { action, subjectType, subjectId, meta });

const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export async function assertMonthOpen(ctx: HrCtx, monthKey: string) {
  const [run] = await ctx.db.select({ status: payRun.status }).from(payRun).where(and(eq(payRun.companyId, ctx.companyId), eq(payRun.month, monthKey))).limit(1);
  if (run?.status === "locked") throw bad(`The payroll for ${monthKey} is locked; corrections go in the next month`);
}

/** Who may write attendance for `day`: today and yesterday with attendance.mark, older with attendance.manage (a late entry). */
export function lateEntryFor(ctx: { role: CompanyRole | null }, clock: PlantClock, day: string): boolean {
  if (day > clock.today) throw bad("Attendance cannot be marked for a day that has not come");
  const late = day < addDaysYmd(clock.today, -1);
  if (late && !(ctx.role && can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "attendance.manage"))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Only a manager or the office can correct a day older than yesterday" });
  }
  return late;
}

const holidays = router({
  list: hrProcedure("hr.view", "attendance.mark", "leave.apply")
    .input(z.object({ year: z.number().int().min(2000).max(2100) }))
    .query(({ ctx, input }) =>
      ctx.db
        .select({ id: hrHoliday.id, day: hrHoliday.day, name: hrHoliday.name })
        .from(hrHoliday)
        .where(and(eq(hrHoliday.companyId, ctx.companyId), gte(hrHoliday.day, `${input.year}-01-01`), lte(hrHoliday.day, `${input.year}-12-31`)))
        .orderBy(asc(hrHoliday.day))
        .limit(100),
    ),

  save: hrProcedure("hr.manage")
    .input(z.object({ day: ymd, name: z.string().trim().min(1).max(60) }))
    .mutation(async ({ ctx, input }) => {
      const rowId = crypto.randomUUID();
      try {
        await atomicBatch(ctx.db, [
          ctx.db.insert(hrHoliday).values({ id: rowId, companyId: ctx.companyId, day: input.day, name: input.name }),
          audit(ctx, "hr.holiday.save", "hr_holiday", rowId, { day: input.day, name: input.name }),
        ]);
      } catch (e) {
        if (isUniqueOn(e, "hr_holiday")) throw conflict(`${input.day} is already a holiday`);
        throw e;
      }
      return { id: rowId };
    }),

  remove: hrProcedure("hr.manage")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const [had] = await ctx.db.select().from(hrHoliday).where(and(eq(hrHoliday.companyId, ctx.companyId), eq(hrHoliday.id, input.id))).limit(1);
      if (!had) throw notFound();
      await atomicBatch(ctx.db, [
        ctx.db.delete(hrHoliday).where(and(eq(hrHoliday.companyId, ctx.companyId), eq(hrHoliday.id, input.id))),
        audit(ctx, "hr.holiday.remove", "hr_holiday", input.id, { day: had.day, name: had.name }),
      ]);
      return { id: input.id };
    }),
});

const roster = router({
  /** A week from Monday: every active person, their default shift and the day x shift cells set. */
  week: hrProcedure("hr.view", "attendance.mark")
    .input(z.object({ weekStart: ymd }))
    .query(async ({ ctx, input }) => {
      const start = weekStart(input.weekStart);
      const end = addDaysYmd(start, 6);
      const clock = await plantClock(ctx.db, ctx.companyId);
      const people = await ctx.db
        .select({ id: hrEmployee.id, code: hrEmployee.code, name: hrEmployee.name, shiftId: hrEmployee.shiftId })
        .from(hrEmployee)
        .where(and(eq(hrEmployee.companyId, ctx.companyId), eq(hrEmployee.status, "active")))
        .orderBy(asc(hrEmployee.name))
        .limit(1000);
      const cells = await ctx.db
        .select({ employeeId: hrRoster.employeeId, day: hrRoster.day, shiftId: hrRoster.shiftId })
        .from(hrRoster)
        .where(and(eq(hrRoster.companyId, ctx.companyId), gte(hrRoster.day, start), lte(hrRoster.day, end)))
        .limit(7000);
      return { weekStart: start, days: Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i)), shifts: clock.shifts, people, cells };
    }),

  /** Set one cell: a shift id, `null` for the weekly off, or `default` to clear back to the person's shift. */
  set: hrProcedure("attendance.mark")
    .input(z.object({ employeeId: id, day: ymd, shiftId: z.string().trim().max(64).nullable() }))
    .mutation(async ({ ctx, input }) => {
      const person = await getEmployee(ctx.db, ctx.companyId, input.employeeId);
      if (person.status === "left" && person.leftOn && input.day > person.leftOn) throw bad(`${person.name} left on ${person.leftOn}`);
      const clock = await plantClock(ctx.db, ctx.companyId);
      if (input.shiftId !== null && input.shiftId !== "default" && !clock.shifts.some((s) => s.id === input.shiftId)) throw bad("Pick one of the plant's shifts");
      const stmt =
        input.shiftId === "default"
          ? ctx.db.delete(hrRoster).where(and(eq(hrRoster.companyId, ctx.companyId), eq(hrRoster.employeeId, input.employeeId), eq(hrRoster.day, input.day)))
          : ctx.db
              .insert(hrRoster)
              .values({ id: crypto.randomUUID(), companyId: ctx.companyId, employeeId: input.employeeId, day: input.day, shiftId: input.shiftId })
              .onConflictDoUpdate({ target: [hrRoster.companyId, hrRoster.employeeId, hrRoster.day], set: { shiftId: input.shiftId } });
      await atomicBatch(ctx.db, [stmt]);
      return { ok: true };
    }),

  /** Copy last week's cells into this week (cells already set this week stay). */
  copyLastWeek: hrProcedure("attendance.mark")
    .input(z.object({ weekStart: ymd }))
    .mutation(async ({ ctx, input }) => {
      const start = weekStart(input.weekStart);
      const from = addDaysYmd(start, -7);
      const to = addDaysYmd(start, -1);
      const createdAt = now().getTime();
      await atomicBatch(ctx.db, [
        // Keys follow hr_roster's column order (insert-select rule).
        ctx.db
          .insert(hrRoster)
          .select(
            ctx.db
              .select({
                id: sql<string>`lower(hex(randomblob(16)))`.as("id"),
                companyId: hrRoster.companyId,
                employeeId: hrRoster.employeeId,
                day: sql<string>`date(${hrRoster.day}, '+7 days')`.as("day"),
                shiftId: hrRoster.shiftId,
                createdAt: sql<number>`${createdAt}`.as("created_at"),
              })
              .from(hrRoster)
              .innerJoin(hrEmployee, and(eq(hrEmployee.id, hrRoster.employeeId), eq(hrEmployee.companyId, hrRoster.companyId), eq(hrEmployee.status, "active")))
              .where(and(eq(hrRoster.companyId, ctx.companyId), gte(hrRoster.day, from), lte(hrRoster.day, to))),
          )
          .onConflictDoNothing({ target: [hrRoster.companyId, hrRoster.employeeId, hrRoster.day] }),
        audit(ctx, "hr.roster.copy", "hr_roster", start, { weekStart: start }),
      ]);
      const [{ n } = { n: 0 }] = await ctx.db
        .select({ n: sql<number>`count(*)` })
        .from(hrRoster)
        .where(and(eq(hrRoster.companyId, ctx.companyId), gte(hrRoster.day, start), lte(hrRoster.day, addDaysYmd(start, 6))));
      return { cells: Number(n) };
    }),
});

const markRow = z.object({
  employeeId: id,
  status: z.enum(hrAttendanceStatuses),
  inTime: hhmm.nullable().optional(),
  outTime: hhmm.nullable().optional(),
  note: z.string().trim().max(200).nullable().optional(),
});

const attendance = router({
  /** The people of one shift on one day (rostered there, or by default shift when not rostered) and their marks. */
  shift: hrProcedure("hr.view", "attendance.mark")
    .input(z.object({ day: ymd, shiftId: z.string().trim().max(64).nullable() }))
    .query(async ({ ctx, input }) => {
      const clock = await plantClock(ctx.db, ctx.companyId);
      const people = await ctx.db
        .select({ id: hrEmployee.id, code: hrEmployee.code, name: hrEmployee.name, shiftId: hrEmployee.shiftId, joinedOn: hrEmployee.joinedOn, leftOn: hrEmployee.leftOn })
        .from(hrEmployee)
        .where(and(eq(hrEmployee.companyId, ctx.companyId), lte(hrEmployee.joinedOn, input.day), sql`(${hrEmployee.leftOn} is null or ${hrEmployee.leftOn} >= ${input.day})`))
        .orderBy(asc(hrEmployee.name))
        .limit(1000);
      const cells = await ctx.db.select({ employeeId: hrRoster.employeeId, shiftId: hrRoster.shiftId }).from(hrRoster).where(and(eq(hrRoster.companyId, ctx.companyId), eq(hrRoster.day, input.day))).limit(1000);
      const rostered = new Map(cells.map((c) => [c.employeeId, c.shiftId]));
      const inShift = people.filter((p) => {
        if (input.shiftId === null) return true;
        const cell = rostered.has(p.id) ? rostered.get(p.id) : p.shiftId;
        return cell === input.shiftId;
      });
      const marks = await ctx.db
        .select()
        .from(hrAttendance)
        .where(and(eq(hrAttendance.companyId, ctx.companyId), eq(hrAttendance.day, input.day)))
        .limit(1000);
      const byPerson = new Map(marks.map((m) => [m.employeeId, m]));
      return {
        day: input.day,
        today: clock.today,
        shift: clock.shifts.find((s) => s.id === input.shiftId) ?? null,
        shifts: clock.shifts,
        rows: inShift.map((p) => {
          const m = byPerson.get(p.id);
          return {
            employeeId: p.id,
            code: p.code,
            name: p.name,
            rosteredOff: rostered.has(p.id) && rostered.get(p.id) === null,
            mark: m ? { status: m.status, inAt: m.inAt, outAt: m.outAt, workedMin: m.workedMin, overtimeMin: m.overtimeMin, source: m.source, lateEntry: m.lateEntry, note: m.note, markedAt: m.markedAt } : null,
          };
        }),
      };
    }),

  /** Mark a whole shift at once (up to 300 people). Worked and overtime minutes come from the shift. */
  markShift: hrProcedure("attendance.mark", "attendance.manage")
    .input(z.object({ day: ymd, shiftId: z.string().trim().max(64).nullable(), rows: z.array(markRow).min(1).max(300) }))
    .mutation(async ({ ctx, input }) => {
      const clock = await plantClock(ctx.db, ctx.companyId);
      const late = lateEntryFor(ctx, clock, input.day);
      await assertMonthOpen(ctx, input.day.slice(0, 7));
      const shift = clock.shifts.find((s) => s.id === input.shiftId) ?? null;
      if (input.shiftId !== null && !shift) throw bad("Pick one of the plant's shifts");
      const ids = [...new Set(input.rows.map((r) => r.employeeId))];
      if (ids.length !== input.rows.length) throw bad("A person is listed twice");
      const people = await ctx.db
        .select({ id: hrEmployee.id, name: hrEmployee.name, joinedOn: hrEmployee.joinedOn, leftOn: hrEmployee.leftOn })
        .from(hrEmployee)
        .where(and(eq(hrEmployee.companyId, ctx.companyId), inArray(hrEmployee.id, ids)));
      if (people.length !== ids.length) throw notFound();
      for (const p of people) {
        if (input.day < p.joinedOn) throw bad(`${p.name} joins on ${p.joinedOn}`);
        if (p.leftOn && input.day > p.leftOn) throw bad(`${p.name} left on ${p.leftOn}`);
      }
      const { value: rules } = await rulesFor(ctx.db, ctx.companyId, input.day.slice(0, 7));
      const rule = { minMinutes: rules.overtimeMinMinutes, stepMinutes: rules.overtimeStepMinutes };
      const markedAt = now();
      const values = input.rows.map((r) => {
        const worked = r.status === "present" || r.status === "half_day";
        const inMin = worked && r.inTime ? minutesOf(r.inTime) : null;
        let outMin = worked && r.outTime ? minutesOf(r.outTime) : null;
        if (inMin !== null && outMin !== null && outMin <= inMin) outMin += 1440;
        const inAt = inMin === null ? null : utcOf(clock, input.day, inMin);
        const outAt = outMin === null ? null : utcOf(clock, input.day, outMin);
        const fig = attendanceFigures(inAt?.getTime() ?? null, outAt?.getTime() ?? null, shift, rule);
        return {
          id: crypto.randomUUID(),
          companyId: ctx.companyId,
          employeeId: r.employeeId,
          day: input.day,
          status: r.status,
          shiftId: input.shiftId,
          inAt,
          outAt,
          workedMin: fig.workedMin,
          overtimeMin: r.status === "present" || r.status === "half_day" ? fig.overtimeMin : 0,
          source: "manual" as const,
          lateEntry: late,
          note: r.note ?? null,
          markedBy: ctx.session.user.id,
          markedAt,
        };
      });
      const stmts: SqliteBatchItem[] = [];
      pushChunkedInserts(
        stmts,
        (part) =>
          ctx.db
            .insert(hrAttendance)
            .values(part)
            .onConflictDoUpdate({
              target: [hrAttendance.companyId, hrAttendance.employeeId, hrAttendance.day],
              set: {
                status: sql`excluded.status`,
                shiftId: sql`excluded.shift_id`,
                inAt: sql`excluded.in_at`,
                outAt: sql`excluded.out_at`,
                workedMin: sql`excluded.worked_min`,
                overtimeMin: sql`excluded.overtime_min`,
                source: sql`'manual'`,
                leaveRequestId: sql`null`,
                paidLeave: sql`null`,
                lateEntry: sql`excluded.late_entry`,
                note: sql`excluded.note`,
                markedBy: sql`excluded.marked_by`,
                markedAt: sql`excluded.marked_at`,
              },
            }),
        values,
      );
      stmts.push(audit(ctx, late ? "hr.attendance.late" : "hr.attendance.mark", "hr_attendance", input.day, { day: input.day, shiftId: input.shiftId, people: values.length, late }));
      await atomicBatch(ctx.db, stmts);
      return { marked: values.length, lateEntry: late, shiftMinutes: shift ? shiftLengthMin(shift) : null };
    }),

  /** One person's month: every day's mark and the totals payroll uses. */
  timesheet: hrProcedure("hr.view")
    .input(z.object({ employeeId: id, month }))
    .query(async ({ ctx, input }) => personMonth(ctx, input.employeeId, input.month)),
});

export async function personMonth(ctx: HrCtx, employeeId: string, monthKey: string) {
  const person = await getEmployee(ctx.db, ctx.companyId, employeeId);
  const days = daysOfMonth(monthKey);
  const from = days[0]!;
  const to = days[days.length - 1]!;
  const marks = await ctx.db
    .select()
    .from(hrAttendance)
    .where(and(eq(hrAttendance.companyId, ctx.companyId), eq(hrAttendance.employeeId, employeeId), gte(hrAttendance.day, from), lte(hrAttendance.day, to)))
    .orderBy(asc(hrAttendance.day))
    .limit(31);
  const { value: rules } = await rulesFor(ctx.db, ctx.companyId, monthKey);
  const hols = await holidaySet(ctx.db, ctx.companyId, from, to);
  const totals = timesheet({
    month: monthKey,
    marks: marks.map((m) => ({ day: m.day, status: m.status, overtimeMin: m.overtimeMin, paidLeave: m.paidLeave ?? undefined })),
    joinedOn: person.joinedOn,
    leftOn: person.leftOn,
    weeklyOffDow: person.weeklyOffDow ?? rules.weeklyOffDow,
    holidays: hols,
  });
  return {
    person: { id: person.id, code: person.code, name: person.name },
    month: monthKey,
    days: days.map((d) => {
      const m = marks.find((x) => x.day === d);
      return { day: d, holiday: hols.has(d), mark: m ? { status: m.status, inAt: m.inAt, outAt: m.outAt, workedMin: m.workedMin, overtimeMin: m.overtimeMin, source: m.source, lateEntry: m.lateEntry, paidLeave: m.paidLeave } : null };
    }),
    totals,
  };
}

const columnMap = z.object({
  code: z.number().int().min(0).max(50),
  dateTime: z.number().int().min(0).max(50).optional(),
  date: z.number().int().min(0).max(50).optional(),
  time: z.number().int().min(0).max(50).optional(),
  dateOrder: z.enum(["ymd", "dmy"]),
  delimiter: z.enum([",", "\t", ";", "|"]),
  hasHeader: z.boolean(),
});

const devices = router({
  list: hrProcedure("hr.view", "attendance.manage").query(async ({ ctx }) => {
    const rows = await ctx.db.select().from(hrDevice).where(eq(hrDevice.companyId, ctx.companyId)).orderBy(asc(hrDevice.name)).limit(50);
    return rows.map((r) => ({ id: r.id, name: r.name, make: r.make, columnMap: r.columnMap as PunchColumnMap | null, pushSet: !!r.tokenHash, active: r.active, lastPushAt: r.lastPushAt }));
  }),

  save: hrProcedure("hr.manage")
    .input(z.object({ id: id.optional(), name: z.string().trim().min(1).max(60), make: z.string().trim().max(60).nullable().optional(), columnMap: columnMap.nullable().optional(), active: z.boolean().default(true) }))
    .mutation(async ({ ctx, input }) => {
      if (input.columnMap && input.columnMap.dateTime === undefined && (input.columnMap.date === undefined || input.columnMap.time === undefined)) throw bad("Map a date and time column, or one column with both");
      const rowId = input.id ?? crypto.randomUUID();
      if (input.id) {
        const [had] = await ctx.db.select({ id: hrDevice.id }).from(hrDevice).where(and(eq(hrDevice.companyId, ctx.companyId), eq(hrDevice.id, input.id))).limit(1);
        if (!had) throw notFound();
      }
      const values = { name: input.name, make: input.make ?? null, columnMap: (input.columnMap ?? null) as Record<string, unknown> | null, active: input.active };
      await atomicBatch(ctx.db, [
        input.id ? ctx.db.update(hrDevice).set(values).where(and(eq(hrDevice.companyId, ctx.companyId), eq(hrDevice.id, input.id))) : ctx.db.insert(hrDevice).values({ id: rowId, companyId: ctx.companyId, ...values }),
        audit(ctx, "hr.device.save", "hr_device", rowId, { name: input.name, make: input.make ?? null, active: input.active }),
      ]);
      return { id: rowId };
    }),

  /** A new push token for the device, shown once. The old one stops working. */
  newToken: hrProcedure("hr.manage")
    .input(z.object({ id }))
    .mutation(async ({ ctx, input }) => {
      const [had] = await ctx.db.select({ id: hrDevice.id, name: hrDevice.name }).from(hrDevice).where(and(eq(hrDevice.companyId, ctx.companyId), eq(hrDevice.id, input.id))).limit(1);
      if (!had) throw notFound();
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      const token = `hrd_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
      await atomicBatch(ctx.db, [
        ctx.db.update(hrDevice).set({ tokenHash: await sha256Hex(token) }).where(and(eq(hrDevice.companyId, ctx.companyId), eq(hrDevice.id, input.id))),
        audit(ctx, "hr.device.token", "hr_device", input.id, { name: had.name }),
      ]);
      return { token, path: "/hr/v1/punches" };
    }),
});

async function deviceWithMap(ctx: HrCtx, deviceId: string, override?: PunchColumnMap | null) {
  const [d] = await ctx.db.select().from(hrDevice).where(and(eq(hrDevice.companyId, ctx.companyId), eq(hrDevice.id, deviceId))).limit(1);
  if (!d) throw notFound();
  const map = (override ?? d.columnMap) as PunchColumnMap | null;
  if (!map) throw bad("Map this device's columns first");
  return { device: d, map };
}

const fileText = z.string().max(600_000);

const punches = router({
  /** Read a device export with the device's column map and show what would be imported. Writes nothing. */
  preview: hrProcedure("attendance.manage")
    .input(z.object({ deviceId: id, text: fileText, columnMap: columnMap.nullable().optional() }))
    .query(async ({ ctx, input }) => {
      const { map } = await deviceWithMap(ctx, input.deviceId, input.columnMap ?? null);
      const parsed = parsePunchFile(input.text, map);
      if (parsed.punches.length > PUNCH_FILE_MAX_ROWS) throw bad(`A file can hold at most ${PUNCH_FILE_MAX_ROWS} punches; split it`);
      const codes = [...new Set(parsed.punches.map((p) => p.code))];
      const known = codes.length
        ? await ctx.db
            .select({ code: hrEmployee.deviceCode, name: hrEmployee.name })
            .from(hrEmployee)
            .where(and(eq(hrEmployee.companyId, ctx.companyId), inArray(hrEmployee.deviceCode, codes.slice(0, 90))))
        : [];
      const names = new Map(known.map((k) => [k.code!, k.name]));
      return {
        total: parsed.punches.length,
        errors: parsed.errors.slice(0, 50),
        errorCount: parsed.errors.length,
        unknownCodes: codes.filter((c) => !names.has(c)),
        sample: parsed.punches.slice(0, 50).map((p) => ({ line: p.line, code: p.code, name: names.get(p.code) ?? null, local: new Date(p.localMs).toISOString().slice(0, 16).replace("T", " ") })),
      };
    }),

  /** Import the file: punches with duplicates ignored, then each person's punch days rebuilt. */
  commit: hrProcedure("attendance.manage")
    .input(z.object({ deviceId: id, text: fileText }))
    .mutation(async ({ ctx, input }) => {
      const { device, map } = await deviceWithMap(ctx, input.deviceId);
      const parsed = parsePunchFile(input.text, map);
      if (parsed.punches.length > PUNCH_FILE_MAX_ROWS) throw bad(`A file can hold at most ${PUNCH_FILE_MAX_ROWS} punches; split it`);
      if (!parsed.punches.length) throw bad("No punches in this file");
      const clock = await plantClock(ctx.db, ctx.companyId);
      const result = await importPunches(ctx.db, ctx.companyId, device.id, fileToUtc(clock, parsed.punches), "file", ctx.session.user.id);
      await atomicBatch(ctx.db, [audit(ctx, "hr.punch.import", "hr_device", device.id, { name: device.name, inserted: result.inserted, duplicates: result.duplicates, errors: parsed.errors.length })]);
      return { ...result, errorCount: parsed.errors.length };
    }),
});

export const hrAttendanceRouters = { holidays, roster, attendance, devices, punches };
