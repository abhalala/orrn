/**
 * T25 fix round 1: imports that can be sent again safely, and die updates that
 * only change what the sheet filled in.
 *
 * - `bundle.bulkImport`, `customer.importCsv` and `die.processImport` take an
 *   optional `clientRequestId` per chunk. Sending the same chunk again (a reply
 *   lost on plant Wi-Fi, or the same sheet picked again) answers `replayed`
 *   and creates nothing twice.
 * - `die.processImport` updatedRows write only the fields that were sent, so a
 *   weight-band sheet never wipes geometry, name or notes and never re-activates
 *   an archived die.
 * - `bundle.importCheck` tells the sheet which dies in it were deleted, before
 *   anything is saved.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { bundle, customer, die } from "@orrn/db/schema";
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

async function owner() {
  const { companyId } = await env.seedCompany();
  return { companyId, api: env.caller({ role: "owner", companyId }) };
}

const bundleRows = (n: number, series = "L", code = "D1") =>
  Array.from({ length: n }, (_, i) => ({
    dieSeries: series,
    dieSectionCode: code,
    quantity: 10 + i,
    weightG: 25_000,
    lengthMm: 3_658,
    poNumber: `PO-${i}`,
  }));

const REQ = "imp1-0123456789abcdef0123456789abcdef";

describe("bundle.bulkImport with a clientRequestId", () => {
  test("the same chunk sent twice saves its bundles once and says the second call was a replay", async () => {
    const { companyId, api } = await owner();
    const first = await api.bundle.bulkImport({ rows: bundleRows(3), clientRequestId: REQ });
    expect(first).toMatchObject({ bundleCount: 3, newDies: 1, replayed: false });
    const again = await api.bundle.bulkImport({ rows: bundleRows(3), clientRequestId: REQ });
    expect(again).toMatchObject({ bundleCount: 3, newDies: 0, replayed: true });
    expect(await countRows(bundle, eq(bundle.companyId, companyId))).toBe(3);
  });

  test("the same id in another company is a different request", async () => {
    const a = await owner();
    const b = await owner();
    await a.api.bundle.bulkImport({ rows: bundleRows(2), clientRequestId: REQ });
    const res = await b.api.bundle.bulkImport({ rows: bundleRows(2), clientRequestId: REQ });
    expect(res.replayed).toBe(false);
    expect(await countRows(bundle, eq(bundle.companyId, b.companyId))).toBe(2);
  });

  test("an id reused for a chunk of a different size is refused (CONFLICT), nothing saved", async () => {
    const { companyId, api } = await owner();
    await api.bundle.bulkImport({ rows: bundleRows(2), clientRequestId: REQ });
    await expect(api.bundle.bulkImport({ rows: bundleRows(5), clientRequestId: REQ })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await countRows(bundle, eq(bundle.companyId, companyId))).toBe(2);
  });

  test("a replay is still a replay after the die was deleted (the saved chunk is not refused)", async () => {
    const { api } = await owner();
    await api.bundle.bulkImport({ rows: bundleRows(1, "Z", "GONE-1"), clientRequestId: REQ });
    const dieRow = await env.db.query.die.findFirst({ where: eq(die.sectionCode, "GONE-1") });
    await api.die.delete({ id: dieRow!.id });
    const res = await api.bundle.bulkImport({ rows: bundleRows(1, "Z", "GONE-1"), clientRequestId: REQ });
    expect(res.replayed).toBe(true);
  });

  test("without an id every call saves (older callers keep working)", async () => {
    const { companyId, api } = await owner();
    await api.bundle.bulkImport({ rows: bundleRows(2) });
    await api.bundle.bulkImport({ rows: bundleRows(2) });
    expect(await countRows(bundle, eq(bundle.companyId, companyId))).toBe(4);
  });

  test("a malformed id is refused before anything is read", async () => {
    const { api } = await owner();
    await expect(api.bundle.bulkImport({ rows: bundleRows(1), clientRequestId: "short" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      api.bundle.bulkImport({ rows: bundleRows(1), clientRequestId: `${"x".repeat(60)} bad` }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("customer.importCsv with a clientRequestId", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Party ${i}`, phone: "98250 00000" }));

  test("the same chunk sent twice adds the customers once", async () => {
    const { companyId, api } = await owner();
    expect(await api.customer.importCsv({ rows: rows(4), clientRequestId: REQ })).toMatchObject({ count: 4, replayed: false });
    expect(await api.customer.importCsv({ rows: rows(4), clientRequestId: REQ })).toMatchObject({ count: 4, replayed: true });
    expect(await countRows(customer, eq(customer.companyId, companyId))).toBe(4);
  });

  test("the plain array input still works", async () => {
    const { companyId, api } = await owner();
    expect(await api.customer.importCsv(rows(2))).toMatchObject({ count: 2, replayed: false });
    expect(await countRows(customer, eq(customer.companyId, companyId))).toBe(2);
  });
});

describe("die.processImport", () => {
  const newDie = (code: string) => ({
    series: "P",
    sectionCode: code,
    dimensions: {},
    weightMinG: 1_000,
    weightMaxG: 1_200,
  });

  test("new dies sent twice with the same id are created once; the replay is not a UNIQUE error", async () => {
    const { companyId, api } = await owner();
    const input = { newRows: [newDie("R1"), newDie("R2")], updatedRows: [], clientRequestId: REQ };
    expect(await api.die.processImport(input)).toMatchObject({ count: 2, replayed: false });
    expect(await api.die.processImport(input)).toMatchObject({ count: 2, replayed: true });
    expect(await countRows(die, eq(die.companyId, companyId))).toBe(2);
  });

  test("an update with only the required columns keeps name, notes, geometry, height and an archived status", async () => {
    const { api } = await owner();
    const created = await api.die.create({
      series: "PATTI",
      sectionCode: "14701",
      name: "Patti 1 x 1/8",
      legMm: 12.5,
      widthMm: 25.4,
      thicknessMm: 3.2,
      dimensions: { heightMm: 10 },
      weightMinG: 2_000,
      weightMaxG: 2_200,
      status: "archived",
      notes: "Old die card",
    });
    await api.die.processImport({
      newRows: [],
      updatedRows: [
        { existingId: created.id, series: "PATTI", sectionCode: "14701", dimensions: {}, weightMinG: 2_400, weightMaxG: 2_600 },
      ],
    });
    const row = await env.db.query.die.findFirst({ where: eq(die.id, created.id) });
    expect(row).toMatchObject({
      name: "Patti 1 x 1/8",
      legMm: 12.5,
      widthMm: 25.4,
      thicknessMm: 3.2,
      status: "archived",
      notes: "Old die card",
      weightMinG: 2_400,
      weightMaxG: 2_600,
    });
    expect(row!.dimensions).toMatchObject({ heightMm: 10, widthMm: 25.4, thicknessMm: 3.2 });
  });

  test("an update writes the fields it sends and merges dimensions instead of replacing them", async () => {
    const { api } = await owner();
    const created = await api.die.create({
      series: "TEE",
      sectionCode: "13090",
      name: "Tee",
      widthMm: 20,
      dimensions: { heightMm: 15 },
      weightMinG: 1_000,
      weightMaxG: 1_100,
      notes: "keep me",
    });
    await api.die.processImport({
      newRows: [],
      updatedRows: [
        {
          existingId: created.id,
          series: "TEE",
          sectionCode: "13090",
          name: "Tee 20 x 15",
          widthMm: 22.2,
          legMm: 31.75,
          status: "archived",
          dimensions: {},
          weightMinG: 1_050,
          weightMaxG: 1_150,
        },
      ],
    });
    const row = await env.db.query.die.findFirst({ where: eq(die.id, created.id) });
    // Geometry keeps 0.1 mm (ruling R16): 31.75 is stored as 31.8.
    expect(row).toMatchObject({ name: "Tee 20 x 15", widthMm: 22.2, legMm: 31.8, status: "archived", notes: "keep me" });
    expect(row!.dimensions).toMatchObject({ heightMm: 15, widthMm: 22.2 });
  });

  test("an update cannot reach another company's die", async () => {
    const a = await owner();
    const b = await owner();
    const theirs = await b.api.die.create({ series: "X", sectionCode: "1", name: "Theirs", weightMinG: 1, weightMaxG: 2 });
    await a.api.die.processImport({
      newRows: [],
      updatedRows: [{ existingId: theirs.id, series: "X", sectionCode: "1", name: "Mine now", dimensions: {}, weightMinG: 5, weightMaxG: 6 }],
    });
    const row = await env.db.query.die.findFirst({ where: and(eq(die.id, theirs.id), eq(die.companyId, b.companyId)) });
    expect(row).toMatchObject({ name: "Theirs", weightMinG: 1 });
  });
});

describe("bundle.importCheck", () => {
  test("names the sheet's dies that were deleted, and only those", async () => {
    const { api } = await owner();
    const gone = await api.die.create({ series: "Z", sectionCode: "OLD-9", weightMinG: 1, weightMaxG: 2 });
    await api.die.delete({ id: gone.id });
    await api.die.create({ series: "Z", sectionCode: "LIVE-9", weightMinG: 1, weightMaxG: 2 });
    // Same code under another series is not the deleted die.
    const res = await api.bundle.importCheck({
      dies: [
        { series: "Z", sectionCode: "OLD-9" },
        { series: "Y", sectionCode: "OLD-9" },
        { series: "Z", sectionCode: "LIVE-9" },
        { series: "Z", sectionCode: "NEW-9" },
      ],
    });
    expect(res.deleted).toEqual([{ series: "Z", sectionCode: "OLD-9" }]);
  });

  test("never answers about another company's deleted dies", async () => {
    const a = await owner();
    const b = await owner();
    const gone = await b.api.die.create({ series: "Q", sectionCode: "B-1", weightMinG: 1, weightMaxG: 2 });
    await b.api.die.delete({ id: gone.id });
    expect((await a.api.bundle.importCheck({ dies: [{ series: "Q", sectionCode: "B-1" }] })).deleted).toEqual([]);
  });

  test("an operator is refused, like the import itself", async () => {
    const { companyId } = await env.seedCompany();
    const operator = env.caller({ role: "operator", companyId });
    await expect(operator.bundle.importCheck({ dies: [{ series: "Q", sectionCode: "1" }] })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
