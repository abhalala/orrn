/**
 * XE store fix round 1 (review REVIEW-STORE): the valuation stays exact.
 * - Finding 1: a GRN cannot be cancelled once stock of the item went out after it (read time and inside
 *   the batch); the reviewer's scenarios A, B and C now refuse, and held value never goes below 0.
 * - Finding 4: the storekeeper does not set rates; a GRN with no PO is pending at the average; a
 *   store.rate holder sets it later under the same rule.
 * - Finding 10: old stock with no rate does not pull the average down; an opening rate values it.
 * - Owner decision 3: a fully rejected delivery is recorded with no stock and no value.
 * - Finding 2: two "make indent" clicks give one indent.
 * - Finding 6: an order closed by a full delivery still takes a top-up within the tolerance.
 * - Finding 7: the month report adds up (opening + in - out + rated = closing).
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { auditLog, storeIndent, storeOpeningRate, storeTxn } from "@orrn/db/schema";
import { monthValuation } from "@orrn/domain";
import { and, eq, sql } from "drizzle-orm";

import { workersEnv } from "./env-mock";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

setDefaultTimeout(30_000);

let env: TestEnv;
let setClock: (at: Date | null) => void;
let storeIssueValuePaise: typeof import("../src/lib/storeValue").storeIssueValuePaise;

beforeAll(async () => {
  env = await createTestEnv({ defaultModules: ["store_buy"] });
  setClock = (await import("../src/lib/clock")).setClockForTests;
  storeIssueValuePaise = (await import("../src/lib/storeValue")).storeIssueValuePaise;
});

afterEach(() => setClock(null));

afterAll(async () => {
  await env.dispose();
});

const ROLES: CompanyRole[] = ["owner", "admin", "manager", "office", "accountant", "storekeeper", "supervisor", "viewer"];
const U = 1000;
const ISSUED = "Stock from this delivery has already been issued. Record a return to the vendor instead.";

async function plant() {
  const { companyId } = await env.seedCompany();
  const c = Object.fromEntries(ROLES.map((role) => [role, env.caller({ role, companyId })])) as Record<
    (typeof ROLES)[number],
    ReturnType<typeof env.caller>
  >;
  await c.owner.stock.locations.seedDefaults();
  const ldo = await c.storekeeper.store.items.create({ name: "LDO", unit: "kg", category: "chemical" });
  const flux = await c.storekeeper.store.items.create({ name: "Cover flux", unit: "kg", category: "chemical" });
  const v = await c.manager.vendor.create({ name: "Shree Chemicals" });
  return { companyId, ...c, ldoId: ldo.id, fluxId: flux.id, vendorId: v.id };
}
type Plant = Awaited<ReturnType<typeof plant>>;

async function value(p: Plant, itemId: string) {
  return (await p.manager.store.valuation.items()).items.find((i) => i.id === itemId)!;
}

/** Raw sums straight from the rows, so no clamp on a screen can hide a regression. */
async function rawHeld(p: Plant, itemId: string) {
  const rows = await env.db
    .select()
    .from(storeTxn)
    .where(and(eq(storeTxn.companyId, p.companyId), eq(storeTxn.itemId, itemId)));
  const opening = await env.db
    .select()
    .from(storeOpeningRate)
    .where(and(eq(storeOpeningRate.companyId, p.companyId), eq(storeOpeningRate.itemId, itemId)));
  const live = rows.filter((r) => r.cancelledAt === null);
  const sign = (k: string) => (k === "grn" ? 1 : -1);
  return {
    qty: live.reduce((s, r) => s + sign(r.kind) * r.qtyMilli, 0),
    rated: live.reduce((s, r) => s + sign(r.kind) * r.ratedMilli, 0) + opening.reduce((s, o) => s + o.qtyMilli, 0),
    value: live.reduce((s, r) => s + sign(r.kind) * r.valuePaise, 0) + opening.reduce((s, o) => s + o.valuePaise, 0),
  };
}

async function auditActions(companyId: string) {
  return (await env.db.select().from(auditLog).where(eq(auditLog.companyId, companyId))).map((r) => r.action);
}

