/**
 * W1-OP-S review round 1: the fixes, each pinned here before the code changed.
 *
 * - I-1 (D11): `orders.create` / `orders.update` never move an order's status; confirm / close /
 *   cancel are the only moves, and an edit of a confirmed order cannot undo what confirm checked.
 * - I-2: planable is re-checked inside the plan's own batch (create and release).
 * - I-3: a release binds at most 100 parameters per statement, whatever the number of dies.
 * - I-4: an edit of a W1 line keeps its stored basis; a re-base is audited `order.weight.refresh`;
 *   figures of a line on a released plan, or below what is dispatched, are refused.
 * - Minors: the die-owner override on a reallocation, plant stock remembering its last customer,
 *   pending bundles not dispatchable, `orders.reallocations.list/get`, pack and dispatch on the
 *   order timeline, close guarded by the order's version.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { approval, auditLog, bundle, pressPlan, pressRun, salesOrder, salesOrderLine } from "@orrn/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

import { pressRunInserts } from "../src/routers/pressPlan";
import { createTestEnv, type TestEnv } from "./harness";
import { FT12, opHelpers, type OpPlant } from "./orders-w1-fixture";
import { kg, saveOrder, SLOW } from "./sales-fixture";

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
const HOUR = 3_600_000;

async function audits(companyId: string, action: string) {
  return env.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, action)))
    .orderBy(asc(auditLog.at));
}

async function orderRow(id: string) {
  const [row] = await env.db.select().from(salesOrder).where(eq(salesOrder.id, id));
  return row!;
}

async function lineRow(id: string) {
  const [row] = await env.db.select().from(salesOrderLine).where(eq(salesOrderLine.id, id));
  return row!;
}

async function idsOf(p: OpPlant, serials: string[]) {
  const rows = await env.db
    .select({ id: bundle.id })
    .from(bundle)
    .where(and(eq(bundle.companyId, p.companyId), inArray(bundle.serial, serials)))
    .orderBy(asc(bundle.serial));
  return rows.map((r) => r.id);
}

/** One section with a 12.000 copy and a confirmed 10 pcs x 12 ft line (120 kg). */
async function oneLine(p: OpPlant, opts: { customerId?: string; pcs?: number; pin?: boolean } = {}) {
  const s = await p.section();
  const c = await p.copy(s, { milli: 12_000 });
  const o = await p.confirmedOrder([{ sectionId: s, pcs: opts.pcs ?? 10, dieInstanceId: opts.pin ? c : null }], {
    customerId: opts.customerId,
  });
  return { s, c, o, lineId: o.lineIds[0]! };
}

// ---------------------------------------------------------------------------
// I-1: no status back door (D11)
// ---------------------------------------------------------------------------

