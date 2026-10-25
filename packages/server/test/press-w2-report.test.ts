/**
 * FP-PR-17 press report (17 columns, CSV, filters incl. planId), FP-PR-18 summary + Today's
 * pressedToday, FP-PR-24 late share, D1 ≤ 100 bound parameters on bulk run lines / QC rows.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { pressRun, pressRunLine, qcEntry } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { createTestEnv, D1_MAX_PARAMS, type TestEnv } from "./harness";
import { fillWorkedExample, kg, pressHelpers, type PressPlant } from "./press-w2-fixture";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { pressPlant } = pressHelpers(() => env);

async function loggedRun(p: PressPlant, castId: string, o: Parameters<PressPlant["countingRun"]>[0] = {}, before?: (runId: string) => Promise<unknown>) {
  const r = await p.countingRun(o);
  await fillWorkedExample(p, r.runId, castId, { planLineId: r.planLineIds[0] });
  if (before) await before(r.runId);
  await p.as("supervisor").press.runs.close({ id: r.runId });
  const [row] = await env.db.select().from(pressRun).where(eq(pressRun.id, r.runId));
  return { ...r, row: row! };
}

describe("press report (FP-PR-17)", () => {
  test("17 columns, values from the run; CSV with the same columns; planId and line filters; late share", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(2_000));
    const a = await loggedRun(p, c.id, {}, async (runId) => {
      const d = await p.as("press").press.downtime.start({ pressLineId: p.pressLineId, pressRunId: runId, reasonCodeId: await p.code("downtime", "billet_wait") });
      await p.as("press").press.downtime.stop({ id: d.id });
    });
    const b = await loggedRun(p, c.id);
    const day = a.row.productionDay!;

    await expect(p.as("press").press.report({ from: day, to: day })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const rep = await p.as("office").press.report({ from: day, to: day });
    expect(rep.columns).toHaveLength(17);
    expect(rep.columns).toEqual([
      "runNo", "productionDay", "shift", "line", "operator", "section", "copy", "orders", "cutLengths", "cast", "billets",
      "startedStopped", "runningMin", "downtimeMin", "good", "scrap", "recovery",
    ]);
    expect(rep.rows.map((r) => r.id).sort()).toEqual([a.runId, b.runId].sort());
    const row = rep.rows.find((r) => r.id === a.runId)!;
    expect(row.cells).toMatchObject({
      runNo: a.row.number,
      productionDay: day,
      line: "P1",
      orders: a.orderNumber,
      cutLengths: "3658",
      cast: c.number,
      billets: "8 / 310.400",
      good: "234.200 / 80",
      scrap: "44.800",
      recovery: "75.5",
    });
    expect(row.downtimeCodes).toEqual(["billet_wait"]);
    expect(rep.totals).toMatchObject({ runs: 2, goodG: 468_400, inputG: 620_800, recoveryBp: 7545, lateRuns: 0 });

    const csv = await p.as("office").press.report({ from: day, to: day, format: "csv" });
    const lines = csv.csv!.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]!.match(/"[^"]*"|[^,]+/g)).toHaveLength(17);
    expect(lines[0]).toContain('"Butt, ends and rejects kg"');
    expect(lines[0]).toStartWith("Run no,Production day,Shift,Press line,Operator,Section,Die copy,Orders");
    expect(lines[0]).toEndWith("Recovery %");
    expect(lines.some((l) => l.includes(a.row.number) && l.endsWith(",75.5"))).toBe(true);
    expect((await p.as("office").press.report({ from: day, to: day })).csv).toBeNull();

    // planId filter (rank 31) and line filter.
    const onlyA = await p.as("office").press.report({ from: day, to: day, planId: a.planId });
    expect(onlyA.rows.map((r) => r.id)).toEqual([a.runId]);
    const other = await p.as("manager").press.lines.create({ code: "P9", name: "Press 9" });
    expect((await p.as("office").press.report({ from: day, to: day, pressLineId: other.id })).rows).toEqual([]);
    await expect(p.as("office").press.report({ from: day, to: "2000-01-01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("late entries: their own flag, late share per shift and operator; trial runs are their own rows", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(5_000));
    const normal = await loggedRun(p, c.id);
    const day = normal.row.productionDay!;
    const sectionId = await p.section();
    const copyId = await p.copy(sectionId, { milli: 12_000 });
    const now = Date.now();
    const late = await p.as("supervisor").press.runs.open({
      pressLineId: p.pressLineId,
      dieInstanceId: copyId,
      startedAt: now - 60_000 * 30,
      stoppedAt: now - 60_000 * 5,
      operatorId: p.users.press.id,
      reason: "Entered after the shift",
    });
    await fillWorkedExample(p, late.id, c.id);
    await p.as("manager").approval.decide({ id: late.approvalId!, decision: "approved" });
    await p.as("supervisor").press.runs.close({ id: late.id });
    const [lateRow] = await env.db.select().from(pressRun).where(eq(pressRun.id, late.id));
    const trial = await p.countingRun({ purpose: "sample" });
    await fillWorkedExample(p, trial.runId, c.id);
    await p.as("supervisor").press.runs.close({ id: trial.runId });

    const rep = await p.as("manager").press.report({ from: lateRow!.productionDay! < day ? lateRow!.productionDay! : day, to: day > lateRow!.productionDay! ? day : lateRow!.productionDay! });
    const lr = rep.rows.find((r) => r.id === late.id)!;
    expect(lr.lateEntry).toBe(true);
    expect(rep.totals.lateRuns).toBe(1);
    expect(rep.totals.lateShareBp).toBe(3333);
    const share = rep.lateShare.find((s) => s.operatorId === p.users.press.id && s.shiftSeq === lr.shiftSeq)!;
    expect(share.lateRuns).toBe(1);
    const tr = rep.rows.find((r) => r.id === trial.runId)!;
    expect(tr).toMatchObject({ trial: true, purpose: "sample" });
    expect(tr.cells.orders).toBe("sample");
  });
});

describe("summary and Today (FP-PR-18)", () => {
  test("press.summary and dashboard.today.pressedToday {kgG, recoveryBp, downtimeMin, byLine}", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(2_000));
    const a = await loggedRun(p, c.id);
    const today = await p.as("supervisor").dashboard.today();
    expect(today.pressedToday).toMatchObject({ kgG: 234_200, recoveryBp: 7545, runs: 1, lateRuns: 0 });
    expect(today.pressedToday!.byLine).toEqual([expect.objectContaining({ code: "P1", kgG: 234_200, recoveryBp: 7545, runs: 1 })]);
    expect((await p.as("viewer").dashboard.today()).pressedToday).toBeNull();

    const d = await p.as("press").press.downtime.start({ pressLineId: p.pressLineId, reasonCodeId: await p.code("downtime", "power") });
    await p.as("press").press.downtime.stop({ id: d.id });
    const s = await p.as("press").press.summary({ productionDay: a.row.productionDay! });
    expect(s).toMatchObject({ runs: 1, kgG: 234_200, inputG: 310_400, recoveryBp: 7545 });
    expect(s.downtimeByReason.map((x) => x.code)).toEqual(["power"]);
    expect(s.byShift).toHaveLength(1);
    // Default day = the current production day.
    expect((await p.as("supervisor").press.summary({})).productionDay).toBe(today.date);
    await expect(p.as("packer").press.summary({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("D1 limits and permissions on bulk rows", () => {
  test("50 run lines and 30 QC rows stay ≤ 100 bound params per statement; upsert keeps line ids", async () => {
    const p = await pressPlant();
    const r = await p.countingRun();
    const press = p.as("press").press.runs;
    // I-3: every row of a production run names its plan line.
    const rows = Array.from({ length: 50 }, (_, i) => ({ cutLengthMm: 3_000 + i, pcs: 1, goodG: kg(1), pressPlanLineId: r.planLineIds[0] }));
    env.resetPeakParams();
    await press.lines({ id: r.runId, rows });
    const before = await env.db.select().from(pressRunLine).where(eq(pressRunLine.pressRunId, r.runId));
    await press.qc({ id: r.runId, rows: Array.from({ length: 30 }, (_, i) => ({ pcs: 1, kgG: 100, reasonCodeId: null, runLine: i + 21 })) });
    expect(env.peakParams()).toBeLessThanOrEqual(D1_MAX_PARAMS);
    expect(before).toHaveLength(50);
    await press.lines({ id: r.runId, rows: rows.slice(0, 40).map((x) => ({ ...x, pcs: 2 })) });
    const after = await env.db.select().from(pressRunLine).where(eq(pressRunLine.pressRunId, r.runId));
    expect(after).toHaveLength(40);
    expect(after.every((x) => x.pcs === 2)).toBe(true);
    const ids = new Map(before.map((x) => [x.line, x.id]));
    expect(after.every((x) => ids.get(x.line) === x.id)).toBe(true);
    // QC rows on removed lines lose the link (FK set null), the rest keep it.
    const qc = await env.db.select().from(qcEntry).where(eq(qcEntry.pressRunId, r.runId));
    expect(qc.filter((q) => q.pressRunLineId === null)).toHaveLength(10);
    await expect(press.lines({ id: r.runId, rows: Array.from({ length: 51 }, () => rows[0]!) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("preview for a press role shows no_close_permission; counting writes need press.run", async () => {
    const p = await pressPlant();
    const c = await p.castWith(kg(500));
    const r = await p.countingRun();
    await fillWorkedExample(p, r.runId, c.id);
    expect((await p.as("press").press.runs.preview({ id: r.runId })).gates).toEqual(["no_close_permission"]);
    await expect(p.as("office").press.runs.lines({ id: r.runId, rows: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("office").press.runs.close({ id: r.runId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
