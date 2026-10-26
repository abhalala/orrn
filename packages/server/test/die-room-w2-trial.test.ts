/**
 * Wave 2 die room, copy on trial (FP-DR-17, backlog 42): a new copy and a copy back from the maker
 * start `on_trial` while `dieRoom.newCopyOnTrial` is on; a production run refuses it, a die trial run
 * takes it; it becomes available by a passed trial run or by a manager with a reason; every move is
 * audited. Also the maker numbers (backlog 21).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, dieInstance, dieIssue, dieMakerJob, pressLine, pressPlan, pressRun } from "@orrn/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";

import { atomicBatch } from "../src/lib/atomic";
import type { DieRoomCtx } from "../src/lib/dieRoom";
import { applyTrialVerdictOnReturn } from "../src/lib/dieTrial";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.dispose();
});

let runNo = 0;

async function plant(settings: Record<string, unknown> = {}) {
  const { companyId, users } = await env.seedCompany({ settings });
  const sectionId = await env.seedDie(companyId, { series: "Domal", sectionCode: "12170", weightMinG: 5_900, weightMaxG: 6_200 });
  const lineId = crypto.randomUUID();
  await env.db.insert(pressLine).values({ id: lineId, companyId, code: "P1", name: "Press 1" });
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  const dieRoom = as("die_room");
  const { id: makerId } = await dieRoom.dieInstance.maker.create({ name: "Rajkot Dies" });
  /** What the press close runs as: a supervisor's server context (the seam takes a context, not a caller). */
  const closeCtx: DieRoomCtx = {
    db: env.db as never,
    companyId,
    session: { user: { id: users.supervisor.id, name: "Supervisor", email: users.supervisor.email }, session: { id: "test-session" } } as never,
  };
  return { companyId, sectionId, lineId, makerId, as, dieRoom, closeCtx, manager: as("manager"), supervisor: as("supervisor"), owner: as("owner") };
}
type Plant = Awaited<ReturnType<typeof plant>>;

async function copyRow(id: string) {
  const [r] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, id));
  return r!;
}

async function audits(copyId: string, prefix: string) {
  const rows = await env.db.select().from(auditLog).where(eq(auditLog.subjectId, copyId)).orderBy(auditLog.at);
  return rows.filter((r) => r.action.startsWith(prefix));
}

async function plan(p: Plant, purpose: "production" | "die_trial" | "sample" | "other") {
  const id = crypto.randomUUID();
  runNo += 1;
  await env.db.insert(pressPlan).values({
    id,
    companyId: p.companyId,
    number: `PP-${runNo}`,
    period: "2026-27",
    purpose,
    pressLineId: p.lineId,
    windowStart: new Date(),
    windowEnd: new Date(Date.now() + 3600_000),
  });
  return id;
}

/** A queued run of the section under a plan of `purpose`. */
async function queuedRun(p: Plant, purpose: "production" | "die_trial" | "sample" | "other" = "production") {
  const planId = await plan(p, purpose);
  const id = crypto.randomUUID();
  runNo += 1;
  await env.db.insert(pressRun).values({
    id,
    companyId: p.companyId,
    number: `PR-${runNo}`,
    period: "2026-27",
    status: "queued",
    sectionId: p.sectionId,
    pressLineId: p.lineId,
    planId,
  });
  return id;
}

/** What the press close of a trial run leaves: logged, with the verdict. */
async function logTrial(runId: string, copyId: string, result: "pass" | "fail") {
  await env.db.update(pressRun).set({ status: "logged", trialResult: result, dieInstanceId: copyId }).where(eq(pressRun.id, runId));
}

