/**
 * W4-FIXES-B BACKLOG 52 (explorer M2): the order book header, its rows and the order's line strips
 * tell ONE story. In stock = Σ available bundle kg on the order's lines (the strip's `inStockG`,
 * never capped at the line's baki); over = Σ max(0, produced − ordered) per line (the strip's
 * `overG`, never planned / held kg). The bar still draws segments that add up to ordered
 * (`inStockBarG` is the drawn part of in stock), but every labelled figure is the strip's.
 *
 * The explorer's SO-5 line 3: ordered 250, dispatched 184.546, in stock 105.895 (2 bundles) read
 * "In stock 65.454 kg" (capped at baki) and "229.056 kg over" (pipeline incl. other kg) on the book
 * while the line strip said 105.895 and 40.441.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { bundle } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { opHelpers } from "./orders-w1-fixture";
import { SLOW } from "./sales-fixture";

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
const NOON = new Date("2026-10-20T06:30:00.000Z");
const g = (kgText: string) => Math.round(Number(kgText) * 1000);

describe("BACKLOG 52: book header = Σ rows = Σ line strips", () => {
  test("in stock past the baki and a yard bundle held for the line: the book says what the line strip says", async () => {
    setClock(NOON);
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const sibling = await p.confirmedOrder([{ sectionId: s, kgG: g("5000") }]);
    const o = await p.confirmedOrder([{ sectionId: s, kgG: g("250") }]);
    const lineId = o.lineIds[0]!;
    // Packed on the line: 184.546 kg dispatched, then 2 bundles (105.895 kg) still in stock.
    const sent = await p.pack(s, [{ kg: 100 }, { kg: 84.546 }], lineId);
    await p.owner.dispatch.complete({ id: await p.held(sent) });
    await p.pack(s, [{ kg: 55.5 }, { kg: 50.395 }], lineId);
    // A plant-stock bundle held in the yard for the line (not on it: not produced for it).
    const [yard] = await p.pack(s, [{ kg: 188.615 }], sibling.lineIds[0]);
    const [{ id: yardId }] = (await env.db.select({ id: bundle.id }).from(bundle).where(eq(bundle.serial, yard!))) as [{ id: string }];
    await p.owner.orders.reallocate({ bundleIds: [yardId], toLineId: null, reason: "Order short closed" });
    await p.owner.orders.hold({ lineId, bundleIds: [yardId] });

    const strip = (await p.owner.orders.balance({ orderId: o.id })).lines[0]!.strip;
    expect(strip).toMatchObject({ orderedG: g("250"), dispatchedG: g("184.546"), inStockG: g("105.895"), inStockBundles: 2, overG: g("40.441") });

    const list = await p.owner.orders.list({ customerId: p.customerId });
    const row = list.items.find((i) => i.id === o.id)!;
    // The labelled figures are the strip's (were 65.454 and 229.056).
    expect(row.bar.inStockG).toBe(g("105.895"));
    expect(row.bar.overG).toBe(g("40.441"));
    expect(row.inStockBundles).toBe(2);
    // The drawn bar still adds up to ordered: 184.546 dispatched + 65.454 of the stock.
    expect(row.bar.inStockBarG).toBe(g("65.454"));
    expect(row.bar.dispatchedG + row.bar.inStockBarG + row.bar.heldG + row.bar.pressedG + row.bar.plannedG + row.bar.restG).toBe(row.orderedG);

    // Header = Σ rows = Σ line strips over the same filter.
    const totals = await p.owner.orders.bookTotals({ customerId: p.customerId });
    expect(list.totals).toEqual(totals);
    const strips = (await Promise.all(list.items.map(async (i) => (await p.owner.orders.balance({ orderId: i.id })).lines.map((l) => l.strip)))).flat();
    const sumStrips = (f: (x: (typeof strips)[number]) => number) => strips.reduce((acc, x) => acc + f(x), 0);
    const sumRows = (f: (x: (typeof list.items)[number]) => number) => list.items.reduce((acc, x) => acc + f(x), 0);
    expect(totals.inStockG).toBe(sumRows((i) => i.bar.inStockG));
    expect(totals.inStockG).toBe(sumStrips((x) => x.inStockG));
    expect(totals.overG).toBe(sumRows((i) => i.bar.overG));
    expect(totals.overG).toBe(sumStrips((x) => x.overG));
    expect(totals.inStockBundles).toBe(sumStrips((x) => x.inStockBundles));
    expect(totals.inStockBarG).toBe(sumRows((i) => i.bar.inStockBarG));
    // Stage filters follow the labels: the order has stock and is over.
    expect((await p.owner.orders.list({ stage: "over" })).items.map((i) => i.id)).toContain(o.id);
    expect((await p.owner.orders.list({ stage: "in_stock" })).items.map((i) => i.id)).toContain(o.id);
  }, SLOW);
});
