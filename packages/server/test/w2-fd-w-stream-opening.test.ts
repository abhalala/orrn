/**
 * W2-FD-W: the opening balance of a return stream (`foundry.returnStreams.opening`, masters.publish):
 * a fresh plant states what it holds of plant scrap, dross and the rest, so its first melt can take
 * metal from a stream. One per stream, ledger append-only, nobody on the floor posts it.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { auditLog, stockLedger } from "@orrn/db/schema";

import { createTestEnv, type TestEnv } from "./harness";
import { kg, pressHelpers } from "./press-w2-fixture";

setDefaultTimeout(60_000);

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});
const { pressPlant } = pressHelpers(() => env);

describe("foundry.returnStreams.opening", () => {
  test("posts one opening row at plant scrap, the balance shows it, and a second post is refused", async () => {
    const p = await pressPlant();
    const m = p.as("manager");
    await m.foundry.returnStreams.seedDefaults();
    const streams = (await m.foundry.returnStreams.list()).items;
    const scrap = streams.find((s) => s.code === "PLANT-SCRAP")!;
    expect(scrap.balanceG).toBe(0);
    expect(scrap.hasOpening).toBe(false);

    const res = await m.foundry.returnStreams.opening({ streamId: scrap.id, kgG: kg(2_000), note: "Count on go-live day" });
    expect(res).toMatchObject({ code: "PLANT-SCRAP", kgG: kg(2_000) });
    const after = (await m.foundry.returnStreams.list()).items;
    expect(after.find((s) => s.id === scrap.id)!.balanceG).toBe(kg(2_000));
    // The list says which streams have their one opening, so the screen stops offering it.
    expect(after.find((s) => s.id === scrap.id)!.hasOpening).toBe(true);
    expect(after.filter((s) => s.id !== scrap.id).every((s) => s.hasOpening === false)).toBe(true);

    const rows = await env.db.select().from(stockLedger).where(and(eq(stockLedger.companyId, p.companyId), eq(stockLedger.itemRef, scrap.id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ voucherType: "opening", itemKind: "return_stream", locationId: p.plantScrapId, qtyG: kg(2_000), reason: "Count on go-live day" });
    const audit = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "return_stream.opening")));
    expect(audit).toHaveLength(1);

    await expect(m.foundry.returnStreams.opening({ streamId: scrap.id, kgG: kg(1) })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Plant scrap already has an opening balance" });
    expect((await m.foundry.returnStreams.list()).items.find((s) => s.id === scrap.id)!.balanceG).toBe(kg(2_000));
  });

  test("masters.publish only; a retired stream, zero kg and another plant's stream are refused", async () => {
    const p = await pressPlant();
    const m = p.as("manager");
    await m.foundry.returnStreams.seedDefaults();
    const dross = (await m.foundry.returnStreams.list()).items.find((s) => s.code === "DROSS")!;
    for (const role of ["foundry", "supervisor", "storekeeper", "viewer", "office"] as const) {
      await expect(p.as(role).foundry.returnStreams.opening({ streamId: dross.id, kgG: kg(5) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(m.foundry.returnStreams.opening({ streamId: dross.id, kgG: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const q = await pressPlant();
    await expect(q.as("manager").foundry.returnStreams.opening({ streamId: dross.id, kgG: kg(5) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await m.foundry.returnStreams.update({ id: dross.id, active: false });
    await expect(m.foundry.returnStreams.opening({ streamId: dross.id, kgG: kg(5) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