describe("I-1: create and update never move an order's status", () => {
  test("create: only a booking; status confirmed or closed is refused and nothing is saved", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const line = { sectionId: s, cutLengthMm: FT12, qtyBasis: "pcs" as const, pcs: 10, tierRank: 1 };
    for (const status of ["confirmed", "closed", "cancelled", "dispatching"] as const) {
      await expect(p.owner.orders.create({ customerId: p.customerId, poNumber: `PO-${status}`, status, lines: [line] })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("Confirm"),
      });
    }
    expect(await env.db.select().from(salesOrder).where(eq(salesOrder.companyId, p.companyId))).toHaveLength(0);
    const o = await p.owner.orders.create({ customerId: p.customerId, poNumber: "PO-OK", status: "booking", lines: [line] });
    expect((await orderRow(o.id)).status).toBe("booking");
  }, SLOW);

  test("update: any status other than the current one is refused (confirm, close, cancel, reopen, unconfirm)", async () => {
    const p = await opPlant();
    const { o } = await oneLine(p);
    const booking = await p.owner.orders.create({ customerId: p.customerId, lines: [{ sectionId: (await lineRow(o.lineIds[0]!)).dieId, cutLengthMm: FT12, kgG: kg(5) }] });
    for (const status of ["confirmed", "closed", "cancelled"] as const) {
      await expect(saveOrder(p.owner, { id: booking.id, status })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect((await orderRow(booking.id)).status).toBe("booking");
    for (const status of ["booking", "closed", "cancelled", "dispatching"] as const) {
      await expect(saveOrder(p.owner, { id: o.id, status })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect((await orderRow(o.id)).status).toBe("confirmed");
    // Echoing the status the order already has is a plain edit.
    await saveOrder(p.owner, { id: o.id, status: "confirmed", note: "same status" });
    expect(await orderRow(o.id)).toMatchObject({ status: "confirmed", note: "same status" });
    expect(await audits(p.companyId, "order.close")).toHaveLength(0);
    expect(await audits(p.companyId, "order.cancel")).toHaveLength(0);
  }, SLOW);

  test("a confirmed order's edit can't undo confirm: blank PO, a line with no pcs, no die or tier; a new pin passes the owner check", async () => {
    const p = await opPlant();
    const { s, o, lineId } = await oneLine(p);
    await expect(saveOrder(p.owner, { id: o.id, poNumber: null })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("po_number"),
    });
    const kept = { id: lineId, sectionId: s, cutLengthMm: FT12 };
    await expect(
      saveOrder(p.owner, { id: o.id, lines: [kept, { sectionId: s, cutLengthMm: FT12, kgG: kg(50) }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("line_2_pcs") });
    await expect(
      saveOrder(p.owner, { id: o.id, lines: [kept, { sectionId: s, cutLengthMm: FT12, qtyBasis: "pcs", pcs: 5 }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("line_2_die_or_tier") });
    const owned = await p.copy(s, { milli: 12_000, ownerCustomerId: p.otherCustomer });
    await expect(
      saveOrder(p.owner, { id: o.id, lines: [kept, { sectionId: s, cutLengthMm: FT12, qtyBasis: "pcs", pcs: 5, dieInstanceId: owned }] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("This die belongs to") });
    expect(await env.db.select().from(salesOrderLine).where(eq(salesOrderLine.salesOrderId, o.id))).toHaveLength(1);
    // A complete new line is fine.
    await saveOrder(p.owner, { id: o.id, lines: [kept, { sectionId: s, cutLengthMm: FT12, qtyBasis: "pcs", pcs: 5, tierRank: 2 }] });
    expect(await env.db.select().from(salesOrderLine).where(eq(salesOrderLine.salesOrderId, o.id))).toHaveLength(2);
    expect((await orderRow(o.id)).status).toBe("confirmed");
  }, SLOW);

  test("close is guarded by the order's version: a kg raise between close's read and write answers CONFLICT", async () => {
    const p = await opPlant();
    const { s, o, lineId } = await oneLine(p);
    const serials = await p.pack(s, [{ kg: 120 }], lineId);
    await p.owner.dispatch.complete({ id: await p.held(serials) });
    expect((await p.owner.orders.get({ id: o.id })).totals.bakiG).toBe(0);
    // Close read baki 0 (no reason needed); the line is raised to 20 pcs before the close lands.
    env.beforeNextBatch(() => saveOrder(p.owner, { id: o.id, lines: [{ id: lineId, sectionId: s, cutLengthMm: FT12, pcs: 20 }] }));
    await expect(p.owner.orders.close({ id: o.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await orderRow(o.id)).status).toBe("dispatching");
    await expect(p.owner.orders.close({ id: o.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("baki") });
  }, SLOW);
});

// ---------------------------------------------------------------------------
// I-2: planable at write time
// ---------------------------------------------------------------------------

describe("I-2: planable is re-checked inside the plan's batch", () => {
  test("create: two plans for all of a line, the second saved between the first's read and write -> CONFLICT, one plan stands", async () => {
    const p = await opPlant();
    const { s, lineId } = await oneLine(p);
    const t = Date.now();
    const input = { windowStart: t, windowEnd: t + 8 * HOUR, dies: [{ sectionId: s, lines: [{ salesOrderLineId: lineId, pcs: 10 }] }] };
    env.beforeNextBatch(() => p.owner.plans.create(input));
    await expect(p.owner.plans.create(input)).rejects.toMatchObject({ code: "CONFLICT" });
    const plans = await env.db.select().from(pressPlan).where(eq(pressPlan.companyId, p.companyId));
    expect(plans).toHaveLength(1);
    expect((await p.owner.orders.balance({ orderId: (await lineRow(lineId)).salesOrderId })).lines[0]!.strip).toMatchObject({
      plannedG: kg(120),
      planableG: 0,
    });
  }, SLOW);

  test("release: a pack landing between release's read and write fails the release whole (no runs, still draft)", async () => {
    const p = await opPlant();
    const { s, lineId } = await oneLine(p);
    const t = Date.now();
    const plan = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + 8 * HOUR,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: lineId, pcs: 10 }] }],
    });
    env.beforeNextBatch(() => p.pack(s, [{ kg: 10 }], lineId));
    await expect(p.owner.plans.release({ id: plan.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await env.db.select().from(pressPlan).where(eq(pressPlan.id, plan.id)))[0]!.status).toBe("draft");
    expect(await env.db.select().from(pressRun).where(eq(pressRun.planId, plan.id))).toHaveLength(0);
    // Read time now says why.
    await expect(p.owner.plans.release({ id: plan.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("left to plan") });
  }, SLOW);
});

// ---------------------------------------------------------------------------
// I-3: ≤ 100 bound parameters on release
// ---------------------------------------------------------------------------

describe("I-3: release binds at most 100 parameters per statement", () => {
  test("a 12-die plan releases: 12 queued runs, peak parameters <= 100", async () => {
    const p = await opPlant();
    const sections: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const s = await p.section();
      await p.copy(s, { milli: 12_000 });
      sections.push(s);
    }
    const o = await p.confirmedOrder(sections.map((s) => ({ sectionId: s, pcs: 10 })));
    const t = Date.now();
    const plan = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + 12 * HOUR,
      dies: sections.map((s, i) => ({ sectionId: s, lines: [{ salesOrderLineId: o.lineIds[i]!, pcs: 5 }] })),
    });
    env.resetPeakParams();
    const rel = await p.owner.plans.release({ id: plan.id });
    expect(env.peakParams()).toBeLessThanOrEqual(100);
    expect(rel.runs).toHaveLength(12);
    const runs = await env.db.select().from(pressRun).where(eq(pressRun.planId, plan.id));
    expect(runs.map((r) => [r.status, r.source, r.timeUnconfirmed])).toEqual(Array.from({ length: 12 }, () => ["queued", "typed", false]));
  }, SLOW);

  test("pressRunInserts: every statement of a 30-die release binds <= 100 parameters (toSQL)", async () => {
    const at = new Date();
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: crypto.randomUUID(),
      companyId: "co",
      serverSeq: 1,
      number: `PR-${i + 1}`,
      period: "2026-27",
      status: "queued" as const,
      planId: "plan",
      pressPlanDieId: crypto.randomUUID(),
      pressLineId: "line",
      sectionId: "section",
      dieInstanceId: null,
      createdBy: "user",
      createdAt: at,
    }));
    const statements = pressRunInserts(env.db, rows);
    const params = statements.map((s) => (s as unknown as { toSQL(): { params: unknown[] } }).toSQL().params.length);
    expect(params.reduce((a, b) => a + b, 0)).toBeGreaterThan(100);
    for (const n of params) expect(n).toBeLessThanOrEqual(100);
  }, SLOW);
});

