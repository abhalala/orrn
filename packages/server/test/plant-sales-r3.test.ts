/**
 * PL-8 review round 3 (reports/review-PL8.md at e06b758): I-1 (a floor unlink of an item that was
 * never linked must not mark it "unlinked on purpose"), m-2 (create replay with another payload),
 * m-3 (relink audit lists only links that landed), m-4 (Complete's CONFLICT names the new order),
 * m-5 (ship date on the company clock), m-6 (orders.update needs serverSeq) and the Range /12' band
 * from the raw kg/12ft. Uses test/sales-fixture.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, dispatchItem, salesOrder } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { kg, NOON, salesHelpers, saveOrder, SLOW, closeOrder, reopenOrder } from "./sales-fixture";

let env: TestEnv;
let setClock: (at: Date | null) => void;
let buildPlSnapshotV2: typeof import("../src/lib/packingListSnapshot").buildPlSnapshotV2;

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
  buildPlSnapshotV2 = (await import("../src/lib/packingListSnapshot")).buildPlSnapshotV2;
}, 60_000);
afterEach(() => setClock(null));
afterAll(async () => {
  await env.dispose();
});

const { plant, itemsOf, plRow, pendingOverdraw, dispatchRow } = salesHelpers(() => env);

/** @orrn/documents is a client package (it imports this one): load it by path, outside this package's type check. */
const DOCS_PATH = "../../documents/src/packing-list/index";
type Docs = {
  plShipDateText(shipDate: string | null | undefined, shipYmd?: string | null): string | null;
  buildPackingListHtml(pl: never, code: string): string;
};
const docs = async () => (await import(DOCS_PATH)) as Docs;

const refused = (e: { code?: string }) => `refused:${e.code}`;

async function markOf(itemId: string) {
  const [row] = await env.db
    .select({ line: dispatchItem.salesOrderLineId, by: dispatchItem.unlinkedBy })
    .from(dispatchItem)
    .where(eq(dispatchItem.id, itemId));
  return row!;
}

async function relinkAudits(companyId: string, dispatchId: string) {
  return env.db
    .select({ meta: auditLog.meta })
    .from(auditLog)
    .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "dispatch.relink"), eq(auditLog.subjectId, dispatchId)));
}

