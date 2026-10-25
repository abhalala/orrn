/**
 * FP-OP-21 (W4-NEXTROWS): the press plan and the day's press summary for the owner's phone,
 * read-only. The released plans (newest window first, at most `PHONE_PLANS`), each die with its
 * cut lengths, planned vs pressed pcs/kg (`planDieView`: logged runs only) and a run-state chip; the
 * summary is FP-PR-18's own `pressDaySummary`. No 17-column grid, no rates.
 */
import { planDieView, type PressRunStatus } from "@orrn/domain";
import { die } from "@orrn/db/schema/catalog";
import { pressLine, pressPlan, pressPlanDie, pressPlanLine, pressRun, pressRunLine } from "@orrn/db/schema/press";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { mapInChunks, type OrrnDb } from "./atomic";

export const PHONE_PLANS = 3;

export async function planPhoneView(db: OrrnDb, companyId: string, opts: { planId?: string } = {}) {
  const plans = await db
    .select({
      id: pressPlan.id,
      number: pressPlan.number,
      status: pressPlan.status,
      purpose: pressPlan.purpose,
      windowStart: pressPlan.windowStart,
      windowEnd: pressPlan.windowEnd,
      pressLineCode: pressLine.code,
      pressLineName: pressLine.name,
    })
    .from(pressPlan)
    .leftJoin(pressLine, and(eq(pressLine.id, pressPlan.pressLineId), eq(pressLine.companyId, pressPlan.companyId)))
    .where(and(eq(pressPlan.companyId, companyId), opts.planId ? eq(pressPlan.id, opts.planId) : eq(pressPlan.status, "released")))
    .orderBy(desc(pressPlan.windowStart), desc(pressPlan.createdAt))
    .limit(opts.planId ? 1 : PHONE_PLANS);
  if (plans.length === 0) return [];
  const planIds = plans.map((p) => p.id);

  const [dies, lines, runs] = await Promise.all([
    db
      .select({
        id: pressPlanDie.id,
        planId: pressPlanDie.pressPlanId,
        sectionCode: die.sectionCode,
        sectionName: die.name,
        urgent: pressPlanDie.urgent,
        sortOrder: pressPlanDie.sortOrder,
      })
      .from(pressPlanDie)
      .innerJoin(die, and(eq(die.id, pressPlanDie.sectionId), eq(die.companyId, pressPlanDie.companyId)))
      .where(and(eq(pressPlanDie.companyId, companyId), inArray(pressPlanDie.pressPlanId, planIds)))
      .orderBy(asc(pressPlanDie.sortOrder)),
    db
      .select({ dieId: pressPlanLine.pressPlanDieId, cutLengthMm: pressPlanLine.cutLengthMm, pcs: pressPlanLine.pcs, kgG: pressPlanLine.kgG })
      .from(pressPlanLine)
      .where(and(eq(pressPlanLine.companyId, companyId), inArray(pressPlanLine.pressPlanId, planIds))),
    db
      .select({ id: pressRun.id, dieId: pressRun.pressPlanDieId, status: pressRun.status, number: pressRun.number, createdAt: pressRun.createdAt })
      .from(pressRun)
      .where(and(eq(pressRun.companyId, companyId), inArray(pressRun.planId, planIds))),
  ]);
  const loggedIds = runs.filter((r) => r.status === "logged").map((r) => r.id);
  const runLines = await mapInChunks(loggedIds, (ids) =>
    db
      .select({ pressRunId: pressRunLine.pressRunId, cutLengthMm: pressRunLine.cutLengthMm, pcs: pressRunLine.pcs, goodG: pressRunLine.goodG })
      .from(pressRunLine)
      .where(and(eq(pressRunLine.companyId, companyId), inArray(pressRunLine.pressRunId, ids))),
  );
  const runDie = new Map(runs.map((r) => [r.id, r.dieId]));

  return plans.map((p) => {
    const planDies = dies
      .filter((d) => d.planId === p.id)
      .map((d) => {
        const dieRuns = runs.filter((r) => r.dieId === d.id);
        const view = planDieView({
          planLines: lines.filter((l) => l.dieId === d.id),
          runs: dieRuns.map((r) => ({ id: r.id, status: r.status as PressRunStatus, createdAt: r.createdAt.getTime() })),
          runLines: runLines.filter((l) => runDie.get(l.pressRunId) === d.id),
        });
        const latest = dieRuns.filter((r) => r.status !== "voided").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        return { id: d.id, sectionCode: d.sectionCode, sectionName: d.sectionName, urgent: d.urgent, runNumber: latest?.number ?? null, ...view };
      });
    const plannedG = planDies.reduce((s, d) => s + d.plannedG, 0);
    const pressedG = planDies.reduce((s, d) => s + d.pressedG, 0);
    return {
      id: p.id,
      number: p.number,
      status: p.status,
      purpose: p.purpose,
      windowStart: p.windowStart.getTime(),
      windowEnd: p.windowEnd.getTime(),
      pressLine: p.pressLineCode ? { code: p.pressLineCode, name: p.pressLineName } : null,
      dies: planDies,
      plannedG,
      pressedG,
      pressedBp: plannedG > 0 ? Math.round((pressedG * 10_000) / plannedG) : 0,
    };
  });
}
