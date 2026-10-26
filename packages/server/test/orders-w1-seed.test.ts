/**
 * W1-OP-S: the dev seed's demo order book (ten orders in every state, one late) is idempotent and
 * readable through the real procedures; W2-SEED: the figures on every line add up.
 */
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";

import { salesOrder, salesOrderLine } from "@orrn/db/schema";
import { asc, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { precreateDevSeedUsers } from "./dev-seed-fixture";

// The seed / matrix tests in this file take 2 to 5 s of Miniflare work each; bun's 5 s default fails them when the machine is busy.
setDefaultTimeout(30_000);

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

test("dev seed: ten orders in every state, SO-1 late with bundles packed; re-running gives the same rows", async () => {
  await precreateDevSeedUsers(env);
  const seedPath = "../../../apps/server/src/dev-seed";
  const { seedDevData } = (await import(seedPath)) as {
    seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
  };
  const companyId = "dev-company-orrn";
  const snapshot = async () => ({
    orders: (
      await env.db
        .select({ id: salesOrder.id, number: salesOrder.number, status: salesOrder.status, po: salesOrder.poNumber })
        .from(salesOrder)
        .where(eq(salesOrder.companyId, companyId))
    ).sort((a, b) => Number(a.number.slice(3)) - Number(b.number.slice(3))),
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
    // W3-PORTAL-S: KD Extrusion's booking from the party portal (placed by party@orrn.local).
    { id: "dev-so-4", number: "SO-4", status: "booking", po: null },
    // W2-SEED: closed (two Tejura trucks), cancelled, two dispatching, one confirmed with a reserved dispatch.
    { id: "dev-so-5", number: "SO-5", status: "closed", po: "PO-T-77" },
    { id: "dev-so-6", number: "SO-6", status: "cancelled", po: "PO-2288" },
    { id: "dev-so-7", number: "SO-7", status: "dispatching", po: "PO-4502" },
    { id: "dev-so-8", number: "SO-8", status: "dispatching", po: "PO-2291" },
    { id: "dev-so-9", number: "SO-9", status: "confirmed", po: "PO-T-81" },
    // KD's own die 12230 (the owned-die refusal is reachable): 8 bundles packed for it.
    { id: "dev-so-10", number: "SO-10", status: "confirmed", po: "PO-4533" },
  ]);
  expect(first.lines).toHaveLength(17);

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
  // The SO series continues after the seeded book (SO-1..SO-10).
  const c = so1.order.customerId;
  const made = await owner.orders.create({ customerId: c, lines: [{ sectionId: so1.lines[0]!.sectionId, cutLengthMm: 3_658, kgG: 1_000 }] });
  expect(made.number).toBe("SO-11");
}, 120_000);
