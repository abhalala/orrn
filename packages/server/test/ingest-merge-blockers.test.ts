/**
 * Infinity Portal merge, lane B: the two BLOCKER classes of the merge review, driven through the
 * real `ingest.merge.*` procedures and the real order, customer and bundle procedures behind them.
 *
 * 1. One old order is one order: its lines spread over the sheet, or several old order numbers on
 *    one PO, merge into the right orders with no second order and no row left behind (B1, B5, B8).
 * 2. A `ready_update` row never takes a create path, whatever chunk it is in (B6).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { CompanyRole } from "@orrn/db/schema/tenant";

import { createTestEnv, type TestEnv } from "./harness";
import { apiFor, auditRows, candidateRow, contextFor, mergeAll, seedCandidate, stagedRows } from "./ingest-merge-fixture";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);

afterAll(async () => {
  await env.dispose();
});

async function api(companyId: string, role: CompanyRole = "admin") {
  return apiFor(await contextFor(env, companyId, role));
}

async function plant() {
  const { companyId } = await env.seedCompany({ settings: { dieRequiredOnSalesOrder: false } });
  const customerId = await env.seedCustomer(companyId);
  const dieId = await env.seedDie(companyId, { series: "R", sectionCode: "8100" });
  return { companyId, customerId, dieId };
}

function line(customerId: string, dieId: string, extra: Record<string, unknown>) {
  return {
    values: {
      customer: "Party",
      orderDate: "2025-10-31",
      series: "R",
      sectionCode: "8100",
      bakiKg: 250_000,
      pcs: 5,
      ...extra,
      _ids: { customer: customerId, sectionCode: dieId },
    },
  };
}

async function orderBook(companyId: string) {
  const { salesOrder, salesOrderLine } = await import("@orrn/db/schema/sales");
  const { eq } = await import("drizzle-orm");
  const orders = await env.db.select().from(salesOrder).where(eq(salesOrder.companyId, companyId));
  const lines = await env.db.select().from(salesOrderLine).where(eq(salesOrderLine.companyId, companyId));
  return { orders, lines };
}

async function count(table: "customer" | "bundle" | "sales_order", companyId: string): Promise<number> {
  const row = await env.d1.prepare(`select count(*) as n from ${table} where company_id = ?`).bind(companyId).first<{ n: number }>();
  return Number(row?.n ?? 0);
}

describe("one old order is one order (B1, B5)", () => {
  test("an old order split over the sheet and two old orders on one PO merge into the right orders: no duplicate, no orphan, a rerun adds nothing", async () => {
    const { companyId, customerId, dieId } = await plant();
    const rows: ReturnType<typeof line>[] = [];
    // 12 old orders with no PO, 3 lines each, row i in order i % 12: every order spans the sheet,
    // so the planner packs 10 whole orders and the chunk ranges overlap.
    for (let i = 0; i < 36; i += 1) rows.push(line(customerId, dieId, { oldOrderNo: `O-${i % 12}`, cutLength: 1000 + i }));
    // One PO under two old order numbers, in two spellings, spread between them: one order.
    rows.splice(5, 0, line(customerId, dieId, { poNumber: "PO-77", oldOrderNo: "B-1", cutLength: 2001 }));
    rows.splice(17, 0, line(customerId, dieId, { poNumber: "po-77 ", oldOrderNo: "B-2", cutLength: 2002 }));
    rows.splice(30, 0, line(customerId, dieId, { poNumber: "PO-77", oldOrderNo: "B-1", cutLength: 2003 }));
    const seeded = await seedCandidate(env, companyId, "orders", rows);

    const admin = await api(companyId);
    const res = await mergeAll(admin);
    expect(res.state).toBe("done");
    expect(res.chunksWritten).toBe(2);

    const { orders, lines } = await orderBook(companyId);
    expect(orders).toHaveLength(13);
    const staged = await stagedRows(env, seeded.candidateId);
    // No orphan: every row is written to an order that holds its line, and every order has lines.
    expect(staged.every((r) => r.mergeState === "written" && r.committedType === "sales_order")).toBe(true);
    const cutOf = new Map(staged.map((r) => [r.id, (r.values as { cutLength: number }).cutLength]));
    for (const r of staged) {
      expect(lines.some((l) => l.salesOrderId === r.committedId && l.cutLengthMm === cutOf.get(r.id))).toBe(true);
    }
    for (const o of orders) {
      expect(lines.filter((l) => l.salesOrderId === o.id).length).toBe(staged.filter((r) => r.committedId === o.id).length);
    }
    // No duplicate: each old order and the PO are one order each.
    const byKey = new Map<string, Set<string>>();
    for (const r of staged) {
      const v = r.values as { poNumber?: string; oldOrderNo: string };
      const key = v.poNumber ? `po:${v.poNumber.trim().toLowerCase()}` : `old:${v.oldOrderNo}`;
      byKey.set(key, (byKey.get(key) ?? new Set()).add(r.committedId!));
    }
    expect(byKey.size).toBe(13);
    for (const ids of byKey.values()) expect(ids.size).toBe(1);
    const po = orders.find((o) => o.poNumber === "PO-77")!;
    expect(lines.filter((l) => l.salesOrderId === po.id).map((l) => l.cutLengthMm).sort()).toEqual([2001, 2002, 2003]);
    // Both old order numbers stay on the order.
    expect(po.note).toBe("Old order no. B-1, B-2");

    // A rerun of the same candidate writes nothing new.
    const { ingestCandidate } = await import("@orrn/db/schema/ingest");
    const { eq } = await import("drizzle-orm");
    await env.db.update(ingestCandidate).set({ state: "approved" }).where(eq(ingestCandidate.id, seeded.candidateId));
    expect((await mergeAll(admin)).state).toBe("done");
    expect(await count("sales_order", companyId)).toBe(13);
    expect(await auditRows(env, companyId, "order.create")).toHaveLength(13);
  });
});

describe("rows the dry run matched to a live order (lane A, order_exists)", () => {
  test("an unchanged order_exists row writes nothing; the new order beside it is made once", async () => {
    const { companyId, customerId, dieId } = await plant();
    const liveOrder = await (await api(companyId, "owner")).orders.create({ customerId, lines: [{ sectionId: dieId, cutLengthMm: 3658, kgG: 1000 }] });
    const seeded = await seedCandidate(env, companyId, "orders", [
      { ...line(customerId, dieId, { oldOrderNo: "L-1", cutLength: 3658 }), state: "unchanged" as const, matchId: liveOrder.id },
      line(customerId, dieId, { oldOrderNo: "N-2", cutLength: 3000 }),
    ]);
    expect((await mergeAll(await api(companyId))).state).toBe("done");
    expect(await count("sales_order", companyId)).toBe(2);
    const [matched, fresh] = await stagedRows(env, seeded.candidateId);
    expect(matched).toMatchObject({ mergeState: "open", committedType: null, committedId: null });
    expect(fresh).toMatchObject({ mergeState: "written", committedType: "sales_order" });
    expect(fresh!.committedId).not.toBe(liveOrder.id);
    expect((await orderBook(companyId)).lines.filter((l) => l.salesOrderId === liveOrder.id)).toHaveLength(1);
  });
});

describe("a ready_update row never becomes a create (B6)", () => {
  test("customers: an update with no record in a later chunk holds the candidate before any customer changes", async () => {
    const { companyId } = await env.seedCompany();
    const ids: string[] = [];
    for (let i = 0; i < 24; i += 1) ids.push(await env.seedCustomer(companyId));
    const upd = (id: string | null, i: number) => ({
      state: "ready_update" as const,
      matchId: id,
      values: { name: `Customer ${i}`, phone: `98250${String(i).padStart(5, "0")}` },
      diff: { phone: { live: null, file: `98250${String(i).padStart(5, "0")}` } },
    });
    // 20 updates per chunk: the row with no record is in the second chunk.
    const seeded = await seedCandidate(env, companyId, "customers", [...ids.map((id, i) => upd(id, i)), upd(null, 24)]);
    const res = await mergeAll(await api(companyId));
    expect(res.state).toBe("done_with_holds");
    const c = await candidateRow(env, seeded.candidateId);
    expect(c.state).toBe("held");
    expect(c.reasonDetail).toBe("File row 25 has no record to update. Pick the record to use, or add it as new.");
    expect(await auditRows(env, companyId, "customer.update")).toHaveLength(0);
    expect(await count("customer", companyId)).toBe(24);
    expect((await stagedRows(env, seeded.candidateId)).every((r) => r.mergeState === "open" && r.committedId === null)).toBe(true);
  });

  test("bundles: a ready_update row, with or without a record, is never sent as a new bundle", async () => {
    const { companyId } = await env.seedCompany();
    const dieId = await env.seedDie(companyId, { series: "R", sectionCode: "4100" });
    const [live] = await env.seedBundles(companyId, dieId, 1);
    const bundleRow = (n: number, extra: Record<string, unknown> = {}) => ({
      values: { legacyId: `ckb6old00000000000000000${n}`, series: "R", sectionCode: "4100", quantity: 12, weightG: 24_500, lengthMm: 3658, _ids: { sectionCode: dieId } },
      ...extra,
    });
    const before = await count("bundle", companyId);
    const noRecord = await seedCandidate(env, companyId, "bundles", [bundleRow(1), bundleRow(2, { state: "ready_update", matchId: null })]);
    const withRecord = await seedCandidate(env, companyId, "bundles", [bundleRow(3), bundleRow(4, { state: "ready_update", matchId: live!.id })]);
    const res = await mergeAll(await api(companyId));
    expect(res.state).toBe("done_with_holds");
    expect((await candidateRow(env, noRecord.candidateId)).reasonDetail).toBe("File row 2 has no record to update. Pick the record to use, or add it as new.");
    expect((await candidateRow(env, withRecord.candidateId)).reasonDetail).toBe(
      "File row 2 would change a bundle already in orrn. An import only adds new bundles. Skip the row.",
    );
    expect(await count("bundle", companyId)).toBe(before);
  });

  test("orders: a ready_update row on a live order never makes a second order", async () => {
    const { companyId, customerId, dieId } = await plant();
    const liveOrder = await (await api(companyId, "owner")).orders.create({ customerId, lines: [{ sectionId: dieId, cutLengthMm: 3658, kgG: 1000 }] });
    const seeded = await seedCandidate(env, companyId, "orders", [
      line(customerId, dieId, { oldOrderNo: "N-1", cutLength: 3000 }),
      { ...line(customerId, dieId, { oldOrderNo: "L-1", cutLength: 3658 }), state: "ready_update" as const, matchId: liveOrder.id },
    ]);
    const res = await mergeAll(await api(companyId));
    expect(res.state).toBe("done_with_holds");
    const c = await candidateRow(env, seeded.candidateId);
    expect(c.state).toBe("held");
    expect(c.reasonDetail).toBe("File row 2 would change an order already in orrn. An import only adds new orders. Skip the row.");
    expect(await count("sales_order", companyId)).toBe(1);
  });
});
