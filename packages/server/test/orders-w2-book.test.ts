/**
 * W2-OPPK-W (FP-OP-20, FP-OP-18, FP-OP-01, FP-OP-05): the order book at a glance. The header strip
 * (`orders.bookTotals`, and `totals` of `orders.list`) is the sum of the grid by construction, the
 * bar segments add up to the ordered kg with "over" as its own chip, the filters narrow both
 * together, and an order is late by its expected date, else by its order date (Q7 A).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { customer } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { FT12, opHelpers } from "./orders-w1-fixture";
import { kg, saveOrder, SLOW } from "./sales-fixture";
import { daysBetween, lateOf } from "../src/lib/orderStrip";

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
const NOON = new Date("2026-10-20T06:30:00.000Z"); // 2026-10-20 IST

type Plant = Awaited<ReturnType<typeof opPlant>>;

/** A small book: A (stock, one bundle sent, a draft plan), B (stock past ordered), C (booking). */
async function book() {
  setClock(NOON);
  const p = await opPlant();
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
  const plan = await p.as("office").plans.create({
    windowStart: NOON.getTime(),
    windowEnd: NOON.getTime() + 12 * HOUR,
    dies: [{ sectionId: s2, lines: [{ salesOrderLineId: a.lineIds[1]!, pcs: 20 }] }], // 240 kg
  });
  const b = await p.confirmedOrder([{ sectionId: s1, pcs: 10 }], { customerId: p.otherCustomer }); // 120 kg
  await p.pack(s1, [{ kg: 200 }], b.lineIds[0]); // 80 kg more than ordered
  const c = await p.owner.orders.create({ customerId: p.customerId, lines: [{ sectionId: s1, cutLengthMm: FT12, kgG: kg(50) }] });
  return { p, s1, s2, a, b, c, plan };
}

const stripOf = async (p: Plant, orderId: string) => (await p.owner.orders.balance({ orderId })).lines.map((l) => l.strip);

