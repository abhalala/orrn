/**
 * PL-7: central store — items, GRN receipts, MRS issues, old-for-new exchanges, balances
 * (spec P17, digest Stage 18). The headline rule: an issue can never take a balance negative,
 * even when two issues race (the balance check is inside the guarded INSERT).
 *
 * Store quantities are integer milli-units (`qty_milli`; 1000 = 1 unit of the item's unit) and
 * ride the ledger's generic `qty_g` column for item_kind `store_item` at the STORE location.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { auditLog, stockLedger, storeItem, storeTxn, user } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { can as canMe, type Action } from "../src/lib/permissions";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

// A test that times out makes bun kill the miniflare worker it spawned, and every later test in the
// file then fails to connect. 115 tests on a machine shared by five heavy runs: give each room.
setDefaultTimeout(30_000);

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

  test("an issue cannot race a retire: the retire is refused while the item holds stock, and the issue lands", async () => {
    // (The receive-side race, where a retire at 0 does land, is in store.receive.)
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    let retire: unknown = null;
    env.beforeNextBatch(async () => {
      retire = await p.manager.store.items.update({ id: p.fluxId, active: false }).catch((e: unknown) => e);
    });
    const mrs = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "melt" });
    expect(retire).toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("still has stock") });
    expect(mrs.number).toBe("MRS-1");
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(9 * U);
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
  }, 60_000);

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

type Draw = { itemId: string; qtyMilli: number; refId?: string | null; note?: string | null };
type DrawExtra = { source?: { type: string; id: string } };

/** prepareStoreDraws as a cast would call it, plus a dependent "cast" row (an audit row) in the same batch. */
async function libParts(p: Plant) {
  const lib = await import("../src/lib/store");
  const { atomicBatch } = await import("../src/lib/atomic");
  const { auditInsert } = await import("../src/lib/audit");
  const { nextCompanySeq } = await import("../src/lib/sequence");
  const userId = p.users.foundry.id;
  const prep = async (draws: Draw[], castId: string, extra: DrawExtra = {}) => {
    const seq = await nextCompanySeq({ db: env.db }, p.companyId);
    const audit = { db: env.db, companyId: p.companyId, session: { user: { id: userId } } as never, impersonation: null };
    const prepared = await lib.prepareStoreDraws(env.db, {
      companyId: p.companyId, userId, seq, at: new Date(), audit, ...extra,
      draws: draws.map((d) => ({ purpose: "melt" as const, refId: castId, ...d })),
    });
    return { prepared, seq, audit };
  };
  const run = async (draws: Draw[], castId: string, extra: DrawExtra = {}) => {
    const { prepared, audit } = await prep(draws, castId, extra);
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
  return { lib, run, prep, atomicBatch, nextCompanySeq };
}

const dummyCasts = async (companyId: string) =>
  (await env.db.select().from(auditLog).where(eq(auditLog.companyId, companyId))).filter((r) => r.action === "dummy.cast");

const storeLoc = async (p: Plant) => (await p.owner.stock.locations.list()).items.find((l) => l.code === "STORE")!;

async function audits(companyId: string, action: string) {
  return (await env.db.select().from(auditLog).where(eq(auditLog.companyId, companyId))).filter((r) => r.action === action);
}

describe("RP17: store draws inside another document's batch (lib/store)", () => {
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
    // retired item (retired at 0, as the rule allows)
    await p.manager.store.items.update({ id: p.fluxId, active: false });
    await expect(prep([{ itemId: p.fluxId, qtyMilli: U }], "c")).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("retired") });
  });

  test("a draw refused at WRITE time (not by the prepare check) fails the whole batch and explain() names the item", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 2 * U });
    const { run } = await libParts(p);
    // After prepare: the bearings are issued and the item retired, while the flux still covers its draw.
    env.beforeNextBatch(async () => {
      await p.owner.store.issue({ itemId: p.bearingId, qtyMilli: 2 * U, purpose: "maintenance" });
      await p.manager.store.items.update({ id: p.bearingId, active: false });
    });
    await expect(run([{ itemId: p.fluxId, qtyMilli: 3 * U }, { itemId: p.bearingId, qtyMilli: U }], "cast-9")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Roller bearing 6205 is retired"),
    });
    expect(await dummyCasts(p.companyId)).toEqual([]);
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(10 * U); // the flux draw that fitted did not land either
    expect((await txnRows(p.companyId)).filter((t) => t.purpose === "melt")).toEqual([]);
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

// ---------------------------------------------------------------------------
// PL7RR round 1: defects (each failed before the fix)
// ---------------------------------------------------------------------------

