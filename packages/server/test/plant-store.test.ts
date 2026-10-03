/**
 * PL-7: central store — items, GRN receipts, MRS issues, old-for-new exchanges, balances
 * (spec P17, digest Stage 18). The headline rule: an issue can never take a balance negative,
 * even when two issues race (the balance check is inside the guarded INSERT).
 *
 * Store quantities are integer milli-units (`qty_milli`; 1000 = 1 unit of the item's unit) and
 * ride the ledger's generic `qty_g` column for item_kind `store_item` at the STORE location.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, stockLedger, storeItem, storeTxn } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { can as canMe, type Action } from "../src/lib/permissions";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;
let setClock: (at: Date | null) => void;

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
});

afterEach(() => setClock(null));

afterAll(async () => {
  await env.dispose();
});

const can = (role: CompanyRole, action: Action) =>
  canMe({ company: { role }, isPlatformAdmin: false, platformRole: null }, action);

const ROLES: CompanyRole[] = [
  "owner", "admin", "manager", "office", "accountant", "supervisor", "packer",
  "foundry", "press", "storekeeper", "die_room", "operator", "viewer",
];

/** 1 unit in milli-units. */
const U = 1000;

async function plant(opts: { locations?: boolean } = {}) {
  const { companyId, users } = await env.seedCompany();
  const callers = Object.fromEntries(
    ROLES.map((role) => [role, env.caller({ role, companyId })]),
  ) as Record<CompanyRole, ReturnType<typeof env.caller>>;
  if (opts.locations !== false) await callers.owner.stock.locations.seedDefaults();
  const flux = await callers.storekeeper.store.items.create({ name: "Cover flux", unit: "kg", category: "chemical" });
  const bearing = await callers.storekeeper.store.items.create({ name: "Roller bearing 6205", unit: "piece", category: "spare" });
  return { companyId, users, ...callers, fluxId: flux.id, bearingId: bearing.id };
}

type Plant = Awaited<ReturnType<typeof plant>>;

async function storeLedger(companyId: string, itemId?: string) {
  const rows = await env.db
    .select()
    .from(stockLedger)
    .where(and(eq(stockLedger.companyId, companyId), eq(stockLedger.itemKind, "store_item")));
  return itemId ? rows.filter((r) => r.itemRef === itemId) : rows;
}

async function ledgerBalance(companyId: string, itemId: string) {
  return (await storeLedger(companyId, itemId)).reduce((s, r) => s + r.qtyG, 0);
}

async function balanceOf(p: Plant, itemId: string) {
  const rows = (await p.storekeeper.store.balances()).items;
  return rows.find((r) => r.id === itemId)?.balanceMilli ?? null;
}

async function txnRows(companyId: string) {
  return env.db.select().from(storeTxn).where(eq(storeTxn.companyId, companyId));
}

async function auditActions(companyId: string) {
  return (await env.db.select().from(auditLog).where(eq(auditLog.companyId, companyId))).map((r) => r.action);
}

// ---------------------------------------------------------------------------
// Items (masters)
// ---------------------------------------------------------------------------

