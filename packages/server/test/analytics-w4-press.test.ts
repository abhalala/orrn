/**
 * W4-ANALYTICS: recovery by die / copy / press / shift (`analytics.recovery`, production runs only,
 * Σ good ÷ Σ input, never an average of percents) against the spec's worked run (310.4 kg in,
 * 234.2 kg good → 7545 bp = 75.5 %), and die life (`analytics.dieLife`: life_g against Σ good kg of
 * the copy's logged runs, "N % used", "Life reached" at 100 %).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { dieInstance, pressRun } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { dieLifeUse } from "../src/lib/reportsAnalytics";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";
import { fillWorkedExample, kg, pressHelpers, type PressPlant } from "./press-w2-fixture";
import { ROLES } from "./sales-fixture";

setDefaultTimeout(60_000);

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { pressPlant } = pressHelpers(() => env);

const SHIFTS = [
  { id: "w4-day", name: "Day", seq: 1, startMin: 8 * 60, endMin: 20 * 60 },
  { id: "w4-night", name: "Night", seq: 2, startMin: 20 * 60, endMin: 8 * 60 },
];

/** A second run, other die: 200.0 kg in, 180.0 kg good → 9000 bp; butt 12, ends 6, no rejects. */
async function fillSecond(p: PressPlant, runId: string, castId: string, planLineId?: string) {
  const press = p.as("press");
  await press.press.runs.billets({ id: runId, castId, rows: [{ count: 2, kgG: kg(100), lengthMm: 600 }, { count: 2, kgG: kg(100), lengthMm: 600 }] });
  await press.press.runs.lines({ id: runId, rows: [{ cutLengthMm: 3_658, pcs: 60, goodG: kg(180), pressPlanLineId: planLineId ?? null }] });
  await press.press.runs.qc({ id: runId, rows: [{ pcs: 0, kgG: 0 }] });
  await press.press.runs.scrap({ id: runId, discardG: kg(12), endsG: kg(6) });
}

async function closed(p: PressPlant, runId: string) {
  await p.as("supervisor").press.runs.close({ id: runId });
  const [row] = await env.db.select().from(pressRun).where(eq(pressRun.id, runId));
  return row!;
}

/** Two production runs on P1 (A: the worked example, B: 9000 bp on another die), B moved to the night shift, plus a sample run. */
async function twoRuns() {
  const p = await pressPlant({ settings: { shifts: SHIFTS } });
  const c = await p.castWith(kg(5_000));
  const a = await p.countingRun();
  await fillWorkedExample(p, a.runId, c.id, { planLineId: a.planLineIds[0] });
  const aRow = await closed(p, a.runId);
  const b = await p.countingRun();
  await fillSecond(p, b.runId, c.id, b.planLineIds[0]);
  await closed(p, b.runId);
  const day = aRow.productionDay!;
  // Pin the shifts so the grouping does not depend on the hour the test runs.
  await env.db.update(pressRun).set({ shiftSeq: 1, shiftId: "w4-day", productionDay: day }).where(eq(pressRun.id, a.runId));
  await env.db.update(pressRun).set({ shiftSeq: 2, shiftId: "w4-night", productionDay: day }).where(eq(pressRun.id, b.runId));
  const sample = await p.countingRun({ purpose: "sample" });
  await fillWorkedExample(p, sample.runId, c.id);
  await closed(p, sample.runId);
  await env.db.update(pressRun).set({ productionDay: day }).where(eq(pressRun.id, sample.runId));
  return { p, a, b, sample, day };
}