describe("a new copy starts on trial", () => {
  test("the setting defaults on: create gives on_trial; off gives available; the audit row carries the status", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    expect(a.status).toBe("on_trial");
    expect((await copyRow(a.id)).status).toBe("on_trial");
    expect((await audits(a.id, "die_instance.create"))[0]!.meta).toMatchObject({ status: "on_trial" });

    const off = await plant({ dieRoom: { newCopyOnTrial: false } });
    const b = await off.dieRoom.dieInstance.create({ sectionId: off.sectionId });
    expect(b.status).toBe("available");
  });

  test("the setting is read when the copy is made: the owner switches it with company.updateSettings", async () => {
    const p = await plant();
    await p.owner.company.updateSettings({ dieRoom: { newCopyOnTrial: false } });
    expect((await p.dieRoom.dieInstance.create({ sectionId: p.sectionId })).status).toBe("available");
    await p.owner.company.updateSettings({ dieRoom: { newCopyOnTrial: true } });
    expect((await p.dieRoom.dieInstance.create({ sectionId: p.sectionId })).status).toBe("on_trial");
  });

  test("starting a copy on the rack (status available) is for a manager; the die room is refused", async () => {
    const p = await plant();
    await expect(p.dieRoom.dieInstance.create({ sectionId: p.sectionId, status: "available" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await p.manager.dieInstance.create({ sectionId: p.sectionId, status: "available" })).status).toBe("available");
  });

  test("an on_trial copy cannot be set available by hand; it can be retired", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    await expect(p.dieRoom.dieInstance.update({ id: a.id, status: "available" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("on trial") });
    expect((await copyRow(a.id)).status).toBe("on_trial");
    // Card fields still edit while it is on trial.
    await p.dieRoom.dieInstance.update({ id: a.id, rackNo: "R-4" });
    await p.dieRoom.dieInstance.update({ id: a.id, status: "retired" });
    expect((await copyRow(a.id)).status).toBe("retired");
  });

  test("nitriding out is refused while on trial", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    await expect(p.dieRoom.dieInstance.nitridingOut({ dieInstanceId: a.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("is on trial"),
    });
    expect((await copyRow(a.id)).status).toBe("on_trial");
  });
});

describe("the maker returns a copy on trial", () => {
  test("receive puts the copy on trial while the setting is on, on the rack when off", async () => {
    const p = await plant();
    const a = await p.manager.dieInstance.create({ sectionId: p.sectionId, status: "available" });
    const sent = await p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: a.id, dieMakerId: p.makerId, purpose: "correction" });
    await p.dieRoom.dieInstance.maker.jobs.receive({ id: sent.id, trialKgPer12ftMilli: 5_950 });
    expect(await copyRow(a.id)).toMatchObject({ status: "on_trial", trialKgPer12ftMilli: 5_950 });
    expect((await audits(a.id, "die_maker_job.receive"))[0]!.meta).toMatchObject({ copyTo: "on_trial" });

    const off = await plant({ dieRoom: { newCopyOnTrial: false } });
    const b = await off.dieRoom.dieInstance.create({ sectionId: off.sectionId });
    const job = await off.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: b.id, dieMakerId: off.makerId, purpose: "repair" });
    await off.dieRoom.dieInstance.maker.jobs.receive({ id: job.id });
    expect((await copyRow(b.id)).status).toBe("available");
  });

  test("a copy on trial goes back to the maker, and a cancelled job puts it back on trial", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const sent = await p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: a.id, dieMakerId: p.makerId, purpose: "correction" });
    expect((await copyRow(a.id)).status).toBe("at_maker");
    await p.dieRoom.dieInstance.maker.jobs.cancel({ id: sent.id });
    expect((await copyRow(a.id)).status).toBe("on_trial");
    // A rack copy cancelled goes back to the rack.
    const b = await p.manager.dieInstance.create({ sectionId: p.sectionId, status: "available" });
    const job = await p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: b.id, dieMakerId: p.makerId, purpose: "repair" });
    await p.dieRoom.dieInstance.maker.jobs.cancel({ id: job.id });
    expect((await copyRow(b.id)).status).toBe("available");
  });
});