describe("store items", () => {
  test("storekeeper, manager, admin and owner create items; everyone else is FORBIDDEN", async () => {
    const p = await plant();
    for (const role of ["storekeeper", "manager", "admin", "owner"] as const) {
      const r = await p[role].store.items.create({ name: `Item by ${role}`, unit: "litre", category: "fuel" });
      expect(r.id).toBeTruthy();
    }
    for (const role of ["office", "accountant", "supervisor", "packer", "foundry", "press", "die_room", "operator", "viewer"] as const) {
      await expect(p[role].store.items.create({ name: `No ${role}`, unit: "kg", category: "other" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  });

  test("any member can list items (foundry and nitriding pick from the list), without balances", async () => {
    const p = await plant();
    const { items } = await p.viewer.store.items.list();
    expect(items.map((i) => i.name).sort()).toEqual(["Cover flux", "Roller bearing 6205"]);
    expect(Object.keys(items[0]!)).not.toContain("balanceMilli");
  });

  test("names are unique per company by letters and digits; units and categories are enums", async () => {
    const p = await plant();
    await expect(p.manager.store.items.create({ name: "COVER  flux.", unit: "kg", category: "chemical" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      p.manager.store.items.create({ name: "Mystery", unit: "bucket" as never, category: "other" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      p.manager.store.items.create({ name: "Mystery", unit: "kg", category: "magic" as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.manager.store.items.create({ name: "  ", unit: "kg", category: "other" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    // another company may use the same name
    const q = await plant();
    expect((await q.manager.store.items.list()).items.some((i) => i.name === "Cover flux")).toBe(true);
  });

  test("update renames and retires; retired items take no receipts or issues; audit rows written", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U });
    await p.storekeeper.store.items.update({ id: p.fluxId, name: "Cover flux (K)" });
    // Minor 3: an item with stock cannot be retired (the stock would be frozen)
    await expect(p.manager.store.items.update({ id: p.fluxId, active: false })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await env.db.select().from(storeItem).where(eq(storeItem.id, p.fluxId)))[0]!.active).toBe(true);
    await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 5 * U, purpose: "melt" });
    await p.manager.store.items.update({ id: p.fluxId, active: false });
    const [row] = await env.db.select().from(storeItem).where(eq(storeItem.id, p.fluxId));
    expect(row!.name).toBe("Cover flux (K)");
    expect(row!.active).toBe(false);
    expect(row!.retiredAt).toBeInstanceOf(Date);
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "melt" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const actions = await auditActions(p.companyId);
    expect(actions).toContain("store_item.create");
    expect(actions.filter((a) => a === "store_item.update")).toHaveLength(2);
    // reactivating clears retired_at
    await p.manager.store.items.update({ id: p.fluxId, active: true });
    expect((await env.db.select().from(storeItem).where(eq(storeItem.id, p.fluxId)))[0]!.retiredAt).toBeNull();
  });

  test("RACE: a receipt lands after the retire read the balance as 0 — the retire does not land", async () => {
    const p = await plant();
    env.beforeNextBatch(() => p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U }));
    await expect(p.manager.store.items.update({ id: p.fluxId, active: false })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await env.db.select().from(storeItem).where(eq(storeItem.id, p.fluxId)))[0]!.active).toBe(true);
  });

  test("Minor 9: a name is unique among active items only — a retired name can be reused", async () => {
    const p = await plant();
    await p.manager.store.items.update({ id: p.fluxId, active: false });
    const again = await p.manager.store.items.create({ name: "Cover flux", unit: "kg", category: "chemical" });
    expect(again.id).not.toBe(p.fluxId);
    await expect(p.manager.store.items.update({ id: p.fluxId, active: true })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p.manager.store.items.create({ name: "cover flux", unit: "kg", category: "chemical" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  test("item id inputs are capped at 64 characters", async () => {
    const p = await plant();
    const long = "x".repeat(65);
    await expect(p.manager.store.items.update({ id: long, name: "A" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.storekeeper.store.receive({ itemId: long, qtyMilli: U })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.storekeeper.store.issue({ itemId: long, qtyMilli: U, purpose: "melt" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.storekeeper.store.exchange({ itemId: long, qtyOutMilli: U, qtyInMilli: U })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.manager.store.txns({ itemId: long })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.storekeeper.store.cancel({ txnId: long, reason: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("the unit cannot change once the item has a movement", async () => {
    const p = await plant();
    await p.storekeeper.store.items.update({ id: p.fluxId, unit: "litre" }); // no movement yet: fine
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U });
    await expect(p.storekeeper.store.items.update({ id: p.fluxId, unit: "kg" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [row] = await env.db.select().from(storeItem).where(eq(storeItem.id, p.fluxId));
    expect(row!.unit).toBe("litre");
  });

  test("tenant isolation: another company's item is NOT_FOUND everywhere", async () => {
    const a = await plant();
    const b = await plant();
    await expect(b.manager.store.items.update({ id: a.fluxId, name: "Hijack" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.storekeeper.store.receive({ itemId: a.fluxId, qtyMilli: U })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.storekeeper.store.issue({ itemId: a.fluxId, qtyMilli: U, purpose: "melt" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(b.storekeeper.store.exchange({ itemId: a.fluxId, qtyOutMilli: U, qtyInMilli: U })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await storeLedger(a.companyId)).toEqual([]);
    expect(await storeLedger(b.companyId)).toEqual([]);
    expect((await b.storekeeper.store.balances()).items.map((i) => i.id)).not.toContain(a.fluxId);
  });
});

// ---------------------------------------------------------------------------
// Receive (GRN)
// ---------------------------------------------------------------------------

describe("store.receive (GRN)", () => {
  test("posts + at STORE in milli-units, GRN-1, GRN-2, with document, ledger and audit rows", async () => {
    const p = await plant();
    const storeLoc = (await p.owner.stock.locations.list()).items.find((l) => l.code === "STORE")!;
    const r1 = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 12_500, note: "Truck from Morbi", grnRef: "CH-4471" });
    const r2 = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 2 * U });
    expect(r1.number).toBe("GRN-1");
    expect(r2.number).toBe("GRN-2");

    const rows = await storeLedger(p.companyId, p.fluxId);
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.voucherId === r1.id)!;
    expect(first).toMatchObject({
      voucherType: "store_grn",
      line: 1,
      itemKind: "store_item",
      itemRef: p.fluxId,
      locationId: storeLoc.id,
      qtyG: 12_500,
      reason: "GRN-1",
    });
    expect(first.createdBy).toBe(p.users.storekeeper.id);
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(14_500);
    expect(await balanceOf(p, p.fluxId)).toBe(14_500);

    const [txn] = await env.db.select().from(storeTxn).where(eq(storeTxn.id, r1.id));
    expect(txn).toMatchObject({
      kind: "grn",
      number: "GRN-1",
      itemId: p.fluxId,
      qtyMilli: 12_500,
      note: "Truck from Morbi",
      grnRef: "CH-4471",
      locationId: storeLoc.id,
    });
    expect((await auditActions(p.companyId)).filter((a) => a === "store.receive")).toHaveLength(2);
  });

  test("validation: positive integer milli-units within the cap; countable units take whole pieces", async () => {
    const p = await plant();
    for (const bad of [0, -5, 1.5, 100_000_001]) {
      await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: bad })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 100_000_000 })).resolves.toBeTruthy();
    // 2.5 bearings do not exist
    await expect(p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 2_500 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 3 * U })).resolves.toBeTruthy();
    await expect(
      p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U, note: "x".repeat(501) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("fractional units work for kg and litre (12.345 kg)", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 12_345 });
    expect(await balanceOf(p, p.fluxId)).toBe(12_345);
  });

  test("without a STORE location it says so and writes nothing", async () => {
    const p = await plant({ locations: false });
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("store location"),
    });
    expect(await txnRows(p.companyId)).toEqual([]);
    expect(await storeLedger(p.companyId)).toEqual([]);
  });

  test("race: the STORE location is retired between read and write — nothing lands", async () => {
    const p = await plant();
    const storeLoc = (await p.owner.stock.locations.list()).items.find((l) => l.code === "STORE")!;
    env.beforeNextBatch(() => p.manager.stock.locations.update({ id: storeLoc.id, active: false }));
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await txnRows(p.companyId)).toEqual([]);
    expect(await storeLedger(p.companyId)).toEqual([]);
    expect((await auditActions(p.companyId)).filter((a) => a === "store.receive")).toEqual([]);
  });

  test("race: the item is retired between read and write — nothing lands", async () => {
    const p = await plant();
    env.beforeNextBatch(() => p.manager.store.items.update({ id: p.fluxId, active: false }));
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await storeLedger(p.companyId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Issue (MRS) and the never-negative rule
// ---------------------------------------------------------------------------

describe("store.issue (MRS)", () => {
  test("posts − at STORE, MRS-1, MRS-2; the purpose and reference are kept", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 50 * U });
    const m1 = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 20 * U, purpose: "melt", refId: "cast-K31", note: "Furnace 2" });
    const m2 = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 5_250, purpose: "nitriding" });
    expect(m1.number).toBe("MRS-1");
    expect(m2.number).toBe("MRS-2");
    expect(await balanceOf(p, p.fluxId)).toBe(50 * U - 20 * U - 5_250);

    const [row] = await storeLedger(p.companyId, p.fluxId).then((rs) => rs.filter((r) => r.voucherId === m1.id));
    expect(row).toMatchObject({ voucherType: "store_mrs", line: 1, qtyG: -20 * U, reason: "MRS-1" });
    const [txn] = await env.db.select().from(storeTxn).where(eq(storeTxn.id, m1.id));
    expect(txn).toMatchObject({ kind: "mrs", purpose: "melt", refId: "cast-K31", note: "Furnace 2", qtyMilli: 20 * U });
    expect((await auditActions(p.companyId)).filter((a) => a === "store.issue")).toHaveLength(2);
  });

  test("purpose is one of melt, nitriding, maintenance, other", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 50 * U });
    for (const purpose of ["melt", "nitriding", "maintenance", "other"] as const) {
      await expect(p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose })).resolves.toBeTruthy();
    }
    await expect(p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "party" as never })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "exchange" as never })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("an issue beyond the balance is refused with the balance in the message; nothing is written", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const before = (await txnRows(p.companyId)).length;
    await expect(p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 10 * U + 1, purpose: "melt" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("10"),
    });
    expect((await txnRows(p.companyId)).length).toBe(before);
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(10 * U);
    expect((await auditActions(p.companyId)).filter((a) => a === "store.issue")).toEqual([]);
  });

  test("issuing from an item that never had stock is refused; issuing exactly the balance leaves 0", async () => {
    const p = await plant();
    await expect(p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 1, purpose: "melt" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 7 * U });
    await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 7 * U, purpose: "melt" });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(0);
    await expect(p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 1, purpose: "melt" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("countable items issue whole pieces only", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 4 * U });
    await expect(p.storekeeper.store.issue({ itemId: p.bearingId, qtyMilli: 500, purpose: "maintenance" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("RACE: two issues that would together overdraw — exactly one succeeds (concurrent)", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const results = await Promise.allSettled([
      p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 6 * U, purpose: "melt" }),
      p.owner.store.issue({ itemId: p.fluxId, qtyMilli: 6 * U, purpose: "nitriding" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "BAD_REQUEST" });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(4 * U);
    expect((await txnRows(p.companyId)).filter((t) => t.kind === "mrs")).toHaveLength(1);
  });

  test("RACE: the other issue lands after this one read the balance but before its write — the write does not land", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    // The first issue reads balance 10 (passes), then a second issue takes 6 before the first writes.
    env.beforeNextBatch(() => p.owner.store.issue({ itemId: p.fluxId, qtyMilli: 6 * U, purpose: "nitriding" }));
    await expect(p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 6 * U, purpose: "melt" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("4"),
    });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(4 * U);
    const mrs = (await txnRows(p.companyId)).filter((t) => t.kind === "mrs");
    expect(mrs).toHaveLength(1);
    expect(mrs[0]!.purpose).toBe("nitriding");
    // the loser left no ledger row and no audit row
    expect((await storeLedger(p.companyId, p.fluxId)).filter((r) => r.qtyG < 0)).toHaveLength(1);
    expect((await auditActions(p.companyId)).filter((a) => a === "store.issue")).toHaveLength(1);
  });

  test("RACE: ten concurrent issues of 3 against a balance of 10 — three land, balance 1, never negative", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 3 * U, purpose: "melt" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(1 * U);
  });

  test("RACE: the item is retired between read and write — the issue does not land", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    env.beforeNextBatch(() => p.manager.store.items.update({ id: p.fluxId, active: false }));
    await expect(p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "melt" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(10 * U);
  });
});