describe("finding 1: no GRN cancel after stock went out", () => {
  test("scenario A: refused with the plain sentence; nothing written; held value stays exact", async () => {
    const p = await plant();
    const a = await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 20_000 });
    await p.storekeeper.store.issue({ itemId: p.ldoId, qtyMilli: 10 * U, purpose: "other" });
    await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 10_000 });
    await expect(p.storekeeper.store.cancel({ txnId: a.id, reason: "wrong" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: ISSUED });
    expect((await env.db.select().from(storeTxn).where(eq(storeTxn.id, a.id)))[0]!.cancelledAt).toBeNull();
    expect((await auditActions(p.companyId)).filter((x) => x === "store.cancel")).toEqual([]);
    expect(await rawHeld(p, p.ldoId)).toEqual({ qty: 10 * U, rated: 10 * U, value: 100_000 });
    // GRN-C at ₹100: the average is the real ₹100 and a 5 kg issue costs ₹500 (was ₹0 before the fix).
    await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 10_000 });
    expect(await value(p, p.ldoId)).toMatchObject({ heldMilli: 20 * U, valuePaise: 200_000, avgRatePaise: 10_000 });
    const out = await p.storekeeper.store.issue({ itemId: p.ldoId, qtyMilli: 5 * U, purpose: "maintenance" });
    expect(await storeIssueValuePaise(env.db, p.companyId, out.id)).toBe(50_000);
  });

  test("scenario B: refused; the next average is the real rate, not 3x", async () => {
    const p = await plant();
    const a = await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 10_000 });
    await p.storekeeper.store.issue({ itemId: p.ldoId, qtyMilli: 10 * U, purpose: "other" });
    await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 30_000 });
    await expect(p.storekeeper.store.cancel({ txnId: a.id, reason: "wrong" })).rejects.toMatchObject({ message: ISSUED });
    await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 10_000 });
    expect(await value(p, p.ldoId)).toMatchObject({ heldMilli: 20 * U, valuePaise: 400_000, avgRatePaise: 20_000 });
    const raw = await rawHeld(p, p.ldoId);
    expect(raw.value).toBeGreaterThanOrEqual(0);
  });

  test("scenario C: a partial issue blocks the cancel too; cancelling the issue first lets it through exactly", async () => {
    const p = await plant();
    const a = await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 20_000 });
    const mrs = await p.storekeeper.store.issue({ itemId: p.ldoId, qtyMilli: 5 * U, purpose: "other" });
    await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 10_000 });
    await expect(p.storekeeper.store.cancel({ txnId: a.id, reason: "wrong" })).rejects.toMatchObject({ message: ISSUED });
    await p.storekeeper.store.cancel({ txnId: mrs.id, reason: "not used" });
    await p.storekeeper.store.cancel({ txnId: a.id, reason: "wrong" });
    expect(await rawHeld(p, p.ldoId)).toEqual({ qty: 10 * U, rated: 10 * U, value: 100_000 });
  });

  test("an issue BEFORE the GRN does not block it; an exchange is guarded as one group", async () => {
    const p = await plant();
    await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 10_000 });
    await p.storekeeper.store.issue({ itemId: p.ldoId, qtyMilli: 4 * U, purpose: "other" });
    const late = await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 3 * U, ratePaise: 30_000 });
    await p.storekeeper.store.cancel({ txnId: late.id, reason: "wrong" });
    expect(await rawHeld(p, p.ldoId)).toEqual({ qty: 6 * U, rated: 6 * U, value: 60_000 });
    // Exchange, then an issue after it: neither leg cancels, whichever leg is named.
    const ex = await p.storekeeper.store.exchange({ itemId: p.ldoId, qtyOutMilli: 2 * U, qtyInMilli: 2 * U });
    await p.storekeeper.store.issue({ itemId: p.ldoId, qtyMilli: U, purpose: "other" });
    await expect(p.storekeeper.store.cancel({ txnId: ex.mrsId, reason: "x" })).rejects.toMatchObject({ message: ISSUED });
    await expect(p.storekeeper.store.cancel({ txnId: ex.grnId, reason: "x" })).rejects.toMatchObject({ message: ISSUED });
    const legs = await env.db.select().from(storeTxn).where(eq(storeTxn.exchangeId, ex.exchangeId));
    expect(legs.every((l) => l.cancelledAt === null)).toBe(true);
  });

  test("RACE: an issue lands between the cancel's read and its batch; the batch guard refuses it", async () => {
    const p = await plant();
    const a = await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 20_000 });
    await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 10_000 });
    // Balance stays 20 - 5 = 15 >= 10, so only the new rule can stop it.
    env.beforeNextBatch(() => p.owner.store.issue({ itemId: p.ldoId, qtyMilli: 5 * U, purpose: "melt" }));
    await expect(p.storekeeper.store.cancel({ txnId: a.id, reason: "late" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: ISSUED });
    expect((await env.db.select().from(storeTxn).where(eq(storeTxn.id, a.id)))[0]!.cancelledAt).toBeNull();
    expect((await rawHeld(p, p.ldoId)).value).toBe(300_000 - 75_000);
  });
});