describe("issue: production refuses an on_trial copy, a die trial run takes it", () => {
  test("production, sample and other runs refuse; the copy stays on trial and nothing is written", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    for (const purpose of ["production", "sample", "other"] as const) {
      const runId = await queuedRun(p, purpose);
      await expect(
        p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: runId }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("on trial") });
      const [run] = await env.db.select().from(pressRun).where(eq(pressRun.id, runId));
      expect(run).toMatchObject({ status: "queued", dieInstanceId: null });
    }
    expect((await copyRow(a.id)).status).toBe("on_trial");
  });

  test("a run with no plan counts as production", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const id = crypto.randomUUID();
    await env.db.insert(pressRun).values({ id, companyId: p.companyId, number: "PR-NP", period: "2026-27", status: "queued", sectionId: p.sectionId, pressLineId: p.lineId });
    await expect(p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("a die trial run takes it; return and cancel put it back on trial", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const r1 = await queuedRun(p, "die_trial");
    const issued = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: r1 });
    expect((await copyRow(a.id)).status).toBe("in_use");
    expect((await audits(a.id, "die_issue.issue"))[0]!.meta).toMatchObject({ trial: 1, purpose: "die_trial" });
    await p.dieRoom.dieInstance.issues.return({ id: issued.id });
    expect((await copyRow(a.id)).status).toBe("on_trial");
    expect((await audits(a.id, "die_issue.return"))[0]!.meta).toMatchObject({ copyTo: "on_trial" });

    const r2 = await queuedRun(p, "die_trial");
    const again = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: r2 });
    await p.dieRoom.dieInstance.issues.cancel({ id: again.id });
    expect((await copyRow(a.id)).status).toBe("on_trial");
  });

  test("a rack copy on a die trial run goes back to the rack", async () => {
    const p = await plant();
    const a = await p.manager.dieInstance.create({ sectionId: p.sectionId, status: "available" });
    const runId = await queuedRun(p, "die_trial");
    const issued = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: runId });
    await p.dieRoom.dieInstance.issues.return({ id: issued.id });
    expect((await copyRow(a.id)).status).toBe("available");
  });

  test("a trial issue whose run is logged with a pass returns straight to the rack", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const runId = await queuedRun(p, "die_trial");
    const issued = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: runId });
    await env.db.update(pressRun).set({ status: "logged", trialResult: "pass" }).where(eq(pressRun.id, runId));
    await p.dieRoom.dieInstance.issues.return({ id: issued.id });
    expect((await copyRow(a.id)).status).toBe("available");
  });

  test("queuedRuns names the plan purpose", async () => {
    const p = await plant();
    const t = await queuedRun(p, "die_trial");
    const pr = await queuedRun(p, "production");
    const rows = await p.dieRoom.dieInstance.issues.queuedRuns({});
    expect(rows.find((r) => r.id === t)?.purpose).toBe("die_trial");
    expect(rows.find((r) => r.id === pr)?.purpose).toBe("production");
  });
});

