/**
 * PL-8 tests r0 (reviews/PL8-tests-r0.md): guards the original suite left unpinned. Each bracketed id
 * in a title is a mutant of reviews/PL8-tests-r0-mutants.py that plant-sales.test.ts left alive and
 * the test kills. Installed from reviews/PL8-tests-r0-proposed-gaps.test.ts in fix round 1 and adapted
 * to the fixes ([D36 D37 O24 O30] follows the amended suggestion rule; [D15] pins "same figures,
 * request untouched"). Slow lane: about 90 tests, each seeds its own plant.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, setDefaultTimeout } from "bun:test";

import { approval, auditLog, bundle, company, customer, die, dispatch, dispatchItem, packingList, packingListLine, salesOrder, salesOrderLine } from "@orrn/db/schema";
import { and, asc, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { ist, kg, NOON, salesHelpers, SLOW, type SalesPlant as Plant, saveOrder, cancelOrder, closeOrder, confirmOrder } from "./sales-fixture";

// Heavy Miniflare D1 cases: the 5 s default flakes when other gates share the machine.
setDefaultTimeout(30_000);

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

const { plant, itemsOf, dispatchRow, plRow, pendingOverdraw } = salesHelpers(() => env);

/** @orrn/documents is a client package (it imports this one): load it by path, outside this package's type check. */
const DOCS_PATH = "../../documents/src/packing-list/index";

// ===========================================================================
// Reviewer additions (PL8 tests r0). Each bracketed id is a mutant of PL8-tests-r0-mutants.py that
// plant-sales.test.ts leaves alive and the test below kills.
// ===========================================================================

async function approvalRows(companyId: string) {
  return env.db.select().from(approval).where(eq(approval.companyId, companyId));
}

async function auditActions(companyId: string) {
  return env.db.select().from(auditLog).where(eq(auditLog.companyId, companyId));
}

async function orderStatus(p: Plant, id: string) {
  return (await p.owner.orders.get({ id })).order.status;
}

describe("complete: effects stay inside this dispatch", () => {
  test("[D08 D09 D10] an approved override stays approved; other dispatches' pending requests (and other kinds on the subject) are untouched", async () => {
    const p = await plant();
    const o1 = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const o2 = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const x = await p.held(await p.pack(p.dieA, [{ kg: 80 }, { kg: 80 }], o1.lineIds[0]));
    const y = await p.held(await p.pack(p.dieA, [{ kg: 80 }, { kg: 80 }], o2.lineIds[0]));
    await expect(p.owner.dispatch.complete({ id: x })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(p.owner.dispatch.complete({ id: y })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    // Another approval kind that happens to point at dispatch x must not be swept up either.
    await env.db.insert(approval).values({
      id: crypto.randomUUID(),
      companyId: p.companyId,
      kind: "phantom_void",
      subjectId: x,
      status: "pending",
      meta: {},
    });
    const [reqX] = await pendingOverdraw(p.companyId, x);
    await p.as("manager").approval.decide({ id: reqX!.id, decision: "approved" });
    await p.owner.dispatch.complete({ id: x });
    const rows = await approvalRows(p.companyId);
    const byKey = (kind: string, subject: string) => rows.filter((r) => r.kind === kind && r.subjectId === subject);
    expect(byKey("dispatch_overdraw", x)).toEqual([expect.objectContaining({ status: "approved", note: null })]);
    expect(byKey("dispatch_overdraw", x)[0]!.decidedBy).not.toBeNull();
    expect(byKey("dispatch_overdraw", y)).toEqual([expect.objectContaining({ status: "pending" })]);
    expect(byKey("phantom_void", x)).toEqual([expect.objectContaining({ status: "pending" })]);
    // Cancelling y later withdraws only y's request.
    await p.owner.dispatch.cancel({ id: y });
    expect(byKey("dispatch_overdraw", x)[0]!.status).toBe("approved");
    expect((await approvalRows(p.companyId)).find((r) => r.kind === "dispatch_overdraw" && r.subjectId === y)!.status).toBe("rejected");
  }, SLOW);

  test("[D05 D06] only the orders a dispatch fulfils move to dispatching; an order closed meanwhile stays closed", async () => {
    const p = await plant();
    const fulfilled = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const bystander = await p.order([{ dieId: p.dieB, kg: 1000 }], { status: "confirmed" });
    const bookedOther = await p.order([{ dieId: p.dieA, kg: 1000 }], { customerId: p.otherCustomer });
    const closedMeanwhile = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    // Packed for the first order's line; the second order's line is linked by hand, then that order is closed.
    const s = await p.pack(p.dieA, [{ kg: 100 }, { kg: 100 }], fulfilled.lineIds[0]);
    const d = await p.held(s);
    const items = await itemsOf(d);
    await p.owner.dispatch.linkItem({ itemId: items[1]!.id, salesOrderLineId: closedMeanwhile.lineIds[0]! });
    await closeOrder(p.owner, closedMeanwhile.id);
    await p.owner.dispatch.complete({ id: d });
    expect(await orderStatus(p, fulfilled.id)).toBe("dispatching");
    expect(await orderStatus(p, closedMeanwhile.id)).toBe("closed");
    expect(await orderStatus(p, bystander.id)).toBe("confirmed");
    expect(await orderStatus(p, bookedOther.id)).toBe("booking");
  }, SLOW);

  test("[D25] a header correction after completion patches only that dispatch's packing list", async () => {
    setClock(NOON);
    const p = await plant();
    const d1 = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    const d2 = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    await p.owner.dispatch.complete({ id: d1 });
    await p.owner.dispatch.complete({ id: d2 });
    await p.owner.dispatch.update({ id: d1, vehicleNo: "GJ01AA0001", invoiceNumber: "INV-1", invoiceDate: "2026-10-03" });
    const h1 = plSchema.parse((await plRow(d1))!.snapshot).header;
    const h2 = plSchema.parse((await plRow(d2))!.snapshot).header;
    expect(h1).toMatchObject({ vehicleNo: "GJ01AA0001", invoiceNumber: "INV-1", invoiceDate: "2026-10-03" });
    expect(h2).toMatchObject({ vehicleNo: null, invoiceNumber: null, invoiceDate: null });
  }, SLOW);
});

describe("Review Focus 5: write-time overdraw guard", () => {
  test("[G07] a merely reserved sibling dispatch does not block the first completion; the second one is refused", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const a = await p.held(await p.pack(p.dieA, [{ kg: 600 }], o.lineIds[0]));
    const b = await p.held(await p.pack(p.dieA, [{ kg: 500 }], o.lineIds[0]));
    await p.owner.dispatch.complete({ id: a });
    expect((await dispatchRow(a)).status).toBe("completed");
    await expect(p.owner.dispatch.complete({ id: b })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await dispatchRow(b)).status).toBe("reserved");
  }, SLOW);

  test("[G02] an approved over-dispatch on one line never blocks a dispatch on another line", async () => {
    const p = await plant();
    const o1 = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const x = await p.held(await p.pack(p.dieA, [{ kg: 80 }, { kg: 80 }], o1.lineIds[0]));
    await expect(p.owner.dispatch.complete({ id: x })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [req] = await pendingOverdraw(p.companyId, x);
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    await p.owner.dispatch.complete({ id: x });
    const o2 = await p.order([{ dieId: p.dieB, kg: 1000 }]);
    const y = await p.held(await p.pack(p.dieB, [{ kg: 10 }], o2.lineIds[0]));
    await p.owner.dispatch.complete({ id: y });
    expect((await dispatchRow(y)).status).toBe("completed");
  }, SLOW);

  test("[G03] a pending (undecided) request does not let a late link slip an overdraw through", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const lineId = o.lineIds[0]!;
    const d = await p.held(await p.pack(p.dieA, [{ kg: 500 }, { kg: 551 }], lineId));
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await pendingOverdraw(p.companyId, d)).toHaveLength(1);
    const items = await itemsOf(d); // serial order = pack order: [500 kg, 551 kg]
    const big = items[1]!;
    await p.owner.dispatch.linkItem({ itemId: big.id, salesOrderLineId: null });
    env.beforeNextBatch(() => p.owner.dispatch.linkItem({ itemId: big.id, salesOrderLineId: lineId }));
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await dispatchRow(d)).status).toBe("reserved");
    expect(await plRow(d)).toBeNull();
  }, SLOW);

  test("[G04] an approved request covers only the total it names, also at write time", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const lineId = o.lineIds[0]!;
    // Links are set by hand so the test does not depend on what the scan suggests: 500 + 551 kg on the line, 600 kg unlinked.
    const serials = await p.pack(p.dieA, [{ kg: 500 }, { kg: 551 }, { kg: 600 }]);
    const d = await p.held(serials);
    const items = await itemsOf(d);
    const [first, biggest, unlinked] = items as [(typeof items)[number], (typeof items)[number], (typeof items)[number]];
    await p.owner.dispatch.linkItem({ itemId: first.id, salesOrderLineId: lineId });
    await p.owner.dispatch.linkItem({ itemId: biggest.id, salesOrderLineId: lineId });
    await p.owner.dispatch.linkItem({ itemId: unlinked.id, salesOrderLineId: null });
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [req] = await pendingOverdraw(p.companyId, d);
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    // Take the bigger bundle off the line again (500 kg: within the limit), then link the 600 kg one just
    // after complete read the dispatch: 1100 kg is more than the 1051 kg that was approved.
    await p.owner.dispatch.linkItem({ itemId: biggest.id, salesOrderLineId: null });
    env.beforeNextBatch(() => p.owner.dispatch.linkItem({ itemId: unlinked.id, salesOrderLineId: lineId }));
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await dispatchRow(d)).status).toBe("reserved");
  }, SLOW);

  test("[O05] the limit rounds down to the gram, in the JS check and in SQL alike", async () => {
    const p = await plant();
    const o = await p.owner.orders.create({
      customerId: p.customerId,
      lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: 1_001 }], // 5 % of 1001 g = 50.05 g -> limit 1051 g
    });
    const lineId = (await p.owner.orders.get({ id: o.id })).lines[0]!.lineId;
    const over = await p.held(await p.pack(p.dieA, [{ kg: 1.052 }], lineId));
    await expect(p.owner.dispatch.complete({ id: over })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [req] = await pendingOverdraw(p.companyId, over);
    expect(req!.meta).toMatchObject({ lines: [{ limitG: 1_051, totalG: 1_052, overG: 1 }] });
    const exact = await p.held(await p.pack(p.dieA, [{ kg: 1.051 }], lineId));
    await p.owner.dispatch.complete({ id: exact });
    expect((await dispatchRow(exact)).status).toBe("completed");
  }, SLOW);

  // D15 / D16 were mutants of the in-place refresh of a pending request, which fix round 1 replaced
  // (a pending request is never rewritten: same figures leave it alone, new figures withdraw it and open
  // a new one). [D16] holds under both designs; [D15] now pins "same figures, request untouched".
  test("[D16] asking again shows the current figures in exactly one pending request", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 600 }, { kg: 600 }, { kg: 100 }], o.lineIds[0]);
    const d = await p.held(serials.slice(0, 2));
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id: d, serials: [serials[2]!] });
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const pending = await pendingOverdraw(p.companyId, d);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.meta).toMatchObject({ lines: [{ totalG: kg(1300), overG: kg(250) }] });
  }, SLOW);

  test("[D15] asking again with the same figures leaves the open request untouched (id, requester, note)", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const d = await p.held(await p.pack(p.dieA, [{ kg: 600 }, { kg: 600 }], o.lineIds[0]));
    await expect(p.as("office").dispatch.complete({ id: d, overdrawNote: "Customer wants both" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [first] = await pendingOverdraw(p.companyId, d);
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const pending = await pendingOverdraw(p.companyId, d);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: first!.id, requestedBy: first!.requestedBy, requestNote: "Customer wants both", serverSeq: first!.serverSeq });
  }, SLOW);
});

