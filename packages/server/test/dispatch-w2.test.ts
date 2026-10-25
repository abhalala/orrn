/**
 * W2-OPPK-W (FP-PK-17): dispatch from a sales order. `dispatch.create({ salesOrderId })` fixes the
 * party, the dispatch keeps its order, `getDispatch` shows the order's live baki against what is
 * loaded, a scan prefers the order's own line, and `dispatch.suggestBundles` lists the order's
 * bundles first, then plant stock of the same die and length, leaving out whatever a scan would
 * refuse and whatever is held for another order's line.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, bundle, printLog } from "@orrn/db/schema";
import { and, count, eq, inArray } from "drizzle-orm";

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

  test("legacy stock on no order line is never suggested, even to the office; the dispatch must be an order's, still open", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]);
    await p.pack(s, [{ kg: 120 }]); // on no line, never moved: legacy / unassigned
    const { id } = await p.owner.dispatch.create({ salesOrderId: o.id });

    expect((await p.as("office").dispatch.suggestBundles({ id })).items).toEqual([]);
    expect((await p.as("packer").dispatch.suggestBundles({ id })).items).toEqual([]);

    const plain = await p.owner.dispatch.create({ customerId: p.customerId });
    await expect(p.owner.dispatch.suggestBundles({ id: plain.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.as("viewer").dispatch.suggestBundles({ id })).rejects.toMatchObject({ code: "FORBIDDEN" });
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

describe("Q36: the weight check at dispatch is the order line's kg/12ft, 0.1 either way; a warning, never a block", () => {
  test("add reports the bundles off their line; the draft marks them; nothing is refused", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 }); // the line's basis: 12.000 kg per 12 ft
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 100 }]);
    // 10 pcs of 12 ft: 120 kg is 11.999 (on the line), 120.9 kg is +0.1 at most, 125 kg is 12.498 (off), 110 kg is 10.999 (off, light).
    const [ok, edge, heavy, light] = [
      ...(await p.pack(s, [{ kg: 120 }], o.lineIds[0])),
      ...(await p.pack(s, [{ kg: 120.9 }], o.lineIds[0])),
      ...(await p.pack(s, [{ kg: 125 }], o.lineIds[0])),
      ...(await p.pack(s, [{ kg: 110 }], o.lineIds[0])),
    ] as [string, string, string, string];
    const { id } = await p.owner.dispatch.create({ salesOrderId: o.id });

    const rep = await p.owner.dispatch.scan({ id, serials: [ok, edge, heavy, light] });
    expect(rep.added.sort()).toEqual([ok, edge, heavy, light].sort());
    expect(rep.refused).toEqual([]);
    expect(rep.warnings!.map((w) => [w.serial, w.orderNumber, w.lineNo, w.lineMilli]).sort()).toEqual(
      [
        [heavy, o.number, 1, 12_000],
        [light, o.number, 1, 12_000],
      ].sort(),
    );
    const w = rep.warnings!.find((x) => x.serial === heavy)!;
    expect(w.bundleMilli).toBeGreaterThan(12_100);
    expect(w.diffMilli).toBe(w.bundleMilli - 12_000);
    expect(rep.warnings!.find((x) => x.serial === light)!.diffMilli).toBeLessThan(-100);

    // The scan alias says the same, and a repeat is calm (no second warning).
    const again = await p.owner.dispatch.scan({ id, serials: [heavy] });
    expect(again.warnings).toEqual([]);

    // The draft: each item against its line.
    const got = await p.owner.dispatch.getDispatch({ id });
    const by = new Map(got.items.map((i) => [i.serial, i]));
    expect([ok, edge, heavy, light].map((x) => by.get(x)!.offBand)).toEqual([false, false, true, true]);
    expect(by.get(heavy)).toMatchObject({ lineKgPer12ftMilli: 12_000 });
    expect(by.get(heavy)!.offBandDiffMilli).toBeGreaterThan(100);
    // It never blocks: the dispatch holds and completes.
    await p.owner.dispatch.reserve({ id });
    await expect(p.owner.dispatch.complete({ id })).resolves.toBeTruthy();
  }, SLOW);

  test("a bundle with no line has nothing to compare with; the die band is not used here", async () => {
    const p = await opPlant();
    const s = await p.section({ weightMinG: 11_800, weightMaxG: 12_600 });
    await p.copy(s, { milli: 12_000 });
    const [far] = await p.pack(s, [{ kg: 150 }]); // 15 kg/12ft: far off any band, on no line
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const rep = await p.owner.dispatch.addBundlesBySerial({ id, serials: [far!], allowUnassigned: true });
    expect(rep.added).toEqual([far!]);
    expect(rep.warnings).toEqual([]);
    expect((await p.owner.dispatch.getDispatch({ id })).items[0]).toMatchObject({ offBand: false, lineKgPer12ftMilli: null });
  }, SLOW);
});

describe("Q37: what one packing list may carry (company setting packingList.scope)", () => {
  const setScope = (p: OpPlant, scope: "one_so" | "one_customer" | "per_truck") => p.owner.company.updateSettings({ packingList: { scope } });

  test("one_customer (the default): one customer's lines from several of their orders on one packing list; no cast on it (Q39); no labels printed (Q38)", async () => {
    const p = await opPlant();
    expect((await p.owner.company.getSettings()).packingList.scope).toBe("one_customer");
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const a = await p.confirmedOrder([{ sectionId: s, pcs: 100 }]);
    const b = await p.confirmedOrder([{ sectionId: s, pcs: 100 }]);
    const [x] = await p.pack(s, [{ kg: 120 }], a.lineIds[0]);
    const [y] = await p.pack(s, [{ kg: 120 }], b.lineIds[0]);
    // A cast number on the bundles stays internal.
    await env.db.update(bundle).set({ castId: "cast-secret-K31" }).where(and(eq(bundle.companyId, p.companyId), inArray(bundle.serial, [x!, y!])));
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const rep = await p.owner.dispatch.addBundlesBySerial({ id, serials: [x!, y!] });
    expect(rep.added.sort()).toEqual([x!, y!].sort());
    expect(new Set(rep.linked.map((l) => l.orderNumber))).toEqual(new Set([a.number, b.number]));
    await p.owner.dispatch.reserve({ id });
    const before = (await env.db.select({ n: count() }).from(printLog).where(eq(printLog.companyId, p.companyId)))[0]!.n;
    await p.owner.dispatch.complete({ id });
    const pl = await p.owner.packingList.byDispatch({ dispatchId: id });
    const snapshot = JSON.stringify(pl!.snapshot);
    for (const n of [a.number, b.number]) expect(snapshot).toContain(n);
    expect(snapshot).not.toContain("cast-secret-K31");
    expect(snapshot.toLowerCase()).not.toContain('"cast');
    // Dispatch labels are an action on a completed dispatch, never printed by completing it.
    expect((await env.db.select({ n: count() }).from(printLog).where(eq(printLog.companyId, p.companyId)))[0]!.n).toBe(before);
    // Not a truck plant: a truck of several customers is refused.
    const other = await p.owner.dispatch.create({ customerId: p.otherCustomer });
    await expect(p.owner.dispatch.create({ customerId: p.customerId, truckOf: other.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("one_so: a dispatch starts from a sales order and carries that order only", async () => {
    const p = await opPlant();
    await setScope(p, "one_so");
    const s = await p.section();
    const t = await p.section();
    await p.copy(s, { milli: 12_000 });
    await p.copy(t, { milli: 12_000 });
    const a = await p.confirmedOrder([{ sectionId: s, pcs: 100 }]);
    const b = await p.confirmedOrder([{ sectionId: s, pcs: 100 }]);
    const [mine] = await p.pack(s, [{ kg: 120 }], a.lineIds[0]);
    const [theirs] = await p.pack(s, [{ kg: 120 }], b.lineIds[0]);
    const [otherDie] = await p.pack(t, [{ kg: 120 }]); // on no line, a die the order has no line for
    const [plain] = await p.pack(s, [{ kg: 120 }]); // on no line, a die the order does have a line for

    await expect(p.owner.dispatch.create({ customerId: p.customerId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("one sales order per packing list"),
    });
    const { id } = await p.owner.dispatch.create({ salesOrderId: a.id });
    const rep = await p.owner.dispatch.addBundlesBySerial({ id, serials: [mine!, theirs!, otherDie!, plain!], allowUnassigned: true });
    expect(rep.added.sort()).toEqual([mine!, plain!].sort());
    expect(rep.unavailable.map((r) => [r.serial, r.code]).sort()).toEqual(
      [
        [theirs!, "outside_order"],
        [otherDie!, "outside_order"],
      ].sort(),
    );
    expect(rep.unavailable[0]!.reason).toBe(`This packing list is for ${a.number} only`);
    expect(rep.unavailable.every((r) => r.orderNumber === a.number)).toBe(true);
    // The single-bundle path refuses the same way, with the same code.
    const one = await p.pack(s, [{ kg: 120 }], b.lineIds[0]);
    await expect(p.owner.dispatch.addBundle({ id, bundleId: (await idsOf(p, one))[0]! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Every bundle on it is on the order's own line.
    expect((await itemsOf(id)).map((i) => i.lineId)).toEqual([a.lineIds[0]!, a.lineIds[0]!]);
    // The suggestions follow the same rule.
    expect((await p.owner.dispatch.suggestBundles({ id })).items.every((i) => i.lineId === a.lineIds[0])).toBe(true);
  }, SLOW);

  test("per_truck: several customers on one truck, one packing list each, one vehicle", async () => {
    const p = await opPlant();
    await setScope(p, "per_truck");
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const a = await p.confirmedOrder([{ sectionId: s, pcs: 100 }]);
    const b = await p.confirmedOrder([{ sectionId: s, pcs: 100 }], { customerId: p.otherCustomer });
    const [x] = await p.pack(s, [{ kg: 120 }], a.lineIds[0]);
    const [y] = await p.pack(s, [{ kg: 120 }], b.lineIds[0]);

    const first = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.update({ id: first.id, vehicleNo: "gj 05 ab 1234", driverName: "Ramesh", driverPhone: "+91 98250 00000", transporter: "Shree Roadlines", vehicleCapacityG: kg(200) });
    // A second customer joins the truck: its own dispatch, the truck's vehicle.
    const second = await p.owner.dispatch.create({ customerId: p.otherCustomer, truckOf: first.id });
    const d2 = await p.owner.dispatch.getDispatch({ id: second.id });
    expect(d2.dispatch).toMatchObject({ customerId: p.otherCustomer, vehicleNo: "GJ05AB1234", driverName: "Ramesh", transporter: "Shree Roadlines", vehicleCapacityG: kg(200), truckId: first.id });
    expect((await p.owner.dispatch.getDispatch({ id: first.id })).dispatch.truckId).toBe(first.id);
    expect(d2.truck!.dispatches.map((d) => d.id)).toEqual([first.id, second.id]);
    // The same customer twice on one truck is refused; so is joining a truck that does not exist.
    await expect(p.owner.dispatch.create({ customerId: p.customerId, truckOf: first.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.owner.dispatch.create({ customerId: p.otherCustomer, truckOf: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // The driver changes once, for the truck.
    await p.owner.dispatch.update({ id: second.id, driverName: "Mahesh", vehicleNo: "GJ05CD9999" });
    for (const d of [first.id, second.id]) {
      expect((await p.owner.dispatch.getDispatch({ id: d })).dispatch).toMatchObject({ driverName: "Mahesh", vehicleNo: "GJ05CD9999" });
    }

    // Each customer's own bundles on its own list; the vehicle's capacity is the truck's: 120 + 120 > 200 kg.
    await p.owner.dispatch.addBundlesBySerial({ id: first.id, serials: [x!] });
    expect((await p.owner.dispatch.getDispatch({ id: first.id })).capacity).toMatchObject({ loadedG: kg(120), state: expect.any(String) });
    const rep = await p.owner.dispatch.scan({ id: second.id, serials: [y!] });
    expect(rep.capacity).toMatchObject({ loadedG: kg(240), state: "over" });
    expect((await p.owner.dispatch.getDispatch({ id: first.id })).capacity).toMatchObject({ loadedG: kg(240), state: "over" });
    // A bundle packed for the other customer stays refused on this one.
    expect((await p.owner.dispatch.scan({ id: first.id, serials: [y!] })).refused.map((r) => r.code)).toEqual(["wrong_customer"]);

    await p.owner.dispatch.reserve({ id: first.id });
    await p.owner.dispatch.reserve({ id: second.id });
    // Over the truck's capacity needs a reason on either list; with one, each completes with its own PL number.
    await expect(p.owner.dispatch.complete({ id: first.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await p.owner.dispatch.complete({ id: first.id, capacityOverrideReason: "Two small loads, one truck rated by the road" });
    await p.owner.dispatch.complete({ id: second.id, capacityOverrideReason: "Same truck" });
    const pl1 = await p.owner.packingList.byDispatch({ dispatchId: first.id });
    const pl2 = await p.owner.packingList.byDispatch({ dispatchId: second.id });
    expect(pl1!.code).not.toBe(pl2!.code);
    const head = (pl: typeof pl1) => (pl!.snapshot as { header: { vehicleNo: string; driverName: string; billTo: { name: string } } }).header;
    expect(head(pl1).vehicleNo).toBe(head(pl2).vehicleNo);
    expect(head(pl1).billTo.name).not.toBe(head(pl2).billTo.name);
    // A truck that has left takes no more customers.
    await expect(p.owner.dispatch.create({ customerId: p.customerId, truckOf: first.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("the setting is changed by settings.update only, and an unknown mode is refused", async () => {
    const p = await opPlant();
    await expect(p.as("office").company.updateSettings({ packingList: { scope: "per_truck" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.owner.company.updateSettings({ packingList: { scope: "all" as never } })).rejects.toBeTruthy();
    await p.owner.company.updateSettings({ packingList: { scope: "one_so" } });
    await p.owner.company.updateSettings({ packingList: { kgPerPiece: true } }); // the other switch keeps it
    expect((await p.owner.company.getSettings()).packingList).toEqual({ kgPerPiece: true, scope: "one_so" });
  }, SLOW);
});
