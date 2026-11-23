/**
 * XE parity lane HR: gates and shared reads for the `hr` and `payroll` routers. Both modules are opt-in
 * and every procedure, reads included, needs its module (the router-level gate in `companyProcedure`
 * covers only mutations; people and salary are personal data). Payroll also needs `hr`.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lte, or } from "drizzle-orm";

import { hrEmployee, hrHoliday, hrSetting } from "@orrn/db/schema/hr";
import { company } from "@orrn/db/schema/tenant";
import {
  DEFAULT_HR_RULES,
  DEFAULT_INCENTIVE_RULE,
  DEFAULT_STATUTORY_RATES,
  datedFor,
  isModuleOn,
  readFloorSettings,
  type HrRules,
  type IncentiveRule,
  type Shift,
  type StatutoryRates,
} from "@orrn/domain";

import type { OrrnDb } from "../atomic";
import { now } from "../clock";
import { companyTimezone, zonedOffsetMs, zonedWallMs } from "../dayWindow";
import { companyModules, MODULE_OFF_MESSAGE } from "../moduleGate";

export const PAYROLL_NEEDS_HR = "Payroll needs the HR module on for this plant";

export async function assertHr(ctx: { db: OrrnDb; companyId: string }, withPayroll = false): Promise<void> {
  const modules = await companyModules(ctx.db, ctx.companyId);
  if (withPayroll) {
    if (!isModuleOn(modules, "payroll")) throw new TRPCError({ code: "FORBIDDEN", message: MODULE_OFF_MESSAGE });
    if (!isModuleOn(modules, "hr")) throw new TRPCError({ code: "FORBIDDEN", message: PAYROLL_NEEDS_HR });
    return;
  }
  if (!isModuleOn(modules, "hr")) throw new TRPCError({ code: "FORBIDDEN", message: MODULE_OFF_MESSAGE });
}

export type HrCtx = { db: OrrnDb; companyId: string; session: { user: { id: string } }; membership?: { id: string } | null; impersonation?: unknown };

export const notFound = () => new TRPCError({ code: "NOT_FOUND", message: "Not found" });
export const bad = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
export const conflict = (message: string) => new TRPCError({ code: "CONFLICT", message });

export async function getEmployee(db: OrrnDb, companyId: string, id: string) {
  const [row] = await db.select().from(hrEmployee).where(and(eq(hrEmployee.companyId, companyId), eq(hrEmployee.id, id))).limit(1);
  if (!row) throw notFound();
  return row;
}

/** The employee linked to the signed-in person (by membership, else by the user id press runs record). */
export async function myEmployee(ctx: HrCtx) {
  const conds = [eq(hrEmployee.userId, ctx.session.user.id)];
  if (ctx.membership?.id) conds.push(eq(hrEmployee.membershipId, ctx.membership.id));
  const [row] = await ctx.db
    .select()
    .from(hrEmployee)
    .where(and(eq(hrEmployee.companyId, ctx.companyId), or(...conds)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "You are not linked to a person in the HR register yet; ask the office" });
  return row;
}

export type PlantClock = { timezone: string; shifts: Shift[]; today: string; settings: Record<string, unknown> };

export async function plantClock(db: OrrnDb, companyId: string): Promise<PlantClock> {
  const row = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).get();
  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  const timezone = companyTimezone(settings);
  const { shifts } = readFloorSettings(settings);
  const at = now().getTime();
  const local = at + zonedOffsetMs(timezone, at);
  const d = new Date(local);
  const today = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { timezone, shifts, today, settings };
}

/** UTC instant of a local day + minute of day (minute may pass 1440 for a shift past midnight). */
export function utcOf(clock: Pick<PlantClock, "timezone">, day: string, minuteOfDay: number): Date {
  const [year, month, d] = day.split("-").map(Number) as [number, number, number];
  return new Date(zonedWallMs(clock.timezone, { year, month, day: d }, minuteOfDay));
}

/** Local wall milliseconds of a UTC instant (domain functions work on these). */
export function localOf(clock: Pick<PlantClock, "timezone">, utcMs: number): number {
  return utcMs + zonedOffsetMs(clock.timezone, utcMs);
}

type SettingKind = "statutory" | "rules" | "incentive";

async function datedRows(db: OrrnDb, companyId: string, kind: SettingKind) {
  return db
    .select()
    .from(hrSetting)
    .where(and(eq(hrSetting.companyId, companyId), eq(hrSetting.kind, kind)))
    .orderBy(desc(hrSetting.effectiveFrom))
    .limit(120);
}

export async function settingFor<T>(db: OrrnDb, companyId: string, kind: SettingKind, month: string, fallback: T): Promise<{ value: T; effectiveFrom: string | null; note: string | null }> {
  const rows = await datedRows(db, companyId, kind);
  const row = datedFor(rows, month);
  return row ? { value: { ...fallback, ...(row.value as Partial<T>) }, effectiveFrom: row.effectiveFrom, note: row.note } : { value: fallback, effectiveFrom: null, note: null };
}

export async function settingHistory(db: OrrnDb, companyId: string, kind: SettingKind) {
  return datedRows(db, companyId, kind);
}

export const rulesFor = (db: OrrnDb, companyId: string, month: string) => settingFor<HrRules>(db, companyId, "rules", month, DEFAULT_HR_RULES);
export const ratesFor = (db: OrrnDb, companyId: string, month: string) => settingFor<StatutoryRates>(db, companyId, "statutory", month, DEFAULT_STATUTORY_RATES);
export const incentiveRuleFor = (db: OrrnDb, companyId: string, month: string) => settingFor<IncentiveRule>(db, companyId, "incentive", month, DEFAULT_INCENTIVE_RULE);

export async function holidaySet(db: OrrnDb, companyId: string, from: string, to: string): Promise<Set<string>> {
  const rows = await db
    .select({ day: hrHoliday.day })
    .from(hrHoliday)
    .where(and(eq(hrHoliday.companyId, companyId), gte(hrHoliday.day, from), lte(hrHoliday.day, to)))
    .limit(400);
  return new Set(rows.map((r) => r.day));
}

export const monthOf = (day: string) => day.slice(0, 7);
