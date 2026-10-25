/**
 * FINAL-EXPLORE-FIXES (explore/final.md):
 * M1 `orders.reallocate` stays under D1's 100 bound values at its own limit (100 bundles, both the
 *    applied and the approval path) and refuses 150 as a bad request, never a 500.
 * Round 1 (review): I3 plant stock resets the party number and every renumber flags the sticker;
 *    m3 party numbers are allocated only for bundles that really move (no gaps).
 * M4 a bundle that goes to another customer takes that customer's party number (its own series),
 *    the old number is kept in the move's audit row, and the new customer's PL v2 prints the new one.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, bundle, customer } from "@orrn/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { NOON, salesHelpers, SLOW, type SalesPlant } from "./sales-fixture";

/** @orrn/documents is a client package (it imports this one): load it by path, outside this package's type check. */
const DOCS_PATH = "../../documents/src/packing-list/index";

let env: TestEnv;
let setClock: (at: Date | null) => void;
let plSchema: typeof import("../src/lib/packingListSnapshot").plSnapshotV2Schema;
type Snap = import("../src/lib/packingListSnapshot").PlSnapshotV2;

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
  plSchema = (await import("../src/lib/packingListSnapshot")).plSnapshotV2Schema;
}, 60_000);
afterEach(() => setClock(null));
afterAll(async () => {
  await env.dispose();
});

const { plant, plRow } = salesHelpers(() => env);

async function setPolicy(p: SalesPlant, customerId: string, policy: "monthly" | "fy" | "lifelong" | null) {
  const [c] = await env.db.select({ name: customer.name }).from(customer).where(eq(customer.id, customerId));
  await p.owner.customer.update({ id: customerId, name: c!.name, bundleNumberPolicy: policy });
}

async function bundlesOf(p: SalesPlant, serials: string[]) {
  const out = [];
  for (let i = 0; i < serials.length; i += 50) {
    out.push(
      ...(await env.db
        .select({ id: bundle.id, serial: bundle.serial, partyNo: bundle.partyNo, lineId: bundle.salesOrderLineId, stale: bundle.stickerStale, status: bundle.status })
        .from(bundle)
        .where(and(eq(bundle.companyId, p.companyId), inArray(bundle.serial, serials.slice(i, i + 50))))
        .orderBy(asc(bundle.serial))),
    );
  }
  return out.sort((a, b) => a.serial.localeCompare(b.serial));
}

