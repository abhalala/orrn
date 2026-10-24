// PL8 tests review r1 (reviewer-authored, NOT part of the PL8 diff).
// Install as packages/server/test/plant-sales-r1.test.ts on wt/PL8. Each bracketed id in a title is a mutant of
// reviews/PL8-tests-r1-mutants.py that the three PL8 files at c777685 leave alive and the test kills.
// Uses test/sales-fixture.ts (same helpers as the installed files).
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { approval, auditLog, bundle, dispatch, dispatchItem, salesOrderLine } from "@orrn/db/schema";
import { and, asc, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { kg, NOON, salesHelpers, SLOW } from "./sales-fixture";

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

const { plant, itemsOf, dispatchRow, pendingOverdraw } = salesHelpers(() => env);

const orders = () => import("../src/lib/orders");

// ---------------------------------------------------------------------------------------------------
// Totals in SQL (lineTotals / orderTotals): per-line floors, produced kg, id chunks
// ---------------------------------------------------------------------------------------------------
describe("report totals come from SQL and match the per-line figures", () => {
  test("[F31 F33] orders.balance and orders.list totals: baki and excess are floored per line, produced kg is summed", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }, { dieId: p.dieA, kg: 100 }]);
    const [l1, l2] = o.lineIds as [string, string];
    // Line 1: 104 kg leave on a 100 kg line (inside the 5 % tolerance): baki 0, excess 4 kg.
    const d1 = await p.held(await p.pack(p.dieA, [{ kg: 104 }], l1));
    await p.owner.dispatch.complete({ id: d1 });
    // Line 2: 30 kg leave, 20 kg more are packed for it and still in stock: baki 70, produced 50.
    const d2 = await p.held(await p.pack(p.dieA, [{ kg: 30 }], l2));
    await p.owner.dispatch.complete({ id: d2 });
    await p.pack(p.dieA, [{ kg: 20 }], l2);

    const bal = await p.owner.orders.balance({});
    expect(bal.lines.map((l) => [l.orderedG, l.producedG, l.dispatchedG, l.bakiG, l.overG])).toEqual([
      [kg(100), kg(104), kg(104), 0, kg(4)],
      [kg(100), kg(50), kg(30), kg(70), 0],
    ]);
    expect(bal.totals).toEqual({ lines: 2, orderedG: kg(200), producedG: kg(154), dispatchedG: kg(134), bakiG: kg(70), overG: kg(4) });
    const [row] = (await p.owner.orders.list({})).items;
    expect(row).toMatchObject({ lines: 2, orderedG: kg(200), producedG: kg(154), dispatchedG: kg(134), bakiG: kg(70), overG: kg(4) });
  }, SLOW);

  test("[F37 F38 F42] lineTotals over an id list: every id counted once, in statements of at most 100 parameters", async () => {
    const p = await plant();
    const lines = Array.from({ length: 100 }, () => ({ sectionId: p.dieA, cutLengthMm: 3_000, kgG: kg(1), pcs: 1 }));
    const { id } = await p.owner.orders.create({ customerId: p.customerId, lines });
    const ids = (await p.owner.orders.get({ id })).lines.map((l) => l.lineId);
    const { lineTotals } = await orders();
    env.resetPeakParams();
    // 100 ids, then the first ten again (a caller's list may repeat): still 100 lines and 100 kg.
    const t = await lineTotals(env.db as never, p.companyId, { lineIds: [...ids, ...ids.slice(0, 10)] });
    expect(t).toMatchObject({ lines: 100, orderedG: kg(100), bakiG: kg(100) });
    expect(env.peakParams()).toBeLessThanOrEqual(100);
  }, SLOW);
});

