/**
 * FP-DR-16 die issue to a press line (C6, C43): issue / return / cancel batches against a released
 * `press_run` in `queued`, one open issue per copy, owner gate for the run's customers.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  auditLog,
  dieInstance,
  dieIssue,
  pressLine,
  pressPlan,
  pressPlanDie,
  pressPlanLine,
  pressRun,
  salesOrder,
  salesOrderLine,
} from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const ROLES: CompanyRole[] = [
  "owner", "admin", "manager", "office", "accountant", "supervisor", "packer",
  "foundry", "press", "storekeeper", "die_room", "operator", "viewer",
];

let runNo = 0;

async function plant() {
  const { companyId, users } = await env.seedCompany({ settings: { dieRoom: { newCopyOnTrial: false } } }); // these tests are about the rack; the trial flow has its own file
  const sectionId = await env.seedDie(companyId, { series: "Domal", sectionCode: "12170", weightMinG: 5_900, weightMaxG: 6_200 });
  const lineId = crypto.randomUUID();
  await env.db.insert(pressLine).values({ id: lineId, companyId, code: "P1", name: "Press 1" });
  const dieRoom = env.caller({ role: "die_room", companyId });
  const owner = env.caller({ role: "owner", companyId });
  return { companyId, users, sectionId, lineId, dieRoom, owner };
}
type Plant = Awaited<ReturnType<typeof plant>>;

async function copy(p: Plant, sectionId = p.sectionId) {
  return p.dieRoom.dieInstance.create({ sectionId });
}

/** A released run waiting for a die, as `plans.release` leaves it (C7). */
async function queuedRun(p: Plant, over: Partial<typeof pressRun.$inferInsert> = {}) {
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
    ...over,
  });
  return id;
}

/** Another press line of the plant (D29: a line holds at most two issued copies, so a third open issue needs its own line). */
async function anotherLine(p: Plant, code: string) {
  const id = crypto.randomUUID();
  await env.db.insert(pressLine).values({ id, companyId: p.companyId, code, name: `Press ${code}` });
  return id;
}

async function runRow(id: string) {
  const [row] = await env.db.select().from(pressRun).where(eq(pressRun.id, id));
  return row!;
}
async function copyRow(id: string) {
  const [row] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, id));
  return row!;
}
async function issues(copyId: string) {
  return env.db.select().from(dieIssue).where(eq(dieIssue.dieInstanceId, copyId));
}