describe("I-1 only a deliberate unlink of a linked item marks it", () => {
  test("a packer unlinks a never-linked bundle, the order is entered afterwards: completion links it, needs the override, and baki drops", async () => {
    setClock(NOON);
    const p = await plant();
    const serials = await p.pack(p.dieA, [{ kg: 500 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    const [item] = await itemsOf(id);
    expect(item!.lineId).toBeNull();
    // No open line for the section: the floor may "unlink" it, but it was never linked, so no mark.
    await p.as("packer").dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null });
    expect(await markOf(item!.id)).toEqual({ line: null, by: null });
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]); // entered AFTER the floor's unlink
    await p.owner.dispatch.reserve({ id });
    const sup = p.as("supervisor");
    expect(await sup.dispatch.complete({ id }).then(() => "completed", refused)).toBe("refused:PRECONDITION_FAILED");
    expect((await itemsOf(id)).map((i) => i.lineId)).toEqual([o.lineIds[0]!]);
    const [req] = await pendingOverdraw(p.companyId, id);
    expect(req).toBeDefined();
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    await sup.dispatch.complete({ id });
    expect(await p.lineOf(o.lineIds[0]!)).toMatchObject({ dispatchedG: kg(500), bakiG: 0, overG: kg(400) });
  }, SLOW);

  test("write time: an order saved just before the completing write still covers the floor-unlinked bundle (CONFLICT naming the order)", async () => {
    setClock(NOON);
    const p = await plant();
    const serials = await p.pack(p.dieA, [{ kg: 500 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    const [item] = await itemsOf(id);
    await p.as("operator").dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null });
    await p.owner.dispatch.reserve({ id });
    env.beforeNextBatch(() => p.order([{ dieId: p.dieA, kg: 100 }]));
    const err = await p.owner.dispatch.complete({ id }).then(
      () => null,
      (e: { code?: string; message?: string }) => e,
    );
    expect(err?.code).toBe("CONFLICT");
    // m-4: the message says what happened (an order for this customer), not "bundles changed".
    expect(err?.message).toMatch(/order for this customer/i);
    expect(err?.message).not.toMatch(/Bundles on this dispatch changed/);
    expect((await dispatchRow(id)).status).toBe("reserved");
    expect(await p.owner.dispatch.complete({ id }).then(() => "completed", refused)).toBe("refused:PRECONDITION_FAILED");
  }, SLOW);

  test("a floor unlink of a linked bundle whose order closed leaves no mark: the reopened order takes it back at completion", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials: await p.pack(p.dieA, [{ kg: 100 }]) });
    const [item] = await itemsOf(id);
    expect(item!.lineId).toBe(o.lineIds[0]!);
    await closeOrder(p.owner, o.id);
    await p.as("packer").dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null });
    expect(await markOf(item!.id)).toEqual({ line: null, by: null });
    await reopenOrder(env, o.id);
    await p.owner.dispatch.reserve({ id });
    await p.as("supervisor").dispatch.complete({ id });
    expect(await p.lineOf(o.lineIds[0]!)).toMatchObject({ dispatchedG: kg(100), bakiG: kg(900) });
  }, SLOW);

  test("the office's unlink of a linked bundle is on purpose; its unlink of a never-linked bundle is not", async () => {
    setClock(NOON);
    const p = await plant();
    const serials = await p.pack(p.dieA, [{ kg: 100 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    const [loose] = await itemsOf(id);
    const office = p.as("office");
    await office.dispatch.linkItem({ itemId: loose!.id, salesOrderLineId: null });
    expect(await markOf(loose!.id)).toEqual({ line: null, by: null });
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    await office.dispatch.linkItem({ itemId: loose!.id, salesOrderLineId: o.lineIds[0]! });
    await office.dispatch.linkItem({ itemId: loose!.id, salesOrderLineId: null });
    expect(await markOf(loose!.id)).toEqual({ line: null, by: p.users.office.id });
    // A repeat unlink keeps the mark (the item stays unlinked on purpose).
    await office.dispatch.linkItem({ itemId: loose!.id, salesOrderLineId: null });
    expect(await markOf(loose!.id)).toEqual({ line: null, by: p.users.office.id });
  }, SLOW);
});

describe("m-2 orders.create replay key", () => {
  test("the same key with the same order replays; with another customer, section or weight it is a CONFLICT", async () => {
    setClock(NOON);
    const p = await plant();
    const body = {
      customerId: p.customerId,
      poNumber: "PO-9",
      lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(100) }],
      clientRequestId: "so-req-1",
    };
    const first = await p.owner.orders.create(body);
    expect(first.replayed).toBe(false);
    expect(await p.owner.orders.create(body)).toEqual({ id: first.id, number: first.number, replayed: true });
    for (const other of [
      { ...body, customerId: p.otherCustomer },
      { ...body, lines: [{ ...body.lines[0]!, kgG: kg(200) }] },
      { ...body, lines: [{ ...body.lines[0]!, sectionId: p.dieB }] },
      { ...body, lines: [...body.lines, { sectionId: p.dieB, cutLengthMm: 3_658, kgG: kg(5) }] },
      { ...body, poNumber: "PO-10" },
    ]) {
      expect(await p.owner.orders.create(other).then(() => "created", refused)).toBe("refused:CONFLICT");
    }
    const orders = await env.db.select({ id: salesOrder.id }).from(salesOrder).where(eq(salesOrder.companyId, p.companyId));
    expect(orders.map((o) => o.id)).toEqual([first.id]);
    // An edit after the first save does not turn the client's own retry into a CONFLICT.
    await saveOrder(p.owner, { id: first.id, note: "edited" });
    expect(await p.owner.orders.create(body)).toEqual({ id: first.id, number: first.number, replayed: true });
  }, SLOW);
});

describe("m-3 the relink audit lists only links that landed", () => {
  test("completion: a suggestion dropped at write time (order closed meanwhile) is not in the audit", async () => {
    setClock(NOON);
    const p = await plant();
    const serials = await p.pack(p.dieA, [{ kg: 100 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    await p.owner.dispatch.reserve({ id });
    env.beforeNextBatch(() => closeOrder(p.owner, o.id));
    await p.owner.dispatch.complete({ id });
    expect((await itemsOf(id)).map((i) => i.lineId)).toEqual([null]);
    const audits = await relinkAudits(p.companyId, id);
    expect(audits.flatMap((a) => (a.meta as { links?: unknown[] }).links ?? [])).toEqual([]);
  }, SLOW);

  test("completion: a link that lands is in the audit", async () => {
    setClock(NOON);
    const p = await plant();
    const serials = await p.pack(p.dieA, [{ kg: 100 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    await p.owner.dispatch.reserve({ id });
    await p.owner.dispatch.complete({ id });
    const audits = await relinkAudits(p.companyId, id);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.meta).toMatchObject({ reason: "complete", links: [{ serial: serials[0], salesOrderLineId: o.lineIds[0] }] });
  }, SLOW);

  test("customer change: a suggestion dropped at write time is not in the audit; a landed one is", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 100 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.otherCustomer });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true, id, serials });
    env.beforeNextBatch(() => closeOrder(p.owner, o.id));
    await p.owner.dispatch.update({ id, customerId: p.customerId });
    expect((await itemsOf(id)).map((i) => i.lineId)).toEqual([null]);
    const dropped = await relinkAudits(p.companyId, id);
    expect(dropped.flatMap((a) => (a.meta as { links?: unknown[] }).links ?? [])).toEqual([]);
    const updates = await env.db
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "dispatch.update"), eq(auditLog.subjectId, id)));
    expect(updates.some((u) => "relinked" in (u.meta as object))).toBe(false);
    // Reopened: changing the customer back and forth relinks, and the audit names the landed link.
    await reopenOrder(env, o.id);
    await p.owner.dispatch.update({ id, customerId: p.otherCustomer });
    await p.owner.dispatch.update({ id, customerId: p.customerId });
    expect((await itemsOf(id)).map((i) => i.lineId)).toEqual([o.lineIds[0]!]);
    const landed = await relinkAudits(p.companyId, id);
    expect(landed.map((a) => a.meta)).toEqual([
      expect.objectContaining({ reason: "customer", links: [expect.objectContaining({ serial: serials[0], salesOrderLineId: o.lineIds[0] })] }),
    ]);
  }, SLOW);
});

