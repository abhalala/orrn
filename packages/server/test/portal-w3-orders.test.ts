/**
 * W3-PORTAL-S portal orders (C29, D6; specs §E7 "Portal order"): the party books through the same
 * insert path as `orders.create` (source portal, status booking, customer fixed). Never a rate
 * (BAD_REQUEST), never a copy / tier / status / customer. Pieces or kg; the other side on band start.
 * The office confirms with `orders.confirm` (dieRequiredOnSalesOrder: copy or tier first) or rejects
 * with `orders.cancel` (-> cancelled). The party only reads its own orders; no rate in any answer.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, die, salesOrder, salesOrderLine } from "@orrn/db/schema";
import { orderGrams } from "@orrn/domain";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { portalHelpers } from "./portal-w3-fixture";
import { kg, NOON, saveOrder, SLOW, type SalesPlant } from "./sales-fixture";

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

const h = portalHelpers(() => env);

/** A portal plant whose section A carries alloy / temper and is granted to the party. */
async function setup(settings: Record<string, unknown> = {}) {
  const p = await h.portalPlant(settings);
  await env.db.update(die).set({ alloy: "6063", temper: "T6", weightMinG: 2_400, weightMaxG: 2_600 }).where(eq(die.id, p.dieA));
  await p.as("office").portal.sections.grant({ customerId: p.customerId, dieId: p.dieA });
  const party = await h.partyLogin(p);
  return { p, party };
}

async function errOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    return { code: (e as { code?: string }).code, message: (e as Error).message };
  }
  return { code: "OK", message: "" };
}

describe("portal.orders.create", () => {
  test("books a portal booking for the party's own customer; kg from pieces on band start; audit without kg", async () => {
    setClock(NOON);
    const { p, party } = await setup();
    const made = await party.api.portal.orders.create({
      poNumber: "KD-77",
      note: "Need by month end",
      lines: [
        { sectionId: p.dieA, cutLengthMm: 3_658, pcs: 200 },
        { sectionId: p.dieA, cutLengthMm: 4_267, kgG: kg(500) },
      ],
    });
    expect(made).toMatchObject({ status: "booking", replayed: false });
    expect(made.number).toMatch(/^SO-\d+$/);
    const [row] = await env.db.select().from(salesOrder).where(eq(salesOrder.id, made.id));
    expect(row).toMatchObject({ source: "portal", status: "booking", customerId: p.customerId, poNumber: "KD-77", createdBy: party.userId });
    const lines = await env.db.select().from(salesOrderLine).where(eq(salesOrderLine.salesOrderId, made.id));
    const l1 = lines.find((l) => l.lineNo === 1)!;
    expect(l1).toMatchObject({ pcs: 200, qtyBasis: "pcs", weightBasis: "band_start", bandStartMilli: 2_400, dieInstanceId: null, tierRank: null, ratePaise: null, alloy: "6063", temper: "T6" });
    expect(l1.kgG).toBe(orderGrams(200, 3_658, 2_400, "mm"));
    const l2 = lines.find((l) => l.lineNo === 2)!;
    expect(l2).toMatchObject({ kgG: kg(500), qtyBasis: "kg" });
    expect(l2.pcs).toBeGreaterThan(0);
    // Audit: portal.order.create with order and customer ids only (no kg, no rate); no office order.create.
    const rows = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.subjectId, made.id)));
    expect(rows.map((a) => a.action)).toEqual(["portal.order.create"]);
    expect(Object.keys(rows[0]!.meta as object).sort()).toEqual(["customerId", "number", "period", "salesOrderId"]);
    expect(rows[0]!.actorId).toBe(party.userId);
    // The office sees it in its book as a booking from the portal.
    const got = await p.as("office").orders.get({ id: made.id });
    expect(got.order).toMatchObject({ status: "booking", source: "portal" });
  }, SLOW);

  test("rate, copy, tier, status, customer and basis are refused (BAD_REQUEST), nothing saved", async () => {
    const { p, party } = await setup({ priceOnSalesOrder: true });
    const base = { sectionId: p.dieA, cutLengthMm: 3_658, pcs: 10 };
    const bad: unknown[] = [
      { lines: [{ ...base, ratePaise: 42_500 }] },
      { lines: [{ ...base, rate: 425 }] },
      { lines: [base], ratePaise: 1 },
      { lines: [{ ...base, dieInstanceId: "x" }] },
      { lines: [{ ...base, tierRank: 1 }] },
      { lines: [{ ...base, weightBasis: "copy_current" }] },
      { lines: [base], status: "confirmed" },
      { lines: [base], customerId: p.otherCustomer },
      { lines: [{ sectionId: p.dieA, cutLengthMm: 3_658 }] },
    ];
    for (const input of bad) {
      expect((await errOf(party.api.portal.orders.create(input as never))).code).toBe("BAD_REQUEST");
    }
    expect((await errOf(party.api.portal.orders.create({ lines: [{ ...base, ratePaise: 1 } as never] }))).message).toContain("rate");
    expect(await env.db.select().from(salesOrder).where(eq(salesOrder.companyId, p.companyId))).toHaveLength(0);
  }, SLOW);

  test("orders module off: FORBIDDEN; replay with the same key returns the same order", async () => {
    const { p, party } = await setup();
    const once = await party.api.portal.orders.create({ clientRequestId: "k-1", lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, pcs: 5 }] });
    const again = await party.api.portal.orders.create({ clientRequestId: "k-1", lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, pcs: 5 }] });
    expect(again).toMatchObject({ id: once.id, number: once.number, replayed: true });
    expect((await errOf(party.api.portal.orders.create({ clientRequestId: "k-1", lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, pcs: 6 }] }))).code).toBe("CONFLICT");
    const { company } = await import("@orrn/db/schema");
    await env.db.update(company).set({ modules: ["customers", "dies"] }).where(eq(company.id, p.companyId));
    expect((await errOf(party.api.portal.orders.create({ lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, pcs: 5 }] }))).code).toBe("FORBIDDEN");
  }, SLOW);

  test("20 lines stay within 100 bound parameters; 21 are refused", async () => {
    const { p, party } = await setup();
    env.resetPeakParams();
    const lines = Array.from({ length: 20 }, (_, i) => ({ sectionId: p.dieA, cutLengthMm: 3_000 + i, pcs: 10 + i }));
    await party.api.portal.orders.create({ lines });
    expect(env.peakParams()).toBeLessThanOrEqual(100);
    expect((await errOf(party.api.portal.orders.create({ lines: [...lines, lines[0]!] }))).code).toBe("BAD_REQUEST");
  }, SLOW);
});

