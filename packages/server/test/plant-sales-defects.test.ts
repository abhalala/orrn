/**
 * PL-8 fix round 1: the defects the r0 reviews found (reviews/PL8-spec-r0.md, PL8-correctness-r0.md,
 * PL8-tests-r0.md). Every test here failed on 3b61603 for the reason in its title; the ids are the
 * reviews' finding ids. Started from reviews/PL8-tests-r0-proposed-defects.test.ts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { approval, dispatch, packingList } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { ist, kg, NOON, salesHelpers, SLOW, saveOrder } from "./sales-fixture";

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

const { plant, itemsOf, dispatchRow, plRow, pendingOverdraw } = salesHelpers(() => env);

async function overdrawRequests(companyId: string, dispatchId: string) {
  return env.db
    .select()
    .from(approval)
    .where(and(eq(approval.companyId, companyId), eq(approval.kind, "dispatch_overdraw"), eq(approval.subjectId, dispatchId)));
}

describe("PL8 r0 defects", () => {
  // spec C-1 / correctness C-1: SO numbers restart each financial year (doc_series period); the order
  // keeps that period and the unique key is (company, period, number), so SO-1 can exist once per FY.
  test("[spec C-1] an order can be created after the 1 April rollover; each FY has its own SO-1", async () => {
    setClock(ist("2027-03-31T12:00:00"));
    const p = await plant();
    const a = await p.order([{ dieId: p.dieA, kg: 100 }]);
    setClock(ist("2027-04-01T09:00:00"));
    const b = await p.order([{ dieId: p.dieA, kg: 100 }]);
    expect(b.id).not.toBe(a.id);
    expect([a.number, b.number]).toEqual(["SO-1", "SO-1"]);
    const got = await Promise.all([a.id, b.id].map((id) => p.owner.orders.get({ id })));
    expect(got.map((g) => [g.order.period, g.order.orderDate])).toEqual([
      ["2026-27", "2027-03-31"],
      ["2027-28", "2027-04-01"],
    ]);
    const listed = (await p.owner.orders.list({})).items;
    expect(listed.map((o) => o.id).sort()).toEqual([a.id, b.id].sort());
    expect(listed.find((o) => o.id === b.id)).toMatchObject({ number: "SO-1", period: "2027-28" });
  }, SLOW);

  // spec I-1 (Review Focus 5): kg beyond the line's balance that the scan could not link used to leave
  // with no override. The suggestion now falls back to an open line of this customer and section.
  test("[spec I-1] 3 x 500 kg scanned (not packed for the line) against a 1000 kg line needs the override", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const d = await p.held(await p.pack(p.dieA, [{ kg: 500 }, { kg: 500 }, { kg: 500 }]));
    expect((await itemsOf(d)).map((i) => i.lineId)).toEqual([o.lineIds[0]!, o.lineIds[0]!, o.lineIds[0]!]);
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await dispatchRow(d)).status).toBe("reserved");
    expect(await plRow(d)).toBeNull();
    expect((await pendingOverdraw(p.companyId, d))[0]!.meta).toMatchObject({ lines: [{ totalG: kg(1500), overG: kg(450) }] });
  }, SLOW);

  // correctness I-2: 4 x 500 kg on one 1000 kg line. The floor (dispatch.scan, even with
  // dispatch.complete) cannot take the excess off the order to slip past the override; the office can.
  test("[correctness I-2] more kg scanned than ordered meets the override; only order.manage may unlink an orderable bundle", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const d = await p.held(await p.pack(p.dieA, [{ kg: 500 }, { kg: 500 }, { kg: 500 }, { kg: 500 }]));
    const items = await itemsOf(d);
    expect(items.map((i) => i.lineId)).toEqual(Array.from({ length: 4 }, () => o.lineIds[0]!));
    const supervisor = p.as("supervisor");
    await expect(supervisor.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    for (const role of ["supervisor", "packer", "operator", "admin"] as const) {
      await expect(p.as(role).dispatch.linkItem({ itemId: items[3]!.id, salesOrderLineId: null })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    expect((await itemsOf(d)).map((i) => i.lineId)).toEqual(Array.from({ length: 4 }, () => o.lineIds[0]!));
    await expect(supervisor.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    // The office takes two bundles off the order (sold as stock, outside it): that is its call, and audited.
    await p.as("office").dispatch.linkItem({ itemId: items[2]!.id, salesOrderLineId: null });
    await p.as("office").dispatch.linkItem({ itemId: items[3]!.id, salesOrderLineId: null });
    await supervisor.dispatch.complete({ id: d });
    expect(await p.lineOf(o.lineIds[0]!)).toMatchObject({ dispatchedG: kg(1000), bakiG: 0, overG: 0 });
  }, SLOW);

  // spec I-2 / correctness I-4: lineBalances capped at 1000 lines, so totals silently dropped the newest orders.
  test("[spec I-2] balance and list totals cover every line (1100 lines over 11 orders); lineBalances refuses to cut", async () => {
    setClock(NOON);
    const p = await plant();
    const lines = Array.from({ length: 100 }, () => ({ sectionId: p.dieA, cutLengthMm: 3_000, kgG: kg(10), pcs: 1 }));
    for (let n = 0; n < 11; n += 1) await p.owner.orders.create({ customerId: p.customerId, lines });
    const list = await p.owner.orders.list({});
    expect(list.items.map((r) => r.orderedG)).toEqual(Array.from({ length: 11 }, () => 100 * kg(10)));
    expect(list.items.every((r) => r.lines === 100 && r.bakiG === 100 * kg(10))).toBe(true);
    const bal = await p.owner.orders.balance({});
    expect(bal.totals).toMatchObject({ lines: 1100, orderedG: 11 * 100 * kg(10), bakiG: 11 * 100 * kg(10) });
    expect(bal.total).toBe(1100);
    expect(bal.lines.length).toBeLessThan(1100);
    expect(bal.nextOffset).toBe(bal.lines.length);
    const rest = await p.owner.orders.balance({ offset: bal.nextOffset!, limit: 1000 });
    expect(rest.nextOffset).toBeNull();
    expect(bal.lines.length + rest.lines.length).toBe(1100);
    expect(new Set([...bal.lines, ...rest.lines].map((l) => l.lineId)).size).toBe(1100);
    const { lineBalances } = await import("../src/lib/orders");
    await expect(lineBalances(env.db as never, p.companyId, {})).rejects.toThrow(/more than 1000/i);
  }, 180_000);

  // correctness I-1: an approver must never approve figures they did not see. A pending request is never
  // rewritten: asking again with new figures withdraws it and opens a new one.
  test("[correctness I-1] a re-ask after the request was opened cannot be covered by an approval of the smaller figures", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const serials = await p.pack(p.dieA, [{ kg: 60 }, { kg: 60 }, { kg: 1000 }], o.lineIds[0]);
    const d = await p.held(serials.slice(0, 2)); // 120 kg on 100 kg (limit 105)
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [seen] = await pendingOverdraw(p.companyId, d);
    expect((seen!.meta as { lines: { totalG: number }[] }).lines[0]!.totalG).toBe(kg(120));
    // 1000 kg more is scanned and Complete is pressed again.
    await p.owner.dispatch.addBundlesBySerial({ id: d, serials: [serials[2]!] });
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    // The request the manager was looking at still says 120 kg (withdrawn), and a new one says 1120 kg.
    const all = await overdrawRequests(p.companyId, d);
    expect(all.find((r) => r.id === seen!.id)).toMatchObject({ status: "rejected", note: expect.stringMatching(/^Withdrawn: /) });
    expect((all.find((r) => r.id === seen!.id)!.meta as { lines: { totalG: number }[] }).lines[0]!.totalG).toBe(kg(120));
    const [fresh] = await pendingOverdraw(p.companyId, d);
    expect(fresh!.id).not.toBe(seen!.id);
    expect((fresh!.meta as { lines: { totalG: number }[] }).lines[0]!.totalG).toBe(kg(1120));
    // The manager decides the request they were looking at: it is no longer open.
    await expect(p.as("manager").approval.decide({ id: seen!.id, decision: "approved" })).rejects.toThrow();
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await dispatchRow(d)).status).toBe("reserved");
    expect((await p.lineOf(o.lineIds[0]!)).dispatchedG).toBe(0);
  }, SLOW);

  // correctness I-1b: the person who pressed Complete with new figures is the requester of the new request.
  test("[correctness I-1b] a manager who re-asks cannot approve the request he opened", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const serials = await p.pack(p.dieA, [{ kg: 60 }, { kg: 60 }, { kg: 1000 }], o.lineIds[0]);
    const office = p.as("office");
    const manager = p.as("manager");
    const d = await p.held(serials.slice(0, 2), p.customerId, office);
    await expect(office.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await office.dispatch.addBundlesBySerial({ id: d, serials: [serials[2]!] });
    await expect(manager.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const pending = await pendingOverdraw(p.companyId, d);
    expect(pending).toHaveLength(1);
    for (const req of pending) {
      await expect(manager.approval.decide({ id: req.id, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(manager.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await dispatchRow(d)).status).toBe("reserved");
    // Another approver (the owner) can approve what the manager asked for, and then it completes.
    await p.owner.approval.decide({ id: pending[0]!.id, decision: "approved" });
    await manager.dispatch.complete({ id: d });
    expect((await p.lineOf(o.lineIds[0]!)).dispatchedG).toBe(kg(1120));
  }, SLOW);

  // correctness I-3: produced kept counting a bundle that left on a dispatch not linked to its line.
  test("[correctness I-3] a bundle packed for SO-1 that left for another customer no longer counts as produced for SO-1", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const s = await p.pack(p.dieA, [{ kg: 300 }], o.lineIds[0]);
    expect((await p.lineOf(o.lineIds[0]!)).producedG).toBe(kg(300));
    const d = await p.held(s, p.otherCustomer); // the other customer has no open order: the item stays unlinked
    expect((await itemsOf(d))[0]!.lineId).toBeNull();
    await p.owner.dispatch.complete({ id: d });
    expect(await p.lineOf(o.lineIds[0]!)).toMatchObject({ producedG: 0, dispatchedG: 0, bakiG: kg(1000) });
  }, SLOW);

  // correctness M-1: a header-only edit that read the dispatch as draft/reserved must not land on a dispatch
  // that completed meanwhile (R7: after completion only dispatch.complete holders edit the header).
  test("[correctness M-1] a packer's header edit that loses to Complete is refused, not written onto the completed dispatch", async () => {
    const p = await plant();
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    env.beforeNextBatch(() => p.owner.dispatch.complete({ id: d }));
    await expect(p.as("packer").dispatch.update({ id: d, vehicleNo: "GJ05AB1234" })).rejects.toMatchObject({ code: "CONFLICT" });
    const row = await dispatchRow(d);
    expect(row.status).toBe("completed");
    expect(row.vehicleNo).toBeNull();
  }, SLOW);

  // correctness M-2: linkItem re-checks the line's section at write time.
  test("[correctness M-2] a link that read the line as this section refuses when the line's section changes first", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ id, serials: await p.pack(p.dieA, [{ kg: 10 }]) });
    const [item] = await itemsOf(id);
    await p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null });
    env.beforeNextBatch(() =>
      saveOrder(p.owner, { id: o.id, lines: [{ id: o.lineIds[0]!, sectionId: p.dieB, cutLengthMm: 3_658, kgG: kg(1000) }] }),
    );
    await expect(p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: o.lineIds[0]! })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await itemsOf(id))[0]!.lineId).toBeNull();
  }, SLOW);

  // correctness M-5: an edit to a line that a concurrent edit removed answered success.
  test("[correctness M-5] editing a line that a concurrent edit just removed answers CONFLICT", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }, { dieId: p.dieA, kg: 200 }]);
    const [l1, l2] = o.lineIds as [string, string];
    const line = { sectionId: p.dieA, cutLengthMm: 3_658 };
    env.beforeNextBatch(() => saveOrder(p.owner, { id: o.id, lines: [{ id: l1, ...line, kgG: kg(100) }] })); // removes line 2
    await expect(
      saveOrder(p.owner, { id: o.id, lines: [{ id: l1, ...line, kgG: kg(100) }, { id: l2, ...line, kgG: kg(250) }] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await p.owner.orders.get({ id: o.id })).lines.map((l) => l.lineId)).toEqual([l1]);
  }, SLOW);

  // spec M-2: the dispatch view shows the PO the packing list prints (the order's, else the bundle's).
  test("[spec M-2] getDispatch items show the order's PO over the bundle's own, like the packing list", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }], { poNumber: "PO-778" });
    const d = await p.held([
      ...(await p.pack(p.dieA, [{ kg: 10, po: "BUNDLE-PO" }], o.lineIds[0])),
      ...(await p.pack(p.dieB, [{ kg: 10, po: "LOOSE-PO" }])),
    ]);
    const items = (await p.owner.dispatch.getDispatch({ id: d })).items;
    expect(items.map((i) => i.poNumber).sort()).toEqual(["LOOSE-PO", "PO-778"]);
  }, SLOW);

  // spec M-3: dispatches completed before PL-8 have no pl_number but a packing list code.
  test("[spec M-3] the sales register prints the packing list code of a dispatch completed before PL numbers", async () => {
    setClock(ist("2026-10-05T11:00:00"));
    const p = await plant();
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    await p.owner.dispatch.complete({ id: d });
    await env.db.update(dispatch).set({ plNumber: null }).where(eq(dispatch.id, d));
    await env.db.update(packingList).set({ code: "PL-000123" }).where(eq(packingList.dispatchId, d));
    const { csv } = await p.owner.reports.salesRegisterCsv({ month: "2026-10" });
    expect(csv.split("\r\n")[1]!.split(",")[1]).toBe("PL-000123");
  }, SLOW);
});
