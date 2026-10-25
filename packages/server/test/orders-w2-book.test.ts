/**
 * W2-OPPK-W (FP-OP-20, FP-OP-18, FP-OP-01, FP-OP-05): the order book at a glance. The header strip
 * (`orders.bookTotals`, and `totals` of `orders.list`) is the sum of the grid by construction, the
 * bar segments add up to the ordered kg with "over" as its own chip, the filters narrow both
 * together, and an order is late by its expected date, else by its order date (Q7 A).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { bundle, customer } from "@orrn/db/schema";
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
      heldG: 0,
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
      heldG: 0,
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
      expect(bar.dispatchedG + bar.inStockG + bar.heldG + bar.pressedG + bar.plannedG + bar.restG).toBe(i.orderedG);
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
      heldG: sum((i) => i.bar.heldG),
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

describe("review r1 I-5: in stock is available only, in kg and in count; held is its own segment", () => {
  test("a bundle on a dispatch and a bundle held in the yard for the line are Held, not In stock; header = sum of grid", async () => {
    setClock(NOON);
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const sibling = await p.confirmedOrder([{ sectionId: s, kgG: kg(5_000) }]);
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 100 }]); // 1,200 kg
    const mine = await p.pack(s, [{ kg: 120 }, { kg: 120 }, { kg: 120 }], o.lineIds[0]);
    await p.held([mine[0]!]); // reserved on a dispatch: on its way, not free stock
    const [yard] = await p.pack(s, [{ kg: 100 }], sibling.lineIds[0]);
    const ids = await env.db.select({ id: bundle.id }).from(bundle).where(eq(bundle.serial, yard!));
    await p.owner.orders.reallocate({ bundleIds: [ids[0]!.id], toLineId: null, reason: "Order short closed" }); // plant stock
    await p.owner.orders.hold({ lineId: o.lineIds[0]!, bundleIds: [ids[0]!.id] }); // held for this line, in the yard

    const list = await p.owner.orders.list({});
    const row = list.items.find((i) => i.id === o.id)!;
    expect(row.bar).toMatchObject({ inStockG: kg(240), heldG: kg(220), dispatchedG: 0 });
    expect(row.inStockBundles).toBe(2);
    expect(row.heldBundles).toBe(2);
    expect(row.bar.dispatchedG + row.bar.inStockG + row.bar.heldG + row.bar.pressedG + row.bar.plannedG + row.bar.restG).toBe(row.orderedG);
    // The order detail says the same "in stock".
    const got = await p.owner.orders.get({ id: o.id });
    expect(got.lineDetails[0]!.strip).toMatchObject({ inStockG: kg(240), inStockBundles: 2 });
    // The yard bundle left the sibling's line for plant stock: none of its kg counts there.
    const sib = list.items.find((i) => i.id === sibling.id)!;
    expect(sib.bar.inStockG).toBe(0);
    expect(sib.inStockBundles).toBe(0);

    const sum = (f: (i: (typeof list.items)[number]) => number) => list.items.reduce((acc, i) => acc + f(i), 0);
    const totals = await p.owner.orders.bookTotals({});
    expect(totals).toMatchObject({
      inStockG: sum((i) => i.bar.inStockG),
      heldG: sum((i) => i.bar.heldG),
      inStockBundles: sum((i) => i.inStockBundles),
      heldBundles: sum((i) => i.heldBundles),
    });
    // Stage filter "held" narrows grid and strip together.
    const heldOnly = await p.owner.orders.list({ stage: "held" });
    expect(heldOnly.items.map((i) => i.id)).toEqual([o.id]);
    expect(heldOnly.totals.heldG).toBe(kg(220));
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
    expect(before.packingList).toEqual({ kgPerPiece: false, scope: "one_customer" });
    await p.owner.company.updateSettings({ orderLeadDays: 7, packingList: { kgPerPiece: true } });
    const after = await p.owner.company.getSettings();
    expect(after.orderLeadDays).toBe(7);
    expect(after.packingList).toEqual({ kgPerPiece: true, scope: "one_customer" });
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

describe("review r1 I-1: totals and shares come from the server", () => {
  test("orders.quoteMany: each row's quote, per-block and order totals, and each row's share in basis points", async () => {
    const p = await opPlant();
    const s1 = await p.section();
    const s2 = await p.section();
    await p.copy(s1, { milli: 12_000 });
    await p.copy(s2, { milli: 12_300 });
    const FT18 = 5_486;
    const res = await p.as("office").orders.quoteMany({
      rows: [
        { key: "a1", block: "A", sectionId: s1, cutLengthMm: FT18, qtyBasis: "pcs", pcs: 30 },
        { key: "a2", block: "A", sectionId: s1, cutLengthMm: FT12, qtyBasis: "kg", kgG: kg(330) },
        { key: "b1", block: "B", sectionId: s2, cutLengthMm: FT18, qtyBasis: "pcs", pcs: 30 },
        { key: "bad", block: "B", sectionId: "no-such-die", cutLengthMm: FT12, qtyBasis: "pcs", pcs: 10 },
      ],
    });
    const by = new Map(res.rows.map((r) => [r.key, r]));
    expect(by.get("a1")!.quote).toMatchObject({ pcs: 30, kgG: 540_000 });
    expect(by.get("b1")!.quote).toMatchObject({ pcs: 30, kgG: 553_500 });
    expect(by.get("bad")!.quote).toBeNull();
    expect(by.get("bad")!.error).toBeTruthy();
    const a2 = by.get("a2")!.quote!;
    const blockA = res.blocks.find((b) => b.block === "A")!;
    const blockB = res.blocks.find((b) => b.block === "B")!;
    expect(blockA).toMatchObject({ lines: 2, pcs: 30 + a2.pcs, kgG: 540_000 + a2.kgG });
    expect(blockB).toMatchObject({ lines: 1, pcs: 30, kgG: 553_500 });
    expect(res.order).toMatchObject({ lines: 3, pcs: blockA.pcs + blockB.pcs, kgG: blockA.kgG + blockB.kgG, failed: 1 });
    const half = (n: number, d: number) => Math.floor((n * 10_000 * 2 + d) / (d * 2));
    expect(by.get("a1")!.shareBp).toBe(half(540_000, res.order.kgG));
    expect(by.get("b1")!.shareBp).toBe(half(553_500, res.order.kgG));
    expect(by.get("bad")!.shareBp).toBeNull();
    // Too many rows is refused; an empty form has nothing to total.
    const empty = await p.owner.orders.quoteMany({ rows: [] });
    expect(empty.order).toMatchObject({ lines: 0, pcs: 0, kgG: 0 });
  }, SLOW);

  test("orders.get: per-die totals, and a line filter's shown lines and totals (FP-OP-05)", async () => {
    const p = await opPlant();
    const s1 = await p.section();
    const s2 = await p.section();
    await p.copy(s1, { milli: 12_000 });
    await p.copy(s2, { milli: 12_000 });
    const FT18 = 5_486;
    const o = await p.confirmedOrder([
      { sectionId: s1, pcs: 100 }, // 12 ft
      { sectionId: s1, pcs: 30, mm: FT18 },
      { sectionId: s2, pcs: 50 },
    ]);
    await p.pack(s1, [{ kg: 120 }], o.lineIds[0]);
    const all = await p.owner.orders.get({ id: o.id });
    const l = all.lines;
    const d1 = all.dieTotals.find((d) => d.dieId === s1)!;
    expect(d1).toMatchObject({ lines: 2, orderedG: l[0]!.orderedG + l[1]!.orderedG, orderedPcs: 130, pcsMissing: 0 });
    expect(all.dieTotals.find((d) => d.dieId === s2)).toMatchObject({ lines: 1, orderedPcs: 50 });
    expect(all.shown).toMatchObject({ lineIds: o.lineIds, lines: 3, orderedPcs: 180, pcsMissing: 0 });

    const byDie = await p.owner.orders.get({ id: o.id, lineFilter: { dieId: s1 } });
    expect(byDie.shown).toMatchObject({ lineIds: [o.lineIds[0], o.lineIds[1]], lines: 2, orderedG: d1.orderedG, orderedPcs: 130, pcsMissing: 0 });
    const byLen = await p.owner.orders.get({ id: o.id, lineFilter: { cutLengthMm: FT18 } });
    expect(byLen.shown!.lineIds).toEqual([o.lineIds[1]!]);
    const inStock = await p.owner.orders.get({ id: o.id, lineFilter: { stage: "in_stock" } });
    expect(inStock.shown).toMatchObject({ lineIds: [o.lineIds[0]], orderedPcs: 100 });
    const unplanned = await p.owner.orders.get({ id: o.id, lineFilter: { stage: "unplanned", hasBaki: true } });
    expect(unplanned.shown!.lineIds).toEqual(o.lineIds);
  }, SLOW);
});
