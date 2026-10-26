/**
 * W1-OP-HOLD: hold stock against a line (FP-OP-17; C9 "Put on sales order"; BACKLOG rank 32).
 * `orders.hold` / `orders.release` (order.manage) mark yard bundles held for an open line; the
 * bundles stay `available` where they are; the strip shows `heldG` / `heldPcs` and `planableG`
 * takes off the held kg not already packed for the line; a scan onto another customer's dispatch
 * is refused "Held for SO-n (customer)"; this customer's dispatch takes them and the hold ends at
 * completion; reallocating a held bundle needs the hold released first; audited, no ledger rows.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { auditLog, bundle, customer, dispatch, stockLedger } from "@orrn/db/schema";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { Miniflare } from "miniflare";

import { can, type Action } from "../src/lib/permissions";
import { createTestEnv, type TestEnv } from "./harness";
import { FT12, FT18, opHelpers, type OpPlant } from "./orders-w1-fixture";
import { kg, ROLES, SLOW } from "./sales-fixture";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { opPlant, dispatchRow, itemsOf } = opHelpers(() => env);

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/src/migrations");

async function rowsOf(p: OpPlant, serials: string[]) {
  return env.db
    .select()
    .from(bundle)
    .where(and(eq(bundle.companyId, p.companyId), inArray(bundle.serial, serials)))
    .orderBy(asc(bundle.serial));
}
async function idsOf(p: OpPlant, serials: string[]) {
  return (await rowsOf(p, serials)).map((b) => b.id);
}
async function ledgerCount(companyId: string) {
  const [r] = await env.db.select({ n: count() }).from(stockLedger).where(eq(stockLedger.companyId, companyId));
  return r?.n ?? 0;
}
async function audits(companyId: string, action: string) {
  return env.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, action)))
    .orderBy(asc(auditLog.at), asc(auditLog.id));
}
async function customerName(id: string) {
  const [c] = await env.db.select({ name: customer.name }).from(customer).where(eq(customer.id, id));
  return c!.name;
}
async function strip(p: OpPlant, orderId: string, lineNo = 0) {
  return (await p.owner.orders.balance({ orderId })).lines[lineNo]!.strip;
}

/** One section + copy; order A (this customer, 1 t) and order B (the other customer, 1 t) on it. */
async function setup(p: OpPlant) {
  const s = await p.section();
  await p.copy(s, { milli: 12_000 });
  const a = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]);
  const b = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }], { customerId: p.otherCustomer });
  return { s, a, b, la: a.lineIds[0]!, lb: b.lineIds[0]! };
}

