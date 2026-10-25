/**
 * W4-ANALYTICS: stock age (`analytics.stockAge`, FP-PK-16: available bundles only, company calendar
 * days 0-7 / 8-30 / 31-90 / over 90, per party and plant stock) on a frozen clock, and the order
 * summary (`analytics.orders`: by party / by order month from the order book's own SQL, so it is
 * the sum of the book rows and its total is `orders.bookTotals`). Rupee columns only for
 * `order.price` holders while `priceOnSalesOrder` is on; asking without both is refused, and the
 * plain answer carries no rupee field at all (rate leak).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { bundle, salesOrderLine } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";
import { opHelpers } from "./orders-w1-fixture";
import { ist, kg, ROLES, saveOrder, SLOW } from "./sales-fixture";

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
const NOON = new Date("2026-10-20T06:30:00.000Z"); // 12:00 IST, 2026-10-20
const HOUR = 3_600_000;
const READERS: CompanyRole[] = ["owner", "admin", "manager", "office", "accountant", "supervisor", "viewer"];

type Plant = Awaited<ReturnType<typeof opPlant>>;

async function packedAt(p: Plant, serial: string, at: Date) {
  await env.db.update(bundle).set({ createdAt: at }).where(and(eq(bundle.companyId, p.companyId), eq(bundle.serial, serial)));
}

describe("analytics.stockAge", () => {
  test("buckets 0-7, 8-30, 31-90, over 90 by company calendar day, available only, per party and plant stock", async () => {
    setClock(NOON);
    const p = await opPlant();
    const s1 = await p.section();
    await p.copy(s1, { milli: 12_000 });
    const order = await p.confirmedOrder([{ sectionId: s1, pcs: 100 }]);
    // Party stock (on the order line): ages 0, 7, 8 and 91 days.
    const party = await p.pack(s1, [{ kg: 101 }, { kg: 102 }, { kg: 103 }, { kg: 104 }], order.lineIds[0]);
    // Plant stock (no line): ages 30, 31, 90, 91 days; then one reserved and one void (never counted).
    const plant = await p.pack(s1, [{ kg: 201 }, { kg: 202 }, { kg: 203 }, { kg: 204 }, { kg: 205 }, { kg: 206 }]);
    await packedAt(p, party[0]!, ist("2026-10-20T09:00"));
    await packedAt(p, party[1]!, ist("2026-10-13T00:00")); // 7 days: the edge stays in 0-7
    await packedAt(p, party[2]!, ist("2026-10-12T23:59")); // 8 days
    await packedAt(p, party[3]!, ist("2026-07-21T23:59")); // 91 days
    await packedAt(p, plant[0]!, ist("2026-09-20T00:00")); // 30 days
    await packedAt(p, plant[1]!, ist("2026-09-19T23:59")); // 31 days
    await packedAt(p, plant[2]!, ist("2026-07-22T00:00")); // 90 days
    await packedAt(p, plant[3]!, ist("2026-07-01T10:00")); // 111 days
    await p.held([plant[4]!]); // reserved on a dispatch: not lying in the yard
    await env.db.update(bundle).set({ status: "void" }).where(and(eq(bundle.companyId, p.companyId), eq(bundle.serial, plant[5]!)));

    const age = await p.as("office").analytics.stockAge({});
    expect(age.today).toBe("2026-10-20");
    expect(age.asOf).toBe(NOON.toISOString());
    expect(age.buckets).toEqual([
      { key: "0-7", minDays: 0, maxDays: 7, bundles: 2, kgG: kg(203) },
      { key: "8-30", minDays: 8, maxDays: 30, bundles: 2, kgG: kg(304) },
      { key: "31-90", minDays: 31, maxDays: 90, bundles: 2, kgG: kg(405) },
      { key: "90+", minDays: 91, maxDays: null, bundles: 2, kgG: kg(308) },
    ]);
    expect(age.totals).toEqual({ bundles: 8, kgG: kg(1_220) });
    expect(age.over90).toEqual({ bundles: 2, kgG: kg(308) });
    // Rows: plant stock (810 kg) before the party (410 kg); each row's cells add up to its total.
    expect(age.rows.map((r) => [r.customerId, r.bundles, r.kgG])).toEqual([
      [null, 4, kg(810)],
      [p.customerId, 4, kg(410)],
    ]);
    const partyRow = age.rows.find((r) => r.customerId === p.customerId)!;
    expect(partyRow.customerName).toBeTruthy();
    expect(partyRow.buckets).toEqual([
      { bundles: 2, kgG: kg(203) },
      { bundles: 1, kgG: kg(103) },
      { bundles: 0, kgG: 0 },
      { bundles: 1, kgG: kg(104) },
    ]);
    for (const r of age.rows) expect(r.buckets.reduce((s, c) => s + c.kgG, 0)).toBe(r.kgG);

    // Filters: plant stock only, one party only.
    expect((await p.as("office").analytics.stockAge({ plantOnly: true })).rows.map((r) => r.customerId)).toEqual([null]);
    const one = await p.as("office").analytics.stockAge({ customerId: p.customerId });
    expect(one.totals).toEqual({ bundles: 4, kgG: kg(410) });

    // A day later the 7-day bundle turns 8.
    setClock(new Date(NOON.getTime() + 24 * HOUR));
    const next = await p.as("office").analytics.stockAge({ customerId: p.customerId });
    expect(next.buckets.map((b) => b.bundles)).toEqual([1, 2, 0, 1]);

    // Another plant sees none of it.
    const q = await opPlant();
    expect((await q.as("office").analytics.stockAge({})).totals).toEqual({ bundles: 0, kgG: 0 });
  }, SLOW);

  test("reports.read holders read stock age; floor roles are refused", async () => {
    const p = await opPlant();
    for (const role of ROLES) {
      const call = p.as(role).analytics.stockAge({});
      if (READERS.includes(role)) expect((await call).totals.bundles).toBe(0);
      else await expect(call).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  }, SLOW);
});

/** A: two lines (one bundle sent, stock on hand); B: other party, stock past ordered; C: a September order running late. */
async function book(settings: Record<string, unknown> = {}) {
  setClock(NOON);
  const p = await opPlant({ settings });
  const s1 = await p.section();
  const s2 = await p.section();
  await p.copy(s1, { milli: 12_000 });
  await p.copy(s2, { milli: 12_000 });
  const a = await p.confirmedOrder([
    { sectionId: s1, pcs: 100 }, // 1,200 kg
    { sectionId: s2, pcs: 50 }, // 600 kg
  ]);
  const aBundles = await p.pack(s1, [{ kg: 120 }, { kg: 120 }, { kg: 120 }], a.lineIds[0]);
  await p.owner.dispatch.complete({ id: await p.held([aBundles[0]!]) });
  const b = await p.confirmedOrder([{ sectionId: s1, pcs: 10 }], { customerId: p.otherCustomer }); // 120 kg
  await p.pack(s1, [{ kg: 200 }], b.lineIds[0]); // in stock, 80 kg past ordered
  const c = await p.confirmedOrder([{ sectionId: s2, pcs: 20 }]); // 240 kg
  await saveOrder(p.owner, { id: c.id, orderDate: "2026-09-15" });
  return { p, a, b, c, s1, s2 };
}