// ---------------------------------------------------------------------------
// Exchange (old for new)
// ---------------------------------------------------------------------------

describe("store.exchange (old for new)", () => {
  test("posts the old out under an MRS number and the new in under a GRN number, linked, in one go", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 3 * U }); // GRN-1
    const ex = await p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: 2 * U, qtyInMilli: 2 * U, note: "worn pair returned to vendor" });
    expect(ex.mrsNumber).toBe("MRS-1");
    expect(ex.grnNumber).toBe("GRN-2");
    expect(await balanceOf(p, p.bearingId)).toBe(3 * U);

    const rows = (await storeLedger(p.companyId, p.bearingId)).filter((r) => r.voucherId === ex.mrsId || r.voucherId === ex.grnId);
    expect(rows.map((r) => [r.voucherType, r.qtyG]).sort()).toEqual([["store_grn", 2 * U], ["store_mrs", -2 * U]]);

    const txns = await txnRows(p.companyId);
    const out = txns.find((t) => t.id === ex.mrsId)!;
    const inn = txns.find((t) => t.id === ex.grnId)!;
    expect(out).toMatchObject({ kind: "mrs", purpose: "exchange", number: "MRS-1", qtyMilli: 2 * U });
    expect(inn).toMatchObject({ kind: "grn", number: "GRN-2", qtyMilli: 2 * U });
    expect(out.exchangeId).toBeTruthy();
    expect(out.exchangeId).toBe(inn.exchangeId);
    expect(out.note).toBe("worn pair returned to vendor");
    expect((await auditActions(p.companyId)).filter((a) => a === "store.exchange")).toHaveLength(1);
  });

  test("unequal quantities net out (3 old out, 1 new in)", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 5 * U });
    await p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: 3 * U, qtyInMilli: U });
    expect(await balanceOf(p, p.bearingId)).toBe(3 * U);
  });

  test("the old items must be in the store: qtyOut beyond the balance is refused and nothing is written", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 2 * U });
    const before = (await txnRows(p.companyId)).length;
    await expect(
      p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: 3 * U, qtyInMilli: 3 * U }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await txnRows(p.companyId)).length).toBe(before);
    expect(await ledgerBalance(p.companyId, p.bearingId)).toBe(2 * U);
  });

  test("validation: both quantities positive, integral milli-units within cap, whole pieces for countable items", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 5 * U });
    for (const [o, i] of [[0, U], [U, 0], [-1, U], [U, 1.5], [U, 100_000_001]] as const) {
      await expect(p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: o, qtyInMilli: i })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    await expect(p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: 500, qtyInMilli: U })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("RACE: an issue drains the stock after the exchange read the balance — neither leg lands", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 3 * U });
    env.beforeNextBatch(() => p.owner.store.issue({ itemId: p.bearingId, qtyMilli: 2 * U, purpose: "maintenance" }));
    await expect(
      p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: 2 * U, qtyInMilli: 2 * U }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await ledgerBalance(p.companyId, p.bearingId)).toBe(1 * U);
    const txns = await txnRows(p.companyId);
    expect(txns.filter((t) => t.exchangeId !== null)).toEqual([]);
    expect((await auditActions(p.companyId)).filter((a) => a === "store.exchange")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

describe("GRN and MRS numbers", () => {
  test("separate series per company, restart on 1 April (financial year), never reused", async () => {
    const a = await plant();
    const b = await plant();
    setClock(new Date("2027-03-31T10:00:00+05:30"));
    const a1 = await a.storekeeper.store.receive({ itemId: a.fluxId, qtyMilli: 9 * U });
    const b1 = await b.storekeeper.store.receive({ itemId: b.fluxId, qtyMilli: 9 * U });
    const m1 = await a.storekeeper.store.issue({ itemId: a.fluxId, qtyMilli: U, purpose: "melt" });
    expect([a1.number, b1.number, m1.number]).toEqual(["GRN-1", "GRN-1", "MRS-1"]);
    setClock(new Date("2027-04-01T09:00:00+05:30"));
    const a2 = await a.storekeeper.store.receive({ itemId: a.fluxId, qtyMilli: U });
    const m2 = await a.storekeeper.store.issue({ itemId: a.fluxId, qtyMilli: U, purpose: "melt" });
    expect([a2.number, m2.number]).toEqual(["GRN-1", "MRS-1"]);
    const txns = await txnRows(a.companyId);
    expect(new Set(txns.map((t) => `${t.kind}|${t.period}|${t.number}`)).size).toBe(txns.length);
    expect(txns.find((t) => t.id === a2.id)!.period).toBe("2027-28");
    expect(txns.find((t) => t.id === a1.id)!.period).toBe("2026-27");
  });

  test("concurrent receipts get distinct numbers", async () => {
    const p = await plant();
    const rs = await Promise.all(Array.from({ length: 6 }, () => p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })));
    expect(new Set(rs.map((r) => r.number)).size).toBe(6);
    expect(await balanceOf(p, p.fluxId)).toBe(6 * U);
  });
});

