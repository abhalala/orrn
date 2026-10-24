/**
 * FP-PR-03/04/05/06/12/13/14/15 station transitions (specs §E3): start lock via the die issue,
 * one running run per line, server time + skew → press_time, pause / undo start, count, void,
 * handover, downtime rows, remarks, drawing, idempotent replays, permissions.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { approval, auditLog, dieInstance, dieIssue, dieRemark, pressDowntime, pressRemark, pressRun } from "@orrn/db/schema";
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

async function run(id: string) {
  const [row] = await env.db.select().from(pressRun).where(eq(pressRun.id, id));
  return row!;
}
async function audits(subjectId: string) {
  return (await env.db.select({ a: auditLog.action }).from(auditLog).where(eq(auditLog.subjectId, subjectId))).map((r) => r.a);
}

describe("start lock (FP-PR-04)", () => {
  test("a queued run refuses start: 'Die not issued. Start is locked.'", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    await expect(p.as("press").press.runs.start({ id: r.runId })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Die not issued. Start is locked." });
    expect((await run(r.runId)).status).toBe("queued");
  });

  test("die_issued + open issue matching copy and line → running, server time, shift, operator; audit press_run.start", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    await p.issue(r.runId, r.copyId);
    const before = Date.now();
    const out = await p.as("press").press.runs.start({ id: r.runId });
    expect(out).toMatchObject({ status: "running", timeUnconfirmed: false, replayed: false });
    const row = await run(r.runId);
    expect(row.status).toBe("running");
    expect(row.startedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.dieInAt).not.toBeNull();
    expect(row.operatorId).toBe(p.users.press.id);
    expect(row.supervisorId).toBeNull();
    expect(row.productionDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await audits(r.runId)).toContain("press_run.start");
  });

  test("start by plan die id works the same", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    await p.issue(r.runId, r.copyId);
    const got = await p.owner.plans.get({ id: r.planId });
    await p.as("supervisor").press.runs.start({ pressPlanDieId: got.dies[0]!.id });
    const row = await run(r.runId);
    expect(row.status).toBe("running");
    // A supervisor who starts it is its supervisor.
    expect(row.supervisorId).toBe(p.users.supervisor.id);
  });

  test("an issue cancelled behind the run's back (row hacked) refuses start", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    const issueId = await p.issue(r.runId, r.copyId);
    await env.db.update(dieIssue).set({ status: "cancelled" }).where(eq(dieIssue.id, issueId));
    await expect(p.as("press").press.runs.start({ id: r.runId })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Die not issued. Start is locked." });
  });

  test("shift from company settings at the start instant", async () => {
    const p = await pressPlant({
      settings: {
        timezone: "Asia/Kolkata",
        shifts: [
          { id: "s-day", name: "Day", seq: 1, startMin: 0, endMin: 720 },
          { id: "s-night", name: "Night", seq: 2, startMin: 720, endMin: 0 },
        ],
      },
    });
    const r = await p.queuedRun();
    await p.issue(r.runId, r.copyId);
    await p.as("press").press.runs.start({ id: r.runId });
    const row = await run(r.runId);
    expect(["s-day", "s-night"]).toContain(row.shiftId!);
    expect(row.shiftSeq).toBe(row.shiftId === "s-day" ? 1 : 2);
  });
});

describe("one running run per line", () => {
  test("a second start on the same press is CONFLICT", async () => {
    const p = await pressPlant();
    const a = await p.queuedRun();
    const b = await p.queuedRun();
    await p.issue(a.runId, a.copyId);
    await p.issue(b.runId, b.copyId);
    await p.as("press").press.runs.start({ id: a.runId });
    await expect(p.as("press").press.runs.start({ id: b.runId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await run(b.runId)).status).toBe("die_issued");
    // Race: the other start lands between the read and the write → the partial unique index.
    await p.as("press").press.runs.stop({ id: a.runId });
    env.beforeNextBatch(() => env.db.update(pressRun).set({ status: "running" }).where(eq(pressRun.id, a.runId)));
    await expect(p.as("press").press.runs.start({ id: b.runId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await run(b.runId)).status).toBe("die_issued");
  });

  test("resume refuses while another run runs; works when free", async () => {
    const p = await pressPlant();
    const a = await p.queuedRun();
    const b = await p.queuedRun();
    await p.issue(a.runId, a.copyId);
    await p.issue(b.runId, b.copyId);
    const press = p.as("press").press.runs;
    await press.start({ id: a.runId });
    await press.stop({ id: a.runId });
    await press.start({ id: b.runId });
    await expect(press.resume({ id: a.runId })).rejects.toMatchObject({ code: "CONFLICT" });
    await press.stop({ id: b.runId });
    await press.resume({ id: a.runId });
    expect((await run(a.runId)).status).toBe("running");
    expect((await run(a.runId)).stoppedAt).toBeNull();
  });
});

describe("every transition and its refusals", () => {
  test("stop / count need the right state; undoStart goes back to die_issued", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    const press = p.as("press").press.runs;
    await p.issue(r.runId, r.copyId);
    await expect(press.stop({ id: r.runId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(press.count({ id: r.runId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await press.start({ id: r.runId });
    await expect(press.count({ id: r.runId })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("stop the run") });
    await press.undoStart({ id: r.runId });
    const back = await run(r.runId);
    expect(back).toMatchObject({ status: "die_issued", startedAt: null, dieInAt: null, productionDay: null });
    await press.start({ id: r.runId });
    await press.stop({ id: r.runId });
    await expect(press.undoStart({ id: r.runId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await press.count({ id: r.runId });
    const counted = await run(r.runId);
    expect(counted.status).toBe("counting");
    expect(counted.dieOutAt).not.toBeNull();
    await expect(press.start({ id: r.runId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(press.resume({ id: r.runId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await audits(r.runId)).filter((a) => a.startsWith("press_run.")).sort()).toEqual(
      ["press_run.count", "press_run.start", "press_run.start", "press_run.stop", "press_run.undo_start"].sort(),
    );
  });

  test("void: queued and die_issued only, reason code kind void; die_issued gives the copy back", async () => {
    const p = await pressPlant();
    const a = await p.queuedRun();
    const sup = p.as("supervisor").press.runs;
    const voidCode = await p.code("void", "other");
    await expect(sup.void({ id: a.runId, reasonCodeId: voidCode })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("note") });
    await expect(sup.void({ id: a.runId, reasonCodeId: await p.code("downtime", "power") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await sup.void({ id: a.runId, reasonCodeId: voidCode, note: "Order changed" });
    expect(await run(a.runId)).toMatchObject({ status: "voided", voidNote: "Order changed" });

    const b = await p.queuedRun();
    await p.issue(b.runId, b.copyId);
    await sup.void({ id: b.runId, reasonCodeId: voidCode, note: "Die cracked" });
    expect((await run(b.runId)).status).toBe("voided");
    const [copy] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, b.copyId));
    expect(copy!.status).toBe("available");
    const issues = await env.db.select().from(dieIssue).where(eq(dieIssue.pressRunId, b.runId));
    expect(issues.map((i) => i.status)).toEqual(["cancelled"]);

    const c = await p.countingRun();
    await expect(sup.void({ id: c.runId, reasonCodeId: voidCode, note: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Office (order.plan) may void a queued run; press may not.
    const d = await p.queuedRun();
    await expect(p.as("press").press.runs.void({ id: d.runId, reasonCodeId: voidCode, note: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("office").press.runs.void({ id: d.runId, reasonCodeId: voidCode, note: "x" });
    expect(await audits(d.runId)).toContain("press_run.void");
  });

  test("handover sets operator, relief and supervisor (supervisor must hold press.close)", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    await p.issue(r.runId, r.copyId);
    const press = p.as("press").press.runs;
    await press.start({ id: r.runId });
    await expect(press.handover({ id: r.runId, supervisorId: p.users.packer.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await press.handover({ id: r.runId, reliefOperatorId: p.users.operator.id, supervisorId: p.users.supervisor.id });
    expect(await run(r.runId)).toMatchObject({ reliefOperatorId: p.users.operator.id, supervisorId: p.users.supervisor.id, operatorId: p.users.press.id });
    expect(await audits(r.runId)).toContain("press_run.handover");
  });
});

describe("server time and skew (FP-PR-06)", () => {
  test("tap within 2 min: confirmed; beyond 2 min: time_unconfirmed + one press_time approval", async () => {
    const p = await pressPlant();
    const a = await p.queuedRun();
    await p.issue(a.runId, a.copyId);
    const press = p.as("press").press.runs;
    await press.start({ id: a.runId, tappedAt: Date.now() - 119_000 });
    expect((await run(a.runId)).timeUnconfirmed).toBe(false);
    const out = await press.stop({ id: a.runId, tappedAt: Date.now() - 5 * 60_000 });
    expect(out.timeUnconfirmed).toBe(true);
    expect(out.approvalId).toBeString();
    const row = await run(a.runId);
    expect(row.timeUnconfirmed).toBe(true);
    expect(row.tappedStopAt).not.toBeNull();
    const reqs = await env.db.select().from(approval).where(and(eq(approval.subjectId, a.runId), eq(approval.kind, "press_time")));
    expect(reqs).toHaveLength(1);
    expect(reqs[0]!.requestedBy).toBe(p.users.press.id);
    // Asking again reuses the pending one.
    expect(await press.confirmTime({ id: a.runId })).toMatchObject({ approvalId: reqs[0]!.id, replayed: true });
    // The supervisor (approver, not the requester) confirms: the flag clears.
    await p.as("supervisor").approval.decide({ id: reqs[0]!.id, decision: "approved" });
    expect((await run(a.runId)).timeUnconfirmed).toBe(false);
  });

  test("future tap beyond 2 min also counts", async () => {
    const p = await pressPlant();
    const a = await p.queuedRun();
    await p.issue(a.runId, a.copyId);
    const out = await p.as("press").press.runs.start({ id: a.runId, tappedAt: Date.now() + 3 * 60_000 });
    expect(out.timeUnconfirmed).toBe(true);
  });
});

describe("idempotent replays (client_mutation_id)", () => {
  test("the same start / stop / count sent twice answers replayed and writes once", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    await p.issue(r.runId, r.copyId);
    const press = p.as("press").press.runs;
    await press.start({ id: r.runId, clientMutationId: "cm-start-0001" });
    expect(await press.start({ id: r.runId, clientMutationId: "cm-start-0001" })).toMatchObject({ replayed: true });
    await press.stop({ id: r.runId, clientMutationId: "cm-stop-00001" });
    expect(await press.stop({ id: r.runId, clientMutationId: "cm-stop-00001" })).toMatchObject({ replayed: true });
    await press.count({ id: r.runId, clientMutationId: "cm-count-0001" });
    expect(await press.count({ id: r.runId, clientMutationId: "cm-count-0001" })).toMatchObject({ replayed: true });
    const starts = (await audits(r.runId)).filter((a) => a === "press_run.start");
    expect(starts).toHaveLength(1);
  });
});

describe("downtime rows (FP-PR-12)", () => {
  test("start attaches the running run; one open per line; stop with server time; other needs a note", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    await p.issue(r.runId, r.copyId);
    const press = p.as("press").press;
    await press.runs.start({ id: r.runId });
    await expect(press.downtime.start({ pressLineId: p.pressLineId, reasonCodeId: await p.code("downtime", "other") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(press.downtime.start({ pressLineId: p.pressLineId, reasonCodeId: await p.code("qc_reject", "bend") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const d = await press.downtime.start({ pressLineId: p.pressLineId, reasonCodeId: await p.code("downtime", "billet_wait") });
    expect(d.pressRunId).toBe(r.runId);
    await expect(press.downtime.start({ pressLineId: p.pressLineId, reasonCodeId: await p.code("downtime", "power") })).rejects.toMatchObject({ code: "CONFLICT" });
    const open = await press.downtime.list({ pressLineId: p.pressLineId, openOnly: true });
    expect(open.map((x) => x.reasonCode)).toEqual(["billet_wait"]);
    const stopped = await press.downtime.stop({ id: d.id });
    expect(stopped.minutes).toBeGreaterThanOrEqual(0);
    const [row] = await env.db.select().from(pressDowntime).where(eq(pressDowntime.id, d.id));
    expect(row!.stoppedAt).not.toBeNull();
    expect(row!.stoppedBy).toBe(p.users.press.id);
    // A run with downtime can no longer be "undone".
    await expect(press.runs.undoStart({ id: r.runId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await audits(d.id)).toEqual(expect.arrayContaining(["press_downtime.start", "press_downtime.stop"]));
  });
});

describe("remarks and drawing (FP-PR-14/15)", () => {
  test("press and die remarks bind run + copy; the die card reads them by copy", async () => {
    const p = await pressPlant();
    const r = await p.countingRun();
    const press = p.as("press").press.runs;
    await press.remark({ id: r.runId, kind: "press", body: "Ram slow after 2 billets" });
    await press.remark({ id: r.runId, kind: "die", body: "Bearing marks on leg" });
    const [pr] = await env.db.select().from(pressRemark).where(eq(pressRemark.pressRunId, r.runId));
    expect(pr).toMatchObject({ dieInstanceId: r.copyId, body: "Ram slow after 2 billets" });
    const [dr] = await env.db.select().from(dieRemark).where(eq(dieRemark.pressRunId, r.runId));
    expect(dr).toMatchObject({ dieInstanceId: r.copyId, body: "Bearing marks on leg" });
    expect(await run(r.runId)).toMatchObject({ pressRemark: "Ram slow after 2 billets", dieRemark: "Bearing marks on leg" });
    const card = await p.as("die_room").press.runs.byCopy({ dieInstanceId: r.copyId });
    expect(card.runs.map((x) => x.id)).toEqual([r.runId]);
    expect(card.remarks.map((x) => x.body)).toEqual(["Bearing marks on leg"]);
  });

  test("drawing: no key → url null (an empty button, not a block)", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    expect(await p.as("press").press.runs.drawing({ id: r.runId })).toEqual({ url: null, expiresAt: null });
  });
});

describe("permissions", () => {
  test("press role starts / stops / counts; office and packer cannot start; get is open to members", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    await p.issue(r.runId, r.copyId);
    for (const role of ["office", "packer", "die_room", "viewer", "manager"] as const) {
      await expect(p.as(role).press.runs.start({ id: r.runId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await p.as("press").press.runs.start({ id: r.runId });
    const got = await p.as("viewer").press.runs.get({ id: r.runId });
    expect(got.run.status).toBe("running");
    expect(got.planLines[0]!.orderNumber).toBe(r.orderNumber);
  });

  test("module press off → mutations FORBIDDEN, reads open", async () => {
    const p = await pressPlant();
    const r = await p.queuedRun();
    await p.issue(r.runId, r.copyId);
    const { company } = await import("@orrn/db/schema");
    await env.db.update(company).set({ modules: ["orders", "dies", "bundles"] }).where(eq(company.id, p.companyId));
    await expect(p.as("press").press.runs.start({ id: r.runId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await p.as("press").press.runs.get({ id: r.runId })).run.status).toBe("die_issued");
  });
});
