/**
 * PL-W6: the local demo seed (POST /dev/seed, run before every e2e) must stay re-runnable after
 * the store screens have made entries. `store_txn` references `location` and `store_item` with ON
 * DELETE RESTRICT, and the seed's reset deletes the demo locations and document series; without
 * clearing the store first, the second seed fails on the foreign key (and a fresh GRN-1 would
 * collide with a leftover GRN). W2-SEED: the demo store is not empty any more (five items, five
 * GRNs, three issues); the reset puts back exactly those and the numbers continue after them.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { storeItem, storeTxn } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { precreateDevSeedUsers } from "./dev-seed-fixture";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

describe("dev seed after store entries", () => {
  test("re-runs cleanly, puts the demo store back, and GRN numbers continue after the seeded ones", async () => {
    const { user } = await import("@orrn/db/schema");
    await precreateDevSeedUsers(env);
    const seedPath = "../../../apps/server/src/dev-seed";
    const { seedDevData } = (await import(seedPath)) as {
      seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
    };
    const companyId = "dev-company-orrn";

    expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
    const owner = env.caller({ role: "owner", companyId });
    const seeded = async () => ({
      items: (await env.db.select().from(storeItem).where(eq(storeItem.companyId, companyId))).map((i) => i.name).sort(),
      entries: (await env.db.select().from(storeTxn).where(eq(storeTxn.companyId, companyId))).map((t) => t.number).sort(),
    });
    const demo = await seeded();
    expect(demo.items).toEqual(["Container heater element", "Degasser tablets", "Grain refiner", "Hydraulic oil", "Silicon metal"]);
    expect(demo.entries).toEqual(["GRN-1", "GRN-2", "GRN-3", "GRN-4", "GRN-5", "MRS-1", "MRS-2", "MRS-3"]);
    // The kg ledger agrees with the entries (grams = milli units).
    const balances = (await owner.store.balances()).items;
    expect(Object.fromEntries(balances.map((b) => [b.name, b.balanceMilli]))).toMatchObject({
      "Grain refiner": 52_500,
      "Degasser tablets": 36_000,
      "Silicon metal": 120_000,
      "Container heater element": 5_000,
      "Hydraulic oil": 400_000,
    });

    const flux = await owner.store.items.create({ name: "Cover flux", unit: "kg", category: "chemical" });
    const grn = await owner.store.receive({ itemId: flux.id, qtyMilli: 25_000, clientRequestId: "seed-test-1" });
    await owner.store.issue({ itemId: flux.id, qtyMilli: 5_000, purpose: "melt" });
    expect(grn.number).toBe("GRN-6");

    expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
    expect(await seeded()).toEqual(demo);

    // The store works again on the fresh books, numbering after the seeded ones.
    const again = await owner.store.items.create({ name: "Cover flux", unit: "kg", category: "chemical" });
    const next = await owner.store.receive({ itemId: again.id, qtyMilli: 1_000 });
    expect(next.number).toBe("GRN-6");
  });
});