describe("finding 4: the storekeeper does not set rates", () => {
  test("a rate with no PO needs store.rate; without one the GRN is pending at the average, and the average holds", async () => {
    const p = await plant();
    await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 15_000 });
    await expect(p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 1_500_00 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const g = await p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U });
    const [row] = await env.db.select().from(storeTxn).where(eq(storeTxn.id, g.id));
    expect(row).toMatchObject({ ratePaise: null, ratePending: true, valuePaise: 150_000, ratedMilli: 10 * U });
    expect(await value(p, p.ldoId)).toMatchObject({ avgRatePaise: 15_000, pendingCount: 1, unratedMilli: 0 });
    const audit = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.subjectId, g.id)));
    expect(audit[0]!.meta).toMatchObject({ ratePaise: null, ratePending: true });
  });

  test("against a PO the PO rate holds; a different rate needs store.rate and the audit keeps both", async () => {
    const p = await plant();
    const po = await p.office.store.po.create({ vendorId: p.vendorId, lines: [{ itemId: p.ldoId, qtyMilli: 50 * U, ratePaise: 15_000, gstBp: 1_800 }] });
    await p.office.store.po.issue({ id: po.id });
    const lineId = (await p.office.store.po.get({ id: po.id })).lines[0]!.id;
    await expect(p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, poLineId: lineId, ratePaise: 150_000 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // Sending the PO's own rate is not a change.
    const same = await p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, poLineId: lineId, ratePaise: 15_000 });
    expect((await env.db.select().from(storeTxn).where(eq(storeTxn.id, same.id)))[0]).toMatchObject({ ratePaise: 15_000, ratePending: false });
    const typed = await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, poLineId: lineId, ratePaise: 14_000 });
    const audit = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.subjectId, typed.id)));
    expect(audit[0]!.meta).toMatchObject({ ratePaise: 14_000, poRatePaise: 15_000 });
  });

  test("setGrnRate: store.rate only, while nothing went out since; exact value; audited; tenancy", async () => {
    const p = await plant();
    const g = await p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U }); // unrated, no average
    await expect(p.storekeeper.store.valuation.setGrnRate({ txnId: g.id, ratePaise: 12_000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await plant();
    await expect(other.office.store.valuation.setGrnRate({ txnId: g.id, ratePaise: 12_000 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await p.office.store.valuation.pending()).items).toMatchObject([{ id: g.id, canSet: true }]);
    const r = await p.office.store.valuation.setGrnRate({ txnId: g.id, ratePaise: 12_000 });
    expect(r.valuePaise).toBe(120_000);
    expect(await rawHeld(p, p.ldoId)).toEqual({ qty: 10 * U, rated: 10 * U, value: 120_000 });
    expect(await auditActions(p.companyId)).toContain("store.rate.set");
    await expect(p.office.store.valuation.setGrnRate({ txnId: g.id, ratePaise: 1 })).rejects.toThrow(/no rate waiting/);

    // A pending GRN with an issue after it: refused, read time and listed as not settable.
    const g2 = await p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 5 * U });
    await p.storekeeper.store.issue({ itemId: p.ldoId, qtyMilli: U, purpose: "other" });
    expect((await p.accountant.store.valuation.pending()).items.find((i) => i.id === g2.id)).toMatchObject({ canSet: false });
    await expect(p.office.store.valuation.setGrnRate({ txnId: g2.id, ratePaise: 99_000 })).rejects.toMatchObject({ message: ISSUED });
  });

  test("RACE: setGrnRate loses to an issue that lands between its read and its batch", async () => {
    const p = await plant();
    await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 10_000 });
    const g = await p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U });
    env.beforeNextBatch(() => p.owner.store.issue({ itemId: p.ldoId, qtyMilli: 2 * U, purpose: "melt" }));
    await expect(p.office.store.valuation.setGrnRate({ txnId: g.id, ratePaise: 50_000 })).rejects.toMatchObject({ message: ISSUED });
    expect((await env.db.select().from(storeTxn).where(eq(storeTxn.id, g.id)))[0]).toMatchObject({ ratePending: true, valuePaise: 100_000 });
    expect(await auditActions(p.companyId)).not.toContain("store.rate.set");
  });
});

