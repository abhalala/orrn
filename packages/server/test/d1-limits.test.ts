import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { bundle, bundleStatusEvent, customer, die, dispatchItem, packingListLine } from "@orrn/db/schema";
import { and, eq, sql } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function countRows(table: any, where: any) {
  const [row] = await env.db.select({ n: sql<number>`count(*)` }).from(table).where(where);
  return Number(row?.n ?? 0);
}

async function setup(bundleCount: number) {
  const { companyId } = await env.seedCompany();
  const api = env.caller({ role: "owner", companyId });
  const dieId = await env.seedDie(companyId);
  const customerId = await env.seedCustomer(companyId);
  const bundles = await env.seedBundles(companyId, dieId, bundleCount);
  return { companyId, api, dieId, customerId, bundles };
}

describe("D1 100-bound-parameter limit", () => {
  test("createReceipt with 40 bundles succeeds and creates 40 rows", async () => {
    const { companyId, api, dieId } = await setup(0);
    const res = await api.bundle.createReceipt({
      dieId,
      unit: "pcs",
      rows: Array.from({ length: 40 }, () => ({ quantity: 10, weightG: 25_000, lengthMm: 3_000 })),
    });
    expect(res.bundleCount).toBe(40);
    expect(await countRows(bundle, and(eq(bundle.companyId, companyId), eq(bundle.groupId, res.groupId)))).toBe(40);
    expect(await countRows(bundleStatusEvent, eq(bundleStatusEvent.companyId, companyId))).toBe(40);
  });

  test("bulkImport with 120 rows across 100 dies succeeds (twice, reusing legacy groups)", async () => {
    const { companyId, api } = await setup(0);
    const rows = Array.from({ length: 120 }, (_, i) => ({
      dieSeries: "L",
      dieSectionCode: `D${i % 100}`,
      quantity: 10,
      weightG: 25_000,
      lengthMm: 3_000,
    }));
    // First import creates 100 dies + groups; the second reuses them, which
    // runs the legacy-group lookup with 100 die ids.
    await api.bundle.bulkImport({ rows });
    await api.bundle.bulkImport({ rows });
    expect(await countRows(bundle, eq(bundle.companyId, companyId))).toBe(240);
  });

  test("reserve, unreserve, reserve, complete a 120-bundle dispatch", async () => {
    const { companyId, api, customerId, bundles } = await setup(120);
    const { id } = await api.dispatch.create({ customerId });
    for (let i = 0; i < bundles.length; i += 50) {
      await api.dispatch.addBundlesBySerial({
        id,
        serials: bundles.slice(i, i + 50).map((b) => b.serial),
      });
    }
    expect(await countRows(dispatchItem, eq(dispatchItem.dispatchId, id))).toBe(120);

    await api.dispatch.reserve({ id });
    expect(await countRows(bundle, and(eq(bundle.companyId, companyId), eq(bundle.status, "reserved")))).toBe(120);
    await api.dispatch.unreserve({ id });
    expect(await countRows(bundle, and(eq(bundle.companyId, companyId), eq(bundle.status, "available")))).toBe(120);
    await api.dispatch.reserve({ id });
    await api.dispatch.complete({ id });

    expect(await countRows(bundle, and(eq(bundle.companyId, companyId), eq(bundle.status, "dispatched")))).toBe(120);
    // 120 x (receipt-less seed) -> reserve + unreserve + reserve + complete events
    expect(await countRows(bundleStatusEvent, eq(bundleStatusEvent.dispatchId, id))).toBe(120 * 4);
  });

  test("cancel releases a 120-bundle reserved dispatch", async () => {
    const { companyId, api, customerId, bundles } = await setup(120);
    const { id } = await api.dispatch.create({ customerId });
    for (let i = 0; i < bundles.length; i += 50) {
      await api.dispatch.addBundlesBySerial({
        id,
        serials: bundles.slice(i, i + 50).map((b) => b.serial),
      });
    }
    await api.dispatch.reserve({ id });
    await api.dispatch.cancel({ id });
    expect(await countRows(bundle, and(eq(bundle.companyId, companyId), eq(bundle.status, "available")))).toBe(120);
  });

  test("addBundlesBySerial with 100 serials", async () => {
    const { companyId, api, customerId, bundles } = await setup(100);
    const { id } = await api.dispatch.create({ customerId });
    const res = await api.dispatch.addBundlesBySerial({ id, serials: bundles.map((b) => b.serial) });
    expect(res.added).toBe(100);
    expect(await countRows(dispatchItem, and(eq(dispatchItem.companyId, companyId), eq(dispatchItem.dispatchId, id)))).toBe(100);

    // Reserved dispatch: the bundle update + status events must chunk too.
    const more = await env.seedBundles(companyId, await env.seedDie(companyId), 100);
    await api.dispatch.reserve({ id });
    const res2 = await api.dispatch.addBundlesBySerial({ id, serials: more.map((b) => b.serial) });
    expect(res2.added).toBe(100);
    expect(await countRows(bundle, and(eq(bundle.companyId, companyId), eq(bundle.status, "reserved")))).toBe(200);
  });

  test("packing list for 120 bundles has 120 lines", async () => {
    const { api, customerId, bundles } = await setup(120);
    const { id } = await api.dispatch.create({ customerId });
    for (let i = 0; i < bundles.length; i += 50) {
      await api.dispatch.addBundlesBySerial({
        id,
        serials: bundles.slice(i, i + 50).map((b) => b.serial),
      });
    }
    await api.dispatch.reserve({ id });
    await api.dispatch.complete({ id });

    const pl = await api.packingList.byDispatch({ dispatchId: id });
    expect(pl).toBeTruthy();
    expect(await countRows(packingListLine, eq(packingListLine.packingListId, pl!.id))).toBe(120);

    const regenerated = await api.packingList.regenerate({ id: pl!.id });
    expect(await countRows(packingListLine, eq(packingListLine.packingListId, regenerated.id))).toBe(120);
  });

  test("customer.importCsv 250 rows", async () => {
    const { companyId } = await env.seedCompany();
    const api = env.caller({ role: "owner", companyId });
    const res = await api.customer.importCsv(
      Array.from({ length: 250 }, (_, i) => ({ name: `Imported ${i}`, email: `c${i}@example.com`, phone: "123" })),
    );
    expect(res.count).toBe(250);
    expect(await countRows(customer, eq(customer.companyId, companyId))).toBe(250);
  });

  test("die.processImport 250 rows", async () => {
    const { companyId } = await env.seedCompany();
    const api = env.caller({ role: "owner", companyId });
    const res = await api.die.processImport({
      newRows: Array.from({ length: 250 }, (_, i) => ({
        series: "P",
        sectionCode: `S${i}`,
        dimensions: {},
        weightMinG: 1_000,
        weightMaxG: 2_000,
        status: "active" as const,
      })),
      updatedRows: [],
    });
    expect(res.success).toBe(true);
    expect(await countRows(die, eq(die.companyId, companyId))).toBe(250);
  });
});