describe("scan suggestion and links, single-scan path", () => {
  test("[D36 D37 O24 O30] the gate's one-at-a-time scan links each bundle and counts what is already on this dispatch", async () => {
    const p = await plant();
    const first = await p.order([{ dieId: p.dieA, kg: 150 }]);
    const second = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const [l1, l2] = [first.lineIds[0]!, second.lineIds[0]!];
    const serials = await p.pack(p.dieA, [{ kg: 100 }, { kg: 100 }, { kg: 100 }]);
    const ids = await env.db
      .select({ id: bundle.id, serial: bundle.serial })
      .from(bundle)
      .where(eq(bundle.companyId, p.companyId))
      .orderBy(asc(bundle.serial));
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const r1 = await p.owner.dispatch.addBundle({ allowUnassigned: true,  id, bundleId: ids[0]!.id });
    expect(r1.linked).toEqual([{ serial: serials[0]!, salesOrderLineId: l1, orderNumber: first.number, lineNo: 1 }]);
    const r2 = await p.owner.dispatch.addBundle({ allowUnassigned: true,  id, bundleId: ids[1]!.id });
    expect(r2.linked.map((l) => l.salesOrderLineId)).toEqual([l1]); // 50 kg of the first order's baki left: still linked
    const r3 = await p.owner.dispatch.addBundle({ allowUnassigned: true,  id, bundleId: ids[2]!.id });
    expect(r3.linked.map((l) => l.salesOrderLineId)).toEqual([l2]); // 100 + 100 already here use up the first order
    expect((await itemsOf(id)).map((i) => i.lineId)).toEqual([l1, l1, l2]);
    // A second dispatch does not see the first one's draft items as pending: its scan is judged on its own.
    const other = await p.owner.dispatch.create({ customerId: p.customerId });
    const extra = await p.pack(p.dieA, [{ kg: 10 }]);
    const [eb] = await env.db.select({ id: bundle.id }).from(bundle).where(and(eq(bundle.companyId, p.companyId), eq(bundle.serial, extra[0]!)));
    expect((await p.owner.dispatch.addBundle({ allowUnassigned: true,  id: other.id, bundleId: eb!.id })).linked.map((l) => l.salesOrderLineId)).toEqual([l1]);
  }, SLOW);

  test("[O28 O29] older closed, other-customer and other-section lines are never picked", async () => {
    const p = await plant();
    const closed = await p.order([{ dieId: p.dieA, kg: 500 }]);
    await closeOrder(p.owner, closed.id);
    const theirs = await p.order([{ dieId: p.dieA, kg: 500 }], { customerId: p.otherCustomer });
    const otherSection = await p.order([{ dieId: p.dieB, kg: 500 }]);
    const target = await p.order([{ dieId: p.dieA, kg: 500 }]);
    const serials = await p.pack(p.dieA, [{ kg: 50 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const report = await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    expect(report.linked).toEqual([{ serial: serials[0]!, salesOrderLineId: target.lineIds[0]!, orderNumber: target.number, lineNo: 1 }]);
    expect([closed, theirs, otherSection].map((o) => o.lineIds[0])).not.toContain(report.linked[0]!.salesOrderLineId);
  }, SLOW);

  test("[R43 R44 Z20 Z21 D49 D48 D50] orders, links and refusals leave audit rows", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    await saveOrder(p.owner, { id: o.id, poNumber: "PO-1" });
    const d = await p.held(await p.pack(p.dieA, [{ kg: 80 }, { kg: 80 }], o.lineIds[0]));
    const [item] = await itemsOf(d);
    await p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null });
    await p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: o.lineIds[0]! });
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [req] = await pendingOverdraw(p.companyId, d);
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    const done = await p.owner.dispatch.complete({ id: d });
    const rows = await auditActions(p.companyId);
    const named = (a: string) => rows.filter((r) => r.action === a);
    expect(named("order.create")).toHaveLength(1);
    expect(named("order.update")).toHaveLength(1);
    expect(named("dispatch.linkItem")).toHaveLength(2);
    expect(named("dispatch.overdraw.request")).toHaveLength(1);
    expect(named("dispatch.complete")[0]!.meta).toMatchObject({ plNumber: done.plNumber });
  }, SLOW);
});

