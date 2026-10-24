/**
 * PL-8: sales orders, baki, dispatch header and packing list v2 (spec P12/P13, digest Stages 15-16).
 *
 * Review Focus 5: dispatching more kg than an order line's balance (beyond the customer's kg
 * tolerance) needs a manager override, also under real races; baki never shows negative.
 * Review Focus 1 is re-asserted: after the sales flow the ledger still equals the bundle projection.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { approval, bundle, customer, dispatchItem, docSeries, packingList } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { can, type Action } from "../src/lib/permissions";
import { createTestEnv, type TestEnv } from "./harness";
import { ist, kg, NOON, ROLES, salesHelpers, SLOW, saveOrder, cancelOrder, closeOrder, confirmOrder, reopenOrder } from "./sales-fixture";

let env: TestEnv;
let setClock: (at: Date | null) => void;
let plSchema: typeof import("../src/lib/packingListSnapshot").plSnapshotV2Schema;

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
  plSchema = (await import("../src/lib/packingListSnapshot")).plSnapshotV2Schema;
}, 60_000);

afterEach(() => setClock(null));

afterAll(async () => {
  await env.dispose();
});

const { plant, itemsOf, dispatchRow, plRow, ledgerOf, expectLedgerConsistent, pendingOverdraw } = salesHelpers(() => env);

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

describe("orders: create, numbers and validation", () => {
  test("numbers come from the SO series per financial year; lines are numbered 1..n", async () => {
    setClock(NOON);
    const p = await plant();
    const a = await p.order([{ dieId: p.dieA, kg: 1000, pcs: 50 }, { dieId: p.dieB, kg: 400, finish: "Anodise" }], {
      poNumber: "PO-778",
    });
    const b = await p.order([{ dieId: p.dieA, kg: 200 }]);
    expect(a.number).toBe("SO-1");
    expect(b.number).toBe("SO-2");
    const got = await p.owner.orders.get({ id: a.id });
    expect(got.order).toMatchObject({
      number: "SO-1",
      period: "2026-27",
      customerId: p.customerId,
      poNumber: "PO-778",
      status: "booking",
      orderDate: "2026-10-03",
    });
    expect(got.lines.map((l) => [l.lineNo, l.sectionId, l.orderedG, l.orderedPcs, l.finish])).toEqual([
      [1, p.dieA, kg(1000), 50, null],
      [2, p.dieB, kg(400), null, "Anodise"],
    ]);
    const [series] = await env.db
      .select()
      .from(docSeries)
      .where(and(eq(docSeries.companyId, p.companyId), eq(docSeries.docType, "so")));
    expect(series).toMatchObject({ period: "2026-27", value: 2 });
  }, SLOW);

  test("validation: positive kg, at least one line, at most 100, sections and customers of this company", async () => {
    const p = await plant();
    const other = await plant();
    const line = { sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(100) };
    await expect(p.owner.orders.create({ customerId: p.customerId, lines: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.owner.orders.create({ customerId: p.customerId, lines: [{ ...line, kgG: 0 }] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      p.owner.orders.create({ customerId: p.customerId, lines: Array.from({ length: 101 }, () => line) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.owner.orders.create({ customerId: other.customerId, lines: [line] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      p.owner.orders.create({ customerId: p.customerId, lines: [{ ...line, sectionId: other.dieA }] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, SLOW);

  test("a 100-line order is written within D1's 100 bound parameters per statement", async () => {
    const p = await plant();
    env.resetPeakParams();
    const res = await p.owner.orders.create({
      customerId: p.customerId,
      lines: Array.from({ length: 100 }, (_, i) => ({
        sectionId: i % 2 ? p.dieA : p.dieB,
        cutLengthMm: 3_000 + i,
        kgG: kg(10 + i),
        pcs: i + 1,
        kgPer12ftMilli: 2_400,
        finish: "Mill",
        note: `line ${i + 1}`,
      })),
    });
    expect(env.peakParams()).toBeLessThanOrEqual(100);
    const got = await p.owner.orders.get({ id: res.id });
    expect(got.lines).toHaveLength(100);
    expect(got.lines[99]!.lineNo).toBe(100);
  }, SLOW);

  test("list filters by status and customer, newest first, with order totals", async () => {
    const p = await plant();
    const a = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const b = await p.order([{ dieId: p.dieA, kg: 50 }, { dieId: p.dieB, kg: 25 }], { customerId: p.otherCustomer, status: "confirmed" });
    const all = await p.owner.orders.list({});
    expect(all.items.map((o) => o.id)).toEqual([b.id, a.id]);
    expect(all.items[0]).toMatchObject({ lines: 2, orderedG: kg(75), dispatchedG: 0, bakiG: kg(75), status: "confirmed" });
    expect((await p.owner.orders.list({ status: "booking" })).items.map((o) => o.id)).toEqual([a.id]);
    expect((await p.owner.orders.list({ customerId: p.otherCustomer })).items.map((o) => o.id)).toEqual([b.id]);
  }, SLOW);
});

describe("order status and line edits", () => {
  test("moves go through confirm / close / cancel (D11); dispatching is set by the first completed dispatch", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    // An edit never moves the status (W1-OP-S review round 1 I-1).
    await expect(saveOrder(p.owner, { id: o.id, status: "confirmed" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await confirmOrder(p.owner, o.id);
    await expect(saveOrder(p.owner, { id: o.id, status: "dispatching" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const serials = await p.pack(p.dieA, [{ kg: 200 }], o.lineIds[0]);
    const d = await p.held(serials);
    await p.owner.dispatch.complete({ id: d });
    expect((await p.owner.orders.get({ id: o.id })).order.status).toBe("dispatching");
    // Cancel is for orders entered in error: refused once anything went out.
    await expect(cancelOrder(p.owner, o.id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await closeOrder(p.owner, o.id);
    // No reopen through an edit either.
    await expect(saveOrder(p.owner, { id: o.id, status: "confirmed" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await p.owner.orders.get({ id: o.id })).order.status).toBe("closed");
  }, SLOW);

  test("a booking with nothing dispatched can be cancelled; cancelled orders take no edits", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    await cancelOrder(p.owner, o.id);
    await expect(saveOrder(p.owner, { id: o.id, poNumber: "X" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("lines: add, change, remove; a line with bundles keeps its section and cannot be removed", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }, { dieId: p.dieB, kg: 300 }]);
    await p.pack(p.dieA, [{ kg: 100 }], o.lineIds[0]);
    const [l1, l2] = o.lineIds;
    // Remove line 2, change line 1's kg, add a new line (gets number 3, never reuses 2).
    await saveOrder(p.owner, {
      id: o.id,
      lines: [
        { id: l1!, sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(1200) },
        { sectionId: p.dieB, cutLengthMm: 4_000, kgG: kg(50) },
      ],
    });
    const got = await p.owner.orders.get({ id: o.id });
    expect(got.lines.map((l) => [l.lineNo, l.orderedG])).toEqual([[1, kg(1200)], [3, kg(50)]]);
    expect(got.lines.find((l) => l.lineId === l2)).toBeUndefined();
    // Line 1 has a bundle packed for it: no section change, no removal.
    await expect(
      saveOrder(p.owner, { id: o.id, lines: [{ id: l1!, sectionId: p.dieB, cutLengthMm: 3_658, kgG: kg(1200) }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      saveOrder(p.owner, { id: o.id, lines: [{ sectionId: p.dieB, cutLengthMm: 4_000, kgG: kg(50) }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // The customer cannot change once a line carries bundles.
    await expect(saveOrder(p.owner, { id: o.id, customerId: p.otherCustomer })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("a line's kg change is in the order's audit history (raising kg lets more leave without an override)", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }, { dieId: p.dieB, kg: 200 }]);
    const [l1, l2] = o.lineIds as [string, string];
    await saveOrder(p.as("office"), {
      id: o.id,
      lines: [
        { id: l1, sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(150) },
        { id: l2, sectionId: p.dieB, cutLengthMm: 3_658, kgG: kg(200) },
      ],
    });
    const { auditLog } = await import("@orrn/db/schema");
    const rows = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "order.update")));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.meta).toMatchObject({ kgChanged: [{ lineNo: 1, fromG: kg(100), toG: kg(150) }], linesChanged: 2 });
  }, SLOW);

  test("race: a bundle packed for a line after the edit read it blocks a customer change, and nothing half-applies", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    // The edit reads "no links", then the packer packs against line 1 before the edit's batch runs.
    env.beforeNextBatch(() => p.pack(p.dieA, [{ kg: 100 }], o.lineIds[0]));
    await expect(
      saveOrder(p.owner, { id: o.id, customerId: p.otherCustomer, poNumber: "PO-NEW" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const got = await p.owner.orders.get({ id: o.id });
    expect(got.order).toMatchObject({ customerId: p.customerId, poNumber: null });
    expect(got.lines[0]!.producedG).toBe(kg(100));
  }, SLOW);
});

// ---------------------------------------------------------------------------
// Baki
// ---------------------------------------------------------------------------

describe("baki math", () => {
  test("ordered, produced, dispatched and baki per line in kg and pcs", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000, pcs: 50 }]);
    const lineId = o.lineIds[0]!;
    const forLine = await p.pack(p.dieA, [{ kg: 200 }, { kg: 200 }, { kg: 200 }], lineId);
    const voided = await p.pack(p.dieA, [{ kg: 150 }], lineId);
    await p.pack(p.dieA, [{ kg: 999 }]); // not for the line
    const [vb] = await env.db.select({ id: bundle.id }).from(bundle).where(and(eq(bundle.companyId, p.companyId), eq(bundle.serial, voided[0]!)));
    await p.owner.bundle.transitionStatus({ id: vb!.id, toStatus: "void", reason: "damaged" });

    let l = await p.lineOf(lineId);
    expect(l).toMatchObject({ orderedG: kg(1000), orderedPcs: 50, producedG: kg(600), producedPcs: 30, dispatchedG: 0, bakiG: kg(1000), bakiPcs: 50 });

    // Draft, reserved and cancelled dispatches do not count as dispatched.
    const draft = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id: draft.id, serials: [forLine[2]!] });
    const d = await p.held([forLine[0]!, forLine[1]!]);
    expect((await p.lineOf(lineId)).dispatchedG).toBe(0);
    await p.owner.dispatch.complete({ id: d });

    l = await p.lineOf(lineId);
    expect(l).toMatchObject({
      producedG: kg(600),
      dispatchedG: kg(400),
      dispatchedPcs: 20,
      dispatchedBundles: 2,
      bakiG: kg(600),
      bakiPcs: 30,
      overG: 0,
    });
    await expectLedgerConsistent(p);
  }, SLOW);

  test("baki never goes negative: an approved over-dispatch shows baki 0 and the excess as overG", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 300, pcs: 10 }]);
    const lineId = o.lineIds[0]!;
    const serials = await p.pack(p.dieA, [{ kg: 200 }, { kg: 200 }], lineId);
    const d = await p.held(serials);
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [req] = await pendingOverdraw(p.companyId, d);
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    await p.owner.dispatch.complete({ id: d });
    const l = await p.lineOf(lineId);
    expect(l).toMatchObject({ dispatchedG: kg(400), bakiG: 0, overG: kg(100), dispatchedPcs: 20, bakiPcs: 0 });
    const t = await p.owner.orders.balance({ includeClosed: true });
    expect(t.totals).toMatchObject({ bakiG: 0, overG: kg(100) });
  }, SLOW);

  test("balance filters by customer; closed orders are left out unless asked for", async () => {
    const p = await plant();
    const mine = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const theirs = await p.order([{ dieId: p.dieA, kg: 70 }], { customerId: p.otherCustomer });
    const closed = await p.order([{ dieId: p.dieB, kg: 30 }]);
    await closeOrder(p.owner, closed.id);
    const byCustomer = await p.owner.orders.balance({ customerId: p.customerId });
    expect(byCustomer.lines.map((l) => l.orderId)).toEqual([mine.id]);
    expect(byCustomer.totals).toMatchObject({ lines: 1, orderedG: kg(100), bakiG: kg(100) });
    const all = await p.owner.orders.balance({ includeClosed: true });
    expect(new Set(all.lines.map((l) => l.orderId))).toEqual(new Set([mine.id, theirs.id, closed.id]));
  }, SLOW);
});

// ---------------------------------------------------------------------------
// Review Focus 5: overdraw needs a manager override
// ---------------------------------------------------------------------------

describe("Review Focus 5: dispatching past an order line's balance", () => {
  test("within the customer's tolerance (default 5 %) the dispatch completes without approval", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 500 }, { kg: 550 }], o.lineIds[0]); // 1050 = limit
    const d = await p.held(serials);
    await p.owner.dispatch.complete({ id: d });
    expect((await dispatchRow(d)).status).toBe("completed");
    expect(await pendingOverdraw(p.companyId, d)).toHaveLength(0);
  }, SLOW);

  test("beyond tolerance: refused, approval opened, nothing moves, no PL number taken", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 500 }, { kg: 551 }], o.lineIds[0]); // 1051 > 1050
    const d = await p.held(serials);
    await expect(p.owner.dispatch.complete({ id: d, overdrawNote: "Customer asked for the full bundle" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    const [req] = await pendingOverdraw(p.companyId, d);
    expect(req).toBeTruthy();
    expect(req!.requestNote).toBe("Customer asked for the full bundle");
    expect(req!.meta).toMatchObject({
      dispatchId: d,
      toleranceBp: 500,
      lines: [{ lineId: o.lineIds[0], orderNumber: o.number, lineNo: 1, orderedG: kg(1000), limitG: kg(1050), totalG: kg(1051), overG: kg(1) }],
    });
    const row = await dispatchRow(d);
    expect(row.status).toBe("reserved");
    expect(row.plNumber).toBeNull();
    expect(await plRow(d)).toBeNull();
    expect(await ledgerOf(p.companyId, d)).toHaveLength(0);
    const pl = await env.db.select().from(docSeries).where(and(eq(docSeries.companyId, p.companyId), eq(docSeries.docType, "pl")));
    expect(pl).toHaveLength(0);
    // Asking again with the same figures leaves the one pending request as it is (never rewritten).
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await pendingOverdraw(p.companyId, d)).toEqual([expect.objectContaining({ id: req!.id, serverSeq: req!.serverSeq, meta: req!.meta })]);
    // getDispatch shows the state to the screen.
    const view = await p.owner.dispatch.getDispatch({ id: d });
    expect(view.overdraw).toMatchObject({ toleranceBp: 500, approval: { id: req!.id, status: "pending" } });
    expect(view.overdraw!.lines[0]).toMatchObject({ overG: kg(1), covered: false });
    await expectLedgerConsistent(p);
  }, SLOW);

  test("the requester cannot approve; a manager's approval lets the same dispatch complete", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 600 }, { kg: 600 }], o.lineIds[0]);
    const office = p.as("office");
    const d = await p.held(serials, p.customerId, office);
    await expect(office.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [req] = await pendingOverdraw(p.companyId, d);
    await expect(p.as("supervisor").approval.decide({ id: req!.id, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(office.approval.decide({ id: req!.id, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    const done = await office.dispatch.complete({ id: d });
    expect(done.plNumber).toMatch(/^PL\//);
    expect((await dispatchRow(d)).status).toBe("completed");
    expect(await ledgerOf(p.companyId, d)).toHaveLength(2);
    await expectLedgerConsistent(p);
  }, SLOW);

  test("a rejection keeps the dispatch held; the approval covers only the total it was asked for", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const lineId = o.lineIds[0]!;
    const serials = await p.pack(p.dieA, [{ kg: 600 }, { kg: 600 }, { kg: 50 }], lineId);
    const d = await p.held(serials.slice(0, 2));
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [first] = await pendingOverdraw(p.companyId, d);
    await p.as("manager").approval.decide({ id: first!.id, decision: "rejected" });
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [second] = await pendingOverdraw(p.companyId, d);
    await p.as("manager").approval.decide({ id: second!.id, decision: "approved" });
    // One more bundle after the approval: 1250 kg is more than the 1200 approved.
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id: d, serials: [serials[2]!] });
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await dispatchRow(d)).status).toBe("reserved");
    // Taking it off again brings the total back under what was approved.
    const [extra] = await env.db.select({ id: bundle.id }).from(bundle).where(and(eq(bundle.companyId, p.companyId), eq(bundle.serial, serials[2]!)));
    await p.owner.dispatch.removeBundle({ id: d, bundleId: extra!.id });
    await p.owner.dispatch.complete({ id: d });
    expect((await p.lineOf(lineId)).dispatchedG).toBe(kg(1200));
  }, SLOW);

  test("a pending override is withdrawn when the dispatch completes within limits, is cancelled or is deleted", async () => {
    const p = await plant();
    const withdrawn = async (dispatchId: string) =>
      env.db
        .select({ status: approval.status, note: approval.note, decidedBy: approval.decidedBy })
        .from(approval)
        .where(and(eq(approval.companyId, p.companyId), eq(approval.kind, "dispatch_overdraw"), eq(approval.subjectId, dispatchId)));
    const overdrawn = async () => {
      const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
      const serials = await p.pack(p.dieA, [{ kg: 80 }, { kg: 80 }], o.lineIds[0]);
      const d = await p.held(serials);
      await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(await pendingOverdraw(p.companyId, d)).toHaveLength(1);
      return { d, serials };
    };
    // Completes within limits after a bundle comes off.
    const a = await overdrawn();
    const [extra] = await env.db.select({ id: bundle.id }).from(bundle).where(and(eq(bundle.companyId, p.companyId), eq(bundle.serial, a.serials[1]!)));
    await p.owner.dispatch.removeBundle({ id: a.d, bundleId: extra!.id });
    await p.owner.dispatch.complete({ id: a.d });
    expect(await withdrawn(a.d)).toEqual([{ status: "rejected", note: expect.stringMatching(/^Withdrawn: /), decidedBy: null }]);
    // Cancelled.
    const b = await overdrawn();
    await p.owner.dispatch.cancel({ id: b.d });
    expect(await withdrawn(b.d)).toEqual([{ status: "rejected", note: expect.stringMatching(/^Withdrawn: /), decidedBy: null }]);
    // Released and deleted.
    const c = await overdrawn();
    await p.owner.dispatch.unreserve({ id: c.d });
    expect(await pendingOverdraw(p.companyId, c.d)).toHaveLength(1); // still useful if it is held again
    await p.owner.dispatch.softDelete({ id: c.d });
    expect(await withdrawn(c.d)).toEqual([{ status: "rejected", note: expect.stringMatching(/^Withdrawn: /), decidedBy: null }]);
    await expectLedgerConsistent(p);
  }, SLOW);

  test("tolerance: the customer's own value wins over the company default", async () => {
    const p = await plant({ settings: { orderToleranceBp: 2_000 } });
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const s1 = await p.pack(p.dieA, [{ kg: 1150 }], o.lineIds[0]); // +15 % inside the company's 20 %
    const d1 = await p.held(s1);
    await p.owner.dispatch.complete({ id: d1 });

    await p.owner.customer.update({ id: p.customerId, name: "Strict", kgToleranceBp: 0 });
    const o2 = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const s2 = await p.pack(p.dieA, [{ kg: 1000.001 }], o2.lineIds[0]);
    const d2 = await p.held(s2);
    await expect(p.owner.dispatch.complete({ id: d2 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await p.owner.customer.get({ id: p.customerId })).kgToleranceBp).toBe(0);
  }, SLOW);

  test("race: two dispatches each inside the limit, together over it — the second to land is refused", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const sa = await p.pack(p.dieA, [{ kg: 600 }], o.lineIds[0]);
    const sb = await p.pack(p.dieA, [{ kg: 500 }], o.lineIds[0]);
    const a = await p.held(sa);
    const b = await p.held(sb);
    // A reads (no overdraw yet), then B completes fully before A's batch runs.
    env.beforeNextBatch(() => p.as("manager").dispatch.complete({ id: b }));
    await expect(p.owner.dispatch.complete({ id: a })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await dispatchRow(b)).status).toBe("completed");
    const ra = await dispatchRow(a);
    expect(ra.status).toBe("reserved");
    expect(ra.plNumber).toBeNull();
    expect(await plRow(a)).toBeNull();
    expect(await ledgerOf(p.companyId, a)).toHaveLength(0);
    expect(await pendingOverdraw(p.companyId, a)).toHaveLength(1);
    expect((await p.lineOf(o.lineIds[0]!)).dispatchedG).toBe(kg(500));
    await expectLedgerConsistent(p);
  }, SLOW);

  test("race: a link made after complete read the dispatch cannot slip an overdraw through", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 80 }]);
    const lineId = o.lineIds[0]!;
    const serials = await p.pack(p.dieA, [{ kg: 80 }, { kg: 80 }]);
    const d = await p.held(serials);
    // The scan links both (the second meets the order's limit); the office takes the second off by hand.
    const items = await itemsOf(d);
    expect(items.map((i) => i.lineId)).toEqual([lineId, lineId]);
    await p.as("office").dispatch.linkItem({ itemId: items[1]!.id, salesOrderLineId: null });
    // Complete reads 80 kg on the line (within the limit); the link lands before its batch.
    env.beforeNextBatch(() => p.owner.dispatch.linkItem({ itemId: items[1]!.id, salesOrderLineId: lineId }));
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await dispatchRow(d)).status).toBe("reserved");
    expect(await plRow(d)).toBeNull();
    await expectLedgerConsistent(p);
  }, SLOW);

  test("race: complete against cancel still ends with one outcome and a consistent ledger", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 100 }], o.lineIds[0]);
    const d = await p.held(serials);
    env.beforeNextBatch(() => p.owner.dispatch.cancel({ id: d }));
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await dispatchRow(d)).status).toBe("cancelled");
    expect(await plRow(d)).toBeNull();
    expect(await ledgerOf(p.companyId, d)).toHaveLength(0);
    await expectLedgerConsistent(p);
  }, SLOW);
});

// ---------------------------------------------------------------------------
// Auto-suggest and links
// ---------------------------------------------------------------------------

describe("order line suggested per bundle, and links", () => {
  test("scan links each bundle to the oldest open line of this customer and section with baki", async () => {
    const p = await plant();
    const old = await p.order([{ dieId: p.dieA, kg: 150 }]);
    const newer = await p.order([{ dieId: p.dieA, kg: 500 }, { dieId: p.dieB, kg: 500 }]);
    const closed = await p.order([{ dieId: p.dieA, kg: 900 }]);
    await closeOrder(p.owner, closed.id);
    const theirs = await p.order([{ dieId: p.dieA, kg: 900 }], { customerId: p.otherCustomer });
    const packedForNewer = await p.pack(p.dieA, [{ kg: 100 }], newer.lineIds[0]);
    const a = await p.pack(p.dieA, [{ kg: 100 }, { kg: 100 }, { kg: 100 }]);
    const b = await p.pack(p.dieB, [{ kg: 100 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const report = await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials: [...packedForNewer, ...a, ...b] });
    const byLine = new Map(report.linked.map((l) => [l.serial, l.salesOrderLineId]));
    expect(byLine.get(packedForNewer[0]!)).toBe(newer.lineIds[0]); // packed for it
    expect(byLine.get(a[0]!)).toBe(old.lineIds[0]); // oldest with baki (150)
    expect(byLine.get(a[1]!)).toBe(old.lineIds[0]); // 50 left on the old line → still picked
    expect(byLine.get(a[2]!)).toBe(newer.lineIds[0]); // old line used up
    expect(byLine.get(b[0]!)).toBe(newer.lineIds[1]);
    expect(report.linked.find((l) => l.serial === a[0])).toMatchObject({ orderNumber: old.number, lineNo: 1 });
    const used = new Set(report.linked.map((l) => l.salesOrderLineId));
    expect(used.has(closed.lineIds[0]!)).toBe(false);
    expect(used.has(theirs.lineIds[0]!)).toBe(false);
  }, SLOW);

  test("once every open line of the section is used up, the excess links to the NEWEST open line, so the override applies", async () => {
    const p = await plant();
    const old = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const newer = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const s = await p.pack(p.dieA, [{ kg: 100 }, { kg: 100 }, { kg: 50 }]);
    const d = await p.held(s);
    expect((await itemsOf(d)).map((i) => i.lineId)).toEqual([old.lineIds[0]!, newer.lineIds[0]!, newer.lineIds[0]!]);
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [req] = await pendingOverdraw(p.companyId, d);
    expect(req!.meta).toMatchObject({ lines: [{ lineId: newer.lineIds[0], totalG: kg(150), limitG: kg(105), overG: kg(45) }] });
    // Within tolerance the excess simply rides on the line: 100 + 4 kg on a 100 kg line (limit 105).
    const o3 = await p.order([{ dieId: p.dieB, kg: 100 }]);
    const d2 = await p.held(await p.pack(p.dieB, [{ kg: 100 }, { kg: 4 }]));
    expect((await itemsOf(d2)).map((i) => i.lineId)).toEqual([o3.lineIds[0]!, o3.lineIds[0]!]);
    await p.owner.dispatch.complete({ id: d2 });
    expect(await p.lineOf(o3.lineIds[0]!)).toMatchObject({ dispatchedG: kg(104), bakiG: 0, overG: kg(4) });
  }, SLOW);

  test("race: the floor's unlink that read 'no open line' refuses when the order reopens before it lands", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials: await p.pack(p.dieA, [{ kg: 100 }]) });
    const [item] = await itemsOf(id);
    expect(item!.lineId).toBe(o.lineIds[0]!);
    // The order is closed: no open line for the section, so the packer may unlink…
    await closeOrder(p.owner, o.id);
    // …but it is reopened between the unlink's read and its write.
    env.beforeNextBatch(() => reopenOrder(env, o.id));
    await expect(p.as("packer").dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await itemsOf(id))[0]!.lineId).toBe(o.lineIds[0]!);
    // With the order closed and staying closed the packer's unlink lands.
    await closeOrder(p.owner, o.id);
    await p.as("packer").dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null });
    expect((await itemsOf(id))[0]!.lineId).toBeNull();
  }, SLOW);

  test("race: a suggested line whose order closes before the scan lands leaves the bundle unlinked (the scan still succeeds)", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 100 }, { kg: 100 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    env.beforeNextBatch(() => closeOrder(p.owner, o.id));
    const report = await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true, id, serials });
    expect(report.added).toHaveLength(2);
    expect(report.linked).toEqual([]);
    expect((await itemsOf(id)).map((i) => i.lineId)).toEqual([null, null]);
    // Single-bundle add (the gate's one-at-a-time scan) behaves the same.
    await reopenOrder(env, o.id);
    const [third] = await p.pack(p.dieA, [{ kg: 100 }]);
    const [b3] = await env.db.select({ id: bundle.id }).from(bundle).where(and(eq(bundle.companyId, p.companyId), eq(bundle.serial, third!)));
    env.beforeNextBatch(() => closeOrder(p.owner, o.id));
    const single = await p.owner.dispatch.addBundle({ allowUnassigned: true, id, bundleId: b3!.id });
    expect(single.added).toEqual([third!]);
    expect(single.linked).toEqual([]);
    expect((await itemsOf(id)).map((i) => i.lineId)).toEqual([null, null, null]);
  }, SLOW);

  test("without an open line of this customer for the section the bundle stays unlinked", async () => {
    const p = await plant();
    const serials = await p.pack(p.dieA, [{ kg: 100 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const report = await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    expect(report.linked).toEqual([]);
    expect((await itemsOf(id))[0]!.lineId).toBeNull();
  }, SLOW);

  test("linkItem: same customer, same section, open order, editable dispatch; null unlinks", async () => {
    const p = await plant();
    const mine = await p.order([{ dieId: p.dieA, kg: 1000 }, { dieId: p.dieB, kg: 1000 }]);
    const theirs = await p.order([{ dieId: p.dieA, kg: 1000 }], { customerId: p.otherCustomer });
    const closed = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    await closeOrder(p.owner, closed.id);
    const other = await plant();
    const foreign = await other.order([{ dieId: other.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 100 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    const [item] = await itemsOf(id);
    const packer = p.as("packer");
    await expect(packer.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: theirs.lineIds[0]! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(packer.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: mine.lineIds[1]! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(packer.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: closed.lineIds[0]! })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(packer.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: foreign.lineIds[0]! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // The customer has an open line for this section: only order.manage may take the bundle off it.
    await expect(packer.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await itemsOf(id))[0]!.lineId).toBe(mine.lineIds[0]!);
    await p.as("office").dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null });
    expect((await itemsOf(id))[0]!.lineId).toBeNull();
    await packer.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: mine.lineIds[0]! });
    expect((await itemsOf(id))[0]!.lineId).toBe(mine.lineIds[0]!);
    await p.owner.dispatch.reserve({ id });
    await p.owner.dispatch.complete({ id });
    await expect(packer.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("race: a link made after a customer change read the dispatch blocks the change (no silent success)", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 100 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    const [item] = await itemsOf(id);
    await p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null });
    env.beforeNextBatch(() => p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: o.lineIds[0]! }));
    await expect(p.owner.dispatch.update({ id, customerId: p.otherCustomer })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await dispatchRow(id)).customerId).toBe(p.customerId);
    expect((await itemsOf(id))[0]!.lineId).toBe(o.lineIds[0]!);
  }, SLOW);

  test("race: a dispatch edit that loses to a reserve reports a conflict instead of success", async () => {
    const p = await plant();
    const serials = await p.pack(p.dieA, [{ kg: 100 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    env.beforeNextBatch(() => p.owner.dispatch.reserve({ id }));
    await expect(p.owner.dispatch.update({ id, notes: "late note" })).rejects.toMatchObject({ code: "CONFLICT" });
    const row = await dispatchRow(id);
    expect(row.status).toBe("reserved");
    expect(row.notes).toBeNull();
  }, SLOW);

  test("race: linkItem that read an open order of this customer refuses when the order closes or the customer changes first", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 100 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    const [item] = await itemsOf(id);
    await p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null });
    // The order closes between linkItem's read and its write.
    env.beforeNextBatch(() => closeOrder(p.owner, o.id));
    await expect(p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: o.lineIds[0]! })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await itemsOf(id))[0]!.lineId).toBeNull();
    // The dispatch moves to another customer between linkItem's read and its write.
    await reopenOrder(env, o.id);
    env.beforeNextBatch(() => p.owner.dispatch.update({ id, customerId: p.otherCustomer }));
    await expect(p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: o.lineIds[0]! })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await itemsOf(id))[0]!.lineId).toBeNull();
    expect((await dispatchRow(id)).customerId).toBe(p.otherCustomer);
  }, SLOW);

  test("completing moves the bundle to the line it was dispatched against (produced follows)", async () => {
    const p = await plant();
    const a = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const b = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 100 }], a.lineIds[0]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    const [item] = await itemsOf(id);
    await p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: b.lineIds[0]! });
    // Until it leaves, the bundle still counts for the line it was packed for.
    expect((await p.lineOf(a.lineIds[0]!)).producedG).toBe(kg(100));
    await p.owner.dispatch.reserve({ id });
    await p.owner.dispatch.complete({ id });
    expect(await p.lineOf(a.lineIds[0]!)).toMatchObject({ producedG: 0, dispatchedG: 0 });
    expect(await p.lineOf(b.lineIds[0]!)).toMatchObject({ producedG: kg(100), dispatchedG: kg(100), bakiG: kg(900) });
  }, SLOW);
});

describe("pack against an order line", () => {
  test("createReceipt sets the line on every bundle; section, company and open order are checked", async () => {
    const p = await plant();
    const other = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const closed = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    await closeOrder(p.owner, closed.id);
    const foreign = await other.order([{ dieId: other.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 100 }, { kg: 120 }], o.lineIds[0]);
    const rows = await env.db.select({ line: bundle.salesOrderLineId }).from(bundle).where(and(eq(bundle.companyId, p.companyId), eq(bundle.serial, serials[1]!)));
    expect(rows[0]!.line).toBe(o.lineIds[0]!);
    await expect(p.pack(p.dieB, [{ kg: 100 }], o.lineIds[0])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.pack(p.dieA, [{ kg: 100 }], closed.lineIds[0])).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.pack(p.dieA, [{ kg: 100 }], foreign.lineIds[0])).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, SLOW);

  test("race: a pack against a line whose order closes (or whose line is removed) meanwhile packs nothing", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }, { dieId: p.dieA, kg: 500 }]);
    const before = (await p.owner.stock.balance({ itemKind: "bundle" })).items.length;
    env.beforeNextBatch(() => closeOrder(p.owner, o.id));
    await expect(p.pack(p.dieA, [{ kg: 100 }], o.lineIds[0])).rejects.toMatchObject({ code: "CONFLICT" });
    await reopenOrder(env, o.id);
    env.beforeNextBatch(() =>
      // The order is confirmed, so the kept line stays complete (pieces and a tier, D11).
      saveOrder(p.owner, { id: o.id, lines: [{ id: o.lineIds[0]!, sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(1000), pcs: 1, tierRank: 1 }] }),
    );
    await expect(p.pack(p.dieA, [{ kg: 100 }], o.lineIds[1])).rejects.toMatchObject({ code: "CONFLICT" });
    const rows = await env.db.select({ id: bundle.id }).from(bundle).where(eq(bundle.companyId, p.companyId));
    expect(rows).toHaveLength(0);
    expect((await p.owner.stock.balance({ itemKind: "bundle" })).items.length).toBe(before);
    await expectLedgerConsistent(p);
  }, SLOW);

  test("openLines suggests the open lines of a section with baki, oldest first", async () => {
    const p = await plant();
    const a = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const b = await p.order([{ dieId: p.dieA, kg: 200 }], { customerId: p.otherCustomer });
    await p.order([{ dieId: p.dieB, kg: 300 }]);
    const done = await p.order([{ dieId: p.dieA, kg: 50 }]);
    const s = await p.pack(p.dieA, [{ kg: 50 }], done.lineIds[0]);
    await p.owner.dispatch.complete({ id: await p.held(s) });
    const lines = await p.as("packer").orders.openLines({ dieId: p.dieA });
    expect(lines.map((l) => l.lineId)).toEqual([a.lineIds[0]!, b.lineIds[0]!]);
    expect((await p.as("packer").orders.openLines({ dieId: p.dieA, customerId: p.otherCustomer })).map((l) => l.lineId)).toEqual([b.lineIds[0]!]);
    // Baki is filtered in SQL before the limit: the fully sent (still open) line never takes a slot.
    const { lineBalancePage } = await import("../src/lib/orders");
    const page = await lineBalancePage(env.db as never, p.companyId, { dieIds: [p.dieA], openOnly: true, withBaki: true }, { limit: 1 });
    expect(page.lines.map((l) => l.lineId)).toEqual([a.lineIds[0]!]);
    expect(page.nextOffset).toBe(1);
    const all = await lineBalancePage(env.db as never, p.companyId, { dieIds: [p.dieA], openOnly: true }, { limit: 1 });
    expect(all.lines.map((l) => l.orderId)).toEqual([a.id]);
  }, SLOW);
});

// ---------------------------------------------------------------------------
// Dispatch header
// ---------------------------------------------------------------------------

describe("dispatch header and invoice link", () => {
  test("the gate sets vehicle, driver and transporter; invoice fields need invoice.link", async () => {
    const p = await plant();
    const { id } = await p.as("packer").dispatch.create({ customerId: p.customerId });
    await p.as("packer").dispatch.update({ id, vehicleNo: " gj 05 ab 1234 ", driverName: "Ramesh", driverPhone: "+91 98250 11111", transporter: "Shree Logistics" });
    expect(await dispatchRow(id)).toMatchObject({ vehicleNo: "GJ05AB1234", driverName: "Ramesh", driverPhone: "+91 98250 11111", transporter: "Shree Logistics" });
    await expect(p.as("packer").dispatch.update({ id, invoiceNumber: "FC/1021" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("office").dispatch.update({ id, invoiceDate: "03-10-2026" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.as("office").dispatch.update({ id, invoiceNumber: "FC/1021", invoiceDate: "2026-10-03" });
    expect(await dispatchRow(id)).toMatchObject({ invoiceNumber: "FC/1021", invoiceDate: "2026-10-03" });
    // Clearing with null works; the other fields stay.
    await p.as("packer").dispatch.update({ id, transporter: null });
    expect(await dispatchRow(id)).toMatchObject({ transporter: null, vehicleNo: "GJ05AB1234" });
  }, SLOW);

  test("after completion the header can still be corrected and the PL header follows, with the same number", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const s = await p.pack(p.dieA, [{ kg: 100 }], o.lineIds[0]);
    const d = await p.held(s);
    const done = await p.owner.dispatch.complete({ id: d });
    await expect(p.as("packer").dispatch.update({ id: d, vehicleNo: "GJ05XY0001" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("supervisor").dispatch.update({ id: d, invoiceNumber: "X" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("office").dispatch.update({ id: d, notes: "late note" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.as("office").dispatch.update({ id: d, invoiceNumber: "FC/2042", invoiceDate: "2026-10-03" });
    await p.as("supervisor").dispatch.update({ id: d, vehicleNo: "GJ05XY0001" });
    const pl = (await plRow(d))!;
    expect(pl.code).toBe(done.plNumber);
    const snap = plSchema.parse(pl.snapshot);
    expect(snap.header).toMatchObject({ plNumber: done.plNumber, invoiceNumber: "FC/2042", invoiceDate: "2026-10-03", vehicleNo: "GJ05XY0001" });
    expect((await dispatchRow(d)).plNumber).toBe(done.plNumber);
  }, SLOW);

  test("a cancelled dispatch takes no header edits", async () => {
    const p = await plant();
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.cancel({ id });
    await expect(p.owner.dispatch.update({ id, vehicleNo: "GJ01" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);
});

// ---------------------------------------------------------------------------
// PL v2
// ---------------------------------------------------------------------------

describe("packing list v2: snapshot shape and number assigned once", () => {
  test("complete assigns the PL book number and stores a v2 snapshot with header, 11 columns and groups", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000, finish: "Anodise" }, { dieId: p.dieB, kg: 500 }], { poNumber: "PO-778" });
    const forA = await p.pack(p.dieA, [{ kg: 25.5, pcs: 10, mm: 3_658 }, { kg: 24.25, pcs: 10, mm: 3_658 }], o.lineIds[0]);
    const forB = await p.pack(p.dieB, [{ kg: 40, pcs: 8, mm: 4_877, po: "BUNDLE-PO" }], o.lineIds[1]);
    const loose = await p.pack(p.dieA, [{ kg: 30, pcs: 12, mm: 3_505, po: "OLD-PO-9" }]); // no line, kept unlinked below
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.update({ id, vehicleNo: "GJ05AB1234", driverName: "Ramesh", driverPhone: "9825011111", transporter: "Shree" });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials: [...forB, ...forA, ...loose] });
    const looseItem = (await itemsOf(id)).find((i) => i.serial === loose[0]);
    await p.owner.dispatch.linkItem({ itemId: looseItem!.id, salesOrderLineId: null });
    await p.owner.dispatch.reserve({ id });
    const done = await p.owner.dispatch.complete({ id });

    expect(done.plNumber).toBe("PL/2026-27/1");
    const row = await dispatchRow(id);
    expect(row.plNumber).toBe("PL/2026-27/1");
    const pl = (await plRow(id))!;
    expect(pl.code).toBe("PL/2026-27/1");
    expect(done.packingListId).toBe(pl.id);

    const snap = plSchema.parse(pl.snapshot);
    expect(snap.columns).toEqual(["sr", "bundleNo", "section", "item", "weightKg", "cutFt", "cutIn", "pcs", "kgPer12ft", "range12ft", "po"]);
    expect(snap.header).toEqual({
      plNumber: "PL/2026-27/1",
      date: "2026-10-03",
      dispatchCode: row.code,
      company: {
        name: expect.any(String),
        legalName: "Fourcubes Aluminium Pvt Ltd",
        gstin: "24AAACF1234A1Z5",
        address: "Plot 12, GIDC, Surat 394 230",
        phone: "+91 98250 00000",
      },
      billTo: { name: expect.any(String), gstin: "24ABCDE1234F1Z9", address: "Shed 4, Udhna, Surat, Gujarat, 394210" },
      shipTo: { name: "Site office", gstin: "24ABCDE1234F1Z9", address: "Ring Road, Vadodara" },
      vehicleNo: "GJ05AB1234",
      driverName: "Ramesh",
      driverPhone: "9825011111",
      transporter: "Shree",
      poNumbers: ["OLD-PO-9", "PO-778"],
      invoiceNumber: null,
      invoiceDate: null,
      shipDate: null,
    });
    // Groups: section A's order line, then section A's unlinked bundles, then section B.
    expect(snap.groups.map((g) => [g.sectionCode, g.orderNumber, g.lineNo, g.rows.length])).toEqual([
      [expect.stringMatching(/^1217/), o.number, 1, 2],
      [expect.stringMatching(/^1217/), null, null, 1],
      [expect.stringMatching(/^1288/), o.number, 2, 1],
    ]);
    expect(snap.groups[0]).toMatchObject({ item: "Domal (Anodise)", finish: "Anodise", poNumber: "PO-778", subtotal: { bundles: 2, pcs: 20, weightG: kg(49.75) } });
    const rows = snap.groups.flatMap((g) => g.rows);
    expect(rows.map((r) => r.sr)).toEqual([1, 2, 3, 4]);
    expect(rows[0]).toEqual({
      sr: 1,
      bundleNo: forA[0]!,
      section: snap.groups[0]!.sectionCode,
      item: "Domal (Anodise)",
      weightG: kg(25.5),
      cutFt: 12,
      cutIn: 0,
      pcs: 10,
      kgPer12ftMilli: 2_550,
      range12ft: 2.5,
      po: "PO-778",
    });
    expect(rows[2]).toMatchObject({ bundleNo: loose[0], item: "Domal", cutFt: 11, cutIn: 6, po: "OLD-PO-9" });
    // The order's PO wins over a bundle's own PO on linked bundles.
    expect(rows[3]).toMatchObject({ bundleNo: forB[0], item: "Slim", cutFt: 16, cutIn: 0, po: "PO-778", kgPer12ftMilli: 3_750, range12ft: 3.7 });
    expect(snap.summary).toEqual({ bundles: 4, pcs: 40, weightG: kg(119.75), text: "4 bundles · 119.750 kg" });
    // v1 keys are still there for older renderers.
    expect(snap.totals).toEqual({ totalBundles: 4, totalQuantity: 40, totalWeightKg: 119.75, totalLengthM: expect.any(Number) });
    expect(snap.items.map((i) => i.bundleSerial)).toEqual(rows.map((r) => r.bundleNo));

    // The next dispatch takes the next number.
    const s2 = await p.pack(p.dieA, [{ kg: 10 }], o.lineIds[0]);
    expect((await p.owner.dispatch.complete({ id: await p.held(s2) })).plNumber).toBe("PL/2026-27/2");
  }, SLOW);

  test("regenerate keeps the PL number; manual create reuses the dispatch's number", async () => {
    setClock(NOON);
    const p = await plant();
    const s = await p.pack(p.dieA, [{ kg: 10 }]);
    const d = await p.held(s);
    const done = await p.owner.dispatch.complete({ id: d });
    const first = (await plRow(d))!;
    const regen = await p.owner.packingList.regenerate({ id: first.id });
    expect(regen.code).toBe(done.plNumber);
    expect(regen.id).not.toBe(first.id);
    plSchema.parse(regen.snapshot);
    // FP-PK-13: regenerate keeps the sent revision (C24), so both rows are dropped for create().
    expect(regen.revision).toBe(2);
    await env.db.delete(packingList).where(eq(packingList.dispatchId, d));
    const again = await p.owner.packingList.create({ dispatchId: d });
    expect(again.code).toBe(done.plNumber);
    const series = await env.db.select().from(docSeries).where(and(eq(docSeries.companyId, p.companyId), eq(docSeries.docType, "pl")));
    expect(series[0]!.value).toBe(1);
  }, SLOW);

  test("@orrn/documents renders the v2 PL (html, xlsx) and still renders a v1 snapshot", async () => {
    setClock(NOON);
    // @orrn/documents is a client package (it imports this one); load it by path so this package's
    // type check does not pull its sources in.
    const docsPath = "../../documents/src/packing-list/index";
    const docs = (await import(docsPath)) as {
      isPlSnapshotV2(pl: never): boolean;
      buildPackingListHtml(pl: never, code: string): string;
      buildPackingListXlsxBuffer(pl: never, code: string): Uint8Array;
      plFileName(code: string): string;
      PL_COLUMN_HEADINGS: readonly string[];
    };
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000, finish: "Anodise" }], { poNumber: "PO-778" });
    const s = await p.pack(p.dieA, [{ kg: 25.5 }, { kg: 24.25 }], o.lineIds[0]);
    const d = await p.held(s);
    await p.owner.dispatch.update({ id: d, vehicleNo: "GJ05AB1234" });
    const done = await p.owner.dispatch.complete({ id: d });
    const snap = (await plRow(d))!.snapshot as never;
    expect(docs.isPlSnapshotV2(snap)).toBe(true);
    const html = docs.buildPackingListHtml(snap, done.plNumber);
    for (const text of [done.plNumber, "24AAACF1234A1Z5", "GJ05AB1234", "PO-778", "Range /12&#39;", "2 bundles · 49.750 kg", `${o.number} / 1`]) {
      expect(html.replace(/'/g, "&#39;")).toContain(text);
    }
    const printed = ["Sr", "Bundle no", "Section", "Item", "Weight kg", "Cut ft", "Cut in", "Pcs", "kg/12ft", "Range /12'", "PO"];
    expect([...docs.PL_COLUMN_HEADINGS]).toEqual(printed);
    for (const heading of printed) expect(html.replace(/&#39;/g, "'")).toContain(`>${heading}<`);
    const xlsx = docs.buildPackingListXlsxBuffer(snap, done.plNumber);
    expect(String.fromCharCode(xlsx[0]!, xlsx[1]!)).toBe("PK");
    expect(docs.plFileName(done.plNumber)).toBe("PL-2026-27-1");
    // A v1 snapshot (no version) still renders the old layout.
    const v1 = { ...(snap as Record<string, unknown>), version: undefined, header: undefined, groups: undefined, summary: undefined };
    expect(docs.isPlSnapshotV2(v1 as never)).toBe(false);
    expect(docs.buildPackingListHtml(v1 as never, "PL-000001")).toContain("PL-000001");
  }, SLOW);

  test("the company's PL book prefix and starting number are used", async () => {
    setClock(NOON);
    const p = await plant({ settings: { plSeries: { prefix: "FC/", start: 501 } } });
    const s = await p.pack(p.dieA, [{ kg: 10 }]);
    expect((await p.owner.dispatch.complete({ id: await p.held(s) })).plNumber).toBe("FC/2026-27/501");
  }, SLOW);
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe("tenant isolation", () => {
  test("another company's order, line and item ids are NOT_FOUND", async () => {
    const p = await plant();
    const other = await plant();
    const theirs = await other.order([{ dieId: other.dieA, kg: 100 }]);
    await expect(p.owner.orders.get({ id: theirs.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(saveOrder(p.owner, { id: theirs.id, poNumber: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const s = await other.pack(other.dieA, [{ kg: 10 }]);
    const { id } = await other.owner.dispatch.create({ customerId: other.customerId });
    await other.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials: s });
    const [item] = await itemsOf(id);
    await expect(p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await p.owner.orders.balance({ includeClosed: true })).lines).toEqual([]);
    expect((await p.owner.orders.list({})).items).toEqual([]);
    expect(await p.owner.orders.openLines({ dieId: other.dieA })).toEqual([]);
  }, SLOW);

  test("forged cross-company links add nothing to baki (every join is scoped)", async () => {
    const p = await plant();
    const other = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const lineId = o.lineIds[0]!;
    // Company B's bundle and completed dispatch item pointing at A's line (foreign keys don't check companies).
    const sb = await other.pack(other.dieA, [{ kg: 300 }]);
    const db = await other.held(sb, other.customerId);
    await other.owner.dispatch.complete({ id: db });
    await env.db.update(dispatchItem).set({ salesOrderLineId: lineId }).where(eq(dispatchItem.dispatchId, db));
    await env.db.update(bundle).set({ salesOrderLineId: lineId }).where(eq(bundle.companyId, other.companyId));
    const l = await p.lineOf(lineId);
    expect(l).toMatchObject({ producedG: 0, dispatchedG: 0, bakiG: kg(1000) });
    // And B's view of B's own data never shows A's line.
    expect((await other.owner.orders.balance({ includeClosed: true })).lines).toEqual([]);
  }, SLOW);
});

// ---------------------------------------------------------------------------
// Permission matrix
// ---------------------------------------------------------------------------

describe("permission matrix", () => {
  const holders = (action: Action) => ROLES.filter((r) => can({ company: { role: r }, isPlatformAdmin: false }, action));

  test("orders.create / update need order.manage (owner, office, manager); reads are open to members", async () => {
    expect(holders("order.manage").sort()).toEqual(["manager", "office", "owner"]);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    for (const role of ROLES) {
      const api = p.as(role);
      const ok = holders("order.manage").includes(role);
      // Each call is awaited as soon as it starts (a rejected promise left waiting is an unhandled error).
      const create = () => api.orders.create({ customerId: p.customerId, lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(1) }] });
      const update = () => saveOrder(api, { id: o.id, note: role });
      if (ok) {
        await expect(create()).resolves.toBeTruthy();
        await expect(update()).resolves.toBeTruthy();
      } else {
        await expect(create()).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(update()).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      await expect(api.orders.get({ id: o.id })).resolves.toBeTruthy();
      await expect(api.orders.balance({})).resolves.toBeTruthy();
      await expect(api.orders.list({})).resolves.toBeTruthy();
    }
    await expect(env.caller(null).orders.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  }, SLOW);

  test("linkItem needs dispatch.scan; invoice fields need invoice.link", async () => {
    // Literal pins (digest §4.2), so a change to the matrix fails here and not only in can().
    expect(holders("dispatch.scan").sort()).toEqual(["admin", "manager", "office", "operator", "owner", "packer", "supervisor"]);
    expect(holders("invoice.link").sort()).toEqual(["manager", "office", "owner"]);
    expect(holders("dispatch.complete").sort()).toEqual(["admin", "manager", "office", "owner", "supervisor"]);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 10 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    const [item] = await itemsOf(id);
    for (const role of ROLES) {
      const api = p.as(role);
      const link = api.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: o.lineIds[0]! });
      if (holders("dispatch.scan").includes(role)) await expect(link).resolves.toBeTruthy();
      else await expect(link).rejects.toMatchObject({ code: "FORBIDDEN" });
      const inv = api.dispatch.update({ id, invoiceNumber: `INV-${role}` });
      const canUpdate = holders("dispatch.update").includes(role);
      if (canUpdate && holders("invoice.link").includes(role)) await expect(inv).resolves.toBeTruthy();
      else await expect(inv).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  }, SLOW);

  test("salesRegisterCsv needs reports.read or export.accounts", async () => {
    const p = await plant();
    for (const role of ROLES) {
      const call = p.as(role).reports.salesRegisterCsv({ month: "2026-10" });
      const ok = holders("reports.read").includes(role) || holders("export.accounts").includes(role);
      if (ok) await expect(call).resolves.toBeTruthy();
      else await expect(call).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  }, SLOW);
});

// ---------------------------------------------------------------------------
// D1 limits and ledger invariant
// ---------------------------------------------------------------------------

describe("120-bundle dispatch against order lines (D1 limit, ledger)", () => {
  test("add, reserve and complete 120 linked bundles with ≤ 100 params per statement; ledger = projection", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 2000 }, { dieId: p.dieA, kg: 2000 }]);
    const serials = [
      ...(await p.pack(p.dieA, Array.from({ length: 60 }, () => ({ kg: 25 })), o.lineIds[0])),
      ...(await p.pack(p.dieA, Array.from({ length: 60 }, () => ({ kg: 25 })))),
    ];
    env.resetPeakParams();
    const d = await p.held(serials);
    const items = await itemsOf(d);
    expect(items.filter((i) => i.lineId === o.lineIds[0]).length).toBeGreaterThanOrEqual(60);
    expect(items.every((i) => i.lineId !== null)).toBe(true);
    const done = await p.owner.dispatch.complete({ id: d });
    expect(env.peakParams()).toBeLessThanOrEqual(100);
    expect(done.plNumber).toBe("PL/2026-27/1");
    expect(await ledgerOf(p.companyId, d)).toHaveLength(120);
    const snap = plSchema.parse((await plRow(d))!.snapshot);
    expect(snap.summary).toMatchObject({ bundles: 120, weightG: kg(3000) });
    const total = (await p.owner.orders.balance({})).totals;
    expect(total).toMatchObject({ orderedG: kg(4000), dispatchedG: kg(3000), bakiG: kg(1000) });
    await expectLedgerConsistent(p);
  }, SLOW);
});

// ---------------------------------------------------------------------------
// Sales register CSV
// ---------------------------------------------------------------------------

describe("monthly sales register CSV (for Tally)", () => {
  test("one row per completed dispatch in the company month, escaped, tenant-scoped", async () => {
    const p = await plant();
    const other = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }], { poNumber: "PO-1" });
    await env.db.update(customer).set({ name: '=HYPERLINK("x"), "Quoted" Co' }).where(eq(customer.id, p.customerId));

    setClock(ist("2026-09-30T23:30:00"));
    const s1 = await p.pack(p.dieA, [{ kg: 100, pcs: 5 }], o.lineIds[0]);
    const d1 = await p.held(s1);
    await p.owner.dispatch.complete({ id: d1 });

    setClock(ist("2026-10-01T00:10:00"));
    const s2 = await p.pack(p.dieA, [{ kg: 250.5, pcs: 10 }, { kg: 49.5, pcs: 4 }], o.lineIds[0]);
    const d2 = await p.held(s2);
    await p.owner.dispatch.update({ id: d2, vehicleNo: "GJ05AB1234", transporter: "Shree" });
    const done2 = await p.owner.dispatch.complete({ id: d2 });
    await p.owner.dispatch.update({ id: d2, invoiceNumber: "FC/77", invoiceDate: "2026-10-01" });
    // Not completed / other company: never in the register.
    const s3 = await p.pack(p.dieA, [{ kg: 5 }]);
    await p.held(s3);
    const so = await other.pack(other.dieA, [{ kg: 5 }]);
    await other.owner.dispatch.complete({ id: await other.held(so, other.customerId) });

    const oct = await p.as("accountant").reports.salesRegisterCsv({ month: "2026-10" });
    expect(oct.filename).toBe("sales-register-2026-10.csv");
    expect(oct.rows).toBe(1);
    const lines = oct.csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("Date,PL no,Invoice no,Invoice date,Customer,GSTIN,Vehicle,Transporter,Bundles,Pcs,Kg,PO numbers,Dispatch");
    expect(lines[1]).toBe(
      `2026-10-01,${done2.plNumber},FC/77,2026-10-01,"'=HYPERLINK(""x""), ""Quoted"" Co",24ABCDE1234F1Z9,GJ05AB1234,Shree,2,14,300.000,PO-1,${(await dispatchRow(d2)).code}`,
    );
    const sep = await p.owner.reports.salesRegisterCsv({ month: "2026-09" });
    expect(sep.rows).toBe(1);
    expect(sep.csv).toContain("2026-09-30,");
    await expect(p.owner.reports.salesRegisterCsv({ month: "2026-13" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);
});

// ---------------------------------------------------------------------------
// Analytics hook
// ---------------------------------------------------------------------------

describe("analytics customerSummary.openOrders", () => {
  test("filled from open order lines once the customer has any", async () => {
    setClock(NOON);
    const p = await plant();
    const none = await p.owner.analytics.customerSummary({ customerId: p.customerId, from: "2026-09-01", to: "2026-10-03" });
    expect(none.openOrders).toBeNull();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }, { dieId: p.dieB, kg: 200 }]);
    const s = await p.pack(p.dieA, [{ kg: 300 }], o.lineIds[0]);
    await p.owner.dispatch.complete({ id: await p.held(s) });
    const sum = await p.owner.analytics.customerSummary({ customerId: p.customerId, from: "2026-09-01", to: "2026-10-03" });
    expect(sum.openOrders).toEqual({ orderedG: kg(1200), dispatchedG: kg(300), bakiG: kg(900), lines: 2 });
  }, SLOW);
});