describe("orders.hold: happy path and the strip", () => {
  test("yard bundles held for an open line stay available; heldG on the strip; planable takes them off once; audited; no ledger rows", async () => {
    const p = await opPlant();
    const { s, a, la } = await setup(p);
    const yard = await p.pack(s, [{ kg: 300 }, { kg: 200 }]); // on no line
    const own = await p.pack(s, [{ kg: 100, pcs: 5 }], la); // already on line A
    const ledgerBefore = await ledgerCount(p.companyId);

    const res = await p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, [...yard, ...own]), note: "Buyer asked twice" });
    expect(res).toMatchObject({ lineId: la, orderId: a.id, orderNumber: a.number, alreadyHeld: [], kgG: kg(600), warnings: [] });
    expect([...res.held].sort()).toEqual([...yard, ...own].sort());

    // Held in yard 600 kg (30 pcs); packed / in stock still count only the bundle ON the line;
    // planable = 1000 − 100 packed − 500 held in yard (the bundle on the line is not taken off twice).
    expect(await strip(p, a.id)).toMatchObject({
      orderedG: kg(1_000),
      packedG: kg(100),
      inStockG: kg(100),
      heldG: kg(600),
      heldPcs: 25,
      heldBundles: 3,
      bakiG: kg(1_000),
      planableG: kg(400),
    });
    expect(res.strip).toMatchObject({ heldG: kg(600), planableG: kg(400) });

    const rows = await rowsOf(p, [...yard, ...own]);
    for (const r of rows) {
      expect(r.status).toBe("available");
      expect(r.heldForLineId).toBe(la);
      expect(r.heldAt).toBeInstanceOf(Date);
    }
    expect((await rowsOf(p, yard)).map((r) => r.salesOrderLineId)).toEqual([null, null]);
    expect(await ledgerCount(p.companyId)).toBe(ledgerBefore);

    const [audit] = await audits(p.companyId, "order.hold");
    expect(audit).toMatchObject({ subjectType: "sales_order_line", subjectId: la });
    expect(audit!.meta).toMatchObject({ orderId: a.id, orderNumber: a.number, lineNo: 1, kgG: kg(600), pcs: 25, note: "Buyer asked twice" });

    // The order timeline shows the hold; the holds list names each bundle.
    const timeline = await p.owner.orders.timeline({ id: a.id });
    expect(timeline.events.map((e) => e.action)).toContain("order.hold");
    const holds = await p.owner.orders.holds({ lineId: la });
    expect(holds).toMatchObject({ total: 3, heldG: kg(600), nextOffset: null });
    expect(holds.items.map((i) => i.serial).sort()).toEqual([...yard, ...own].sort());

    // Holding again is calm: reported, not re-held, no second audit row.
    const again = await p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, yard) });
    expect(again).toMatchObject({ held: [], kgG: 0 });
    expect([...again.alreadyHeld].sort()).toEqual([...yard].sort());
    expect(await audits(p.companyId, "order.hold")).toHaveLength(1);
  }, SLOW);

  test("a different cut length is held with a warning (like reallocate)", async () => {
    const p = await opPlant();
    const { s, la } = await setup(p);
    const long = await p.pack(s, [{ kg: 250, mm: FT18 }]);
    const res = await p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, long) });
    expect(res.held).toEqual(long);
    expect(res.warnings).toEqual([
      { bundleId: (await idsOf(p, long))[0]!, serial: long[0]!, kind: "length_mismatch", bundleLengthMm: FT18, lineLengthMm: FT12 },
    ]);
    expect((await audits(p.companyId, "order.hold"))[0]!.meta).toMatchObject({ lengthMismatch: long });
  }, SLOW);
});

describe("orders.hold: refusals", () => {
  test("wrong die, on a dispatch, pending reallocation, not available, on another line, held elsewhere, closed order, > 100", async () => {
    const p = await opPlant();
    const { s, a, la, lb } = await setup(p);
    const other = await p.section();
    await p.copy(other, { milli: 12_000 });
    const second = await p.confirmedOrder([{ sectionId: s, kgG: kg(500) }]);
    const bad = (msg: string | RegExp) => ({ code: "BAD_REQUEST", message: expect.stringMatching(msg) });

    // Wrong die.
    const [wrongDie] = await p.pack(other, [{ kg: 100 }]);
    await expect(p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, [wrongDie!]) })).rejects.toMatchObject(
      bad(`${wrongDie} is a different die from that line`),
    );

    // On a live (draft) dispatch.
    const [onDraft] = await p.pack(s, [{ kg: 100 }], la);
    const { id: draft } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ id: draft, serials: [onDraft!] });
    const draftCode = (await dispatchRow(draft)).code;
    await expect(p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, [onDraft!]) })).rejects.toMatchObject(
      bad(`${onDraft} is on dispatch ${draftCode}; take it off the dispatch first`),
    );

    // Waiting on a reallocation approval (another customer's bundle asked for line A).
    const [theirs] = await p.pack(s, [{ kg: 100 }], lb);
    const req = await p.owner.orders.reallocate({ bundleIds: await idsOf(p, [theirs!]), toLineId: la, reason: "They agreed" });
    expect(req.status).toBe("pending");
    await expect(p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, [theirs!]) })).rejects.toMatchObject(
      bad(`${theirs} is waiting on a reallocation approval`),
    );

    // Not available (already dispatched).
    const [gone] = await p.pack(s, [{ kg: 100 }], la);
    const d = await p.held([gone!]);
    await p.owner.dispatch.complete({ id: d });
    await expect(p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, [gone!]) })).rejects.toMatchObject(
      bad(`${gone} is dispatched; only bundles in the yard can be held`),
    );

    // On another line: moved with reallocate, never held across.
    const [onB] = await p.pack(s, [{ kg: 100 }], lb);
    await expect(p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, [onB!]) })).rejects.toMatchObject(
      bad(/is on .* line 1; move it with Reallocate instead/),
    );

    // Already held for another line: release first.
    const [free] = await p.pack(s, [{ kg: 100 }]);
    await p.owner.orders.hold({ lineId: second.lineIds[0]!, bundleIds: await idsOf(p, [free!]) });
    await expect(p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, [free!]) })).rejects.toMatchObject(
      bad(`${free} is already held for ${second.number} line 1`),
    );

    // More than 100 bundles in one call (input validation).
    const many = Array.from({ length: 101 }, (_, i) => `b-${i}`);
    await expect(p.owner.orders.hold({ lineId: la, bundleIds: many })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Unknown bundle / line.
    await expect(p.owner.orders.hold({ lineId: la, bundleIds: ["nope"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.owner.orders.hold({ lineId: "nope", bundleIds: await idsOf(p, [free!]) })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // A closed order holds nothing.
    const [later] = await p.pack(s, [{ kg: 100 }]);
    await p.owner.orders.close({ id: a.id, reason: "Buyer stopped" });
    await expect(p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, [later!]) })).rejects.toMatchObject(
      bad(`${a.number} is closed; hold stock for an open order`),
    );

    // Nothing was held by any refused call.
    expect((await rowsOf(p, [wrongDie!, onDraft!, theirs!, gone!, onB!, later!])).every((r) => r.heldForLineId === null)).toBe(true);
  }, SLOW);

  test("write time: a bundle scanned onto a dispatch between hold's read and write fails the hold whole", async () => {
    const p = await opPlant();
    const { s, la } = await setup(p);
    const yard = await p.pack(s, [{ kg: 100 }, { kg: 100 }]);
    const { id: d } = await p.owner.dispatch.create({ customerId: p.otherCustomer });
    env.beforeNextBatch(() => p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true, id: d, serials: [yard[1]!] }));
    await expect(p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, yard) })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await rowsOf(p, yard)).map((r) => r.heldForLineId)).toEqual([null, null]);
    expect(await audits(p.companyId, "order.hold")).toHaveLength(0);
  }, SLOW);
});

