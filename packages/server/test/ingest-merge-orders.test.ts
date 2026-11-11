/**
 * Infinity Portal merge, lane B (plan C2 row B, A8, B4): the open order book. Admin merges orders
 * without `order.manage` (owner decision) through `createSalesOrder(..., { source: "ingest" })`;
 * rates are written only with `order.price` and `priceOnSalesOrder` on; an incomplete order stays a
 * booking with `confirm_blocked`, a complete one is confirmed through the extracted `confirmOrder`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { CompanyRole } from "@orrn/db/schema/tenant";

import { createTestEnv, type TestEnv } from "./harness";
import { apiFor, auditRows, candidateRow, contextFor, mergeAll, pump, rewindToCrash, seedCandidate, stagedRows } from "./ingest-merge-fixture";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
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
    expect(b17).toMatchObject({ customerId, orderDate: "2025-10-31", source: "ingest" });
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

  test("rates: kept for owner with priceOnSalesOrder on; never dropped without a choice (B3)", async () => {
    const { companyId, customerId, dieId } = await plant({ priceOnSalesOrder: true });
    await seedCandidate(env, companyId, "orders", [line(customerId, dieId, { rate: 21_500 })]);
    expect((await mergeAll(await api(companyId, "owner"))).state).toBe("done");
    expect((await orderRows(companyId)).lines.map((l) => l.ratePaise)).toEqual([21_500]);
  });

  test("rates staged while the person merging cannot price: held before any write, nothing dropped (B3)", async () => {
    const cases: { role: CompanyRole; on: boolean; message: string }[] = [
      { role: "admin", on: true, message: "This sheet has rates. Only someone who may see prices can merge it: ask the owner to merge, or leave the rates out on this candidate." },
      { role: "owner", on: false, message: "This sheet has rates, and rates on sales orders are off for this plant. Turn rates on first, or take the rate column out of this sheet's layout." },
    ];
    for (const c of cases) {
      const { companyId, customerId, dieId } = await plant({ priceOnSalesOrder: c.on });
      const seeded = await seedCandidate(env, companyId, "orders", [line(customerId, dieId, { oldOrderNo: "R-1" }), line(customerId, dieId, { oldOrderNo: "R-2", rate: 21_500 })]);
      expect((await mergeAll(await api(companyId, c.role))).state).toBe("done_with_holds");
      const held = await candidateRow(env, seeded.candidateId);
      expect([c.role, held.state, held.reasonDetail]).toEqual([c.role, "held", c.message]);
      expect((await orderRows(companyId)).orders).toHaveLength(0);
    }
    // With the rate left out by choice (the dry run deletes it from the staged values), admin merges.
    const { companyId, customerId, dieId } = await plant({ priceOnSalesOrder: true });
    await seedCandidate(env, companyId, "orders", [line(customerId, dieId, { oldOrderNo: "R-3" })]);
    expect((await mergeAll(await api(companyId, "admin"))).state).toBe("done");
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
    expect(c.reasonDetail).toBe("File row 1: no cut length. Give the cut length, or skip the row.");
  });
});

describe("one order is never sent as two (B1, B5)", () => {
  test("an order of 150 lines on one PO is held before anything of the candidate is written", async () => {
    const { companyId, customerId, dieId } = await plant();
    const rows = [
      line(customerId, dieId, { poNumber: "PO-SMALL", pcs: 10 }),
      ...Array.from({ length: 150 }, (_, i) => line(customerId, dieId, { poNumber: "PO-77", pcs: 10, cutLength: 1000 + i })),
    ];
    const seeded = await seedCandidate(env, companyId, "orders", rows);
    const res = await mergeAll(await api(companyId, "admin"));
    expect(res.state).toBe("done_with_holds");
    const c = await candidateRow(env, seeded.candidateId);
    expect(c.state).toBe("held");
    expect(c.reasonDetail).toBe("PO PO-77 has 150 lines. An order takes 100 lines at most. Give the lines over 100 another PO number in the file, or skip some rows.");
    expect((await orderRows(companyId)).orders).toHaveLength(0);
    expect(new Set((await stagedRows(env, seeded.candidateId)).map((r) => r.mergeState))).toEqual(new Set(["open"]));
  });

  test("one PO on two order dates is held before any write; PO case and outer spaces do not split it", async () => {
    const { companyId, customerId, dieId } = await plant();
    const seeded = await seedCandidate(env, companyId, "orders", [
      line(customerId, dieId, { poNumber: "PO-5", orderDate: "2025-10-01", pcs: 1 }),
      line(customerId, dieId, { poNumber: " po-5", orderDate: "2025-10-02", pcs: 1 }),
    ]);
    expect((await mergeAll(await api(companyId, "admin"))).state).toBe("done_with_holds");
    const c = await candidateRow(env, seeded.candidateId);
    expect(c.state).toBe("held");
    expect(c.reasonDetail).toContain("PO PO-5 has more than one order date in the file");
    expect((await orderRows(companyId)).orders).toHaveLength(0);

    // The same PO in two spellings on one date is one order.
    const again = await plant();
    await seedCandidate(env, again.companyId, "orders", [
      line(again.customerId, again.dieId, { poNumber: "PO-6", pcs: 1 }),
      line(again.customerId, again.dieId, { poNumber: "po-6 ", pcs: 1, cutLength: 2000 }),
    ]);
    expect((await mergeAll(await api(again.companyId, "admin"))).state).toBe("done");
    const made = await orderRows(again.companyId);
    expect(made.orders).toHaveLength(1);
    expect(made.lines).toHaveLength(2);
  });

  test("12 interleaved orders with POs (sorted by section) become 12 whole orders", async () => {
    const { companyId, customerId, dieId } = await plant();
    // Row i belongs to order i % 12: every order spans the whole sheet.
    const rows = Array.from({ length: 36 }, (_, i) => line(customerId, dieId, { poNumber: `PO-${i % 12}`, pcs: 5, cutLength: 1000 + i }));
    const seeded = await seedCandidate(env, companyId, "orders", rows);
    const res = await mergeAll(await api(companyId, "admin"));
    expect(res.state).toBe("done");
    expect(res.chunksWritten).toBe(2);
    const { orders, lines } = await orderRows(companyId);
    expect(orders).toHaveLength(12);
    for (const o of orders) expect(lines.filter((l) => l.salesOrderId === o.id)).toHaveLength(3);
    const staged = await stagedRows(env, seeded.candidateId);
    expect(staged.every((r) => r.mergeState === "written")).toBe(true);
    // Rows of one PO point at one order.
    for (let p = 0; p < 12; p += 1) expect(new Set(staged.filter((_, i) => i % 12 === p).map((r) => r.committedId)).size).toBe(1);
  });

  test("a PO already on a live order holds the candidate before any of its orders is written", async () => {
    const { companyId, customerId, dieId } = await plant();
    const owner = await api(companyId, "owner");
    await owner.orders.create({ customerId, poNumber: "PO-LIVE", lines: [{ sectionId: dieId, cutLengthMm: 3658, kgG: 1000 }] });
    const seeded = await seedCandidate(env, companyId, "orders", [
      line(customerId, dieId, { poNumber: "PO-NEW", pcs: 1 }),
      line(customerId, dieId, { poNumber: "po-live", pcs: 1 }),
    ]);
    expect((await mergeAll(await api(companyId, "admin"))).state).toBe("done_with_holds");
    const c = await candidateRow(env, seeded.candidateId);
    expect(c.state).toBe("held");
    expect(c.reasonDetail).toMatch(/^PO po-live is already on .+ for this customer/);
    expect((await orderRows(companyId)).orders).toHaveLength(1);
  });
});


describe("replay keys come from the rows, not the chunk (B8)", () => {
  async function reopen(candidateId: string, rowIndexes: number[]) {
    const { ingestCandidate, ingestStagedRow } = await import("@orrn/db/schema/ingest");
    const { and, eq, inArray } = await import("drizzle-orm");
    // What a call that landed but looked failed leaves: the rows open, the candidate approved again.
    await env.db
      .update(ingestStagedRow)
      .set({ mergeState: "open", committedType: null, committedId: null })
      .where(and(eq(ingestStagedRow.candidateId, candidateId), inArray(ingestStagedRow.rowIndex, rowIndexes)));
    await env.db.update(ingestCandidate).set({ state: "approved" }).where(eq(ingestCandidate.id, candidateId));
  }

  test("an order that landed is not made again when a later run sends its rows in another chunk", async () => {
    const { companyId, customerId, dieId } = await plant();
    const admin = await api(companyId, "admin");
    const seeded = await seedCandidate(env, companyId, "orders", [
      line(customerId, dieId, { oldOrderNo: "E-1" }),
      line(customerId, dieId, { oldOrderNo: "E-2" }),
      line(customerId, dieId, { oldOrderNo: "E-3" }),
    ]);
    expect((await mergeAll(admin)).state).toBe("done");
    const before = (await stagedRows(env, seeded.candidateId)).map((r) => r.committedId);
    await reopen(seeded.candidateId, [2]);
    expect((await mergeAll(admin)).state).toBe("done");
    expect((await orderRows(companyId)).orders).toHaveLength(3);
    expect((await stagedRows(env, seeded.candidateId)).map((r) => r.committedId)).toEqual(before);
  });

  test("an error while confirming after the order was made records the rows as written; a rerun makes no second order", async () => {
    const { spyOn } = await import("bun:test");
    const flow = await import("../src/routers/orderFlow");
    const { companyId, customerId, dieId } = await plant();
    const admin = await api(companyId, "admin");
    const seeded = await seedCandidate(env, companyId, "orders", [line(customerId, dieId, { poNumber: "PO-CF", pcs: 10 })]);
    const spy = spyOn(flow, "confirmOrder").mockImplementation(async () => {
      throw new Error("D1_ERROR: network connection lost");
    });
    try {
      expect((await mergeAll(admin)).state).toBe("done");
    } finally {
      spy.mockRestore();
    }
    const [row] = await stagedRows(env, seeded.candidateId);
    expect(row!.mergeState).toBe("written");
    expect(row!.reasons).toContain("confirm_blocked:The order was saved as a booking but could not be confirmed. Confirm it on the order screen.");
    await reopen(seeded.candidateId, [0]);
    expect((await mergeAll(admin)).state).toBe("done");
    expect((await orderRows(companyId)).orders).toHaveLength(1);
    expect(await auditRows(env, companyId, "order.create")).toHaveLength(1);
  });
});

describe("an old section the person said to add (B10)", () => {
  test("an order line finds a section the same run created from a die sheet", async () => {
    const { companyId, customerId, dieId } = await plant();
    await seedCandidate(env, companyId, "dies", [{ values: { series: "R", sectionCode: "9100", weightMinG: 1000, weightMaxG: 1200 } }]);
    const seeded = await seedCandidate(env, companyId, "orders", [
      line(customerId, dieId, { oldOrderNo: "L-1" }),
      { values: { customer: "Party", orderDate: "2025-10-31", series: "R", sectionCode: "9100", cutLength: 3658, bakiKg: 100_000, oldOrderNo: "L-1", legacyDie: true, _ids: { customer: customerId } } },
    ]);
    expect((await mergeAll(await api(companyId, "admin"))).state).toBe("done");
    expect((await candidateRow(env, seeded.candidateId)).state).toBe("merged");
    const { die } = await import("@orrn/db/schema/catalog");
    const { and, eq } = await import("drizzle-orm");
    const [made] = await env.db.select().from(die).where(and(eq(die.companyId, companyId), eq(die.sectionCode, "9100")));
    const { lines } = await orderRows(companyId);
    expect(lines.map((l) => l.dieId).sort()).toEqual([dieId, made!.id].sort());
  });
});

describe("order rows the order screen would refuse (B11)", () => {
  test("a closed line (balance 0) is refused before any order of the chunk is written, naming its file row", async () => {
    const { companyId, customerId, dieId } = await plant();
    const seeded = await seedCandidate(env, companyId, "orders", [
      line(customerId, dieId, { oldOrderNo: "Z-1" }),
      line(customerId, dieId, { oldOrderNo: "Z-2", orderedKg: 1_000_000, dispatchedKg: 1_000_000, bakiKg: 0 }),
    ]);
    expect((await mergeAll(await api(companyId, "admin"))).state).toBe("done_with_holds");
    const c = await candidateRow(env, seeded.candidateId);
    expect(c.reasonDetail).toBe("File row 2: nothing is left to dispatch on this line (balance 0 kg). Skip the row.");
    expect((await orderRows(companyId)).orders).toHaveLength(0);
  });

  test("a closed line or a line with no cut length in a later chunk holds the candidate before any order is written", async () => {
    // 12 orders of 3 adjacent lines: chunk 1 takes orders 1 to 10, chunk 2 orders 11 and 12.
    const bad: Record<string, unknown>[] = [
      { orderedKg: 1_000_000, dispatchedKg: 1_000_000, bakiKg: 0 },
      { cutLength: null },
    ];
    const messages = [
      "File row 35: nothing is left to dispatch on this line (balance 0 kg). Skip the row.",
      "File row 35: no cut length. Give the cut length, or skip the row.",
    ];
    for (const [i, extra] of bad.entries()) {
      const { companyId, customerId, dieId } = await plant();
      const rows = Array.from({ length: 36 }, (_, r) => line(customerId, dieId, { oldOrderNo: `K-${Math.floor(r / 3)}`, ...(r === 34 ? extra : {}) }));
      const seeded = await seedCandidate(env, companyId, "orders", rows);
      expect((await mergeAll(await api(companyId, "admin"))).state).toBe("done_with_holds");
      const c = await candidateRow(env, seeded.candidateId);
      expect([c.state, c.reasonDetail]).toEqual(["held", messages[i]!]);
      expect((await orderRows(companyId)).orders).toHaveLength(0);
      expect(new Set((await stagedRows(env, seeded.candidateId)).map((r) => r.mergeState))).toEqual(new Set(["open"]));
    }
  });
});
