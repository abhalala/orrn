/**
 * W1-OP-S: reallocation and plant stock (FP-OP-07/08/09; ledger D6; C8, C46, C47).
 * `orders.reallocate` is the only transfer: same customer / plant stock applies now; another
 * customer's bundles wait on an `order_reallocate` approval; same die only; a different cut
 * length needs a `reallocate` reason code; `bundle_transfer` is append-only; the stock ledger is
 * never touched.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { approval, auditLog, bundle, bundleTransfer, stockLedger } from "@orrn/db/schema";
import { and, asc, count, eq, inArray } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { FT12, FT18, opHelpers, type OpPlant } from "./orders-w1-fixture";
import { kg, SLOW } from "./sales-fixture";

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

async function bundlesBySerial(p: OpPlant, serials: string[]) {
  const rows = await env.db
    .select()
    .from(bundle)
    .where(and(eq(bundle.companyId, p.companyId), inArray(bundle.serial, serials)))
    .orderBy(asc(bundle.serial));
  return rows;
}

async function ledgerCount(companyId: string) {
  const [r] = await env.db.select({ n: count() }).from(stockLedger).where(eq(stockLedger.companyId, companyId));
  return r?.n ?? 0;
}

async function transfersOf(companyId: string) {
  return env.db.select().from(bundleTransfer).where(eq(bundleTransfer.companyId, companyId)).orderBy(asc(bundleTransfer.createdAt));
}

/** A plant with one section + copy, and two confirmed orders of the same customer on it. */
async function twoOrders(p: OpPlant, opts: { secondCustomer?: string; secondMm?: number } = {}) {
  const s = await p.section();
  await p.copy(s, { milli: 12_000 });
  const a = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }], { poNumber: `PO-A-${crypto.randomUUID().slice(0, 4)}` });
  const b = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000), mm: opts.secondMm }], {
    customerId: opts.secondCustomer,
    poNumber: `PO-B-${crypto.randomUUID().slice(0, 4)}`,
  });
  return { s, a, b };
}

describe("FP-OP-05/07: the scripted balance (ordered 8 t, packed 6.7 t, dispatched 1.3 t)", () => {
  test("baki 6.7 t, all of it in stock and reallocatable; moved bundles keep the original order and PO", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, kgG: kg(8_000) }], { poNumber: "PO-8T" });
    const line = o.lineIds[0]!;
    const sent = await p.pack(s, [{ kg: 650 }, { kg: 650 }], line);
    const kept = await p.pack(s, [{ kg: 1_340 }, { kg: 1_340 }, { kg: 1_340 }, { kg: 1_340 }, { kg: 1_340 }], line);
    const d = await p.held(sent);
    await p.owner.dispatch.complete({ id: d });

    const bal = await p.owner.orders.balance({ orderId: o.id });
    expect(bal.lines[0]!.strip).toEqual({
      orderedG: kg(8_000),
      orderedPcs: 667,
      producedG: kg(8_000),
      dispatchedG: kg(1_300),
      bakiG: kg(6_700),
      bakiPcs: 667 - 20,
      plannedG: 0,
      pressedG: 0,
      agedG: 0,
      packedG: kg(6_700),
      inStockG: kg(6_700),
      inStockBundles: 5,
      inStockPcs: expect.any(Number),
      heldG: 0,
      heldPcs: 0,
      overG: 0,
      planableG: 0,
    });

    // Reallocatable: two of the kept bundles go to another order of the same customer at once.
    const other = await p.confirmedOrder([{ sectionId: s, kgG: kg(3_000) }], { poNumber: "PO-NEXT" });
    const moving = (await bundlesBySerial(p, kept.slice(0, 2))).map((b) => b.id);
    const res = await p.owner.orders.reallocate({ bundleIds: moving, toLineId: other.lineIds[0]!, reason: "Urgent for the next PO" });
    expect(res).toMatchObject({ status: "applied", moved: 2, kgG: kg(2_680), warnings: [] });

    const after = await p.owner.orders.balance({ orderId: o.id });
    // Baki is ordered − dispatched: moving stock away never changes it.
    expect(after.lines[0]!.strip).toMatchObject({ bakiG: kg(6_700), packedG: kg(4_020), planableG: kg(2_680) });
    const target = await p.owner.orders.balance({ orderId: other.id });
    expect(target.lines[0]!.strip).toMatchObject({ packedG: kg(2_680), bakiG: kg(3_000) });

    // The original order and PO travel with the bundle (what the packing list prints, FP-OP-07).
    const onTarget = await p.owner.orders.lineBundles({ lineId: other.lineIds[0]! });
    expect(onTarget.items.map((i) => [i.orderNumber, i.packedOrderNumber, i.packedPoNumber, i.movedAway])).toEqual([
      [other.number, o.number, "PO-8T", false],
      [other.number, o.number, "PO-8T", false],
    ]);
    const onSource = await p.owner.orders.lineBundles({ lineId: line });
    expect(onSource.items.filter((i) => i.movedAway)).toHaveLength(2);
    const moved = await bundlesBySerial(p, kept.slice(0, 2));
    expect<unknown>(moved.map((b) => [b.salesOrderLineId, b.packedSalesOrderLineId])).toEqual([
      [other.lineIds[0], line],
      [other.lineIds[0], line],
    ]);
  }, SLOW);
});