describe("PL7RR r1: cancels respect retirement, the actor FK, and draws belong to their document", () => {
  test("cancelling an MRS is refused while the item is retired (a retired item holds 0); reactivate, then it cancels", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U });
    const mrs = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 5 * U, purpose: "melt" });
    await p.manager.store.items.update({ id: p.fluxId, active: false }); // allowed: balance is 0
    await expect(p.storekeeper.store.cancel({ txnId: mrs.id, reason: "undo" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cover flux is retired; reactivate it before cancelling MRS-1",
    });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(0);
    expect((await txnRows(p.companyId)).find((t) => t.id === mrs.id)!.cancelledAt).toBeNull();
    expect(await audits(p.companyId, "store.cancel")).toEqual([]);
    await p.manager.store.items.update({ id: p.fluxId, active: true });
    await p.storekeeper.store.cancel({ txnId: mrs.id, reason: "undo" });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(5 * U);
  });

  test("cancelling an MRS is refused while its STORE location is retired (a retired location holds nothing)", async () => {
    const p = await plant();
    const loc = await storeLoc(p);
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U });
    const mrs = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 5 * U, purpose: "melt" });
    await p.manager.stock.locations.update({ id: loc.id, active: false }); // allowed: location is empty
    // a new store location exists, but the reversal belongs where the stock left from
    await p.owner.stock.locations.create({ code: "S2", name: "New store", kind: "store" });
    await expect(p.storekeeper.store.cancel({ txnId: mrs.id, reason: "undo" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Store location STORE of MRS-1 is retired or no longer a store; reactivate it before cancelling",
    });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(0);
    expect((await storeLedger(p.companyId)).filter((r) => r.reversalOf !== null)).toEqual([]);
  });

  test("RACE: the item is retired between the cancel's read and write — no reversal lands, and the refusal says why", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U });
    const mrs = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 5 * U, purpose: "melt" });
    env.beforeNextBatch(() => p.manager.store.items.update({ id: p.fluxId, active: false }));
    await expect(p.storekeeper.store.cancel({ txnId: mrs.id, reason: "undo" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("reactivate"),
    });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(0);
  });

  test("a GRN cancel on a retired item names the shortfall (reactivating cannot help)", async () => {
    const p = await plant();
    const grn = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U });
    await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 5 * U, purpose: "melt" });
    await p.manager.store.items.update({ id: p.fluxId, active: false });
    await expect(p.storekeeper.store.cancel({ txnId: grn.id, reason: "undo" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("only 0 is in the store"),
    });
  });

  test("a user who cancelled a store entry can still be deleted (cancelled_by is ON DELETE SET NULL like created_by)", async () => {
    const p = await plant();
    const grn = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U });
    await p.storekeeper.store.cancel({ txnId: grn.id, reason: "x" });
    await env.db.delete(user).where(eq(user.id, p.users.storekeeper.id));
    const [t] = await env.db.select().from(storeTxn).where(eq(storeTxn.id, grn.id));
    expect(t!.cancelledBy).toBeNull();
    expect(t!.createdBy).toBeNull();
    expect(t!.cancelledAt).toBeInstanceOf(Date);
  });

  test("store.cancel refuses an MRS drawn inside a melt's batch; the melt reverses its own draw with the exported builders", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const { run, lib, atomicBatch, nextCompanySeq } = await libParts(p);
    const prepared = await run([{ itemId: p.fluxId, qtyMilli: 6 * U }], "cast-K32", { source: { type: "melt", id: "melt-1" } });
    const drawId = prepared.ids[0]!;
    expect((await txnRows(p.companyId)).find((t) => t.id === drawId)).toMatchObject({
      purpose: "melt",
      refId: "cast-K32",
      sourceType: "melt",
      sourceId: "melt-1",
    });
    await expect(p.storekeeper.store.cancel({ txnId: drawId, reason: "mistake" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "MRS-1 belongs to a melt; cancel the melt instead",
    });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(4 * U);
    expect((await storeLedger(p.companyId)).filter((r) => r.reversalOf !== null)).toEqual([]);
    // store.txns shows where the entry came from, so the screen can offer "open the melt" instead of Cancel
    expect((await p.manager.store.txns({})).items.find((t) => t.id === drawId)).toMatchObject({ sourceType: "melt", sourceId: "melt-1" });

    const seq = await nextCompanySeq({ db: env.db }, p.companyId);
    const input = { companyId: p.companyId, seq, txnId: drawId, exchangeId: null, userId: p.users.foundry.id, at: new Date(), reason: "Melt cancelled" };
    await atomicBatch(env.db, [lib.storeCancelRows(env.db, input), lib.storeCancelMark(env.db, input)]);
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(10 * U);
    expect((await txnRows(p.companyId)).find((t) => t.id === drawId)!.cancelledAt).toBeInstanceOf(Date);
  });

  test("draws are marked even without an explicit source (purpose and refId name the document); store-screen issues are not", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const { run } = await libParts(p);
    const prepared = await run([{ itemId: p.fluxId, qtyMilli: U }], "cast-K1");
    const manual = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "melt", refId: "cast-K1" });
    const rows = await txnRows(p.companyId);
    expect(rows.find((t) => t.id === prepared.ids[0])).toMatchObject({ sourceType: "melt", sourceId: "cast-K1" });
    expect(rows.find((t) => t.id === manual.id)).toMatchObject({ sourceType: null, sourceId: null });
    await expect(p.storekeeper.store.cancel({ txnId: prepared.ids[0]!, reason: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.storekeeper.store.cancel({ txnId: manual.id, reason: "x" });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(9 * U);
  });

  test("diagnoseStoreCancel explains a lost reversal for a parent document's cancel (retired item)", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 4 * U });
    const { run, lib, atomicBatch, nextCompanySeq } = await libParts(p);
    const prepared = await run([{ itemId: p.fluxId, qtyMilli: 4 * U }], "cast-K2", { source: { type: "melt", id: "melt-2" } });
    await p.manager.store.items.update({ id: p.fluxId, active: false });
    const seq = await nextCompanySeq({ db: env.db }, p.companyId);
    const input = { companyId: p.companyId, seq, txnId: prepared.ids[0]!, exchangeId: null, userId: null, at: new Date(), reason: "Melt cancelled" };
    await atomicBatch(env.db, [lib.storeCancelRows(env.db, input), lib.storeCancelMark(env.db, input)]);
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(0); // nothing landed
    expect(await lib.diagnoseStoreCancel(env.db, p.companyId, prepared.ids[0]!)).toMatchObject({
      code: "BAD_REQUEST",
      message: "Cover flux is retired; reactivate it before cancelling MRS-1",
    });
  });

  test("a replay after the entry was cancelled says cancelled: true (an offline retry must not report the stock as in)", async () => {
    const p = await plant();
    const r = { itemId: p.fluxId, qtyMilli: 5 * U, clientRequestId: "rc" };
    const first = await p.storekeeper.store.receive(r);
    expect(first).toMatchObject({ replayed: false, cancelled: false });
    expect(await p.storekeeper.store.receive(r)).toMatchObject({ id: first.id, replayed: true, cancelled: false });
    await p.storekeeper.store.cancel({ txnId: first.id, reason: "wrong truck" });
    expect(await p.storekeeper.store.receive(r)).toMatchObject({ id: first.id, number: "GRN-1", replayed: true, cancelled: true });

    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 5 * U });
    const i = { itemId: p.bearingId, qtyMilli: U, purpose: "maintenance" as const, clientRequestId: "rc-i" };
    const mrs = await p.storekeeper.store.issue(i);
    expect(mrs).toMatchObject({ replayed: false, cancelled: false });
    await p.storekeeper.store.cancel({ txnId: mrs.id, reason: "x" });
    expect(await p.storekeeper.store.issue(i)).toMatchObject({ id: mrs.id, replayed: true, cancelled: true });

    const e = { itemId: p.bearingId, qtyOutMilli: U, qtyInMilli: U, clientRequestId: "rc-e" };
    const ex = await p.storekeeper.store.exchange(e);
    expect(ex).toMatchObject({ replayed: false, cancelled: false });
    expect(await p.storekeeper.store.exchange(e)).toMatchObject({ mrsId: ex.mrsId, replayed: true, cancelled: false });
    await p.storekeeper.store.cancel({ txnId: ex.grnId, reason: "x" });
    expect(await p.storekeeper.store.exchange(e)).toMatchObject({ mrsId: ex.mrsId, replayed: true, cancelled: true });
  });

  test("prepareStoreDraws caps refId (64), note (500) and the source (no zod in front of a cast); refusals take no number", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const { prep, run } = await libParts(p);
    await expect(prep([{ itemId: p.fluxId, qtyMilli: U, refId: "r".repeat(65) }], "c")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(prep([{ itemId: p.fluxId, qtyMilli: U, note: "n".repeat(501) }], "c")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(prep([{ itemId: p.fluxId, qtyMilli: U }], "c", { source: { type: "melt", id: "m".repeat(65) } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(prep([{ itemId: p.fluxId, qtyMilli: U }], "c", { source: { type: "Melt K32!", id: "m" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(prep([{ itemId: p.fluxId, qtyMilli: U }], "c", { source: { type: "melt", id: "" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    env.resetPeakParams();
    const ok = await run([{ itemId: p.fluxId, qtyMilli: U, refId: "r".repeat(64), note: "n".repeat(500) }], "c", { source: { type: "nitriding", id: "x".repeat(64) } });
    expect(ok.numbers).toEqual(["MRS-1"]);
    expect(env.peakParams()).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// PL7RR round 1: guards the mutation review found unpinned (each test fails with its mutation)
// ---------------------------------------------------------------------------

describe("gaps: draws for another document's batch (RP17)", () => {
  test("[L47] RACE: two draws of one item that each fit the drained balance alone but not together — the second sees the first", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const { run } = await libParts(p);
    env.beforeNextBatch(() => p.owner.store.issue({ itemId: p.fluxId, qtyMilli: 6 * U, purpose: "other" })); // balance 4
    await expect(run([{ itemId: p.fluxId, qtyMilli: 3 * U }, { itemId: p.fluxId, qtyMilli: 3 * U }], "cast-4")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(4 * U); // never -2
    expect(await dummyCasts(p.companyId)).toEqual([]);
  });

  test("[L44] at most 40 draws per document; 40 fit in 100 bound parameters", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 100 * U });
    const { run, prep } = await libParts(p);
    await expect(prep(Array.from({ length: 41 }, () => ({ itemId: p.fluxId, qtyMilli: U })), "c41")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    env.resetPeakParams();
    const prepared = await run(Array.from({ length: 40 }, () => ({ itemId: p.fluxId, qtyMilli: U })), "c40");
    expect(prepared.numbers).toHaveLength(40);
    expect(prepared.numbers[39]).toBe("MRS-40"); // the refused 41 took no numbers
    expect(env.peakParams()).toBeLessThanOrEqual(100);
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(60 * U);
  }, 30_000);

  test("[L48] every landed draw writes its store.issue audit row", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const { run } = await libParts(p);
    const prepared = await run([{ itemId: p.fluxId, qtyMilli: 2 * U }, { itemId: p.fluxId, qtyMilli: 3 * U }], "cast-a");
    const rows = await audits(p.companyId, "store.issue");
    expect(rows.map((r) => r.subjectId).sort()).toEqual([...prepared.ids].sort());
    expect(rows.map((r) => (r.meta as { number: string }).number).sort()).toEqual(["MRS-1", "MRS-2"]);
  });

  test("[L49] a draw refused at write time explains itself with the balance that is left", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const { run } = await libParts(p);
    env.beforeNextBatch(() => p.owner.store.issue({ itemId: p.fluxId, qtyMilli: 8 * U, purpose: "other" }));
    await expect(run([{ itemId: p.fluxId, qtyMilli: 6 * U }], "cast-m")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Only 2 kg of Cover flux in the store",
    });
  });

  test("[L46] a composite draw the prepare check refuses takes no MRS numbers (draws of one item are added up)", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const { run } = await libParts(p);
    await expect(run([{ itemId: p.fluxId, qtyMilli: 6 * U }, { itemId: p.fluxId, qtyMilli: 6 * U }], "cast-5")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "melt" })).number).toBe("MRS-1");
  });

  test("[L7/L9] the lib itself rejects fractional milli-units and quantities over the cap", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 100_000_000 });
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U });
    const { prep } = await libParts(p);
    await expect(prep([{ itemId: p.fluxId, qtyMilli: 1.5 }], "c")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(prep([{ itemId: p.fluxId, qtyMilli: 100_000_001 }], "c")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("[L44b] no draws at all is a programming error (callers skip the call), not an empty batch", async () => {
    const p = await plant();
    const { prep } = await libParts(p);
    await expect(prep([], "c")).rejects.toThrow("No store draws");
  });
});

describe("gaps: clientRequestId (RP18)", () => {
  test("[R10b] the same request id with another ITEM (same kind and qty) is a CONFLICT, never the other entry", async () => {
    const p = await plant();
    const a = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U, clientRequestId: "k1" });
    await expect(p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 5 * U, clientRequestId: "k1" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await txnRows(p.companyId)).map((t) => t.id)).toEqual([a.id]);
  });

  test("[R10a] a receive that reuses an issue's request id (same item, same qty) is a CONFLICT, not the issue returned as a receipt", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 2 * U, purpose: "melt", clientRequestId: "k6" });
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 2 * U, clientRequestId: "k6" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("[R10d] the same request id with another PURPOSE is a CONFLICT", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 2 * U, purpose: "melt", clientRequestId: "k2" });
    await expect(p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 2 * U, purpose: "maintenance", clientRequestId: "k2" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await ledgerBalance(p.companyId, p.fluxId)).toBe(8 * U);
  });

  test("[R11] exchange replays with another out or in quantity, or as an issue, are a CONFLICT", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 5 * U });
    await p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: U, qtyInMilli: 2 * U, clientRequestId: "k3" });
    await expect(p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: 2 * U, qtyInMilli: 2 * U, clientRequestId: "k3" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: U, qtyInMilli: 3 * U, clientRequestId: "k3" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p.storekeeper.store.issue({ itemId: p.bearingId, qtyMilli: U, purpose: "other", clientRequestId: "k3" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("[R51/R52] a replay of an issue or an exchange takes no MRS/GRN number", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U }); // GRN-1
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 5 * U }); // GRN-2
    const i = { itemId: p.fluxId, qtyMilli: U, purpose: "melt" as const, clientRequestId: "k4" };
    await p.storekeeper.store.issue(i); // MRS-1
    await p.storekeeper.store.issue(i); // replay
    expect((await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "melt" })).number).toBe("MRS-2");
    const e = { itemId: p.bearingId, qtyOutMilli: U, qtyInMilli: U, clientRequestId: "k5" };
    const first = await p.storekeeper.store.exchange(e); // MRS-3 / GRN-3
    await p.storekeeper.store.exchange(e); // replay
    expect(first).toMatchObject({ mrsNumber: "MRS-3", grnNumber: "GRN-3" });
    expect((await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "melt" })).number).toBe("MRS-4");
    expect((await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })).number).toBe("GRN-4");
  });

  test("[N3] the first call says replayed: false, the repeat says replayed: true (a client shows 'already saved')", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const r = { itemId: p.fluxId, qtyMilli: U, clientRequestId: "rp" };
    expect(await p.storekeeper.store.receive(r)).toMatchObject({ replayed: false });
    expect(await p.storekeeper.store.receive(r)).toMatchObject({ replayed: true });
    const i = { itemId: p.fluxId, qtyMilli: U, purpose: "melt" as const, clientRequestId: "rp2" };
    expect(await p.storekeeper.store.issue(i)).toMatchObject({ replayed: false });
    expect(await p.storekeeper.store.issue(i)).toMatchObject({ replayed: true });
  });
});

