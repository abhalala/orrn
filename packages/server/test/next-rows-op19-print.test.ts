/**
 * W4-NEXTROWS FP-OP-19: the order sheet prints the pinned copy's code from `orders.get` (no lookup
 * per line), a tier line has none, and the rate stays off the answer for anyone without order.price.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { FT12, opHelpers } from "./orders-w1-fixture";
import { kg, SLOW } from "./sales-fixture";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { opPlant } = opHelpers(() => env);

describe("FP-OP-19 order sheet data", () => {
  test("lineDetails carry the pinned copy's code; rates only for order.price", async () => {
    const p = await opPlant({ settings: { priceOnSalesOrder: true } });
    const s = await p.section();
    const c = await p.copy(s, { milli: 12_000 });
    const o = await p.as("office").orders.create({
      customerId: p.customerId,
      poNumber: "PO-PRINT-1",
      lines: [
        { sectionId: s, cutLengthMm: FT12, qtyBasis: "kg", kgG: kg(500), dieInstanceId: c, ratePaise: 42_500 },
        { sectionId: s, cutLengthMm: FT12, qtyBasis: "kg", kgG: kg(300), tierRank: 1 },
      ],
    });
    const got = await p.as("office").orders.get({ id: o.id });
    const code = (await p.owner.dieInstance.get({ id: c })).instance.code;
    expect(got.lineDetails.map((d) => [d.copyCode, d.tierRank])).toEqual([
      [code, null],
      [null, 1],
    ]);
    expect(got.lineDetails[0]).toMatchObject({ ratePaise: 42_500 });
    const floor = await p.as("packer").orders.get({ id: o.id });
    expect(floor.lineDetails[0]!.copyCode).toBe(code);
    expect(floor.lineDetails[0]).not.toHaveProperty("ratePaise");
  }, SLOW);
});