describe("FP-OP-08: orders.reallocate", () => {
  test("same customer: applied now, append-only transfer rows, no ledger rows, audited with both orders", async () => {
    const p = await opPlant();
    const { s, a, b } = await twoOrders(p);
    const serials = await p.pack(s, [{ kg: 100 }, { kg: 120 }], a.lineIds[0]);
    const ids = (await bundlesBySerial(p, serials)).map((x) => x.id);
    const ledgerBefore = await ledgerCount(p.companyId);
    const res = await p.as("supervisor").orders.reallocate({ bundleIds: ids, toLineId: b.lineIds[0]!, reasonCode: "customer_request" });
    expect(res.status).toBe("applied");
    expect(await ledgerCount(p.companyId)).toBe(ledgerBefore);
    const rows = await transfersOf(p.companyId);
    expect<unknown>(rows.map((r) => [r.fromSalesOrderLineId, r.toSalesOrderLineId, r.reasonCode, r.reason, r.lengthMismatch, r.approvalId])).toEqual([
      [a.lineIds[0], b.lineIds[0], "customer_request", "Customer asked", false, null],
      [a.lineIds[0], b.lineIds[0], "customer_request", "Customer asked", false, null],
    ]);
    const [audit] = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "order.reallocate")));
    expect(audit!.meta).toMatchObject({ status: "applied", bundles: 2, kgG: kg(220) });
    expect((audit!.meta as { orderIds: string[] }).orderIds.sort()).toEqual([a.id, b.id].sort());
    // Both order timelines show it.
    for (const id of [a.id, b.id]) {
      const t = await p.owner.orders.timeline({ id });
      expect(t.events.map((e) => e.action)).toEqual(expect.arrayContaining(["order.create", "order.confirm", "order.reallocate"]));
    }
  }, SLOW);

  test("another customer: pending order_reallocate; nothing moves; a second ask is CONFLICT; approval moves them", async () => {
    const p = await opPlant();
    const { s, a, b } = await twoOrders(p, { secondCustomer: p.otherCustomer });
    const serials = await p.pack(s, [{ kg: 100 }, { kg: 120 }], a.lineIds[0]);
    const ids = (await bundlesBySerial(p, serials)).map((x) => x.id);
    const res = await p.as("office").orders.reallocate({ bundleIds: ids, toLineId: b.lineIds[0]!, reason: "Party B is short" });
    expect(res).toMatchObject({ status: "pending", moved: 0 });
    expect<unknown>((await bundlesBySerial(p, serials)).map((x) => x.salesOrderLineId)).toEqual([a.lineIds[0], a.lineIds[0]]);
    expect(await transfersOf(p.companyId)).toHaveLength(0);
    const [req] = await env.db.select().from(approval).where(eq(approval.id, res.approvalId!));
    expect(req).toMatchObject({ kind: "order_reallocate", subjectId: res.batchId, status: "pending" });
    expect(req!.meta).toMatchObject({ bundleIds: ids, fromLineIds: [a.lineIds[0]], toLineId: b.lineIds[0], kgG: kg(220) });
    expect(JSON.stringify(req!.meta)).not.toMatch(/rate|paise/i);

    await expect(p.owner.orders.reallocate({ bundleIds: [ids[0]!], toLineId: null, reason: "x" })).rejects.toMatchObject({ code: "CONFLICT" });
    // The requester cannot approve their own request.
    await expect(p.as("office").approval.decide({ id: req!.id, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    expect<unknown>((await bundlesBySerial(p, serials)).map((x) => [x.salesOrderLineId, x.packedSalesOrderLineId])).toEqual([
      [b.lineIds[0], a.lineIds[0]],
      [b.lineIds[0], a.lineIds[0]],
    ]);
    const rows = await transfersOf(p.companyId);
    expect<unknown>(rows.map((r) => [r.fromSalesOrderLineId, r.toSalesOrderLineId, r.approvalId, r.batchId])).toEqual([
      [a.lineIds[0], b.lineIds[0], req!.id, res.batchId],
      [a.lineIds[0], b.lineIds[0], req!.id, res.batchId],
    ]);
    const events = (await p.owner.orders.timeline({ id: b.id })).events.filter((e) => e.action === "order.reallocate");
    expect(events.map((e) => (e.meta as { status: string }).status)).toEqual(["pending", "applied"]);
  }, SLOW);

  test("another customer, rejected: nothing moves; a pending bundle can't be dispatched; one voided while pending is skipped on approval", async () => {
    const p = await opPlant();
    const { s, a, b } = await twoOrders(p, { secondCustomer: p.otherCustomer });
    const serials = await p.pack(s, [{ kg: 100 }, { kg: 120 }], a.lineIds[0]);
    const ids = (await bundlesBySerial(p, serials)).map((x) => x.id);
    const first = await p.owner.orders.reallocate({ bundleIds: ids, toLineId: b.lineIds[0]!, reason: "x" });
    await p.as("manager").approval.decide({ id: first.approvalId!, decision: "rejected" });
    expect<unknown>((await bundlesBySerial(p, serials)).map((x) => x.salesOrderLineId)).toEqual([a.lineIds[0], a.lineIds[0]]);
    expect(await transfersOf(p.companyId)).toHaveLength(0);

    const second = await p.owner.orders.reallocate({ bundleIds: ids, toLineId: b.lineIds[0]!, reason: "again" });
    // Review round 1 m-4: a bundle in a pending request can't go on a dispatch.
    const { id: d } = await p.owner.dispatch.create({ customerId: p.customerId });
    const report = await p.owner.dispatch.addBundlesBySerial({ id: d, serials: [serials[0]!] });
    expect(report.added).toEqual([]);
    expect(report.unavailable.map((u) => u.code)).toEqual(["reallocation_pending"]);
    // A bundle that stops being available while pending (here voided) is skipped when it is approved.
    await env.db.update(bundle).set({ status: "void" }).where(eq(bundle.id, ids[0]!));
    await p.as("manager").approval.decide({ id: second.approvalId!, decision: "approved" });
    const after = await bundlesBySerial(p, serials);
    expect<unknown>(after.map((x) => [x.status, x.salesOrderLineId])).toEqual([
      ["void", a.lineIds[0]],
      ["available", b.lineIds[0]],
    ]);
    expect(await transfersOf(p.companyId)).toHaveLength(1);
  }, SLOW);

  test("owned die: moving the owner's bundles to another customer is FORBIDDEN naming the owner", async () => {
    const p = await opPlant();
    const s = await p.section();
    const owned = await p.copy(s, { milli: 12_000, ownerCustomerId: p.customerId });
    const mine = await p.confirmedOrder([{ sectionId: s, kgG: kg(500), dieInstanceId: owned }]);
    const theirs = await p.confirmedOrder([{ sectionId: s, kgG: kg(500), dieInstanceId: null, tierRank: 1 }], { customerId: p.otherCustomer });
    const serials = await p.pack(s, [{ kg: 100 }], mine.lineIds[0], owned);
    await env.db.update(bundle).set({ dieInstanceId: owned }).where(and(eq(bundle.companyId, p.companyId), inArray(bundle.serial, serials)));
    const ids = (await bundlesBySerial(p, serials)).map((x) => x.id);
    const [cust] = await env.db.query.customer.findMany({ where: (c, { eq: e }) => e(c.id, p.customerId) });
    await expect(p.owner.orders.reallocate({ bundleIds: ids, toLineId: theirs.lineIds[0]!, reason: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: `This die belongs to ${cust!.name}`,
    });
    expect(await env.db.select().from(approval).where(eq(approval.companyId, p.companyId))).toHaveLength(0);
    // To plant stock is allowed (the gate runs again when it is allocated).
    await expect(p.owner.orders.reallocate({ bundleIds: ids, toLineId: null, reason: "Order closed" })).resolves.toMatchObject({ status: "applied" });
  }, SLOW);

  test("cut length differs: refused without a reason code; with one it moves and warns", async () => {
    const p = await opPlant();
    const { s, a, b } = await twoOrders(p, { secondMm: FT18 });
    const serials = await p.pack(s, [{ kg: 100, mm: FT12 }], a.lineIds[0]);
    const ids = (await bundlesBySerial(p, serials)).map((x) => x.id);
    await expect(p.owner.orders.reallocate({ bundleIds: ids, toLineId: b.lineIds[0]!, reason: "close enough" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("cut length differs"),
    });
    await expect(
      p.owner.orders.reallocate({ bundleIds: ids, toLineId: b.lineIds[0]!, reasonCode: "other" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const res = await p.owner.orders.reallocate({ bundleIds: ids, toLineId: b.lineIds[0]!, reasonCode: "length_mismatch" });
    expect(res.status).toBe("applied");
    expect<unknown>(res.warnings).toEqual([{ bundleId: ids[0], serial: serials[0], kind: "length_mismatch", bundleLengthMm: FT12, lineLengthMm: FT18 }]);
    const [row] = await transfersOf(p.companyId);
    expect(row).toMatchObject({ lengthMismatch: true, reasonCode: "length_mismatch", reason: "Different cut length" });
  }, SLOW);

  test("refusals: another die, a held bundle, a void bundle, the same line, a closed target, too many, no permission", async () => {
    const p = await opPlant();
    const { s, a, b } = await twoOrders(p);
    const other = await p.section();
    await p.copy(other, { milli: 12_000 });
    const o2 = await p.confirmedOrder([{ sectionId: other, kgG: kg(100) }]);
    const serials = await p.pack(s, [{ kg: 10 }, { kg: 11 }, { kg: 12 }], a.lineIds[0]);
    const [x, y, z] = (await bundlesBySerial(p, serials)).map((r) => r.id);
    await expect(p.owner.orders.reallocate({ bundleIds: [x!], toLineId: o2.lineIds[0]!, reason: "r" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("different die"),
    });
    await p.held([serials[1]!]);
    await expect(p.owner.orders.reallocate({ bundleIds: [y!], toLineId: b.lineIds[0]!, reason: "r" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("held on dispatch"),
    });
    await env.db.update(bundle).set({ status: "void" }).where(eq(bundle.id, z!));
    await expect(p.owner.orders.reallocate({ bundleIds: [z!], toLineId: b.lineIds[0]!, reason: "r" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("void"),
    });
    await expect(p.owner.orders.reallocate({ bundleIds: [x!], toLineId: a.lineIds[0]!, reason: "r" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await p.owner.orders.close({ id: b.id, reason: "done" });
    await expect(p.owner.orders.reallocate({ bundleIds: [x!], toLineId: b.lineIds[0]!, reason: "r" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      p.owner.orders.reallocate({ bundleIds: Array.from({ length: 101 }, () => crypto.randomUUID()), toLineId: null, reason: "r" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.as("packer").orders.reallocate({ bundleIds: [x!], toLineId: null, reason: "r" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(p.owner.orders.reallocate({ bundleIds: [x!], toLineId: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await transfersOf(p.companyId)).toHaveLength(0);
  }, SLOW);

  test("write time: a bundle scanned onto a dispatch between read and write fails the whole move", async () => {
    const p = await opPlant();
    const { s, a, b } = await twoOrders(p);
    const serials = await p.pack(s, [{ kg: 10 }, { kg: 11 }], a.lineIds[0]);
    const ids = (await bundlesBySerial(p, serials)).map((r) => r.id);
    env.beforeNextBatch(() => env.db.update(bundle).set({ status: "reserved" }).where(eq(bundle.id, ids[1]!)));
    await expect(p.owner.orders.reallocate({ bundleIds: ids, toLineId: b.lineIds[0]!, reason: "r" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect<unknown>((await bundlesBySerial(p, serials)).map((r) => r.salesOrderLineId)).toEqual([a.lineIds[0], a.lineIds[0]]);
    expect(await transfersOf(p.companyId)).toHaveLength(0);
  }, SLOW);
});

describe("FP-OP-09/10: plant stock and the ready-stock prompt", () => {
  test("plant stock = no line and latest transfer to none; unassigned legacy only on request; plant stock keeps its customer", async () => {
    const p = await opPlant();
    const { s, a, b } = await twoOrders(p, { secondCustomer: p.otherCustomer });
    const onA = await p.pack(s, [{ kg: 40 }], a.lineIds[0]);
    const loose = await p.pack(s, [{ kg: 30 }]);
    const [aId] = (await bundlesBySerial(p, onA)).map((r) => r.id);
    await p.owner.orders.reallocate({ bundleIds: [aId!], toLineId: null, reason: "Order short closed" });
    const plant = await p.owner.orders.plantStock({ sectionId: s });
    expect<unknown>(plant.items.map((i) => [i.serial, i.allocation])).toEqual([[onA[0], "plant"]]);
    expect(plant).toMatchObject({ total: 1, totalG: kg(40) });
    const all = await p.owner.orders.plantStock({ sectionId: s, includeUnassigned: true });
    expect<unknown>(all.items.map((i) => [i.serial, i.allocation])).toEqual([
      [onA[0], "plant"],
      [loose[0], "unassigned"],
    ]);
    await expect(p.owner.orders.reallocate({ bundleIds: [aId!], toLineId: null, reason: "again" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    // Review round 1 m-3: plant stock that came from customer A still needs an approval to go to
    // another customer (two applied moves must not skip order_reallocate) …
    const res = await p.owner.orders.reallocate({ bundleIds: [aId!], toLineId: b.lineIds[0]!, reason: "Ready stock" });
    expect(res.status).toBe("pending");
    expect((await p.owner.orders.plantStock({ sectionId: s })).items).toHaveLength(1);
    // … while unassigned legacy stock (no customer behind it) goes to any line at once.
    const [looseId] = (await bundlesBySerial(p, loose)).map((r) => r.id);
    expect((await p.owner.orders.reallocate({ bundleIds: [looseId!], toLineId: b.lineIds[0]!, reason: "Ready stock" })).status).toBe("applied");
  }, SLOW);

  test("matchStock: plant, unassigned, own leftovers, own open lines, then other customers; exact length first; oldest first", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const t0 = new Date("2026-10-01T06:30:00.000Z");
    const at = (min: number) => setClock(new Date(t0.getTime() + min * 60_000));
    const own = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]);
    const leftover = await p.confirmedOrder([{ sectionId: s, kgG: kg(10) }]);
    const theirs = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }], { customerId: p.otherCustomer });

    at(1);
    const otherCust = await p.pack(s, [{ kg: 5 }], theirs.lineIds[0]);
    at(2);
    const ownOpenLong = await p.pack(s, [{ kg: 6, mm: FT18 }], own.lineIds[0]);
    at(3);
    const ownOpen = await p.pack(s, [{ kg: 7 }], own.lineIds[0]);
    at(4);
    const left = await p.pack(s, [{ kg: 20 }], leftover.lineIds[0]);
    at(5);
    const unassigned = await p.pack(s, [{ kg: 8 }]);
    at(6);
    const plantLong = await p.pack(s, [{ kg: 9, mm: FT18 }], own.lineIds[0]);
    at(7);
    const plant = await p.pack(s, [{ kg: 10 }], own.lineIds[0]);
    at(8);
    await p.owner.orders.close({ id: leftover.id, reason: "Short closed" });
    const toPlant = (await bundlesBySerial(p, [...plantLong, ...plant])).map((r) => r.id);
    await p.owner.orders.reallocate({ bundleIds: toPlant, toLineId: null, reasonCode: "customer_request" });

    const m = await p.owner.orders.matchStock({ sectionId: s, cutLengthMm: FT12, customerId: p.customerId });
    expect<unknown>(m.items.map((i) => [i.serial, i.allocation, i.lengthMatch, i.needsApproval])).toEqual([
      [plant[0], "plant", true, false],
      [plantLong[0], "plant", false, false],
      [unassigned[0], "unassigned", true, false],
      [left[0], "same_customer", true, false],
      [ownOpen[0], "same_customer", true, false],
      [ownOpenLong[0], "same_customer", false, false],
      [otherCust[0], "other_customer", true, true],
    ]);
    expect(m).toMatchObject({ readyBundles: 6, readyG: kg(10 + 9 + 8 + 20 + 7 + 6) });
    // A bundle in a pending reallocation is not offered.
    const [o1] = (await bundlesBySerial(p, otherCust)).map((r) => r.id);
    await p.owner.orders.reallocate({ bundleIds: [o1!], toLineId: own.lineIds[0]!, reason: "x" });
    const m2 = await p.owner.orders.matchStock({ sectionId: s, cutLengthMm: FT12, customerId: p.customerId });
    expect(m2.items.map((i) => i.serial)).not.toContain(otherCust[0]);
  }, SLOW);
});