// ---------------------------------------------------------------------------
// Balances and history
// ---------------------------------------------------------------------------

describe("store.balances and store.txns", () => {
  test("balances list every active item (0 when empty) with unit, category and the ledger sum", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 20 * U });
    await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 4_500, purpose: "melt" });
    const { items, locationId } = await p.manager.store.balances();
    const storeLoc = (await p.owner.stock.locations.list()).items.find((l) => l.code === "STORE")!;
    expect(locationId).toBe(storeLoc.id);
    expect(items.find((i) => i.id === p.fluxId)).toMatchObject({ name: "Cover flux", unit: "kg", category: "chemical", balanceMilli: 15_500, active: true });
    expect(items.find((i) => i.id === p.bearingId)).toMatchObject({ unit: "piece", balanceMilli: 0 });
  });

  test("readers are store.txn holders plus owner, admin, manager; others are FORBIDDEN", async () => {
    const p = await plant();
    for (const role of ROLES) {
      const allowed = ["storekeeper", "owner", "admin", "manager"].includes(role);
      const r = p[role].store.balances();
      if (allowed) await expect(r).resolves.toBeTruthy();
      else await expect(r).rejects.toMatchObject({ code: "FORBIDDEN" });
      const t = p[role].store.txns({});
      if (allowed) await expect(t).resolves.toBeTruthy();
      else await expect(t).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("txns lists newest first, filters by item and kind, and is tenant scoped", async () => {
    const p = await plant();
    const q = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 9 * U });
    await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "melt" });
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 2 * U });
    await q.storekeeper.store.receive({ itemId: q.fluxId, qtyMilli: 5 * U });
    const all = (await p.manager.store.txns({})).items;
    expect(all).toHaveLength(3);
    expect(all.every((t) => t.itemName !== undefined)).toBe(true);
    expect((await p.manager.store.txns({ itemId: p.fluxId })).items).toHaveLength(2);
    expect((await p.manager.store.txns({ kind: "mrs" })).items.map((t) => t.number)).toEqual(["MRS-1"]);
    await expect(p.manager.store.txns({ limit: 501 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await p.manager.store.txns({ limit: 1 })).items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Permission matrix, params, ledger = projection
// ---------------------------------------------------------------------------

describe("permission matrix", () => {
  test("receive, issue and exchange need store.txn: storekeeper and owner only", async () => {
    const p = await plant();
    for (const role of ROLES) {
      expect(can(role, "store.txn")).toBe(role === "storekeeper" || role === "owner");
    }
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 50 * U });
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 50 * U });
    for (const role of ROLES) {
      const ok = role === "storekeeper" || role === "owner";
      const calls = [
        () => p[role].store.receive({ itemId: p.fluxId, qtyMilli: U }),
        () => p[role].store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "other" }),
        () => p[role].store.exchange({ itemId: p.bearingId, qtyOutMilli: U, qtyInMilli: U }),
      ];
      for (const call of calls) {
        if (ok) await expect(call()).resolves.toBeTruthy();
        else await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    }
  });

  test("items.update: storekeeper, manager, admin and owner; everyone else FORBIDDEN", async () => {
    const p = await plant();
    for (const role of ROLES) {
      const ok = ["storekeeper", "manager", "admin", "owner"].includes(role);
      const call = p[role].store.items.update({ id: p.fluxId, category: "chemical" });
      if (ok) await expect(call).resolves.toBeTruthy();
      else await expect(call).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("cancel needs store.txn: storekeeper and owner only", async () => {
    const p = await plant();
    for (const role of ROLES) {
      const ok = role === "storekeeper" || role === "owner";
      const r = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U });
      const call = p[role].store.cancel({ txnId: r.id, reason: "test" });
      if (ok) await expect(call).resolves.toBeTruthy();
      else await expect(call).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("unauthenticated callers are rejected", async () => {
    const anon = env.caller(null);
    await expect(anon.store.balances()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anon.store.items.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("D1 limits and ledger = projection", () => {
  test("no statement binds more than 100 parameters (each procedure)", async () => {
    const p = await plant();
    env.resetPeakParams();
    await p.storekeeper.store.items.create({ name: "Nitrogen cylinder", unit: "piece", category: "gas" });
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 9 * U, note: "n".repeat(500), grnRef: "r".repeat(60) });
    await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "melt", refId: "i".repeat(64), note: "n".repeat(500) });
    await p.storekeeper.store.exchange({ itemId: p.fluxId, qtyOutMilli: U, qtyInMilli: U, note: "n".repeat(500) });
    await p.manager.store.balances();
    expect(env.peakParams()).toBeGreaterThan(0);
    expect(env.peakParams()).toBeLessThanOrEqual(100);
  });

  test("after any sequence of receipts, issues, exchanges and refusals: ledger = txn projection = balances, never negative", async () => {
    const p = await plant();
    const ops: (() => Promise<unknown>)[] = [];
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 48_271) % 2_147_483_647;
      return (seed % n) + 1;
    };
    for (let i = 0; i < 60; i += 1) {
      const kind = rnd(3);
      const q = rnd(9) * U + (kind === 1 ? 0 : 0);
      if (kind === 1) ops.push(() => p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: q }));
      else if (kind === 2) ops.push(() => p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: q, purpose: "melt" }));
      else ops.push(() => p.storekeeper.store.exchange({ itemId: p.fluxId, qtyOutMilli: q, qtyInMilli: rnd(9) * U }));
    }
    for (const op of ops) await op().catch(() => undefined);

    const txns = await txnRows(p.companyId);
    const projected = txns.reduce((s, t) => s + (t.kind === "grn" ? t.qtyMilli : -t.qtyMilli), 0);
    const ledger = await ledgerBalance(p.companyId, p.fluxId);
    expect(ledger).toBe(projected);
    expect(await balanceOf(p, p.fluxId)).toBe(ledger);
    expect(ledger).toBeGreaterThanOrEqual(0);
    // Minor 5: the running balance after every ledger row, in ledger order, never dips below zero
    const rows = (await storeLedger(p.companyId, p.fluxId)).sort(
      (x, y) => x.postedAt.getTime() - y.postedAt.getTime() || x.serverSeq - y.serverSeq,
    );
    let running = 0;
    for (const r of rows) {
      running += r.qtyG;
      expect(running).toBeGreaterThanOrEqual(0);
    }
    expect(running).toBe(ledger);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.some((r) => r.qtyG < 0)).toBe(true);
    // every txn has exactly one ledger row and vice versa
    expect(new Set(rows.map((r) => r.voucherId))).toEqual(new Set(txns.map((t) => t.id)));
  });

  test("ledger created_at uses the injected clock (Minor 10)", async () => {
    const p = await plant();
    setClock(new Date("2027-01-15T10:00:00Z"));
    const r = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U });
    const [row] = (await storeLedger(p.companyId, p.fluxId)).filter((x) => x.voucherId === r.id);
    expect(row!.createdAt.getTime()).toBe(new Date("2027-01-15T10:00:00Z").getTime());
    expect(row!.postedAt.getTime()).toBe(new Date("2027-01-15T10:00:00Z").getTime());
  });
});

