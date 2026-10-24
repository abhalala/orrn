import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";

/**
 * Read-only additions the Stock screens (redesign Task 21) need. The section
 * block shows the die's weight range per 12 ft next to the stock, so
 * `bundle.stockSummary` carries the die band with each row.
 */
let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

describe("bundle.stockSummary for the Stock screen", () => {
  test("each section row carries its die's weight band (grams per 12 ft)", async () => {
    const { companyId } = await env.seedCompany();
    const dieA = await env.seedDie(companyId, { sectionCode: "14701", weightMinG: 2_400, weightMaxG: 2_600 });
    const dieB = await env.seedDie(companyId, { sectionCode: "11250", weightMinG: 2_000, weightMaxG: 2_200 });
    await env.seedBundles(companyId, dieA, 3);
    await env.seedBundles(companyId, dieB, 2);
    await env.seedBundles(companyId, dieB, 1, "reserved");

    const caller = env.caller({ role: "viewer", companyId });
    const available = await caller.bundle.stockSummary({ status: "available" });
    const a = available.items.find((r) => r.dieId === dieA);
    const b = available.items.find((r) => r.dieId === dieB);
    expect(a).toMatchObject({ bundleCount: 3, dieWeightMinG: 2_400, dieWeightMaxG: 2_600 });
    expect(b).toMatchObject({ bundleCount: 2, dieWeightMinG: 2_000, dieWeightMaxG: 2_200 });

    const reserved = await caller.bundle.stockSummary({ status: "reserved" });
    expect(reserved.items).toHaveLength(1);
    expect(reserved.items[0]).toMatchObject({ dieId: dieB, bundleCount: 1, dieWeightMinG: 2_000 });
  });

  test("stays scoped to the caller's company", async () => {
    const mine = await env.seedCompany();
    const theirs = await env.seedCompany();
    const myDie = await env.seedDie(mine.companyId);
    const theirDie = await env.seedDie(theirs.companyId);
    await env.seedBundles(mine.companyId, myDie, 1);
    await env.seedBundles(theirs.companyId, theirDie, 4);

    const res = await env.caller({ role: "viewer", companyId: mine.companyId }).bundle.stockSummary({ status: "available" });
    expect(res.items.map((r) => r.dieId)).toEqual([myDie]);
    expect(res.totals.bundleCount).toBe(1);
  });
});