describe("orders.release", () => {
  test("releases listed bundles or all of them; refuses bundles not held for the line; audited", async () => {
    const p = await opPlant();
    const { s, a, la } = await setup(p);
    const yard = await p.pack(s, [{ kg: 300 }, { kg: 200 }, { kg: 100 }]);
    const ids = await idsOf(p, yard);
    await p.owner.orders.hold({ lineId: la, bundleIds: ids });
    expect(await strip(p, a.id)).toMatchObject({ heldG: kg(600), planableG: kg(400) });

    const one = await p.owner.orders.release({ lineId: la, bundleIds: [ids[0]!], note: "Sold elsewhere" });
    expect(one).toMatchObject({ released: [yard[0]], kgG: kg(300) });
    expect(one.strip).toMatchObject({ heldG: kg(300), planableG: kg(700) });
    await expect(p.owner.orders.release({ lineId: la, bundleIds: [ids[0]!] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `${yard[0]} is not held for ${a.number} line 1`,
    });

    const rest = await p.owner.orders.release({ lineId: la });
    expect([...rest.released].sort()).toEqual([yard[1]!, yard[2]!].sort());
    expect(await strip(p, a.id)).toMatchObject({ heldG: 0, heldPcs: 0, heldBundles: 0, planableG: kg(1_000) });
    expect((await rowsOf(p, yard)).map((r) => [r.status, r.heldForLineId, r.heldAt])).toEqual([
      ["available", null, null],
      ["available", null, null],
      ["available", null, null],
    ]);
    // Nothing left: a calm no-op.
    expect(await p.owner.orders.release({ lineId: la })).toMatchObject({ released: [], kgG: 0 });

    const rel = await audits(p.companyId, "order.release");
    expect(rel.map((r) => r.meta)).toEqual([
      expect.objectContaining({ orderId: a.id, reason: "released", serials: [yard[0]], kgG: kg(300), note: "Sold elsewhere" }),
      expect.objectContaining({ orderId: a.id, reason: "released", kgG: kg(300) }),
    ]);
  }, SLOW);

  test("closing or cancelling the order releases its holds in the same batch (audited)", async () => {
    const p = await opPlant();
    const { s, a, la } = await setup(p);
    const yard = await p.pack(s, [{ kg: 100 }]);
    await p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, yard) });
    await p.owner.orders.close({ id: a.id, reason: "Buyer stopped" });
    expect((await rowsOf(p, yard))[0]!.heldForLineId).toBeNull();
    expect((await audits(p.companyId, "order.release"))[0]!.meta).toMatchObject({ reason: "order_closed", serials: yard });

    const c = await p.confirmedOrder([{ sectionId: s, kgG: kg(500) }]);
    await p.owner.orders.hold({ lineId: c.lineIds[0]!, bundleIds: await idsOf(p, yard) });
    await p.owner.orders.cancel({ id: c.id, reason: "Duplicate" });
    expect((await rowsOf(p, yard))[0]!.heldForLineId).toBeNull();
    expect((await audits(p.companyId, "order.release"))[1]!.meta).toMatchObject({ reason: "order_cancelled", orderId: c.id });
  }, SLOW);

  test("a line with held bundles can't be removed from the order", async () => {
    const p = await opPlant();
    const { s, a, la } = await setup(p);
    const keep = await p.confirmedOrder([{ sectionId: s, kgG: kg(500) }, { sectionId: s, kgG: kg(400) }]);
    void a;
    void la;
    const yard = await p.pack(s, [{ kg: 100 }]);
    await p.owner.orders.hold({ lineId: keep.lineIds[1]!, bundleIds: await idsOf(p, yard) });
    const got = await p.owner.orders.get({ id: keep.id });
    const first = got.lines[0]!;
    await expect(
      p.owner.orders.update({
        id: keep.id,
        serverSeq: got.order.serverSeq,
        lines: [{ id: first.lineId, sectionId: first.sectionId, cutLengthMm: first.cutLengthMm, kgG: first.orderedG, pcs: first.orderedPcs }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Line 2 has bundles") });
  }, SLOW);
});

describe("dispatch: held for SO-n", () => {
  test("another customer's dispatch refuses a held bundle with the exact sentence (addBundlesBySerial and addBundle)", async () => {
    const p = await opPlant();
    const { s, a, la } = await setup(p);
    const yard = await p.pack(s, [{ kg: 100 }, { kg: 100 }]);
    await p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, [yard[0]!]) });
    const name = await customerName(p.customerId);
    const reason = `Held for ${a.number} (${name})`;

    const { id: d } = await p.owner.dispatch.create({ customerId: p.otherCustomer });
    const report = await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true, id: d, serials: yard });
    expect(report.added).toEqual([yard[1]!]);
    expect(report.unavailable).toEqual([
      { serial: yard[0]!, reason, code: "held_for_order", status: "available", heldBy: null, orderNumber: a.number, customerName: name },
    ]);
    const [heldId] = await idsOf(p, [yard[0]!]);
    await expect(p.owner.dispatch.addBundle({ id: d, bundleId: heldId! })).rejects.toMatchObject({ code: "BAD_REQUEST", message: reason });
    // The packer at the bay gets the same refusal.
    await expect(p.as("packer").dispatch.addBundle({ id: d, bundleId: heldId! })).rejects.toMatchObject({ message: reason });

    // Released: it goes on.
    await p.owner.orders.release({ lineId: la });
    expect((await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true, id: d, serials: [yard[0]!] })).added).toEqual([yard[0]!]);
  }, SLOW);

  test("write time: a hold landing between the scan's read and write fails the add, which re-reads and refuses it", async () => {
    const p = await opPlant();
    const { s, a, la } = await setup(p);
    const yard = await p.pack(s, [{ kg: 100 }]);
    const [id] = await idsOf(p, yard);
    const { id: d } = await p.owner.dispatch.create({ customerId: p.otherCustomer });
    env.beforeNextBatch(() => p.owner.orders.hold({ lineId: la, bundleIds: [id!] }));
    const report = await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true, id: d, serials: yard });
    expect(report.added).toEqual([]);
    expect(report.unavailable).toMatchObject([{ serial: yard[0], code: "held_for_order", orderNumber: a.number }]);
    expect(await itemsOf(d)).toEqual([]);
  }, SLOW);

  test("this customer's dispatch takes it, links it to the held line, and completion ends the hold (audited)", async () => {
    const p = await opPlant();
    const { s, a, la } = await setup(p);
    const yard = await p.pack(s, [{ kg: 300 }]);
    await p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, yard) });

    const { id: d } = await p.owner.dispatch.create({ customerId: p.customerId });
    const report = await p.owner.dispatch.addBundlesBySerial({ id: d, serials: yard });
    expect(report.added).toEqual(yard);
    expect(report.linked).toMatchObject([{ serial: yard[0], salesOrderLineId: la, orderNumber: a.number }]);
    await p.owner.dispatch.reserve({ id: d });
    // Held for the line while on the truck (reserved still counts as held).
    expect(await strip(p, a.id)).toMatchObject({ heldG: kg(300) });
    await p.owner.dispatch.complete({ id: d });

    const [row] = await rowsOf(p, yard);
    expect(row).toMatchObject({ status: "dispatched", heldForLineId: null, heldAt: null, salesOrderLineId: la });
    expect(await strip(p, a.id)).toMatchObject({ dispatchedG: kg(300), heldG: 0, bakiG: kg(700), planableG: kg(700) });
    const code = (await dispatchRow(d)).code;
    const [rel] = await audits(p.companyId, "order.release");
    expect(rel).toMatchObject({ subjectType: "sales_order_line", subjectId: la });
    expect(rel!.meta).toMatchObject({ reason: "dispatched", dispatchId: d, dispatchCode: code, serials: yard, kgG: kg(300) });
  }, SLOW);

  test("a dispatch whose customer changed after the scan can't complete with another customer's held bundle", async () => {
    const p = await opPlant();
    const { s, a, la } = await setup(p);
    const yard = await p.pack(s, [{ kg: 100 }]);
    await p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, yard) });
    const d = await p.held(yard); // this customer's dispatch, reserved
    // As if the office changed the customer after the scan (another writer).
    await env.db.update(dispatch).set({ customerId: p.otherCustomer }).where(eq(dispatch.id, d));
    await expect(p.owner.dispatch.complete({ id: d })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `${yard[0]}: Held for ${a.number} (${await customerName(p.customerId)})`,
    });
    expect((await rowsOf(p, yard))[0]!.status).toBe("reserved");
  }, SLOW);
});

