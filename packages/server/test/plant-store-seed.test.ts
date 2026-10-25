/**
 * PL-W6: the local demo seed (POST /dev/seed, run before every e2e) must stay re-runnable after
 * the store screens have made entries. `store_txn` references `location` and `store_item` with ON
 * DELETE RESTRICT, and the seed's reset deletes the demo locations and document series; without
 * clearing the store first, the second seed fails on the foreign key (and a fresh GRN-1 would
 * collide with a leftover GRN-1).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { storeItem, storeTxn } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

describe("dev seed after store entries", () => {
  test("re-runs cleanly, clears the demo store, and GRN numbers start again", async () => {
    const { user } = await import("@orrn/db/schema");
    for (const key of ["owner", "operator", "viewer", "office", "dieroom", "supervisor", "press", "staff"]) {
      await env.db.insert(user).values({ id: `dev-user-${key}`, name: key, email: `${key}@orrn.local` });
    }
    const seedPath = "../../../apps/server/src/dev-seed";
    const { seedDevData } = (await import(seedPath)) as {
      seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
    };
    const companyId = "dev-company-orrn";

    expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
    const owner = env.caller({ role: "owner", companyId });
    const flux = await owner.store.items.create({ name: "Cover flux", unit: "kg", category: "chemical" });
    const grn = await owner.store.receive({ itemId: flux.id, qtyMilli: 25_000, clientRequestId: "seed-test-1" });
    await owner.store.issue({ itemId: flux.id, qtyMilli: 5_000, purpose: "melt" });
    expect(grn.number).toBe("GRN-1");

    expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
    expect(await env.db.select().from(storeTxn).where(eq(storeTxn.companyId, companyId))).toHaveLength(0);
    expect(await env.db.select().from(storeItem).where(eq(storeItem.companyId, companyId))).toHaveLength(0);

    // The store works again on the fresh books, numbering from 1.
    const again = await owner.store.items.create({ name: "Cover flux", unit: "kg", category: "chemical" });
    const next = await owner.store.receive({ itemId: again.id, qtyMilli: 1_000 });
    expect(next.number).toBe("GRN-1");
  });
});
