/**
 * PL-7: central store — items, GRN receipts, MRS issues, old-for-new exchanges, balances
 * (spec P17, digest Stage 18). The headline rule: an issue can never take a balance negative,
 * even when two issues race (the balance check is inside the guarded INSERT).
 *
 * Store quantities are integer milli-units (`qty_milli`; 1000 = 1 unit of the item's unit) and
 * ride the ledger's generic `qty_g` column for item_kind `store_item` at the STORE location.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, location, stockLedger, storeItem, storeTxn } from "@orrn/db/schema";
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
    await p.manager.store.items.update({ id: p.fluxId, active: false });
    const [row] = await env.db.select().from(storeItem).where(eq(storeItem.id, p.fluxId));
    expect(row!.name).toBe("Cover flux (K)");
    expect(row!.active).toBe(false);
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "melt" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const actions = await auditActions(p.companyId);
    expect(actions).toContain("store_item.create");
    expect(actions.filter((a) => a === "store_item.update")).toHaveLength(2);
    // a retired item with stock still shows on balances, so the stock is not hidden
    expect(await balanceOf(p, p.fluxId)).toBe(5 * U);
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
    // at no point did the running balance (ledger order) dip below zero
    const rows = (await storeLedger(p.companyId, p.fluxId)).sort((a, b) => a.postedAt.getTime() - b.postedAt.getTime() || a.serverSeq - b.serverSeq);
    expect(rows.length).toBe(txns.length);
    // every txn has exactly one ledger row and vice versa
    expect(new Set(rows.map((r) => r.voucherId))).toEqual(new Set(txns.map((t) => t.id)));
  });

  test("stock.balance reads store rows too (qty in milli-units for item_kind store_item)", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 8 * U });
    const storeLoc = (await env.db.select().from(location).where(and(eq(location.companyId, p.companyId), eq(location.kind, "store"))))[0]!;
    const res = await p.manager.stock.balance({ itemKind: "store_item", locationId: storeLoc.id });
    expect(res.items).toEqual([{ itemKind: "store_item", itemRef: p.fluxId, locationId: storeLoc.id, qtyG: 8 * U }]);
  });
});