// ---------------------------------------------------------------------------
// I-4: edits of W1 line figures
// ---------------------------------------------------------------------------

describe("I-4: orders.update of a W1 line's figures", () => {
  test("pieces on the stored basis: a new reading is not picked up by an edit; kg follows pcs; typed kg is ignored", async () => {
    const p = await opPlant();
    const { s, c, o, lineId } = await oneLine(p, { pin: true });
    await p.reading(c, 12_300, new Date());
    await saveOrder(p.owner, { id: o.id, lines: [{ id: lineId, sectionId: s, cutLengthMm: FT12, pcs: 20, kgG: kg(999) }] });
    const row = await lineRow(lineId);
    // 20 pcs x 12 ft at the stored 12.000 = 240 kg (not 246 at the new reading, not the typed 999).
    expect(row).toMatchObject({ pcs: 20, kgG: kg(240), kgPer12ftMilli: 12_000, copyMilli: 12_000, weightBasis: "copy_current", qtyBasis: "pcs" });
    expect(await audits(p.companyId, "order.weight.refresh")).toHaveLength(0);
    // A kg line keeps kg and recomputes pieces from the stored basis.
    const kgLine = await p.confirmedOrder([{ sectionId: s, kgG: kg(8_000), dieInstanceId: c }]);
    expect(await lineRow(kgLine.lineIds[0]!)).toMatchObject({ kgPer12ftMilli: 12_300, pcs: 650 });
    await p.reading(c, 12_000, new Date(Date.now() + 1000));
    await saveOrder(p.owner, { id: kgLine.id, lines: [{ id: kgLine.lineIds[0]!, sectionId: s, cutLengthMm: FT12, kgG: kg(4_000), pcs: 1 }] });
    // 4,000 kg at 12.300 x 12 ft -> 325 pcs (the typed 1 is ignored).
    expect(await lineRow(kgLine.lineIds[0]!)).toMatchObject({ kgG: kg(4_000), pcs: 325, kgPer12ftMilli: 12_300 });
  }, SLOW);

  test("a re-base (weight basis or pin change) is audited order.weight.refresh with from / to", async () => {
    const p = await opPlant();
    const { s, o, lineId } = await oneLine(p, { pin: true });
    await saveOrder(p.owner, { id: o.id, lines: [{ id: lineId, sectionId: s, cutLengthMm: FT12, weightBasis: "band_start" }] });
    // Band start 11.800: 10 pcs x 12 ft = 118 kg.
    expect(await lineRow(lineId)).toMatchObject({ kgG: kg(118), pcs: 10, weightBasis: "band_start", kgPer12ftMilli: 11_800 });
    const [a] = await audits(p.companyId, "order.weight.refresh");
    expect(a!.meta).toMatchObject({
      orderId: o.id,
      via: "order.update",
      from: { basisMilli: 12_000, kgG: kg(120), pcs: 10 },
      to: { basisMilli: 11_800, kgG: kg(118), pcs: 10, weightBasis: "band_start" },
    });
  }, SLOW);

  test("a line on a released plan: kg, pcs, cut length and section are refused; a note on the order still saves", async () => {
    const p = await opPlant();
    const { s, o, lineId } = await oneLine(p);
    const t = Date.now();
    const plan = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + 8 * HOUR,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: lineId, pcs: 5 }] }],
    });
    await p.owner.plans.release({ id: plan.id });
    const s2 = await p.section();
    for (const change of [{ pcs: 20 }, { cutLengthMm: FT12 + 100 }, { sectionId: s2 }]) {
      await expect(
        saveOrder(p.owner, { id: o.id, lines: [{ id: lineId, sectionId: s, cutLengthMm: FT12, ...change }] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("released press plan") });
    }
    expect(await lineRow(lineId)).toMatchObject({ pcs: 10, kgG: kg(120), dieId: s, cutLengthMm: FT12 });
    await saveOrder(p.owner, { id: o.id, note: "call before loading", lines: [{ id: lineId, sectionId: s, cutLengthMm: FT12 }] });
    expect((await orderRow(o.id)).note).toBe("call before loading");
  }, SLOW);

  test("write time: a plan released between the edit's read and write fails the edit whole", async () => {
    const p = await opPlant();
    const { s, o, lineId } = await oneLine(p);
    const t = Date.now();
    const plan = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + 8 * HOUR,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: lineId, pcs: 5 }] }],
    });
    env.beforeNextBatch(() => p.owner.plans.release({ id: plan.id }));
    await expect(saveOrder(p.owner, { id: o.id, lines: [{ id: lineId, sectionId: s, cutLengthMm: FT12, pcs: 30 }] })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await lineRow(lineId)).toMatchObject({ pcs: 10, kgG: kg(120) });
  }, SLOW);

  test("pieces down below what is already dispatched is refused", async () => {
    const p = await opPlant();
    const { s, o, lineId } = await oneLine(p);
    await p.owner.dispatch.complete({ id: await p.held(await p.pack(s, [{ kg: 100 }], lineId)) });
    await expect(saveOrder(p.owner, { id: o.id, lines: [{ id: lineId, sectionId: s, cutLengthMm: FT12, pcs: 5 }] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("already dispatched"),
    });
    await saveOrder(p.owner, { id: o.id, lines: [{ id: lineId, sectionId: s, cutLengthMm: FT12, pcs: 9 }] });
    expect(await lineRow(lineId)).toMatchObject({ pcs: 9, kgG: kg(108) });
  }, SLOW);
});