// ---------------------------------------------------------------------------
// RP15: cancel
// ---------------------------------------------------------------------------

async function ledgerRowsOf(companyId: string, voucherId: string) {
  return (await storeLedger(companyId)).filter((r) => r.voucherId === voucherId);
}

describe("store.cancel (RP15)", () => {
  test("cancelling a GRN reverses its ledger row, keeps its number, issues no new number, audits", async () => {
    const p = await plant();
    const grn = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const out = await p.storekeeper.store.cancel({ txnId: grn.id, reason: "Wrong item booked" });
    expect(out).toMatchObject({ txnId: grn.id, number: "GRN-1", kind: "grn" });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(0);
    expect(await balanceOf(p, p.fluxId)).toBe(0);

    const rows = await ledgerRowsOf(p.companyId, grn.id);
    const orig = rows.find((r) => r.voucherType === "store_grn")!;
    const rev = rows.find((r) => r.voucherType === "store_grn_cancel")!;
    expect(rev).toMatchObject({ itemKind: "store_item", itemRef: p.fluxId, qtyG: -10 * U, reversalOf: orig.id, locationId: orig.locationId, reason: "Wrong item booked" });
    expect(rev.postedAt.getTime()).toBeGreaterThan(orig.postedAt.getTime());
    expect(rev.createdBy).toBe(p.users.storekeeper.id);

    const [txn] = await env.db.select().from(storeTxn).where(eq(storeTxn.id, grn.id));
    expect(txn).toMatchObject({ number: "GRN-1", cancelReason: "Wrong item booked", cancelledBy: p.users.storekeeper.id });
    expect(txn!.cancelledAt).toBeInstanceOf(Date);
    expect(txn!.updatedAt).toBeInstanceOf(Date);
    // no new number was taken: the next receipt is GRN-2, and there is no new document row
    expect((await txnRows(p.companyId)).length).toBe(1);
    expect((await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })).number).toBe("GRN-2");
    expect((await auditActions(p.companyId)).filter((a) => a === "store.cancel")).toHaveLength(1);
  });

  test("cancelling an MRS puts the stock back", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const mrs = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 4 * U, purpose: "melt" });
    await p.storekeeper.store.cancel({ txnId: mrs.id, reason: "Not used" });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(10 * U);
    const rows = await ledgerRowsOf(p.companyId, mrs.id);
    expect(rows.find((r) => r.voucherType === "store_mrs_cancel")).toMatchObject({ qtyG: 4 * U });
  });

  test("a GRN cannot be cancelled once its stock was drawn: refused with the shortfall, nothing written", async () => {
    const p = await plant();
    const grn = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const mrs = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 6 * U, purpose: "melt" });
    await expect(p.storekeeper.store.cancel({ txnId: grn.id, reason: "oops" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await storeLedger(p.companyId)).filter((r) => r.reversalOf !== null)).toEqual([]);
    expect((await env.db.select().from(storeTxn).where(eq(storeTxn.id, grn.id)))[0]!.cancelledAt).toBeNull();
    expect((await auditActions(p.companyId)).filter((a) => a === "store.cancel")).toEqual([]);
    // undo the issue first, then the receipt
    await p.storekeeper.store.cancel({ txnId: mrs.id, reason: "undo" });
    await p.storekeeper.store.cancel({ txnId: grn.id, reason: "oops" });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(0);
  });

  test("cancelling either leg of an exchange reverses both legs atomically", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 3 * U });
    const ex = await p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: 2 * U, qtyInMilli: 2 * U });
    await p.storekeeper.store.cancel({ txnId: ex.grnId, reason: "Vendor refused" });
    expect(await ledgerBalance(p.companyId, p.bearingId)).toBe(3 * U);
    const txns = await txnRows(p.companyId);
    for (const id of [ex.mrsId, ex.grnId]) {
      expect(txns.find((t) => t.id === id)!.cancelledAt).toBeInstanceOf(Date);
    }
    const revs = (await storeLedger(p.companyId)).filter((r) => r.reversalOf !== null);
    expect(revs.map((r) => [r.voucherType, r.qtyG]).sort()).toEqual([["store_grn_cancel", -2 * U], ["store_mrs_cancel", 2 * U]]);
    expect((await auditActions(p.companyId)).filter((a) => a === "store.cancel")).toHaveLength(1);
    await expect(p.storekeeper.store.cancel({ txnId: ex.mrsId, reason: "again" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("exchange cancel is guarded on the net: the new items were used, so neither leg is cancelled", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 2 * U });
    const ex = await p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: 2 * U, qtyInMilli: 3 * U }); // balance 3
    await p.storekeeper.store.issue({ itemId: p.bearingId, qtyMilli: 3 * U, purpose: "maintenance" }); // balance 0
    // cancelling would take 3 out and put 2 back: net -1
    await expect(p.storekeeper.store.cancel({ txnId: ex.mrsId, reason: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const txns = await txnRows(p.companyId);
    expect(txns.filter((t) => t.cancelledAt !== null)).toEqual([]);
    expect((await storeLedger(p.companyId)).filter((r) => r.reversalOf !== null)).toEqual([]);
    // one more unit in: net 1 - 3 + 2 = 0, allowed
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: U });
    await p.storekeeper.store.cancel({ txnId: ex.mrsId, reason: "x" });
    expect(await ledgerBalance(p.companyId, p.bearingId)).toBe(0);
  });

  test("cancelling twice is refused; one reversal only", async () => {
    const p = await plant();
    const grn = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U });
    await p.storekeeper.store.cancel({ txnId: grn.id, reason: "a" });
    await expect(p.storekeeper.store.cancel({ txnId: grn.id, reason: "b" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await storeLedger(p.companyId)).filter((r) => r.reversalOf !== null)).toHaveLength(1);
  });

  test("RACE: two concurrent cancels of one GRN produce exactly one reversal", async () => {
    const p = await plant();
    const grn = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U });
    const results = await Promise.allSettled([
      p.storekeeper.store.cancel({ txnId: grn.id, reason: "first" }),
      p.owner.store.cancel({ txnId: grn.id, reason: "second" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "BAD_REQUEST" });
    expect((await storeLedger(p.companyId)).filter((r) => r.reversalOf !== null)).toHaveLength(1);
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(0);
    expect((await auditActions(p.companyId)).filter((a) => a === "store.cancel")).toHaveLength(1);
  });

  test("RACE: the other cancel lands between this one's read and write — the write does not land (MRS and exchange too)", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 5 * U });
    const mrs = await p.storekeeper.store.issue({ itemId: p.bearingId, qtyMilli: 2 * U, purpose: "maintenance" });
    env.beforeNextBatch(() => p.owner.store.cancel({ txnId: mrs.id, reason: "other" }));
    await expect(p.storekeeper.store.cancel({ txnId: mrs.id, reason: "mine" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await storeLedger(p.companyId)).filter((r) => r.reversalOf !== null)).toHaveLength(1);
    expect(await ledgerBalance(p.companyId, p.bearingId)).toBe(5 * U);

    const ex = await p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: U, qtyInMilli: U });
    env.beforeNextBatch(() => p.owner.store.cancel({ txnId: ex.grnId, reason: "other" }));
    await expect(p.storekeeper.store.cancel({ txnId: ex.mrsId, reason: "mine" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await storeLedger(p.companyId)).filter((r) => r.reversalOf !== null)).toHaveLength(3);
  });

  test("RACE: an issue drains the stock after the GRN cancel read the balance — the cancel does not land", async () => {
    const p = await plant();
    const grn = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    env.beforeNextBatch(() => p.owner.store.issue({ itemId: p.fluxId, qtyMilli: 6 * U, purpose: "melt" }));
    await expect(p.storekeeper.store.cancel({ txnId: grn.id, reason: "late" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(4 * U);
    expect((await storeLedger(p.companyId)).filter((r) => r.reversalOf !== null)).toEqual([]);
  });

  test("validation and isolation: reason required, unknown id and other company's id are NOT_FOUND", async () => {
    const a = await plant();
    const b = await plant();
    const grn = await a.storekeeper.store.receive({ itemId: a.fluxId, qtyMilli: U });
    await expect(a.storekeeper.store.cancel({ txnId: grn.id, reason: "  " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.storekeeper.store.cancel({ txnId: grn.id, reason: "x".repeat(501) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(b.storekeeper.store.cancel({ txnId: grn.id, reason: "steal" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(a.storekeeper.store.cancel({ txnId: "nope", reason: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await env.db.select().from(storeTxn).where(eq(storeTxn.id, grn.id)))[0]!.cancelledAt).toBeNull();
  });

  test("txns shows cancelled entries; the ledger still equals the live (uncancelled) projection; params stay <= 100", async () => {
    const p = await plant();
    env.resetPeakParams();
    const g1 = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U });
    const m1 = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 3 * U, purpose: "melt" });
    await p.storekeeper.store.cancel({ txnId: m1.id, reason: "r".repeat(500) });
    await p.storekeeper.store.cancel({ txnId: g1.id, reason: "r" });
    const list = (await p.manager.store.txns({})).items;
    expect(list.find((t) => t.id === g1.id)).toMatchObject({ cancelReason: "r" });
    expect(list.find((t) => t.id === g1.id)!.cancelledAt).toBeInstanceOf(Date);
    expect(list.filter((t) => t.cancelledAt === null)).toHaveLength(1);
    const live = (await txnRows(p.companyId)).filter((t) => t.cancelledAt === null).reduce((s, t) => s + (t.kind === "grn" ? t.qtyMilli : -t.qtyMilli), 0);
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(live);
    expect(await balanceOf(p, p.fluxId)).toBe(5 * U);
    expect(env.peakParams()).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// RP16: unit-safe balances in stock.balance and stock.byLocation
// ---------------------------------------------------------------------------

describe("RP16: stock.balance and stock.byLocation never add grams to milli-units", () => {
  async function stocked() {
    const p = await plant();
    const ldo = await p.storekeeper.store.items.create({ name: "LDO", unit: "litre", category: "fuel" });
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 12_500 }); // 12.5 kg
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 3 * U }); // 3 pieces
    await p.storekeeper.store.receive({ itemId: ldo.id, qtyMilli: 40 * U }); // 40 L
    const storeLoc = (await p.owner.stock.locations.list()).items.find((l) => l.code === "STORE")!;
    return { p, ldoId: ldo.id, storeLoc };
  }

  test("stock.balance: store rows have qtyG null, qtyMilli and unit", async () => {
    const { p, ldoId, storeLoc } = await stocked();
    const res = await p.manager.stock.balance({ itemKind: "store_item", locationId: storeLoc.id });
    const byRef = new Map(res.items.map((r) => [r.itemRef, r]));
    expect(byRef.get(p.fluxId)).toEqual({ itemKind: "store_item", itemRef: p.fluxId, locationId: storeLoc.id, qtyG: null, qtyMilli: 12_500, unit: "kg" });
    expect(byRef.get(p.bearingId)).toMatchObject({ qtyG: null, qtyMilli: 3 * U, unit: "piece" });
    expect(byRef.get(ldoId)).toMatchObject({ qtyG: null, qtyMilli: 40 * U, unit: "litre" });
  });

  test("stock.byLocation: STORE totals carry no grams, only per-unit milli totals", async () => {
    const { p, storeLoc } = await stocked();
    const summary = await p.manager.stock.byLocation();
    const store = summary.locations.find((l) => l.id === storeLoc.id)!;
    const total = store.totals.find((t) => t.itemKind === "store_item")!;
    expect(total).toMatchObject({ itemKind: "store_item", itemCount: 3, qtyG: null });
    if (total.itemKind !== "store_item") throw new Error("expected the store_item total");
    expect([...total.byUnit].sort((a, b) => a.unit.localeCompare(b.unit))).toEqual([
      { unit: "kg", itemCount: 1, qtyMilli: 12_500 },
      { unit: "litre", itemCount: 1, qtyMilli: 40 * U },
      { unit: "piece", itemCount: 1, qtyMilli: 3 * U },
    ]);
  });

  test("Minor 2: store rows are hidden from callers without store.txn, masters.publish or analytics.view", async () => {
    const { p } = await stocked();
    for (const role of ROLES) {
      const sees = ["storekeeper", "manager", "admin", "owner", "office", "accountant"].includes(role);
      const bal = await p[role].stock.balance({ itemKind: "store_item" });
      expect({ role, n: bal.items.length }).toEqual({ role, n: sees ? 3 : 0 });
      const sum = await p[role].stock.byLocation();
      const has = sum.locations.some((l) => l.totals.some((t) => t.itemKind === "store_item"));
      expect({ role, has }).toEqual({ role, has: sees });
    }
  });
});

// ---------------------------------------------------------------------------
// RP17: draw builder for a cast batch
// ---------------------------------------------------------------------------

describe("RP17: store draws inside another document's batch (lib/store)", () => {
  async function libParts(p: Plant) {
    const lib = await import("../src/lib/store");
    const { atomicBatch } = await import("../src/lib/atomic");
    const { auditInsert } = await import("../src/lib/audit");
    const { nextCompanySeq } = await import("../src/lib/sequence");
    const userId = p.users.foundry.id;
    const prep = async (draws: { itemId: string; qtyMilli: number }[], castId: string) => {
      const seq = await nextCompanySeq({ db: env.db }, p.companyId);
      const audit = { db: env.db, companyId: p.companyId, session: { user: { id: userId } } as never, impersonation: null };
      const prepared = await lib.prepareStoreDraws(env.db, {
        companyId: p.companyId, userId, seq, at: new Date(), audit,
        draws: draws.map((d) => ({ ...d, purpose: "melt" as const, refId: castId })),
      });
      return { prepared, seq, audit };
    };
    const run = async (draws: { itemId: string; qtyMilli: number }[], castId: string) => {
      const { prepared, audit } = await prep(draws, castId);
      try {
        await atomicBatch(env.db, [
          ...prepared.statements,
          // the dependent document: only exists if every draw landed
          auditInsert(audit, { action: "dummy.cast", subjectType: "cast", subjectId: castId }),
        ]);
      } catch (e) {
        if (lib.isStoreDrawAbort(e)) await prepared.explain();
        throw e;
      }
      return prepared;
    };
    return { lib, run, prep };
  }
  const dummyCasts = async (companyId: string) =>
    (await env.db.select().from(auditLog).where(eq(auditLog.companyId, companyId))).filter((r) => r.action === "dummy.cast");

  test("covered draws land with the dependent row: txn (melt, refId = cast), ledger, MRS numbers in order", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 4 * U });
    const { run } = await libParts(p);
    const prepared = await run([{ itemId: p.fluxId, qtyMilli: 6 * U }, { itemId: p.bearingId, qtyMilli: 2 * U }], "cast-K32");
    expect(prepared.numbers).toEqual(["MRS-1", "MRS-2"]);
    const txns = (await txnRows(p.companyId)).filter((t) => t.kind === "mrs");
    expect(txns.map((t) => [t.purpose, t.refId]).sort()).toEqual([["melt", "cast-K32"], ["melt", "cast-K32"]]);
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(4 * U);
    expect(await ledgerBalance(p.companyId, p.bearingId)).toBe(2 * U);
    expect(await dummyCasts(p.companyId)).toHaveLength(1);
  });

  test("a refused draw fails the WHOLE batch: no dependent row, no txn, no ledger, no audit, and it explains why", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 1 * U });
    const { run, prep } = await libParts(p);
    // pre-check already refuses: thrown from prepare, nothing allocated
    await expect(prep([{ itemId: p.bearingId, qtyMilli: 2 * U }], "cast-1")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // two draws of the same item that together overdraw: the pre-check adds them up
    await expect(run([{ itemId: p.fluxId, qtyMilli: 6 * U }, { itemId: p.fluxId, qtyMilli: 6 * U }], "cast-2")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await dummyCasts(p.companyId)).toEqual([]);
    expect((await txnRows(p.companyId)).filter((t) => t.kind === "mrs")).toEqual([]);
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(10 * U);
    expect((await auditActions(p.companyId)).filter((a) => a === "store.issue")).toEqual([]);
  });

  test("RACE: another issue drains the stock after prepare — the cast batch fails whole", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const { run } = await libParts(p);
    env.beforeNextBatch(() => p.owner.store.issue({ itemId: p.fluxId, qtyMilli: 8 * U, purpose: "other" }));
    await expect(run([{ itemId: p.fluxId, qtyMilli: 6 * U }], "cast-3")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await dummyCasts(p.companyId)).toEqual([]);
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(2 * U);
  });

  test("validation through the lib: retired item, whole pieces, missing store location, other company's item", async () => {
    const p = await plant();
    const q = await plant();
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 4 * U });
    const { prep } = await libParts(p);
    await expect(prep([{ itemId: p.bearingId, qtyMilli: 500 }], "c")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(prep([{ itemId: q.fluxId, qtyMilli: U }], "c")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(prep([{ itemId: p.fluxId, qtyMilli: 0 }], "c")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const none = await plant({ locations: false });
    const { prep: prepNone } = await libParts(none);
    await expect(prepNone([{ itemId: none.fluxId, qtyMilli: U }], "c")).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("store location") });
  });
});

