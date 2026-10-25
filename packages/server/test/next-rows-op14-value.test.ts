/**
 * W4-NEXTROWS FP-OP-14 "Price on the line, value on dispatch": `dispatch.getDispatch` returns
 * `value` = Σ round(weightG × ratePaise / 1000) over items whose order line has a rate, with the
 * rest counted in `rateMissing`. Only with `priceOnSalesOrder` on AND `order.price` held; never a
 * per-item rate. Weighed grams, not theoretical kg.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { FT12, opHelpers, type OpPlant } from "./orders-w1-fixture";
import { kg, SLOW } from "./sales-fixture";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { opPlant } = opHelpers(() => env);

async function pricedOrder(p: OpPlant, sectionId: string, copyId: string, rates: (number | null)[]) {
  const res = await p.as("office").orders.create({
    customerId: p.customerId,
    poNumber: `PO-VAL-${crypto.randomUUID().slice(0, 6)}`,
    lines: rates.map((ratePaise) => ({
      sectionId,
      cutLengthMm: FT12,
      qtyBasis: "kg" as const,
      kgG: kg(1_000),
      dieInstanceId: copyId,
      ...(ratePaise === null ? {} : { ratePaise }),
    })),
  });
  await p.owner.orders.confirm({ id: res.id });
  const got = await p.owner.orders.get({ id: res.id });
  return { id: res.id, lineIds: got.lines.map((l) => l.lineId) };
}

describe("FP-OP-14 value on dispatch", () => {
  test("Σ round(weightG × ratePaise / 1000) over rated lines; an unrated line is rateMissing, not zero", async () => {
    const p = await opPlant({ settings: { priceOnSalesOrder: true } });
    const s = await p.section();
    const c = await p.copy(s, { milli: 12_000 });
    const o = await pricedOrder(p, s, c, [42_500, null]);
    // Line 1 at ₹425/kg: 120.5 kg + 100.001 kg; line 2 has no rate: 80 kg.
    const rated = await p.pack(s, [{ kg: 120.5 }, { kg: 100.001 }], o.lineIds[0]);
    const unrated = await p.pack(s, [{ kg: 80 }], o.lineIds[1]);
    const { id } = await p.owner.dispatch.create({ salesOrderId: o.id });
    await p.owner.dispatch.addBundlesBySerial({ id, serials: [...rated, ...unrated] });

    const got = await p.as("office").dispatch.getDispatch({ id });
    // 120_500 g × 42_500 / 1000 = 5_121_250; 100_001 g × 42_500 / 1000 = 4_250_042.5 → 4_250_043
    expect(got.value).toEqual({
      valuePaise: 5_121_250 + 4_250_043,
      pricedItems: 2,
      pricedG: kg(220.501),
      rateMissing: 1,
      missingG: kg(80),
      complete: false,
    });
    // No rate leaks on items.
    for (const it of got.items) {
      expect(it).not.toHaveProperty("lineRatePaise");
      expect(it).not.toHaveProperty("ratePaise");
    }
    // Accountant reads it too (order.price); floor and viewer roles get null.
    expect((await p.as("accountant").dispatch.getDispatch({ id })).value?.valuePaise).toBe(9_371_293);
    expect((await p.as("packer").dispatch.getDispatch({ id })).value).toBeNull();
    expect((await p.as("viewer").dispatch.getDispatch({ id })).value).toBeNull();
  }, SLOW);

  test("with priceOnSalesOrder off there is no value at all, even for the owner", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, kgG: kg(500) }]);
    const serials = await p.pack(s, [{ kg: 100 }], o.lineIds[0]);
    const { id } = await p.owner.dispatch.create({ salesOrderId: o.id });
    await p.owner.dispatch.addBundlesBySerial({ id, serials });
    expect((await p.owner.dispatch.getDispatch({ id })).value).toBeNull();
  }, SLOW);

  test("every item rated: complete; a bundle on no order line is rateMissing", async () => {
    const p = await opPlant({ settings: { priceOnSalesOrder: true } });
    const s = await p.section();
    const c = await p.copy(s, { milli: 12_000 });
    const o = await pricedOrder(p, s, c, [40_000]);
    const serials = await p.pack(s, [{ kg: 250 }], o.lineIds[0]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ id, serials });
    const got = (await p.owner.dispatch.getDispatch({ id })).value!;
    expect(got).toMatchObject({ valuePaise: 10_000_000, rateMissing: 0, complete: true });

    // A bundle on no order line (another party with no order): counted as missing, value stays 0, never an error.
    const loose = await p.pack(s, [{ kg: 50 }]);
    const other = await p.owner.dispatch.create({ customerId: p.otherCustomer });
    await p.owner.dispatch.addBundlesBySerial({ id: other.id, serials: loose, allowUnassigned: true });
    const after = (await p.owner.dispatch.getDispatch({ id: other.id })).value!;
    expect(after).toMatchObject({ valuePaise: 0, pricedItems: 0, rateMissing: 1, missingG: kg(50), complete: false });
  }, SLOW);
});