describe("trial pass", () => {
  test("a logged die trial run with result pass makes the copy available; audit die_trial.pass", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const runId = await queuedRun(p, "die_trial");
    await logTrial(runId, a.id, "pass");
    const out = await p.supervisor.dieInstance.trialPass({ id: a.id, pressRunId: runId });
    expect(out.status).toBe("available");
    expect((await copyRow(a.id)).status).toBe("available");
    const rows = await audits(a.id, "die_trial.");
    expect(rows.map((r) => r.action)).toEqual(["die_trial.pass"]);
    expect(rows[0]!.meta).toMatchObject({ from: "on_trial", to: "available", pressRunId: runId });
    // Now it issues to a production run.
    const prod = await queuedRun(p, "production");
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: prod });
    expect((await copyRow(a.id)).status).toBe("in_use");
  });

  test("refused: not a trial plan, another copy, not logged, wrong verdict, copy not on trial", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const b = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const production = await queuedRun(p, "production");
    await logTrial(production, a.id, "pass");
    await expect(p.supervisor.dieInstance.trialPass({ id: a.id, pressRunId: production })).rejects.toMatchObject({ message: expect.stringContaining("not a die trial") });
    const trial = await queuedRun(p, "die_trial");
    await expect(p.supervisor.dieInstance.trialPass({ id: a.id, pressRunId: trial })).rejects.toMatchObject({ message: expect.stringContaining("did not press") });
    await env.db.update(pressRun).set({ dieInstanceId: a.id, trialResult: "pass" }).where(eq(pressRun.id, trial));
    await expect(p.supervisor.dieInstance.trialPass({ id: a.id, pressRunId: trial })).rejects.toMatchObject({ message: expect.stringContaining("not closed") });
    await logTrial(trial, a.id, "fail");
    await expect(p.supervisor.dieInstance.trialPass({ id: a.id, pressRunId: trial })).rejects.toMatchObject({ message: expect.stringContaining("marked fail") });
    await logTrial(trial, b.id, "pass");
    await p.supervisor.dieInstance.trialPass({ id: b.id, pressRunId: trial });
    await expect(p.supervisor.dieInstance.trialPass({ id: b.id, pressRunId: trial })).rejects.toMatchObject({ message: expect.stringContaining("not on trial") });
    expect((await copyRow(a.id)).status).toBe("on_trial");
  });

  test("a manager releases without a trial: reason required, audit die_trial.release with the reason", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    await expect(p.manager.dieInstance.trialPass({ id: a.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Say why") });
    await expect(p.manager.dieInstance.trialPass({ id: a.id, reason: "ok" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await copyRow(a.id)).status).toBe("on_trial");
    await p.manager.dieInstance.trialPass({ id: a.id, reason: "Same die as 12170-1, trial done at the maker" });
    expect((await copyRow(a.id)).status).toBe("available");
    const rows = await audits(a.id, "die_trial.");
    expect(rows.map((r) => r.action)).toEqual(["die_trial.release"]);
    expect(rows[0]!.meta).toMatchObject({ reason: "Same die as 12170-1, trial done at the maker", from: "on_trial", to: "available" });
    expect(rows[0]!.actorId).not.toBeNull();
  });

  test("who may: the die room and the supervisor cannot release without a trial; others cannot pass at all", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    await expect(p.dieRoom.dieInstance.trialPass({ id: a.id, reason: "I say so" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.supervisor.dieInstance.trialPass({ id: a.id, reason: "I say so" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const role of ["office", "accountant", "packer", "foundry", "press", "storekeeper", "operator", "viewer"] as const) {
      await expect(p.as(role).dieInstance.trialPass({ id: a.id, reason: "I say so" }), role).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await copyRow(a.id)).status).toBe("on_trial");
  });

  test("another plant's copy is not found", async () => {
    const p = await plant();
    const q = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    await expect(q.manager.dieInstance.trialPass({ id: a.id, reason: "not mine" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("trial fail", () => {
  test("the copy stays on trial with an audit row; retire also retires it", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const runId = await queuedRun(p, "die_trial");
    await logTrial(runId, a.id, "fail");
    expect((await p.supervisor.dieInstance.trialFail({ id: a.id, pressRunId: runId, note: "Bearing short" })).status).toBe("on_trial");
    expect((await audits(a.id, "die_trial.fail"))[0]!.meta).toMatchObject({ then: "stay", note: "Bearing short", pressRunId: runId });
    // The supervisor cannot retire; the die room can.
    await expect(p.supervisor.dieInstance.trialFail({ id: a.id, pressRunId: runId, then: "retire" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await p.dieRoom.dieInstance.trialFail({ id: a.id, pressRunId: runId, then: "retire" })).status).toBe("retired");
  });

  test("refused while the die is still on the press, or when the verdict was a pass", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const runId = await queuedRun(p, "die_trial");
    const issued = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: runId });
    await expect(p.dieRoom.dieInstance.trialFail({ id: a.id, pressRunId: runId })).rejects.toMatchObject({ message: expect.stringContaining("still on the press") });
    await p.dieRoom.dieInstance.issues.return({ id: issued.id });
    await logTrial(runId, a.id, "pass");
    await expect(p.dieRoom.dieInstance.trialFail({ id: a.id, pressRunId: runId })).rejects.toMatchObject({ message: expect.stringContaining("marked pass") });
  });

  test("a failed copy goes back to the maker and returns on trial", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const runId = await queuedRun(p, "die_trial");
    await logTrial(runId, a.id, "fail");
    await p.dieRoom.dieInstance.trialFail({ id: a.id, pressRunId: runId });
    const job = await p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: a.id, dieMakerId: p.makerId, purpose: "correction" });
    expect((await copyRow(a.id)).status).toBe("at_maker");
    await p.dieRoom.dieInstance.maker.jobs.receive({ id: job.id });
    expect((await copyRow(a.id)).status).toBe("on_trial");
    const last = await env.db.select().from(auditLog).where(and(eq(auditLog.subjectId, a.id), eq(auditLog.action, "die_maker_job.receive"))).orderBy(desc(auditLog.at)).limit(1);
    expect(last[0]!.meta).toMatchObject({ copyTo: "on_trial" });
  });
});

/** Audit rows are a log, not state: prune every row of this copy (a retention job, a restore, a hand fix). */
async function pruneAudit(copyId: string) {
  await env.db.delete(auditLog).where(eq(auditLog.subjectId, copyId));
}

/** The press close of a trial run, as W2-PR-S runs it: record the verdict on the run, then the seam, in one batch. */
async function pressClose(p: Plant, runId: string, verdict: "pass" | "fail") {
  const [run] = await env.db.select().from(pressRun).where(eq(pressRun.id, runId));
  const seq = 900_000 + runNo++;
  const runLogged = sql`exists (select 1 from press_run r where r.id = ${runId} and r.status = 'logged' and r.server_seq = ${seq})`;
  const seam = await applyTrialVerdictOnReturn(p.closeCtx, {
    run: { id: run!.id, number: run!.number, dieInstanceId: run!.dieInstanceId },
    verdict,
    seq,
    at: new Date(),
    after: runLogged,
  });
  await atomicBatch(env.db as never, [
    env.db.update(pressRun).set({ status: "logged", trialResult: verdict, serverSeq: seq }).where(eq(pressRun.id, runId)),
    ...seam.statements,
  ]);
  return seam;
}

describe("trial state lives on the rows, never in the audit log (0029_die_trial)", () => {
  test("die_issue.trial is 1 for a copy issued on trial, 0 from the rack", async () => {
    const p = await plant();
    const t = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const r = await p.manager.dieInstance.create({ sectionId: p.sectionId, status: "available" });
    const i1 = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: t.id, pressLineId: p.lineId, pressRunId: await queuedRun(p, "die_trial") });
    const i2 = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: r.id, pressLineId: p.lineId, pressRunId: await queuedRun(p, "die_trial") });
    const [a] = await env.db.select().from(dieIssue).where(eq(dieIssue.id, i1.id));
    const [b] = await env.db.select().from(dieIssue).where(eq(dieIssue.id, i2.id));
    expect(a!.trial).toBe(1);
    expect(b!.trial).toBe(0);
  });

  test("a trial issue comes back on trial even when its audit rows are gone", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const issued = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: await queuedRun(p, "die_trial") });
    await pruneAudit(a.id);
    expect((await p.dieRoom.dieInstance.issues.return({ id: issued.id })).status).toBe("on_trial");
    expect((await copyRow(a.id)).status).toBe("on_trial");

    const again = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: await queuedRun(p, "die_trial") });
    await pruneAudit(a.id);
    expect((await p.dieRoom.dieInstance.issues.cancel({ id: again.id })).status).toBe("on_trial");
  });

  test("a plain issue goes back to the rack even with a forged trial audit row", async () => {
    const p = await plant();
    const a = await p.manager.dieInstance.create({ sectionId: p.sectionId, status: "available" });
    const issued = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: await queuedRun(p, "production") });
    await env.db
      .update(auditLog)
      .set({ meta: { issueId: issued.id, trial: 1 } })
      .where(and(eq(auditLog.subjectId, a.id), eq(auditLog.action, "die_issue.issue")));
    expect((await p.dieRoom.dieInstance.issues.return({ id: issued.id })).status).toBe("available");
  });

  test("die_maker_job.from_status is where the copy was; a cancel restores it without the send audit row", async () => {
    const p = await plant();
    const t = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const r = await p.manager.dieInstance.create({ sectionId: p.sectionId, status: "available" });
    const j1 = await p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: t.id, dieMakerId: p.makerId, purpose: "correction" });
    const j2 = await p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: r.id, dieMakerId: p.makerId, purpose: "repair" });
    const jobs = await env.db.select().from(dieMakerJob).where(eq(dieMakerJob.companyId, p.companyId));
    expect(Object.fromEntries(jobs.map((j) => [j.id, j.fromStatus]))).toEqual({ [j1.id]: "on_trial", [j2.id]: "available" });
    await pruneAudit(t.id);
    await pruneAudit(r.id);
    expect((await p.dieRoom.dieInstance.maker.jobs.cancel({ id: j1.id })).status).toBe("on_trial");
    expect((await p.dieRoom.dieInstance.maker.jobs.cancel({ id: j2.id })).status).toBe("available");
  });

  test("a job from before 0029 (from_status '') cancels to the rack", async () => {
    const p = await plant();
    const a = await p.manager.dieInstance.create({ sectionId: p.sectionId, status: "available" });
    const job = await p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: a.id, dieMakerId: p.makerId, purpose: "repair" });
    await env.db.update(dieMakerJob).set({ fromStatus: "" }).where(eq(dieMakerJob.id, job.id));
    expect((await p.dieRoom.dieInstance.maker.jobs.cancel({ id: job.id })).status).toBe("available");
  });
});

