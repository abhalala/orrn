/**
 * BACKLOG 47 (W4-MASTERS): `dispatch.create` and `dieInstance.addReading` take a `clientRequestId`.
 * A resend answers the first result with `replayed: true` and writes nothing more; the same key with
 * other content is a CONFLICT; a key is per company.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, dieWeightReading, dispatch } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { salesHelpers, SLOW } from "./sales-fixture";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { plant } = salesHelpers(() => env);
const key = (tag: string) => `test-${tag}-${crypto.randomUUID()}`;

async function dispatches(companyId: string) {
  return env.db.select({ id: dispatch.id }).from(dispatch).where(eq(dispatch.companyId, companyId));
}

describe("dispatch.create with clientRequestId", () => {
  test("a create sent twice opens one packing list and answers the first id and code again", async () => {
    const p = await plant();
    const k = key("dc");
    const first = await p.owner.dispatch.create({ customerId: p.customerId, notes: "Truck 1", clientRequestId: k });
    const again = await p.owner.dispatch.create({ customerId: p.customerId, notes: "Truck 1", clientRequestId: k });
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(again.id).toBe(first.id);
    expect(again.code).toBe(first.code);
    expect(await dispatches(p.companyId)).toHaveLength(1);
    const audits = await env.db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "dispatch.create")));
    expect(audits).toHaveLength(1);
  }, SLOW);

  test("two identical creates racing open one packing list", async () => {
    const p = await plant();
    const input = { customerId: p.customerId, clientRequestId: key("dc-race") };
    const [a, b] = await Promise.all([p.owner.dispatch.create(input), p.owner.dispatch.create(input)]);
    expect(a.id).toBe(b.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(await dispatches(p.companyId)).toHaveLength(1);
  }, SLOW);

  test("the same key with other content is a CONFLICT; no key opens a new list each time", async () => {
    const p = await plant();
    const k = key("dc-conf");
    await p.owner.dispatch.create({ customerId: p.customerId, notes: "A", clientRequestId: k });
    await expect(p.owner.dispatch.create({ customerId: p.customerId, notes: "B", clientRequestId: k })).rejects.toMatchObject({ code: "CONFLICT" });
    await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.create({ customerId: p.customerId });
    expect(await dispatches(p.companyId)).toHaveLength(3);
  }, SLOW);

  test("a key is per company", async () => {
    const a = await plant();
    const b = await plant();
    const k = key("dc-tenant");
    const ra = await a.owner.dispatch.create({ customerId: a.customerId, clientRequestId: k });
    const rb = await b.owner.dispatch.create({ customerId: b.customerId, clientRequestId: k });
    expect(rb.replayed).toBe(false);
    expect(rb.id).not.toBe(ra.id);
  }, SLOW);
});

describe("dieInstance.addReading with clientRequestId", () => {
  async function copy() {
    const { companyId } = await env.seedCompany({ settings: { dieRoom: { newCopyOnTrial: false } } });
    const sectionId = await env.seedDie(companyId, { series: "Domal", sectionCode: "12170", weightMinG: 10_000, weightMaxG: 11_000, wallTenthMm: 12 });
    const dieRoom = env.caller({ role: "die_room", companyId });
    const press = env.caller({ role: "press", companyId });
    const c = await dieRoom.dieInstance.create({ sectionId });
    return { companyId, press, id: c.id };
  }
  const readings = (companyId: string, id: string) =>
    env.db.select({ id: dieWeightReading.id }).from(dieWeightReading).where(and(eq(dieWeightReading.companyId, companyId), eq(dieWeightReading.dieInstanceId, id)));

  test("a reading sent twice is one reading, the second call answers the first", async () => {
    const c = await copy();
    const k = key("rd");
    const first = await c.press.dieInstance.addReading({ dieInstanceId: c.id, kgPer12ftMilli: 10_333, clientRequestId: k });
    const again = await c.press.dieInstance.addReading({ dieInstanceId: c.id, kgPer12ftMilli: 10_333, clientRequestId: k });
    expect(first.replayed).toBe(false);
    expect(again).toMatchObject({ replayed: true, id: first.id, kgPer12ftMilli: 10_333, readAt: first.readAt, lastKgPer12ftMilli: first.lastKgPer12ftMilli });
    expect(await readings(c.companyId, c.id)).toHaveLength(1);
  }, SLOW);

  test("two identical readings racing make one reading", async () => {
    const c = await copy();
    const input = { dieInstanceId: c.id, kgPer12ftMilli: 10_200, clientRequestId: key("rd-race") };
    const [a, b] = await Promise.all([c.press.dieInstance.addReading(input), c.press.dieInstance.addReading(input)]);
    expect(a.id).toBe(b.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(await readings(c.companyId, c.id)).toHaveLength(1);
  }, SLOW);

  test("the same key with another value is a CONFLICT; without a key two readings are two rows", async () => {
    const c = await copy();
    const k = key("rd-conf");
    await c.press.dieInstance.addReading({ dieInstanceId: c.id, kgPer12ftMilli: 10_100, clientRequestId: k });
    await expect(c.press.dieInstance.addReading({ dieInstanceId: c.id, kgPer12ftMilli: 10_101, clientRequestId: k })).rejects.toMatchObject({ code: "CONFLICT" });
    await c.press.dieInstance.addReading({ dieInstanceId: c.id, kgPer12ftMilli: 10_100 });
    await c.press.dieInstance.addReading({ dieInstanceId: c.id, kgPer12ftMilli: 10_100 });
    expect(await readings(c.companyId, c.id)).toHaveLength(3);
  }, SLOW);
});