describe("orders.update: tenant isolation and write-time guards", () => {
  test("[R19] another company's section on a changed or added line is NOT_FOUND", async () => {
    const p = await plant();
    const other = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const line = { sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(100) };
    await expect(
      saveOrder(p.owner, { id: o.id, lines: [{ id: o.lineIds[0]!, ...line, sectionId: other.dieA }] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      saveOrder(p.owner, { id: o.id, lines: [{ id: o.lineIds[0]!, ...line }, { ...line, sectionId: other.dieA }] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const got = await p.owner.orders.get({ id: o.id });
    expect(got.lines.map((l) => l.sectionId)).toEqual([p.dieA]);
  }, SLOW);

  test("[R15 R16] an unknown (or another company's) line id is NOT_FOUND; a line listed twice is refused", async () => {
    const p = await plant();
    const other = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const theirs = await other.order([{ dieId: other.dieA, kg: 100 }]);
    const line = { sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(100) };
    await expect(saveOrder(p.owner, { id: o.id, lines: [{ id: theirs.lineIds[0]!, ...line }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(saveOrder(p.owner, { id: o.id, lines: [{ id: "nope", ...line }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      saveOrder(p.owner, { id: o.id, lines: [{ id: o.lineIds[0]!, ...line }, { id: o.lineIds[0]!, ...line }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await other.owner.orders.get({ id: theirs.id })).lines[0]!.orderedG).toBe(kg(100));
  }, SLOW);

  test("[R21] a removed line's number is not reused by a later edit", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }, { dieId: p.dieB, kg: 100 }]);
    const [l1, l2] = o.lineIds as [string, string];
    const keep = [
      { id: l1, sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(100) },
      { id: l2, sectionId: p.dieB, cutLengthMm: 3_658, kgG: kg(100) },
    ];
    await saveOrder(p.owner, { id: o.id, lines: [...keep, { sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(5) }] });
    const three = (await p.owner.orders.get({ id: o.id })).lines.find((l) => l.lineNo === 3)!;
    await saveOrder(p.owner, { id: o.id, lines: keep }); // line 3 goes
    await saveOrder(p.owner, { id: o.id, lines: [...keep, { sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(7) }] });
    const lines = (await p.owner.orders.get({ id: o.id })).lines;
    expect(lines.map((l) => l.lineNo)).toEqual([1, 2, 4]);
    expect(lines.find((l) => l.lineId === three.lineId)).toBeUndefined();
  }, SLOW);

  test("[R11 R12] an order cannot be cancelled while a live dispatch carries its lines (read and write time)", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }], o.lineIds[0]));
    await expect(cancelOrder(p.owner, o.id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await orderStatus(p, o.id)).toBe("booking");
    // Once the dispatch is cancelled the order may be cancelled.
    await p.owner.dispatch.cancel({ id: d });
    // Write time: a bundle gets linked after the cancel read the order.
    const o2 = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const s = await p.pack(p.dieA, [{ kg: 10 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials: s });
    const [item] = await itemsOf(id);
    await p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null });
    env.beforeNextBatch(() => p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: o2.lineIds[0]! }));
    await expect(cancelOrder(p.owner, o2.id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await orderStatus(p, o2.id)).toBe("booking");
  }, SLOW);

  test("[R42] a line carrying only a dispatch item (bundle packed for nothing) cannot be removed, change section or change customer", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }, { dieId: p.dieB, kg: 500 }]);
    const s = await p.pack(p.dieA, [{ kg: 10 }]); // packed for no line
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const report = await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials: s });
    expect(report.linked[0]!.salesOrderLineId).toBe(o.lineIds[0]!);
    const [l1, l2] = o.lineIds as [string, string];
    await expect(
      saveOrder(p.owner, { id: o.id, lines: [{ id: l2, sectionId: p.dieB, cutLengthMm: 3_658, kgG: kg(500) }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      saveOrder(p.owner, { id: o.id, lines: [{ id: l1, sectionId: p.dieB, cutLengthMm: 3_658, kgG: kg(1000) }, { id: l2, sectionId: p.dieB, cutLengthMm: 3_658, kgG: kg(500) }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(saveOrder(p.owner, { id: o.id, customerId: p.otherCustomer })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await p.owner.orders.get({ id: o.id })).lines).toHaveLength(2);
  }, SLOW);

  test("[R23 R24] a removal that loses to a pack against the line fails the whole edit", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }, { dieId: p.dieA, kg: 500 }]);
    const [l1, l2] = o.lineIds as [string, string];
    env.beforeNextBatch(() => p.pack(p.dieA, [{ kg: 100 }], l2));
    await expect(
      saveOrder(p.owner, { id: o.id, note: "trim", lines: [{ id: l1, sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(1000) }] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const got = await p.owner.orders.get({ id: o.id });
    expect(got.order.note).toBeNull();
    expect(got.lines.map((l) => l.lineId)).toEqual([l1, l2]);
    expect(got.lines[1]!.producedG).toBe(kg(100));
  }, SLOW);

  test("[R25 R26] a section change that loses to a pack against the line fails the whole edit", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const [l1] = o.lineIds as [string];
    env.beforeNextBatch(() => p.pack(p.dieA, [{ kg: 100 }], l1));
    await expect(
      saveOrder(p.owner, { id: o.id, lines: [{ id: l1, sectionId: p.dieB, cutLengthMm: 3_658, kgG: kg(1000) }] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await p.owner.orders.get({ id: o.id })).lines[0]!.sectionId).toBe(p.dieA);
  }, SLOW);
});

describe("orders.create: dates and retired master data", () => {
  test("[R07] the default order date is the company's calendar day (00:10 IST is still the new day)", async () => {
    setClock(ist("2026-10-01T00:10:00"));
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    expect((await p.owner.orders.get({ id: o.id })).order.orderDate).toBe("2026-10-01");
  }, SLOW);

  test("[R03 R05] a retired customer or section is NOT_FOUND", async () => {
    const p = await plant();
    const line = { sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(100) };
    await env.db.update(customer).set({ deletedAt: new Date() }).where(eq(customer.id, p.otherCustomer));
    await expect(p.owner.orders.create({ customerId: p.otherCustomer, lines: [line] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await env.db.update(die).set({ deletedAt: new Date() }).where(eq(die.id, p.dieB));
    await expect(p.owner.orders.create({ customerId: p.customerId, lines: [{ ...line, sectionId: p.dieB }] })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, SLOW);

  test("[O19 E40] open lines and the balance come oldest ORDER DATE first, not oldest entered first", async () => {
    const p = await plant();
    const late = await p.owner.orders.create({ customerId: p.customerId, orderDate: "2026-10-03", lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(100) }] });
    const early = await p.owner.orders.create({ customerId: p.customerId, orderDate: "2026-09-01", lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(100) }] });
    // openLines asks by section (the chunked path re-sorts in JS); balance asks for everything (ordered by the SQL itself).
    const lines = await p.owner.orders.openLines({ dieId: p.dieA });
    expect(lines.map((l) => l.orderId)).toEqual([early.id, late.id]);
    expect((await p.owner.orders.balance({})).lines.map((l) => l.orderId)).toEqual([early.id, late.id]);
    // and the scan suggests the early one
    const serials = await p.pack(p.dieA, [{ kg: 10 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const report = await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    expect(report.linked[0]!.orderNumber).toBe(early.number);
  }, SLOW);
});

describe("orders reads: list, balance and openLines", () => {
  test("[R28 R30 R31 R32] list: openOnly, search, paging with total and nextOffset", async () => {
    const p = await plant();
    const a = await p.order([{ dieId: p.dieA, kg: 10 }], { poNumber: "ALPHA-1" });
    const b = await p.order([{ dieId: p.dieA, kg: 10 }], { poNumber: "BETA-2" });
    const c = await p.order([{ dieId: p.dieA, kg: 10 }], { poNumber: "GAMMA-3" });
    await closeOrder(p.owner, c.id);
    expect((await p.owner.orders.list({ openOnly: true })).items.map((o) => o.id)).toEqual([b.id, a.id]);
    expect((await p.owner.orders.list({ search: "ALPHA" })).items.map((o) => o.id)).toEqual([a.id]);
    expect((await p.owner.orders.list({ search: b.number })).items.map((o) => o.id)).toEqual([b.id]);
    expect((await p.owner.orders.list({ search: "nothing-like-this" })).total).toBe(0);
    const first = await p.owner.orders.list({ limit: 2, offset: 0 });
    expect(first.items.map((o) => o.id)).toEqual([c.id, b.id]);
    expect(first).toMatchObject({ total: 3, nextOffset: 2 });
    const second = await p.owner.orders.list({ limit: 2, offset: 2 });
    expect(second.items.map((o) => o.id)).toEqual([a.id]);
    expect(second).toMatchObject({ total: 3, nextOffset: null });
  }, SLOW);

  test("[R35 R37 R36] cancelled orders never show baki; closed and cancelled lines are not offered; balance can be asked per order", async () => {
    const p = await plant();
    const open = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const cancelled = await p.order([{ dieId: p.dieA, kg: 70 }]);
    await cancelOrder(p.owner, cancelled.id);
    const closed = await p.order([{ dieId: p.dieA, kg: 30 }]);
    await closeOrder(p.owner, closed.id);
    expect((await p.owner.orders.balance({})).lines.map((l) => l.orderId)).toEqual([open.id]);
    expect(new Set((await p.owner.orders.balance({ includeClosed: true })).lines.map((l) => l.orderId))).toEqual(new Set([open.id, closed.id]));
    expect((await p.owner.orders.openLines({ dieId: p.dieA })).map((l) => l.orderId)).toEqual([open.id]);
    expect((await p.owner.orders.openLines({})).map((l) => l.orderId)).toEqual([open.id]);
    expect((await p.owner.orders.balance({ includeClosed: true, orderId: closed.id })).lines.map((l) => l.orderId)).toEqual([closed.id]);
  }, SLOW);

  test("[A01 A02] analytics openOrders counts this customer's open orders only", async () => {
    setClock(NOON);
    const p = await plant();
    await p.order([{ dieId: p.dieA, kg: 1000 }]);
    await p.order([{ dieId: p.dieA, kg: 500 }], { customerId: p.otherCustomer });
    const closed = await p.order([{ dieId: p.dieA, kg: 300 }]);
    await closeOrder(p.owner, closed.id);
    const sum = await p.owner.analytics.customerSummary({ customerId: p.customerId, from: "2026-09-01", to: "2026-10-03" });
    expect(sum.openOrders).toEqual({ orderedG: kg(1000), dispatchedG: 0, bakiG: kg(1000), lines: 1 });
  }, SLOW);
});

describe("linkItem and dispatch.update write-time guards", () => {
  test("[D32] a link that loses to completion is refused, not written onto a completed dispatch", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    const [item] = await itemsOf(d);
    await p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null });
    env.beforeNextBatch(() => p.owner.dispatch.complete({ id: d }));
    await expect(p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: o.lineIds[0]! })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await dispatchRow(d)).status).toBe("completed");
    expect((await itemsOf(d))[0]!.lineId).toBeNull();
    expect((await p.lineOf(o.lineIds[0]!)).dispatchedG).toBe(0);
  }, SLOW);

  test("[D21] changing the customer of a dispatch with linked items says why", async () => {
    const p = await plant();
    await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials: await p.pack(p.dieA, [{ kg: 10 }]) });
    expect((await itemsOf(id))[0]!.lineId).not.toBeNull();
    await expect(p.owner.dispatch.update({ id, customerId: p.otherCustomer })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/linked/i),
    });
  }, SLOW);

  test("[D45] getDispatch reports overdraw state only while the dispatch can still change", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }], o.lineIds[0]));
    expect((await p.owner.dispatch.getDispatch({ id: d })).overdraw).not.toBeNull();
    await p.owner.dispatch.complete({ id: d });
    expect((await p.owner.dispatch.getDispatch({ id: d })).overdraw).toBeNull();
  }, SLOW);
});

