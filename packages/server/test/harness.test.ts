import { afterAll, beforeAll, expect, test } from "bun:test";

import { bundle, bundleGroup } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

test("rejects statements over 100 params", () => {
  const params = Array.from({ length: 101 }, (_, i) => i);
  expect(() => env.d1.prepare("select 1").bind(...params)).toThrow("D1_TOO_MANY_PARAMS");
  // exactly 100 is still allowed
  expect(() => env.d1.prepare("select 1").bind(...params.slice(0, 100))).not.toThrow();
});

test("caller resolves company context", async () => {
  const { companyId } = await env.seedCompany();
  const me = await env.caller({ role: "owner", companyId }).auth.me();
  expect(me.company?.role).toBe("owner");
  expect(me.company?.id).toBe(companyId);
  expect(me.isPlatformAdmin).toBe(false);
});

test("caller(null) is unauthenticated", async () => {
  await expect(env.caller(null).auth.me()).rejects.toThrow("Authentication required");
});

test("platform caller is platform staff without a company", async () => {
  const me = await env.caller({ platformRole: "support" }).auth.me();
  expect(me.isPlatformAdmin).toBe(true);
  expect(me.platformRole).toBe("support");
  expect(me.company).toBeNull();
});

test("seedCompany creates one member per role and respects settings", async () => {
  const { companyId, users } = await env.seedCompany({ settings: { lengthUnit: "inch" } });
  expect(Object.keys(users).sort()).toEqual([
    "accountant", "admin", "die_room", "foundry", "manager", "office", "operator", "owner", "packer",
    "press", "storekeeper", "supervisor", "viewer",
  ]);
  for (const role of ["owner", "admin", "manager", "operator", "viewer"] as const) {
    const me = await env.caller({ role, companyId }).auth.me();
    expect(me.company?.role).toBe(role);
    expect(me.company?.settings.lengthUnit).toBe("inch");
  }
});

test("seedDie, seedCustomer and seedBundles insert rows past the 10-row chunk", async () => {
  const { companyId } = await env.seedCompany();
  const dieId = await env.seedDie(companyId);
  const customerId = await env.seedCustomer(companyId);
  expect(dieId).toBeTruthy();
  expect(customerId).toBeTruthy();

  const bundles = await env.seedBundles(companyId, dieId, 25, "reserved");
  expect(bundles).toHaveLength(25);
  expect(new Set(bundles.map((b) => b.serial)).size).toBe(25);

  const row = await env.d1
    .prepare("select count(*) as n from bundle where company_id = ? and status = 'reserved'")
    .bind(companyId)
    .first<{ n: number }>();
  expect(row?.n).toBe(25);
});

test("drizzle statements over 100 params fail like production D1", async () => {
  const { companyId } = await env.seedCompany();
  const dieId = await env.seedDie(companyId);
  const [seeded] = await env.seedBundles(companyId, dieId, 1);
  const [group] = await env.db.select({ id: bundleGroup.id }).from(bundleGroup).where(eq(bundleGroup.companyId, companyId));
  expect(seeded).toBeTruthy();
  // 12 rows x 9 params = 108 > 100
  const rows = Array.from({ length: 12 }, (_, i) => ({
    id: `over-${i}`,
    companyId,
    groupId: group!.id,
    dieId,
    serial: `OVER-${i}`,
    quantity: 1,
    weightG: 1,
    lengthMm: 1,
  }));
  const err = await (async () => env.db.insert(bundle).values(rows))().then(
    () => null,
    (e: unknown) => e as Error & { cause?: Error },
  );
  expect(err).not.toBeNull();
  // Drizzle wraps driver errors; the original message lives on `cause`.
  expect(`${err?.message} ${err?.cause?.message}`).toContain("D1_TOO_MANY_PARAMS");
});