describe("a passed trial reaches the rack with a die_trial.pass row, in either order", () => {
  test("close then return: the return batch moves the copy to the rack and writes die_trial.pass (via return)", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const runId = await queuedRun(p, "die_trial");
    const issued = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: runId });
    // The close with the issue still open (die out, not yet taken back) only records the verdict.
    await env.db.update(pressRun).set({ status: "logged", trialResult: "pass" }).where(eq(pressRun.id, runId));
    expect((await p.dieRoom.dieInstance.issues.return({ id: issued.id })).status).toBe("available");
    expect((await copyRow(a.id)).status).toBe("available");
    const rows = await audits(a.id, "die_trial.");
    expect(rows.map((r) => r.action)).toEqual(["die_trial.pass"]);
    expect(rows[0]!.meta).toMatchObject({ pressRunId: runId, via: "return", to: "available" });
  });

  test("return then close: the copy waits on trial, and the close's seam passes it (via close)", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const runId = await queuedRun(p, "die_trial");
    const issued = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: runId });
    // Pressed: die in and out, the run counting; the die room takes the die back before the close.
    await env.db.update(pressRun).set({ status: "counting", dieInAt: new Date(Date.now() - 3_600_000), dieOutAt: new Date() }).where(eq(pressRun.id, runId));
    expect((await p.dieRoom.dieInstance.issues.return({ id: issued.id })).status).toBe("on_trial");
    const seam = await pressClose(p, runId, "pass");
    expect(seam.copyTo).toBe("available");
    expect((await copyRow(a.id)).status).toBe("available");
    const rows = await audits(a.id, "die_trial.");
    expect(rows.map((r) => r.action)).toEqual(["die_trial.pass"]);
    expect(rows[0]!.meta).toMatchObject({ pressRunId: runId, via: "close", from: "on_trial", to: "available" });
  });

  test("the close with the issue still open returns it through the seam: pass to the rack, fail stays on trial", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const passRun = await queuedRun(p, "die_trial");
    const i1 = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: passRun });
    const seam = await pressClose(p, passRun, "pass");
    expect(seam).toMatchObject({ copyTo: "available", issueId: i1.id });
    const [row] = await env.db.select().from(dieIssue).where(eq(dieIssue.id, i1.id));
    expect(row!.status).toBe("returned");
    expect((await copyRow(a.id)).status).toBe("available");
    expect((await audits(a.id, "die_trial.")).map((r) => [r.action, (r.meta as { via?: string }).via])).toEqual([["die_trial.pass", "close"]]);
    expect((await audits(a.id, "die_issue.return"))[0]!.meta).toMatchObject({ via: "close", copyTo: "available" });

    const b = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const failRun = await queuedRun(p, "die_trial");
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: b.id, pressLineId: p.lineId, pressRunId: failRun });
    expect((await pressClose(p, failRun, "fail")).copyTo).toBe("on_trial");
    expect((await copyRow(b.id)).status).toBe("on_trial");
    expect(await audits(b.id, "die_trial.")).toEqual([]);
  });

  test("a rack copy on a closed run goes back to the rack with no trial row", async () => {
    const p = await plant();
    const a = await p.manager.dieInstance.create({ sectionId: p.sectionId, status: "available" });
    const runId = await queuedRun(p, "production");
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: runId });
    const [run] = await env.db.select().from(pressRun).where(eq(pressRun.id, runId));
    const seq = 950_000 + runNo++;
    const seam = await applyTrialVerdictOnReturn(p.closeCtx, {
      run: { id: runId, number: run!.number, dieInstanceId: a.id },
      verdict: null,
      seq,
      at: new Date(),
      after: sql`exists (select 1 from press_run r where r.id = ${runId} and r.status = 'logged' and r.server_seq = ${seq})`,
    });
    await atomicBatch(env.db as never, [env.db.update(pressRun).set({ status: "logged", serverSeq: seq }).where(eq(pressRun.id, runId)), ...seam.statements]);
    expect(seam.copyTo).toBe("available");
    expect((await copyRow(a.id)).status).toBe("available");
    expect(await audits(a.id, "die_trial.")).toEqual([]);
  });

  test("the seam waits on the close: if the run did not log, nothing moves", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const runId = await queuedRun(p, "die_trial");
    const issued = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: runId });
    const [run] = await env.db.select().from(pressRun).where(eq(pressRun.id, runId));
    const seam = await applyTrialVerdictOnReturn(p.closeCtx, {
      run: { id: runId, number: run!.number, dieInstanceId: a.id },
      verdict: "pass",
      seq: 960_000,
      at: new Date(),
      after: sql`exists (select 1 from press_run r where r.id = ${runId} and r.status = 'logged' and r.server_seq = 960000)`,
    });
    await atomicBatch(env.db as never, seam.statements);
    expect((await copyRow(a.id)).status).toBe("in_use");
    const [row] = await env.db.select().from(dieIssue).where(eq(dieIssue.id, issued.id));
    expect(row!.status).toBe("issued");
    expect(await audits(a.id, "die_trial.")).toEqual([]);
  });

  test("a verdict reopened between the read and the return batch never sends the copy to the rack", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const runId = await queuedRun(p, "die_trial");
    const issued = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: a.id, pressLineId: p.lineId, pressRunId: runId });
    await env.db.update(pressRun).set({ status: "logged", trialResult: "pass" }).where(eq(pressRun.id, runId));
    // A press_reopen lands after the return read the pass, before its batch.
    env.beforeNextBatch(() => env.db.update(pressRun).set({ status: "counting", trialResult: null }).where(eq(pressRun.id, runId)));
    await expect(p.dieRoom.dieInstance.issues.return({ id: issued.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await copyRow(a.id)).status).toBe("in_use");
    expect(await audits(a.id, "die_trial.")).toEqual([]);
    // Taken back now, it goes on trial (the run is no longer a passed trial).
    expect((await p.dieRoom.dieInstance.issues.return({ id: issued.id })).status).toBe("on_trial");
  });
});