describe("office confirm / reject", () => {
  async function booked(settings: Record<string, unknown> = {}) {
    const s = await setup(settings);
    const made = await s.party.api.portal.orders.create({ lines: [{ sectionId: s.p.dieA, cutLengthMm: 3_658, pcs: 100 }] });
    return { ...s, made };
  }

  test("dieRequiredOnSalesOrder on: confirm refused until the office adds a PO and a tier; the party sees confirmed", async () => {
    const { p, party, made } = await booked();
    const office = p.as("office");
    const refused = await errOf(office.orders.confirm({ id: made.id }));
    expect(refused.code).toBe("BAD_REQUEST");
    expect(refused.message).toContain("line_1_die_or_tier");
    expect(refused.message).toContain("po_number");
    const got = await office.orders.get({ id: made.id });
    const l = got.lines[0]!;
    await saveOrder(office, {
      id: made.id,
      poNumber: "KD-PO-1",
      lines: [{ id: l.lineId, sectionId: l.sectionId, cutLengthMm: l.cutLengthMm, kgG: l.orderedG, pcs: l.orderedPcs, tierRank: 1 }],
    });
    await office.orders.confirm({ id: made.id });
    const mine = await party.api.portal.orders.get({ id: made.id });
    expect(mine.status).toBe("confirmed");
    expect(mine.poNumber).toBe("KD-PO-1");
  }, SLOW);

  test("dieRequiredOnSalesOrder off: a PO is enough (no copy, no tier)", async () => {
    const { p, made } = await booked({ dieRequiredOnSalesOrder: false });
    const office = p.as("office");
    const got = await office.orders.get({ id: made.id });
    expect(got.confirmBlockers).toEqual(["po_number"]);
    const l = got.lines[0]!;
    await saveOrder(office, {
      id: made.id,
      poNumber: "KD-PO-2",
      lines: [{ id: l.lineId, sectionId: l.sectionId, cutLengthMm: l.cutLengthMm, kgG: l.orderedG, pcs: l.orderedPcs }],
    });
    await office.orders.confirm({ id: made.id });
    expect((await office.orders.get({ id: made.id })).order.status).toBe("confirmed");
  }, SLOW);

  test("office rejects with orders.cancel -> cancelled (D6); the party sees it; the party cannot confirm or cancel", async () => {
    const { p, party, made } = await booked();
    expect((await errOf(party.api.orders.confirm({ id: made.id }))).code).toBe("FORBIDDEN");
    expect((await errOf(party.api.orders.cancel({ id: made.id, reason: "x" }))).code).toBe("FORBIDDEN");
    expect((await errOf(party.api.orders.get({ id: made.id }))).code).toBe("FORBIDDEN");
    await p.as("office").orders.cancel({ id: made.id, reason: "Section not running this month" });
    expect((await party.api.portal.orders.get({ id: made.id })).status).toBe("cancelled");
    const list = await party.api.portal.orders.list({ status: "open" });
    expect(list.items.map((o) => o.id)).not.toContain(made.id);
    expect((await party.api.portal.orders.list({ status: "cancelled" })).items.map((o) => o.id)).toEqual([made.id]);
  }, SLOW);
});