describe("gaps: refusals explain themselves and burn no numbers", () => {
  test("[R16/R17] a refused issue or exchange takes no MRS/GRN number (the read check runs before the number is taken)", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U }); // GRN-1
    await expect(p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 6 * U, purpose: "melt" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.storekeeper.store.exchange({ itemId: p.fluxId, qtyOutMilli: 6 * U, qtyInMilli: U })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "melt" })).number).toBe("MRS-1");
    expect((await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })).number).toBe("GRN-2");
  });

  test("[R17b] exchange: the incoming quantity of a countable item must be a whole number too", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 5 * U });
    await expect(p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: U, qtyInMilli: 2_500 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await txnRows(p.companyId)).filter((t) => t.exchangeId !== null)).toEqual([]);
  });

  test("[L6] a retired item says so and takes no number", async () => {
    const p = await plant();
    await p.manager.store.items.update({ id: p.fluxId, active: false });
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Cover flux is retired" });
    expect((await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: U })).number).toBe("GRN-1");
  });

  test("[L13] RACE: the item is retired between read and write — the refusal says it is retired", async () => {
    const p = await plant();
    env.beforeNextBatch(() => p.manager.store.items.update({ id: p.fluxId, active: false }));
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Cover flux is retired" });
  });

  test("[L14/L22] RACE: the item's unit changes between read and write — the receipt does not land and says to open it again", async () => {
    const p = await plant();
    env.beforeNextBatch(() => p.manager.store.items.update({ id: p.fluxId, unit: "piece" })); // no movement yet: allowed
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 2_500 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cover flux changed; open it again",
    });
    expect(await txnRows(p.companyId)).toEqual([]);
    expect(await storeLedger(p.companyId)).toEqual([]);
  });

  test("[R22] a GRN cancel refused for a short balance names the shortfall (retrying cannot help)", async () => {
    const p = await plant();
    const grn = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 6 * U, purpose: "melt" });
    await expect(p.storekeeper.store.cancel({ txnId: grn.id, reason: "oops" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cannot cancel GRN-1: 10 kg of Cover flux would have to come out, but only 4 is in the store",
    });
  });

  test("[R22b] RACE: a cancel that lost to another cancel says it was already cancelled", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    const mrs = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 2 * U, purpose: "melt" });
    env.beforeNextBatch(() => p.owner.store.cancel({ txnId: mrs.id, reason: "other" }));
    await expect(p.storekeeper.store.cancel({ txnId: mrs.id, reason: "mine" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "MRS-1 was already cancelled",
    });
  });
});

