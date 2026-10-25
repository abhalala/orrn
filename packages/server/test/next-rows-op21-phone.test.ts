/**
 * W4-NEXTROWS FP-OP-21: `plans.phone` for the owner's phone, read-only. Released plans with per-die
 * lengths, planned vs pressed pcs/kg (logged runs only) and the run-state chip; the summary is the
 * FP-PR-18 day summary. Floor roles without reports.read / order.plan are refused.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { pickPhonePlans } from "../src/lib/planPhoneView";
import { createTestEnv, type TestEnv } from "./harness";
import { fillWorkedExample, kg, pressHelpers } from "./press-w2-fixture";

setDefaultTimeout(60_000);

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { pressPlant } = pressHelpers(() => env);

describe("plans.phone (FP-OP-21)", () => {
  test("a released plan: planned per length, chip follows the run, pressed only once logged; summary matches", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun({ pcs: 100 });

    const queued = await p.owner.plans.phone();
    const plan = queued.plans.find((x) => x.id === r.planId)!;
    expect(plan.pressLine?.code).toBe("P1");
    expect(plan.dies).toHaveLength(1);
    const d0 = plan.dies[0]!;
    expect(d0.state).toBe("queued");
    expect(d0.lengths).toHaveLength(1);
    expect(d0.lengths[0]).toMatchObject({ cutLengthMm: 3_658, plannedPcs: 100, pressedPcs: 0, pressedG: 0 });
    expect(d0.plannedG).toBeGreaterThan(0);
    expect(d0).not.toHaveProperty("ratePaise");

    // Run it to counting: the chip moves, nothing pressed yet.
    await p.issue(r.runId, r.copyId);
    await p.as("press").press.runs.start({ id: r.runId });
    expect((await p.owner.plans.phone({ planId: r.planId })).plans[0]!.dies[0]!.state).toBe("running");
    await p.as("press").press.runs.stop({ id: r.runId });
    await p.as("press").press.runs.count({ id: r.runId });
    const c = await p.castWith(kg(400));
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    const counting = (await p.owner.plans.phone({ planId: r.planId })).plans[0]!.dies[0]!;
    expect(counting).toMatchObject({ state: "counting", pressedPcs: 0, pressedG: 0 });

    await p.as("supervisor").press.runs.close({ id: r.runId });
    const after = await p.as("office").plans.phone({ planId: r.planId });
    const d = after.plans[0]!.dies[0]!;
    // Worked example: 80 pcs, 234.2 kg good at 12 ft.
    expect(d).toMatchObject({ state: "logged", pressedPcs: 80, pressedG: kg(234.2) });
    expect(d.lengths[0]).toMatchObject({ cutLengthMm: 3_658, plannedPcs: 100, pressedPcs: 80, pressedG: kg(234.2) });
    expect(d.pressedBp).toBe(Math.round((kg(234.2) * 10_000) / d.plannedG));
    expect(after.plans[0]!.pressedG).toBe(kg(234.2));
    // The summary is the day summary (FP-PR-18) of the same day.
    const day = await p.owner.press.summary({});
    expect(after.summary).toMatchObject({ productionDay: day.productionDay, runs: day.runs, kgG: day.kgG, recoveryBp: day.recoveryBp });
  });

  test("only released plans by default; floor roles are refused", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun({ pcs: 10 });
    expect((await p.owner.plans.phone()).plans.map((x) => x.id)).toContain(r.planId);
    await expect(p.as("packer").plans.phone()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("press").plans.phone()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("viewer").plans.phone()).resolves.toBeTruthy();
    // Another plant's plan is not there.
    const q = await pressPlant();
    expect((await q.owner.plans.phone({ planId: r.planId })).plans).toEqual([]);
  });

  test("5 released plans: the one on the press now is first and always there, then upcoming, then recent (I-2)", async () => {
    const p = await pressPlant();
    const H = 3_600_000;
    const now = Date.now();
    // Made in the order a planner would: tomorrow and the day after first, today's last, an old one too.
    const day2 = await p.queuedRun({ pcs: 10, window: { start: now + 50 * H, end: now + 58 * H } });
    const day3 = await p.queuedRun({ pcs: 10, window: { start: now + 74 * H, end: now + 82 * H } });
    const tomorrow = await p.queuedRun({ pcs: 10, window: { start: now + 26 * H, end: now + 34 * H } });
    const yesterday = await p.queuedRun({ pcs: 10, window: { start: now - 30 * H, end: now - 22 * H } });
    const today = await p.queuedRun({ pcs: 10, window: { start: now - H, end: now + 7 * H } });

    const got = (await p.owner.plans.phone()).plans;
    // The cap is one current + two upcoming + one recent: the third upcoming plan is the one left off.
    expect(got.map((x) => [x.id, x.phase])).toEqual([
      [today.planId, "now"],
      [tomorrow.planId, "next"],
      [day2.planId, "next"],
      [yesterday.planId, "recent"],
    ]);
    expect(got.map((x) => x.id)).not.toContain(day3.planId);
    // By id it is there whatever the list holds.
    expect((await p.owner.plans.phone({ planId: day3.planId })).plans.map((x) => [x.id, x.phase])).toEqual([[day3.planId, "next"]]);
  });

  test("grouped per press line; plans covering now are never cut by the cap", () => {
    const H = 3_600_000;
    const now = 1_000 * H;
    const row = (id: string, lineKey: string | null, from: number, to: number) => ({ id, lineKey, windowStart: now + from * H, windowEnd: now + to * H });
    const rows = [
      row("p2-next-a", "P2", 24, 32),
      row("none-now", null, -1, 7),
      row("p1-recent-old", "P1", -60, -52),
      row("p1-next-c", "P1", 80, 88),
      row("p1-next-a", "P1", 24, 32),
      row("p1-now-b", "P1", -2, 6),
      row("p1-recent-new", "P1", -30, -22),
      row("p2-now", "P2", -1, 7),
      row("p1-next-b", "P1", 48, 56),
      row("p1-now-a", "P1", -3, 5),
    ];
    expect(pickPhonePlans(rows, now).map((r) => r.id)).toEqual([
      "p1-now-a",
      "p1-now-b",
      "p1-next-a",
      "p1-next-b",
      "p1-recent-new",
      "p2-now",
      "p2-next-a",
      "none-now",
    ]);
    // Five plans on the press at once are all kept, though the cap is lower.
    const many = ["a", "b", "c", "d", "e"].map((id, n) => row(id, "P1", -5 + n, 5));
    expect(pickPhonePlans(many, now, { upcoming: 0, recent: 0 }).map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
    // The window end is exclusive: a plan that ended this instant is recent, one starting this instant is current.
    expect(pickPhonePlans([row("ended", "P1", -8, 0), row("starts", "P1", 0, 8)], now).map((r) => [r.id, r.phase])).toEqual([["starts", "now"], ["ended", "recent"]]);
  });
});