describe("portal reads of orders", () => {
  test("only the party's orders; ordered / dispatched / baki; never a rate even when the office set one", async () => {
    setClock(NOON);
    const { p, party } = await setup({ priceOnSalesOrder: true });
    const office = p.as("office");
    // The office books one for this party with a rate, and one for another party.
    const mineOffice = await office.orders.create({
      customerId: p.customerId,
      lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(300), pcs: 50, ratePaise: 42_500 }],
    });
    const theirs = await office.orders.create({ customerId: p.otherCustomer, lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(100) }] });
    const mineParty = await party.api.portal.orders.create({ lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, pcs: 20 }] });
    const list = await party.api.portal.orders.list();
    expect(list.items.map((o) => o.id).sort()).toEqual([mineOffice.id, mineParty.id].sort());
    const got = await party.api.portal.orders.get({ id: mineOffice.id });
    expect(got.lines[0]).toMatchObject({ orderedG: kg(300), dispatchedG: 0, bakiG: kg(300) });
    expect(got.totals).toMatchObject({ orderedG: kg(300), bakiG: kg(300) });
    const text = JSON.stringify([list, got]);
    expect(text).not.toMatch(/rate|paise|42500/i);
    expect((await errOf(party.api.portal.orders.get({ id: theirs.id })))).toEqual({ code: "NOT_FOUND", message: "Not found" });
    const today = await party.api.portal.today();
    expect(today.openOrders).toBe(2);
    const partyGot = await party.api.portal.orders.get({ id: mineParty.id });
    expect(today.bakiG).toBe(got.totals.bakiG + partyGot.totals.bakiG);
    expect(JSON.stringify(today)).not.toMatch(/rate|paise/i);
  }, SLOW);

  test("baki falls as the office dispatches against the party's order", async () => {
    setClock(NOON);
    const { p, party }: { p: SalesPlant; party: Awaited<ReturnType<typeof h.partyLogin>> } = await setup();
    const o = await p.order([{ dieId: p.dieA, kg: 100, pcs: 10 }], { poNumber: "KD-9", status: "confirmed" });
    const serials = await p.pack(p.dieA, [{ kg: 40 }], o.lineIds[0]);
    const d = await p.held(serials);
    await p.owner.dispatch.complete({ id: d });
    const got = await party.api.portal.orders.get({ id: o.id });
    expect(got.lines[0]).toMatchObject({ orderedG: kg(100), dispatchedG: kg(40), bakiG: kg(60) });
    expect(got.status).toBe("dispatching");
  }, SLOW);
});