describe("dispatch.scan (one classifier, W1-PK-S lib/scan.ts)", () => {
  test("the floor scan refuses held_for_order with the order and customer; this customer's scan takes a held bundle with no line", async () => {
    const p = await opPlant();
    const { s, a, la } = await setup(p);
    const yard = await p.pack(s, [{ kg: 100 }, { kg: 100 }]); // on no line
    const ids = await idsOf(p, yard);
    await p.owner.orders.hold({ lineId: la, bundleIds: [ids[0]!] });
    const name = await customerName(p.customerId);

    // Another customer: held_for_order (§E6: after `held`, before `unassigned`), never added.
    const { id: other } = await p.owner.dispatch.create({ customerId: p.otherCustomer });
    const refused = await p.as("packer").dispatch.scan({ id: other, serials: [yard[0]!] });
    expect(refused.added).toEqual([]);
    expect(refused.results).toMatchObject([{ outcome: "held_for_order", orderNumber: a.number, customerName: name }]);
    expect(refused.refused).toMatchObject([{ code: "held_for_order", reason: `Held for ${a.number} (${name})`, orderNumber: a.number }]);
    expect(refused.unavailable).toEqual([
      { serial: yard[0]!, reason: `Held for ${a.number} (${name})`, code: "held_for_order", status: "available", heldBy: null, orderNumber: a.number, customerName: name },
    ]);

    // This customer: the scan never lifts `unassigned`, but a bundle held for this customer's open line
    // counts as assigned and links to the held line; the unheld one stays refused as unassigned.
    const { id: mine } = await p.owner.dispatch.create({ customerId: p.customerId });
    const report = await p.as("packer").dispatch.scan({ id: mine, serials: yard });
    expect(report.added).toEqual([yard[0]!]);
    expect(report.results.map((r) => r.outcome)).toEqual(["added", "unassigned"]);
    expect(report.linked).toMatchObject([{ serial: yard[0], salesOrderLineId: la }]);
  }, SLOW);
});