describe("customer tolerance and company settings (the way the owner sets them)", () => {
  test("[C01 C02] kgToleranceBp is stored on create, kept by an unrelated edit, and null returns to the company default", async () => {
    const p = await plant();
    const made = await p.owner.customer.create({ name: "Tolerant Metals", kgToleranceBp: 300 });
    const id = (made as { id: string }).id;
    expect((await p.owner.customer.get({ id })).kgToleranceBp).toBe(300);
    await p.owner.customer.update({ id, name: "Tolerant Metals Ltd" });
    expect((await p.owner.customer.get({ id })).kgToleranceBp).toBe(300);
    await p.owner.customer.update({ id, name: "Tolerant Metals Ltd", kgToleranceBp: null });
    expect((await p.owner.customer.get({ id })).kgToleranceBp).toBeNull();
    const plain = await p.owner.customer.create({ name: "Plain Co" });
    expect((await p.owner.customer.get({ id: (plain as { id: string }).id })).kgToleranceBp).toBeNull();
  }, SLOW);

  test("[K01 K05] company.updateSettings({ orderToleranceBp }) is what dispatch.complete then applies", async () => {
    const p = await plant();
    await expect(p.owner.company.updateSettings({ orderToleranceBp: 10_001 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.owner.company.updateSettings({ orderToleranceBp: 1_000 });
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const ok = await p.held(await p.pack(p.dieA, [{ kg: 1100 }], o.lineIds[0]));
    await p.owner.dispatch.complete({ id: ok });
    const o2 = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const over = await p.held(await p.pack(p.dieA, [{ kg: 1100.001 }], o2.lineIds[0]));
    await expect(p.owner.dispatch.complete({ id: over })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  }, SLOW);

  test("[K02 K03 K04] letterhead: merged key by key, '' clears, GSTIN upper-cased and checked, and it reaches the next PL", async () => {
    setClock(NOON);
    const p = await plant({ settings: { letterhead: undefined } });
    await expect(p.owner.company.updateSettings({ letterhead: { gstin: "not-a-gstin" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.owner.company.updateSettings({ letterhead: { legalName: "Four Cubes Pvt Ltd", gstin: "24aaacf1234a1z5", address: "Plot 1, GIDC" } });
    await p.owner.company.updateSettings({ letterhead: { phone: "+91 98250 00000" } });
    await p.owner.company.updateSettings({ letterhead: { address: "" } });
    const [row] = await env.db.select({ settings: company.settings }).from(company).where(eq(company.id, p.companyId));
    expect(row!.settings!.letterhead).toEqual({ legalName: "Four Cubes Pvt Ltd", gstin: "24AAACF1234A1Z5", address: null, phone: "+91 98250 00000" });
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    await p.owner.dispatch.complete({ id: d });
    expect(plSchema.parse((await plRow(d))!.snapshot).header.company).toMatchObject({ legalName: "Four Cubes Pvt Ltd", gstin: "24AAACF1234A1Z5", address: null });
  }, SLOW);
});

describe("packing list: legacy dispatches, clock and group order", () => {
  test("[P01 P02] a dispatch completed before PL numbers gets its number on manual create, once", async () => {
    setClock(NOON);
    const p = await plant();
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    await p.owner.dispatch.complete({ id: d });
    // Make it look like a pre-PL-8 dispatch: no PL number, no packing list.
    const first = (await plRow(d))!;
    await env.db.delete(packingListLine).where(eq(packingListLine.packingListId, first.id));
    await env.db.delete(packingList).where(eq(packingList.id, first.id));
    await env.db.update(dispatch).set({ plNumber: null }).where(eq(dispatch.id, d));
    const made = await p.owner.packingList.create({ dispatchId: d });
    expect(made.code).toBe("PL/2026-27/2"); // the book's next number: the first was spent by the original completion
    expect((await dispatchRow(d)).plNumber).toBe("PL/2026-27/2");
    await expect(p.owner.packingList.create({ dispatchId: d })).rejects.toMatchObject({ code: "CONFLICT" });
  }, SLOW);

  test("[P04] the PL date is the company's calendar day of completion", async () => {
    const p = await plant();
    setClock(ist("2026-10-01T00:10:00")); // 2026-09-30T18:40Z
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    await p.owner.dispatch.complete({ id: d });
    expect(plSchema.parse((await plRow(d))!.snapshot).header.date).toBe("2026-10-01");
  }, SLOW);

  test("[N03] two lines of one order and section print in line order, not in id order", async () => {
    const p = await plant();
    // Six lines: with no line-number tie-break the group order would be the order of random ids (1 in 720 to be right).
    const finishes = ["F1", "F2", "F3", "F4", "F5", "F6"];
    const o = await p.order(finishes.map((finish) => ({ dieId: p.dieA, kg: 100, finish })));
    const serials: string[] = [];
    for (const i of [5, 2, 4, 0, 3, 1]) serials.push(...(await p.pack(p.dieA, [{ kg: 10 }], o.lineIds[i])));
    const d = await p.held(serials);
    await p.owner.dispatch.complete({ id: d });
    const snap = plSchema.parse((await plRow(d))!.snapshot);
    expect(snap.groups.map((g) => g.lineNo)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(snap.groups.map((g) => g.finish)).toEqual(finishes);
  }, SLOW);
});

describe("buildPlSnapshotV2 (pure)", () => {
  type Mod = typeof import("../src/lib/packingListSnapshot");
  let snapMod: Mod;
  beforeAll(async () => {
    snapMod = await import("../src/lib/packingListSnapshot");
  });

  type Input = Parameters<Mod["buildPlSnapshotV2"]>[0];
  const base = (items: Input["items"], over: Partial<Input> = {}): Input => ({
    plNumber: "PL/2026-27/1",
    date: "2026-10-03",
    generatedAt: new Date("2026-10-03T06:30:00Z"),
    generatedBy: "u1",
    company: { id: "c1", name: "Fourcubes", settings: null },
    dispatch: {
      code: "D-1", status: "completed", shipDate: null, notes: null, completedAt: new Date("2026-10-03T06:30:00Z"),
      vehicleNo: null, driverName: null, driverPhone: null, transporter: null, invoiceNumber: null, invoiceDate: null,
    },
    customer: {
      id: "k1", name: "Shree Metals", phone: null, email: null, billingAddress: null, shippingAddress: null, taxId: "24ABCDE1234F1Z9",
    },
    items,
    ...over,
  });
  const item = (serial: string, over: Record<string, unknown> = {}) => ({
    bundleId: `b-${serial}`, serial, quantity: 10, weightG: 25_500, lengthMm: 3_658, kgPer12ftMilli: null, bundlePo: null,
    bundleGroupId: "g1", groupLabel: null, dieId: "dieA", series: "Domal", sectionCode: "12170", sectionName: null, line: null,
    ...over,
  });

  test("[N04 N05] rows run in natural serial order (26I99 before 26I100)", () => {
    const snap = snapMod.buildPlSnapshotV2(base([item("26I100"), item("26I99"), item("26I101")] as never));
    expect(snap.groups[0]!.rows.map((r) => r.bundleNo)).toEqual(["26I99", "26I100", "26I101"]);
    expect(snap.groups[0]!.rows.map((r) => r.sr)).toEqual([1, 2, 3]);
  });

  test("[N07] a bundle without a stored kg/12ft gets one computed from weight, pieces and length", () => {
    const snap = snapMod.buildPlSnapshotV2(base([item("26I1", { weightG: 25_500, quantity: 10, lengthMm: 3_657.6, kgPer12ftMilli: null })] as never));
    expect(snap.groups[0]!.rows[0]).toMatchObject({ kgPer12ftMilli: 2_550, range12ft: 2.5 });
    const none = snapMod.buildPlSnapshotV2(base([item("26I2", { quantity: 0, kgPer12ftMilli: null })] as never));
    expect(none.groups[0]!.rows[0]).toMatchObject({ kgPer12ftMilli: null, range12ft: null });
  });

  test("[N09] one bundle reads '1 bundle'", () => {
    expect(snapMod.buildPlSnapshotV2(base([item("26I1")] as never)).summary.text).toBe("1 bundle · 25.500 kg");
    expect(snapMod.buildPlSnapshotV2(base([item("26I1"), item("26I2")] as never)).summary.text).toBe("2 bundles · 51.000 kg");
  });

  test("[N10 N11 N12] without a ship-to the bill-to name, GSTIN and address are used", () => {
    const snap = snapMod.buildPlSnapshotV2(
      base([item("26I1")] as never, {
        customer: {
          id: "k1", name: "Shree Metals", phone: null, email: null, taxId: "24ABCDE1234F1Z9",
          billingAddress: { line1: "Shed 4", city: "Surat" }, shippingAddress: null,
        },
      }),
    );
    expect(snap.header.billTo).toEqual({ name: "Shree Metals", gstin: "24ABCDE1234F1Z9", address: "Shed 4, Surat" });
    expect(snap.header.shipTo).toEqual(snap.header.billTo);
  });

  test("[N14 N15] addressText accepts a plain string, { text }, { lines } and loose key order", () => {
    expect(snapMod.addressText("  Plot 1, GIDC ")).toBe("Plot 1, GIDC");
    expect(snapMod.addressText({ text: "Plot 2", extra: "zz" })).toBe("Plot 2");
    expect(snapMod.addressText({ lines: ["A", " ", "B"] })).toBe("A, B");
    expect(snapMod.addressText({ name: "x", landmark: "Near mill", note: "gate 2" })).toBe("Near mill, gate 2");
    expect(snapMod.addressText({})).toBeNull();
    expect(snapMod.addressText(null)).toBeNull();
  });
});

describe("@orrn/documents v2 content", () => {
  type Docs = {
    buildPackingListHtml(pl: never, code: string): string;
    buildPackingListXlsxBuffer(pl: never, code: string): Uint8Array;
  };
  const docsPath = "../../documents/src/packing-list/index";
  const load = async () => (await import(docsPath)) as Docs;

  test("[H02 H03 H04] customer, company and item text is HTML-escaped in the v2 print", async () => {
    setClock(NOON);
    const docs = await load();
    const p = await plant({ settings: { letterhead: { legalName: "Four & Cubes <Pvt>", gstin: "24AAACF1234A1Z5", address: "Plot <1>", phone: "1" } } });
    await env.db.update(customer).set({ name: 'Shree <b>"M"</b> & Co' }).where(eq(customer.id, p.customerId));
    const o = await p.order([{ dieId: p.dieA, kg: 100, finish: "Mill <i>" }]);
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }], o.lineIds[0]));
    const done = await p.owner.dispatch.complete({ id: d });
    const html = docs.buildPackingListHtml((await plRow(d))!.snapshot as never, done.plNumber);
    expect(html).not.toMatch(/<b>|<i>|<Pvt>|<1>/);
    for (const text of ["Shree &lt;b&gt;&quot;M&quot;&lt;/b&gt; &amp; Co", "Four &amp; Cubes &lt;Pvt&gt;", "Plot &lt;1&gt;", "Mill &lt;i&gt;"]) {
      expect(html).toContain(text);
    }
  }, SLOW);

  test("[X01 X02 X03 X04 X05] the v2 workbook carries the header block, numeric kg cells, subtotals and the total", async () => {
    setClock(NOON);
    const docs = await load();
    const xlsxPath = "../../documents/node_modules/xlsx";
    const XLSX = (await import(xlsxPath)) as {
      read(data: Uint8Array, opts: { type: "array" }): { SheetNames: string[]; Sheets: Record<string, unknown> };
      utils: { sheet_to_json<T>(sheet: unknown, opts: { header: 1; defval: null }): T[] };
    };
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }, { dieId: p.dieB, kg: 500 }], { poNumber: "PO-778" });
    const s = [
      ...(await p.pack(p.dieA, [{ kg: 25.5 }, { kg: 24.25 }], o.lineIds[0])),
      ...(await p.pack(p.dieB, [{ kg: 40 }], o.lineIds[1])),
    ];
    const d = await p.held(s);
    await p.owner.dispatch.update({ id: d, vehicleNo: "GJ05AB1234", driverName: "Ramesh", transporter: "Shree" });
    const done = await p.owner.dispatch.complete({ id: d });
    const buf = docs.buildPackingListXlsxBuffer((await plRow(d))!.snapshot as never, done.plNumber);
    const wb = XLSX.read(buf, { type: "array" });
    expect(wb.SheetNames).toEqual(["Packing list"]);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Packing list"]!, { header: 1, defval: null }) as unknown[][];
    const cell = (label: string) => rows.find((r) => r[0] === label)?.[1];
    expect(cell("Packing list")).toBe(done.plNumber);
    expect(cell("Vehicle")).toBe("GJ05AB1234");
    expect(cell("Driver")).toBe("Ramesh");
    expect(cell("Transporter")).toBe("Shree");
    expect(cell("PO numbers")).toBe("PO-778");
    const head = rows.findIndex((r) => r[0] === "Sr");
    expect(rows[head]!.slice(0, 5)).toEqual(["Sr", "Bundle no", "Section", "Item", "Weight kg"]);
    const body = rows.slice(head + 1).filter((r) => typeof r[0] === "number");
    expect(body.map((r) => r[4])).toEqual([25.5, 24.25, 40]); // kg as numbers (not grams), in printed order
    // One subtotal row per group (2) plus the grand total row (1), then the summary text.
    const countRows = rows.filter((r) => typeof r[1] === "string" && /^\d+ bundles?$/.test(r[1] as string));
    expect(countRows.map((r) => [Number.parseInt(r[1] as string, 10), r[4]])).toEqual([[2, 49.75], [1, 40], [3, 89.75]]);
    expect(rows.some((r) => r[0] === null && r[1] === "3 bundles · 89.750 kg")).toBe(true);
  }, SLOW);
});

describe("sales register CSV details", () => {
  test("[T06 T07 T08 T11] formula-looking and multi-line cells, PO precedence and order of several POs", async () => {
    setClock(ist("2026-10-05T11:00:00"));
    const p = await plant();
    const c2 = await env.seedCustomer(p.companyId);
    const c3 = await env.seedCustomer(p.companyId);
    await env.db.update(customer).set({ name: "+91 Traders" }).where(eq(customer.id, p.customerId));
    await env.db.update(customer).set({ name: "-Dash Metals" }).where(eq(customer.id, c2));
    await env.db.update(customer).set({ name: "@home\nline2 Co" }).where(eq(customer.id, c3));
    // Dispatch 1: two orders with POs "PO-10" and "PO-9", plus a bundle with its own PO linked to an order with a PO.
    const o10 = await p.order([{ dieId: p.dieA, kg: 100 }], { poNumber: "PO-10" });
    const o9 = await p.order([{ dieId: p.dieB, kg: 100 }], { poNumber: "PO-9" });
    const s10 = await p.pack(p.dieA, [{ kg: 10, po: "BUNDLE-PO" }], o10.lineIds[0]);
    const s9 = await p.pack(p.dieB, [{ kg: 10 }], o9.lineIds[0]);
    const d1 = await p.held([...s10, ...s9]);
    const d2 = await p.held(await p.pack(p.dieA, [{ kg: 5 }]), c2);
    const d3 = await p.held(await p.pack(p.dieA, [{ kg: 5 }]), c3);
    for (const [minute, id] of [[0, d1], [1, d2], [2, d3]] as const) {
      setClock(ist(`2026-10-05T11:0${minute}:00`));
      await p.owner.dispatch.complete({ id });
    }
    const { csv } = await p.owner.reports.salesRegisterCsv({ month: "2026-10" });
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain("'+91 Traders");
    expect(lines[1]).toContain(",PO-9; PO-10,"); // natural order; the bundle's own PO never shows over the order's
    expect(lines[1]).not.toContain("BUNDLE-PO");
    expect(lines[2]).toContain("'-Dash Metals");
    expect(csv).toContain("\"'@home\nline2 Co\""); // quoted, apostrophe-guarded, line break kept inside the quotes
    expect(csv.trimEnd().split("\r\n")).toHaveLength(4);
  }, SLOW);
});


// ===========================================================================
// Reviewer additions, second pass (guards the first pass did not reach).
// ===========================================================================

describe("order status table and company scope of reads", () => {
  test("[O36] booking -> confirmed only through orders.confirm, and an edit can't take it back to booking (D11)", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    await confirmOrder(p.owner, o.id);
    expect(await orderStatus(p, o.id)).toBe("confirmed");
    await expect(saveOrder(p.owner, { id: o.id, status: "booking" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await orderStatus(p, o.id)).toBe("confirmed");
  }, SLOW);

  test("[R34] a forged order row (another company's order pointing at this company's customer) is not listed", async () => {
    const p = await plant();
    const other = await plant();
    const theirs = await other.order([{ dieId: other.dieA, kg: 100 }]);
    await env.db.update(salesOrder).set({ customerId: p.customerId }).where(eq(salesOrder.id, theirs.id));
    const list = await p.owner.orders.list({});
    expect(list.items).toEqual([]);
    expect(list.total).toBe(0);
  }, SLOW);
});

describe("orders.update: an edit that loses a race to a status move fails whole", () => {
  test("[R20] a plain edit that loses to a cancel, and a status move from a stale status, both answer CONFLICT and change nothing", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    env.beforeNextBatch(() => cancelOrder(p.owner, o.id));
    await expect(saveOrder(p.owner, { id: o.id, poNumber: "LATE" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await p.owner.orders.get({ id: o.id })).order).toMatchObject({ status: "cancelled", poNumber: null });
    const o2 = await p.order([{ dieId: p.dieA, kg: 100 }]);
    // The cancel was checked against "booking"; the order is "confirmed" by the time it lands.
    env.beforeNextBatch(() => confirmOrder(p.owner, o2.id));
    await expect(p.owner.orders.cancel({ id: o2.id, reason: "stale" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await p.owner.orders.get({ id: o2.id })).order).toMatchObject({ status: "confirmed", cancelReason: null });
    // A plain edit read before a confirm landed fails whole too.
    const o3 = await p.order([{ dieId: p.dieA, kg: 100 }]);
    env.beforeNextBatch(() => confirmOrder(p.owner, o3.id));
    await expect(saveOrder(p.owner, { id: o3.id, note: "stale" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await p.owner.orders.get({ id: o3.id })).order).toMatchObject({ status: "confirmed", note: null });
  }, SLOW);
});

describe("Review Focus 5: approvals are per dispatch at write time", () => {
  test("[G06] another dispatch's approval never covers this dispatch when a late link raises its total", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const lineId = o.lineIds[0]!;
    // Dispatch X: 1200 kg, approved by a manager but never completed. Its approval names this line (totalG 1200 kg).
    const x = await p.held(await p.pack(p.dieA, [{ kg: 600 }, { kg: 600 }], lineId));
    await expect(p.owner.dispatch.complete({ id: x })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [reqX] = await pendingOverdraw(p.companyId, x);
    await p.as("manager").approval.decide({ id: reqX!.id, decision: "approved" });
    // Dispatch Y: a 1000 kg bundle (linked, inside the limit) and a 100 kg bundle that finds no baki left (unlinked).
    const y = await p.held(await p.pack(p.dieA, [{ kg: 1000 }, { kg: 100 }]));
    const items = await itemsOf(y);
    await p.owner.dispatch.linkItem({ itemId: items[0]!.id, salesOrderLineId: lineId });
    await p.owner.dispatch.linkItem({ itemId: items[1]!.id, salesOrderLineId: null });
    // The 100 kg bundle is linked just after complete read Y: 1100 kg is past the 1050 kg limit and Y has no approval.
    env.beforeNextBatch(() => p.owner.dispatch.linkItem({ itemId: items[1]!.id, salesOrderLineId: lineId }));
    await expect(p.owner.dispatch.complete({ id: y })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await dispatchRow(y)).status).toBe("reserved");
    expect(await plRow(y)).toBeNull();
  }, SLOW);
});


// ===========================================================================
// Reviewer additions, third pass: getDispatch fields, cross-company wiring, bound parameters, order edits.
// ===========================================================================

describe("getDispatch items and cross-company wiring", () => {
  test("[E03 E04] getDispatch items carry the linked order line, order id, order number and line number", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }, { dieId: p.dieB, kg: 500 }], { poNumber: "PO-5" });
    const d = await p.held([
      ...(await p.pack(p.dieA, [{ kg: 10 }], o.lineIds[0])),
      ...(await p.pack(p.dieB, [{ kg: 10 }])),
    ]);
    const view = await p.owner.dispatch.getDispatch({ id: d });
    const byLine = new Map(view.items.map((i) => [i.salesOrderLineId, i]));
    expect(byLine.get(o.lineIds[0]!)).toMatchObject({ orderId: o.id, orderNumber: o.number, lineNo: 1 });
    expect(byLine.get(o.lineIds[1]!)).toMatchObject({ orderId: o.id, orderNumber: o.number, lineNo: 2 });
    expect(view.items).toHaveLength(2);
  }, SLOW);

  test("[E01 E09 E33 P05] an item wired to another company's order line shows, prints and registers nothing of it", async () => {
    setClock(NOON);
    const p = await plant();
    const other = await plant();
    const theirs = await other.order([{ dieId: other.dieA, kg: 100, finish: "THEIRFINISH" }], { poNumber: "THEIR-PO" });
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    await env.db.update(dispatchItem).set({ salesOrderLineId: theirs.lineIds[0] }).where(eq(dispatchItem.dispatchId, d));
    const view = await p.owner.dispatch.getDispatch({ id: d });
    expect(view.items[0]).toMatchObject({ orderId: null, orderNumber: null, lineNo: null });
    await p.owner.dispatch.complete({ id: d });
    const snap = plSchema.parse((await plRow(d))!.snapshot);
    expect(JSON.stringify(snap)).not.toContain("THEIR-PO");
    expect(JSON.stringify(snap)).not.toContain("THEIRFINISH");
    expect(snap.groups.map((g) => g.orderNumber)).toEqual([null]);
    const reg = await p.owner.reports.salesRegisterCsv({ month: "2026-10" });
    expect(reg.csv).not.toContain("THEIR-PO");
  }, SLOW);

  test("[E02 E09 E14] a line of this company pointing at another company's order shows and prints nothing of that order", async () => {
    setClock(NOON);
    const p = await plant();
    const other = await plant();
    const theirs = await other.order([{ dieId: other.dieA, kg: 100 }], { poNumber: "THEIR-PO" });
    const mine = await p.order([{ dieId: p.dieA, kg: 100 }]);
    await env.db.update(salesOrderLine).set({ salesOrderId: theirs.id, lineNo: 99 }).where(eq(salesOrderLine.id, mine.lineIds[0]!));
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    await env.db.update(dispatchItem).set({ salesOrderLineId: mine.lineIds[0] }).where(eq(dispatchItem.dispatchId, d));
    const view = await p.owner.dispatch.getDispatch({ id: d });
    expect(view.items[0]).toMatchObject({ orderId: null, orderNumber: null });
    await p.owner.dispatch.complete({ id: d });
    const snap = plSchema.parse((await plRow(d))!.snapshot);
    expect(JSON.stringify(snap)).not.toContain("THEIR-PO");
    expect(snap.groups.map((g) => g.orderNumber)).toEqual([null]);
    expect((await p.owner.reports.salesRegisterCsv({ month: "2026-10" })).csv).not.toContain("THEIR-PO");
  }, SLOW);

  test("[E10 E33] a dispatch wired to another company's customer prints and registers nothing of that customer", async () => {
    setClock(NOON);
    const p = await plant();
    const other = await plant();
    await env.db.update(customer).set({ name: "Foreign Metals", taxId: "27ZZZZZ9999Z1Z1" }).where(eq(customer.id, other.customerId));
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    await env.db.update(dispatch).set({ customerId: other.customerId }).where(eq(dispatch.id, d));
    await p.owner.dispatch.complete({ id: d });
    const snap = (await plRow(d))!.snapshot;
    expect(JSON.stringify(snap)).not.toContain("Foreign Metals");
    expect(JSON.stringify(snap)).not.toContain("27ZZZZZ9999Z1Z1");
    expect((await p.owner.reports.salesRegisterCsv({ month: "2026-10" })).csv).not.toContain("Foreign Metals");
  }, SLOW);

  test("[E11] a bundle wired to another company's section prints nothing of that section", async () => {
    setClock(NOON);
    const p = await plant();
    const other = await plant();
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    await env.db.update(bundle).set({ dieId: other.dieA }).where(eq(bundle.companyId, p.companyId));
    await p.owner.dispatch.complete({ id: d });
    const [foreign] = await env.db.select({ code: die.sectionCode }).from(die).where(eq(die.id, other.dieA));
    expect(JSON.stringify((await plRow(d))!.snapshot)).not.toContain(foreign!.code);
  }, SLOW);

  test("[E12 E13 E14] forged order and line rows wired to another company's customer, section or order never reach the balance", async () => {
    const p = await plant();
    const other = await plant();
    const theirs = await other.order([{ dieId: other.dieA, kg: 100 }]);
    const a = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const b = await p.order([{ dieId: p.dieA, kg: 200 }]);
    const c = await p.order([{ dieId: p.dieA, kg: 300 }]);
    const control = await p.order([{ dieId: p.dieA, kg: 50 }]);
    await env.db.update(salesOrder).set({ customerId: other.customerId }).where(eq(salesOrder.id, a.id));
    await env.db.update(salesOrderLine).set({ dieId: other.dieA }).where(eq(salesOrderLine.id, b.lineIds[0]!));
    // C: the line belongs to this company, its order to the other company, whose customer is forged to be this company's
    // (so the customer join alone cannot hide it).
    await env.db.update(salesOrder).set({ customerId: p.customerId }).where(eq(salesOrder.id, theirs.id));
    await env.db.update(salesOrderLine).set({ salesOrderId: theirs.id, lineNo: 99 }).where(eq(salesOrderLine.id, c.lineIds[0]!));
    const bal = await p.owner.orders.balance({ includeClosed: true });
    expect(bal.lines.map((l) => l.orderId)).toEqual([control.id]);
    expect(bal.totals).toMatchObject({ lines: 1, orderedG: kg(50) });
  }, SLOW);
});

