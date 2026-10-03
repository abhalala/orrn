/**
 * PL-3: locations and the append-only kg stock ledger (spec P5/P6, §5; Review Focus 1).
 *
 * The centrepiece is the sequence test: a seeded random walk of pack / move / void / restore /
 * reserve / unreserve / complete / cancel, asserting after EVERY step that the ledger balance per
 * bundle and per location equals what the bundle rows say (the projection), and at the end that
 * the ledger "as of" each step's instant equals that step's projection.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { kgPer12ft } from "@orrn/domain";
import { auditLog, bundle, location, stockLedger, user } from "@orrn/db/schema";
import { asc, eq } from "drizzle-orm";

import { can, type Action } from "../src/lib/permissions";
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

type Api = ReturnType<TestEnv["caller"]>;

const ROLES: CompanyRole[] = [
  "owner", "admin", "manager", "office", "accountant", "supervisor", "packer",
  "foundry", "press", "storekeeper", "die_room", "operator", "viewer",
];

async function plant(opts: { locations?: boolean; settings?: Record<string, unknown> } = {}) {
  const { companyId, users } = await env.seedCompany({ settings: opts.settings });
  const owner = env.caller({ role: "owner", companyId });
  if (opts.locations !== false) await owner.stock.locations.seedDefaults();
  const locs = (await owner.stock.locations.list()).items;
  const loc = (code: string) => {
    const l = locs.find((x) => x.code === code);
    if (!l) throw new Error(`no location ${code}`);
    return l.id;
  };
  const yards = locs.filter((l) => l.kind === "yard").map((l) => l.id);
  const dieId = await env.seedDie(companyId);
  const customerId = await env.seedCustomer(companyId);
  return { companyId, users, owner, locs, loc, yards, dieId, customerId };
}

const row = (weightG = 25_000, quantity = 10, lengthMm = 3_658) => ({ quantity, weightG, lengthMm });

/** `${bundleId}|${locationId}` → grams, for in-stock bundles (what the bundle rows say). */
async function projection(companyId: string) {
  const rows = await env.db
    .select({ id: bundle.id, status: bundle.status, locationId: bundle.locationId, weightG: bundle.weightG })
    .from(bundle)
    .where(eq(bundle.companyId, companyId));
  const out = new Map<string, number>();
  for (const b of rows) {
    if (b.status === "available" || b.status === "reserved") out.set(`${b.id}|${b.locationId}`, b.weightG);
  }
  return out;
}

async function ledgerBalance(api: Api, at?: number) {
  const { items } = await api.stock.balance({ itemKind: "bundle", ...(at !== undefined ? { at } : {}) });
  return new Map(items.map((i) => [`${i.itemRef}|${i.locationId}`, i.qtyG]));
}

function perLocation(m: Map<string, number>) {
  const out = new Map<string, number>();
  for (const [key, g] of m) {
    const loc = key.split("|")[1]!;
    out.set(loc, (out.get(loc) ?? 0) + g);
  }
  return out;
}

const sorted = (m: Map<string, number>) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b));

async function expectConsistent(api: Api, companyId: string, label: string) {
  const proj = await projection(companyId);
  const led = await ledgerBalance(api);
  // Per bundle (and the location it is at).
  expect({ label, rows: sorted(led) }).toEqual({ label, rows: sorted(proj) });
  // Per location, through the summary endpoint.
  const summary = await api.stock.byLocation();
  const fromSummary = new Map<string, number>();
  for (const l of summary.locations) {
    const g = l.totals.find((t) => t.itemKind === "bundle")?.qtyG ?? 0;
    if (g !== 0) fromSummary.set(l.id, g);
  }
  const unlocated = summary.unlocated.find((t) => t.itemKind === "bundle")?.qtyG ?? 0;
  if (unlocated !== 0) fromSummary.set("null", unlocated);
  expect({ label, perLocation: sorted(fromSummary) }).toEqual({ label, perLocation: sorted(perLocation(proj)) });
  return proj;
}