describe("finding 10: old stock with no rate", () => {
  test("does not pull the average down; shows as rate not set; an opening rate values it, audited", async () => {
    const p = await plant();
    // Old stock: a GRN from before valuation (rate NULL, value 0, not pending), as migration 0062 leaves it.
    const old = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 90 * U });
    await env.db.update(storeTxn).set({ ratePending: false }).where(eq(storeTxn.id, old.id));
    await p.owner.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U, ratePaise: 10_000 });
    expect(await value(p, p.fluxId)).toMatchObject({ heldMilli: 100 * U, valuePaise: 100_000, avgRatePaise: 10_000, unratedMilli: 90 * U });
    // A 4 kg issue takes rated stock at the real ₹100/kg.
    const out = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 4 * U, purpose: "melt" });
    expect(await storeIssueValuePaise(env.db, p.companyId, out.id)).toBe(40_000);

    await expect(p.storekeeper.store.valuation.setOpeningRate({ itemId: p.fluxId, ratePaise: 9_000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await plant();
    await expect(other.office.store.valuation.setOpeningRate({ itemId: p.fluxId, ratePaise: 9_000 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const set = await p.accountant.store.valuation.setOpeningRate({ itemId: p.fluxId, ratePaise: 9_000 });
    expect(set).toMatchObject({ qtyMilli: 90 * U, valuePaise: 810_000 });
    expect(await value(p, p.fluxId)).toMatchObject({ heldMilli: 96 * U, valuePaise: 870_000, unratedMilli: 0, openingRatePaise: 9_000 });
    expect(await auditActions(p.companyId)).toContain("store.rate.opening");
    await expect(p.accountant.store.valuation.setOpeningRate({ itemId: p.fluxId, ratePaise: 9_000 })).rejects.toThrow(/already has a rate/);
    // The old GRN is now valued by the opening rate: cancelling it is refused.
    await expect(p.storekeeper.store.cancel({ txnId: old.id, reason: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const raw = await rawHeld(p, p.fluxId);
    expect(raw).toEqual({ qty: 96 * U, rated: 96 * U, value: 870_000 });
  });

  test("a pending GRN covered by an opening rate can no longer have its own rate set", async () => {
    const p = await plant();
    const g = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U }); // no average: unrated
    await p.office.store.valuation.setOpeningRate({ itemId: p.fluxId, ratePaise: 5_000 });
    await expect(p.office.store.valuation.setGrnRate({ txnId: g.id, ratePaise: 6_000 })).rejects.toThrow(/no rate waiting/);
    expect(await rawHeld(p, p.fluxId)).toEqual({ qty: 10 * U, rated: 10 * U, value: 50_000 });
  });
});

describe("owner decision 3: a fully rejected delivery", () => {
  test("is recorded with 0 accepted: no stock, no value, the order stays open and cancellable", async () => {
    const p = await plant();
    const po = await p.office.store.po.create({ vendorId: p.vendorId, lines: [{ itemId: p.ldoId, qtyMilli: 50 * U, ratePaise: 9_000, gstBp: 0 }] });
    await p.office.store.po.issue({ id: po.id });
    const lineId = (await p.office.store.po.get({ id: po.id })).lines[0]!.id;
    await expect(p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 0, poLineId: lineId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const g = await p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 0, rejectedMilli: 50 * U, poLineId: lineId, grnRef: "CH-9" });
    expect((await env.db.select().from(storeTxn).where(eq(storeTxn.id, g.id)))[0]).toMatchObject({
      qtyMilli: 0, rejectedMilli: 50 * U, valuePaise: 0, ratedMilli: 0, ratePending: false,
    });
    expect(await rawHeld(p, p.ldoId)).toEqual({ qty: 0, rated: 0, value: 0 });
    const got = await p.office.store.po.get({ id: po.id });
    expect(got.po.status).toBe("issued");
    expect(got.grns.map((x) => x.id)).toContain(g.id);
    // The record never blocks: an issue cannot follow it (no stock), and the order can still be cancelled.
    await p.office.store.po.cancel({ id: po.id, reason: "Vendor sent the wrong grade" });
    // Without a PO too.
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 0, rejectedMilli: 3 * U });
  });
});