describe("D17: voiding a held bundle", () => {
  test("releases the hold, audited order.release reason voided; restoring does not hold it again", async () => {
    const p = await opPlant();
    const { s, a, la } = await setup(p);
    const yard = await p.pack(s, [{ kg: 120 }, { kg: 80 }]);
    const ids = await idsOf(p, yard);
    await p.owner.orders.hold({ lineId: la, bundleIds: ids });
    expect(await strip(p, a.id)).toMatchObject({ heldG: kg(200) });

    await p.owner.bundle.transitionStatus({ id: ids[0]!, toStatus: "void", reason: "Bent" });
    const rows = await rowsOf(p, yard);
    expect(rows.find((r) => r.id === ids[0])).toMatchObject({ status: "void", heldForLineId: null, heldAt: null });
    expect(rows.find((r) => r.id === ids[1])).toMatchObject({ status: "available", heldForLineId: la });
    expect(await strip(p, a.id)).toMatchObject({ heldG: kg(80) });
    const voided = rows.find((r) => r.id === ids[0]);
    const released = (await audits(p.companyId, "order.release")).filter((x) => (x.meta as { reason: string }).reason === "voided");
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({ subjectType: "sales_order_line", subjectId: la });
    expect(released[0]!.meta).toMatchObject({ orderNumber: a.number, lineNo: 1, bundleIds: [ids[0]], serials: [voided!.serial], kgG: voided!.weightG });

    // Back to available: no longer held, and no second release row.
    await p.owner.bundle.transitionStatus({ id: ids[0]!, toStatus: "available", reason: "Straightened" });
    expect((await rowsOf(p, yard)).find((r) => r.id === ids[0])).toMatchObject({ status: "available", heldForLineId: null });
    expect(await audits(p.companyId, "order.release")).toHaveLength(1);

    // A void that loses its race (the bundle was reserved meanwhile) changes nothing and writes no release row.
    const [other] = rows.filter((r) => r.id === ids[1]);
    env.beforeNextBatch(async () => {
      await env.db.update(bundle).set({ status: "reserved" }).where(eq(bundle.id, other!.id));
    });
    await p.owner.bundle.transitionStatus({ id: other!.id, toStatus: "void", reason: "Bent" });
    expect((await rowsOf(p, yard)).find((r) => r.id === ids[1])).toMatchObject({ status: "reserved", heldForLineId: la });
    expect(await audits(p.companyId, "order.release")).toHaveLength(1);
  }, SLOW);
});

