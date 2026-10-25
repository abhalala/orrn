/**
 * W1-PK-W review round 1, server side.
 * - I-1 (D20): pack source "Plant stock" writes the bundles as plant stock (one `bundle_transfer` to no
 *   line per bundle, no ledger row), so the floor scan adds them under the plant-stock rules.
 * - I-2 (D15): an order line that pins a die copy wins; another copy is refused unless the office
 *   (`order.manage`) sends `overridePin` (audited).
 * - I-3 (BACKLOG 16 / 36): "in stock" = available only, the same figure on Sections, Lengths, Yards and
 *   Bundles for the same filter; held is its own figure; hollow / solid / semi from the server.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, bundle, bundleTransfer, die, dieInstance, location, salesOrderLine, stockLedger } from "@orrn/db/schema";
import { and, eq, inArray } from "drizzle-orm";

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

async function copyOf(companyId: string, sectionId: string, code: string, seqNo: number) {
  const id = crypto.randomUUID();
  await env.db.insert(dieInstance).values({ id, companyId, sectionId, seqNo, code });
  return id;
}

describe("I-1 D20: pack source Plant stock", () => {
  test("createReceipt({source:'plant_stock'}) writes one transfer to no line per bundle and no extra ledger row", async () => {
    setClock(NOON);
    const p = await plant();
    const res = await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, source: "plant_stock", rows: rows(40, 42) });
    const ids = res.bundles.map((b) => b.id);
    const transfers = await env.db.select().from(bundleTransfer).where(inArray(bundleTransfer.bundleId, ids));
    expect(transfers).toHaveLength(2);
    for (const t of transfers) {
      expect(t).toMatchObject({ companyId: p.companyId, fromSalesOrderLineId: null, toSalesOrderLineId: null, batchId: res.groupId });
    }
    // The ledger has the pack rows only (one per bundle); a transfer posts nothing.
    const ledger = await env.db.select().from(stockLedger).where(eq(stockLedger.companyId, p.companyId));
    expect(ledger.filter((l) => l.voucherType === "pack")).toHaveLength(2);
    expect(ledger.filter((l) => l.voucherType !== "pack")).toHaveLength(0);
    // The plant-stock filter and the bundle list see them as plant stock.
    const list = await p.owner.bundle.listBundles({ plantStock: true, limit: 10 });
    expect(list.items.map((b) => b.id).sort()).toEqual([...ids].sort());
    expect(list.items.every((b) => b.plantStock)).toBe(true);
    const audit = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "bundle.receipt.create")));
    expect(audit[0]?.meta).toMatchObject({ source: "plant_stock" });
  }, SLOW);

  test("the floor scan adds a plant-stock bundle to any customer's load; a bundle packed with no source stays unassigned", async () => {
    setClock(NOON);
    const p = await plant();
    const plantRes = await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, source: "plant_stock", rows: rows(40) });
    const legacy = await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, rows: rows(41) });
    const { id } = await p.owner.dispatch.create({ customerId: p.otherCustomer });
    const scan = await p.as("operator").dispatch.scan({ id, serials: [plantRes.bundles[0]!.serial, legacy.bundles[0]!.serial] });
    expect(scan.results.map((r) => r.outcome)).toEqual(["added", "unassigned"]);
  }, SLOW);

  test("plant stock with an order line, or on a customer-owned die, is refused", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 500 }]);
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, source: "plant_stock", salesOrderLineId: o.lineIds[0], rows: rows(40) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, source: "order", rows: rows(40) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    // FP-PK-10: an owned die never makes plant stock.
    await env.db.update(die).set({ ownerCustomerId: p.customerId }).where(eq(die.id, p.dieA));
    const owned = await copyOf(p.companyId, p.dieA, "OW-1", 1);
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, source: "plant_stock", dieInstanceId: owned, rows: rows(40) }),
    ).rejects.toThrow();
  }, SLOW);
});

describe("I-2 D15: the order line's pinned die copy wins", () => {
  async function pinned() {
    const p = await plant();
    const pin = await copyOf(p.companyId, p.dieA, "A-1", 1);
    const other = await copyOf(p.companyId, p.dieA, "A-2", 2);
    const o = await p.order([{ dieId: p.dieA, kg: 500 }]);
    await env.db.update(salesOrderLine).set({ dieInstanceId: pin }).where(eq(salesOrderLine.id, o.lineIds[0]!));
    return { p, pin, other, lineId: o.lineIds[0]! };
  }

  test("openLines names the pinned copy so the screen preselects it", async () => {
    setClock(NOON);
    const { p, pin, lineId } = await pinned();
    const free = await p.order([{ dieId: p.dieA, kg: 300 }]);
    const lines = await p.as("packer").orders.openLines({ dieId: p.dieA });
    expect(lines.find((l) => l.lineId === lineId)).toMatchObject({ pinnedCopyId: pin, pinnedCopyCode: "A-1" });
    expect(lines.find((l) => l.lineId === free.lineIds[0])).toMatchObject({ pinnedCopyId: null, pinnedCopyCode: null });
  }, SLOW);

  test("no copy sent: the pin is used; the pin itself sent: fine", async () => {
    setClock(NOON);
    const { p, pin, lineId } = await pinned();
    const a = await p.as("packer").bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, salesOrderLineId: lineId, rows: rows(40) });
    const b = await p.as("packer").bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, salesOrderLineId: lineId, dieInstanceId: pin, rows: rows(40) });
    const made = await env.db.select({ copy: bundle.dieInstanceId }).from(bundle).where(inArray(bundle.id, [a.bundles[0]!.id, b.bundles[0]!.id]));
    expect(made.map((m) => m.copy)).toEqual([pin, pin]);
  }, SLOW);

  test("another copy is refused with the pinned code; the packer cannot override", async () => {
    setClock(NOON);
    const { p, other, lineId } = await pinned();
    const input = { dieId: p.dieA, unit: "pcs", locationId: p.yard, salesOrderLineId: lineId, dieInstanceId: other, rows: rows(40) };
    await expect(p.as("packer").bundle.createReceipt(input)).rejects.toMatchObject({ code: "BAD_REQUEST", message: "This line is pinned to A-1" });
    await expect(p.as("packer").bundle.createReceipt({ ...input, overridePin: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, SLOW);

  test("a manager (order.manage) overrides the pin with overridePin: the bundle is on the chosen copy and the override is audited", async () => {
    setClock(NOON);
    const { p, pin, other, lineId } = await pinned();
    const res = await p.as("manager").bundle.createReceipt({
      dieId: p.dieA,
      unit: "pcs",
      locationId: p.yard,
      salesOrderLineId: lineId,
      dieInstanceId: other,
      overridePin: true,
      rows: rows(40),
    });
    const [made] = await env.db.select({ copy: bundle.dieInstanceId }).from(bundle).where(eq(bundle.id, res.bundles[0]!.id));
    expect(made!.copy).toBe(other);
    const audit = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "bundle.receipt.pin_override")));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.meta).toMatchObject({ salesOrderLineId: lineId, pinnedCopyId: pin, usedCopyId: other, groupId: res.groupId });
  }, SLOW);

  test("an unpinned line keeps the free choice", async () => {
    setClock(NOON);
    const p = await plant();
    const free = await copyOf(p.companyId, p.dieA, "A-9", 9);
    const o = await p.order([{ dieId: p.dieA, kg: 500 }]);
    const res = await p.as("packer").bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, salesOrderLineId: o.lineIds[0], dieInstanceId: free, rows: rows(40) });
    const [made] = await env.db.select({ copy: bundle.dieInstanceId }).from(bundle).where(eq(bundle.id, res.bundles[0]!.id));
    expect(made!.copy).toBe(free);
  }, SLOW);
});

describe("I-3: in stock means available only, the same on every stock tab", () => {
  test("Sections, Lengths, Yards and Bundles report the same in-stock and held figures for the same filter, with kind totals", async () => {
    setClock(NOON);
    const p = await plant();
    await env.db.update(die).set({ profileKind: "hollow" }).where(eq(die.id, p.dieA));
    await env.db.update(die).set({ profileKind: "solid" }).where(eq(die.id, p.dieB));
    const a = await p.pack(p.dieA, [{ kg: 100 }, { kg: 110 }, { kg: 120 }]);
    const b = await p.pack(p.dieB, [{ kg: 50 }, { kg: 60 }]);
    // One held (reserved on a dispatch), one dispatched, one void.
    await p.held([a[0]!]);
    const gone = await p.held([b[0]!]);
    await p.owner.dispatch.complete({ id: gone });
    const [voidId] = (await env.db.select({ id: bundle.id }).from(bundle).where(eq(bundle.serial, a[2]!))).map((r) => r.id);
    await p.owner.bundle.transitionStatus({ id: voidId!, toStatus: "void", reason: "damaged" });
    // A bundle at a store location (not a yard) still counts on every tab (m-3).
    const store = (await env.db.select({ id: location.id }).from(location).where(and(eq(location.companyId, p.companyId), eq(location.kind, "store"))))[0];
    expect(store).toBeDefined();
    await env.db.update(bundle).set({ locationId: store!.id }).where(eq(bundle.serial, b[1]!));

    const expected = {
      inStock: { bundles: 2, pcs: 20, weightG: kg(110) + kg(60) },
      held: { bundles: 1, pcs: 10, weightG: kg(100) },
    };
    const sections = await p.owner.bundle.stockSummary({});
    const lengths = await p.owner.stock.byDieLength({});
    const yards = await p.owner.stock.byYard({});
    const listAll = await p.owner.bundle.listBundles({ limit: 1 });
    const listAvailable = await p.owner.bundle.listBundles({ status: "available", limit: 1 });
    for (const view of [sections, lengths, yards, listAll, listAvailable]) {
      expect(view.stock.inStock).toEqual(expected.inStock);
      expect(view.stock.held).toEqual(expected.held);
      expect(view.stock.kindTotals.hollow).toEqual({ bundles: 1, pcs: 10, weightG: kg(110) });
      expect(view.stock.kindTotals.solid).toEqual({ bundles: 1, pcs: 10, weightG: kg(60) });
      expect(view.stock.kindTotals.semi.bundles).toBe(0);
    }
    // Bundles "All": the listed count spans every status, with a breakdown per status.
    expect(Number(listAll.total)).toBe(5);
    expect(listAll.byStatus).toEqual({
      available: { bundles: 2, pcs: 20, weightG: kg(170) },
      reserved: { bundles: 1, pcs: 10, weightG: kg(100) },
      dispatched: { bundles: 1, pcs: 10, weightG: kg(50) },
      void: { bundles: 1, pcs: 10, weightG: kg(120) },
    });
    // Yards: the total is one SQL figure over every location (no yard-only undercount).
    expect(yards.totals).toEqual({ bundles: 3, pcs: 30, weightG: kg(270) });

    // The same filter narrows every tab the same way.
    const hollowOnly = { profileKind: "hollow" as const };
    for (const view of [
      await p.owner.bundle.stockSummary(hollowOnly),
      await p.owner.stock.byDieLength(hollowOnly),
      await p.owner.stock.byYard(hollowOnly),
      await p.owner.bundle.listBundles({ ...hollowOnly, limit: 1 }),
    ]) {
      expect(view.stock.inStock).toEqual({ bundles: 1, pcs: 10, weightG: kg(110) });
      expect(view.stock.held).toEqual({ bundles: 1, pcs: 10, weightG: kg(100) });
    }
  }, SLOW);
});

describe("BACKLOG 16: the dispatch list opens on every open load, Building first", () => {
  test("listDispatches({statuses}) lists draft then reserved, newest first within each; completed stays out", async () => {
    setClock(NOON);
    const p = await plant();
    const [a, b] = await p.pack(p.dieA, [{ kg: 40 }, { kg: 41 }]);
    const held1 = await p.held([a!]);
    const draft1 = (await p.owner.dispatch.create({ customerId: p.customerId })).id;
    const held2 = await p.held([b!]);
    const draft2 = (await p.owner.dispatch.create({ customerId: p.customerId })).id;
    const done = await p.held((await p.pack(p.dieA, [{ kg: 42 }]))!);
    await p.owner.dispatch.complete({ id: done });
    const open = await p.owner.dispatch.listDispatches({ statuses: ["draft", "reserved"], limit: 50 });
    const ids = open.items.map((d) => d.id);
    expect(open.total).toBe(4);
    expect(new Set(ids.slice(0, 2))).toEqual(new Set([draft1, draft2]));
    expect(new Set(ids.slice(2))).toEqual(new Set([held1, held2]));
    expect(open.items.map((d) => d.status)).toEqual(["draft", "draft", "reserved", "reserved"]);
  }, SLOW);
});