// ---------------------------------------------------------------------------
// Minors: reallocation, dispatch of pending bundles, reads for the order screens
// ---------------------------------------------------------------------------

async function approveOverride(p: OpPlant, copyId: string, attemptedCustomerId: string) {
  const id = crypto.randomUUID();
  await env.db.insert(approval).values({
    id,
    companyId: p.companyId,
    kind: "die_owner_override",
    subjectId: copyId,
    status: "approved",
    meta: { attemptedCustomerId, purpose: "dispatch" },
    requestedBy: p.users.office.id,
    decidedBy: p.users.manager.id,
    decidedAt: new Date(),
  });
  return id;
}

describe("reallocation: owner override, plant stock origin, pending bundles", () => {
  test("owned copy to another customer: refused without an override; with one it goes pending; an override closed meanwhile moves nothing", async () => {
    const p = await opPlant();
    const s = await p.section();
    const owned = await p.copy(s, { milli: 12_000, ownerCustomerId: p.customerId });
    const mine = await p.confirmedOrder([{ sectionId: s, kgG: kg(500), dieInstanceId: owned }]);
    const theirs = await p.confirmedOrder([{ sectionId: s, kgG: kg(500), tierRank: 1 }], { customerId: p.otherCustomer });
    const serials = await p.pack(s, [{ kg: 100 }], mine.lineIds[0]);
    await env.db.update(bundle).set({ dieInstanceId: owned }).where(and(eq(bundle.companyId, p.companyId), inArray(bundle.serial, serials)));
    const ids = await idsOf(p, serials);
    await expect(p.owner.orders.reallocate({ bundleIds: ids, toLineId: theirs.lineIds[0]!, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const grant = await approveOverride(p, owned, p.otherCustomer);
    // A wrong override id is not this grant.
    await expect(
      p.owner.orders.reallocate({ bundleIds: ids, toLineId: theirs.lineIds[0]!, reason: "x", dieOwnerApprovalId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const res = await p.owner.orders.reallocate({ bundleIds: ids, toLineId: theirs.lineIds[0]!, reason: "x", dieOwnerApprovalId: grant });
    expect(res.status).toBe("pending");
    const [req] = await env.db.select().from(approval).where(eq(approval.id, res.approvalId!));
    expect(req!.meta).toMatchObject({ dieOwnerApprovalId: grant });
    // The override is closed before the reallocation is decided: approving moves nothing.
    await env.db.update(approval).set({ meta: { attemptedCustomerId: p.otherCustomer, purpose: "dispatch", closedAt: Date.now() } }).where(eq(approval.id, grant));
    await p.as("manager").approval.decide({ id: res.approvalId!, decision: "approved" });
    const [b] = await env.db.select().from(bundle).where(eq(bundle.id, ids[0]!));
    expect(b!.salesOrderLineId).toBe(mine.lineIds[0]!);
    const applied = (await audits(p.companyId, "order.reallocate")).find((a) => (a.meta as { status: string }).status === "applied");
    expect(applied!.meta).toMatchObject({ moved: 0, asked: 1 });
  }, SLOW);

  test("plant stock remembers its last customer: A -> plant applies; plant -> B needs approval; plant -> A applies", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const a = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]);
    const a2 = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]);
    const b = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }], { customerId: p.otherCustomer });
    const ids = await idsOf(p, await p.pack(s, [{ kg: 50 }, { kg: 60 }], a.lineIds[0]));
    expect(await p.owner.orders.reallocate({ bundleIds: ids, toLineId: null, reason: "Order short closed" })).toMatchObject({ status: "applied" });
    expect(await p.owner.orders.reallocate({ bundleIds: [ids[0]!], toLineId: b.lineIds[0]!, reason: "B is short" })).toMatchObject({
      status: "pending",
      moved: 0,
    });
    expect(await p.owner.orders.reallocate({ bundleIds: [ids[1]!], toLineId: a2.lineIds[0]!, reason: "A's next order" })).toMatchObject({
      status: "applied",
      moved: 1,
    });
  }, SLOW);

  test("pending bundles can't be dispatched: scan reports them, a single add refuses, Complete refuses a bundle that went pending", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const a = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]);
    const b = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }], { customerId: p.otherCustomer });
    const serials = await p.pack(s, [{ kg: 50 }, { kg: 60 }, { kg: 70 }], a.lineIds[0]);
    const ids = await idsOf(p, serials);
    await p.owner.orders.reallocate({ bundleIds: [ids[0]!], toLineId: b.lineIds[0]!, reason: "B is short" });

    const { id: d1 } = await p.owner.dispatch.create({ customerId: p.customerId });
    const report = await p.owner.dispatch.addBundlesBySerial({ id: d1, serials: [serials[0]!, serials[1]!] });
    expect(report.added).toEqual([serials[1]!]);
    expect(report.unavailable).toEqual([expect.objectContaining({ serial: serials[0]!, code: "reallocation_pending" })]);
    await expect(p.owner.dispatch.addBundle({ id: d1, bundleId: ids[0]! })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("reallocation"),
    });
    // A bundle already on a live dispatch can't be asked for.
    await expect(p.owner.orders.reallocate({ bundleIds: [ids[1]!], toLineId: b.lineIds[0]!, reason: "x" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("dispatch"),
    });

    // Race: the request lands between the scan's read and its write; Complete then refuses.
    env.beforeNextBatch(() => p.owner.orders.reallocate({ bundleIds: [ids[2]!], toLineId: b.lineIds[0]!, reason: "late ask" }));
    await p.owner.dispatch.addBundlesBySerial({ id: d1, serials: [serials[2]!] });
    await p.owner.dispatch.reserve({ id: d1 });
    await expect(p.owner.dispatch.complete({ id: d1 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining(serials[2]!),
    });
    expect((await env.db.select().from(bundle).where(eq(bundle.id, ids[2]!)))[0]!.status).toBe("reserved");
  }, SLOW);
});