describe("orders.reallocate of a held bundle", () => {
  test("refused unless it moves to the line it is held for (release first)", async () => {
    const p = await opPlant();
    const { s, a, la } = await setup(p);
    const next = await p.confirmedOrder([{ sectionId: s, kgG: kg(500) }]);
    const yard = await p.pack(s, [{ kg: 100 }]);
    const ids = await idsOf(p, yard);
    await p.owner.orders.hold({ lineId: la, bundleIds: ids });

    const msg = `${yard[0]} is held for ${a.number} line 1 (${await customerName(p.customerId)}). Release the hold first.`;
    await expect(p.owner.orders.reallocate({ bundleIds: ids, toLineId: next.lineIds[0]!, reason: "Urgent" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: msg,
    });
    await expect(p.owner.orders.reallocate({ bundleIds: ids, toLineId: null, reason: "Back to plant" })).rejects.toMatchObject({ message: msg });

    // To the held line itself: the natural next step, allowed; the hold stays, planable not taken off twice.
    const res = await p.owner.orders.reallocate({ bundleIds: ids, toLineId: la, reason: "Put on the order" });
    expect(res).toMatchObject({ status: "applied", moved: 1 });
    expect((await rowsOf(p, yard))[0]).toMatchObject({ salesOrderLineId: la, heldForLineId: la });
    expect(await strip(p, a.id)).toMatchObject({ packedG: kg(100), heldG: kg(100), planableG: kg(900) });

    // Released: it moves.
    await p.owner.orders.release({ lineId: la });
    expect(await p.owner.orders.reallocate({ bundleIds: ids, toLineId: next.lineIds[0]!, reason: "Urgent" })).toMatchObject({ status: "applied" });
  }, SLOW);

  test("matchStock marks held bundles and leaves them out of ready kg", async () => {
    const p = await opPlant();
    const { s, a, la } = await setup(p);
    const yard = await p.pack(s, [{ kg: 100 }, { kg: 200 }]);
    await p.owner.orders.hold({ lineId: la, bundleIds: await idsOf(p, [yard[0]!]) });
    const m = await p.owner.orders.matchStock({ sectionId: s, customerId: p.otherCustomer });
    const held = m.items.find((i) => i.serial === yard[0]);
    expect(held).toMatchObject({ heldForLineId: la, heldForOrderNumber: a.number });
    expect(m.readyG).toBe(kg(200));
  }, SLOW);
});

describe("permission matrix", () => {
  test("hold / release need order.manage (owner, office, manager; never the packer); holds is open to members", async () => {
    const holders = (action: Action) => ROLES.filter((r) => can({ company: { role: r }, isPlatformAdmin: false }, action));
    expect(holders("order.manage").sort()).toEqual(["manager", "office", "owner"]);
    const p = await opPlant();
    const { s, la } = await setup(p);
    const yard = await p.pack(s, Array.from({ length: ROLES.length }, () => ({ kg: 10 })));
    const ids = await idsOf(p, yard);
    for (const [i, role] of ROLES.entries()) {
      const api = p.as(role);
      const hold = () => api.orders.hold({ lineId: la, bundleIds: [ids[i]!] });
      const release = () => api.orders.release({ lineId: la, bundleIds: [ids[i]!] });
      if (holders("order.manage").includes(role)) {
        await expect(hold()).resolves.toMatchObject({ held: [yard[i]] });
        await expect(release()).resolves.toMatchObject({ released: [yard[i]] });
      } else {
        await expect(hold()).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(release()).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      await expect(api.orders.holds({ lineId: la })).resolves.toBeTruthy();
    }
    await expect(p.as("packer").orders.hold({ lineId: la, bundleIds: [ids[0]!] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(env.caller(null).orders.holds({ lineId: la })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  }, SLOW);
});

describe("migration 0027_order_hold", () => {
  test("applies on 0000..latest; existing bundles are not held; the column and index exist", async () => {
    const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: ["DB"] });
    try {
      const d1 = await mf.getD1Database("DB");
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
      expect(files).toContain("0027_order_hold.sql");
      const apply = async (file: string) => {
        const statements = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
          .split("--> statement-breakpoint")
          .map((x) => x.trim())
          .filter(Boolean);
        await d1.batch(statements.map((x) => d1.prepare(x)));
      };
      for (const f of files.filter((f) => f < "0027")) await apply(f);
      await d1.batch([
        d1.prepare("insert into company (id, name, slug) values ('c1', 'C', 'c1')"),
        d1.prepare("insert into die (id, company_id, series, section_code, weight_min_g, weight_max_g) values ('d1', 'c1', 'S', 'A', 1, 2)"),
        d1.prepare("insert into bundle_group (id, company_id, code, die_id, unit) values ('g1', 'c1', 'G1', 'd1', 'pcs')"),
        d1.prepare("insert into bundle (id, company_id, group_id, die_id, serial, quantity, weight_g, length_mm) values ('b1', 'c1', 'g1', 'd1', 'S1', 1, 1000, 3658)"),
      ]);
      await apply("0027_order_hold.sql");
      for (const f of files.filter((f) => f > "0027_order_hold.sql")) await apply(f);
      const cols = await d1.prepare("select name from pragma_table_info('bundle')").all<{ name: string }>();
      expect(cols.results.map((c) => c.name)).toEqual(expect.arrayContaining(["held_for_line_id", "held_at"]));
      const idx = await d1.prepare("select name from pragma_index_list('bundle')").all<{ name: string }>();
      expect(idx.results.map((c) => c.name)).toContain("bundle_company_held_line_idx");
      const row = await d1.prepare("select status, held_for_line_id, held_at from bundle where id = 'b1'").first();
      expect(row).toEqual({ status: "available", held_for_line_id: null, held_at: null });
    } finally {
      await mf.dispose();
    }
  }, SLOW);
});