// ---------------------------------------------------------------------------------------------------
// lineBalancePage / lineBalances: guards of the library calls PL-11 will reuse
// ---------------------------------------------------------------------------------------------------
describe("lineBalancePage and lineBalances guards", () => {
  test("[F07 F09 F10 F21] one page: at most 80 ids, a limit of at least 1, no negative offset, an empty id list is empty", async () => {
    const p = await plant();
    await p.order([{ dieId: p.dieA, kg: 10 }, { dieId: p.dieA, kg: 20 }, { dieId: p.dieA, kg: 30 }]);
    const { lineBalancePage } = await orders();
    const db = env.db as never;
    await expect(
      lineBalancePage(db, p.companyId, { dieIds: Array.from({ length: 81 }, (_, i) => `die-${i}`) }, { limit: 10 }),
    ).rejects.toThrow(/at most 80/);
    const one = await lineBalancePage(db, p.companyId, {}, { limit: 0 });
    expect(one.lines).toHaveLength(1);
    expect(one.nextOffset).toBe(1);
    const neg = await lineBalancePage(db, p.companyId, {}, { limit: 2, offset: -5 });
    expect(neg.lines.map((l) => l.orderedG)).toEqual([kg(10), kg(20)]);
    expect(neg.nextOffset).toBe(2);
    expect(await lineBalancePage(db, p.companyId, { dieIds: [] }, { limit: 10 })).toEqual({ lines: [], nextOffset: null });
    expect(await lineBalancePage(db, p.companyId, { orderIds: [] }, { limit: 10 })).toEqual({ lines: [], nextOffset: null });
  }, SLOW);

  test("[E40 F23] lineBalances over more than 80 ids restores oldest-ORDER-DATE-first across chunks and reads each id once", async () => {
    const p = await plant();
    const lines = Array.from({ length: 100 }, () => ({ sectionId: p.dieA, cutLengthMm: 3_000, kgG: kg(1), pcs: 1 }));
    // The newer-dated order is entered first, the older-dated one second: entry time and order date disagree.
    const newer = await p.owner.orders.create({ customerId: p.customerId, orderDate: "2026-10-05", lines });
    const older = await p.owner.orders.create({
      customerId: p.customerId,
      orderDate: "2026-10-01",
      lines: [{ sectionId: p.dieA, cutLengthMm: 3_000, kgG: kg(7), pcs: 1 }],
    });
    const newerIds = (await p.owner.orders.get({ id: newer.id })).lines.map((l) => l.lineId);
    const olderId = (await p.owner.orders.get({ id: older.id })).lines[0]!.lineId;
    const { lineBalances } = await orders();
    // 80 + 1 ids: the first chunk holds only the newer order's lines. The first ten ids come again at the end.
    const got = await lineBalances(env.db as never, p.companyId, {
      lineIds: [...newerIds.slice(0, 80), olderId, ...newerIds.slice(0, 10)],
    });
    expect(got).toHaveLength(81);
    expect(got[0]!.lineId).toBe(olderId);
    expect(got.slice(1).map((l) => l.lineNo)).toEqual(Array.from({ length: 80 }, (_, i) => i + 1));
  }, SLOW);

  test("[F05 F08] a filter that matches more than 1,000 lines throws instead of cutting; a page never exceeds 1,000", async () => {
    setClock(NOON);
    const p = await plant();
    const lines = Array.from({ length: 100 }, () => ({ sectionId: p.dieA, cutLengthMm: 3_000, kgG: kg(1), pcs: 1 }));
    for (let n = 0; n < 11; n += 1) await p.owner.orders.create({ customerId: p.customerId, lines });
    const { lineBalances, lineBalancePage } = await orders();
    const db = env.db as never;
    // The id-list path (dieIds) must refuse too, not only the unfiltered one.
    await expect(lineBalances(db, p.companyId, { dieIds: [p.dieA] })).rejects.toThrow(/more than 1000/i);
    const page = await lineBalancePage(db, p.companyId, {}, { limit: 5_000 });
    expect(page.lines).toHaveLength(1000);
    expect(page.nextOffset).toBe(1000);
  }, 180_000);
});

// ---------------------------------------------------------------------------------------------------
// The scan's fallback line: newest open line of the customer and section
// ---------------------------------------------------------------------------------------------------
describe("scan fallback line", () => {
  test("[F17 F20 F15] the excess goes to the newest ORDER DATE's LAST line, not the oldest or the first", async () => {
    const p = await plant();
    const line = (kgG: number) => ({ sectionId: p.dieA, cutLengthMm: 3_658, kgG, pcs: null });
    // A is dated later but entered first; B is dated earlier and entered second.
    const a = await p.owner.orders.create({ customerId: p.customerId, orderDate: "2026-10-05", lines: [line(kg(100)), line(kg(100))] });
    const b = await p.owner.orders.create({ customerId: p.customerId, orderDate: "2026-10-01", lines: [line(kg(100))] });
    const [a1, a2] = (await p.owner.orders.get({ id: a.id })).lines.map((l) => l.lineId) as [string, string];
    const [b1] = (await p.owner.orders.get({ id: b.id })).lines.map((l) => l.lineId) as [string];
    const d = await p.held(await p.pack(p.dieA, [{ kg: 100 }, { kg: 100 }, { kg: 100 }, { kg: 100 }, { kg: 100 }]));
    // Oldest order date first (B), then A's lines; the 4th and 5th bundle meet the newest order's last line.
    expect((await itemsOf(d)).map((i) => i.lineId)).toEqual([b1, a1, a2, a2, a2]);
  }, SLOW);
});

// ---------------------------------------------------------------------------------------------------
// Completion: the bundle's line comes from this dispatch's own item
// ---------------------------------------------------------------------------------------------------
describe("complete: produced follows this dispatch's item", () => {
  test("[D04c] a bundle that was linked on a cancelled dispatch and leaves unlinked on another counts as produced for no line", async () => {
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 300 }], o.lineIds[0]);
    const first = await p.held(serials); // linked to the line
    expect((await itemsOf(first))[0]!.lineId).toBe(o.lineIds[0]!);
    await p.owner.dispatch.cancel({ id: first });
    expect((await p.lineOf(o.lineIds[0]!)).producedG).toBe(kg(300));
    // The same bundle goes out for a customer with no order: its item on the new dispatch has no line.
    // D12: the scan refuses another customer's bundle, so it goes out for them by a customer change
    // on the dispatch after the scan (unlinked first, as the office would).
    const { id: second } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ id: second, serials });
    await p.owner.dispatch.linkItem({ itemId: (await itemsOf(second))[0]!.id, salesOrderLineId: null });
    await p.owner.dispatch.update({ id: second, customerId: p.otherCustomer });
    await p.owner.dispatch.reserve({ id: second });
    expect((await itemsOf(second))[0]!.lineId).toBeNull();
    await p.owner.dispatch.complete({ id: second });
    expect(await p.lineOf(o.lineIds[0]!)).toMatchObject({ producedG: 0, dispatchedG: 0, bakiG: kg(1000) });
    const [b] = await env.db.select({ line: bundle.salesOrderLineId }).from(bundle).where(and(eq(bundle.companyId, p.companyId), eq(bundle.serial, serials[0]!)));
    expect(b!.line).toBeNull();
  }, SLOW);
});

// keep the imports honest
void [approval, auditLog, dispatch, dispatchItem, salesOrderLine, asc, dispatchRow, pendingOverdraw];