async function ledgerRows(companyId: string) {
  return env.db
    .select()
    .from(stockLedger)
    .where(eq(stockLedger.companyId, companyId))
    .orderBy(asc(stockLedger.postedAt), asc(stockLedger.serverSeq), asc(stockLedger.line));
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Review Focus 1: ledger = projection after any sequence
// ---------------------------------------------------------------------------

describe("Review Focus 1: ledger balance equals the bundle projection", () => {
  for (const seed of [20261003, 7]) {
    test(
      `random 200-step sequence on 30 bundles (seed ${seed})`,
      async () => {
        const rand = mulberry32(seed);
        const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
        const pickOne = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
        const pickSome = <T,>(xs: readonly T[], n: number) => {
          const pool = [...xs];
          const out: T[] = [];
          while (out.length < n && pool.length > 0) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
          return out;
        };

        const p = await plant();
        const api = p.owner;
        // Working set: at most 30 bundles not yet dispatched (dispatched ones leave the yard).
        const MAX_BUNDLES = 30;
        const base = Date.UTC(2026, 9, 3, 4, 0, 0);
        const snapshots: { at: number; proj: Map<string, number> }[] = [];
        const counts: Record<string, number> = {};
        const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

        const bundlesNow = () =>
          env.db
            .select({ id: bundle.id, status: bundle.status, locationId: bundle.locationId })
            .from(bundle)
            .where(eq(bundle.companyId, p.companyId));
        const dispatchesNow = async () => (await api.dispatch.listDispatches({ limit: 100 })).items;

        let earlyRows: Awaited<ReturnType<typeof ledgerRows>> = [];

        for (let step = 0; step < 200; step += 1) {
          const at = base + step * 60_000;
          setClock(new Date(at));
          const all = await bundlesNow();
          const live = all.filter((b) => b.status !== "dispatched");
          const inStock = all.filter((b) => b.status === "available" || b.status === "reserved");
          const available = all.filter((b) => b.status === "available");
          const voided = all.filter((b) => b.status === "void");
          const ds = await dispatchesNow();
          const reservedDs = ds.filter((d) => d.status === "reserved");
          const openDs = ds.filter((d) => d.status === "draft" || d.status === "reserved");

          const r = rand();
          let action =
            step < 3 || (r < 0.15 && live.length < MAX_BUNDLES)
              ? "pack"
              : r < 0.4
                ? "move"
                : r < 0.52
                  ? "void"
                  : r < 0.6
                    ? "restore"
                    : r < 0.75
                      ? "reserve"
                      : r < 0.87
                        ? "complete"
                        : r < 0.95
                          ? "cancel"
                          : "unreserve";
          if (action === "pack" && live.length >= MAX_BUNDLES) action = "move";

          switch (action) {
            case "pack": {
              const n = Math.min(int(1, 4), MAX_BUNDLES - live.length);
              await api.bundle.createReceipt({
                dieId: p.dieId,
                unit: "pcs",
                locationId: pickOne(p.yards),
                rows: Array.from({ length: n }, () => row(int(8_000, 60_000), int(5, 30), int(3_000, 6_100))),
              });
              bump("pack");
              break;
            }
            case "move": {
              // Mostly yard stock; one move in five draws from every bundle to hit the rejections.
              const pool = rand() < 0.2 || inStock.length === 0 ? all : inStock;
              if (pool.length === 0) break;
              const chosen = pickSome(pool, int(1, 4));
              const to = pickOne(p.yards);
              const blocked = chosen.some((b) => b.status === "dispatched" || b.status === "void");
              const call = api.stock.move({ bundleIds: chosen.map((b) => b.id), toLocationId: to });
              if (blocked) {
                await expect(call).rejects.toMatchObject({ code: "BAD_REQUEST" });
                bump("move-rejected");
              } else {
                await call;
                bump("move");
              }
              break;
            }
            case "void": {
              if (available.length === 0) break;
              await api.bundle.transitionStatus({ id: pickOne(available).id, toStatus: "void", reason: "bent" });
              bump("void");
              break;
            }
            case "restore": {
              if (voided.length === 0) break;
              await api.bundle.transitionStatus({ id: pickOne(voided).id, toStatus: "available" });
              bump("restore");
              break;
            }
            case "reserve": {
              if (available.length === 0) break;
              const { id } = await api.dispatch.create({ customerId: p.customerId });
              for (const b of pickSome(available, int(1, 4))) await api.dispatch.addBundle({ id, bundleId: b.id });
              await api.dispatch.reserve({ id });
              bump("reserve");
              break;
            }
            case "complete": {
              if (reservedDs.length === 0) break;
              await api.dispatch.complete({ id: pickOne(reservedDs).id });
              bump("complete");
              break;
            }
            case "cancel": {
              if (openDs.length === 0) break;
              await api.dispatch.cancel({ id: pickOne(openDs).id });
              bump("cancel");
              break;
            }
            case "unreserve": {
              if (reservedDs.length === 0) break;
              await api.dispatch.unreserve({ id: pickOne(reservedDs).id });
              bump("unreserve");
              break;
            }
          }

          const proj = await expectConsistent(api, p.companyId, `seed ${seed} step ${step} (${action})`);
          snapshots.push({ at, proj });
          if (step === 60) earlyRows = await ledgerRows(p.companyId);
        }

        // Every kind of step actually ran.
        for (const k of ["pack", "move", "void", "restore", "reserve", "complete", "cancel"]) {
          expect({ k, ran: (counts[k] ?? 0) > 0 }).toEqual({ k, ran: true });
        }

        // Stock is rebuildable at any instant: the ledger as of step k equals step k's projection.
        for (const k of [0, 10, 37, 60, 99, 150, 199]) {
          const snap = snapshots[k]!;
          expect({ k, rows: sorted(await ledgerBalance(api, snap.at)) }).toEqual({ k, rows: sorted(snap.proj) });
        }

        // Append-only: every row that existed at step 60 is still there, unchanged.
        const finalRows = new Map((await ledgerRows(p.companyId)).map((r) => [r.id, r]));
        expect(earlyRows.length).toBeGreaterThan(0);
        for (const r of earlyRows) expect(finalRows.get(r.id)).toEqual(r);
      },
      180_000,
    );
  }
});

// ---------------------------------------------------------------------------
// Postings per action
// ---------------------------------------------------------------------------

describe("pack (createReceipt)", () => {
  test("posts + bundle kg at the chosen yard, voucher = receipt; bundle gets location, kg/12ft and number style", async () => {
    const p = await plant();
    const res = await p.owner.bundle.createReceipt({
      dieId: p.dieId,
      unit: "pcs",
      locationId: p.loc("Y2"),
      rows: [row(52_400, 21, 3_658), row(30_000, 10, 6_096)],
    });
    const bundles = await env.db
      .select()
      .from(bundle)
      .where(eq(bundle.groupId, res.groupId))
      .orderBy(asc(bundle.serial));
    expect(bundles.map((b) => b.locationId)).toEqual([p.loc("Y2"), p.loc("Y2")]);
    expect(bundles[0]!.kgPer12ftMilli).toBe(Math.round(kgPer12ft({ weightG: 52_400, pieces: 21, lengthMm: 3_658 })! * 1000));
    expect(bundles.every((b) => b.numberStyle === "legacy")).toBe(true);

    const rows = await ledgerRows(p.companyId);
    expect(rows.map((r) => [r.voucherType, r.voucherId, r.line, r.itemKind, r.locationId, r.qtyG])).toEqual([
      ["pack", res.groupId, 1, "bundle", p.loc("Y2"), 52_400],
      ["pack", res.groupId, 2, "bundle", p.loc("Y2"), 30_000],
    ]);
    expect(new Set(rows.map((r) => r.itemRef))).toEqual(new Set(bundles.map((b) => b.id)));
    expect(rows.every((r) => r.reversalOf === null && r.serverSeq > 0)).toBe(true);
    await expectConsistent(p.owner, p.companyId, "after pack");
  });

  test("plant numbering marks number_style plant", async () => {
    const p = await plant({ settings: { bundleNumbering: "plant" } });
    const res = await p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", locationId: p.loc("Y1"), rows: [row()] });
    const [b] = await env.db.select().from(bundle).where(eq(bundle.groupId, res.groupId));
    expect(b!.numberStyle).toBe("plant");
  });

  test("locationId is required once the company has yard locations, and must be a yard of this company", async () => {
    const p = await plant();
    const other = await plant();
    await expect(p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", rows: [row()] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", locationId: p.loc("BILLET"), rows: [row()] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", locationId: other.loc("Y1"), rows: [row()] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await ledgerRows(p.companyId)).toEqual([]);
  });

  test("a company with no locations keeps working; stock is posted with an unknown location", async () => {
    const p = await plant({ locations: false });
    const res = await p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", rows: [row(11_000)] });
    expect(res.bundleCount).toBe(1);
    const rows = await ledgerRows(p.companyId);
    expect(rows.map((r) => [r.voucherType, r.locationId, r.qtyG])).toEqual([["pack", null, 11_000]]);
    await expectConsistent(p.owner, p.companyId, "no locations");
  });

  test("200-row receipt: bundle and ledger inserts stay under 100 bound params", async () => {
    const p = await plant();
    const res = await p.owner.bundle.createReceipt({
      dieId: p.dieId,
      unit: "pcs",
      locationId: p.loc("Y3"),
      rows: Array.from({ length: 200 }, (_, i) => row(10_000 + i)),
    });
    expect(res.bundleCount).toBe(200);
    expect((await ledgerRows(p.companyId)).length).toBe(200);
    await expectConsistent(p.owner, p.companyId, "200 rows");
  });
});

describe("void and restore", () => {
  test("void posts the reversal of the pack row at the bundle's current location; restore re-packs", async () => {
    const p = await plant();
    const res = await p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", locationId: p.loc("Y1"), rows: [row(40_000)] });
    const [b] = await env.db.select().from(bundle).where(eq(bundle.groupId, res.groupId));
    await p.owner.stock.move({ bundleIds: [b!.id], toLocationId: p.loc("Y4") });
    await p.owner.bundle.transitionStatus({ id: b!.id, toStatus: "void", reason: "bent in handling" });

    let rows = await ledgerRows(p.companyId);
    const packRow = rows.find((r) => r.voucherType === "pack")!;
    const voidRow = rows.find((r) => r.voucherType === "void")!;
    expect(voidRow).toMatchObject({
      itemRef: b!.id,
      locationId: p.loc("Y4"),
      qtyG: -40_000,
      reversalOf: packRow.id,
      reason: "bent in handling",
    });
    await expectConsistent(p.owner, p.companyId, "after void");

    await p.owner.bundle.transitionStatus({ id: b!.id, toStatus: "available" });
    rows = await ledgerRows(p.companyId);
    const restoreRow = rows.find((r) => r.voucherType === "restore")!;
    expect(restoreRow).toMatchObject({ itemRef: b!.id, locationId: p.loc("Y4"), qtyG: 40_000, reversalOf: voidRow.id });
    await expectConsistent(p.owner, p.companyId, "after restore");

    // A second void reverses the restore row (the latest + row).
    await p.owner.bundle.transitionStatus({ id: b!.id, toStatus: "void" });
    rows = await ledgerRows(p.companyId);
    const second = rows.filter((r) => r.voucherType === "void").at(-1)!;
    expect(second.reversalOf).toBe(restoreRow.id);
    await expectConsistent(p.owner, p.companyId, "after second void");
  });
});

describe("stock.move", () => {
  test("posts − at from and + at to under one voucher", async () => {
    const p = await plant();
    const res = await p.owner.bundle.createReceipt({
      dieId: p.dieId,
      unit: "pcs",
      locationId: p.loc("Y1"),
      rows: [row(10_000), row(20_000)],
    });
    const bs = await env.db.select().from(bundle).where(eq(bundle.groupId, res.groupId)).orderBy(asc(bundle.serial));
    const out = await p.owner.stock.move({ bundleIds: bs.map((b) => b.id), toLocationId: p.loc("Y5") });
    expect(out).toMatchObject({ moved: 2, unchanged: 0, toLocationCode: "Y5" });
    const moves = (await ledgerRows(p.companyId)).filter((r) => r.voucherType === "move");
    expect(moves.every((r) => r.voucherId === out.voucherId)).toBe(true);
    expect(moves.map((r) => [r.line, r.itemRef, r.locationId, r.qtyG])).toEqual([
      [1, bs[0]!.id, p.loc("Y1"), -10_000],
      [2, bs[0]!.id, p.loc("Y5"), 10_000],
      [3, bs[1]!.id, p.loc("Y1"), -20_000],
      [4, bs[1]!.id, p.loc("Y5"), 20_000],
    ]);
    await expectConsistent(p.owner, p.companyId, "after move");
  });

  test("by scanned code; a reserved bundle can move; same location is a no-op", async () => {
    const p = await plant();
    const res = await p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", locationId: p.loc("Y1"), rows: [row(), row()] });
    const bs = await env.db.select().from(bundle).where(eq(bundle.groupId, res.groupId)).orderBy(asc(bundle.serial));
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundle({ id, bundleId: bs[0]!.id });
    await p.owner.dispatch.reserve({ id });

    const moved = await p.owner.stock.move({ codes: [bs[0]!.serial.toLowerCase()], toLocationId: p.loc("Y2") });
    expect(moved.moved).toBe(1);

    const before = (await ledgerRows(p.companyId)).length;
    const noop = await p.owner.stock.move({ bundleIds: [bs[1]!.id], toLocationId: p.loc("Y1") });
    expect(noop).toMatchObject({ voucherId: null, moved: 0, unchanged: 1 });
    expect((await ledgerRows(p.companyId)).length).toBe(before);
    await expectConsistent(p.owner, p.companyId, "after code move");
  });

  test("dispatched or void bundles → BAD_REQUEST, nothing posted", async () => {
    const p = await plant();
    const res = await p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", locationId: p.loc("Y1"), rows: [row(), row(), row()] });
    const bs = await env.db.select().from(bundle).where(eq(bundle.groupId, res.groupId)).orderBy(asc(bundle.serial));
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundle({ id, bundleId: bs[0]!.id });
    await p.owner.dispatch.reserve({ id });
    await p.owner.dispatch.complete({ id });
    await p.owner.bundle.transitionStatus({ id: bs[1]!.id, toStatus: "void" });
    const before = await ledgerRows(p.companyId);

    await expect(p.owner.stock.move({ bundleIds: [bs[0]!.id], toLocationId: p.loc("Y2") })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      p.owner.stock.move({ bundleIds: [bs[2]!.id, bs[1]!.id], toLocationId: p.loc("Y2") }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await ledgerRows(p.companyId)).toEqual(before);
    const [still] = await env.db.select().from(bundle).where(eq(bundle.id, bs[2]!.id));
    expect(still!.locationId).toBe(p.loc("Y1"));
  });

  test("tenant isolation and target validation", async () => {
    const p = await plant();
    // Plant numbers (26J1) so the other company's serial is not also one of p's BG serials.
    const other = await plant({ settings: { bundleNumbering: "plant" } });
    const res = await p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", locationId: p.loc("Y1"), rows: [row()] });
    const [b] = await env.db.select().from(bundle).where(eq(bundle.groupId, res.groupId));
    const otherRes = await other.owner.bundle.createReceipt({ dieId: other.dieId, unit: "pcs", locationId: other.loc("Y1"), rows: [row()] });
    const [ob] = await env.db.select().from(bundle).where(eq(bundle.groupId, otherRes.groupId));

    await expect(p.owner.stock.move({ bundleIds: [ob!.id], toLocationId: p.loc("Y2") })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.owner.stock.move({ codes: [ob!.serial], toLocationId: p.loc("Y2") })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.owner.stock.move({ bundleIds: [b!.id], toLocationId: other.loc("Y2") })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.owner.stock.move({ bundleIds: [b!.id], toLocationId: p.loc("SCRAP") })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.owner.stock.locations.update({ id: p.loc("Y6"), active: false });
    await expect(p.owner.stock.move({ bundleIds: [b!.id], toLocationId: p.loc("Y6") })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Balances never show another company's rows.
    const mine = await p.owner.stock.balance({});
    expect(mine.items.map((i) => i.itemRef)).toEqual([b!.id]);
    await expect(p.owner.stock.locations.update({ id: other.loc("Y1"), name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("150 bundles in one move: chunked, consistent", async () => {
    const p = await plant();
    const res = await p.owner.bundle.createReceipt({
      dieId: p.dieId,
      unit: "pcs",
      locationId: p.loc("Y1"),
      rows: Array.from({ length: 150 }, (_, i) => row(9_000 + i)),
    });
    const bs = await env.db.select({ id: bundle.id }).from(bundle).where(eq(bundle.groupId, res.groupId));
    const out = await p.owner.stock.move({ bundleIds: bs.map((b) => b.id), toLocationId: p.loc("Y3") });
    expect(out.moved).toBe(150);
    const moves = (await ledgerRows(p.companyId)).filter((r) => r.voucherId === out.voucherId);
    expect(moves.length).toBe(300);
    expect(new Set(moves.map((r) => r.line)).size).toBe(300);
    await expectConsistent(p.owner, p.companyId, "after 150 move");
  });
});

describe("dispatch complete (DN)", () => {
  test("posts − bundle kg per item at each bundle's location; 120 items stay under the param limit", async () => {
    const p = await plant();
    const res = await p.owner.bundle.createReceipt({
      dieId: p.dieId,
      unit: "pcs",
      locationId: p.loc("Y1"),
      rows: Array.from({ length: 120 }, (_, i) => row(20_000 + i)),
    });
    const bs = await env.db.select().from(bundle).where(eq(bundle.groupId, res.groupId)).orderBy(asc(bundle.serial));
    await p.owner.stock.move({ bundleIds: bs.slice(0, 70).map((b) => b.id), toLocationId: p.loc("Y2") });

    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ id, serials: bs.slice(0, 100).map((b) => b.serial) });
    await p.owner.dispatch.addBundlesBySerial({ id, serials: bs.slice(100).map((b) => b.serial) });
    await p.owner.dispatch.reserve({ id });
    await expectConsistent(p.owner, p.companyId, "reserved is still in stock");
    await p.owner.dispatch.complete({ id });

    const out = (await ledgerRows(p.companyId)).filter((r) => r.voucherType === "dispatch");
    expect(out.length).toBe(120);
    expect(out.every((r) => r.voucherId === id)).toBe(true);
    expect(new Set(out.map((r) => r.line)).size).toBe(120);
    const byBundle = new Map(out.map((r) => [r.itemRef, r]));
    for (const [i, b] of bs.entries()) {
      expect(byBundle.get(b.id)).toMatchObject({ qtyG: -b.weightG, locationId: i < 70 ? p.loc("Y2") : p.loc("Y1") });
    }
    await expectConsistent(p.owner, p.companyId, "after complete");
    expect((await p.owner.stock.balance({ itemKind: "bundle" })).items).toEqual([]);
  });

  test("race: a move that lands after complete's read is honoured (location read at write time)", async () => {
    const p = await plant();
    const res = await p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", locationId: p.loc("Y1"), rows: [row(33_000)] });
    const [b] = await env.db.select().from(bundle).where(eq(bundle.groupId, res.groupId));
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundle({ id, bundleId: b!.id });
    await p.owner.dispatch.reserve({ id });

    env.beforeNextBatch(() => p.owner.stock.move({ bundleIds: [b!.id], toLocationId: p.loc("Y3") }));
    await p.owner.dispatch.complete({ id });

    const out = (await ledgerRows(p.companyId)).filter((r) => r.voucherType === "dispatch");
    expect(out.map((r) => [r.locationId, r.qtyG])).toEqual([[p.loc("Y3"), -33_000]]);
    await expectConsistent(p.owner, p.companyId, "race move vs complete");
  });

  test("a completed dispatch cannot be cancelled; the stock-out stands", async () => {
    const p = await plant();
    const res = await p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", locationId: p.loc("Y1"), rows: [row()] });
    const [b] = await env.db.select().from(bundle).where(eq(bundle.groupId, res.groupId));
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundle({ id, bundleId: b!.id });
    await p.owner.dispatch.reserve({ id });
    await p.owner.dispatch.complete({ id });
    const before = await ledgerRows(p.companyId);
    await expect(p.owner.dispatch.cancel({ id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await ledgerRows(p.companyId)).toEqual(before);
    await expectConsistent(p.owner, p.companyId, "cancel after complete");
  });

  test("a completion that loses to a cancel posts nothing", async () => {
    const p = await plant();
    const res = await p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", locationId: p.loc("Y1"), rows: [row()] });
    const [b] = await env.db.select().from(bundle).where(eq(bundle.groupId, res.groupId));
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundle({ id, bundleId: b!.id });
    await p.owner.dispatch.reserve({ id });

    env.beforeNextBatch(() => p.owner.dispatch.cancel({ id }));
    await p.owner.dispatch.complete({ id }).catch(() => null);

    expect((await ledgerRows(p.companyId)).filter((r) => r.voucherType === "dispatch")).toEqual([]);
    await expectConsistent(p.owner, p.companyId, "complete lost to cancel");
  });
});

describe("legacy bundles and the opening balance", () => {
  test("bundles without ledger rows post nothing until stock.openingBalance takes them on (idempotent)", async () => {
    const p = await plant();
    const legacy = await env.seedBundles(p.companyId, p.dieId, 6);
    await env.seedBundles(p.companyId, p.dieId, 2, "dispatched");
    await env.seedBundles(p.companyId, p.dieId, 1, "void");

    // Operations on off-ledger bundles change the bundle rows but post nothing.
    await p.owner.stock.move({ bundleIds: [legacy[0]!.id], toLocationId: p.loc("Y2") });
    await p.owner.bundle.transitionStatus({ id: legacy[1]!.id, toStatus: "void" });
    expect(await ledgerRows(p.companyId)).toEqual([]);

    const first = await p.owner.stock.openingBalance();
    expect(first.posted).toBe(5);
    expect(first.qtyG).toBe(5 * 25_000);
    const rows = await ledgerRows(p.companyId);
    expect(rows.every((r) => r.voucherType === "opening" && r.voucherId === first.voucherId)).toBe(true);
    expect(rows.find((r) => r.itemRef === legacy[0]!.id)!.locationId).toBe(p.loc("Y2"));
    expect(rows.filter((r) => r.locationId === null).length).toBe(4);
    await expectConsistent(p.owner, p.companyId, "after opening balance");

    const again = await p.owner.stock.openingBalance();
    expect(again).toEqual({ voucherId: null, posted: 0, qtyG: 0 });
    expect((await ledgerRows(p.companyId)).length).toBe(5);

    // Now on the ledger: void, move and dispatch post as usual.
    await p.owner.bundle.transitionStatus({ id: legacy[2]!.id, toStatus: "void" });
    await p.owner.stock.move({ bundleIds: [legacy[3]!.id], toLocationId: p.loc("Y4") });
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundle({ id, bundleId: legacy[4]!.id });
    await p.owner.dispatch.reserve({ id });
    await p.owner.dispatch.complete({ id });
    await expectConsistent(p.owner, p.companyId, "legacy after ops");
  });

  test("race: a void that lands right after the opening balance reverses it", async () => {
    const p = await plant();
    const [legacy] = await env.seedBundles(p.companyId, p.dieId, 1);
    env.beforeNextBatch(() => p.owner.stock.openingBalance());
    await p.owner.bundle.transitionStatus({ id: legacy!.id, toStatus: "void" });
    const rows = await ledgerRows(p.companyId);
    expect(rows.map((r) => [r.voucherType, r.qtyG])).toEqual([
      ["opening", 25_000],
      ["void", -25_000],
    ]);
    await expectConsistent(p.owner, p.companyId, "void vs opening");
  });

  test("bulk import takes the bundles on with an opening voucher at an unknown location", async () => {
    const p = await plant();
    await p.owner.bundle.bulkImport({
      rows: [
        { dieSeries: "L", dieSectionCode: "L1", quantity: 5, weightG: 12_000, lengthMm: 3_000 },
        { dieSeries: "L", dieSectionCode: "L1", quantity: 6, weightG: 13_000, lengthMm: 3_000 },
      ],
    });
    const rows = await ledgerRows(p.companyId);
    expect(rows.map((r) => [r.voucherType, r.locationId, r.qtyG])).toEqual([
      ["opening", null, 12_000],
      ["opening", null, 13_000],
    ]);
    await expectConsistent(p.owner, p.companyId, "after bulk import");
  });
});

describe("locations", () => {
  test("seedDefaults creates Y1-Y6, BILLET, SCRAP, STORE, PLANT-SCRAP once", async () => {
    const p = await plant({ locations: false });
    expect(await p.owner.stock.locations.seedDefaults()).toEqual({ created: 10 });
    expect(await p.owner.stock.locations.seedDefaults()).toEqual({ created: 0 });
    const items = (await p.owner.stock.locations.list()).items;
    expect(items.map((l) => [l.code, l.kind])).toEqual([
      ["Y1", "yard"], ["Y2", "yard"], ["Y3", "yard"], ["Y4", "yard"], ["Y5", "yard"], ["Y6", "yard"],
      ["BILLET", "billet_store"], ["SCRAP", "scrap_store"], ["STORE", "store"], ["PLANT-SCRAP", "wip"],
    ]);
  });

  test("create validates code (no location 0, unique per company); update retires only empty locations", async () => {
    const p = await plant();
    await expect(p.owner.stock.locations.create({ code: "0", name: "Unknown", kind: "yard" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(p.owner.stock.locations.create({ code: "y1", name: "Again", kind: "yard" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const { id } = await p.owner.stock.locations.create({ code: "y7", name: "Yard 7", kind: "yard" });
    const [created] = await env.db.select().from(location).where(eq(location.id, id));
    expect(created).toMatchObject({ code: "Y7", kind: "yard", active: true });
    // Another company may use the same code.
    const other = await plant();
    await expect(other.owner.stock.locations.create({ code: "Y7", name: "Yard 7", kind: "yard" })).resolves.toBeDefined();

    await p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", locationId: id, rows: [row()] });
    await expect(p.owner.stock.locations.update({ id, active: false })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.owner.stock.locations.update({ id, code: "Y2" })).rejects.toMatchObject({ code: "CONFLICT" });
    await p.owner.stock.locations.update({ id, name: "Yard seven" });
    const [renamed] = await env.db.select().from(location).where(eq(location.id, id));
    expect(renamed!.name).toBe("Yard seven");
  });
});

/** Pack `n` bundles into `locationId`; returns them. */
async function packInto(p: Awaited<ReturnType<typeof plant>>, locationId: string, n = 1, weightG = 25_000) {
  const res = await p.owner.bundle.createReceipt({
    dieId: p.dieId,
    unit: "pcs",
    locationId,
    rows: Array.from({ length: n }, () => row(weightG)),
  });
  return env.db.select().from(bundle).where(eq(bundle.groupId, res.groupId)).orderBy(asc(bundle.serial));
}

describe("locations: write-time guards", () => {
  test("a location that holds stock cannot change kind or be retired; an empty one can", async () => {
    const p = await plant();
    await packInto(p, p.loc("Y1"));
    await expect(p.owner.stock.locations.update({ id: p.loc("Y1"), kind: "store" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(p.owner.stock.locations.update({ id: p.loc("Y1"), active: false })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    // The refused update changed nothing, not even the other fields in the same call.
    await expect(
      p.owner.stock.locations.update({ id: p.loc("Y1"), kind: "store", name: "Renamed" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [still] = await env.db.select().from(location).where(eq(location.id, p.loc("Y1")));
    expect(still).toMatchObject({ kind: "yard", active: true, name: "Yard 1" });
    // Same kind, or other fields, are fine on a stocked location.
    await p.owner.stock.locations.update({ id: p.loc("Y1"), kind: "yard", name: "Front yard" });

    await p.owner.stock.locations.update({ id: p.loc("Y6"), kind: "store" });
    await p.owner.stock.locations.update({ id: p.loc("Y6"), active: false });
    const [y6] = await env.db.select().from(location).where(eq(location.id, p.loc("Y6")));
    expect(y6).toMatchObject({ kind: "store", active: false });
    // Emptied by moving the stock out, then retiring works.
    const [b] = await packInto(p, p.loc("Y2"));
    await p.owner.stock.move({ bundleIds: [b!.id], toLocationId: p.loc("Y3") });
    await p.owner.stock.locations.update({ id: p.loc("Y2"), active: false });
    await expectConsistent(p.owner, p.companyId, "after guarded updates");
  });

  test("race: stock that lands after the retire's read blocks the retire", async () => {
    const p = await plant();
    const [b] = await packInto(p, p.loc("Y1"));
    // The retire sees an empty Y6; a move lands in Y6 before its write.
    env.beforeNextBatch(() => p.owner.stock.move({ bundleIds: [b!.id], toLocationId: p.loc("Y6") }));
    await expect(p.owner.stock.locations.update({ id: p.loc("Y6"), active: false })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const [y6] = await env.db.select().from(location).where(eq(location.id, p.loc("Y6")));
    expect(y6!.active).toBe(true);
    const audits = await env.db.select().from(auditLog).where(eq(auditLog.subjectId, p.loc("Y6")));
    expect(audits.filter((a) => a.action === "location.update")).toEqual([]);
    await expectConsistent(p.owner, p.companyId, "retire vs move");
  });

  test("race: stock that lands after a kind change's read blocks it", async () => {
    const p = await plant();
    const [b] = await packInto(p, p.loc("Y1"));
    env.beforeNextBatch(() => p.owner.stock.move({ bundleIds: [b!.id], toLocationId: p.loc("Y5") }));
    await expect(p.owner.stock.locations.update({ id: p.loc("Y5"), kind: "store" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await env.db.select().from(location).where(eq(location.id, p.loc("Y5"))))[0]!.kind).toBe("yard");
    await expectConsistent(p.owner, p.companyId, "kind change vs move");
  });

  test("race: a move into a yard retired after its read is refused, nothing posted", async () => {
    const p = await plant();
    const [b] = await packInto(p, p.loc("Y1"));
    const before = await ledgerRows(p.companyId);
    env.beforeNextBatch(() => p.owner.stock.locations.update({ id: p.loc("Y6"), active: false }));
    await expect(p.owner.stock.move({ bundleIds: [b!.id], toLocationId: p.loc("Y6") })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await env.db.select().from(bundle).where(eq(bundle.id, b!.id)))[0]!.locationId).toBe(p.loc("Y1"));
    expect(await ledgerRows(p.companyId)).toEqual(before);
    await expectConsistent(p.owner, p.companyId, "move vs retire");
  });

  test("race: a receipt into a yard retired or re-typed after its read is refused whole", async () => {
    const p = await plant();
    const before = (await env.db.select().from(bundle).where(eq(bundle.companyId, p.companyId))).length;
    for (const [code, patch] of [
      ["Y6", { active: false }],
      ["Y5", { kind: "store" as const }],
    ] as const) {
      env.beforeNextBatch(() => p.owner.stock.locations.update({ id: p.loc(code), ...patch }));
      await expect(
        p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", locationId: p.loc(code), rows: [row(), row()] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect((await env.db.select().from(bundle).where(eq(bundle.companyId, p.companyId))).length).toBe(before);
    expect(await ledgerRows(p.companyId)).toEqual([]);
    expect(
      await env.db.select().from(auditLog).where(eq(auditLog.action, "bundle.receipt.create")),
    ).toEqual(expect.not.arrayContaining([expect.objectContaining({ companyId: p.companyId })]));
    // A receipt into a healthy yard still works afterwards.
    await expect(
      p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", locationId: p.loc("Y1"), rows: [row()] }),
    ).resolves.toBeDefined();
    await expectConsistent(p.owner, p.companyId, "receipt vs retire");
  });
});

describe("races: ledger equals projection after each interleaving", () => {
  test("move vs move to the same yard: `moved` counts only what this request moved", async () => {
    const p = await plant();
    const bs = await packInto(p, p.loc("Y1"), 3);
    // A reads three bundles to move; B puts the first one at A's target before A writes.
    env.beforeNextBatch(() => p.owner.stock.move({ bundleIds: [bs[0]!.id], toLocationId: p.loc("Y2") }));
    const a = await p.owner.stock.move({ bundleIds: bs.map((b) => b.id), toLocationId: p.loc("Y2") });
    expect(a.moved).toBe(2);
    expect(a.unchanged).toBe(1);
    expect(a.voucherId).not.toBeNull();
    const rows = await env.db.select().from(bundle).where(eq(bundle.companyId, p.companyId));
    expect(rows.every((b) => b.locationId === p.loc("Y2"))).toBe(true);
    const movedByA = (await ledgerRows(p.companyId)).filter((r) => r.voucherId === a.voucherId && r.qtyG < 0);
    expect(movedByA.length).toBe(2);
    await expectConsistent(p.owner, p.companyId, "move vs move (same target)");
  });

  test("move vs move to different yards: the later write wins and the ledger follows", async () => {
    const p = await plant();
    const bs = await packInto(p, p.loc("Y1"), 3);
    env.beforeNextBatch(() => p.owner.stock.move({ bundleIds: [bs[0]!.id, bs[1]!.id], toLocationId: p.loc("Y3") }));
    const a = await p.owner.stock.move({ bundleIds: bs.map((b) => b.id), toLocationId: p.loc("Y2") });
    expect(a.moved).toBe(3);
    const rows = await env.db.select().from(bundle).where(eq(bundle.companyId, p.companyId));
    expect(rows.every((b) => b.locationId === p.loc("Y2"))).toBe(true);
    // A's − rows left Y3 for the two B had moved, Y1 for the third.
    const outA = (await ledgerRows(p.companyId)).filter((r) => r.voucherId === a.voucherId && r.qtyG < 0);
    expect(outA.map((r) => r.locationId).sort()).toEqual([p.loc("Y1"), p.loc("Y3"), p.loc("Y3")].sort());
    await expectConsistent(p.owner, p.companyId, "move vs move (different targets)");
  });

  test("move vs void: a bundle voided after the move's read is skipped and not counted", async () => {
    const p = await plant();
    const bs = await packInto(p, p.loc("Y1"), 2);
    env.beforeNextBatch(() => p.owner.bundle.transitionStatus({ id: bs[0]!.id, toStatus: "void", reason: "bent" }));
    const out = await p.owner.stock.move({ bundleIds: bs.map((b) => b.id), toLocationId: p.loc("Y2") });
    expect(out.moved).toBe(1);
    const [voided] = await env.db.select().from(bundle).where(eq(bundle.id, bs[0]!.id));
    expect(voided).toMatchObject({ status: "void", locationId: p.loc("Y1") });
    await expectConsistent(p.owner, p.companyId, "move vs void");

    // All skipped: a no-op, no voucher.
    env.beforeNextBatch(() => p.owner.bundle.transitionStatus({ id: bs[1]!.id, toStatus: "void", reason: "bent" }));
    const none = await p.owner.stock.move({ bundleIds: [bs[1]!.id], toLocationId: p.loc("Y3") });
    expect(none).toMatchObject({ moved: 0, voucherId: null });
    await expectConsistent(p.owner, p.companyId, "move vs void (nothing moved)");
  });

  test("void vs move: a move that lands before the void's write is voided where it now sits", async () => {
    const p = await plant();
    const [b] = await packInto(p, p.loc("Y1"));
    env.beforeNextBatch(() => p.owner.stock.move({ bundleIds: [b!.id], toLocationId: p.loc("Y4") }));
    await p.owner.bundle.transitionStatus({ id: b!.id, toStatus: "void", reason: "bent" });
    const rows = (await ledgerRows(p.companyId)).filter((r) => r.itemRef === b!.id);
    const voidRow = rows.find((r) => r.voucherType === "void");
    expect(voidRow).toMatchObject({ locationId: p.loc("Y4"), qtyG: -25_000 });
    await expectConsistent(p.owner, p.companyId, "void vs move");
  });

  test("void vs reserve: whichever lands first, the ledger equals the bundle rows", async () => {
    // Reserve reads an available bundle; a void lands before the reserve writes.
    const a = await plant();
    const [b1, b2] = await packInto(a, a.loc("Y1"), 2);
    const d1 = await a.owner.dispatch.create({ customerId: a.customerId });
    await a.owner.dispatch.addBundle({ id: d1.id, bundleId: b1!.id });
    await a.owner.dispatch.addBundle({ id: d1.id, bundleId: b2!.id });
    env.beforeNextBatch(() => a.owner.bundle.transitionStatus({ id: b1!.id, toStatus: "void", reason: "bent" }));
    await a.owner.dispatch.reserve({ id: d1.id }).catch(() => null);
    const [v1] = await env.db.select().from(bundle).where(eq(bundle.id, b1!.id));
    expect(v1!.status).toBe("void");
    await expectConsistent(a.owner, a.companyId, "reserve lost to void");

    // Void reads an available bundle; a reserve lands before the void writes.
    const c = await plant();
    const [x] = await packInto(c, c.loc("Y1"), 1);
    const d2 = await c.owner.dispatch.create({ customerId: c.customerId });
    await c.owner.dispatch.addBundle({ id: d2.id, bundleId: x!.id });
    env.beforeNextBatch(() => c.owner.dispatch.reserve({ id: d2.id }));
    await c.owner.bundle.transitionStatus({ id: x!.id, toStatus: "void", reason: "bent" }).catch(() => null);
    const [after] = await env.db.select().from(bundle).where(eq(bundle.id, x!.id));
    expect(["void", "reserved"]).toContain(after!.status);
    await expectConsistent(c.owner, c.companyId, "void lost to reserve");
  });
});

describe("dev seed", () => {
  test("creates Y1-Y6, BILLET, SCRAP (+ STORE, PLANT-SCRAP), yards its bundles and opens the ledger; re-runnable", async () => {
    // Pre-create the dev logins so the seed skips Better Auth sign-up.
    for (const key of ["owner", "operator", "viewer", "staff"]) {
      await env.db.insert(user).values({ id: `dev-user-${key}`, name: key, email: `${key}@orrn.local` });
    }
    // Non-literal specifier: apps/server is not part of this package's TypeScript project.
    const seedPath = "../../../apps/server/src/dev-seed";
    const { seedDevData } = (await import(seedPath)) as {
      seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
    };
    const companyId = "dev-company-orrn";
    for (let run = 0; run < 2; run += 1) {
      expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
      const codes = (await env.db.select().from(location).where(eq(location.companyId, companyId))).map((l) => l.code);
      expect(codes.sort()).toEqual(
        ["Y1", "Y2", "Y3", "Y4", "Y5", "Y6", "BILLET", "SCRAP", "STORE", "PLANT-SCRAP"].sort(),
      );
      const bundles = await env.db.select().from(bundle).where(eq(bundle.companyId, companyId));
      expect(bundles.every((b) => b.locationId?.startsWith("dev-loc-Y"))).toBe(true);
      await expectConsistent(env.caller({ role: "owner", companyId }), companyId, `dev seed run ${run}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Permission matrix rows for this stage's actions
// ---------------------------------------------------------------------------

describe("permission matrix: stock actions", () => {
  type Case = { name: string; action: Action; run: (api: Api, p: Awaited<ReturnType<typeof plant>>) => Promise<unknown> };
  const cases: Case[] = [
    {
      name: "stock.move",
      action: "stock.move",
      run: async (api, p) => {
        const res = await p.owner.bundle.createReceipt({ dieId: p.dieId, unit: "pcs", locationId: p.loc("Y1"), rows: [row()] });
        const [b] = await env.db.select({ id: bundle.id }).from(bundle).where(eq(bundle.groupId, res.groupId));
        return api.stock.move({ bundleIds: [b!.id], toLocationId: p.loc("Y2") });
      },
    },
    { name: "stock.locations.create", action: "masters.publish", run: (api) => api.stock.locations.create({ code: "Q1", name: "Q", kind: "yard" }) },
    { name: "stock.locations.update", action: "masters.publish", run: (api, p) => api.stock.locations.update({ id: p.loc("Y1"), name: "Renamed" }) },
    { name: "stock.locations.seedDefaults", action: "masters.publish", run: (api) => api.stock.locations.seedDefaults() },
    {
      name: "stock.openingBalance",
      action: "masters.publish",
      run: async (api, p) => {
        await env.seedBundles(p.companyId, p.dieId, 1);
        return api.stock.openingBalance();
      },
    },
  ];

  for (const tc of cases) {
    describe(tc.name, () => {
      for (const role of ROLES) {
        const allowed = can({ company: { role }, isPlatformAdmin: false, platformRole: null }, tc.action);
        test(`${role} -> ${allowed ? "allowed" : "FORBIDDEN"} (${tc.action})`, async () => {
          const p = await plant();
          const api = env.caller({ role, companyId: p.companyId });
          const result = tc.run(api, p);
          if (allowed) {
            await expect(result).resolves.toBeDefined();
          } else {
            await expect(result).rejects.toMatchObject({ code: "FORBIDDEN" });
          }
        });
      }
    });
  }

  test("pack and void use the plant keys (same holders as the legacy keys)", () => {
    for (const role of ROLES) {
      const me = { company: { role }, isPlatformAdmin: false, platformRole: null };
      expect(can(me, "bundle.pack")).toBe(can(me, "bundle.create"));
      expect(can(me, "bundle.void")).toBe(can(me, "bundle.transition"));
    }
  });

  test("balance and byLocation are readable by every member", async () => {
    const p = await plant();
    for (const role of ROLES) {
      const api = env.caller({ role, companyId: p.companyId });
      await expect(api.stock.balance({})).resolves.toBeDefined();
      await expect(api.stock.byLocation()).resolves.toBeDefined();
      await expect(api.stock.locations.list()).resolves.toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Append-only, by construction: no code path updates or deletes ledger rows
// ---------------------------------------------------------------------------

describe("stock_ledger is append-only in code", () => {
  const repo = join(dirname(fileURLToPath(import.meta.url)), "../../..");
  const roots = ["packages/server/src", "packages/db/src", "apps/server/src", "apps/web/src", "apps/native"];
  /** The dev seed wipes and re-creates its own demo company; that reset is the one allowed DELETE. */
  const DELETE_ALLOWED = new Set(["apps/server/src/dev-seed.ts"]);

  function walk(dir: string, out: string[] = []): string[] {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      return out;
    }
    for (const name of names) {
      if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.(ts|tsx|sql)$/.test(name)) out.push(path);
    }
    return out;
  }

  test("no UPDATE (and no DELETE outside the dev-seed reset) on stock_ledger", () => {
    const updates: string[] = [];
    const deletes: string[] = [];
    for (const root of roots) {
      for (const file of walk(join(repo, root))) {
        const rel = relative(repo, file);
        const text = readFileSync(file, "utf8");
        if (/\.update\(\s*stockLedger\b/.test(text) || /\bupdate\s+[`"']?stock_ledger\b/i.test(text)) updates.push(rel);
        if (
          (/\.delete\(\s*stockLedger\b/.test(text) || /\bdelete\s+from\s+[`"']?stock_ledger\b/i.test(text)) &&
          !DELETE_ALLOWED.has(rel)
        ) {
          deletes.push(rel);
        }
      }
    }
    expect(updates).toEqual([]);
    expect(deletes).toEqual([]);
  });
});