describe("analytics.recovery", () => {
  test("by die, copy, press and shift: Σ good ÷ Σ input of production runs; the worked run is 75.5 %", async () => {
    const { p, a, b, day } = await twoRuns();
    const office = p.as("office");

    const byDie = await office.analytics.recovery({ from: day, to: day, groupBy: "die" });
    expect(byDie.rows).toHaveLength(2);
    const dieA = byDie.rows.find((r) => r.key === a.sectionId)!;
    const dieB = byDie.rows.find((r) => r.key === b.sectionId)!;
    expect(dieA).toMatchObject({ runs: 1, inputG: 310_400, goodG: 234_200, scrapG: 44_800, recoveryBp: 7545, recoveryPct: "75.5" });
    expect(dieB).toMatchObject({ runs: 1, inputG: 200_000, goodG: 180_000, scrapG: 18_000, recoveryBp: 9000, recoveryPct: "90.0" });
    // 414.2 / 510.4 = 81.15 % → 8115 bp; the average of the two percents (82.7) is not the answer.
    expect(byDie.totals).toEqual({ runs: 2, inputG: 510_400, goodG: 414_200, scrapG: 62_800, recoveryBp: 8115, recoveryPct: "81.2" });

    const byPress = await office.analytics.recovery({ from: day, to: day, groupBy: "press" });
    expect(byPress.rows).toEqual([
      { key: p.pressLineId, label: "P1", detail: "Press 1", runs: 2, inputG: 510_400, goodG: 414_200, scrapG: 62_800, recoveryBp: 8115, recoveryPct: "81.2" },
    ]);

    const byShift = await office.analytics.recovery({ from: day, to: day, groupBy: "shift" });
    expect(byShift.rows.map((r) => [r.key, r.label, r.recoveryPct])).toEqual([
      ["w4-day", "Day", "75.5"],
      ["w4-night", "Night", "90.0"],
    ]);

    const byCopy = await office.analytics.recovery({ from: day, to: day, groupBy: "copy" });
    expect(byCopy.rows.map((r) => r.key).sort()).toEqual([a.copyId, b.copyId].sort());

    // Filters: the night shift alone, the plan of run A alone, another line has nothing.
    expect((await office.analytics.recovery({ from: day, to: day, groupBy: "die", shiftSeq: 2 })).rows.map((r) => r.key)).toEqual([b.sectionId]);
    expect((await office.analytics.recovery({ from: day, to: day, groupBy: "die", planId: a.planId })).totals.recoveryBp).toBe(7545);
    const other = await p.as("manager").press.lines.create({ code: "P7", name: "Press 7" });
    expect(await office.analytics.recovery({ from: day, to: day, groupBy: "press", pressLineId: other.id })).toEqual({
      groupBy: "press",
      rows: [],
      totals: { runs: 0, inputG: 0, goodG: 0, scrapG: 0, recoveryBp: null, recoveryPct: null },
    });
    await expect(office.analytics.recovery({ from: day, to: "2000-01-01", groupBy: "die" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // The press report lists the sample run too; recovery leaves it out (production runs only),
    // and the report's own KPI agrees with the recovery total.
    const rep = await office.press.report({ from: day, to: day });
    expect(rep.rows).toHaveLength(3);
    expect(rep.totals.recoveryBp).toBe(byDie.totals.recoveryBp);
  });

  test("reports.read holders read it; floor roles without it are refused", async () => {
    const { p, day } = await twoRuns();
    const allowed: CompanyRole[] = ["owner", "admin", "manager", "office", "accountant", "supervisor", "viewer"];
    for (const role of ROLES) {
      const call = p.as(role).analytics.recovery({ from: day, to: day, groupBy: "press" });
      if (allowed.includes(role)) expect({ role, runs: (await call).totals.runs }).toEqual({ role, runs: 2 });
      else await expect(call).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // Another plant sees none of these runs.
    const q = await pressPlant();
    expect((await q.as("office").analytics.recovery({ from: day, to: day, groupBy: "die" })).rows).toEqual([]);
  });
});

describe("analytics.recovery: what counts", () => {
  test("voided and die_trial runs leave the figures; a reorder that reuses a seq keeps the two shifts apart", async () => {
    const { p, a, b, day } = await twoRuns();
    const c = await p.castWith(kg(5_000));
    const office = p.as("office");
    const before = await office.analytics.recovery({ from: day, to: day, groupBy: "die" });

    const voided = await p.countingRun();
    await fillWorkedExample(p, voided.runId, c.id, { planLineId: voided.planLineIds[0] });
    await closed(p, voided.runId);
    await env.db.update(pressRun).set({ status: "voided", productionDay: day }).where(eq(pressRun.id, voided.runId));
    const trial = await p.countingRun({ purpose: "die_trial" });
    await fillWorkedExample(p, trial.runId, c.id);
    await p.as("supervisor").press.runs.close({ id: trial.runId, trialResult: "pass" });
    await env.db.update(pressRun).set({ productionDay: day }).where(eq(pressRun.id, trial.runId));

    const after = await office.analytics.recovery({ from: day, to: day, groupBy: "die" });
    expect(after.totals).toEqual(before.totals);
    expect(after.rows).toEqual(before.rows);

    // The night shift was reordered to seq 1 (a reorder changes only the seq): still two shifts, not one mixed row.
    await env.db.update(pressRun).set({ shiftSeq: 1 }).where(eq(pressRun.id, b.runId));
    const byShift = await office.analytics.recovery({ from: day, to: day, groupBy: "shift" });
    expect(byShift.rows.map((r) => [r.key, r.label, r.runs, r.recoveryPct])).toEqual([
      ["w4-day", "Day", 1, "75.5"],
      ["w4-night", "Night", 1, "90.0"],
    ]);
    void a;
  });
});

describe("analytics.dieLife", () => {
  test("dieLifeUse: half-up basis points, near from 90 %, reached at 100 %", () => {
    expect(dieLifeUse(null, 5_000)).toEqual({ usedBp: null, remainingG: null, state: "none", reached: false });
    expect(dieLifeUse(0, 5_000).state).toBe("none");
    expect(dieLifeUse(1_000, 899)).toMatchObject({ usedBp: 8990, state: "ok", remainingG: 101 });
    expect(dieLifeUse(1_000, 900)).toMatchObject({ usedBp: 9000, state: "near" });
    expect(dieLifeUse(1_000, 1_000)).toMatchObject({ usedBp: 10_000, state: "reached", reached: true, remainingG: 0 });
    expect(dieLifeUse(20_000, 1)).toMatchObject({ usedBp: 1 }); // 0.5 bp rounds up
    expect(dieLifeUse(3, 1)).toMatchObject({ usedBp: 3333 });
    expect(dieLifeUse(150_000, 180_000)).toMatchObject({ usedBp: 12_000, state: "reached", remainingG: -30_000 });
  });

  test("% used per copy from logged runs, sorted by share used; Life reached; matches the die card", async () => {
    const { p, a, b } = await twoRuns();
    const setLife = (copyId: string, lifeG: number | null) => env.db.update(dieInstance).set({ lifeG }).where(eq(dieInstance.id, copyId));
    await setLife(a.copyId, kg(468.4)); // 234.2 of 468.4 = 50.0 %
    await setLife(b.copyId, kg(190)); // 180 of 190 = 94.7 % (near)
    const idle = await p.copy(await p.section());
    await setLife(idle, kg(1_000)); // nothing pressed: 0.0 %

    const office = p.as("office");
    let life = await office.analytics.dieLife({});
    const withLife = life.items.filter((i) => i.lifeG != null);
    expect(withLife.map((i) => [i.dieInstanceId, i.usedBp, i.usedPct, i.state])).toEqual([
      [b.copyId, 9474, "94.7", "near"],
      [a.copyId, 5000, "50.0", "ok"],
      [idle, 0, "0.0", "ok"],
    ]);
    // Copies with no life come after, never ahead of one with a life.
    const firstNone = life.items.findIndex((i) => i.lifeG == null);
    expect(firstNone).toBeGreaterThanOrEqual(3);
    expect(life.items.find((i) => i.dieInstanceId === a.copyId)).toMatchObject({ producedG: 234_200, runs: 1, lifeG: 468_400, remainingG: 234_200, reached: false });
    expect(life.counts).toMatchObject({ withLife: 3, reached: 0, near: 1 });

    // 234.2 kg of 260.223 kg is 8999.99 bp: it rounds to 9000, so the row and the count both say near.
    await setLife(a.copyId, 260_223);
    life = await office.analytics.dieLife({});
    expect(life.items.find((i) => i.dieInstanceId === a.copyId)).toMatchObject({ usedBp: 9000, state: "near" });
    expect(life.counts.near).toBe(2);
    await setLife(a.copyId, kg(468.4));

    await setLife(b.copyId, kg(150));
    life = await office.analytics.dieLife({ withLife: true });
    expect(life.items[0]).toMatchObject({ dieInstanceId: b.copyId, usedBp: 12_000, usedPct: "120.0", state: "reached", reached: true, remainingG: -30_000 });
    expect(life.items.every((i) => i.lifeG != null)).toBe(true);
    expect(life.counts).toMatchObject({ withLife: 3, reached: 1, near: 0 });

    // One copy (the die card's Runs header) agrees with the card's own producedG / lifeReached.
    const one = await p.as("die_room").analytics.dieLife({ dieInstanceId: b.copyId });
    const card = await p.as("die_room").dieInstance.get({ id: b.copyId });
    expect(one.items).toHaveLength(1);
    expect(one.items[0]!.producedG).toBe(card.producedG);
    expect(one.items[0]!.reached).toBe(card.lifeReached);

    // Retired copies drop out unless asked for.
    await env.db.update(dieInstance).set({ status: "retired" }).where(eq(dieInstance.id, idle));
    expect((await office.analytics.dieLife({ withLife: true })).items.map((i) => i.dieInstanceId)).not.toContain(idle);
    expect((await office.analytics.dieLife({ withLife: true, includeRetired: true })).items.map((i) => i.dieInstanceId)).toContain(idle);

    // reports.read, plus the die room (die.card) and die.reading holders for the card; others refused.
    for (const role of ROLES) {
      const call = p.as(role).analytics.dieLife({ dieInstanceId: a.copyId });
      if (["packer", "foundry", "storekeeper", "operator"].includes(role)) await expect(call).rejects.toMatchObject({ code: "FORBIDDEN" });
      else expect((await call).items).toHaveLength(1);
    }
    // Another plant's copy is not there.
    const q = await pressPlant();
    expect((await q.as("office").analytics.dieLife({ dieInstanceId: a.copyId })).items).toEqual([]);
  });
});
