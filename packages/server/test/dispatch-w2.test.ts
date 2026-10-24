/**
 * W2-OPPK-W (FP-PK-17): dispatch from a sales order. `dispatch.create({ salesOrderId })` fixes the
 * party, the dispatch keeps its order, `getDispatch` shows the order's live baki against what is
 * loaded, a scan prefers the order's own line, and `dispatch.suggestBundles` lists the order's
 * bundles first, then plant stock of the same die and length, leaving out whatever a scan would
 * refuse and whatever is held for another order's line.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, bundle } from "@orrn/db/schema";
import { and, eq, inArray } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { FT12, FT18, opHelpers, setSectionOwner, type OpPlant } from "./orders-w1-fixture";
import { cancelOrder, closeOrder, kg, SLOW } from "./sales-fixture";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { opPlant, itemsOf } = opHelpers(() => env);

async function idsOf(p: OpPlant, serials: string[]) {
  const rows = await env.db
    .select({ id: bundle.id, serial: bundle.serial })
    .from(bundle)
    .where(and(eq(bundle.companyId, p.companyId), inArray(bundle.serial, serials)));
  const by = new Map(rows.map((r) => [r.serial, r.id]));
  return serials.map((s) => by.get(s)!);
}

/** Pack for a line, then move the bundles to plant stock (no line, latest transfer to none). */
async function plantStock(p: OpPlant, sectionId: string, rows: { kg: number; mm?: number }[], fromLine: string) {
  const serials = await p.pack(sectionId, rows, fromLine);
  await p.owner.orders.reallocate({ bundleIds: await idsOf(p, serials), toLineId: null, reason: "Order short closed" });
  return serials;
}

