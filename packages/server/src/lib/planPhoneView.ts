/**
 * FP-OP-21 (W4-NEXTROWS): the press plan and the day's press summary for the owner's phone,
 * read-only. The released plans, grouped per press line: the plan whose window covers now comes
 * first and is ALWAYS included, then the next `PHONE_UPCOMING` that start later (soonest first), then
 * the last `PHONE_RECENT` that ended (latest first). Each die has its cut lengths, planned vs pressed
 * pcs/kg (`planDieView`: logged runs only) and a run-state chip; the summary is FP-PR-18's own
 * `pressDaySummary`. No 17-column grid, no rates.
 */
import { planDieView, type PressRunStatus } from "@orrn/domain";
import { die } from "@orrn/db/schema/catalog";
import { pressLine, pressPlan, pressPlanDie, pressPlanLine, pressRun, pressRunLine } from "@orrn/db/schema/press";
import { and, asc, desc, eq, gt, inArray, lte } from "drizzle-orm";

import { mapInChunks, type OrrnDb } from "./atomic";

/** Per press line, after the plan on the press now: this many upcoming, this many recent. */
export const PHONE_UPCOMING = 2;
export const PHONE_RECENT = 1;
/** Rows read per side before the per-line cap (released plans are few; this only bounds the read). */
const PHONE_READ = 40;

export type PhonePhase = "now" | "next" | "recent";

export function phonePhase(w: { windowStart: number; windowEnd: number }, nowMs: number): PhonePhase {
  return w.windowStart <= nowMs && nowMs < w.windowEnd ? "now" : w.windowStart > nowMs ? "next" : "recent";
}

/**
 * Which plans the phone shows and in what order: per press line (code order, no line last) the plans
 * covering now (earliest start first, never cut), then up to `upcoming` later ones, soonest first, then up
 * to `recent` ended ones, latest first.
 */
export function pickPhonePlans<T extends { windowStart: number; windowEnd: number; lineKey: string | null }>(
  rows: readonly T[],
  nowMs: number,
  caps: { upcoming: number; recent: number } = { upcoming: PHONE_UPCOMING, recent: PHONE_RECENT },
): (T & { phase: PhonePhase })[] {
  const tagged = rows.map((r) => ({ ...r, phase: phonePhase(r, nowMs) }));
  const keys = [...new Set(tagged.map((r) => r.lineKey))].sort((a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
  return keys.flatMap((k) => {
    const mine = tagged.filter((r) => r.lineKey === k);
    return [
      ...mine.filter((r) => r.phase === "now").sort((a, b) => a.windowStart - b.windowStart),
      ...mine.filter((r) => r.phase === "next").sort((a, b) => a.windowStart - b.windowStart).slice(0, caps.upcoming),
      ...mine.filter((r) => r.phase === "recent").sort((a, b) => b.windowEnd - a.windowEnd).slice(0, caps.recent),
    ];
  });
}

export async function planPhoneView(db: OrrnDb, companyId: string, opts: { planId?: string; nowMs?: number } = {}) {
  const nowMs = opts.nowMs ?? Date.now();
  const nowDate = new Date(nowMs);
  const base = () =>
    db
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
      .leftJoin(pressLine, and(eq(pressLine.id, pressPlan.pressLineId), eq(pressLine.companyId, pressPlan.companyId)));
  const released = and(eq(pressPlan.companyId, companyId), eq(pressPlan.status, "released"));
  const found = opts.planId
    ? await base().where(and(eq(pressPlan.companyId, companyId), eq(pressPlan.id, opts.planId))).limit(1)
    : (
        await Promise.all([
          base().where(and(released, lte(pressPlan.windowStart, nowDate), gt(pressPlan.windowEnd, nowDate))).orderBy(asc(pressPlan.windowStart)).limit(PHONE_READ),
          base().where(and(released, gt(pressPlan.windowStart, nowDate))).orderBy(asc(pressPlan.windowStart)).limit(PHONE_READ),
          base().where(and(released, lte(pressPlan.windowEnd, nowDate))).orderBy(desc(pressPlan.windowEnd)).limit(PHONE_READ),
        ])
      ).flat();
  const plans = pickPhonePlans(
    found.map((p) => ({ ...p, windowStart: p.windowStart.getTime(), windowEnd: p.windowEnd.getTime(), lineKey: p.pressLineCode })),
    nowMs,
  );
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
      phase: p.phase,
      windowStart: p.windowStart,
      windowEnd: p.windowEnd,
      pressLine: p.pressLineCode ? { code: p.pressLineCode, name: p.pressLineName } : null,
      dies: planDies,
      plannedG,
      pressedG,
      pressedBp: plannedG > 0 ? Math.round((pressedG * 10_000) / plannedG) : 0,
    };
  });
}