describe("maker numbers (backlog 21)", () => {
  test("create stores them, update changes and clears them, empty text is no value", async () => {
    const p = await plant({ dieRoom: { newCopyOnTrial: false } });
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId, makerDieNo: " MD-2291 ", makerProjectNo: "PRJ/26/114" });
    const card = await p.dieRoom.dieInstance.get({ id: a.id });
    expect(card.instance).toMatchObject({ makerDieNo: "MD-2291", makerProjectNo: "PRJ/26/114" });
    await p.dieRoom.dieInstance.update({ id: a.id, makerDieNo: "MD-2292" });
    expect((await copyRow(a.id)).makerDieNo).toBe("MD-2292");
    expect((await copyRow(a.id)).makerProjectNo).toBe("PRJ/26/114");
    await p.dieRoom.dieInstance.update({ id: a.id, makerProjectNo: "" });
    expect((await copyRow(a.id)).makerProjectNo).toBeNull();
    await p.dieRoom.dieInstance.update({ id: a.id, makerDieNo: null });
    expect((await copyRow(a.id)).makerDieNo).toBeNull();
    // The change is in the audit trail, before and after.
    const edits = await audits(a.id, "die_instance.update");
    expect(edits.at(-1)!.meta).toMatchObject({ patch: { makerDieNo: null }, before: { makerDieNo: "MD-2292" } });
    await expect(p.dieRoom.dieInstance.update({ id: a.id, makerDieNo: "x".repeat(61) })).rejects.toBeDefined();
  });
});
