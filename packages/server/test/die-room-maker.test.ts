/**
 * Die maker slice (FP-DR-11, Next): maker master, send / receive / cancel with DM numbers,
 * one open job per copy, copy status follows, trial weight fills only an empty card value.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, dieInstance, dieMakerJob } from "@orrn/db/schema";
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

async function plant() {
  const { companyId } = await env.seedCompany();
  const sectionId = await env.seedDie(companyId, { sectionCode: "12170", weightMinG: 5_900, weightMaxG: 6_200 });
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  const dieRoom = as("die_room");
  const { id: makerId } = await dieRoom.dieInstance.maker.create({ name: "Rajkot Dies", city: "Rajkot" });
  return { companyId, sectionId, as, dieRoom, makerId };
}
async function row(id: string) {
  const [r] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, id));
  return r!;
}

describe("die maker (FP-DR-11 slice)", () => {
  test("send -> at_maker with a DM number; receive -> available; trial weight fills only an empty value", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const sent = await p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: a.id, dieMakerId: p.makerId, purpose: "correction" });
    expect(sent.number).toMatch(/^DM-/);
    expect(await row(a.id)).toMatchObject({ status: "at_maker", dieMakerId: p.makerId });
    // One open job per copy; card edits and issue refused while away.
    await expect(p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: a.id, dieMakerId: p.makerId, purpose: "repair" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.dieRoom.dieInstance.update({ id: a.id, rackNo: "R-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Archive refused while a copy is with the maker.
    await expect(p.dieRoom.dieInstance.maker.archive({ id: p.makerId })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await p.dieRoom.dieInstance.maker.jobs.receive({ id: sent.id, trialKgPer12ftMilli: 5_950 });
    expect(await row(a.id)).toMatchObject({ status: "available", trialKgPer12ftMilli: 5_950 });
    const [job] = await env.db.select().from(dieMakerJob).where(eq(dieMakerJob.id, sent.id));
    expect(job).toMatchObject({ status: "received" });
    expect(job!.receivedAt).toBeInstanceOf(Date);
    await expect(p.dieRoom.dieInstance.maker.jobs.receive({ id: sent.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const again = await p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: a.id, dieMakerId: p.makerId, purpose: "repair" });
    expect(again.number).not.toBe(sent.number);
    await p.dieRoom.dieInstance.maker.jobs.receive({ id: again.id, trialKgPer12ftMilli: 6_100 });
    expect((await row(a.id)).trialKgPer12ftMilli).toBe(5_950);
    const actions = (await env.db.select().from(auditLog).where(eq(auditLog.subjectId, a.id))).map((r) => r.action);
    expect(actions.filter((x) => x.startsWith("die_maker_job."))).toEqual(["die_maker_job.send", "die_maker_job.receive", "die_maker_job.send", "die_maker_job.receive"]);
    await p.dieRoom.dieInstance.maker.archive({ id: p.makerId });
    expect(await p.dieRoom.dieInstance.maker.list()).toEqual([]);
  });

  test("cancel returns the copy; send refused from in_use, at_nitriding, retired, and to an archived maker", async () => {
    const p = await plant();
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const sent = await p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: a.id, dieMakerId: p.makerId, purpose: "trial" });
    await p.dieRoom.dieInstance.maker.jobs.cancel({ id: sent.id });
    expect((await row(a.id)).status).toBe("available");
    await expect(p.dieRoom.dieInstance.maker.jobs.cancel({ id: sent.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    for (const status of ["in_use", "at_nitriding", "retired"] as const) {
      await env.db.update(dieInstance).set({ status }).where(eq(dieInstance.id, a.id));
      await expect(p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: a.id, dieMakerId: p.makerId, purpose: "trial" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await env.db.update(dieInstance).set({ status: "available" }).where(eq(dieInstance.id, a.id));
    const { id: other } = await p.dieRoom.dieInstance.maker.create({ name: "Old Maker" });
    await p.dieRoom.dieInstance.maker.archive({ id: other });
    await expect(p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: a.id, dieMakerId: other, purpose: "trial" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // A status change between read and write sends nothing.
    env.beforeNextBatch(() => env.db.update(dieInstance).set({ status: "in_use" }).where(eq(dieInstance.id, a.id)));
    await expect(p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: a.id, dieMakerId: p.makerId, purpose: "trial" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await env.db.select().from(dieMakerJob).where(and(eq(dieMakerJob.dieInstanceId, a.id), eq(dieMakerJob.status, "sent")))).toEqual([]);
  });

  test("duplicate maker name is CONFLICT; permissions; another company's maker or job is NOT_FOUND", async () => {
    const p = await plant();
    await expect(p.dieRoom.dieInstance.maker.create({ name: "rajkot  dies" })).rejects.toMatchObject({ code: "CONFLICT" });
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    for (const role of ROLES) {
      const c = p.as(role);
      const send = c.dieInstance.maker.jobs.send({ dieInstanceId: a.id, dieMakerId: p.makerId, purpose: "trial" });
      if (["owner", "die_room"].includes(role)) {
        const { id } = await send;
        await c.dieInstance.maker.jobs.cancel({ id });
      } else await expect(send).rejects.toMatchObject({ code: "FORBIDDEN" });
      const create = c.dieInstance.maker.create({ name: `Maker ${role}` });
      if (["owner", "die_room", "manager", "admin"].includes(role)) await create;
      else await expect(create).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await c.dieInstance.maker.jobs.list()).items).toBeArray();
    }
    const x = await plant();
    const xCopy = await x.dieRoom.dieInstance.create({ sectionId: x.sectionId });
    const xJob = await x.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: xCopy.id, dieMakerId: x.makerId, purpose: "trial" });
    await expect(p.dieRoom.dieInstance.maker.jobs.receive({ id: xJob.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: a.id, dieMakerId: x.makerId, purpose: "trial" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: xCopy.id, dieMakerId: p.makerId, purpose: "trial" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.dieRoom.dieInstance.maker.archive({ id: x.makerId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await p.dieRoom.dieInstance.maker.jobs.list({ dieInstanceId: xCopy.id })).items).toEqual([]);
  });

  test("jobs list pages newest first with limit and cursor", async () => {
    const p = await plant();
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
      ids.push((await p.dieRoom.dieInstance.maker.jobs.send({ dieInstanceId: a.id, dieMakerId: p.makerId, purpose: "trial" })).id);
    }
    const first = await p.dieRoom.dieInstance.maker.jobs.list({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toBeString();
    const second = await p.dieRoom.dieInstance.maker.jobs.list({ limit: 2, cursor: first.nextCursor! });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect([...first.items, ...second.items].map((j) => j.id).sort()).toEqual([...ids].sort());
  });
});
