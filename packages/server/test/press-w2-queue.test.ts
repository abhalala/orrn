/**
 * FP-PR-01 press lines master, FP-PR-02 the queue of a line (job card per die across parties, SO
 * numbers), FP-PR-25 queue changes after release (reorder, urgent, pull back; `press.queue`; audit
 * per change).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, pressLine, pressPlanLine, pressRun } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { pressHelpers } from "./press-w2-fixture";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { pressPlant } = pressHelpers(() => env);

describe("press lines (FP-PR-01)", () => {
  test("create / update / retire / restore with masters.publish; code unique; retire refused while a run is open", async () => {
    const p = await pressPlant();
    await expect(p.as("supervisor").press.lines.create({ code: "P2", name: "Press 2" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { id } = await p.as("manager").press.lines.create({ code: "p2", name: "Press 2", tonnageT: 1_460 });
    await expect(p.as("admin").press.lines.create({ code: "P2", name: "Dup" })).rejects.toMatchObject({ code: "CONFLICT" });
    await p.as("admin").press.lines.update({ id, name: "Press two", tonnageT: null });
    const [row] = await env.db.select().from(pressLine).where(eq(pressLine.id, id));
    expect(row).toMatchObject({ code: "P2", name: "Press two", tonnageT: null });

    await p.queuedRun();
    await expect(p.as("manager").press.lines.retire({ id: p.pressLineId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.as("manager").press.lines.retire({ id });
    expect((await p.as("press").press.lines.list()).map((l) => l.code)).toEqual(["P1"]);
    expect((await p.as("press").press.lines.list({ includeRetired: true })).map((l) => l.code).sort()).toEqual(["P1", "P2"]);
    await p.as("manager").press.lines.restore({ id });
    const acts = (await env.db.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.subjectId, id))).map((a) => a.a);
    expect(acts.sort()).toEqual(["press_line.create", "press_line.restore", "press_line.retire", "press_line.update"]);
  });
});

describe("queue of a line (FP-PR-02, rank 31)", () => {
  test("job card per die: SO numbers, cut lengths, pcs + kg, totals, copy and bolster; running first", async () => {
    const p = await pressPlant();
    const a = await p.queuedRun();
    const b = await p.queuedRun();
    await p.issue(a.runId, a.copyId);
    await p.as("press").press.runs.start({ id: a.runId });
    const q = await p.as("press").press.queue.list({ pressLineId: p.pressLineId });
    expect(q.cards.map((c) => [c.id, c.status, c.reorderable])).toEqual([
      [a.runId, "running", false],
      [b.runId, "queued", true],
    ]);
    const card = q.cards[1]!;
    expect(card.orders).toEqual([b.orderNumber]);
    expect(card.orders[0]).toMatch(/^SO-\d+$/);
    expect(card.lines[0]).toMatchObject({ orderNumber: b.orderNumber, cutLengthMm: 3_658, pcs: 100 });
    expect(card.totals.kgG).toBe(card.lines[0]!.kgG);
    expect(q.cards[0]!.copyCode).toMatch(/^C-/);
    // The lines board: the running run's number and the queue count of this line only.
    const other = await p.as("manager").press.lines.create({ code: "P7", name: "Press 7" });
    const board = await p.as("press").press.lines.list();
    expect(board.find((l) => l.id === p.pressLineId)).toMatchObject({ running: q.cards[0]!.number, queued: 1, openDowntime: false });
    expect(board.find((l) => l.id === other.id)).toMatchObject({ running: null, queued: 0 });
    // Filters
    expect((await p.as("press").press.queue.list({ pressLineId: p.pressLineId, salesOrderId: b.orderId })).cards.map((c) => c.id)).toEqual([b.runId]);
    expect((await p.as("press").press.queue.list({ pressLineId: p.pressLineId, sectionId: a.sectionId })).cards.map((c) => c.id)).toEqual([a.runId]);
  });
});

describe("queue changes after release (FP-PR-25)", () => {
  test("move: new positions, one audit row per change; running runs never move; press role refused", async () => {
    const p = await pressPlant();
    const a = await p.queuedRun();
    const b = await p.queuedRun();
    const c = await p.queuedRun();
    await expect(p.as("press").press.queue.move({ runId: c.runId, toIndex: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const out = await p.as("office").press.queue.move({ runId: c.runId, toIndex: 0 });
    expect(out.order.map((o) => o.id)).toEqual([c.runId, a.runId, b.runId]);
    const q = await p.as("supervisor").press.queue.list({ pressLineId: p.pressLineId });
    expect(q.cards.map((x) => x.id)).toEqual([c.runId, a.runId, b.runId]);
    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.subjectId, c.runId), eq(auditLog.action, "press_run.queue_move")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({ from: 2, to: 0 });
    // Urgent goes first whatever the position.
    await p.as("supervisor").press.queue.urgent({ runId: b.runId, urgent: true });
    expect((await p.as("supervisor").press.queue.list({ pressLineId: p.pressLineId })).cards.map((x) => x.id)).toEqual([b.runId, c.runId, a.runId]);
    // m-7: a move may not cross the urgent boundary (the list would contradict it).
    await expect(p.as("supervisor").press.queue.move({ runId: a.runId, toIndex: 0 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Urgent runs stay at the top"),
    });
    await expect(p.as("supervisor").press.queue.move({ runId: b.runId, toIndex: 2 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await p.as("supervisor").press.queue.move({ runId: a.runId, toIndex: 1 })).order.map((o) => o.id)).toEqual([b.runId, a.runId, c.runId]);
    expect((await p.as("supervisor").press.queue.list({ pressLineId: p.pressLineId })).cards.map((x) => x.id)).toEqual([b.runId, a.runId, c.runId]);
    // A running run can't move.
    await p.issue(a.runId, a.copyId);
    await p.as("press").press.runs.start({ id: a.runId });
    await expect(p.as("manager").press.queue.move({ runId: a.runId, toIndex: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("pull back one cut length: the plan line goes, kg is planable again; last line refused", async () => {
    const p = await pressPlant();
    const sectionId = await p.section();
    await p.copy(sectionId, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId, pcs: 100 }, { sectionId, pcs: 50, mm: 5_486 }]);
    const now = Date.now();
    const plan = await p.as("office").plans.create({
      windowStart: now,
      windowEnd: now + 3_600_000,
      pressLineId: p.pressLineId,
      dies: [{ sectionId, lines: [{ salesOrderLineId: o.lineIds[0]!, pcs: 40 }, { salesOrderLineId: o.lineIds[1]!, pcs: 20 }] }],
    });
    const rel = await p.as("manager").plans.release({ id: plan.id });
    const runId = rel.runs[0]!.id;
    const lines = await env.db.select().from(pressPlanLine).where(eq(pressPlanLine.pressPlanId, plan.id));
    const second = lines.find((l) => l.salesOrderLineId === o.lineIds[1])!;
    const before = (await p.owner.orders.balance({ orderId: o.id })).lines.find((l) => l.lineId === o.lineIds[1])!.strip;
    expect(before.plannedG).toBe(second.kgG);
    await expect(p.as("press").press.queue.pullBack({ pressPlanLineId: second.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("supervisor").press.queue.pullBack({ pressPlanLineId: second.id, reason: "Customer asked to wait" });
    const after = (await p.owner.orders.balance({ orderId: o.id })).lines.find((l) => l.lineId === o.lineIds[1])!.strip;
    expect(after.plannedG).toBe(0);
    expect(after.planableG).toBe(before.planableG + second.kgG);
    const first = lines.find((l) => l.salesOrderLineId === o.lineIds[0])!;
    await expect(p.as("supervisor").press.queue.pullBack({ pressPlanLineId: first.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("void the run") });
    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.subjectId, runId), eq(auditLog.action, "press_plan_line.pull_back")));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({ pressPlanLineId: second.id, kgG: second.kgG, reason: "Customer asked to wait" });
    // Once started, nothing can be pulled back.
    const [run] = await env.db.select().from(pressRun).where(eq(pressRun.id, runId));
    expect(run!.status).toBe("queued");
  });
});