describe("gaps: resolver, clock, ordering, caps", () => {
  test("[L37] cancelling in the same millisecond still posts the reversal strictly after the original", async () => {
    const p = await plant();
    setClock(new Date("2027-01-15T10:00:00Z"));
    const grn = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U });
    await p.storekeeper.store.cancel({ txnId: grn.id, reason: "same tick" });
    const rows = await ledgerRowsOf(p.companyId, grn.id);
    const orig = rows.find((r) => r.voucherType === "store_grn")!;
    const rev = rows.find((r) => r.voucherType === "store_grn_cancel")!;
    expect(rev.postedAt.getTime()).toBe(orig.postedAt.getTime() + 1);
  });

  test("[L53b/L53d] the document row and the cancel's reversal row take created_at from the injected clock", async () => {
    const p = await plant();
    const t1 = new Date("2027-01-15T10:00:00Z");
    const t2 = new Date("2027-01-15T11:00:00Z");
    setClock(t1);
    const grn = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U });
    expect((await txnRows(p.companyId))[0]!.createdAt.getTime()).toBe(t1.getTime());
    setClock(t2);
    await p.storekeeper.store.cancel({ txnId: grn.id, reason: "later" });
    const rev = (await storeLedger(p.companyId, p.fluxId)).find((r) => r.voucherType === "store_grn_cancel")!;
    expect(rev.createdAt.getTime()).toBe(t2.getTime());
    expect(rev.postedAt.getTime()).toBe(t2.getTime());
  });

  test("[R27] txns are newest first by the entry's own time", async () => {
    const p = await plant();
    setClock(new Date("2027-01-15T12:00:00Z"));
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 9 * U }); // GRN-1, the LATER clock time
    setClock(new Date("2027-01-15T10:00:00Z"));
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U }); // GRN-2, earlier clock time, later in real time
    expect((await p.manager.store.txns({})).items.map((t) => t.number)).toEqual(["GRN-1", "GRN-2"]);
    setClock(new Date("2027-01-15T12:00:00Z"));
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U }); // GRN-3, same instant as GRN-1
    expect((await p.manager.store.txns({ kind: "grn" })).items.map((t) => t.number)).toEqual(["GRN-3", "GRN-1", "GRN-2"]);
  });

  test("[R23] balances hide a retired item that holds no stock", async () => {
    const p = await plant();
    await p.manager.store.items.update({ id: p.fluxId, active: false });
    const ids = (await p.storekeeper.store.balances()).items.map((i) => i.id);
    expect(ids).toContain(p.bearingId);
    expect(ids).not.toContain(p.fluxId);
  });

  test("[R28/R29] items.list and balances are ordered by name", async () => {
    const p = await plant();
    await p.storekeeper.store.items.create({ name: "Zinc", unit: "kg", category: "chemical" });
    await p.storekeeper.store.items.create({ name: "Alum cleaner", unit: "kg", category: "chemical" });
    const names = ["Alum cleaner", "Cover flux", "Roller bearing 6205", "Zinc"];
    expect((await p.viewer.store.items.list()).items.map((i) => i.name)).toEqual(names);
    expect((await p.manager.store.balances()).items.map((i) => i.name)).toEqual(names);
  });

  test("[R38/R40/R41] input caps, one character over: item name 100, GRN reference 60, issue reference 64", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U });
    await expect(p.manager.store.items.create({ name: "n".repeat(101), unit: "kg", category: "other" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U, grnRef: "r".repeat(61) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "melt", refId: "i".repeat(65) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await p.manager.store.items.create({ name: "n".repeat(100), unit: "kg", category: "other" })).id).toBeTruthy();
  });

  test("[R62] notes are trimmed; a blank note is stored as null", async () => {
    const p = await plant();
    const a = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U, note: "  Truck 4471  " });
    const b = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U, note: "   " });
    const rows = await txnRows(p.companyId);
    expect(rows.find((t) => t.id === a.id)!.note).toBe("Truck 4471");
    expect(rows.find((t) => t.id === b.id)!.note).toBeNull();
  });

  test("[N1] an update that changes nothing writes no audit row", async () => {
    const p = await plant();
    await p.manager.store.items.update({ id: p.fluxId });
    expect(await audits(p.companyId, "store_item.update")).toEqual([]);
  });

  test("[N2/R22c/R22d] audit rows and results carry the evidence: number, item, quantity, reason, both exchange legs", async () => {
    const p = await plant();
    const grn = await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 3 * U, grnRef: "CH-1" });
    expect(grn.number).toBe("GRN-1");
    expect((await audits(p.companyId, "store.receive"))[0]!.meta).toMatchObject({ number: "GRN-1", itemId: p.bearingId, qtyMilli: 3 * U, grnRef: "CH-1" });
    const ex = await p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: U, qtyInMilli: U });
    const out = await p.storekeeper.store.cancel({ txnId: ex.mrsId, reason: "wrong bearing" });
    expect([...out.cancelledIds].sort()).toEqual([ex.mrsId, ex.grnId].sort());
    const [cancelAudit] = await audits(p.companyId, "store.cancel");
    expect(cancelAudit!.meta).toMatchObject({ reason: "wrong bearing", kind: "mrs" });
    expect((cancelAudit!.meta as { legs: { id: string }[] }).legs.map((l) => l.id).sort()).toEqual([ex.mrsId, ex.grnId].sort());
  });

  test("[L2] a retired STORE location is ignored: with a new active store location, receipts and balances use it", async () => {
    const p = await plant();
    const old = await storeLoc(p);
    await p.manager.stock.locations.update({ id: old.id, active: false }); // empty: allowed
    await p.owner.stock.locations.create({ code: "S2", name: "New store", kind: "store" });
    const s2 = (await p.owner.stock.locations.list()).items.find((l) => l.code === "S2")!;
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U });
    expect((await storeLedger(p.companyId, p.fluxId)).map((r) => r.locationId)).toEqual([s2.id]);
    expect((await p.manager.store.balances()).locationId).toBe(s2.id);
  });

  test("[L2b] with the only store location retired, writes say to add one", async () => {
    const p = await plant();
    await p.manager.stock.locations.update({ id: (await storeLoc(p)).id, active: false });
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("store location") });
  });

  test("[L24] RACE: the STORE location is re-typed between read and write — nothing lands", async () => {
    const p = await plant();
    const loc = await storeLoc(p);
    env.beforeNextBatch(() => p.manager.stock.locations.update({ id: loc.id, kind: "yard" })); // empty: allowed
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("store location") });
    expect(await txnRows(p.companyId)).toEqual([]);
    expect(await storeLedger(p.companyId)).toEqual([]);
  });

  test("[L3/L4 · minor 4] with a second store location that sorts first, balances and writes use the one coded STORE", async () => {
    const p = await plant();
    const main = await storeLoc(p);
    await p.owner.stock.locations.create({ code: "AAA", name: "Annex", kind: "store", sortOrder: 0 });
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U });
    expect((await storeLedger(p.companyId, p.fluxId)).map((r) => r.locationId)).toEqual([main.id]);
    const b = await p.manager.store.balances();
    expect(b.locationId).toBe(main.id);
    expect(b.items.find((i) => i.id === p.fluxId)!.balanceMilli).toBe(5 * U);
  });

  test("[L4] several store locations and none coded STORE: reads and writes say so", async () => {
    const p = await plant({ locations: false });
    await p.owner.stock.locations.create({ code: "S1", name: "S1", kind: "store" });
    await p.owner.stock.locations.create({ code: "S2", name: "S2", kind: "store" });
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("More than one") });
    await expect(p.manager.store.balances()).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("More than one") });
  });

  test("[L4b] balances with no store location: locationId null and every balance 0", async () => {
    const p = await plant({ locations: false });
    const b = await p.manager.store.balances();
    expect(b.locationId).toBeNull();
    expect(b.items).toHaveLength(2);
    expect(b.items.every((i) => i.balanceMilli === 0)).toBe(true);
  });
});