// ---------------------------------------------------------------------------
// RP18: clientRequestId
// ---------------------------------------------------------------------------

describe("RP18: clientRequestId makes receive, issue and exchange idempotent", () => {
  test("a double submit returns the original and posts once, taking no second number", async () => {
    const p = await plant();
    const a = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U, clientRequestId: "req-1" });
    const b = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U, clientRequestId: "req-1" });
    expect(b).toMatchObject({ id: a.id, number: a.number });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(5 * U);
    expect((await txnRows(p.companyId)).length).toBe(1);
    expect((await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })).number).toBe("GRN-2");

    const i1 = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 2 * U, purpose: "melt", clientRequestId: "req-2" });
    const i2 = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 2 * U, purpose: "melt", clientRequestId: "req-2" });
    expect(i2).toMatchObject({ id: i1.id, number: i1.number });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(4 * U);
  });

  test("exchange replays return both legs", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 3 * U });
    const e1 = await p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: U, qtyInMilli: 2 * U, clientRequestId: "ex-1" });
    const e2 = await p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: U, qtyInMilli: 2 * U, clientRequestId: "ex-1" });
    expect(e2).toMatchObject({ exchangeId: e1.exchangeId, mrsId: e1.mrsId, grnId: e1.grnId, mrsNumber: e1.mrsNumber, grnNumber: e1.grnNumber });
    expect(await ledgerBalance(p.companyId, p.bearingId)).toBe(4 * U);
  });

  test("a replay of a refused-then-fixed or different request under the same id is a CONFLICT, not a silent return", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U, clientRequestId: "req-x" });
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 6 * U, clientRequestId: "req-x" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 5 * U, purpose: "melt", clientRequestId: "req-x" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("ids are scoped per company; ids are validated (1..64)", async () => {
    const a = await plant();
    const b = await plant();
    const ra = await a.storekeeper.store.receive({ itemId: a.fluxId, qtyMilli: U, clientRequestId: "same" });
    const rb = await b.storekeeper.store.receive({ itemId: b.fluxId, qtyMilli: U, clientRequestId: "same" });
    expect(ra.id).not.toBe(rb.id);
    await expect(a.storekeeper.store.receive({ itemId: a.fluxId, qtyMilli: U, clientRequestId: "x".repeat(65) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(a.storekeeper.store.receive({ itemId: a.fluxId, qtyMilli: U, clientRequestId: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("RACE: a concurrent double submit posts once; both calls return the same entry", async () => {
    const p = await plant();
    const [a, b] = await Promise.all([
      p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U, clientRequestId: "dbl" }),
      p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U, clientRequestId: "dbl" }),
    ]);
    expect(a.id).toBe(b.id);
    expect((await txnRows(p.companyId)).length).toBe(1);
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(5 * U);
    expect((await auditActions(p.companyId)).filter((x) => x === "store.receive")).toHaveLength(1);
  });

  test("RACE: the same request lands between this one's lookup and write (issue and exchange) — the loser returns the original", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 5 * U });
    const first = { itemId: p.fluxId, qtyMilli: 3 * U, purpose: "melt" as const, clientRequestId: "r-i" };
    env.beforeNextBatch(() => p.storekeeper.store.issue(first));
    const lost = await p.storekeeper.store.issue(first);
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(7 * U);
    expect((await txnRows(p.companyId)).filter((t) => t.id === lost.id)).toHaveLength(1);

    const ex = { itemId: p.bearingId, qtyOutMilli: U, qtyInMilli: U, clientRequestId: "r-e" };
    env.beforeNextBatch(() => p.storekeeper.store.exchange(ex));
    const lostEx = await p.storekeeper.store.exchange(ex);
    expect(lostEx.mrsNumber).toBeTruthy();
    expect((await txnRows(p.companyId)).filter((t) => t.exchangeId === lostEx.exchangeId)).toHaveLength(2);
    expect(await ledgerBalance(p.companyId, p.bearingId)).toBe(5 * U);
  });
});
