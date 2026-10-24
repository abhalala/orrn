/**
 * W1-PK-S FP-PK-07: party (customer) bundle numbers. Allocated at pack for bundles packed for an
 * order line of a customer with a policy, in the company's time zone: monthly `26J12` resets on the
 * 1st, fy `2026-27/12` resets on 1 April, lifelong never. Changing the policy never renumbers.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, bundle, customer } from "@orrn/db/schema";
import { and, asc, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { ist, kg, salesHelpers, SLOW, type SalesPlant } from "./sales-fixture";

let env: TestEnv;
let setClock: (at: Date | null) => void;

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
}, 60_000);
afterEach(() => setClock(null));
afterAll(async () => {
  await env.dispose();
});

const { plant } = salesHelpers(() => env);

async function setPolicy(p: SalesPlant, customerId: string, policy: "monthly" | "fy" | "lifelong" | null) {
  const [c] = await env.db.select({ name: customer.name }).from(customer).where(eq(customer.id, customerId));
  await p.owner.customer.update({ id: customerId, name: c!.name, bundleNumberPolicy: policy });
}

/** Pack `n` bundles for a fresh order line of `customerId`; party numbers in serial order. */
async function packFor(p: SalesPlant, customerId: string, n: number) {
  const o = await p.order([{ dieId: p.dieA, kg: 1000 }], { customerId });
  const res = await p.owner.bundle.createReceipt({
    dieId: p.dieA,
    unit: "pcs",
    locationId: p.yard,
    salesOrderLineId: o.lineIds[0],
    rows: Array.from({ length: n }, () => ({ quantity: 10, weightG: kg(10), lengthMm: 3_658 })),
  });
  const rows = await env.db
    .select({ serial: bundle.serial, partyNo: bundle.partyNo })
    .from(bundle)
    .where(and(eq(bundle.companyId, p.companyId), eq(bundle.groupId, res.groupId)))
    .orderBy(asc(bundle.serial));
  expect(res.bundles.map((b) => b.partyNo).sort()).toEqual(rows.map((r) => r.partyNo ?? "").sort());
  return rows.map((r) => r.partyNo);
}

describe("party bundle numbers", () => {
  test("monthly resets on the 1st in the company time zone (IST, not UTC)", async () => {
    setClock(ist("2026-10-31T23:58:00"));
    const p = await plant();
    await setPolicy(p, p.customerId, "monthly");
    expect(await packFor(p, p.customerId, 2)).toEqual(["26J1", "26J2"]);
    // 00:01 IST on 1 Nov is still 31 Oct in UTC: the series rolls on the plant's calendar.
    setClock(ist("2026-11-01T00:01:00"));
    expect(await packFor(p, p.customerId, 2)).toEqual(["26K1", "26K2"]);
  }, SLOW);

  test("fy resets on 1 April; lifelong never resets; two customers keep their own series", async () => {
    setClock(ist("2027-03-31T22:00:00"));
    const p = await plant();
    await setPolicy(p, p.customerId, "fy");
    await setPolicy(p, p.otherCustomer, "lifelong");
    expect(await packFor(p, p.customerId, 2)).toEqual(["2026-27/1", "2026-27/2"]);
    expect(await packFor(p, p.otherCustomer, 2)).toEqual(["1", "2"]);
    setClock(ist("2027-04-01T00:30:00"));
    expect(await packFor(p, p.customerId, 1)).toEqual(["2027-28/1"]);
    expect(await packFor(p, p.otherCustomer, 1)).toEqual(["3"]);
  }, SLOW);

  test("monthly rolls on 1 Nov while fy does not; fy rolls on 1 Apr", async () => {
    setClock(ist("2026-10-20T10:00:00"));
    const p = await plant();
    await setPolicy(p, p.customerId, "monthly");
    await setPolicy(p, p.otherCustomer, "fy");
    expect(await packFor(p, p.customerId, 1)).toEqual(["26J1"]);
    expect(await packFor(p, p.otherCustomer, 1)).toEqual(["2026-27/1"]);
    setClock(ist("2026-11-01T09:00:00"));
    expect(await packFor(p, p.customerId, 1)).toEqual(["26K1"]);
    expect(await packFor(p, p.otherCustomer, 1)).toEqual(["2026-27/2"]);
  }, SLOW);

  test("a policy change never renumbers packed bundles, and is audited", async () => {
    setClock(ist("2026-10-20T10:00:00"));
    const p = await plant();
    await setPolicy(p, p.customerId, "monthly");
    const before = await packFor(p, p.customerId, 2);
    await setPolicy(p, p.customerId, "lifelong");
    const after = await packFor(p, p.customerId, 1);
    expect(after).toEqual(["1"]);
    const all = await env.db
      .select({ partyNo: bundle.partyNo })
      .from(bundle)
      .where(eq(bundle.companyId, p.companyId))
      .orderBy(asc(bundle.serial));
    expect(all.map((b) => b.partyNo)).toEqual([...before, ...after]);
    const audits = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "customer.update")));
    const metas = audits.map((a) => (a.meta as { bundleNumberPolicy?: unknown } | null)?.bundleNumberPolicy).filter(Boolean);
    expect(metas).toContainEqual({ from: "monthly", to: "lifelong" });
  }, SLOW);

  test("plant stock (no order line) and a customer without a policy use the serial", async () => {
    setClock(ist("2026-10-20T10:00:00"));
    const p = await plant();
    const serials = await p.pack(p.dieA, [{ kg: 10 }]);
    const [b] = await env.db.select().from(bundle).where(eq(bundle.serial, serials[0]!));
    expect(b!.partyNo).toBe(b!.serial);
    const none = await packFor(p, p.customerId, 1);
    const [made] = await env.db.select().from(bundle).where(eq(bundle.partyNo, none[0]!));
    expect(made!.serial).toBe(none[0]!);
  }, SLOW);
});