describe("m-5 ship date on the company clock", () => {
  const snapFor = (timezone: string | null, shipDate: Date) =>
    buildPlSnapshotV2({
      plNumber: "PL/2026-27/1", date: "2026-10-05", generatedAt: new Date(), generatedBy: "u",
      company: { id: "c", name: "FC", settings: timezone ? { timezone } : null },
      dispatch: { code: "D1", status: "completed", shipDate, notes: null, completedAt: new Date(), vehicleNo: null, driverName: null, driverPhone: null, transporter: null, invoiceNumber: null, invoiceDate: null },
      customer: null,
      items: [],
    });

  test("the PL carries the ship date as the company's calendar day and prints it without the reader's timezone", async () => {
    const { plShipDateText } = await docs();
    // 20:00 UTC on 4 Oct is 01:30 IST on 5 Oct.
    const at = new Date("2026-10-04T20:00:00.000Z");
    const ist = snapFor(null, at);
    expect(ist.header.shipDate).toBe("2026-10-05");
    expect(plShipDateText(ist.dispatch.shipDate, ist.header.shipDate)).toBe("05 Oct 2026");
    const ny = snapFor("America/New_York", at);
    expect(ny.header.shipDate).toBe("2026-10-04");
    expect(plShipDateText(ny.dispatch.shipDate, ny.header.shipDate)).toBe("04 Oct 2026");
    // A v2 snapshot stored before the field existed falls back to the plant's clock (IST).
    expect(plShipDateText("2026-10-04T20:00:00.000Z")).toBe("05 Oct 2026");
    expect(plShipDateText(null)).toBeNull();
    // BACKLOG 80: with no ship date entered, a completed load carries the day it left (the list and the detail say the same).
    expect(snapFor(null, null as never).header.shipDate).toBe(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  });

  test("the completed PL prints the ship date of the company's day", async () => {
    setClock(NOON);
    const p = await plant();
    const { id: d } = await p.owner.dispatch.create({ customerId: p.customerId, shipDate: Date.parse("2026-10-04T20:00:00.000Z") });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id: d, serials: await p.pack(p.dieA, [{ kg: 10 }]) });
    await p.owner.dispatch.reserve({ id: d });
    await p.owner.dispatch.complete({ id: d });
    const pl = (await plRow(d))!;
    expect((pl.snapshot as { header: { shipDate: string | null } }).header.shipDate).toBe("2026-10-05");
    const { buildPackingListHtml } = await docs();
    expect(buildPackingListHtml(pl.snapshot as never, pl.code)).toContain("Ship date 05 Oct 2026");
  }, SLOW);
});

describe("m-6 orders.update needs the version the editor read", () => {
  test("no serverSeq is refused; a stale one is a CONFLICT; the current one saves", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const office = p.as("office");
    expect(await office.orders.update({ id: o.id, note: "x" } as never).then(() => "saved", refused)).toBe("refused:BAD_REQUEST");
    const read = (await office.orders.get({ id: o.id })).order.serverSeq;
    await office.orders.update({ id: o.id, serverSeq: read, note: "first" });
    expect(await office.orders.update({ id: o.id, serverSeq: read, note: "stale" }).then(() => "saved", refused)).toBe("refused:CONFLICT");
    expect((await office.orders.get({ id: o.id })).order.note).toBe("first");
  }, SLOW);
});

describe("Range /12' from the raw kg/12ft (Excel: floor((kg12 + 0.01) × 10) / 10)", () => {
  test("raw 2.0895 prints band 2.0 although its printed kg/12ft rounds to 2.090; raw 2.090 prints 2.1", async () => {
    setClock(NOON);
    const p = await plant();
    // 12 pcs of 10 ft: raw kg/12ft = kg / 10.
    const d = await p.held(await p.pack(p.dieA, [{ kg: 20.895, pcs: 12, mm: 3_048 }, { kg: 20.9, pcs: 12, mm: 3_048 }]));
    await p.owner.dispatch.complete({ id: d });
    const snap = (await plRow(d))!.snapshot as { groups: { rows: { weightG: number; kgPer12ftMilli: number; range12ft: number }[] }[] };
    const byWeight = new Map(snap.groups.flatMap((g) => g.rows).map((r) => [r.weightG, r]));
    expect(byWeight.get(20_895)!.range12ft).toBe(2.0);
    expect(byWeight.get(20_900)).toMatchObject({ kgPer12ftMilli: 2090, range12ft: 2.1 });
  }, SLOW);
});