describe("M1: reallocate at its limit stays under D1's bound values", () => {
  test("100 bundles to another line of the same customer: applied, every one moved", async () => {
    const p = await plant();
    const from = await p.order([{ dieId: p.dieA, kg: 1_000 }]);
    const to = await p.order([{ dieId: p.dieA, kg: 1_000 }]);
    const serials = await p.pack(p.dieA, Array.from({ length: 100 }, () => ({ kg: 1 })), from.lineIds[0]);
    const rows = await bundlesOf(p, serials);
    const res = await p.owner.orders.reallocate({ bundleIds: rows.map((r) => r.id), toLineId: to.lineIds[0]!, reason: "Whole lot to the second order" });
    expect(res).toMatchObject({ status: "applied", moved: 100 });
    expect((await bundlesOf(p, serials)).every((b) => b.lineId === to.lineIds[0])).toBe(true);
  }, SLOW);

  test("100 bundles to another customer: one request, and the approval moves all 100", async () => {
    const p = await plant();
    const from = await p.order([{ dieId: p.dieA, kg: 1_000 }]);
    const to = await p.order([{ dieId: p.dieA, kg: 1_000 }], { customerId: p.otherCustomer });
    const serials = await p.pack(p.dieA, Array.from({ length: 100 }, () => ({ kg: 1 })), from.lineIds[0]);
    const rows = await bundlesOf(p, serials);
    const res = await p.owner.orders.reallocate({ bundleIds: rows.map((r) => r.id), toLineId: to.lineIds[0]!, reason: "Customer asked" });
    expect(res.status).toBe("pending");
    // A second ask for the same 100 is a clean conflict (the pending read is chunked too).
    await expect(p.owner.orders.reallocate({ bundleIds: rows.map((r) => r.id), toLineId: to.lineIds[0]!, reason: "again" })).rejects.toMatchObject({ code: "CONFLICT" });
    await p.as("manager").approval.decide({ id: res.approvalId!, decision: "approved" });
    expect((await bundlesOf(p, serials)).every((b) => b.lineId === to.lineIds[0])).toBe(true);
  }, SLOW);

  test("150 bundles: refused as a bad request naming the limit (never a 500)", async () => {
    const p = await plant();
    const from = await p.order([{ dieId: p.dieA, kg: 1_000 }]);
    const to = await p.order([{ dieId: p.dieA, kg: 1_000 }]);
    const serials = await p.pack(p.dieA, Array.from({ length: 150 }, () => ({ kg: 1 })), from.lineIds[0]);
    const rows = await bundlesOf(p, serials);
    await expect(p.owner.orders.reallocate({ bundleIds: rows.map((r) => r.id), toLineId: to.lineIds[0]!, reason: "too many" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("At most 100 bundles"),
    });
    // Two calls of 75 (what a screen does past the limit) both work.
    await p.owner.orders.reallocate({ bundleIds: rows.slice(0, 75).map((r) => r.id), toLineId: to.lineIds[0]!, reason: "first half" });
    await p.owner.orders.reallocate({ bundleIds: rows.slice(75).map((r) => r.id), toLineId: to.lineIds[0]!, reason: "second half" });
    expect((await bundlesOf(p, serials)).every((b) => b.lineId === to.lineIds[0])).toBe(true);
  }, SLOW);
});

describe("M4: the new customer's party number after a reallocation", () => {
  test("approved move: KD's monthly numbers become the new customer's fy numbers; audit keeps the old; PL v2 prints the new", async () => {
    setClock(NOON);
    const p = await plant();
    await setPolicy(p, p.customerId, "monthly");
    await setPolicy(p, p.otherCustomer, "fy");
    const kd = await p.order([{ dieId: p.dieA, kg: 1_000 }]);
    const royal = await p.order([{ dieId: p.dieA, kg: 1_000 }], { customerId: p.otherCustomer });
    // Royal already has one bundle of its own series (2026-27/1); the moved ones continue it.
    const royalOwn = await p.pack(p.dieA, [{ kg: 9 }], royal.lineIds[0]);
    const serials = await p.pack(p.dieA, [{ kg: 10 }, { kg: 11 }], kd.lineIds[0]);
    const before = await bundlesOf(p, serials);
    expect(before.map((b) => b.partyNo)).toEqual(["26J1", "26J2"]);
    expect((await bundlesOf(p, royalOwn))[0]!.partyNo).toBe("2026-27/1");

    const req = await p.owner.orders.reallocate({ bundleIds: before.map((b) => b.id), toLineId: royal.lineIds[0]!, reason: "Royal needs them first" });
    expect(req.status).toBe("pending");
    // Nothing is renumbered while the request waits.
    expect((await bundlesOf(p, serials)).map((b) => b.partyNo)).toEqual(["26J1", "26J2"]);
    await p.as("manager").approval.decide({ id: req.approvalId!, decision: "approved" });
    const after = await bundlesOf(p, serials);
    expect(after.map((b) => b.partyNo)).toEqual(["2026-27/2", "2026-27/3"]);

    // The decision's audit row keeps the old numbers.
    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "order.reallocate")));
    const applied = audits.find((a) => (a.meta as { status?: string }).status === "applied")!;
    expect((applied.meta as { partyNos: unknown[] }).partyNos).toEqual([
      { bundleId: before[0]!.id, serial: serials[0], from: "26J1", to: "2026-27/2" },
      { bundleId: before[1]!.id, serial: serials[1], from: "26J2", to: "2026-27/3" },
    ]);

    // Royal's packing list prints Royal's numbers, never KD's.
    const d = await p.held([...royalOwn, ...serials], p.otherCustomer);
    await p.owner.dispatch.complete({ id: d });
    const snap = plSchema.parse((await plRow(d))!.snapshot) as Snap;
    expect(serials.map((s) => snap.rowInfo![s]!.partyNo)).toEqual(["2026-27/2", "2026-27/3"]);
    const html = ((await import(DOCS_PATH)) as { buildPackingListHtml(pl: never, code: string): string }).buildPackingListHtml(
      snap as never,
      snap.header.plNumber,
    );
    expect(html).toContain("2026-27/2");
    expect(html).not.toContain("26J1");
  }, SLOW);

  test("rejected: the numbers stay; a move within the same customer never renumbers", async () => {
    setClock(NOON);
    const p = await plant();
    await setPolicy(p, p.customerId, "monthly");
    await setPolicy(p, p.otherCustomer, "fy");
    const a = await p.order([{ dieId: p.dieA, kg: 1_000 }]);
    const b = await p.order([{ dieId: p.dieA, kg: 1_000 }]);
    const royal = await p.order([{ dieId: p.dieA, kg: 1_000 }], { customerId: p.otherCustomer });
    const serials = await p.pack(p.dieA, [{ kg: 10 }], a.lineIds[0]);
    const [one] = await bundlesOf(p, serials);
    const req = await p.owner.orders.reallocate({ bundleIds: [one!.id], toLineId: royal.lineIds[0]!, reason: "x" });
    await p.as("manager").approval.decide({ id: req.approvalId!, decision: "rejected", note: "no" });
    expect((await bundlesOf(p, serials))[0]!.partyNo).toBe("26J1");
    await p.owner.orders.reallocate({ bundleIds: [one!.id], toLineId: b.lineIds[0]!, reason: "same party" });
    expect((await bundlesOf(p, serials))[0]).toMatchObject({ partyNo: "26J1", lineId: b.lineIds[0] });
  }, SLOW);

  test("plant stock with no customer, put on a policy customer's line: applied now with that customer's number", async () => {
    setClock(NOON);
    const p = await plant();
    await setPolicy(p, p.otherCustomer, "lifelong");
    const royal = await p.order([{ dieId: p.dieA, kg: 1_000 }], { customerId: p.otherCustomer });
    const serials = await p.pack(p.dieA, [{ kg: 10 }]);
    const [legacy] = await bundlesOf(p, serials);
    expect(legacy!.partyNo).toBe(legacy!.serial);
    const res = await p.owner.orders.reallocate({ bundleIds: [legacy!.id], toLineId: royal.lineIds[0]!, reason: "allocate" });
    expect(res.status).toBe("applied");
    expect((await bundlesOf(p, serials))[0]!.partyNo).toBe("1");
    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "order.reallocate")));
    expect((audits.at(-1)!.meta as { partyNos: unknown[] }).partyNos).toEqual([{ bundleId: legacy!.id, serial: legacy!.serial, from: legacy!.serial, to: "1" }]);
  }, SLOW);
});