describe("issue", () => {
  test("one batch: issue row, copy in_use, run.die_instance_id and run die_issued; audit die_issue.issue", async () => {
    const p = await plant();
    const c = await copy(p);
    const runId = await queuedRun(p);
    const out = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: runId, note: "night" });
    expect(out.warnings).toEqual([]);
    const [row] = await issues(c.id);
    expect(row).toMatchObject({ id: out.id, status: "issued", pressLineId: p.lineId, pressRunId: runId, note: "night", issuedBy: p.users.die_room.id });
    expect((await copyRow(c.id)).status).toBe("in_use");
    expect(await runRow(runId)).toMatchObject({ status: "die_issued", dieInstanceId: c.id });
    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.subjectId, c.id), eq(auditLog.action, "die_issue.issue")));
    expect(audits).toHaveLength(1);
    // Every write of the batch carries the same company sequence.
    const seqs = new Set([row!.serverSeq, (await copyRow(c.id)).serverSeq, (await runRow(runId)).serverSeq]);
    expect(seqs.size).toBe(1);
    const list = await p.owner.dieInstance.issues.list({ pressLineId: p.lineId, status: "issued" });
    expect(list.items.map((i) => [i.code, i.pressLineCode, i.pressRunNumber, i.pressRunStatus])).toEqual([[c.code, "P1", (await runRow(runId)).number, "die_issued"]]);
    expect(list.nextCursor).toBeNull();
  });

  test("D13: an issue always targets a queued run of the copy's section; without one, or another section's, it is BAD_REQUEST", async () => {
    const p = await plant();
    const c = await copy(p);
    await expect(
      p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const otherSection = await env.seedDie(p.companyId, { sectionCode: "4521" });
    const wrongDie = await queuedRun(p, { sectionId: otherSection });
    await expect(p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: wrongDie })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("is not a copy of the die"),
    });
    expect((await copyRow(c.id)).status).toBe("available");
    expect(await issues(c.id)).toEqual([]);
    expect(await runRow(wrongDie)).toMatchObject({ status: "queued", dieInstanceId: null });
  });

  test("queuedRuns and pressLines feed the issue form: only queued runs without a copy, optionally one section; any member reads", async () => {
    const p = await plant();
    const other = await env.seedDie(p.companyId, { series: "Tee", sectionCode: "13090", weightMinG: 2_700, weightMaxG: 2_900 });
    const q1 = await queuedRun(p);
    const q2 = await queuedRun(p, { sectionId: other, pressLineId: null });
    const started = await queuedRun(p, { status: "running" });
    const c = await copy(p);
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: q1 });

    const viewer = env.caller({ role: "viewer", companyId: p.companyId });
    const all = await viewer.dieInstance.issues.queuedRuns();
    expect(all.map((r) => [r.id, r.pressLineCode])).toEqual([[q2, null]]);
    expect(all.some((r) => r.id === started)).toBe(false);
    expect((await viewer.dieInstance.issues.queuedRuns({ sectionId: p.sectionId })).map((r) => r.id)).toEqual([]);
    expect((await viewer.dieInstance.issues.queuedRuns({ sectionId: other })).map((r) => r.sectionCode)).toEqual(["13090"]);
    expect((await viewer.dieInstance.issues.pressLines()).map((l) => l.code)).toEqual(["P1"]);
    // Another company sees none of them.
    const x = await plant();
    expect(await env.caller({ role: "viewer", companyId: x.companyId }).dieInstance.issues.queuedRuns()).toEqual([]);
  });

  test("a run with no press line yet takes the issue's line", async () => {
    const p = await plant();
    const c = await copy(p);
    const runId = await queuedRun(p, { pressLineId: null });
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: runId });
    expect(await runRow(runId)).toMatchObject({ status: "die_issued", dieInstanceId: c.id, pressLineId: p.lineId });
  });

  test("list pages newest first with limit and cursor", async () => {
    const p = await plant();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const c = await copy(p);
      // At most two issued copies per press line (D29): each copy on its own line.
      const lineId = i === 0 ? p.lineId : await anotherLine(p, `P${i + 1}`);
      ids.push((await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: lineId, pressRunId: await queuedRun(p, { pressLineId: lineId }) })).id);
    }
    const first = await p.owner.dieInstance.issues.list({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeString();
    const second = await p.owner.dieInstance.issues.list({ limit: 2, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((i) => i.id).sort()).toEqual([...ids].sort());
    await expect(p.owner.dieInstance.issues.list({ cursor: "not-a-cursor" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("atomic: a run taken between read and write leaves no issue row and the copy on the rack", async () => {
    const p = await plant();
    const c = await copy(p);
    const runId = await queuedRun(p);
    // Someone else's issue lands first (same run): our batch must roll back completely.
    env.beforeNextBatch(() => env.db.update(pressRun).set({ status: "die_issued", dieInstanceId: c.id }).where(eq(pressRun.id, runId)));
    await expect(
      p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: runId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await issues(c.id)).toEqual([]);
    expect((await copyRow(c.id)).status).toBe("available");
    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.subjectId, c.id), eq(auditLog.action, "die_issue.issue")));
    expect(audits).toEqual([]);
  });

  test("atomic: a copy sent away between read and write leaves the run queued", async () => {
    const p = await plant();
    const c = await copy(p);
    const runId = await queuedRun(p);
    env.beforeNextBatch(() => env.db.update(dieInstance).set({ status: "at_nitriding" }).where(eq(dieInstance.id, c.id)));
    await expect(
      p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: runId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await runRow(runId)).toMatchObject({ status: "queued", dieInstanceId: null });
    expect(await issues(c.id)).toEqual([]);
  });

  test("refusals: only from available; one open issue per copy; run must be queued, same section, same line", async () => {
    const p = await plant();
    const c = await copy(p);
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: await queuedRun(p) });
    // Second issue of the same copy (two lines cannot hold one copy).
    const line2 = crypto.randomUUID();
    await env.db.insert(pressLine).values({ id: line2, companyId: p.companyId, code: "P2", name: "Press 2" });
    await expect(
      p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: line2, pressRunId: await queuedRun(p, { pressLineId: line2 }) }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: `${c.code} is already issued to P1`,
    });

    const spare = await queuedRun(p);
    for (const status of ["at_nitriding", "at_maker", "retired"] as const) {
      const d = await copy(p);
      await env.db.update(dieInstance).set({ status }).where(eq(dieInstance.id, d.id));
      await expect(p.dieRoom.dieInstance.issues.issue({ dieInstanceId: d.id, pressLineId: p.lineId, pressRunId: spare })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await issues(d.id)).toEqual([]);
    }
    expect(await runRow(spare)).toMatchObject({ status: "queued", dieInstanceId: null });

    const d = await copy(p);
    const started = await queuedRun(p, { status: "running" });
    await expect(p.dieRoom.dieInstance.issues.issue({ dieInstanceId: d.id, pressLineId: p.lineId, pressRunId: started })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const otherSection = await env.seedDie(p.companyId, { sectionCode: "4521" });
    const wrongDie = await queuedRun(p, { sectionId: otherSection });
    await expect(p.dieRoom.dieInstance.issues.issue({ dieInstanceId: d.id, pressLineId: p.lineId, pressRunId: wrongDie })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("is not a copy of the die"),
    });
    const onLine2 = await queuedRun(p, { pressLineId: line2 });
    await expect(p.dieRoom.dieInstance.issues.issue({ dieInstanceId: d.id, pressLineId: p.lineId, pressRunId: onLine2 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await copyRow(d.id)).status).toBe("available");
    expect(await runRow(onLine2)).toMatchObject({ status: "queued", dieInstanceId: null });

    // A retired press line takes no die.
    await env.db.update(pressLine).set({ status: "retired" }).where(eq(pressLine.id, line2));
    await expect(p.dieRoom.dieInstance.issues.issue({ dieInstanceId: d.id, pressLineId: line2, pressRunId: onLine2 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("a deleted section's copy cannot be issued", async () => {
    const p = await plant();
    const c = await copy(p);
    const runId = await queuedRun(p);
    await p.owner.die.delete({ id: p.sectionId });
    await expect(p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: runId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("life reached is a warning, never a block", async () => {
    const p = await plant();
    const c = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId, lifeG: 1_000_000 });
    await queuedRun(p, { status: "logged", dieInstanceId: c.id, goodG: 1_200_000, inputG: 1_500_000 });
    const out = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: await queuedRun(p) });
    expect(out.warnings).toEqual([{ code: "life_reached", lifeG: 1_000_000, producedG: 1_200_000 }]);
    const card = await p.owner.dieInstance.get({ id: c.id });
    expect(card).toMatchObject({ producedG: 1_200_000, lifeRemainingG: -200_000, lifeReached: true });
  });
});

describe("return", () => {
  test("back to the rack; refused while die-in is set and die-out is not; a finished run keeps its copy and status", async () => {
    const p = await plant();
    const c = await copy(p);
    const runId = await queuedRun(p);
    const { id } = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: runId });

    await env.db.update(pressRun).set({ status: "running", dieInAt: new Date() }).where(eq(pressRun.id, runId));
    await expect(p.dieRoom.dieInstance.issues.return({ id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("take the die out first"),
    });
    expect((await copyRow(c.id)).status).toBe("in_use");

    await env.db.update(pressRun).set({ status: "logged", dieOutAt: new Date() }).where(eq(pressRun.id, runId));
    await p.dieRoom.dieInstance.issues.return({ id });
    expect((await issues(c.id))[0]).toMatchObject({ status: "returned", returnedBy: p.users.die_room.id });
    expect((await issues(c.id))[0]!.returnedAt).toBeInstanceOf(Date);
    expect((await copyRow(c.id)).status).toBe("available");
    expect(await runRow(runId)).toMatchObject({ status: "logged", dieInstanceId: c.id });
    await expect(p.dieRoom.dieInstance.issues.return({ id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.subjectId, c.id), eq(auditLog.action, "die_issue.return")));
    expect(audits).toHaveLength(1);
  });

  test("D13: return before die-in puts the run back to queued with no copy, in the same batch", async () => {
    const p = await plant();
    const c = await copy(p);
    const runId = await queuedRun(p);
    const { id } = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: runId });
    await p.dieRoom.dieInstance.issues.return({ id, note: "wrong die" });
    expect((await issues(c.id))[0]).toMatchObject({ status: "returned", note: "wrong die" });
    const copyAfter = await copyRow(c.id);
    expect(copyAfter.status).toBe("available");
    const run = await runRow(runId);
    expect(run).toMatchObject({ status: "queued", dieInstanceId: null });
    expect(run.serverSeq).toBe(copyAfter.serverSeq);
    const [audit] = await env.db.select().from(auditLog).where(and(eq(auditLog.subjectId, c.id), eq(auditLog.action, "die_issue.return")));
    expect(audit!.meta).toMatchObject({ pressRunId: runId, runRequeued: true });
    // The run takes another copy, and the returned copy can go to another run.
    const d = await copy(p);
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: d.id, pressLineId: p.lineId, pressRunId: runId });
    expect(await runRow(runId)).toMatchObject({ status: "die_issued", dieInstanceId: d.id });
    const other = await queuedRun(p);
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: other });
    expect(await runRow(other)).toMatchObject({ status: "die_issued", dieInstanceId: c.id });
  });

  test("write-time guard: die-in recorded between read and write refuses and changes nothing", async () => {
    const p = await plant();
    const c = await copy(p);
    const runId = await queuedRun(p);
    const { id } = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: runId });
    env.beforeNextBatch(() => env.db.update(pressRun).set({ status: "running", dieInAt: new Date() }).where(eq(pressRun.id, runId)));
    await expect(p.dieRoom.dieInstance.issues.return({ id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await issues(c.id))[0]!.status).toBe("issued");
    expect((await copyRow(c.id)).status).toBe("in_use");
  });
});

