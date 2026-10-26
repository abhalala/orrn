/**
 * BACKLOG 50 (architecture SAD §5): replay-safe floor writes. A pack, a dispatch scan or a yard move
 * sent again with the same `clientRequestId` (a lost reply on yard Wi-Fi, Save tapped twice) answers
 * the first result with `replayed: true` and writes nothing more: no second serial, bundle, ledger
 * row, dispatch item or audit row. The same key with other content is a CONFLICT.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, bundle, dispatchItem, stockLedger } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { kg, NOON, salesHelpers, SLOW } from "./sales-fixture";

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

const { plant } = salesHelpers(() => env);
const rows = (...kgs: number[]) => kgs.map((k) => ({ quantity: 10, weightG: kg(k), lengthMm: 3_658 }));
const key = (tag: string) => `test-${tag}-${crypto.randomUUID()}`;

async function counts(companyId: string) {
  const bundles = await env.db.select({ id: bundle.id }).from(bundle).where(eq(bundle.companyId, companyId));
  const ledger = await env.db.select({ id: stockLedger.id }).from(stockLedger).where(eq(stockLedger.companyId, companyId));
  const audits = await env.db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(and(eq(auditLog.companyId, companyId)));
  return { bundles: bundles.length, ledger: ledger.length, audits: audits.length };
}

describe("bundle.createReceipt with clientRequestId", () => {
  test("a save sent twice packs once and answers the first result again", async () => {
    setClock(NOON);
    const p = await plant();
    const input = { dieId: p.dieA, unit: "pcs", locationId: p.yard, source: "plant_stock" as const, rows: rows(40, 41, 42), clientRequestId: key("pack") };
    const first = await p.as("packer").bundle.createReceipt(input);
    const after = await counts(p.companyId);
    const again = await p.as("packer").bundle.createReceipt(input);
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(again.groupId).toBe(first.groupId);
    expect(again.code).toBe(first.code);
    expect(again.bundles).toEqual(first.bundles);
    expect(await counts(p.companyId)).toEqual(after);
  }, SLOW);

  test("two identical saves racing make one bundle set", async () => {
    setClock(NOON);
    const p = await plant();
    const input = { dieId: p.dieA, unit: "pcs", locationId: p.yard, source: "plant_stock" as const, rows: rows(40, 41), clientRequestId: key("race") };
    const [a, b] = await Promise.all([p.owner.bundle.createReceipt(input), p.owner.bundle.createReceipt(input)]);
    expect(a.groupId).toBe(b.groupId);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    const made = await env.db.select({ id: bundle.id }).from(bundle).where(eq(bundle.companyId, p.companyId));
    expect(made).toHaveLength(2);
  }, SLOW);

  test("the same key with other bundles is a CONFLICT; no key packs again as before", async () => {
    setClock(NOON);
    const p = await plant();
    const k = key("conflict");
    await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, source: "plant_stock", rows: rows(40), clientRequestId: k });
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, source: "plant_stock", rows: rows(41), clientRequestId: k }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const plain = { dieId: p.dieA, unit: "pcs", locationId: p.yard, source: "plant_stock" as const, rows: rows(40) };
    const x = await p.owner.bundle.createReceipt(plain);
    const y = await p.owner.bundle.createReceipt(plain);
    expect(x.groupId).not.toBe(y.groupId);
    expect((await counts(p.companyId)).bundles).toBe(3);
  }, SLOW);

  test("a key is per company: another plant's identical key packs its own bundles", async () => {
    setClock(NOON);
    const a = await plant();
    const b = await plant();
    const k = key("tenant");
    const ra = await a.owner.bundle.createReceipt({ dieId: a.dieA, unit: "pcs", locationId: a.yard, source: "plant_stock", rows: rows(40), clientRequestId: k });
    const rb = await b.owner.bundle.createReceipt({ dieId: b.dieA, unit: "pcs", locationId: b.yard, source: "plant_stock", rows: rows(40), clientRequestId: k });
    expect(rb.replayed).toBe(false);
    expect(rb.groupId).not.toBe(ra.groupId);
  }, SLOW);
});

describe("dispatch.scan / addBundlesBySerial with clientRequestId", () => {
  test("a scan sent twice adds once and answers 'added' again, not 'already on this dispatch'", async () => {
    setClock(NOON);
    const p = await plant();
    const r = await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, source: "plant_stock", rows: rows(40) });
    const serial = r.bundles[0]!.serial;
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const k = key("scan");
    const first = await p.as("operator").dispatch.scan({ id, serials: [serial], clientRequestId: k });
    const audits = (await counts(p.companyId)).audits;
    const again = await p.as("operator").dispatch.scan({ id, serials: [serial], clientRequestId: k });
    expect(first.results[0]!.outcome).toBe("added");
    expect(again.replayed).toBe(true);
    expect(again.results[0]!.outcome).toBe("added");
    expect(again.added).toEqual([serial]);
    expect(again.capacity).toEqual(first.capacity);
    const items = await env.db.select({ id: dispatchItem.id }).from(dispatchItem).where(eq(dispatchItem.dispatchId, id));
    expect(items).toHaveLength(1);
    expect((await counts(p.companyId)).audits).toBe(audits);
    // Without a key the same scan is the calm "already on this dispatch".
    const plain = await p.as("operator").dispatch.scan({ id, serials: [serial] });
    expect(plain.results[0]!.outcome).toBe("already_on_dispatch");
  }, SLOW);

  test("addBundlesBySerial replays too; the same key for other serials is a CONFLICT", async () => {
    setClock(NOON);
    const p = await plant();
    const r = await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, rows: rows(40, 41) });
    const [a, b] = r.bundles.map((x) => x.serial);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const k = key("office");
    const first = await p.owner.dispatch.addBundlesBySerial({ id, serials: [a!], allowUnassigned: true, clientRequestId: k });
    const again = await p.owner.dispatch.addBundlesBySerial({ id, serials: [a!], allowUnassigned: true, clientRequestId: k });
    expect(first.added).toEqual([a!]);
    expect(again).toMatchObject({ added: [a!], replayed: true });
    await expect(p.owner.dispatch.addBundlesBySerial({ id, serials: [b!], allowUnassigned: true, clientRequestId: k })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  }, SLOW);

  test("two identical scans racing add one item and both answer 'added'", async () => {
    setClock(NOON);
    const p = await plant();
    const r = await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, source: "plant_stock", rows: rows(40) });
    const serial = r.bundles[0]!.serial;
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const input = { id, serials: [serial], clientRequestId: key("scanrace") };
    const [x, y] = await Promise.all([p.as("operator").dispatch.scan(input), p.as("operator").dispatch.scan(input)]);
    expect([x.results[0]!.outcome, y.results[0]!.outcome]).toEqual(["added", "added"]);
    const items = await env.db.select({ id: dispatchItem.id }).from(dispatchItem).where(eq(dispatchItem.dispatchId, id));
    expect(items).toHaveLength(1);
  }, SLOW);
});

describe("stock.move with clientRequestId", () => {
  test("a move sent twice posts once and answers the first move again", async () => {
    setClock(NOON);
    const p = await plant();
    const r = await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, source: "plant_stock", rows: rows(40, 41) });
    const y2 = (await p.owner.stock.locations.list()).items.find((l) => l.kind === "yard" && l.id !== p.yard)!;
    const input = { bundleIds: r.bundles.map((b) => b.id), toLocationId: y2.id, reason: "Tidy", clientRequestId: key("move") };
    const first = await p.as("operator").stock.move(input);
    const after = await counts(p.companyId);
    const again = await p.as("operator").stock.move(input);
    expect(first).toMatchObject({ moved: 2, unchanged: 0, replayed: false });
    expect(again).toEqual({ ...first, replayed: true });
    expect(await counts(p.companyId)).toEqual(after);
    await expect(p.as("operator").stock.move({ ...input, toLocationId: p.yard })).rejects.toMatchObject({ code: "CONFLICT" });
  }, SLOW);
});