describe("finding 2: make indent from Today twice", () => {
  test("RACE: a second click lands between the first's read and batch; one indent, the second gets it back", async () => {
    const p = await plant();
    await p.storekeeper.store.items.update({ id: p.fluxId, minMilli: 20 * U, reorderMilli: 50 * U });
    let first: { id: string; existing: boolean } | null = null;
    env.beforeNextBatch(async () => {
      first = await p.storekeeper.store.indents.fromReorder({ itemId: p.fluxId });
    });
    const second = await p.storekeeper.store.indents.fromReorder({ itemId: p.fluxId });
    expect(first).toMatchObject({ existing: false });
    expect(second).toMatchObject({ id: first!.id, existing: true });
    const all = await env.db.select().from(storeIndent).where(eq(storeIndent.companyId, p.companyId));
    expect(all).toHaveLength(1);
  });
});

describe("finding 6: a fully received order still takes its tolerance", () => {
  test("closed by the full delivery, a late top-up within 5 % lands; closed short by hand takes none", async () => {
    const p = await plant();
    const po = await p.office.store.po.create({ vendorId: p.vendorId, lines: [{ itemId: p.ldoId, qtyMilli: 100 * U, ratePaise: 9_000, gstBp: 0 }] });
    await p.office.store.po.issue({ id: po.id });
    const lineId = (await p.office.store.po.get({ id: po.id })).lines[0]!.id;
    await p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 100 * U, poLineId: lineId });
    expect((await p.office.store.po.get({ id: po.id })).po.status).toBe("closed");
    expect((await p.storekeeper.store.po.openLines({ itemId: p.ldoId })).items.map((l) => l.roomMilli)).toEqual([5 * U]);
    await expect(p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 6 * U, poLineId: lineId })).rejects.toThrow(/Over the order/);
    await p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 4 * U, poLineId: lineId });
    expect((await p.office.store.po.get({ id: po.id })).po.status).toBe("closed");

    const short = await p.office.store.po.create({ vendorId: p.vendorId, lines: [{ itemId: p.fluxId, qtyMilli: 10 * U, ratePaise: 100, gstBp: 0 }] });
    await p.office.store.po.issue({ id: short.id });
    const shortLine = (await p.office.store.po.get({ id: short.id })).lines[0]!.id;
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U, poLineId: shortLine });
    await p.office.store.po.close({ id: short.id, note: "Rest not needed" });
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U, poLineId: shortLine })).rejects.toThrow(/not open for deliveries/);
  });
});