describe("gaps: the exported statement builders keep their own tenant scope (PL-5 reuses them)", () => {
  test("[L20a/L23] storeTxnInsert refuses another company's item and another company's store location", async () => {
    const a = await plant();
    const b = await plant();
    const { lib, atomicBatch, nextCompanySeq } = await libParts(a);
    const base = async () => ({
      id: crypto.randomUUID(), companyId: a.companyId, seq: await nextCompanySeq({ db: env.db }, a.companyId),
      kind: "grn" as const, number: "GRN-X", period: "2026-27", unit: "kg", qtyMilli: U, purpose: null, refId: null, grnRef: null,
      exchangeId: null, note: null, userId: null, at: new Date(), guardBalance: false,
    });
    // B's item at A's store: would write a document for company B
    await atomicBatch(env.db, [lib.storeTxnInsert(env.db, { ...(await base()), itemId: b.fluxId, locationId: (await storeLoc(a)).id })]);
    // A's item at B's store: would write a document for company A that points into company B
    await atomicBatch(env.db, [lib.storeTxnInsert(env.db, { ...(await base()), number: "GRN-Y", itemId: a.fluxId, locationId: (await storeLoc(b)).id })]);
    expect(await txnRows(a.companyId)).toEqual([]);
    expect(await txnRows(b.companyId)).toEqual([]);
  });

  test("[L29] storeLedgerInsert posts nothing for another company's document", async () => {
    const a = await plant();
    const b = await plant();
    const grn = await b.storekeeper.store.receive({ itemId: b.fluxId, qtyMilli: 5 * U });
    const { lib, atomicBatch, nextCompanySeq } = await libParts(a);
    const seq = await nextCompanySeq({ db: env.db }, a.companyId);
    await atomicBatch(env.db, [lib.storeLedgerInsert(env.db, { companyId: a.companyId, seq, txnId: grn.id, userId: null, at: new Date() })]);
    expect(await storeLedger(b.companyId)).toHaveLength(1);
    expect(await storeLedger(a.companyId)).toEqual([]);
  });

  test("[L30c] storeCancelRows and storeCancelMark touch nothing of another company's MRS", async () => {
    const a = await plant();
    const b = await plant();
    await b.storekeeper.store.receive({ itemId: b.fluxId, qtyMilli: 5 * U });
    const mrs = await b.storekeeper.store.issue({ itemId: b.fluxId, qtyMilli: 2 * U, purpose: "melt" });
    const { lib, atomicBatch, nextCompanySeq } = await libParts(a);
    const seq = await nextCompanySeq({ db: env.db }, a.companyId);
    const input = { companyId: a.companyId, seq, txnId: mrs.id, exchangeId: null, userId: null, at: new Date(), reason: "x" };
    await atomicBatch(env.db, [lib.storeCancelRows(env.db, input), lib.storeCancelMark(env.db, input)]);
    expect((await storeLedger(b.companyId)).filter((r) => r.reversalOf !== null)).toEqual([]);
    expect(await ledgerBalance(b.companyId, b.fluxId)).toBe(3 * U);
    expect((await txnRows(b.companyId)).find((t) => t.id === mrs.id)!.cancelledAt).toBeNull();
  });
});

