/**
 * XE parity lane HR, row 89: the monthly incentive sheet from logged press runs. One row per operator x
 * production day x shift: good kg, input kg, reject kg summed from the run records (the server's own
 * figures, never typed), recovery and the incentive by the plant's dated rule. The run's operator is
 * credited; the relief operator is shown but not paid (owner item: a split rule).
 */
import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";

import { hrEmployee } from "@orrn/db/schema/hr";
import { pressRun } from "@orrn/db/schema/press";
import { daysOfMonth, incentiveFor, type IncentiveRule } from "@orrn/domain";

import type { OrrnDb } from "../atomic";
import { incentiveRuleFor, plantClock } from "./core";

export type IncentiveRow = {
  employeeId: string | null;
  userId: string;
  code: string | null;
  name: string | null;
  day: string;
  shiftId: string | null;
  shift: string;
  runs: number;
  goodG: number;
  inputG: number;
  rejectG: number;
  recoveryBp: number | null;
  belowFloor: boolean;
  paise: number;
};

export async function incentiveSheet(db: OrrnDb, companyId: string, month: string): Promise<{ rule: IncentiveRule; effectiveFrom: string | null; rows: IncentiveRow[]; byPerson: { employeeId: string; code: string; name: string; paise: number; goodG: number }[] }> {
  const days = daysOfMonth(month);
  const { value: rule, effectiveFrom } = await incentiveRuleFor(db, companyId, month);
  const clock = await plantClock(db, companyId);
  const shiftName = new Map(clock.shifts.map((s) => [s.id, s.name]));
  const grouped = await db
    .select({
      userId: pressRun.operatorId,
      day: pressRun.productionDay,
      shiftId: pressRun.shiftId,
      runs: sql<number>`count(*)`,
      goodG: sql<number>`coalesce(sum(${pressRun.goodG}), 0)`,
      inputG: sql<number>`coalesce(sum(coalesce(${pressRun.inputWeighedG}, ${pressRun.inputG})), 0)`,
      rejectG: sql<number>`coalesce(sum(${pressRun.rejectG}), 0)`,
    })
    .from(pressRun)
    .where(
      and(
        eq(pressRun.companyId, companyId),
        eq(pressRun.status, "logged"),
        isNotNull(pressRun.operatorId),
        gte(pressRun.productionDay, days[0]!),
        lte(pressRun.productionDay, days[days.length - 1]!),
      ),
    )
    .groupBy(pressRun.operatorId, pressRun.productionDay, pressRun.shiftId)
    .limit(5000);
  const people = await db
    .select({ id: hrEmployee.id, code: hrEmployee.code, name: hrEmployee.name, userId: hrEmployee.userId })
    .from(hrEmployee)
    .where(and(eq(hrEmployee.companyId, companyId), isNotNull(hrEmployee.userId)))
    .limit(2000);
  const byUser = new Map(people.map((p) => [p.userId!, p]));
  const rows: IncentiveRow[] = grouped
    .filter((g) => g.userId && g.day)
    .map((g) => {
      const person = byUser.get(g.userId!);
      const figures = { goodG: Number(g.goodG), inputG: Number(g.inputG), rejectG: Number(g.rejectG) };
      const inc = incentiveFor(figures, rule);
      return {
        employeeId: person?.id ?? null,
        userId: g.userId!,
        code: person?.code ?? null,
        name: person?.name ?? null,
        day: g.day!,
        shiftId: g.shiftId,
        shift: g.shiftId ? (shiftName.get(g.shiftId) ?? "") : "",
        runs: Number(g.runs),
        ...figures,
        recoveryBp: inc.recoveryBp,
        belowFloor: inc.belowFloor,
        paise: person ? inc.paise : 0,
      };
    })
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "") || a.day.localeCompare(b.day));
  const totals = new Map<string, { employeeId: string; code: string; name: string; paise: number; goodG: number }>();
  for (const r of rows) {
    if (!r.employeeId) continue;
    const t = totals.get(r.employeeId) ?? { employeeId: r.employeeId, code: r.code!, name: r.name!, paise: 0, goodG: 0 };
    t.paise += r.paise;
    t.goodG += r.goodG;
    totals.set(r.employeeId, t);
  }
  return { rule, effectiveFrom, rows, byPerson: [...totals.values()] };
}