describe("round 1 I3: plant stock resets the party number; stickers are flagged", () => {
  test("to plant stock: the number goes back to the serial, the audit keeps the old one, the sticker is flagged, and Royal's PL never prints KD's number", async () => {
    setClock(NOON);
    const p = await plant();
    await setPolicy(p, p.customerId, "monthly");
    const kd = await p.order([{ dieId: p.dieA, kg: 1_000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 10 }, { kg: 11 }], kd.lineIds[0]);
    const before = await bundlesOf(p, serials);
    expect(before.map((b) => b.partyNo)).toEqual(["26J1", "26J2"]);
    expect(before.map((b) => b.stale)).toEqual([false, false]);

    const res = await p.owner.orders.reallocate({ bundleIds: [before[0]!.id], toLineId: null, reason: "back to the yard" });
    expect(res.status).toBe("applied");
    const after = await bundlesOf(p, serials);
    expect(after[0]).toMatchObject({ partyNo: serials[0], lineId: null, stale: true });
    expect(after[1]).toMatchObject({ partyNo: "26J2", stale: false });
    const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "order.reallocate")));
    expect((audits.at(-1)!.meta as { partyNos: unknown[] }).partyNos).toEqual([{ bundleId: before[0]!.id, serial: serials[0], from: "26J1", to: serials[0] }]);

    // A bundle whose number already is its serial (a customer with no number policy) is not touched or flagged.
    const plain = await p.order([{ dieId: p.dieA, kg: 1_000 }], { customerId: p.otherCustomer });
    const loose = await p.pack(p.dieA, [{ kg: 12 }], plain.lineIds[0]);
    const [one] = await bundlesOf(p, loose);
    expect(one!.partyNo).toBe(loose[0]!);
    await p.owner.orders.reallocate({ bundleIds: [one!.id], toLineId: null, reason: "y" });
    expect((await bundlesOf(p, loose))[0]).toMatchObject({ partyNo: loose[0], stale: false });

    // Scanned onto the other customer's load, it prints its plain serial.
    const d = await p.held([serials[0]!], p.otherCustomer);
    await p.owner.dispatch.complete({ id: d });
    const snap = plSchema.parse((await plRow(d))!.snapshot) as Snap;
    expect(snap.rowInfo![serials[0]!]!.partyNo).toBe(serials[0]!);
  }, SLOW);

  test("a move to another customer flags the sticker; a move inside one customer does not", async () => {
    setClock(NOON);
    const p = await plant();
    await setPolicy(p, p.customerId, "monthly");
    await setPolicy(p, p.otherCustomer, "fy");
    const a = await p.order([{ dieId: p.dieA, kg: 1_000 }]);
    const b = await p.order([{ dieId: p.dieA, kg: 1_000 }]);
    const royal = await p.order([{ dieId: p.dieA, kg: 1_000 }], { customerId: p.otherCustomer });
    const serials = await p.pack(p.dieA, [{ kg: 10 }, { kg: 11 }], a.lineIds[0]);
    const [one, two] = await bundlesOf(p, serials);
    await p.owner.orders.reallocate({ bundleIds: [one!.id], toLineId: b.lineIds[0]!, reason: "same party" });
    expect((await bundlesOf(p, serials)).map((x) => x.stale)).toEqual([false, false]);
    const req = await p.owner.orders.reallocate({ bundleIds: [two!.id], toLineId: royal.lineIds[0]!, reason: "Royal" });
    expect((await bundlesOf(p, serials)).map((x) => x.stale)).toEqual([false, false]);
    await p.as("manager").approval.decide({ id: req.approvalId!, decision: "approved" });
    expect((await bundlesOf(p, serials)).map((x) => x.stale)).toEqual([false, true]);
  }, SLOW);

  test("printing the label again clears the flag (the label sheet's Print), and the lists show it", async () => {
    setClock(NOON);
    const p = await plant();
    await setPolicy(p, p.customerId, "monthly");
    const kd = await p.order([{ dieId: p.dieA, kg: 1_000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 10 }, { kg: 11 }], kd.lineIds[0]);
    const rows = await bundlesOf(p, serials);
    await p.owner.orders.reallocate({ bundleIds: rows.map((r) => r.id), toLineId: null, reason: "yard" });
    const listed = await p.owner.bundle.listBundles({ search: serials[0]! });
    expect(listed.items.find((i: { serial: string }) => i.serial === serials[0])).toMatchObject({ stickerStale: true });
    expect((await p.owner.bundle.getBySerial({ serial: serials[1]! }))!.bundle).toMatchObject({ stickerStale: true });
    const res = await p.owner.bundle.labelsPrinted({ bundleIds: [rows[0]!.id] });
    expect(res).toMatchObject({ cleared: 1 });
    expect((await bundlesOf(p, serials)).map((x) => x.stale)).toEqual([false, true]);
    // Another plant's bundle id clears nothing; a second call clears nothing.
    expect(await p.owner.bundle.labelsPrinted({ bundleIds: [rows[0]!.id] })).toMatchObject({ cleared: 0 });
  }, SLOW);
});