describe("getDispatch overdraw state names the dispatch's latest overdraw request", () => {
  test("[E05 E06] after a rejection and a new ask the pending request is the one shown, and other approval kinds are never shown", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const d = await p.held(await p.pack(p.dieA, [{ kg: 600 }, { kg: 600 }], o.lineIds[0]));
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [first] = await pendingOverdraw(p.companyId, d);
    await p.as("manager").approval.decide({ id: first!.id, decision: "rejected" });
    expect((await p.owner.dispatch.getDispatch({ id: d })).overdraw!.approval).toMatchObject({ id: first!.id, status: "rejected" });
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [second] = await pendingOverdraw(p.companyId, d);
    expect(second!.id).not.toBe(first!.id);
    await env.db.insert(approval).values({ id: crypto.randomUUID(), companyId: p.companyId, kind: "phantom_void", subjectId: d, status: "pending", meta: {} });
    expect((await p.owner.dispatch.getDispatch({ id: d })).overdraw!.approval).toMatchObject({ id: second!.id, status: "pending" });
  }, SLOW);
});

describe("dispatch.update and linkItem: write-time status and sync", () => {
  test("[E07] a header edit that loses to a cancel is refused, not written onto the cancelled dispatch", async () => {
    const p = await plant();
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    env.beforeNextBatch(() => p.owner.dispatch.cancel({ id: d }));
    await expect(p.owner.dispatch.update({ id: d, vehicleNo: "GJ05AB1234" })).rejects.toMatchObject({ code: "CONFLICT" });
    const row = await dispatchRow(d);
    expect(row.status).toBe("cancelled");
    expect(row.vehicleNo).toBeNull();
  }, SLOW);

  test("[E08] linking an item bumps the dispatch's sync sequence so offline clients pull the change", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials: await p.pack(p.dieA, [{ kg: 10 }]) });
    const [item] = await itemsOf(id);
    await p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null });
    const before = (await dispatchRow(id)).serverSeq;
    await p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: o.lineIds[0]! });
    expect((await dispatchRow(id)).serverSeq).toBeGreaterThan(before);
  }, SLOW);
});