describe("dispatch.create from a sales order", () => {
  test("the order's party becomes the dispatch's; a different customer, a closed order or none at all is refused", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }], { customerId: p.otherCustomer });

    const made = await p.as("office").dispatch.create({ salesOrderId: o.id });
    const got = await p.owner.dispatch.getDispatch({ id: made.id });
    expect(got.dispatch).toMatchObject({ customerId: p.otherCustomer, salesOrderId: o.id, status: "draft" });
    expect(got.customer?.id).toBe(p.otherCustomer);
    expect(got.salesOrder).toMatchObject({ id: o.id, number: o.number, status: "confirmed" });
    const [audit] = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "dispatch.create"), eq(auditLog.subjectId, made.id)));
    expect(audit!.meta).toMatchObject({ salesOrderId: o.id, orderNumber: o.number, customerId: p.otherCustomer });

    // The same party named is fine; another party is not.
    await expect(p.owner.dispatch.create({ salesOrderId: o.id, customerId: p.otherCustomer })).resolves.toMatchObject({ success: true });
    await expect(p.owner.dispatch.create({ salesOrderId: o.id, customerId: p.customerId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.owner.dispatch.create({})).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Customer is required" });
    await expect(p.owner.dispatch.create({ salesOrderId: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // A closed or cancelled order has nothing left to send; a booking can still be opened from.
    const closed = await p.confirmedOrder([{ sectionId: s, kgG: kg(100) }]);
    await closeOrder(p.owner, closed.id);
    await expect(p.owner.dispatch.create({ salesOrderId: closed.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const gone = await p.confirmedOrder([{ sectionId: s, kgG: kg(100) }]);
    await cancelOrder(p.owner, gone.id);
    await expect(p.owner.dispatch.create({ salesOrderId: gone.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Another plant's order is not found.
    const q = await opPlant();
    const qs = await q.section();
    await q.copy(qs, { milli: 12_000 });
    const foreign = await q.confirmedOrder([{ sectionId: qs, kgG: kg(100) }]);
    await expect(p.owner.dispatch.create({ salesOrderId: foreign.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Who may: dispatch.create holders only; the customer cannot be moved afterwards.
    await expect(p.as("viewer").dispatch.create({ salesOrderId: o.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.owner.dispatch.update({ id: made.id, customerId: p.customerId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("opened from a sales order"),
    });
    // The list names the order.
    const listed = (await p.owner.dispatch.listDispatches({ customerId: p.otherCustomer })).items.find((i) => i.id === made.id);
    expect(listed).toMatchObject({ salesOrderId: o.id, salesOrderNumber: o.number });
    // An ordinary dispatch has none.
    const plain = await p.owner.dispatch.create({ customerId: p.customerId });
    expect((await p.owner.dispatch.getDispatch({ id: plain.id })).salesOrder).toBeNull();
  }, SLOW);

  test("getDispatch shows the order's live baki; it falls as bundles go on and stays after completion", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([
      { sectionId: s, kgG: kg(1_000) },
      { sectionId: s, kgG: kg(300), mm: FT18 },
    ]);
    const serials = await p.pack(s, [{ kg: 120 }, { kg: 120 }, { kg: 120 }], o.lineIds[0]);
    const { id } = await p.owner.dispatch.create({ salesOrderId: o.id });

    const before = (await p.owner.dispatch.getDispatch({ id })).salesOrder!.progress;
    expect(before).toMatchObject({ orderedG: kg(1_300), bakiG: kg(1_300), onDispatchG: 0, leftG: kg(1_300), overG: 0 });
    expect(before.lines.map((l) => [l.lineNo, l.bakiG, l.onDispatchG, l.leftG])).toEqual([
      [1, kg(1_000), 0, kg(1_000)],
      [2, kg(300), 0, kg(300)],
    ]);

    const rep = await p.owner.dispatch.addBundlesBySerial({ id, serials: serials.slice(0, 2) });
    expect(rep.linked.map((l) => l.orderNumber)).toEqual([o.number, o.number]);
    const mid = (await p.owner.dispatch.getDispatch({ id })).salesOrder!.progress;
    expect(mid).toMatchObject({ bakiG: kg(1_300), onDispatchG: kg(240), onDispatchPcs: 20, leftG: kg(1_060) });
    expect(mid.lines[0]).toMatchObject({ onDispatchG: kg(240), leftG: kg(760) });

    await p.owner.dispatch.reserve({ id });
    await p.owner.dispatch.complete({ id });
    // Completed: baki is the order's own (240 kg gone), and nothing counts twice as "on dispatch".
    const done = (await p.owner.dispatch.getDispatch({ id })).salesOrder!.progress;
    expect(done).toMatchObject({ bakiG: kg(1_060), onDispatchG: 0, leftG: kg(1_060) });
    const next = await p.owner.dispatch.create({ salesOrderId: o.id });
    expect((await p.owner.dispatch.getDispatch({ id: next.id })).salesOrder!.progress).toMatchObject({ bakiG: kg(1_060), leftG: kg(1_060) });
  }, SLOW);

  test("a bundle on no line goes to the order's own line first, not the oldest order's", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const older = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]);
    const newer = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]);
    const [plain] = await p.pack(s, [{ kg: 120 }]);
    const [viaOrder] = await p.pack(s, [{ kg: 120 }]);

    // Control: an ordinary dispatch takes the oldest open line (the existing rule).
    const ordinary = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ id: ordinary.id, serials: [plain!], allowUnassigned: true });
    expect((await itemsOf(ordinary.id))[0]!.lineId).toBe(older.lineIds[0]!);

    // From the newer order: that order's line, whatever the age.
    const fromOrder = await p.owner.dispatch.create({ salesOrderId: newer.id });
    const rep = await p.owner.dispatch.addBundlesBySerial({ id: fromOrder.id, serials: [viaOrder!], allowUnassigned: true });
    expect(rep.linked).toEqual([expect.objectContaining({ serial: viaOrder, orderNumber: newer.number })]);
    expect((await itemsOf(fromOrder.id))[0]!.lineId).toBe(newer.lineIds[0]!);
  }, SLOW);
});

describe("dispatch.suggestBundles", () => {
  test("the order's own bundles first, then plant stock of the same die and length; what a scan refuses is left out", async () => {
    const p = await opPlant();
    const s = await p.section();
    const s2 = await p.section();
    await p.copy(s, { milli: 12_000 });
    await p.copy(s2, { milli: 12_000 });

    const sibling = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]); // same party, another order
    const foreign = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }], { customerId: p.otherCustomer });
    const o = await p.confirmedOrder([
      { sectionId: s, kgG: kg(300) }, // line 1: baki 300 kg at 12 ft
      { sectionId: s2, kgG: kg(500) }, // line 2: on a die that will become owned
    ]);

    const own = await p.pack(s, [{ kg: 120 }, { kg: 120 }, { kg: 120 }], o.lineIds[0]); // 360 kg for a 300 kg line
    const plant = await plantStock(p, s, [{ kg: 100 }, { kg: 100 }], sibling.lineIds[0]!); // plant stock, 12 ft
    const plantLong = await plantStock(p, s, [{ kg: 100, mm: FT18 }], sibling.lineIds[0]!); // plant stock, wrong length
    const forSibling = await p.pack(s, [{ kg: 110 }], sibling.lineIds[0]); // the party's other order
    const forForeign = await p.pack(s, [{ kg: 110 }], foreign.lineIds[0]); // another customer's order
    const heldElsewhere = await p.pack(s, [{ kg: 105 }]); // plant-ish, held for the sibling order's line
    await p.owner.orders.hold({ lineId: sibling.lineIds[0]!, bundleIds: await idsOf(p, heldElsewhere) });
    const ownedDie = await p.pack(s2, [{ kg: 90 }], o.lineIds[1]); // fine until the die becomes someone else's
    const onOther = await p.pack(s, [{ kg: 95 }], o.lineIds[0]);
    const other = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ id: other.id, serials: onOther });
    await p.owner.dispatch.reserve({ id: other.id }); // reserved on another dispatch
    await setSectionOwner(env, s2, p.otherCustomer);

    const { id } = await p.owner.dispatch.create({ salesOrderId: o.id });
    const res = await p.owner.dispatch.suggestBundles({ id });

    const serials = res.items.map((i) => i.serial);
    expect(serials).toEqual([...own, ...plant]); // order's own (oldest first), then plant stock; nothing else
    expect(res.items.map((i) => i.group)).toEqual(["order", "order", "order", "plant", "plant"]);
    for (const left of [plantLong, forSibling, forForeign, heldElsewhere, ownedDie, onOther]) {
      for (const sr of left) expect(serials).not.toContain(sr);
    }
    // Greedy against line 1's 300 kg baki: 120 + 120 fit, the third (360) does not, plant stock neither.
    expect(res.items.map((i) => i.fits)).toEqual([true, true, false, false, false]);
    expect(res.counts).toEqual({ order: 3, plant: 2, fits: 2 });
    expect(res.fitsG).toBe(kg(240));
    expect(res.items.every((i) => i.lineNo === 1)).toBe(true);
    expect(res.progress).toMatchObject({ orderedG: kg(800), bakiG: kg(800), onDispatchG: 0 });

    // What is already on this dispatch is not offered again, and the room left shrinks.
    await p.owner.dispatch.addBundlesBySerial({ id, serials: [own[0]!] });
    const again = await p.owner.dispatch.suggestBundles({ id });
    expect(again.items.map((i) => i.serial)).toEqual([own[1]!, own[2]!, ...plant]);
    expect(again.items.map((i) => i.fits)).toEqual([true, false, false, false]);
    expect(again.progress.lines[0]).toMatchObject({ onDispatchG: kg(120), leftG: kg(180) });

    // Add all that fit, with one call: the same serials a person would tap.
    const fit = again.items.filter((i) => i.fits).map((i) => i.serial);
    const added = await p.owner.dispatch.addBundlesBySerial({ id, serials: fit });
    expect(added.added).toEqual(fit);
    expect((await p.owner.dispatch.getDispatch({ id })).salesOrder!.progress.lines[0]).toMatchObject({ onDispatchG: kg(240), leftG: kg(60) });
  }, SLOW);

  test("unassigned stock is offered to the office only; the pick must be a dispatch of an order", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]);
    const legacy = await p.pack(s, [{ kg: 120 }]); // on no line, never moved: legacy / unassigned
    const { id } = await p.owner.dispatch.create({ salesOrderId: o.id });

    const office = await p.as("office").dispatch.suggestBundles({ id });
    expect(office.items.map((i) => [i.serial, i.group, i.unassigned])).toEqual([[legacy[0]!, "plant", true]]);
    // A packer scans; unassigned stock is not theirs to add, so it is not offered.
    const packer = await p.as("packer").dispatch.suggestBundles({ id });
    expect(packer.items).toEqual([]);

    const plain = await p.owner.dispatch.create({ customerId: p.customerId });
    await expect(p.owner.dispatch.suggestBundles({ id: plain.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.as("viewer").dispatch.suggestBundles({ id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.owner.dispatch.reserve({ id }).catch(() => undefined);
    await p.owner.dispatch.cancel({ id });
    await expect(p.owner.dispatch.suggestBundles({ id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("bundles held for the order's own line are offered; held ones count as the order's stock", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]);
    const other = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]);
    const yard = await plantStock(p, s, [{ kg: 100 }], other.lineIds[0]!);
    const held = await plantStock(p, s, [{ kg: 100 }], other.lineIds[0]!);
    await p.owner.orders.hold({ lineId: o.lineIds[0]!, bundleIds: await idsOf(p, held) });
    const { id } = await p.owner.dispatch.create({ salesOrderId: o.id });
    const res = await p.owner.dispatch.suggestBundles({ id });
    // Held for this line = the order's own, listed first; the free plant bundle follows.
    expect(res.items.map((i) => [i.serial, i.group, i.held])).toEqual([
      [held[0]!, "order", true],
      [yard[0]!, "plant", false],
    ]);
    expect(FT12).toBe(3_658);
  }, SLOW);
});