describe("orders.reallocations.list / get", () => {
  test("pending, applied and rejected requests with serials, kg, from / to order, PO and customer names", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const a = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }], { poNumber: "PO-FROM" });
    const b = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }], { customerId: p.otherCustomer, poNumber: "PO-TO" });
    const serials = await p.pack(s, [{ kg: 50 }, { kg: 60 }, { kg: 70 }], a.lineIds[0]);
    const ids = await idsOf(p, serials);
    const r1 = await p.owner.orders.reallocate({ bundleIds: [ids[0]!, ids[1]!], toLineId: b.lineIds[0]!, reason: "B is short" });
    const r2 = await p.owner.orders.reallocate({ bundleIds: [ids[2]!], toLineId: b.lineIds[0]!, reason: "and this" });

    const pending = await p.as("viewer").orders.reallocations.list({ status: "pending" });
    expect<unknown>(pending.items.map((i) => i.approvalId).sort()).toEqual([r1.approvalId, r2.approvalId].sort());
    const one = await p.as("viewer").orders.reallocations.get({ approvalId: r1.approvalId! });
    expect(one).toMatchObject({
      status: "pending",
      batchId: r1.batchId,
      kgG: kg(110),
      reason: "B is short",
      to: { lineId: b.lineIds[0], orderNumber: b.number, poNumber: "PO-TO", customerId: p.otherCustomer },
    });
    expect(one.bundles.map((x) => [x.serial, x.weightG, x.from?.poNumber, x.from?.orderNumber])).toEqual([
      [serials[0], kg(50), "PO-FROM", a.number],
      [serials[1], kg(60), "PO-FROM", a.number],
    ]);
    expect(one.to?.customerName).toBeTruthy();
    expect(JSON.stringify(one)).not.toMatch(/rate|paise/i);

    await p.as("manager").approval.decide({ id: r1.approvalId!, decision: "approved" });
    await p.as("manager").approval.decide({ id: r2.approvalId!, decision: "rejected" });
    expect<unknown>((await p.owner.orders.reallocations.list({ status: "applied" })).items.map((i) => i.approvalId)).toEqual([r1.approvalId]);
    expect<unknown>((await p.owner.orders.reallocations.list({ status: "rejected" })).items.map((i) => i.approvalId)).toEqual([r2.approvalId]);
    expect((await p.owner.orders.reallocations.list({ orderId: a.id })).total).toBe(2);
    const byBatch = await p.owner.orders.reallocations.get({ batchId: r1.batchId });
    expect(byBatch).toMatchObject({ status: "applied", approvalId: r1.approvalId });
    expect(byBatch.bundles.map((x) => x.moved)).toEqual([true, true]);
    await expect(p.owner.orders.reallocations.get({ batchId: crypto.randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, SLOW);
});

describe("orders.timeline: pack and dispatch events of the order's lines", () => {
  test("bundle.receipt.create for bundles packed for the order and dispatch.complete for its dispatch", async () => {
    const p = await opPlant();
    const { s, o, lineId } = await oneLine(p);
    const other = await oneLine(p);
    await p.pack(other.s, [{ kg: 10 }], other.lineId);
    const d = await p.held(await p.pack(s, [{ kg: 50 }], lineId));
    await p.owner.dispatch.complete({ id: d });
    const actions = (await p.owner.orders.timeline({ id: o.id })).events.map((e) => e.action);
    expect(actions.sort()).toEqual(["bundle.receipt.create", "dispatch.complete", "order.confirm", "order.create"]);
  }, SLOW);
});