describe("orders.update changes every field it is given", () => {
  test("[E15 E16 E17 E18] customer, order date, note and PO number changes are stored", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }], { poNumber: "PO-OLD" });
    await saveOrder(p.owner, { id: o.id, customerId: p.otherCustomer, orderDate: "2026-08-15", note: "rush", poNumber: "PO-NEW" });
    expect((await p.owner.orders.get({ id: o.id })).order).toMatchObject({
      customerId: p.otherCustomer,
      orderDate: "2026-08-15",
      note: "rush",
      poNumber: "PO-NEW",
    });
    await saveOrder(p.owner, { id: o.id, note: null, poNumber: "  " });
    expect((await p.owner.orders.get({ id: o.id })).order).toMatchObject({ note: null, poNumber: null, customerId: p.otherCustomer });
  }, SLOW);

  test("[E19 E20 E21 E22 E23 E24 E25 E26] every line field is stored on create and changed by an edit", async () => {
    const p = await plant();
    const res = await p.owner.orders.create({
      customerId: p.customerId,
      lines: [{ sectionId: p.dieA, cutLengthMm: 3_700, kgPer12ftMilli: 2_450, pcs: 40, kgG: kg(100), finish: "Mill", note: "first" }],
    });
    const created = (await p.owner.orders.get({ id: res.id })).lines[0]!;
    expect(created).toMatchObject({ cutLengthMm: 3_700, kgPer12ftMilli: 2_450, orderedPcs: 40, orderedG: kg(100), finish: "Mill", note: "first" });
    await saveOrder(p.owner, {
      id: res.id,
      lines: [{ id: created.lineId, sectionId: p.dieA, cutLengthMm: 4_100, kgPer12ftMilli: 2_600, pcs: 55, kgG: kg(120), finish: "Anodise", note: "second" }],
    });
    expect((await p.owner.orders.get({ id: res.id })).lines[0]).toMatchObject({
      lineId: created.lineId,
      cutLengthMm: 4_100,
      kgPer12ftMilli: 2_600,
      orderedPcs: 55,
      orderedG: kg(120),
      finish: "Anodise",
      note: "second",
    });
  }, SLOW);

  test("[E30 E31 E32] kg above 1,000 t, more than 100 lines on an edit and a closed order on create are refused", async () => {
    const p = await plant();
    const line = { sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(10) };
    await expect(p.owner.orders.create({ customerId: p.customerId, lines: [{ ...line, kgG: 1_000_000_001 }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      p.owner.orders.create({ customerId: p.customerId, status: "closed" as never, lines: [line] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const o = await p.order([{ dieId: p.dieA, kg: 10 }]);
    await expect(
      saveOrder(p.owner, { id: o.id, lines: Array.from({ length: 101 }, () => line) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("[E27 E28 E29] orders.get and orders.list name the customer", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 10 }]);
    const got = await p.owner.orders.get({ id: o.id });
    expect(got.order.customerName).not.toBe("");
    expect(got.order.customerGstin).toBe("24ABCDE1234F1Z9");
    const listed = (await p.owner.orders.list({})).items[0]!;
    expect(listed.customerName).toBe(got.order.customerName);
  }, SLOW);
});

describe("sales register: 3-decimal kg", () => {
  test("[E34] the Kg column prints three decimals", async () => {
    setClock(ist("2026-10-05T11:00:00"));
    const p = await plant();
    const d = await p.held(await p.pack(p.dieA, [{ kg: 12.5 }]));
    await p.owner.dispatch.complete({ id: d });
    const csv = (await p.owner.reports.salesRegisterCsv({ month: "2026-10" })).csv.split("\r\n");
    expect(csv[1]!.split(",")[10]).toBe("12.500");
  }, SLOW);
});

describe("bound parameters on the order edit and list paths (D1 allows 100 per statement)", () => {
  const hundred = (p: Plant) =>
    Array.from({ length: 100 }, (_, i) => ({ sectionId: i % 2 ? p.dieA : p.dieB, cutLengthMm: 3_000 + i, kgG: kg(10 + i) }));

  test("[Z19] changing all 100 lines of an order in one edit", async () => {
    const p = await plant();
    const res = await p.owner.orders.create({ customerId: p.customerId, lines: hundred(p) });
    const got = await p.owner.orders.get({ id: res.id });
    env.resetPeakParams();
    await saveOrder(p.owner, {
      id: res.id,
      lines: got.lines.map((l) => ({ id: l.lineId, sectionId: l.sectionId, cutLengthMm: l.cutLengthMm, kgG: l.orderedG + 1_000 })),
    });
    expect(env.peakParams()).toBeLessThanOrEqual(100);
    expect((await p.owner.orders.get({ id: res.id })).lines[0]!.orderedG).toBe(kg(10) + 1_000);
  }, SLOW);

  test("[Z18] replacing all 100 lines of an order by one new line (100 removals)", async () => {
    const p = await plant();
    const res = await p.owner.orders.create({ customerId: p.customerId, lines: hundred(p) });
    env.resetPeakParams();
    await saveOrder(p.owner, { id: res.id, lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(5) }] });
    expect(env.peakParams()).toBeLessThanOrEqual(100);
    const got = await p.owner.orders.get({ id: res.id });
    expect(got.lines.map((l) => [l.lineNo, l.orderedG])).toEqual([[101, kg(5)]]);
  }, SLOW);

  test("[Z17] listing 100 orders reads their lines in statements of at most 100 parameters", async () => {
    const p = await plant();
    for (let i = 0; i < 100; i += 1) {
      await p.owner.orders.create({ customerId: p.customerId, lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(1) }] });
    }
    env.resetPeakParams();
    const list = await p.owner.orders.list({ limit: 100 });
    expect(env.peakParams()).toBeLessThanOrEqual(100);
    expect(list.items).toHaveLength(100);
    expect(list.items.every((o) => o.lines === 1 && o.orderedG === kg(1))).toBe(true);
  }, 120_000);
});

describe("@orrn/documents helpers (pure)", () => {
  type Docs = {
    plFileName(code: string): string;
    plRowCells(r: never): string[];
    plGroupTitle(g: never): string;
    formatPlKg(g: number): string;
  };
  const docsPath = "../../documents/src/packing-list/index";
  const load = async () => (await import(docsPath)) as Docs;

  test("[E36 E37] plFileName gives a safe name: slashes become dashes, edge dashes go, nothing left falls back", async () => {
    const docs = await load();
    expect(docs.plFileName("PL/2026-27/14")).toBe("PL-2026-27-14");
    expect(docs.plFileName("/PL//1/")).toBe("PL-1");
    expect(docs.plFileName("///")).toBe("packing-list");
    expect(docs.plFileName("")).toBe("packing-list");
  });

  test("[E38] a row without kg/12ft prints dashes; one with it prints three decimals and one", async () => {
    const docs = await load();
    const row = { sr: 1, bundleNo: "26I1", section: "12170", item: "Domal", weightG: 25_500, cutFt: 12, cutIn: 0, pcs: 10, kgPer12ftMilli: 2_550, range12ft: 2.5, po: null };
    expect(docs.plRowCells(row as never)).toEqual(["1", "26I1", "12170", "Domal", "25.500", "12", "0", "10", "2.550", "2.5", ""]);
    expect(docs.plRowCells({ ...row, kgPer12ftMilli: null, range12ft: null } as never).slice(8, 10)).toEqual(["—", "—"]);
  });

  test("[E39] the group title names the order line, section, item and PO", async () => {
    const docs = await load();
    const g = { orderNumber: "SO-12", lineNo: 1, sectionCode: "12170", item: "Domal (Anodise)", poNumber: "778" };
    expect(docs.plGroupTitle(g as never)).toBe("SO-12 / 1 · 12170 · Domal (Anodise) · PO 778");
    expect(docs.plGroupTitle({ ...g, orderNumber: null, lineNo: null, item: "Domal", poNumber: null } as never)).toBe("12170 · Domal");
  });
});

describe("write-time guards that need a race to show", () => {
  test("[D43] a suggested line whose section changes before the scan lands leaves the bundle unlinked", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 10 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    env.beforeNextBatch(() =>
      saveOrder(p.owner, { id: o.id, lines: [{ id: o.lineIds[0]!, sectionId: p.dieB, cutLengthMm: 3_658, kgG: kg(1000) }] }),
    );
    const report = await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    expect(report.added).toEqual(serials);
    expect(report.linked).toEqual([]);
    expect((await itemsOf(id))[0]!.lineId).toBeNull();
  }, SLOW);

  test("[D44] a suggested line of the old customer is dropped when the dispatch changes customer before the scan lands", async () => {
    const p = await plant();
    await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 10 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    env.beforeNextBatch(() => p.owner.dispatch.update({ id, customerId: p.otherCustomer }));
    const report = await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    expect(report.added).toEqual(serials);
    expect(report.linked).toEqual([]);
    expect((await dispatchRow(id)).customerId).toBe(p.otherCustomer);
    expect((await itemsOf(id))[0]!.lineId).toBeNull();
  }, SLOW);

  test("[B04] a pack against a line whose section changes after the pack read it packs nothing", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    env.beforeNextBatch(() =>
      saveOrder(p.owner, { id: o.id, lines: [{ id: o.lineIds[0]!, sectionId: p.dieB, cutLengthMm: 3_658, kgG: kg(1000) }] }),
    );
    await expect(p.pack(p.dieA, [{ kg: 10 }], o.lineIds[0])).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await env.db.select({ id: bundle.id }).from(bundle).where(eq(bundle.companyId, p.companyId))).toHaveLength(0);
  }, SLOW);
});