describe("finding 7: the month report adds up", () => {
  test("opening + in - out + rated = closing per item and in the totals, with an opening rate in the month", async () => {
    const p = await plant();
    const ist = (d: number) => new Date(Date.UTC(2026, 9, d, 6, 30));
    setClock(new Date(Date.UTC(2026, 8, 20, 6)));
    const old = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 40 * U });
    await env.db.update(storeTxn).set({ ratePending: false }).where(eq(storeTxn.id, old.id));
    setClock(ist(2));
    await p.owner.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U, ratePaise: 10_000 });
    setClock(ist(4));
    await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 15 * U, purpose: "melt" });
    setClock(ist(9));
    await p.office.store.valuation.setOpeningRate({ itemId: p.fluxId, ratePaise: 8_000 });
    setClock(null);
    const r = await p.office.store.valuation.month({ month: "2026-10" });
    const f = r.items.find((i) => i.itemId === p.fluxId)!;
    expect(f).toMatchObject({ openingMilli: 40 * U, openingPaise: 0, inPaise: 100_000, outPaise: 100_000, ratedPaise: 280_000, closingMilli: 35 * U });
    expect(f.closingPaise).toBe(f.openingPaise + f.inPaise - f.outPaise + f.ratedPaise);
    expect(f.closingUnratedMilli).toBe(0);
    expect(r.totals.closingPaise).toBe(r.totals.openingPaise + r.totals.inPaise - r.totals.outPaise + r.totals.ratedPaise);
    // The domain's monthValuation agrees, opening rates included.
    const rows = await env.db.select().from(storeTxn).where(eq(storeTxn.companyId, p.companyId));
    const rates = await env.db.select().from(storeOpeningRate).where(eq(storeOpeningRate.companyId, p.companyId));
    const want = monthValuation(
      [
        ...rows.filter((t) => t.itemId === p.fluxId).map((t) => ({ kind: t.kind, qtyMilli: t.qtyMilli, valuePaise: t.valuePaise, createdAt: t.createdAt.getTime(), cancelledAt: t.cancelledAt?.getTime() ?? null })),
        ...rates.map((o) => ({ kind: "rate" as const, qtyMilli: o.qtyMilli, valuePaise: o.valuePaise, createdAt: o.createdAt.getTime(), cancelledAt: null })),
      ],
      r.from,
      r.to,
    );
    expect(f).toMatchObject(want);
    // September: the old stock shows as rate not set.
    const sep = await p.office.store.valuation.month({ month: "2026-09" });
    expect(sep.items.find((i) => i.itemId === p.fluxId)).toMatchObject({ closingMilli: 40 * U, closingPaise: 0, closingUnratedMilli: 40 * U });
  });
});

/**
 * Fix round 3 (re-check RECHECK-STORE): an unrated GRN still cancels after later issues; exchange value
 * follows units; a storekeeper's `ratePaise: null` means pending; `storeIssueValuePaise` says whether an
 * issue was fully rated; a backup restore keeps the rowid order the cancel guard compares.
 */
