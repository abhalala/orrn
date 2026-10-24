/**
 * W1-OP-S: order lines, weight basis and the order's life (FP-OP-01/02/03/04; specs §E2).
 * Every worked example of §E2 "Arithmetic" is pinned here through the server (quote + create),
 * on an inch company (FourCubes types ft + in, so 18 ft is exactly 18 ft).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { approval, auditLog, customer, pressPlan, salesOrder, salesOrderLine } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { FT12, FT18, opHelpers } from "./orders-w1-fixture";
import { kg, saveOrder, SLOW } from "./sales-fixture";

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

const { opPlant } = opHelpers(() => env);

async function audits(companyId: string, action: string) {
  return env.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, action)));
}

describe("worked examples (§E2 Arithmetic) through orders.quote and orders.create", () => {
  test("30 pcs x 18 ft at 12.000 = 540.000 kg; the same pieces at 12.300 = 553.500 kg", async () => {
    const p = await opPlant();
    const s = await p.section();
    const c = await p.copy(s, { milli: 12_000 });
    const q = await p.owner.orders.quote({ sectionId: s, dieInstanceId: c, cutLengthMm: FT18, qtyBasis: "pcs", pcs: 30 });
    expect(q).toMatchObject({ weightBasis: "copy_current", basisMilli: 12_000, copyMilli: 12_000, kgG: 540_000, pcs: 30, impliedG: 540_000 });
    await p.reading(c, 12_300, new Date());
    const q2 = await p.owner.orders.quote({ sectionId: s, dieInstanceId: c, cutLengthMm: FT18, qtyBasis: "pcs", pcs: 30 });
    expect(q2).toMatchObject({ basisMilli: 12_300, kgG: 553_500 });

    const o = await p.owner.orders.create({
      customerId: p.customerId,
      poNumber: "PO-540",
      lines: [{ sectionId: s, cutLengthMm: FT18, qtyBasis: "pcs", pcs: 30, dieInstanceId: c }],
    });
    const [line] = await env.db.select().from(salesOrderLine).where(eq(salesOrderLine.salesOrderId, o.id));
    expect(line).toMatchObject({
      qtyBasis: "pcs",
      pcs: 30,
      kgG: 553_500,
      impliedG: 553_500,
      kgPer12ftMilli: 12_300,
      weightBasis: "copy_current",
      copyMilli: 12_300,
      bandStartMilli: 11_800,
      basisNote: null,
      dieInstanceId: c,
    });
    expect(line!.readingId).toBeTruthy();
  }, SLOW);

  test("200 pcs x 12 ft at 1.650 = 330.000 kg; at 1.672 = 334.400 kg", async () => {
    const p = await opPlant();
    const s = await p.section({ weightMinG: 1_600, weightMaxG: 1_700 });
    const a = await p.copy(s, { milli: 1_650 });
    const b = await p.copy(s, { milli: 1_672 });
    const qa = await p.owner.orders.quote({ sectionId: s, dieInstanceId: a, cutLengthMm: FT12, qtyBasis: "pcs", pcs: 200 });
    const qb = await p.owner.orders.quote({ sectionId: s, dieInstanceId: b, cutLengthMm: FT12, qtyBasis: "pcs", pcs: 200 });
    expect(qa.kgG).toBe(330_000);
    expect(qb.kgG).toBe(334_400);
  }, SLOW);

  test("8,000 kg at 12.000, 12 ft -> 667 pcs, implied 8,004 kg (the clerk committed kg)", async () => {
    const p = await opPlant();
    const s = await p.section();
    const c = await p.copy(s, { milli: 12_000 });
    const q = await p.owner.orders.quote({ sectionId: s, dieInstanceId: c, cutLengthMm: FT12, qtyBasis: "kg", kgG: kg(8_000) });
    expect(q).toMatchObject({ qtyBasis: "kg", pcs: 667, kgG: kg(8_000), impliedG: kg(8_004) });
    const o = await p.owner.orders.create({
      customerId: p.customerId,
      lines: [{ sectionId: s, cutLengthMm: FT12, qtyBasis: "kg", kgG: kg(8_000), dieInstanceId: c }],
    });
    const got = await p.owner.orders.get({ id: o.id });
    expect(got.lines[0]).toMatchObject({ orderedG: kg(8_000), orderedPcs: 667 });
    expect(got.lineDetails[0]).toMatchObject({ qtyBasis: "kg", impliedG: kg(8_004) });
  }, SLOW);

  test("basis: no reading falls back to band start with a note; band_start on request; the suggested copy otherwise", async () => {
    const p = await opPlant();
    const s = await p.section({ weightMinG: 11_800 });
    const bare = await p.copy(s);
    const q = await p.owner.orders.quote({ sectionId: s, dieInstanceId: bare, cutLengthMm: FT18, qtyBasis: "pcs", pcs: 30 });
    expect(q).toMatchObject({ weightBasis: "band_start", basisMilli: 11_800, kgG: 531_000 });
    expect(q.basisNote).toContain("band start");
    // An unpinned line uses the copy the die room would pick first (one with a reading).
    const read = await p.copy(s, { milli: 12_000 });
    const q2 = await p.owner.orders.quote({ sectionId: s, cutLengthMm: FT18, qtyBasis: "pcs", pcs: 30 });
    expect(q2).toMatchObject({ weightBasis: "copy_current", copyId: read, kgG: 540_000 });
    const q3 = await p.owner.orders.quote({ sectionId: s, cutLengthMm: FT18, qtyBasis: "pcs", pcs: 30, weightBasis: "band_start" });
    expect(q3).toMatchObject({ weightBasis: "band_start", basisMilli: 11_800, basisNote: null });
  }, SLOW);

  test("alloy / temper default from the die, else the plant default; a copy of another section is refused", async () => {
    const p = await opPlant({ settings: { defaultAlloy: "6063", defaultTemper: "T6" } });
    const s = await p.section({ alloy: "6061", temper: "T5" });
    const plain = await p.section();
    const other = await p.copy(plain, { milli: 12_000 });
    const o = await p.owner.orders.create({
      customerId: p.customerId,
      lines: [
        { sectionId: s, cutLengthMm: FT12, kgG: kg(100) },
        { sectionId: plain, cutLengthMm: FT12, kgG: kg(100), alloy: "6082" },
      ],
    });
    const lines = await env.db.select().from(salesOrderLine).where(eq(salesOrderLine.salesOrderId, o.id));
    const byNo = new Map(lines.map((l) => [l.lineNo, l]));
    expect(byNo.get(1)).toMatchObject({ alloy: "6061", temper: "T5" });
    expect(byNo.get(2)).toMatchObject({ alloy: "6082", temper: "T6" });
    await expect(
      p.owner.orders.create({ customerId: p.customerId, lines: [{ sectionId: s, cutLengthMm: FT12, kgG: kg(1), dieInstanceId: other }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("rates: refused while priceOnSalesOrder is off, and for a role without order.price; shown only to order.price", async () => {
    const off = await opPlant();
    const s = await off.section();
    await expect(
      off.owner.orders.create({ customerId: off.customerId, lines: [{ sectionId: s, cutLengthMm: FT12, kgG: kg(1), ratePaise: 25_000 }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const on = await opPlant({ settings: { priceOnSalesOrder: true } });
    const s2 = await on.section();
    const o = await on.as("office").orders.create({
      customerId: on.customerId,
      lines: [{ sectionId: s2, cutLengthMm: FT12, kgG: kg(1), ratePaise: 25_000 }],
    });
    expect((await on.as("office").orders.get({ id: o.id })).lineDetails[0]).toMatchObject({ ratePaise: 25_000 });
    expect((await on.as("packer").orders.get({ id: o.id })).lineDetails[0]).not.toHaveProperty("ratePaise");
  }, SLOW);
});

describe("FP-OP-01: confirm blockers, PO uniqueness and the order's states", () => {
  test("confirm lists what is missing: PO, pcs, alloy, temper, copy or tier", async () => {
    const p = await opPlant({ settings: { defaultAlloy: "", defaultTemper: "" } });
    const s = await p.section({ alloy: null, temper: null });
    const o = await p.owner.orders.create({ customerId: p.customerId, lines: [{ sectionId: s, cutLengthMm: FT12, kgG: kg(10) }] });
    const got = await p.owner.orders.get({ id: o.id });
    expect(got.confirmBlockers).toEqual(expect.arrayContaining(["po_number", "line_1_pcs", "line_1_die_or_tier"]));
    await expect(p.owner.orders.confirm({ id: o.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await p.owner.orders.get({ id: o.id })).order.status).toBe("booking");
  }, SLOW);

  test("a complete booking confirms (audit order.confirm); confirming again is refused", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 30, mm: FT18 }]);
    const got = await p.owner.orders.get({ id: o.id });
    expect(got.order).toMatchObject({ status: "confirmed" });
    expect(got.order.confirmedAt).toBeTruthy();
    expect(got.confirmBlockers).toEqual([]);
    expect((await audits(p.companyId, "order.confirm")).map((a) => a.subjectId)).toEqual([o.id]);
    await expect(p.owner.orders.confirm({ id: o.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("confirm needs order.manage; a pinned owned copy of another customer is FORBIDDEN naming the owner", async () => {
    const p = await opPlant();
    const s = await p.section();
    const owned = await p.copy(s, { milli: 12_000, ownerCustomerId: p.otherCustomer });
    const o = await p.owner.orders.create({
      customerId: p.customerId,
      poNumber: "PO-OWN",
      lines: [{ sectionId: s, cutLengthMm: FT12, qtyBasis: "pcs", pcs: 10, dieInstanceId: owned }],
    });
    await expect(p.as("packer").orders.confirm({ id: o.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.owner.orders.confirm({ id: o.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("This die belongs to"),
    });
  }, SLOW);

  test("PO is unique per customer among live orders; another customer may reuse it; cancelling frees it", async () => {
    const p = await opPlant();
    const s = await p.section();
    const first = await p.owner.orders.create({ customerId: p.customerId, poNumber: "PO-77", lines: [{ sectionId: s, cutLengthMm: FT12, kgG: kg(5) }] });
    await expect(
      p.owner.orders.create({ customerId: p.customerId, poNumber: "po-77", lines: [{ sectionId: s, cutLengthMm: FT12, kgG: kg(5) }] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await p.owner.orders.create({ customerId: p.otherCustomer, poNumber: "PO-77", lines: [{ sectionId: s, cutLengthMm: FT12, kgG: kg(5) }] });
    const second = await p.owner.orders.create({ customerId: p.customerId, poNumber: "PO-78", lines: [{ sectionId: s, cutLengthMm: FT12, kgG: kg(5) }] });
    await expect(saveOrder(p.owner, { id: second.id, poNumber: "PO-77" })).rejects.toMatchObject({ code: "CONFLICT" });
    await p.owner.orders.cancel({ id: first.id, reason: "Entered twice" });
    await saveOrder(p.owner, { id: second.id, poNumber: "PO-77" });
    expect((await p.owner.orders.get({ id: second.id })).order.poNumber).toBe("PO-77");
  }, SLOW);

  test("write time: a second order with the same PO saved between read and write fails whole", async () => {
    const p = await opPlant();
    const s = await p.section();
    env.beforeNextBatch(() =>
      env.db.insert(salesOrder).values({
        id: crypto.randomUUID(),
        companyId: p.companyId,
        period: "2026-27",
        number: "SO-RACE",
        customerId: p.customerId,
        poNumber: "PO-RACE",
        orderDate: "2026-10-01",
      }),
    );
    await expect(
      p.owner.orders.create({ customerId: p.customerId, poNumber: "PO-RACE", lines: [{ sectionId: s, cutLengthMm: FT12, kgG: kg(5) }] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const rows = await env.db.select().from(salesOrder).where(and(eq(salesOrder.companyId, p.companyId), eq(salesOrder.poNumber, "PO-RACE")));
    expect(rows.map((r) => r.number)).toEqual(["SO-RACE"]);
  }, SLOW);

  test("close: a reason is required while baki is left; booking can't close; closed can't close again", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const booking = await p.owner.orders.create({ customerId: p.customerId, lines: [{ sectionId: s, cutLengthMm: FT12, kgG: kg(5) }] });
    await expect(p.owner.orders.close({ id: booking.id, reason: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    await expect(p.owner.orders.close({ id: o.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("baki") });
    const res = await p.owner.orders.close({ id: o.id, reason: "Customer took the rest from stock" });
    expect(res).toMatchObject({ status: "closed" });
    const got = await p.owner.orders.get({ id: o.id });
    expect(got.order).toMatchObject({ status: "closed", closeReason: "Customer took the rest from stock" });
    await expect(p.owner.orders.close({ id: o.id, reason: "again" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await audits(p.companyId, "order.close")).toHaveLength(1);
  }, SLOW);

  test("cancel: refused once bundles are packed for it or it is on a press plan; needs a reason; audited", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const packed = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    await p.pack(s, [{ kg: 50 }], packed.lineIds[0]);
    await expect(p.owner.orders.cancel({ id: packed.id, reason: "No" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const planned = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    const start = Date.now();
    await p.owner.plans.create({
      windowStart: start,
      windowEnd: start + 8 * 3_600_000,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: planned.lineIds[0]!, pcs: 5 }] }],
    });
    await expect(p.owner.orders.cancel({ id: planned.id, reason: "No" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const free = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    await expect(p.owner.orders.cancel({ id: free.id, reason: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.owner.orders.cancel({ id: free.id, reason: "Customer withdrew the PO" });
    expect((await p.owner.orders.get({ id: free.id })).order).toMatchObject({ status: "cancelled", cancelReason: "Customer withdrew the PO" });
    await expect(p.owner.orders.cancel({ id: free.id, reason: "again" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await audits(p.companyId, "order.cancel")).map((a) => a.subjectId)).toEqual([free.id]);
  }, SLOW);

  test("dispatching -> closed; a cancelled order can't be confirmed or closed", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    const serials = await p.pack(s, [{ kg: 30 }], o.lineIds[0]);
    const d = await p.held(serials);
    await p.owner.dispatch.complete({ id: d });
    expect((await p.owner.orders.get({ id: o.id })).order.status).toBe("dispatching");
    await expect(p.owner.orders.cancel({ id: o.id, reason: "late" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.owner.orders.close({ id: o.id, reason: "Short closed" });
    const c = await p.owner.orders.create({ customerId: p.customerId, lines: [{ sectionId: s, cutLengthMm: FT12, kgG: kg(1) }] });
    await p.owner.orders.cancel({ id: c.id, reason: "test" });
    await expect(p.owner.orders.confirm({ id: c.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.owner.orders.close({ id: c.id, reason: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);
});

describe("FP-OP-04: orders.repriceWeight", () => {
  test("a pieces line takes the new reading's kg; audited as order.weight.refresh", async () => {
    const p = await opPlant();
    const s = await p.section();
    const c = await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 30, mm: FT18, dieInstanceId: c }]);
    await p.reading(c, 12_300, new Date());
    const res = await p.owner.orders.repriceWeight({ lineId: o.lineIds[0]! });
    expect(res).toMatchObject({ kgG: 553_500, pcs: 30, kgPer12ftMilli: 12_300 });
    const [a] = await audits(p.companyId, "order.weight.refresh");
    expect(a!.meta).toMatchObject({ orderId: o.id, from: { kgG: 540_000 }, to: { kgG: 553_500 } });
  }, SLOW);

  test("refused on a released plan line, and when more is dispatched than the new kg", async () => {
    const p = await opPlant();
    const s = await p.section();
    const c = await p.copy(s, { milli: 12_000 });
    const planned = await p.confirmedOrder([{ sectionId: s, pcs: 30, mm: FT18, dieInstanceId: c }]);
    const start = Date.now();
    const plan = await p.owner.plans.create({
      windowStart: start,
      windowEnd: start + 3_600_000,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: planned.lineIds[0]!, pcs: 10 }] }],
    });
    // Draft plan: still allowed.
    await p.owner.orders.repriceWeight({ lineId: planned.lineIds[0]!, weightBasis: "band_start" });
    await p.owner.plans.release({ id: plan.id });
    await expect(p.owner.orders.repriceWeight({ lineId: planned.lineIds[0]! })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("released press plan"),
    });
    expect((await env.db.select().from(pressPlan).where(eq(pressPlan.id, plan.id)))[0]!.status).toBe("released");

    // 10 pcs x 12 ft at 12.000 = 120 kg ordered; 150 kg dispatched; band start 11.800 would make it 118 kg.
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 10, dieInstanceId: c }]);
    const serials = await p.pack(s, [{ kg: 150 }], o.lineIds[0]);
    const d = await p.held(serials);
    await p.owner.dispatch.complete({ id: d }).catch(async () => {
      const [req] = await p.owner.approval.list({ status: "pending" }).then((r) => r.items.filter((i) => i.kind === "dispatch_overdraw"));
      await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
      await p.owner.dispatch.complete({ id: d });
    });
    await expect(p.owner.orders.repriceWeight({ lineId: o.lineIds[0]!, weightBasis: "band_start" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("already dispatched"),
    });
  }, SLOW);

  test("needs order.manage; a stale editor of the order gets CONFLICT after a reprice", async () => {
    const p = await opPlant();
    const s = await p.section();
    const c = await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 30, dieInstanceId: c }]);
    const before = (await p.owner.orders.get({ id: o.id })).order.serverSeq;
    await expect(p.as("supervisor").orders.repriceWeight({ lineId: o.lineIds[0]! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.owner.orders.repriceWeight({ lineId: o.lineIds[0]!, weightBasis: "band_start" });
    await expect(p.owner.orders.update({ id: o.id, serverSeq: before, note: "late edit" })).rejects.toMatchObject({ code: "CONFLICT" });
  }, SLOW);
});

describe("over-dispatch beyond the customer's kg tolerance (OP §6, Q-OP-12)", () => {
  test("tolerance 0: one kg past the order needs a dispatch_overdraw approval; approved, it completes", async () => {
    const p = await opPlant();
    await env.db.update(customer).set({ kgToleranceBp: 0 }).where(eq(customer.id, p.customerId));
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]); // 120 kg
    const d = await p.held(await p.pack(s, [{ kg: 121 }], o.lineIds[0]));
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [req] = await env.db
      .select()
      .from(approval)
      .where(and(eq(approval.companyId, p.companyId), eq(approval.kind, "dispatch_overdraw"), eq(approval.status, "pending")));
    expect(req).toBeTruthy();
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    await p.owner.dispatch.complete({ id: d });
    expect((await p.owner.orders.balance({ orderId: o.id })).lines[0]!.strip).toMatchObject({ dispatchedG: kg(121), bakiG: 0 });
  }, SLOW);
});

describe("orders.update keeps W1 line fields it was not sent", () => {
  test("a PL-8 style edit keeps the pin and basis; a section change drops the old section's pin", async () => {
    const p = await opPlant();
    const s = await p.section();
    const c = await p.copy(s, { milli: 12_000 });
    const s2 = await p.section();
    const o = await p.owner.orders.create({
      customerId: p.customerId,
      lines: [{ sectionId: s, cutLengthMm: FT12, qtyBasis: "pcs", pcs: 10, dieInstanceId: c }],
    });
    const lineId = (await p.owner.orders.get({ id: o.id })).lines[0]!.lineId;
    await saveOrder(p.owner, { id: o.id, note: "x", lines: [{ id: lineId, sectionId: s, cutLengthMm: FT12, kgG: kg(130), pcs: 10 }] });
    const [kept] = await env.db.select().from(salesOrderLine).where(eq(salesOrderLine.id, lineId));
    expect(kept).toMatchObject({ dieInstanceId: c, qtyBasis: "pcs", weightBasis: "copy_current", kgG: kg(130) });
    await saveOrder(p.owner, { id: o.id, lines: [{ id: lineId, sectionId: s2, cutLengthMm: FT12, kgG: kg(130) }] });
    const [moved] = await env.db.select().from(salesOrderLine).where(eq(salesOrderLine.id, lineId));
    expect(moved).toMatchObject({ dieId: s2, dieInstanceId: null });
  }, SLOW);
});