describe("FP-OP-20: bar segments and the strip", () => {
  test("the header strip is the sum of the grid; each bar adds up to the ordered kg", async () => {
    const { p, a, b, c } = await book();
    const list = await p.owner.orders.list({});
    const by = new Map(list.items.map((i) => [i.id, i]));

    // A: line 1 O 1,200 / D 120 / in stock 240; line 2 O 600 / planned 240. 1,800 ordered in all.
    expect(by.get(a.id)!.bar).toEqual({
      dispatchedG: kg(120),
      inStockG: kg(240),
      pressedG: 0,
      plannedG: kg(240),
      restG: kg(1_200),
      overG: 0,
      dispatchedBp: 667, // 120 / 1,800 = 6.67 %
    });
    expect(by.get(a.id)!.orderedG).toBe(kg(1_800));
    // B: ordered 120 kg, 200 kg in stock: the bar caps at ordered and the 80 kg is the over chip.
    expect(by.get(b.id)!.bar).toEqual({
      dispatchedG: 0,
      inStockG: kg(120),
      pressedG: 0,
      plannedG: 0,
      restG: 0,
      overG: kg(80),
      dispatchedBp: 0,
    });
    // C: a booking with nothing done is all "not planned".
    expect(by.get(c.id)!.bar).toMatchObject({ dispatchedG: 0, inStockG: 0, plannedG: 0, restG: kg(50), overG: 0 });

    for (const i of list.items) {
      const bar = i.bar;
      expect(bar.dispatchedG + bar.inStockG + bar.pressedG + bar.plannedG + bar.restG).toBe(i.orderedG);
    }

    // The strip equals the sum of the grid, from the list and from the dedicated query.
    const sum = (f: (i: (typeof list.items)[number]) => number) => list.items.reduce((s, i) => s + f(i), 0);
    const totals = await p.owner.orders.bookTotals({});
    expect(list.totals).toEqual(totals);
    expect(totals).toMatchObject({
      orders: 3,
      openOrders: 3,
      orderedG: sum((i) => i.orderedG),
      dispatchedG: sum((i) => i.bar.dispatchedG),
      inStockG: sum((i) => i.bar.inStockG),
      pressedG: sum((i) => i.bar.pressedG),
      plannedG: sum((i) => i.bar.plannedG),
      restG: sum((i) => i.bar.restG),
      overG: sum((i) => i.bar.overG),
      bakiG: sum((i) => i.bakiG),
    });
    expect(totals.dispatchedBp).toBe(Math.round((totals.dispatchedG * 10_000) / totals.orderedG));
    expect(totals.inStockBundles).toBe(sum((i) => i.inStockBundles));
    // And the bar's own figures are the balance strip's, line by line.
    const strips = await stripOf(p, a.id);
    expect(strips.map((s) => [s.dispatchedG, s.inStockG, s.plannedG])).toEqual([
      [kg(120), kg(240), 0],
      [0, 0, kg(240)],
    ]);
  }, SLOW);

  test("the strip counts the bundles and pieces in stock (FP-OP-05)", async () => {
    const { p, a } = await book();
    const got = await p.owner.orders.get({ id: a.id });
    expect(got.lineDetails[0]!.strip).toMatchObject({ inStockG: kg(240), inStockBundles: 2, inStockPcs: 20 });
    expect(got.lineDetails[1]!.strip).toMatchObject({ inStockBundles: 0, inStockPcs: 0 });
  }, SLOW);

  test("filters narrow the grid and the strip together: party, city, status, date, stage", async () => {
    const { p, a, b, c } = await book();
    // City is the party's billing address city; the fixture's first customer is in Surat.
    await env.db.update(customer).set({ billingAddress: { city: "Ahmedabad" } }).where(eq(customer.id, p.otherCustomer));
    await saveOrder(p.owner, { id: a.id, orderDate: "2026-10-10" });

    const ids = async (f: Parameters<typeof p.owner.orders.list>[0]) => {
      const r = await p.owner.orders.list(f);
      expect(r.totals.orders).toBe(r.total);
      expect(r.totals.orderedG).toBe(r.items.reduce((s, i) => s + i.orderedG, 0));
      expect(r.totals.inStockG).toBe(r.items.reduce((s, i) => s + i.bar.inStockG, 0));
      return r.items.map((i) => i.id).sort();
    };
    const sorted = (...xs: { id: string }[]) => xs.map((x) => x.id).sort();

    expect(await ids({ customerId: p.otherCustomer })).toEqual(sorted(b));
    expect(await ids({ city: "ahmedabad" })).toEqual(sorted(b)); // case-insensitive
    expect(await ids({ city: "Surat" })).toEqual(sorted(a, c));
    expect(await ids({ status: "booking" })).toEqual(sorted(c));
    expect(await ids({ status: "confirmed" })).toEqual(sorted(b)); // A went to dispatching with its first dispatch
    expect(await ids({ status: "dispatching" })).toEqual(sorted(a));
    expect(await ids({ openOnly: true })).toEqual(sorted(a, b, c));
    expect(await ids({ dateFrom: "2026-10-15" })).toEqual(sorted(b, c));
    expect(await ids({ dateTo: "2026-10-15" })).toEqual(sorted(a));
    expect(await ids({ dateFrom: "2026-10-10", dateTo: "2026-10-10" })).toEqual(sorted(a));
    expect(await ids({ search: "SO-" })).toEqual(sorted(a, b, c));
    // Stage: orders with kg in that part of the bar.
    expect(await ids({ stage: "dispatched" })).toEqual(sorted(a));
    expect(await ids({ stage: "planned" })).toEqual(sorted(a));
    expect(await ids({ stage: "in_stock" })).toEqual(sorted(a, b));
    expect(await ids({ stage: "over" })).toEqual(sorted(b));
    expect(await ids({ stage: "unplanned" })).toEqual(sorted(a, c));
    // The strip moves with the filter.
    const onlyB = await p.owner.orders.bookTotals({ customerId: p.otherCustomer });
    expect(onlyB).toMatchObject({ orders: 1, orderedG: kg(120), inStockG: kg(120), overG: kg(80) });
    const empty = await p.owner.orders.bookTotals({ city: "Nowhere" });
    expect(empty).toMatchObject({ orders: 0, orderedG: 0, dispatchedBp: 0 });
    expect(await p.owner.orders.bookCities()).toEqual(["Ahmedabad", "Surat"]);
  }, SLOW);

  test("pages: the strip covers every order, the page only its slice", async () => {
    const { p } = await book();
    const first = await p.owner.orders.list({ limit: 2, offset: 0 });
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(first.nextOffset).toBe(2);
    expect(first.totals.orders).toBe(3);
    const second = await p.owner.orders.list({ limit: 2, offset: 2 });
    expect(second.items).toHaveLength(1);
    expect(second.nextOffset).toBeNull();
    expect(second.totals).toEqual(first.totals);
  }, SLOW);

  test("reading is open to every member; nothing here writes", async () => {
    const { p } = await book();
    for (const role of ["viewer", "packer", "office"] as const) {
      const api = p.as(role);
      await expect(api.orders.bookTotals({})).resolves.toMatchObject({ orders: 3 });
      await expect(api.orders.bookCities()).resolves.toBeTruthy();
    }
    await expect(env.caller(null).orders.bookTotals({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  }, SLOW);
});

describe("FP-OP-18 + Q7: the late rule", () => {
  test("lateOf: the expected date wins; with none, an order date over 15 days old", () => {
    const base = { status: "confirmed", orderDate: "2026-10-01", bakiG: kg(10) } as const;
    const today = "2026-10-20";
    // Expected date passed -> late by that date.
    expect(lateOf({ ...base, expectedDate: "2026-10-18" }, today)).toEqual({ days: 2, rule: "expected_date" });
    // The expected date is today or later -> not late, even though the order is 19 days old.
    expect(lateOf({ ...base, expectedDate: "2026-10-20" }, today)).toBeNull();
    expect(lateOf({ ...base, expectedDate: "2026-11-01" }, today)).toBeNull();
    // No expected date: the 15 day order-date rule.
    expect(lateOf({ ...base, expectedDate: null }, today)).toEqual({ days: 19, rule: "order_date" });
    expect(lateOf({ ...base, orderDate: "2026-10-05", expectedDate: null }, today)).toBeNull(); // exactly 15 days
    expect(lateOf({ ...base, orderDate: "2026-10-04", expectedDate: null }, today)).toEqual({ days: 16, rule: "order_date" });
    // No baki, a booking, a closed order: never late.
    expect(lateOf({ ...base, expectedDate: "2026-10-01", bakiG: 0 }, today)).toBeNull();
    expect(lateOf({ ...base, status: "booking", expectedDate: "2026-10-01" }, today)).toBeNull();
    expect(lateOf({ ...base, status: "closed", expectedDate: "2026-10-01" }, today)).toBeNull();
    expect(daysBetween("2026-10-18", today)).toBe(2);
  });

  test("orders.create / update keep the expected date; get, list and late use it; the SQL flag agrees with lateOf", async () => {
    setClock(NOON);
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const make = async (orderDate: string, expectedDate?: string | null) => {
      const res = await p.owner.orders.create({
        customerId: p.customerId,
        poNumber: `PO-${orderDate}-${expectedDate ?? "none"}`,
        orderDate,
        ...(expectedDate !== undefined ? { expectedDate } : {}),
        lines: [{ sectionId: s, cutLengthMm: FT12, qtyBasis: "pcs", pcs: 10, tierRank: 1 }],
      });
      await p.owner.orders.confirm({ id: res.id });
      return res.id;
    };
    const dueSoon = await make("2026-09-01", "2026-10-30"); // old order, not due yet: not late
    const pastDue = await make("2026-10-15", "2026-10-18"); // recent order, expected date passed: late by 2 days
    const noDate = await make("2026-10-01"); // no expected date, 19 days old: late by the order date
    const fresh = await make("2026-10-18", null); // cleared on purpose, 2 days old: not late

    const got = await p.owner.orders.get({ id: pastDue });
    expect(got.order.expectedDate).toBe("2026-10-18");
    expect(got.lateDays).toBe(2);
    expect((await p.owner.orders.get({ id: dueSoon })).lateDays).toBeNull();
    expect((await p.owner.orders.get({ id: noDate })).order.expectedDate).toBeNull();
    expect((await p.owner.orders.get({ id: noDate })).lateDays).toBe(19);

    const list = await p.owner.orders.list({});
    const rule = new Map(list.items.map((i) => [i.id, [i.lateDays, i.lateRule]]));
    expect(rule.get(pastDue)).toEqual([2, "expected_date"]);
    expect(rule.get(noDate)).toEqual([19, "order_date"]);
    expect(rule.get(dueSoon)).toEqual([null, null]);
    expect(rule.get(fresh)).toEqual([null, null]);

    // The filter and the SQL flag are the same rule.
    const lateOnly = await p.owner.orders.list({ late: true });
    expect(lateOnly.items.map((i) => i.id).sort()).toEqual([pastDue, noDate].sort());
    expect(lateOnly.totals.lateOrders).toBe(2);
    expect(list.totals.lateOrders).toBe(2);
    expect(lateOnly.items.every((i) => i.lateDays != null)).toBe(true);

    // orders.late lists lines by the same rule and says which date fired.
    const late = await p.owner.orders.late({});
    expect(late.lines.map((l) => [l.orderId, l.lateDays, l.lateRule]).sort()).toEqual(
      [
        [pastDue, 2, "expected_date"],
        [noDate, 19, "order_date"],
      ].sort(),
    );

    // Editing: omitted keeps it, null clears it, a date sets it.
    const s0 = (await p.owner.orders.get({ id: pastDue })).order.serverSeq;
    await p.owner.orders.update({ id: pastDue, serverSeq: s0, note: "x" });
    expect((await p.owner.orders.get({ id: pastDue })).order.expectedDate).toBe("2026-10-18");
    const s1 = (await p.owner.orders.get({ id: pastDue })).order.serverSeq;
    await p.owner.orders.update({ id: pastDue, serverSeq: s1, expectedDate: "2026-10-25" });
    expect((await p.owner.orders.get({ id: pastDue })).lateDays).toBeNull();
    const s2 = (await p.owner.orders.get({ id: pastDue })).order.serverSeq;
    await p.owner.orders.update({ id: pastDue, serverSeq: s2, expectedDate: null });
    expect((await p.owner.orders.get({ id: pastDue })).order.expectedDate).toBeNull();
    // Not a date -> refused.
    await expect(p.owner.orders.update({ id: pastDue, serverSeq: 0, expectedDate: "tomorrow" })).rejects.toBeTruthy();
  }, SLOW);

  test("the lead time and the packing list switch are company settings (Q8, FP-PK-13)", async () => {
    const p = await opPlant();
    const before = await p.owner.company.getSettings();
    expect(before.orderLeadDays).toBe(15);
    expect(before.packingList).toEqual({ kgPerPiece: false });
    await p.owner.company.updateSettings({ orderLeadDays: 7, packingList: { kgPerPiece: true } });
    const after = await p.owner.company.getSettings();
    expect(after.orderLeadDays).toBe(7);
    expect(after.packingList).toEqual({ kgPerPiece: true });
    await expect(p.as("office").company.updateSettings({ packingList: { kgPerPiece: false } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.owner.company.updateSettings({ orderLeadDays: 400 })).rejects.toBeTruthy();
  }, SLOW);
});

describe("FP-OP-19: stock held on this order", () => {
  test("in-yard bundles by line from bundle.sales_order_line_id, with a total; sent and void bundles are not stock", async () => {
    const { p, a, b } = await book();
    const res = await p.owner.orders.stockOn({ id: a.id });
    expect(res.order).toMatchObject({ id: a.id, number: a.number, status: "dispatching" });
    expect(res.lines.map((l) => [l.lineNo, l.bundles.length, l.pcs, l.weightG])).toEqual([
      [1, 2, 20, kg(240)], // 3 packed, 1 dispatched
      [2, 0, 0, 0],
    ]);
    const first = res.lines[0]!.bundles[0]!;
    expect(first).toMatchObject({ status: "available", pcs: 10, weightG: kg(120), lengthMm: FT12 });
    expect(first.packedAt).toBeGreaterThan(0);
    expect(res.total).toEqual({ bundles: 2, pcs: 20, weightG: kg(240) });
    expect(res.truncated).toBe(false);
    expect(res.strip).toMatchObject({ orderedG: kg(1_800), dispatchedG: kg(120), inStockG: kg(240) });
    // Another order's stock never mixes in; a reserved bundle still lies in the yard.
    expect((await p.owner.orders.stockOn({ id: b.id })).total).toEqual({ bundles: 1, pcs: 10, weightG: kg(200) });
    await p.held([first.serial]);
    expect((await p.owner.orders.stockOn({ id: a.id })).lines[0]!.bundles.map((x) => x.status).sort()).toEqual(["available", "reserved"]);
    // Every member may read it; it carries no rate.
    expect(JSON.stringify(res)).not.toContain("rate");
    await expect(p.as("viewer").orders.stockOn({ id: a.id })).resolves.toBeTruthy();
    await expect(p.owner.orders.stockOn({ id: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, SLOW);
});
