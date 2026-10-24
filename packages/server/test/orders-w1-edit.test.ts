/**
 * W1-OP-W review round 1 (server side): what the order screens need to edit a booked line honestly
 * (`orders.quote` with `lineId` quotes on the line's locked basis, as `orders.update` saves it) and
 * the late chip from the order itself (`lateDays` on `orders.get` / `orders.list`, m-1).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { FT12, opHelpers } from "./orders-w1-fixture";
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
const NOON = new Date("2026-10-20T06:30:00.000Z");

describe("orders.quote with lineId: the line's locked basis", () => {
  test("a new reading does not change the quote of a booked line; the save matches the quote", async () => {
    const p = await opPlant();
    const s = await p.section();
    const c = await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]); // 120 kg at 12.000
    await p.reading(c, 12_300, new Date());

    const fresh = await p.owner.orders.quote({ sectionId: s, cutLengthMm: FT12, qtyBasis: "pcs", pcs: 11, weightBasis: "copy_current" });
    expect(fresh).toMatchObject({ basisMilli: 12_300, kgG: kg(135.3), locked: false });

    const locked = await p.owner.orders.quote({
      lineId: o.lineIds[0]!,
      sectionId: s,
      cutLengthMm: FT12,
      qtyBasis: "pcs",
      pcs: 11,
      weightBasis: "copy_current",
    });
    expect(locked).toMatchObject({ basisMilli: 12_000, kgG: kg(132), pcs: 11, locked: true });

    // Asking for another basis on the line is a re-base: the fresh figures, not locked.
    const rebased = await p.owner.orders.quote({ lineId: o.lineIds[0]!, sectionId: s, cutLengthMm: FT12, qtyBasis: "pcs", pcs: 11, weightBasis: "band_start" });
    expect(rebased).toMatchObject({ basisMilli: 11_800, locked: false });

    const got = await p.owner.orders.get({ id: o.id });
    await p.owner.orders.update({
      id: o.id,
      serverSeq: got.order.serverSeq,
      lines: [{ id: o.lineIds[0]!, sectionId: s, cutLengthMm: FT12, qtyBasis: "pcs", pcs: 11, weightBasis: "copy_current" }],
    });
    const after = await p.owner.orders.get({ id: o.id });
    expect(after.lines[0]).toMatchObject({ orderedPcs: 11, orderedG: locked.kgG });

    // A line of another company (or none) is just not found.
    await expect(
      p.owner.orders.quote({ lineId: "nope", sectionId: s, cutLengthMm: FT12, qtyBasis: "pcs", pcs: 1, weightBasis: "copy_current" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, SLOW);
});

describe("m-1: lateDays on orders.get and orders.list", () => {
  test("confirmed with baki and older than 15 days carries its days; 15 days or a booking carries null", async () => {
    setClock(NOON); // 2026-10-20 IST
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const old = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    await saveOrder(p.owner, { id: old.id, orderDate: "2026-10-04" }); // 16 days
    const edge = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    await saveOrder(p.owner, { id: edge.id, orderDate: "2026-10-05" }); // 15 days
    const booking = await p.owner.orders.create({ customerId: p.customerId, orderDate: "2026-09-01", lines: [{ sectionId: s, cutLengthMm: FT12, kgG: kg(5) }] });

    expect((await p.owner.orders.get({ id: old.id })).lateDays).toBe(16);
    expect((await p.owner.orders.get({ id: edge.id })).lateDays).toBeNull();
    expect((await p.owner.orders.get({ id: booking.id })).lateDays).toBeNull();
    const list = await p.owner.orders.list({});
    const by = new Map(list.items.map((i) => [i.id, i.lateDays]));
    expect(by.get(old.id)).toBe(16);
    expect(by.get(edge.id)).toBeNull();
    expect(by.get(booking.id)).toBeNull();
  }, SLOW);
});