describe("round 1 m3: party numbers only for bundles that really move", () => {
  test("a bundle gone from the request at the decision burns no number: the series has no gap", async () => {
    setClock(NOON);
    const p = await plant();
    await setPolicy(p, p.customerId, "monthly");
    await setPolicy(p, p.otherCustomer, "fy");
    const kd = await p.order([{ dieId: p.dieA, kg: 1_000 }]);
    const royal = await p.order([{ dieId: p.dieA, kg: 1_000 }], { customerId: p.otherCustomer });
    const serials = await p.pack(p.dieA, [{ kg: 10 }, { kg: 11 }, { kg: 12 }], kd.lineIds[0]);
    const rows = await bundlesOf(p, serials);
    const req = await p.owner.orders.reallocate({ bundleIds: rows.map((r) => r.id), toLineId: royal.lineIds[0]!, reason: "Royal" });
    expect(req.status).toBe("pending");
    // The middle one is voided while the request waits.
    await env.db.update(bundle).set({ status: "void" }).where(eq(bundle.id, rows[1]!.id));
    await p.as("manager").approval.decide({ id: req.approvalId!, decision: "approved" });
    const after = await bundlesOf(p, serials);
    expect(after.map((b) => b.partyNo)).toEqual(["2026-27/1", "26J2", "2026-27/2"]);
    // Royal's next own bundle continues at 3.
    const next = await p.pack(p.dieA, [{ kg: 9 }], royal.lineIds[0]);
    expect((await bundlesOf(p, next))[0]!.partyNo).toBe("2026-27/3");
  }, SLOW);
});