describe("fix round 3", () => {
  test("re-check 1, unrated: old GRN, typo GRN, rated GRN, issue; the unrated typo still cancels and the value stays exact", async () => {
    const p = await plant();
    // Old stock as migration 0062 leaves it (rate NULL, value 0, not pending).
    const old = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 90 * U });
    await env.db.update(storeTxn).set({ ratePending: false }).where(eq(storeTxn.id, old.id));
    // A storekeeper typo with no average to borrow: unrated, pending, no money.
    const typo = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 100 * U });
    expect((await env.db.select().from(storeTxn).where(eq(storeTxn.id, typo.id)))[0]).toMatchObject({ valuePaise: 0, ratedMilli: 0, ratePending: true });
    await p.owner.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U, ratePaise: 10_000 });
    // 30 kg out takes the rated 10 kg (₹1,000) and 20 kg with no rate (₹0).
    const out = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 30 * U, purpose: "maintenance" });
    expect(await rawHeld(p, p.fluxId)).toEqual({ qty: 170 * U, rated: 0, value: 0 });

    await p.storekeeper.store.cancel({ txnId: typo.id, reason: "typed twice" });
    expect((await env.db.select().from(storeTxn).where(eq(storeTxn.id, typo.id)))[0]!.cancelledAt).not.toBeNull();
    expect(await rawHeld(p, p.fluxId)).toEqual({ qty: 70 * U, rated: 0, value: 0 });
    // The issue's frozen value did not move.
    expect(await storeIssueValuePaise(env.db, p.companyId, out.id)).toBe(100_000);
    // The old GRN cannot come out: only 70 kg is held (the short-balance rule, not the money rule).
    await expect(p.storekeeper.store.cancel({ txnId: old.id, reason: "x" })).rejects.toThrow(/Cannot cancel/);

    // An opening rate then values the 70 kg; a new unrated GRN after it still cancels and the value stays.
    await p.office.store.valuation.setOpeningRate({ itemId: p.fluxId, ratePaise: 8_000 });
    expect(await rawHeld(p, p.fluxId)).toEqual({ qty: 70 * U, rated: 70 * U, value: 560_000 });
  });

  test("re-check 1, rated: a GRN with a rate, or one that borrowed the average, is still refused after an issue", async () => {
    const p = await plant();
    const rated = await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 10_000 });
    const borrowed = await p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U });
    expect((await env.db.select().from(storeTxn).where(eq(storeTxn.id, borrowed.id)))[0]).toMatchObject({ ratePending: true, valuePaise: 100_000, ratedMilli: 10 * U });
    await p.storekeeper.store.issue({ itemId: p.ldoId, qtyMilli: U, purpose: "melt" });
    await expect(p.storekeeper.store.cancel({ txnId: rated.id, reason: "x" })).rejects.toMatchObject({ message: ISSUED });
    await expect(p.storekeeper.store.cancel({ txnId: borrowed.id, reason: "x" })).rejects.toMatchObject({ message: ISSUED });
    expect(await rawHeld(p, p.ldoId)).toEqual({ qty: 19 * U, rated: 19 * U, value: 190_000 });
  });

  test("nit 5: an exchange with fewer in than out keeps the average; its cancel restores exactly", async () => {
    const p = await plant();
    await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: 10_000 });
    const ex = await p.storekeeper.store.exchange({ itemId: p.ldoId, qtyOutMilli: 5 * U, qtyInMilli: 2 * U });
    const legs = await env.db.select().from(storeTxn).where(eq(storeTxn.exchangeId, ex.exchangeId));
    expect(legs.find((l) => l.kind === "mrs")).toMatchObject({ valuePaise: 50_000, ratedMilli: 5 * U });
    expect(legs.find((l) => l.kind === "grn")).toMatchObject({ valuePaise: 20_000, ratedMilli: 2 * U });
    expect(await value(p, p.ldoId)).toMatchObject({ heldMilli: 7 * U, valuePaise: 70_000, avgRatePaise: 10_000 });
    await p.storekeeper.store.cancel({ txnId: ex.grnId, reason: "wrong part" });
    expect(await rawHeld(p, p.ldoId)).toEqual({ qty: 10 * U, rated: 10 * U, value: 100_000 });
    // More in than out: all the old leg's money comes back, the extra unit is unrated.
    const ex2 = await p.storekeeper.store.exchange({ itemId: p.ldoId, qtyOutMilli: 2 * U, qtyInMilli: 3 * U });
    const legs2 = await env.db.select().from(storeTxn).where(eq(storeTxn.exchangeId, ex2.exchangeId));
    expect(legs2.find((l) => l.kind === "grn")).toMatchObject({ valuePaise: 20_000, ratedMilli: 2 * U });
    expect(await value(p, p.ldoId)).toMatchObject({ heldMilli: 11 * U, valuePaise: 100_000, avgRatePaise: 10_000, unratedMilli: U });
  });

  test("nit 7: a storekeeper's ratePaise null is pending without a PO and the order's rate with one", async () => {
    const p = await plant();
    const g = await p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, ratePaise: null });
    expect((await env.db.select().from(storeTxn).where(eq(storeTxn.id, g.id)))[0]).toMatchObject({ ratePaise: null, ratePending: true });
    const po = await p.office.store.po.create({ vendorId: p.vendorId, lines: [{ itemId: p.ldoId, qtyMilli: 50 * U, ratePaise: 15_000, gstBp: 0 }] });
    await p.office.store.po.issue({ id: po.id });
    const lineId = (await p.office.store.po.get({ id: po.id })).lines[0]!.id;
    const onPo = await p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, poLineId: lineId, ratePaise: null });
    expect((await env.db.select().from(storeTxn).where(eq(storeTxn.id, onPo.id)))[0]).toMatchObject({ ratePaise: 15_000, ratePending: false });
    // An owner's (store.rate) null against an order still means "rate pending".
    const ownerNull = await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 5 * U, poLineId: lineId, ratePaise: null });
    expect((await env.db.select().from(storeTxn).where(eq(storeTxn.id, ownerNull.id)))[0]).toMatchObject({ ratePaise: null, ratePending: true });
    // Any other rate is still refused.
    await expect(p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: U, ratePaise: 100 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("nit 6: storeIssueValuePaise with { detail: true } says whether the issue was fully rated", async () => {
    const p = await plant();
    const old = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 90 * U });
    await env.db.update(storeTxn).set({ ratePending: false }).where(eq(storeTxn.id, old.id));
    await p.owner.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U, ratePaise: 10_000 });
    const small = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 4 * U, purpose: "maintenance" });
    const big = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 30 * U, purpose: "maintenance" });
    expect(await storeIssueValuePaise(env.db, p.companyId, small.id, { detail: true })).toEqual({
      valuePaise: 40_000, qtyMilli: 4 * U, ratedMilli: 4 * U, fullyRated: true,
    });
    expect(await storeIssueValuePaise(env.db, p.companyId, big.id, { detail: true })).toEqual({
      valuePaise: 60_000, qtyMilli: 30 * U, ratedMilli: 6 * U, fullyRated: false,
    });
    // The plain call still returns the number.
    expect(await storeIssueValuePaise(env.db, p.companyId, big.id)).toBe(60_000);
    const other = await plant();
    expect(await storeIssueValuePaise(env.db, other.companyId, big.id, { detail: true })).toEqual({ valuePaise: 0, qtyMilli: 0, ratedMilli: 0, fullyRated: false });
    expect(await storeIssueValuePaise(env.db, p.companyId, old.id, { detail: true })).toMatchObject({ fullyRated: false, valuePaise: 0 });
  });

  test("re-check 2: export and restore keep the GRN / issue order the cancel guard compares", async () => {
    const p = await plant();
    const po = await p.office.store.po.create({ vendorId: p.vendorId, lines: [{ itemId: p.ldoId, qtyMilli: 50 * U, ratePaise: 10_000, gstBp: 0 }] });
    await p.office.store.po.issue({ id: po.id });
    const lineId = (await p.office.store.po.get({ id: po.id })).lines[0]!.id;
    const g1 = await p.storekeeper.store.receive({ itemId: p.ldoId, qtyMilli: 10 * U, poLineId: lineId });
    const m1 = await p.storekeeper.store.issue({ itemId: p.ldoId, qtyMilli: U, purpose: "melt" });
    const g2 = await p.owner.store.receive({ itemId: p.ldoId, qtyMilli: 5 * U, ratePaise: 10_000 });
    const want = [g1.id, m1.id, g2.id];
    const numbers = new Map((await env.db.select().from(storeTxn).where(eq(storeTxn.companyId, p.companyId))).map((r) => [r.id, r.number]));

    const objects = new Map<string, string>();
    workersEnv.BACKUPS = {
      async put(key: string, v: string) { objects.set(key, v); return { key }; },
      async get(key: string) { const v = objects.get(key); return v === undefined ? null : { text: async () => v }; },
    };
    try {
      const staff = env.caller({ platformRole: "admin" });
      await staff.platform.backup.run({ companyId: p.companyId });
      const [key] = [...objects.keys()];
      const payload = JSON.parse(objects.get(key!)!) as { tables: Record<string, { columns: string[]; rows: unknown[][] }> };
      const t = payload.tables.store_txn!;
      const idIdx = t.columns.indexOf("id");
      expect(t.rows.map((r) => r[idIdx])).toEqual(want);

      const drill = await env.caller({ platformRole: "super_admin" }).platform.backup.drill({ companyId: p.companyId });
      expect(drill.status).toBe("ok");
      const restored = await env.db.all<{ number: string; kind: string; out_since: number }>(sql`
        select g.number, g.kind,
          (case when exists (select 1 from store_txn os where os.company_id = g.company_id and os.item_id = g.item_id
            and os.kind = 'mrs' and os.cancelled_at is null and os.rowid > g.rowid) then 1 else 0 end) as out_since
        from store_txn g where g.company_id = ${drill.scratchCompanyId} order by g.rowid`);
      expect(restored.map((r) => r.number)).toEqual(want.map((id) => numbers.get(id)!));
      // The PO GRN still has an issue after it; the later GRN does not.
      expect(restored.map((r) => [r.kind, Number(r.out_since)])).toEqual([["grn", 1], ["mrs", 0], ["grn", 0]]);
    } finally {
      delete workersEnv.BACKUPS;
    }
  });
});
