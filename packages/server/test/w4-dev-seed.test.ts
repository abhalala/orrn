/**
 * W4-MASTERS review round 1 (dev seed, run before every e2e):
 * - I-4: the reset clears `auth_throttle`, so the forgot-password e2e can be rerun back-to-back
 *   (the throttle is 5 per 15 min per address and per IP).
 * - m-6: the seeded collector melt is a real locked melt: times in lock order and figures (no 0-kg melt).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { authThrottle, melt } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

async function seed() {
  const seedPath = "../../../apps/server/src/dev-seed";
  const { seedDevData } = (await import(seedPath)) as {
    seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
  };
  expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
}

describe("dev seed reset (W4-MASTERS review round 1)", () => {
  test("I-4: a reseed clears the password-reset throttle", async () => {
    const { user } = await import("@orrn/db/schema");
    for (const key of ["owner", "operator", "viewer", "office", "dieroom", "supervisor", "press", "staff"]) {
      await env.db.insert(user).values({ id: `dev-user-${key}`, name: key, email: `${key}@orrn.local` }).onConflictDoNothing();
    }
    await seed();
    await env.db.insert(authThrottle).values([
      { key: "email:abc", windowStart: Date.now(), hits: 6 },
      { key: "ip:127.0.0.1", windowStart: Date.now(), hits: 6 },
    ]);
    await seed();
    expect(await env.db.select().from(authThrottle)).toHaveLength(0);
  });

  test("m-6: the seeded melt has its times in lock order and its figures", async () => {
    const [m] = await env.db.select().from(melt).where(eq(melt.id, "dev-melt-1"));
    expect(m).toBeDefined();
    expect(m!.status).toBe("locked");
    const times = [m!.preheatStartAt, m!.chargingStartAt, m!.chargingEndAt, m!.castingStartAt, m!.castingEndAt].map((d) => d?.getTime() ?? null);
    expect(times.every((x) => x != null)).toBe(true);
    expect([...(times as number[])].sort((a, b) => a - b)).toEqual(times as number[]);
    expect(m!.castingEndAt!.getTime()).toBeLessThan(Date.now());
    expect(m!.inputG).toBeGreaterThan(0);
    expect(m!.logsG).toBeGreaterThan(0);
    expect(m!.logsPcs).toBeGreaterThan(0);
    expect(m!.logsG).toBeLessThanOrEqual(m!.inputG);
    expect(m!.furnaceId).toBe("dev-furnace-f1");
  });

  test("the demo plant packs without a cast although a melt is locked (requireCastOnBundle off)", async () => {
    const { company } = await import("@orrn/db/schema");
    const [c] = await env.db.select({ settings: company.settings }).from(company).where(eq(company.id, "dev-company-orrn"));
    expect((c!.settings as Record<string, unknown>).requireCastOnBundle).toBe(false);
  });
});