describe("BACKLOG 89: the approver sees where the bundles are now", () => {
  test("move facts: live state, who would move, who takes a new party number; a bundle voided meanwhile does not count", async () => {
    setClock(NOON);
    const p = await plant();
    await setPolicy(p, p.customerId, "monthly");
    await setPolicy(p, p.otherCustomer, "fy");
    const kd = await p.order([{ dieId: p.dieA, kg: 1_000 }]);
    const royal = await p.order([{ dieId: p.dieA, kg: 1_000 }], { customerId: p.otherCustomer });
    const serials = await p.pack(p.dieA, [{ kg: 10 }, { kg: 11 }], kd.lineIds[0]);
    const rows = await bundlesOf(p, serials);
    const req = await p.owner.orders.reallocate({ bundleIds: rows.map((r) => r.id), toLineId: royal.lineIds[0]!, reason: "Royal" });
    const manager = p.as("manager");
    const facts = await manager.approval.facts({ id: req.approvalId! });
    expect(facts).toMatchObject({
      kind: "order_reallocate",
      target: { orderOpen: true, partyRule: "series", lineNo: 1 },
      willMove: { count: 2 },
    });
    if (facts?.kind !== "order_reallocate") throw new Error("move facts");
    expect(facts.bundles.map((b) => [b.partyNo, b.willMove, b.renumbers])).toEqual([
      ["26J1", true, true],
      ["26J2", true, true],
    ]);
    await env.db.update(bundle).set({ status: "void" }).where(eq(bundle.id, rows[1]!.id));
    const later = await manager.approval.facts({ id: req.approvalId! });
    expect(later).toMatchObject({ willMove: { count: 1 } });
  }, SLOW);
});