describe("packing list after completion: legacy snapshots and one-bundle groups", () => {
  test("[D26] a header correction leaves a legacy (v1) packing list snapshot untouched", async () => {
    setClock(NOON);
    const p = await plant();
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    await p.owner.dispatch.complete({ id: d });
    const pl = (await plRow(d))!;
    const v1 = { ...(pl.snapshot as Record<string, unknown>) };
    for (const key of ["version", "header", "columns", "groups", "summary"]) delete v1[key];
    await env.db.update(packingList).set({ snapshot: v1 }).where(eq(packingList.id, pl.id));
    await p.owner.dispatch.update({ id: d, vehicleNo: "GJ05AB1234" });
    expect(((await plRow(d))!.snapshot as Record<string, unknown>).header).toBeUndefined();
    expect((await dispatchRow(d)).vehicleNo).toBe("GJ05AB1234");
  }, SLOW);

  test("[H07] the HTML subtotal of a one-bundle group reads '1 bundle'", async () => {
    setClock(NOON);
    const docs = (await import(DOCS_PATH)) as { buildPackingListHtml(pl: never, code: string): string };
    const p = await plant();
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    const done = await p.owner.dispatch.complete({ id: d });
    const html = docs.buildPackingListHtml((await plRow(d))!.snapshot as never, done.plNumber);
    expect(html).toContain(">1 bundle</td>");
    expect(html).not.toContain("1 bundles");
  }, SLOW);
});

