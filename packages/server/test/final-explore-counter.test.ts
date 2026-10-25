/**
 * Wave-2 M11 (final explore, still reproducing): seeding the default yards, scrap grades/items and
 * return streams when nothing is missing wrote nothing yet took a number from the shared company
 * counter, so the next dispatch code (DSP-) and bundle group number jumped. A no-op takes none now.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, companySequence } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

async function counter(companyId: string) {
  const [row] = await env.db.select({ value: companySequence.value }).from(companySequence).where(eq(companySequence.companyId, companyId));
  return row?.value ?? 0;
}

async function audits(companyId: string, action: string) {
  return (await env.db.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, action)))).length;
}

describe("wave-2 M11: a no-op seed takes no company number", () => {
  test("yards, scrap defaults and return streams: the first run adds and counts, the second adds nothing and the counter stands", async () => {
    const { companyId } = await env.seedCompany({ modules: ["foundry", "purchase"] });
    const owner = env.caller({ role: "owner", companyId });
    const manager = env.caller({ role: "manager", companyId });

    expect((await owner.stock.locations.seedDefaults()).created).toBe(10);
    const grades = await manager.purchase.seedScrapDefaults();
    expect(grades.grades).toBeGreaterThan(0);
    expect((await manager.foundry.returnStreams.seedDefaults()).added).toBe(11);
    const after = await counter(companyId);
    const seedAudits = await audits(companyId, "location.seedDefaults");

    expect(await owner.stock.locations.seedDefaults()).toEqual({ created: 0 });
    expect(await manager.purchase.seedScrapDefaults()).toEqual({ grades: 0, items: 0 });
    expect(await manager.foundry.returnStreams.seedDefaults()).toEqual({ added: 0 });
    expect(await counter(companyId)).toBe(after);
    expect(await audits(companyId, "location.seedDefaults")).toBe(seedAudits);
  });

  test("one default yard missing: the seed still adds it and takes one number", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await owner.stock.locations.seedDefaults();
    const y6 = (await owner.stock.locations.list()).items.find((l) => l.code === "Y6")!;
    await owner.stock.locations.update({ id: y6.id, code: "Y6-OLD" });
    const before = await counter(companyId);
    expect((await owner.stock.locations.seedDefaults()).created).toBe(1);
    expect(await counter(companyId)).toBe(before + 1);
  });
});