describe("cancel", () => {
  test("before die-in: copy available and the run back to queued with no copy, one batch", async () => {
    const p = await plant();
    const c = await copy(p);
    const runId = await queuedRun(p);
    const { id } = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: runId });
    await p.dieRoom.dieInstance.issues.cancel({ id });
    expect((await issues(c.id))[0]!.status).toBe("cancelled");
    expect((await copyRow(c.id)).status).toBe("available");
    expect(await runRow(runId)).toMatchObject({ status: "queued", dieInstanceId: null });
    // The copy can be issued again (the partial unique only counts open issues).
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: runId });
    expect(await runRow(runId)).toMatchObject({ status: "die_issued", dieInstanceId: c.id });
  });

  test("refused after die-in, and once returned or cancelled", async () => {
    const p = await plant();
    const c = await copy(p);
    const runId = await queuedRun(p);
    const { id } = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: runId });
    await env.db.update(pressRun).set({ status: "running", dieInAt: new Date() }).where(eq(pressRun.id, runId));
    await expect(p.dieRoom.dieInstance.issues.cancel({ id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("has started") });
    expect(await runRow(runId)).toMatchObject({ status: "running", dieInstanceId: c.id });

    const d = await copy(p);
    const plain = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: d.id, pressLineId: p.lineId, pressRunId: await queuedRun(p) });
    await p.dieRoom.dieInstance.issues.cancel({ id: plain.id });
    await expect(p.dieRoom.dieInstance.issues.cancel({ id: plain.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.dieRoom.dieInstance.issues.return({ id: plain.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("atomic: the run started meanwhile, so nothing is cancelled", async () => {
    const p = await plant();
    const c = await copy(p);
    const runId = await queuedRun(p);
    const { id } = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: runId });
    env.beforeNextBatch(() => env.db.update(pressRun).set({ status: "running", dieInAt: new Date() }).where(eq(pressRun.id, runId)));
    await expect(p.dieRoom.dieInstance.issues.cancel({ id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await issues(c.id))[0]!.status).toBe("issued");
    expect((await copyRow(c.id)).status).toBe("in_use");
    expect(await runRow(runId)).toMatchObject({ status: "running", dieInstanceId: c.id });
  });
});

describe("customer-owned die on a run (FP-DR-12)", () => {
  async function runFor(p: Plant, customerId: string) {
    const planId = crypto.randomUUID();
    const planDieId = crypto.randomUUID();
    const soId = crypto.randomUUID();
    const lineId = crypto.randomUUID();
    runNo += 1;
    await env.db.insert(pressPlan).values({ id: planId, companyId: p.companyId, number: `PP-${runNo}`, period: "2026-27", status: "released", windowStart: new Date(), windowEnd: new Date(Date.now() + 3_600_000) });
    await env.db.insert(pressPlanDie).values({ id: planDieId, companyId: p.companyId, pressPlanId: planId, sectionId: p.sectionId });
    await env.db.insert(salesOrder).values({ id: soId, companyId: p.companyId, period: "2026-27", number: `SO-${runNo}`, customerId, orderDate: "2026-10-24" } as typeof salesOrder.$inferInsert);
    await env.db.insert(salesOrderLine).values({ id: lineId, companyId: p.companyId, salesOrderId: soId, lineNo: 1, dieId: p.sectionId, cutLengthMm: 3_658, kgG: 100_000 } as typeof salesOrderLine.$inferInsert);
    await env.db.insert(pressPlanLine).values({ id: crypto.randomUUID(), companyId: p.companyId, pressPlanId: planId, pressPlanDieId: planDieId, salesOrderLineId: lineId, cutLengthMm: 3_658, pcs: 10, kgG: 100_000 });
    return queuedRun(p, { planId, pressPlanDieId: planDieId });
  }

  test("issuing an owned copy for another party's run is refused naming the owner; the owner's run passes", async () => {
    const p = await plant();
    const ownerCust = await env.seedCustomer(p.companyId);
    const other = await env.seedCustomer(p.companyId);
    await p.owner.die.update({
      id: p.sectionId, series: "Domal", sectionCode: "12170", weightMinG: 5_900, weightMaxG: 6_200, dimensions: {}, ownerCustomerId: ownerCust,
    });
    const c = await copy(p);
    const otherRun = await runFor(p, other);
    const err = await p.dieRoom.dieInstance.issues
      .issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: otherRun })
      .catch((e: unknown) => e as { code: string; message: string; meta?: Record<string, unknown> });
    expect(err).toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/^This die belongs to /) });
    expect((err as { meta?: Record<string, unknown> }).meta).toMatchObject({ ownerCustomerId: ownerCust, dieInstanceId: c.id, code: c.code });
    expect(await issues(c.id)).toEqual([]);

    const ownRun = await runFor(p, ownerCust);
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: ownRun });
    expect(await runRow(ownRun)).toMatchObject({ status: "die_issued", dieInstanceId: c.id });
  });
});