describe("input validation: dispatch header, dates and tolerance", () => {
  test("[Z08 Z09 Z10] the dispatch header refuses a bad phone, a bad vehicle number and a date that is not on the calendar", async () => {
    const p = await plant();
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    for (const bad of [{ driverPhone: "call me" }, { driverPhone: "123" }, { vehicleNo: "GJ05@AB" }, { vehicleNo: "X" }]) {
      await expect(p.owner.dispatch.update({ id, ...bad })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(p.as("office").dispatch.update({ id, invoiceDate: "2026-02-30" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await dispatchRow(id)).toMatchObject({ vehicleNo: null, driverPhone: null, invoiceDate: null });
  }, SLOW);

  test("[Z11 Z12] an order date must be a real date and a customer's kg tolerance at most 100 %", async () => {
    const p = await plant();
    await expect(
      p.owner.orders.create({ customerId: p.customerId, orderDate: "2026-02-30", lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(10) }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.owner.customer.create({ name: "Too Tolerant", kgToleranceBp: 10_001 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.owner.customer.create({ name: "Negative", kgToleranceBp: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);
});

describe("migration 0020 unique indexes", () => {
  test("[Z07] two edits that add a line at the same time cannot both take the same line number", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const keep = { id: o.lineIds[0]!, sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(100) };
    env.beforeNextBatch(() =>
      saveOrder(p.owner, { id: o.id, lines: [keep, { sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(1) }] }),
    );
    await expect(
      saveOrder(p.owner, { id: o.id, lines: [keep, { sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(2) }] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const lines = (await p.owner.orders.get({ id: o.id })).lines;
    expect(lines.map((l) => l.lineNo)).toEqual([1, 2]);
    expect(lines[1]!.orderedG).toBe(kg(1));
  }, SLOW);

  test("[Z06] a PL number belongs to one dispatch of a company (and another company may reuse the text)", async () => {
    setClock(NOON);
    const p = await plant();
    const other = await plant();
    const d1 = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    const d2 = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    const o1 = await other.held(await other.pack(other.dieA, [{ kg: 10 }]), other.customerId);
    await p.owner.dispatch.complete({ id: d1 });
    await p.owner.dispatch.complete({ id: d2 });
    await other.owner.dispatch.complete({ id: o1 });
    const n1 = (await dispatchRow(d1)).plNumber!;
    expect((await dispatchRow(o1)).plNumber).toBe(n1); // same book position, different company: allowed
    await expect((async () => env.db.update(dispatch).set({ plNumber: n1 }).where(eq(dispatch.id, d2)))()).rejects.toThrow();
  }, SLOW);
});


// ===========================================================================
// Reviewer additions, fourth pass: Review Focus 5 approvals per line and per dispatch, status table, register, print contract.
// ===========================================================================

describe("Review Focus 5: an approval is for one dispatch and for the lines it names", () => {
  test("[G05] an approval that names line A never covers line B when a late link pushes B over", async () => {
    const p = await plant();
    const oa = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const ob = await p.order([{ dieId: p.dieB, kg: 1000 }]);
    const [lineA, lineB] = [oa.lineIds[0]!, ob.lineIds[0]!];
    const sa = await p.pack(p.dieA, [{ kg: 600 }, { kg: 600 }], lineA); // 1200 kg on A: over its 1050 kg limit
    const sb = await p.pack(p.dieB, [{ kg: 500 }, { kg: 600 }], lineB);
    const d = await p.held([...sa, ...sb]);
    const unlinked = (await itemsOf(d)).find((i) => i.serial === sb[1])!;
    await p.owner.dispatch.linkItem({ itemId: unlinked.id, salesOrderLineId: null }); // B holds only 500 kg: inside its limit
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [req] = await pendingOverdraw(p.companyId, d);
    expect((req!.meta as { lines: { lineId: string }[] }).lines.map((l) => l.lineId)).toEqual([lineA]);
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    // 600 kg is linked to B just after complete read the dispatch: B reaches 1100 kg (limit 1050), A's approval says 1200 kg.
    env.beforeNextBatch(() => p.owner.dispatch.linkItem({ itemId: unlinked.id, salesOrderLineId: lineB }));
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await dispatchRow(d)).status).toBe("reserved");
    expect((await p.lineOf(lineB)).dispatchedG).toBe(0);
  }, SLOW);

  test("[G12] another dispatch's approval does not make this dispatch look covered: it opens its own request", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const x = await p.held(await p.pack(p.dieA, [{ kg: 600 }, { kg: 600 }], o.lineIds[0]));
    await expect(p.owner.dispatch.complete({ id: x })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const [reqX] = await pendingOverdraw(p.companyId, x);
    await p.as("manager").approval.decide({ id: reqX!.id, decision: "approved" }); // X is approved but never completed
    const y = await p.held(await p.pack(p.dieA, [{ kg: 550 }, { kg: 550 }], o.lineIds[0])); // 1100 kg: over 1050
    await expect(p.owner.dispatch.complete({ id: y })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await pendingOverdraw(p.companyId, y)).toHaveLength(1);
    expect((await dispatchRow(y)).status).toBe("reserved");
  }, SLOW);

  test("[Z13] the refusal tells the office which order line is over, by how much, and the limit, in kg", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const d = await p.held(await p.pack(p.dieA, [{ kg: 500 }, { kg: 551 }], o.lineIds[0]));
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining(`${o.number} line 1 by 1.000 kg (limit 1,050.000 kg)`),
    });
  }, SLOW);
});

describe("order status table, ordering and the line filter", () => {
  test("[O32 O34] a confirmed order can be cancelled; a closed one cannot", async () => {
    const p = await plant();
    const a = await p.order([{ dieId: p.dieA, kg: 100 }]);
    await confirmOrder(p.owner, a.id);
    await cancelOrder(p.owner, a.id);
    expect(await orderStatus(p, a.id)).toBe("cancelled");
    const b = await p.order([{ dieId: p.dieA, kg: 100 }]);
    await closeOrder(p.owner, b.id);
    await expect(cancelOrder(p.owner, b.id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await orderStatus(p, b.id)).toBe("closed");
  }, SLOW);

  test("[R08] a line number removed in one edit is not handed out again by the next edit", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }, { dieId: p.dieB, kg: 100 }]);
    const [l1] = o.lineIds as [string, string];
    const keep = { id: l1, sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(100) };
    await saveOrder(p.owner, { id: o.id, lines: [keep] }); // line 2 goes
    await saveOrder(p.owner, { id: o.id, lines: [keep, { sectionId: p.dieB, cutLengthMm: 3_658, kgG: kg(5) }] });
    expect((await p.owner.orders.get({ id: o.id })).lines.map((l) => l.lineNo)).toEqual([1, 3]);
  }, SLOW);

  test("[O19b] orders of one date: the one entered first comes first, in the balance and in the open lines", async () => {
    const p = await plant();
    const line = [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(10) }];
    setClock(ist("2026-10-03T09:00:00"));
    const first = await p.owner.orders.create({ customerId: p.customerId, orderDate: "2026-10-03", lines: line });
    setClock(ist("2026-10-03T15:00:00"));
    const second = await p.owner.orders.create({ customerId: p.customerId, orderDate: "2026-10-03", lines: line });
    expect((await p.owner.orders.balance({})).lines.map((l) => l.orderId)).toEqual([first.id, second.id]);
    expect((await p.owner.orders.openLines({ dieId: p.dieA })).map((l) => l.orderId)).toEqual([first.id, second.id]);
  }, SLOW);

  test("[O19c E41] orders entered in the same instant on one date come in number order (SO-9 before SO-10)", async () => {
    setClock(NOON);
    const p = await plant();
    const ids: string[] = [];
    for (let i = 0; i < 11; i += 1) {
      ids.push((await p.owner.orders.create({ customerId: p.customerId, orderDate: "2026-10-03", lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(10) }] })).id);
    }
    expect((await p.owner.orders.openLines({ dieId: p.dieA })).map((l) => l.orderId)).toEqual(ids); // chunked path (JS sort)
    expect((await p.owner.orders.balance({})).lines.map((l) => l.orderId)).toEqual(ids); // unfiltered path (SQL order by)
  }, 120_000);

  test("[O16] lineBalances can be asked for specific line ids (PL-11 reuses it)", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }, { dieId: p.dieB, kg: 200 }, { dieId: p.dieA, kg: 300 }]);
    const { lineBalances } = await import("../src/lib/orders");
    const some = await lineBalances(env.db as never, p.companyId, { lineIds: [o.lineIds[1]!] });
    expect(some.map((l) => [l.lineId, l.orderedG])).toEqual([[o.lineIds[1]!, kg(200)]]);
  }, SLOW);
});

describe("sales register: company scope and order of rows", () => {
  test("[T05] another company's dispatch wired to this company's customer is not in this company's register", async () => {
    setClock(ist("2026-10-05T11:00:00"));
    const p = await plant();
    const other = await plant();
    const od = await other.held(await other.pack(other.dieA, [{ kg: 5 }]), other.customerId);
    await other.owner.dispatch.complete({ id: od });
    await env.db.update(dispatch).set({ customerId: p.customerId }).where(eq(dispatch.id, od));
    const reg = await p.owner.reports.salesRegisterCsv({ month: "2026-10" });
    expect(reg.rows).toBe(0);
    expect(reg.csv.trimEnd().split("\r\n")).toHaveLength(1);
  }, SLOW);

  test("[T09] rows run in completion order, not in the order the dispatches were created", async () => {
    const p = await plant();
    const a = await p.held(await p.pack(p.dieA, [{ kg: 5 }]));
    const b = await p.held(await p.pack(p.dieA, [{ kg: 5 }]));
    const c = await p.held(await p.pack(p.dieA, [{ kg: 5 }]));
    for (const [hour, id] of [[10, c], [11, a], [12, b]] as const) {
      setClock(ist(`2026-10-05T${hour}:00:00`));
      await p.owner.dispatch.complete({ id });
    }
    const codes = (await p.owner.reports.salesRegisterCsv({ month: "2026-10" })).csv.trimEnd().split("\r\n").slice(1).map((l) => l.split(",").at(-1));
    expect(codes).toEqual([(await dispatchRow(c)).code, (await dispatchRow(a)).code, (await dispatchRow(b)).code]);
  }, SLOW);
});

describe("packing list print contract", () => {
  test("[Z14 Z15] the printed headings are the eleven columns of the plant's PL, in order", async () => {
    const docs = (await import(DOCS_PATH)) as { PL_COLUMN_HEADINGS: readonly string[] };
    const snapMod = await import("../src/lib/packingListSnapshot");
    const printed = ["Sr", "Bundle no", "Section", "Item", "Weight kg", "Cut ft", "Cut in", "Pcs", "kg/12ft", "Range /12'", "PO"];
    expect([...docs.PL_COLUMN_HEADINGS]).toEqual(printed);
    expect(snapMod.PL_COLUMNS.map((c) => snapMod.PL_COLUMN_LABELS[c])).toEqual(printed);
  });

  test("[H05] the v2 print shows the customer's GSTIN (bill-to and ship-to), not only the company's", async () => {
    setClock(NOON);
    const docs = (await import(DOCS_PATH)) as { buildPackingListHtml(pl: never, code: string): string };
    const p = await plant();
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    const done = await p.owner.dispatch.complete({ id: d });
    const html = docs.buildPackingListHtml((await plRow(d))!.snapshot as never, done.plNumber);
    expect(html.split("24ABCDE1234F1Z9").length - 1).toBeGreaterThanOrEqual(2); // bill-to and ship-to
  }, SLOW);

  test("[N13] the item text is the section's own name when it has one, else its series", () => {
    // pure builder call, same shape as the buildPlSnapshotV2 describe above
    return (async () => {
      const mod = await import("../src/lib/packingListSnapshot");
      const base = {
        plNumber: "PL/2026-27/1", date: "2026-10-03", generatedAt: new Date("2026-10-03T06:30:00Z"), generatedBy: "u1",
        company: { id: "c1", name: "Fourcubes", settings: null },
        dispatch: { code: "D-1", status: "completed", shipDate: null, notes: null, completedAt: new Date("2026-10-03T06:30:00Z"),
          vehicleNo: null, driverName: null, driverPhone: null, transporter: null, invoiceNumber: null, invoiceDate: null },
        customer: { id: "k1", name: "Shree Metals", phone: null, email: null, billingAddress: null, shippingAddress: null, taxId: null },
      };
      const item = (serial: string, sectionName: string | null) => ({
        bundleId: `b-${serial}`, serial, quantity: 10, weightG: 25_500, lengthMm: 3_658, kgPer12ftMilli: null, bundlePo: null,
        bundleGroupId: "g1", groupLabel: null, dieId: "dieA", series: "Domal", sectionCode: "12170", sectionName, line: null,
      });
      const named = mod.buildPlSnapshotV2({ ...base, items: [item("26I1", "Domal Plus")] } as never);
      expect(named.groups[0]!.item).toBe("Domal Plus");
      const plain = mod.buildPlSnapshotV2({ ...base, items: [item("26I1", null)] } as never);
      expect(plain.groups[0]!.item).toBe("Domal");
    })();
  });
});