describe("analytics.orders", () => {
  test("by party and by month: each row is the sum of its book rows; the total is the strip", async () => {
    const { p, a, b, c } = await book();
    const office = p.as("office");
    const list = await p.owner.orders.list({ limit: 100 });
    const strip = await p.owner.orders.bookTotals({});

    const byParty = await office.analytics.orders({ groupBy: "customer" });
    expect(byParty.totals).toEqual(strip);
    const sumOf = (items: typeof list.items) => ({
      orders: items.length,
      lateOrders: items.filter((i) => i.lateDays != null).length,
      orderedG: items.reduce((s, i) => s + i.orderedG, 0),
      dispatchedG: items.reduce((s, i) => s + i.bar.dispatchedG, 0),
      bakiG: items.reduce((s, i) => s + i.bakiG, 0),
    });
    for (const row of byParty.rows) {
      expect({ key: row.key, ...sumOf(list.items.filter((i) => i.customerId === row.key)) }).toEqual({
        key: row.key,
        orders: row.orders,
        lateOrders: row.lateOrders,
        orderedG: row.orderedG,
        dispatchedG: row.dispatchedG,
        bakiG: row.bakiG,
      });
    }
    // Party A: A (1,800) + C (240), 120 sent, C late; party B: 120 ordered, nothing sent.
    expect(byParty.rows.map((r) => [r.key, r.orders, r.orderedG, r.dispatchedG, r.bakiG, r.lateOrders])).toEqual([
      [p.customerId, 2, kg(2_040), kg(120), kg(1_920), 1],
      [p.otherCustomer, 1, kg(120), 0, kg(120), 0],
    ]);
    expect(byParty.rows[0]).toMatchObject({ dispatchedBp: 588, dispatchedPct: "5.9", lines: 3 }); // 120 / 2,040 = 5.88 %
    expect(byParty.sum).toMatchObject({ orders: 3, orderedG: strip.orderedG, bakiG: strip.bakiG, lateOrders: strip.lateOrders, lines: strip.lines, dispatchedBp: strip.dispatchedBp });
    expect(byParty.rows.every((r) => r.rates === undefined)).toBe(true);

    const byMonth = await office.analytics.orders({ groupBy: "month" });
    expect(byMonth.today).toBe("2026-10-20"); // the company's day: the page marks this month as still open
    expect(byMonth.truncated).toBe(false);
    expect(byMonth.rows.map((r) => [r.key, r.orders, r.orderedG, r.lateOrders])).toEqual([
      ["2026-10", 2, kg(1_920), 0],
      ["2026-09", 1, kg(240), 1],
    ]);

    // The book's filters narrow the summary and its total together.
    // Another plant sees none of these orders.
    const q = await opPlant();
    const none = await q.as("office").analytics.orders({ groupBy: "customer" });
    expect(none.rows).toEqual([]);
    expect(none.totals.orders).toBe(0);

    const lateOnly = await office.analytics.orders({ groupBy: "customer", late: true });
    expect(lateOnly.rows.map((r) => [r.key, r.orders])).toEqual([[p.customerId, 1]]);
    expect(lateOnly.totals).toEqual(await p.owner.orders.bookTotals({ late: true }));
    const partyB = await office.analytics.orders({ groupBy: "month", customerId: p.otherCustomer });
    expect(partyB.rows.map((r) => r.key)).toEqual(["2026-10"]);
    expect(partyB.totals.orderedG).toBe(kg(120));
    void a;
    void b;
    void c;
  }, SLOW);

  test("rates: only order.price holders with priceOnSalesOrder on; everyone else is refused and sees no rupee field", async () => {
    const { p, a } = await book({ priceOnSalesOrder: true });
    // Rs 250.00 / kg on A's first line; A's second line has no rate.
    await env.db.update(salesOrderLine).set({ ratePaise: 25_000 }).where(eq(salesOrderLine.id, a.lineIds[0]!));

    const priced = await p.as("office").analytics.orders({ groupBy: "customer", withRates: true });
    expect(priced.ratesAllowed).toBe(true);
    const partyA = priced.rows.find((r) => r.key === p.customerId)!;
    // 1,200 kg x Rs 250 = Rs 3,00,000; 120 kg sent = Rs 30,000; baki 1,080 kg = Rs 2,70,000.
    expect(partyA.rates).toEqual({ orderedValuePaise: 30_000_000, dispatchedValuePaise: 3_000_000, bakiValuePaise: 27_000_000, rateMissingLines: 2 });
    expect(priced.rateTotals).toEqual({ orderedValuePaise: 30_000_000, dispatchedValuePaise: 3_000_000, bakiValuePaise: 27_000_000, rateMissingLines: 3 });

    for (const role of ROLES) {
      const pricer = ["owner", "office", "manager", "accountant"].includes(role);
      if (READERS.includes(role)) {
        const plain = await p.as(role).analytics.orders({ groupBy: "customer" });
        // Without withRates nobody gets a rupee figure, not even a pricer.
        expect(JSON.stringify(plain)).not.toMatch(/Paise|rates"|rateMissing/);
        expect(plain.ratesAllowed).toBe(pricer);
      }
      const ask = p.as(role).analytics.orders({ groupBy: "customer", withRates: true });
      if (pricer) expect((await ask).rateTotals?.orderedValuePaise).toBe(30_000_000);
      else await expect(ask).rejects.toMatchObject({ code: "FORBIDDEN" });
    }

    // A plant with prices off on orders refuses even the office.
    const off = await book();
    await expect(off.p.as("office").analytics.orders({ groupBy: "customer", withRates: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await off.p.as("office").analytics.orders({ groupBy: "customer" })).ratesAllowed).toBe(false);
  }, SLOW);
});

describe("analytics.orders: open by default, the strip's figures", () => {
  test("open orders only match the book's strip; cancelled and closed-short orders only with their own filter; dispatched is capped", async () => {
    const { p, s1 } = await book();
    const owner = p.owner;
    // D: cancelled (nothing made). E: 120 kg ordered, 200 kg packed and sent (80 kg over). F: 120 kg, 60 kg sent, closed short.
    const d = await p.confirmedOrder([{ sectionId: s1, pcs: 10 }]);
    await owner.orders.cancel({ id: d.id, reason: "Entered twice" });
    const e = await p.confirmedOrder([{ sectionId: s1, pcs: 10 }]);
    const eDispatch = await p.held(await p.pack(s1, [{ kg: 200 }], e.lineIds[0]));
    await owner.dispatch.complete({ id: eDispatch }).catch(async () => {
      const [req] = await owner.approval.list({ status: "pending" }).then((r) => r.items.filter((i) => i.kind === "dispatch_overdraw"));
      await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
      await owner.dispatch.complete({ id: eDispatch });
    });
    const f = await p.confirmedOrder([{ sectionId: s1, pcs: 10 }]);
    await owner.dispatch.complete({ id: await p.held(await p.pack(s1, [{ kg: 60 }], f.lineIds[0])) });
    await owner.orders.close({ id: f.id, reason: "Customer took the rest from stock" });

    const office = p.as("office");
    for (const filters of [{ openOnly: true }, {}, { status: "closed" as const }, { status: "cancelled" as const }, { openOnly: true, late: true }]) {
      const strip = await owner.orders.bookTotals(filters);
      for (const groupBy of ["customer", "month"] as const) {
        const res = await office.analytics.orders({ groupBy, ...filters });
        expect(res.totals).toEqual(strip);
        // The foot is the strip: orders, ordered, dispatched (capped), baki, late, and the share.
        expect(res.sum).toMatchObject({
          orders: strip.orders,
          lateOrders: strip.lateOrders,
          orderedG: strip.orderedG,
          dispatchedG: strip.dispatchedG,
          bakiG: strip.bakiG,
          dispatchedBp: strip.dispatchedBp,
        });
        // ordered - dispatched = baki in every row and in the foot (nothing is over-counted).
        for (const r of [...res.rows, res.sum]) expect(r.orderedG - r.dispatchedG).toBe(r.bakiG);
      }
    }

    const open = await office.analytics.orders({ groupBy: "customer", openOnly: true });
    const all = await office.analytics.orders({ groupBy: "customer" });
    const closedOnly = await office.analytics.orders({ groupBy: "customer", status: "closed" });
    const cancelledOnly = await office.analytics.orders({ groupBy: "customer", status: "cancelled" });
    // Cancelled and closed orders are in "all" but not in "open": their kg and their baki do not leak into the open foot.
    expect(cancelledOnly.sum).toMatchObject({ orders: 1, orderedG: kg(120), bakiG: kg(120) });
    expect(closedOnly.sum.bakiG).toBeGreaterThanOrEqual(kg(60));
    expect(all.sum.orders).toBe(open.sum.orders + closedOnly.sum.orders + cancelledOnly.sum.orders);
    expect(all.sum.bakiG).toBe(open.sum.bakiG + closedOnly.sum.bakiG + cancelledOnly.sum.bakiG);
    expect(all.sum.bakiG).toBeGreaterThan(open.sum.bakiG);

    // Over-dispatch: E sent 200 of 120 kg. The rows count 120 (capped, as the bar), 80 is excess.
    const list = await owner.orders.list({ limit: 100 });
    const partyRow = all.rows.find((r) => r.key === p.customerId)!;
    const mine = list.items.filter((i) => i.customerId === p.customerId);
    expect(partyRow.dispatchedG).toBe(mine.reduce((s, i) => s + i.bar.dispatchedG, 0));
    expect(partyRow.excessG).toBeGreaterThanOrEqual(kg(80));
    expect(mine.reduce((s, i) => s + i.dispatchedG, 0)).toBe(partyRow.dispatchedG + partyRow.excessG);
  }, SLOW);
});
