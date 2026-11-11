/**
 * Infinity Portal merge, lane B (plan C2 row B, A8, B4): the open order book. Admin merges orders
 * without `order.manage` (owner decision) through `createSalesOrder(..., { source: "ingest" })`;
 * rates are written only with `order.price` and `priceOnSalesOrder` on; an incomplete order stays a
 * booking with `confirm_blocked`, a complete one is confirmed through the extracted `confirmOrder`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { CompanyRole } from "@orrn/db/schema/tenant";

import { createTestEnv, type TestEnv } from "./harness";
import { apiFor, auditRows, candidateRow, contextFor, mergeAll, pump, rewindToCrash, seedCandidate, stagedRows, wireMergeEngine } from "./ingest-merge-fixture";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
  await wireMergeEngine();
}, 60_000);

afterAll(async () => {
  await env.dispose();
});

async function plant(settings: Record<string, unknown> = {}) {
  const { companyId } = await env.seedCompany({ settings: { dieRequiredOnSalesOrder: false, ...settings } });
  const customerId = await env.seedCustomer(companyId);
  const dieId = await env.seedDie(companyId, { series: "R", sectionCode: "8100" });
  return { companyId, customerId, dieId };
}

function line(customerId: string, dieId: string, extra: Record<string, unknown> = {}) {
  return {
    values: {
      customer: "Party",
      orderDate: "2025-10-31",
      series: "R",
      sectionCode: "8100",
      cutLength: 3658,
      bakiKg: 250_000,
      ...extra,
      _ids: { customer: customerId, sectionCode: dieId },
    },
  };
}

async function orderRows(companyId: string) {
  const { salesOrder, salesOrderLine } = await import("@orrn/db/schema/sales");
  const { eq } = await import("drizzle-orm");
  const orders = await env.db.select().from(salesOrder).where(eq(salesOrder.companyId, companyId));
  const lines = await env.db.select().from(salesOrderLine).where(eq(salesOrderLine.companyId, companyId));
  return { orders, lines };
}

async function api(companyId: string, role: CompanyRole) {
  return apiFor(await contextFor(env, companyId, role));
}

describe("orders", () => {
  test("admin merges orders without order.manage; rows of one order become one order", async () => {
    const { companyId, customerId, dieId } = await plant();
    const admin = await api(companyId, "admin");
    // The order screens refuse admin; the merge does not need them (owner decision, plan A8).
    await expect(
      admin.orders.create({ customerId, lines: [{ sectionId: dieId, cutLengthMm: 3658, kgG: 1000 }] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const seeded = await seedCandidate(env, companyId, "orders", [
      line(customerId, dieId, { oldOrderNo: "B-17", pcs: 40 }),
      line(customerId, dieId, { oldOrderNo: "B-17", cutLength: 4877 }),
      line(customerId, dieId, { oldOrderNo: "B-18" }),
    ]);
    const res = await mergeAll(admin);
    expect(res.state).toBe("done");

    const { orders, lines } = await orderRows(companyId);
    expect(orders).toHaveLength(2);
    const b17 = orders.find((o) => o.note === "Old order no. B-17")!;
    expect(b17).toMatchObject({ customerId, orderDate: "2025-10-31", source: "office" });
    expect(lines.filter((l) => l.salesOrderId === b17.id).map((l) => [l.cutLengthMm, l.kgG]).sort()).toEqual([
      [3658, 250_000],
      [4877, 250_000],
    ]);
    const rows = await stagedRows(env, seeded.candidateId);
    expect(rows.map((r) => r.committedType)).toEqual(["sales_order", "sales_order", "sales_order"]);
    expect(rows[0]!.committedId).toBe(b17.id);
    expect(rows[1]!.committedId).toBe(b17.id);
    expect(rows[2]!.committedId).not.toBe(b17.id);

    const audits = await auditRows(env, companyId, "order.create");
    expect(audits).toHaveLength(2);
    for (const a of audits) expect((a.meta as { source?: { candidateId: string } }).source?.candidateId).toBe(seeded.candidateId);
    expect((await candidateRow(env, seeded.candidateId)).state).toBe("merged");
  });

  test("an incomplete order stays a booking with confirm_blocked; that is not a failure", async () => {
    const { companyId, customerId, dieId } = await plant();
    const seeded = await seedCandidate(env, companyId, "orders", [line(customerId, dieId, { oldOrderNo: "C-1" })]);
    const res = await mergeAll(await api(companyId, "admin"));
    expect(res.state).toBe("done");
    const { orders } = await orderRows(companyId);
    expect(orders.map((o) => o.status)).toEqual(["booking"]);
    const [row] = await stagedRows(env, seeded.candidateId);
    expect(row!.mergeState).toBe("written");
    expect(row!.reasons).toContain("confirm_blocked:po_number, line_1_pcs");
    expect(await auditRows(env, companyId, "order.confirm")).toHaveLength(0);
  });

  test("a complete order is confirmed through confirmOrder, with the source in its audit row", async () => {
    const { companyId, customerId, dieId } = await plant();
    const seeded = await seedCandidate(env, companyId, "orders", [line(customerId, dieId, { poNumber: "PO-991", pcs: 30 })]);
    expect((await mergeAll(await api(companyId, "admin"))).state).toBe("done");
    const { orders } = await orderRows(companyId);
    expect(orders.map((o) => [o.status, o.poNumber])).toEqual([["confirmed", "PO-991"]]);
    const [confirm] = await auditRows(env, companyId, "order.confirm");
    expect((confirm!.meta as { source?: { candidateId: string } }).source?.candidateId).toBe(seeded.candidateId);
    expect((await stagedRows(env, seeded.candidateId))[0]!.reasons ?? []).not.toContainEqual(expect.stringContaining("confirm_blocked"));
  });

  test("rates: dropped for admin (no order.price) and when priceOnSalesOrder is off; kept for owner with it on", async () => {
    const cases: { role: CompanyRole; on: boolean; rate: number | null }[] = [
      { role: "admin", on: true, rate: null },
      { role: "owner", on: false, rate: null },
      { role: "owner", on: true, rate: 21_500 },
    ];
    for (const c of cases) {
      const { companyId, customerId, dieId } = await plant({ priceOnSalesOrder: c.on });
      await seedCandidate(env, companyId, "orders", [line(customerId, dieId, { rate: 21_500 })]);
      expect((await mergeAll(await api(companyId, c.role))).state).toBe("done");
      const { lines } = await orderRows(companyId);
      expect([c.role, c.on, lines.map((l) => l.ratePaise)]).toEqual([c.role, c.on, [c.rate]]);
    }
  });

  test("orders module off: the orders candidate is held, nothing is written", async () => {
    const { companyId } = await env.seedCompany({ modules: ["customers", "dies"] });
    const customerId = await env.seedCustomer(companyId);
    const dieId = await env.seedDie(companyId);
    const seeded = await seedCandidate(env, companyId, "orders", [line(customerId, dieId)]);
    expect((await mergeAll(await api(companyId, "admin"))).state).toBe("done_with_holds");
    expect(await candidateRow(env, seeded.candidateId)).toMatchObject({ state: "held", reasonCode: "merge_failed" });
    expect((await orderRows(companyId)).orders).toHaveLength(0);
  });

  test("a crash after the order was made: the resume makes no second order", async () => {
    const { companyId, customerId, dieId } = await plant();
    const admin = await api(companyId, "admin");
    const seeded = await seedCandidate(env, companyId, "orders", [line(customerId, dieId, { oldOrderNo: "D-4" })]);
    const first = await mergeAll(admin);
    const before = (await stagedRows(env, seeded.candidateId))[0]!.committedId;
    const cursor = await rewindToCrash(env, first.runId, seeded.candidateId);
    expect((await pump(admin, first.runId, cursor)).state).toBe("done");
    expect((await orderRows(companyId)).orders).toHaveLength(1);
    expect((await stagedRows(env, seeded.candidateId))[0]!.committedId).toBe(before);
    expect(await auditRows(env, companyId, "order.create")).toHaveLength(1);
  });

  test("a line the order screens would refuse is refused here too (no cut length)", async () => {
    const { companyId, customerId, dieId } = await plant();
    const seeded = await seedCandidate(env, companyId, "orders", [line(customerId, dieId, { cutLength: null })]);
    expect((await mergeAll(await api(companyId, "admin"))).state).toBe("done_with_holds");
    const c = await candidateRow(env, seeded.candidateId);
    expect(c.state).toBe("held");
    expect(c.reasonDetail).toContain("lines.0.cutLengthMm");
  });
});