describe("gaps: ledger = projection with cancels and replays (Review Focus 1)", () => {
  test("[S1] a random sequence of receipts, issues, exchanges, cancels, replays and refusals: ledger = live projection = balances, never negative, one reversal per cancelled entry", async () => {
    const p = await plant();
    const made: string[] = [];
    let seed = 13;
    const rnd = (n: number) => {
      seed = (seed * 48_271) % 2_147_483_647;
      return (seed % n) + 1;
    };
    let refusals = 0;
    let shortCancels = 0;
    let replays = 0;
    let lastLanded: (() => Promise<{ replayed: boolean }>) | null = null;
    for (let i = 0; i < 90; i += 1) {
      // Every 7th step repeats the last submit that landed (an offline retry): same entry back, nothing posted.
      if (i % 7 === 6 && lastLanded) {
        const before = (await txnRows(p.companyId)).length;
        expect((await lastLanded()).replayed).toBe(true);
        expect((await txnRows(p.companyId)).length).toBe(before);
        replays += 1;
      }
      const kind = rnd(4);
      const q = rnd(9) * U;
      const key = `s1-${i}`;
      try {
        if (kind === 1) {
          const call = () => p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: q, clientRequestId: key });
          made.push((await call()).id);
          lastLanded = call;
        } else if (kind === 2) {
          const call = () => p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: q, purpose: "melt", clientRequestId: key });
          made.push((await call()).id);
          lastLanded = call;
        } else if (kind === 3) {
          const qIn = rnd(9) * U;
          const call = () => p.storekeeper.store.exchange({ itemId: p.fluxId, qtyOutMilli: q, qtyInMilli: qIn, clientRequestId: key });
          made.push((await call()).mrsId);
          lastLanded = call;
        } else if (made.length) {
          await p.storekeeper.store.cancel({ txnId: made[rnd(made.length) - 1]!, reason: "r" });
        }
      } catch (e) {
        refusals += 1;
        if (kind === 4 && String((e as Error).message).includes("Cannot cancel")) shortCancels += 1;
      }
    }
    const txns = await txnRows(p.companyId);
    const live = txns.filter((t) => t.cancelledAt === null).reduce((s, t) => s + (t.kind === "grn" ? t.qtyMilli : -t.qtyMilli), 0);
    const ledger = await ledgerBalance(p.companyId, p.fluxId);
    expect(ledger).toBe(live);
    expect(ledger).toBeGreaterThanOrEqual(0);
    expect(await balanceOf(p, p.fluxId)).toBe(ledger);
    // Running balance after every BATCH (rows sharing posted_at and server_seq land together; an
    // exchange cancel's two reversal rows are one batch), in ledger order, never below zero.
    const rows = (await storeLedger(p.companyId, p.fluxId)).sort(
      (x, y) => x.postedAt.getTime() - y.postedAt.getTime() || x.serverSeq - y.serverSeq,
    );
    const batches = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.postedAt.getTime()}:${r.serverSeq}`;
      batches.set(k, (batches.get(k) ?? 0) + r.qtyG);
    }
    let running = 0;
    for (const sum of batches.values()) {
      running += sum;
      expect(running).toBeGreaterThanOrEqual(0);
    }
    expect(running).toBe(ledger);
    const cancelled = txns.filter((t) => t.cancelledAt !== null);
    const reversals = rows.filter((r) => r.reversalOf !== null);
    expect(cancelled.length).toBeGreaterThan(3);
    expect(refusals).toBeGreaterThan(3);
    expect(replays).toBeGreaterThan(5);
    expect(shortCancels).toBeGreaterThan(0); // the cancel balance guard was exercised
    expect(reversals).toHaveLength(cancelled.length);
    expect(new Set(reversals.map((r) => r.voucherId))).toEqual(new Set(cancelled.map((t) => t.id)));
    // every reversal exactly negates the row it points at; every entry has exactly one original row
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const r of reversals) expect(r.qtyG).toBe(-byId.get(r.reversalOf!)!.qtyG);
    expect(rows.filter((r) => r.reversalOf === null).map((r) => r.voucherId).sort()).toEqual(txns.map((t) => t.id).sort());
  }, 60_000);
});