describe("permissions and tenancy", () => {
  test("die.issue is the die room's alone (owner holds every action); reads are open to members", async () => {
    const p = await plant();
    for (const role of ROLES) {
      const c = await copy(p);
      const caller = env.caller({ role, companyId: p.companyId });
      const allowed = role === "die_room" || role === "owner";
      const attempt = caller.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: await queuedRun(p) });
      if (allowed) {
        const { id } = await attempt;
        await caller.dieInstance.issues.cancel({ id });
      } else {
        await expect(attempt).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      expect((await caller.dieInstance.issues.list({})).items).toBeArray();
    }
  });

  test("another company's copy, line, run or issue is NOT_FOUND and nothing is written", async () => {
    const p = await plant();
    const x = await plant();
    const c = await copy(p);
    const xc = await copy(x);
    const xRun = await queuedRun(x);
    const pRun = await queuedRun(p);
    await expect(p.dieRoom.dieInstance.issues.issue({ dieInstanceId: xc.id, pressLineId: p.lineId, pressRunId: pRun })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: x.lineId, pressRunId: pRun })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c.id, pressLineId: p.lineId, pressRunId: xRun })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const xIssue = await x.dieRoom.dieInstance.issues.issue({ dieInstanceId: xc.id, pressLineId: x.lineId, pressRunId: await queuedRun(x) });
    await expect(p.dieRoom.dieInstance.issues.return({ id: xIssue.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.dieRoom.dieInstance.issues.cancel({ id: xIssue.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await p.owner.dieInstance.issues.list({})).items).toEqual([]);
    expect((await copyRow(c.id)).status).toBe("available");
    expect(await runRow(xRun)).toMatchObject({ status: "queued", dieInstanceId: null });
  });
});
