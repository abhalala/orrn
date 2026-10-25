/**
 * W1-OP-S: the dev seed's demo orders (three orders, lines in different states, one late) are
 * idempotent and readable through the real procedures.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";

import { salesOrder, salesOrderLine, user } from "@orrn/db/schema";
import { asc, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

test("dev seed: SO-1 late with bundles packed, SO-2 confirmed on band start, SO-3 booking; re-running gives the same rows", async () => {
  for (const key of ["owner", "operator", "viewer", "office", "dieroom", "staff"]) {
    await env.db.insert(user).values({ id: `dev-user-${key}`, name: key, email: `${key}@orrn.local` }).onConflictDoNothing();
  }
  const seedPath = "../../../apps/server/src/dev-seed";
  const { seedDevData } = (await import(seedPath)) as {
    seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
  };
  const companyId = "dev-company-orrn";
  const snapshot = async () => ({
    orders: await env.db
      .select({ id: salesOrder.id, number: salesOrder.number, status: salesOrder.status, po: salesOrder.poNumber })
      .from(salesOrder)
      .where(eq(salesOrder.companyId, companyId))
      .orderBy(asc(salesOrder.id)),
    lines: await env.db
      .select({ id: salesOrderLine.id, kgG: salesOrderLine.kgG, pcs: salesOrderLine.pcs, basis: salesOrderLine.weightBasis })
      .from(salesOrderLine)
      .where(eq(salesOrderLine.companyId, companyId))
      .orderBy(asc(salesOrderLine.id)),
  });
  expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
  const first = await snapshot();
  expect(first.orders).toEqual([
    { id: "dev-so-1", number: "SO-1", status: "confirmed", po: "PO-4471" },
    { id: "dev-so-2", number: "SO-2", status: "confirmed", po: "PO-118" },
    { id: "dev-so-3", number: "SO-3", status: "booking", po: null },
  ]);
  expect(first.lines).toHaveLength(4);

  const owner = env.caller({ role: "owner", companyId });
  const late = await owner.orders.late({});
  expect([...new Set(late.lines.map((l) => l.orderNumber))]).toEqual(["SO-1"]);
  const so1 = await owner.orders.get({ id: "dev-so-1" });
  expect(so1.lineDetails[0]!.strip.packedG).toBeGreaterThan(0);
  expect(so1.lineDetails[1]!.strip).toMatchObject({ packedG: 0, dispatchedG: 0 });
  const so3 = await owner.orders.get({ id: "dev-so-3" });
  expect(so3.confirmBlockers).toContain("po_number");
  expect((await owner.orders.timeline({ id: "dev-so-1" })).events.map((e) => e.action)).toEqual(["order.create", "order.confirm"]);

  expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
  expect(await snapshot()).toEqual(first);
  // The SO series continues after the seeded book.
  const c = so1.order.customerId;
  const made = await owner.orders.create({ customerId: c, lines: [{ sectionId: so1.lines[0]!.sectionId, cutLengthMm: 3_658, kgG: 1_000 }] });
  expect(made.number).toBe("SO-4");
}, 120_000);
