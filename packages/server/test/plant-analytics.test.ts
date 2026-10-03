/**
 * PL-A1: role-gated analytics reads (analytics addendum §2 A1/A4/A5, §3).
 *
 * Data is seeded straight into the tables (bundles, dispatches, items, packing lists) so each test
 * controls the exact instants it buckets. Instants are written as IST wall clock (+05:30), the
 * default company timezone.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { bundle, bundleGroup, customer, dispatch, dispatchItem, packingList } from "@orrn/db/schema";
import type { DispatchStatus } from "@orrn/db/schema/dispatch";
import { eq } from "drizzle-orm";

import { can, type Action } from "../src/lib/permissions";
import { createTestEnv, D1_MAX_PARAMS, type BundleStatus, type CompanyRole, type TestEnv } from "./harness";

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

const ROLES: CompanyRole[] = [
  "owner", "admin", "manager", "office", "accountant", "supervisor", "packer",
  "foundry", "press", "storekeeper", "die_room", "operator", "viewer",
];
const ALLOWED: CompanyRole[] = ["owner", "admin", "manager", "office", "accountant"];

/** IST wall clock → instant. */
const ist = (wall: string) => new Date(`${wall}+05:30`);
const id = () => crypto.randomUUID();

type Line = { dieId: string; weightG: number; quantity?: number };
type Rows = {
  groups: (typeof bundleGroup.$inferInsert)[];
  bundles: (typeof bundle.$inferInsert)[];
  dispatches: (typeof dispatch.$inferInsert)[];
  items: (typeof dispatchItem.$inferInsert)[];
  pls: (typeof packingList.$inferInsert)[];
};
const emptyRows = (): Rows => ({ groups: [], bundles: [], dispatches: [], items: [], pls: [] });

let seq = 0;
/** Adds one dispatch (with its own bundle group and bundles) to `rows`; returns the dispatch id. */
function buildDispatch(
  rows: Rows,
  companyId: string,
  customerId: string,
  at: Date,
  lines: Line[],
  opts: { status?: DispatchStatus; pl?: string; deleted?: boolean; code?: string } = {},
) {
  seq += 1;
  const status = opts.status ?? "completed";
  const groupId = id();
  const dispatchId = id();
  rows.groups.push({ id: groupId, companyId, code: `G${seq}-${groupId.slice(0, 8)}`, dieId: lines[0]!.dieId, unit: "pcs" });
  const bundleStatus: BundleStatus = status === "completed" ? "dispatched" : status === "cancelled" ? "available" : "reserved";
  lines.forEach((l, i) => {
    const bundleId = id();
    rows.bundles.push({
      id: bundleId,
      companyId,
      groupId,
      dieId: l.dieId,
      serial: `S${seq}-${i}-${groupId.slice(0, 8)}`,
      quantity: l.quantity ?? 10,
      weightG: l.weightG,
      lengthMm: 3_658,
      status: bundleStatus,
      createdAt: new Date(at.getTime() - 86_400_000),
    });
    rows.items.push({ id: id(), companyId, dispatchId, bundleId });
  });
  rows.dispatches.push({
    id: dispatchId,
    companyId,
    code: opts.code ?? `DN-${seq}`,
    customerId,
    status,
    completedAt: status === "completed" ? at : null,
    createdAt: at,
    deletedAt: opts.deleted ? at : null,
  });
  if (opts.pl) rows.pls.push({ id: id(), companyId, dispatchId, code: opts.pl, snapshot: {} });
  return dispatchId;
}

async function insertChunked<T>(rows: T[], size: number, insert: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

async function flush(rows: Rows) {
  await insertChunked(rows.groups, 5, (p) => env.db.insert(bundleGroup).values(p));
  await insertChunked(rows.bundles, 5, (p) => env.db.insert(bundle).values(p));
  await insertChunked(rows.dispatches, 5, (p) => env.db.insert(dispatch).values(p));
  await insertChunked(rows.items, 10, (p) => env.db.insert(dispatchItem).values(p));
  await insertChunked(rows.pls, 10, (p) => env.db.insert(packingList).values(p));
}

async function seedDispatch(...args: Parameters<typeof buildDispatch> extends [Rows, ...infer R] ? R : never) {
  const rows = emptyRows();
  const dispatchId = buildDispatch(rows, ...args);
  await flush(rows);
  return dispatchId;
}

/** One in-stock (or other status) bundle packed at `createdAt`. */
async function seedStock(companyId: string, dieId: string, createdAt: Date, weightG: number, status: BundleStatus = "available") {
  seq += 1;
  const groupId = id();
  await env.db.insert(bundleGroup).values({ id: groupId, companyId, code: `SG${seq}-${groupId.slice(0, 8)}`, dieId, unit: "pcs" });
  await env.db.insert(bundle).values({
    id: id(),
    companyId,
    groupId,
    dieId,
    serial: `SS${seq}-${groupId.slice(0, 8)}`,
    quantity: 10,
    weightG,
    lengthMm: 3_658,
    status,
    createdAt,
  });
}

async function namedCustomer(companyId: string, name: string) {
  const customerId = id();
  await env.db.insert(customer).values({ id: customerId, companyId, name });
  return customerId;
}

async function plant(settings?: Record<string, unknown>) {
  const { companyId } = await env.seedCompany({ settings });
  const owner = env.caller({ role: "owner", companyId });
  const dieId = await env.seedDie(companyId, { series: "Domal", sectionCode: "12170" });
  const customerId = await env.seedCustomer(companyId);
  return { companyId, owner, dieId, customerId };
}

const kg = (n: number) => n * 1000;
/** The procedure's own NOT_FOUND (tRPC's "no procedure" is NOT_FOUND too). */
const customerNotFound = { code: "NOT_FOUND", message: "Customer not found" };

describe("analytics.view permission (A1)", () => {
  test("exactly owner, admin, manager, office and accountant hold it", () => {
    for (const role of ROLES) {
      expect({ role, ok: can({ company: { role }, isPlatformAdmin: false, platformRole: null }, "analytics.view" as Action) }).toEqual({
        role,
        ok: ALLOWED.includes(role),
      });
    }
  });

  test("every procedure: allowed roles succeed, floor roles and viewer get FORBIDDEN", async () => {
    const p = await plant();
    await seedDispatch(p.companyId, p.customerId, ist("2026-09-10T10:00:00"), [{ dieId: p.dieId, weightG: kg(500) }]);
    setClock(ist("2026-10-03T12:00:00"));
    for (const role of ROLES) {
      const api = env.caller({ role, companyId: p.companyId });
      const calls: [string, () => Promise<unknown>][] = [
        ["customerSummary", () => api.analytics.customerSummary({ customerId: p.customerId, from: "2026-01-01", to: "2026-11-01" })],
        ["customerLeaderboard", () => api.analytics.customerLeaderboard({ from: "2026-09-01", to: "2026-10-01" })],
        ["trends", () => api.analytics.trends({})],
        ["stockAgeing", () => api.analytics.stockAgeing()],
        ["dispatchVolume", () => api.analytics.dispatchVolume({})],
      ];
      for (const [name, call] of calls) {
        if (ALLOWED.includes(role)) {
          await expect(call().then(() => `${role} ${name} ok`)).resolves.toBe(`${role} ${name} ok`);
        } else {
          await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
        }
      }
    }
  });
});

describe("tenant isolation", () => {
  test("another plant's dispatches, stock and customers are never counted or visible", async () => {
    const a = await plant();
    const b = await plant();
    setClock(ist("2026-10-03T12:00:00"));
    await seedDispatch(a.companyId, a.customerId, ist("2026-09-15T10:00:00"), [{ dieId: a.dieId, weightG: kg(100) }]);
    await seedDispatch(b.companyId, b.customerId, ist("2026-09-15T10:00:00"), [{ dieId: b.dieId, weightG: kg(9_000) }]);
    await seedStock(a.companyId, a.dieId, ist("2026-10-01T10:00:00"), kg(7));
    await seedStock(b.companyId, b.dieId, ist("2026-10-01T10:00:00"), kg(70_000));

    const board = await a.owner.analytics.customerLeaderboard({ from: "2026-09-01", to: "2026-10-01" });
    expect(board.totalKgG).toBe(kg(100));
    expect(board.rows.map((r) => r.customerId)).toEqual([a.customerId]);

    const vol = await a.owner.analytics.dispatchVolume({ months: 2 });
    expect(vol.map((m) => m.kgG)).toEqual([kg(100), 0]);

    const days = await a.owner.analytics.trends({ days: 30 });
    expect(days.reduce((s, d) => s + d.dispatchedKgG, 0)).toBe(kg(100));
    expect(days.reduce((s, d) => s + d.packedKgG, 0)).toBe(kg(100) + kg(7));

    const ageing = await a.owner.analytics.stockAgeing();
    expect(ageing.totals).toEqual({ bundles: 1, kgG: kg(7) });

    await expect(
      a.owner.analytics.customerSummary({ customerId: b.customerId, from: "2026-01-01", to: "2026-11-01" }),
    ).rejects.toMatchObject(customerNotFound);
    await expect(
      a.owner.analytics.customerSummary({ customerId: "no-such-customer", from: "2026-01-01", to: "2026-11-01" }),
    ).rejects.toMatchObject(customerNotFound);
  });

  test("the x-orrn-company header picks the tenant; a member of both plants sees each plant's numbers", async () => {
    const a = await plant();
    const b = await plant();
    await seedDispatch(a.companyId, a.customerId, ist("2026-09-15T10:00:00"), [{ dieId: a.dieId, weightG: kg(11) }]);
    await seedDispatch(b.companyId, b.customerId, ist("2026-09-15T10:00:00"), [{ dieId: b.dieId, weightG: kg(22) }]);
    const userId = await env.seedUser("two plants");
    await env.addMembership(userId, a.companyId, "manager");
    await env.addMembership(userId, b.companyId, "operator");

    const inA = env.callerForUser(userId, { company: a.companyId });
    const res = await inA.analytics.customerLeaderboard({ from: "2026-09-01", to: "2026-10-01" });
    expect(res.totalKgG).toBe(kg(11));
    // Operator in plant B: no analytics there.
    const inB = env.callerForUser(userId, { company: b.companyId });
    await expect(inB.analytics.customerLeaderboard({ from: "2026-09-01", to: "2026-10-01" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("company-timezone buckets (A4)", () => {
  test("23:50 IST on the last day of a month stays in that month; 00:10 IST next day is the next month", async () => {
    const p = await plant();
    setClock(ist("2026-10-03T12:00:00"));
    // 23:50 IST 31 Aug = 18:20Z 31 Aug; 00:10 IST 1 Sep = 18:40Z 31 Aug (still August in UTC).
    await seedDispatch(p.companyId, p.customerId, ist("2026-08-31T23:50:00"), [{ dieId: p.dieId, weightG: kg(10) }]);
    await seedDispatch(p.companyId, p.customerId, ist("2026-09-01T00:10:00"), [{ dieId: p.dieId, weightG: kg(20) }]);

    const sum = await p.owner.analytics.customerSummary({
      customerId: p.customerId,
      from: "2026-08-01",
      to: "2026-10-01",
      bucket: "month",
    });
    expect(sum.series).toEqual([
      { bucketStart: "2026-08-01", kgG: kg(10), dispatches: 1 },
      { bucketStart: "2026-09-01", kgG: kg(20), dispatches: 1 },
    ]);

    const vol = await p.owner.analytics.dispatchVolume({ months: 3 });
    expect(vol).toEqual([
      { month: "2026-08", kgG: kg(10), dispatches: 1 },
      { month: "2026-09", kgG: kg(20), dispatches: 1 },
      { month: "2026-10", kgG: 0, dispatches: 0 },
    ]);

    const days = await p.owner.analytics.trends({ days: 40 });
    expect(days.find((d) => d.date === "2026-08-31")?.dispatchedKgG).toBe(kg(10));
    expect(days.find((d) => d.date === "2026-09-01")?.dispatchedKgG).toBe(kg(20));

    // Range edges are local midnights too: a September range excludes 23:50 IST 31 Aug.
    const sep = await p.owner.analytics.customerLeaderboard({ from: "2026-09-01", to: "2026-10-01" });
    expect(sep.totalKgG).toBe(kg(20));
    const aug = await p.owner.analytics.customerLeaderboard({ from: "2026-08-01", to: "2026-09-01" });
    expect(aug.totalKgG).toBe(kg(10));
  });

  test("weeks start on Monday in company time", async () => {
    const p = await plant();
    // Sun 6 Sep 2026 23:50 IST → week of Mon 31 Aug; Mon 7 Sep 00:10 IST → week of 7 Sep.
    await seedDispatch(p.companyId, p.customerId, ist("2026-09-06T23:50:00"), [{ dieId: p.dieId, weightG: kg(1) }]);
    await seedDispatch(p.companyId, p.customerId, ist("2026-09-07T00:10:00"), [{ dieId: p.dieId, weightG: kg(2) }]);
    const sum = await p.owner.analytics.customerSummary({
      customerId: p.customerId,
      from: "2026-09-01",
      to: "2026-09-15",
      bucket: "week",
    });
    expect(sum.series).toEqual([
      { bucketStart: "2026-08-31", kgG: kg(1), dispatches: 1 },
      { bucketStart: "2026-09-07", kgG: kg(2), dispatches: 1 },
      { bucketStart: "2026-09-14", kgG: 0, dispatches: 0 },
    ]);
  });

  test("a company in a DST zone buckets by its offset on each side of the change", async () => {
    const p = await plant({ timezone: "America/New_York" });
    setClock(new Date("2026-11-05T12:00:00-05:00"));
    // DST ends 1 Nov 2026 02:00 EDT. 23:30 EST on 1 Nov = 04:30Z 2 Nov; a fixed EDT offset would say 00:30 2 Nov.
    await seedDispatch(p.companyId, p.customerId, new Date("2026-11-01T23:30:00-05:00"), [{ dieId: p.dieId, weightG: kg(3) }]);
    // 23:30 EDT on 31 Oct = 03:30Z 1 Nov.
    await seedDispatch(p.companyId, p.customerId, new Date("2026-10-31T23:30:00-04:00"), [{ dieId: p.dieId, weightG: kg(4) }]);
    const days = await p.owner.analytics.trends({ days: 10 });
    expect(days.at(-1)?.date).toBe("2026-11-05");
    expect(days.find((d) => d.date === "2026-11-01")?.dispatchedKgG).toBe(kg(3));
    expect(days.find((d) => d.date === "2026-10-31")?.dispatchedKgG).toBe(kg(4));
    expect(days.find((d) => d.date === "2026-11-02")?.dispatchedKgG).toBe(0);
  });
});

describe("customerSummary", () => {
  test("totals, first/last, recent dispatches with PL number, completed only", async () => {
    const p = await plant();
    setClock(ist("2026-10-03T12:00:00"));
    const other = await env.seedCustomer(p.companyId);
    await seedDispatch(p.companyId, p.customerId, ist("2026-05-10T10:00:00"), [{ dieId: p.dieId, weightG: kg(100), quantity: 20 }]);
    const last = await seedDispatch(
      p.companyId,
      p.customerId,
      ist("2026-09-21T15:00:00"),
      [
        { dieId: p.dieId, weightG: kg(300), quantity: 30 },
        { dieId: p.dieId, weightG: kg(200), quantity: 10 },
      ],
      { pl: "PL/26-27/0042", code: "DN-LAST" },
    );
    // None of these count: draft, reserved, cancelled, deleted, other customer.
    await seedDispatch(p.companyId, p.customerId, ist("2026-09-22T10:00:00"), [{ dieId: p.dieId, weightG: kg(999) }], { status: "draft" });
    await seedDispatch(p.companyId, p.customerId, ist("2026-09-22T10:00:00"), [{ dieId: p.dieId, weightG: kg(999) }], { status: "reserved" });
    await seedDispatch(p.companyId, p.customerId, ist("2026-09-22T10:00:00"), [{ dieId: p.dieId, weightG: kg(999) }], { status: "cancelled" });
    await seedDispatch(p.companyId, p.customerId, ist("2026-09-22T10:00:00"), [{ dieId: p.dieId, weightG: kg(999) }], { deleted: true });
    await seedDispatch(p.companyId, other, ist("2026-09-22T10:00:00"), [{ dieId: p.dieId, weightG: kg(999) }]);

    const s = await p.owner.analytics.customerSummary({ customerId: p.customerId, from: "2026-04-01", to: "2026-10-04" });
    expect(s.customer.id).toBe(p.customerId);
    expect(typeof s.customer.name).toBe("string");
    expect(s.totals).toEqual({ dispatches: 2, bundles: 3, kgG: kg(600), pieces: 60, avgLoadKgG: kg(300) });
    expect(s.firstDispatchAt).toBe(ist("2026-05-10T10:00:00").toISOString());
    expect(s.lastDispatchAt).toBe(ist("2026-09-21T15:00:00").toISOString());
    expect(s.daysSinceLast).toBe(12);
    expect(s.recentDispatches[0]).toEqual({
      id: last,
      code: "DN-LAST",
      completedAt: ist("2026-09-21T15:00:00").toISOString(),
      bundles: 2,
      kgG: kg(500),
      plNumber: "PL/26-27/0042",
    });
    expect(s.recentDispatches[1]?.plNumber).toBeNull();
    expect(s.openOrders).toBeNull();
    // Monthly buckets cover the whole range, zero-filled.
    expect(s.series.map((b) => b.bucketStart)).toEqual([
      "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01",
    ]);
    expect(s.series.reduce((t, b) => t + b.kgG, 0)).toBe(kg(600));
  });

  test("recent dispatches: the latest 10, newest first", async () => {
    const p = await plant();
    const rows = emptyRows();
    for (let d = 1; d <= 14; d += 1) {
      buildDispatch(rows, p.companyId, p.customerId, ist(`2026-09-${String(d).padStart(2, "0")}T10:00:00`), [
        { dieId: p.dieId, weightG: kg(d) },
      ], { code: `DN-${d}` });
    }
    await flush(rows);
    const s = await p.owner.analytics.customerSummary({ customerId: p.customerId, from: "2026-09-01", to: "2026-10-01" });
    expect(s.recentDispatches.map((r) => r.code)).toEqual(
      [14, 13, 12, 11, 10, 9, 8, 7, 6, 5].map((d) => `DN-${d}`),
    );
    expect(s.recentDispatches.map((r) => r.kgG)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5].map(kg));
  });

  test("top sections: 8 plus an Other row with the remainder; no Other row when there is none", async () => {
    const p = await plant();
    const dies: string[] = [];
    for (let i = 0; i < 10; i += 1) dies.push(await env.seedDie(p.companyId, { series: "S", sectionCode: `SEC${i}` }));
    // Section i weighs (10 - i) × 10 kg: 100, 90, …, 10.
    await seedDispatch(
      p.companyId,
      p.customerId,
      ist("2026-09-10T10:00:00"),
      dies.map((dieId, i) => ({ dieId, weightG: kg((10 - i) * 10) })),
    );
    const s = await p.owner.analytics.customerSummary({ customerId: p.customerId, from: "2026-09-01", to: "2026-10-01" });
    expect(s.topSections).toHaveLength(9);
    expect(s.topSections.slice(0, 8).map((r) => r.sectionId)).toEqual(dies.slice(0, 8));
    expect(s.topSections[0]).toEqual({ sectionId: dies[0]!, label: "S SEC0", kgG: kg(100), bundles: 1, sharePct: 18.2 });
    expect(s.topSections[8]).toEqual({ sectionId: null, label: "Other", kgG: kg(30), bundles: 2, sharePct: 5.5 });
    expect(s.topSections.reduce((t, r) => t + r.kgG, 0)).toBe(s.totals.kgG);

    const q = await plant();
    const eight: string[] = [];
    for (let i = 0; i < 8; i += 1) eight.push(await env.seedDie(q.companyId, { series: "S", sectionCode: `E${i}` }));
    await seedDispatch(q.companyId, q.customerId, ist("2026-09-10T10:00:00"), eight.map((dieId) => ({ dieId, weightG: kg(5) })));
    const t = await q.owner.analytics.customerSummary({ customerId: q.customerId, from: "2026-09-01", to: "2026-10-01" });
    expect(t.topSections).toHaveLength(8);
    expect(t.topSections.every((r) => r.sectionId !== null)).toBe(true);
  });

  test("cadence is the median gap in days between consecutive completed dispatches", async () => {
    const p = await plant();
    const at = (day: number) => ist(`2026-09-${String(day).padStart(2, "0")}T10:00:00`);
    // Gaps 2, 7, 1 → median 2.
    for (const d of [1, 3, 10, 11]) await seedDispatch(p.companyId, p.customerId, at(d), [{ dieId: p.dieId, weightG: kg(1) }]);
    const odd = await p.owner.analytics.customerSummary({ customerId: p.customerId, from: "2026-09-01", to: "2026-10-01" });
    expect(odd.cadenceDays).toBe(2);

    // Gaps 2, 4, 6, 10 → median 5.
    const q = await plant();
    for (const d of [1, 3, 7, 13, 23]) await seedDispatch(q.companyId, q.customerId, at(d), [{ dieId: q.dieId, weightG: kg(1) }]);
    const even = await q.owner.analytics.customerSummary({ customerId: q.customerId, from: "2026-09-01", to: "2026-10-01" });
    expect(even.cadenceDays).toBe(5);

    // Half-day gaps keep their fraction (one decimal).
    const r = await plant();
    await seedDispatch(r.companyId, r.customerId, ist("2026-09-01T06:00:00"), [{ dieId: r.dieId, weightG: kg(1) }]);
    await seedDispatch(r.companyId, r.customerId, ist("2026-09-02T18:00:00"), [{ dieId: r.dieId, weightG: kg(1) }]);
    const half = await r.owner.analytics.customerSummary({ customerId: r.customerId, from: "2026-09-01", to: "2026-10-01" });
    expect(half.cadenceDays).toBe(1.5);

    // One dispatch: no cadence.
    const one = await plant();
    await seedDispatch(one.companyId, one.customerId, at(5), [{ dieId: one.dieId, weightG: kg(1) }]);
    const single = await one.owner.analytics.customerSummary({ customerId: one.customerId, from: "2026-09-01", to: "2026-10-01" });
    expect(single.cadenceDays).toBeNull();
  });

  test("a soft-deleted customer is not found", async () => {
    const p = await plant();
    await env.db.update(customer).set({ deletedAt: new Date() }).where(eq(customer.id, p.customerId));
    await expect(
      p.owner.analytics.customerSummary({ customerId: p.customerId, from: "2026-09-01", to: "2026-10-01" }),
    ).rejects.toMatchObject(customerNotFound);
  });
});

describe("customerLeaderboard", () => {
  test("ranks, shares, previous-period ranks and deltas; top limit plus Other", async () => {
    const p = await plant();
    const [a, b, c, d, e] = [
      await namedCustomer(p.companyId, "Asha Traders"),
      await namedCustomer(p.companyId, "Bharat Windows"),
      await namedCustomer(p.companyId, "Chetak Glass"),
      await namedCustomer(p.companyId, "Deep Aluminium"),
      await namedCustomer(p.companyId, "Ekta Fabricators"),
    ];
    const rows = emptyRows();
    const put = (cust: string, wall: string, kgs: number) =>
      buildDispatch(rows, p.companyId, cust, ist(wall), [{ dieId: p.dieId, weightG: kg(kgs) }]);
    // Current period: September 2026 (30 days). Previous: 2 Aug – 31 Aug (same 30 days, immediately before).
    put(a, "2026-09-05T10:00:00", 400);
    put(a, "2026-09-25T10:00:00", 100); // a: 500 over 2 dispatches
    put(b, "2026-09-10T10:00:00", 300);
    put(c, "2026-09-12T10:00:00", 150);
    put(d, "2026-09-30T23:50:00", 50); // last minute of the period (IST)
    // Previous period.
    put(b, "2026-08-02T00:05:00", 400); // first minutes of the previous period
    put(a, "2026-08-20T10:00:00", 200);
    put(e, "2026-08-21T10:00:00", 100); // e has nothing this period
    // Outside both periods: ignored.
    put(c, "2026-08-01T23:50:00", 5_000);
    put(c, "2026-10-01T00:05:00", 5_000);
    await flush(rows);

    const res = await p.owner.analytics.customerLeaderboard({ from: "2026-09-01", to: "2026-10-01", limit: 3 });
    expect(res.period).toEqual({ from: "2026-09-01", to: "2026-10-01" });
    expect(res.previous).toEqual({ from: "2026-08-02", to: "2026-09-01" });
    expect(res.totalKgG).toBe(kg(1_000));
    expect(res.otherKgG).toBe(kg(50));
    expect(res.rows).toEqual([
      { customerId: a, name: "Asha Traders", kgG: kg(500), sharePct: 50, dispatches: 2, rank: 1, previousRank: 2, deltaPct: 150 },
      { customerId: b, name: "Bharat Windows", kgG: kg(300), sharePct: 30, dispatches: 1, rank: 2, previousRank: 1, deltaPct: -25 },
      { customerId: c, name: "Chetak Glass", kgG: kg(150), sharePct: 15, dispatches: 1, rank: 3, previousRank: null, deltaPct: null },
    ]);

    const all = await p.owner.analytics.customerLeaderboard({ from: "2026-09-01", to: "2026-10-01" });
    expect(all.rows.map((r) => r.customerId)).toEqual([a, b, c, d]);
    expect(all.otherKgG).toBe(0);
    expect(all.rows.find((r) => r.customerId === e)).toBeUndefined();
  });

  test("ties break by name so ranks are stable", async () => {
    const p = await plant();
    const z = await namedCustomer(p.companyId, "Zeta");
    const a = await namedCustomer(p.companyId, "Alpha");
    await seedDispatch(p.companyId, z, ist("2026-09-10T10:00:00"), [{ dieId: p.dieId, weightG: kg(10) }]);
    await seedDispatch(p.companyId, a, ist("2026-09-11T10:00:00"), [{ dieId: p.dieId, weightG: kg(10) }]);
    const res = await p.owner.analytics.customerLeaderboard({ from: "2026-09-01", to: "2026-10-01" });
    expect(res.rows.map((r) => [r.name, r.rank])).toEqual([["Alpha", 1], ["Zeta", 2]]);
  });
});

describe("trends, dispatch volume and stock ageing", () => {
  test("trends: one row per company day ending today; packed excludes void bundles", async () => {
    const p = await plant();
    setClock(ist("2026-10-03T00:30:00"));
    await seedStock(p.companyId, p.dieId, ist("2026-10-02T23:59:00"), kg(5));
    await seedStock(p.companyId, p.dieId, ist("2026-10-03T00:01:00"), kg(6), "reserved");
    await seedStock(p.companyId, p.dieId, ist("2026-10-03T00:02:00"), kg(7), "void");
    const days = await p.owner.analytics.trends({ days: 3 });
    expect(days).toEqual([
      { date: "2026-10-01", packedKgG: 0, dispatchedKgG: 0 },
      { date: "2026-10-02", packedKgG: kg(5), dispatchedKgG: 0 },
      { date: "2026-10-03", packedKgG: kg(6), dispatchedKgG: 0 },
    ]);
    expect(await p.owner.analytics.trends({})).toHaveLength(90);
  });

  test("dispatch volume: months ending this month, zero-filled", async () => {
    const p = await plant();
    setClock(ist("2026-10-03T12:00:00"));
    await seedDispatch(p.companyId, p.customerId, ist("2025-11-01T00:10:00"), [{ dieId: p.dieId, weightG: kg(8) }]);
    await seedDispatch(p.companyId, p.customerId, ist("2025-10-31T23:50:00"), [{ dieId: p.dieId, weightG: kg(9) }]);
    const vol = await p.owner.analytics.dispatchVolume({});
    expect(vol).toHaveLength(12);
    expect(vol[0]).toEqual({ month: "2025-11", kgG: kg(8), dispatches: 1 });
    expect(vol.at(-1)?.month).toBe("2026-10");
    expect(vol.reduce((t, m) => t + m.kgG, 0)).toBe(kg(8));
  });

  test("stock ageing: bucket edges by days since pack, available + reserved only, top sections", async () => {
    const p = await plant();
    const nowAt = ist("2026-10-03T12:00:00");
    setClock(nowAt);
    const ago = (days: number, extraMs = 0) => new Date(nowAt.getTime() - days * 86_400_000 - extraMs);
    await seedStock(p.companyId, p.dieId, ago(0), kg(1));
    await seedStock(p.companyId, p.dieId, ago(15, 3_600_000), kg(2)); // 15 days 1 h → 0–15
    await seedStock(p.companyId, p.dieId, ago(16), kg(3), "reserved"); // → 16–30
    await seedStock(p.companyId, p.dieId, ago(30, 60_000), kg(4)); // → 16–30
    await seedStock(p.companyId, p.dieId, ago(31), kg(5)); // → 31–60
    await seedStock(p.companyId, p.dieId, ago(60, 60_000), kg(6)); // → 31–60
    await seedStock(p.companyId, p.dieId, ago(61), kg(7)); // → 60+
    await seedStock(p.companyId, p.dieId, ago(400), kg(8)); // → 60+
    await seedStock(p.companyId, p.dieId, ago(90), kg(900), "dispatched");
    await seedStock(p.companyId, p.dieId, ago(90), kg(900), "void");

    const res = await p.owner.analytics.stockAgeing();
    expect(res.asOf).toBe(nowAt.toISOString());
    expect(res.totals).toEqual({ bundles: 8, kgG: kg(36) });
    expect(res.buckets).toEqual([
      { key: "0-15", minDays: 0, maxDays: 15, bundles: 2, kgG: kg(3) },
      { key: "16-30", minDays: 16, maxDays: 30, bundles: 2, kgG: kg(7) },
      { key: "31-60", minDays: 31, maxDays: 60, bundles: 2, kgG: kg(11) },
      { key: "60+", minDays: 61, maxDays: null, bundles: 2, kgG: kg(15) },
    ]);
    expect(res.topSections).toEqual([{ sectionId: p.dieId, label: "Domal 12170", kgG: kg(36), bundles: 8, sharePct: 100 }]);
  });

  test("stock ageing folds sections beyond 8 into Other", async () => {
    const p = await plant();
    for (let i = 0; i < 10; i += 1) {
      const dieId = await env.seedDie(p.companyId, { series: "S", sectionCode: `A${i}` });
      await seedStock(p.companyId, dieId, new Date(), kg(10 - i));
    }
    const res = await p.owner.analytics.stockAgeing();
    expect(res.topSections).toHaveLength(9);
    expect(res.topSections[8]).toMatchObject({ sectionId: null, label: "Other", kgG: kg(3), bundles: 2 });
  });
});

describe("empty data", () => {
  test("every procedure returns zeros and empty lists, never an error", async () => {
    const p = await plant();
    setClock(ist("2026-10-03T12:00:00"));
    const s = await p.owner.analytics.customerSummary({ customerId: p.customerId, from: "2026-09-01", to: "2026-10-01" });
    expect(s).toEqual({
      customer: { id: p.customerId, name: expect.any(String) },
      totals: { dispatches: 0, bundles: 0, kgG: 0, pieces: 0, avgLoadKgG: 0 },
      firstDispatchAt: null,
      lastDispatchAt: null,
      daysSinceLast: null,
      series: [{ bucketStart: "2026-09-01", kgG: 0, dispatches: 0 }],
      topSections: [],
      recentDispatches: [],
      cadenceDays: null,
      openOrders: null,
    });
    expect(await p.owner.analytics.customerLeaderboard({ from: "2026-09-01", to: "2026-10-01" })).toEqual({
      period: { from: "2026-09-01", to: "2026-10-01" },
      previous: { from: "2026-08-02", to: "2026-09-01" },
      rows: [],
      otherKgG: 0,
      totalKgG: 0,
    });
    const days = await p.owner.analytics.trends({ days: 7 });
    expect(days).toHaveLength(7);
    expect(days.every((d) => d.packedKgG === 0 && d.dispatchedKgG === 0)).toBe(true);
    const ageing = await p.owner.analytics.stockAgeing();
    expect(ageing.totals).toEqual({ bundles: 0, kgG: 0 });
    expect(ageing.buckets.map((b) => [b.key, b.bundles, b.kgG])).toEqual([
      ["0-15", 0, 0], ["16-30", 0, 0], ["31-60", 0, 0], ["60+", 0, 0],
    ]);
    expect(ageing.topSections).toEqual([]);
    const vol = await p.owner.analytics.dispatchVolume({ months: 1 });
    expect(vol).toEqual([{ month: "2026-10", kgG: 0, dispatches: 0 }]);
  });
});

describe("input validation", () => {
  test("from before to, at most 3 years, and bounded days / months / limit", async () => {
    const p = await plant();
    const api = p.owner.analytics;
    const bad = { code: "BAD_REQUEST" };
    await expect(api.customerLeaderboard({ from: "2026-09-01", to: "2026-09-01" })).rejects.toMatchObject(bad);
    await expect(api.customerLeaderboard({ from: "2026-09-02", to: "2026-09-01" })).rejects.toMatchObject(bad);
    await expect(api.customerLeaderboard({ from: "2026-02-30", to: "2026-09-01" })).rejects.toMatchObject(bad);
    await expect(api.customerLeaderboard({ from: "2023-09-01", to: "2026-09-02" })).rejects.toMatchObject(bad);
    await expect(api.customerLeaderboard({ from: "2023-09-01", to: "2026-09-01" })).resolves.toBeDefined();
    await expect(
      api.customerSummary({ customerId: p.customerId, from: "2026-10-01", to: "2026-09-01" }),
    ).rejects.toMatchObject(bad);
    await expect(
      api.customerSummary({ customerId: p.customerId, from: "2020-01-01", to: "2026-09-01" }),
    ).rejects.toMatchObject(bad);
    await expect(api.customerLeaderboard({ from: "2026-09-01", to: "2026-10-01", limit: 0 })).rejects.toMatchObject(bad);
    await expect(api.customerLeaderboard({ from: "2026-09-01", to: "2026-10-01", limit: 26 })).rejects.toMatchObject(bad);
    await expect(api.customerLeaderboard({ from: "2026-09-01", to: "2026-10-01", limit: 25 })).resolves.toBeDefined();
    await expect(api.trends({ days: 0 })).rejects.toMatchObject(bad);
    await expect(api.trends({ days: 367 })).rejects.toMatchObject(bad);
    await expect(api.trends({ days: 366 })).resolves.toHaveLength(366);
    await expect(api.dispatchVolume({ months: 0 })).rejects.toMatchObject(bad);
    await expect(api.dispatchVolume({ months: 37 })).rejects.toMatchObject(bad);
    await expect(api.dispatchVolume({ months: 36 })).resolves.toHaveLength(36);
  });
});

describe("D1 100-parameter limit", () => {
  test("250 customers and 250 dispatches for one customer: every statement stays within 100 params", async () => {
    const p = await plant();
    setClock(ist("2026-10-03T12:00:00"));
    const customers = Array.from({ length: 250 }, (_, i) => ({ id: id(), companyId: p.companyId, name: `Cust ${String(i).padStart(3, "0")}` }));
    await insertChunked(customers, 20, (part) => env.db.insert(customer).values(part));
    const rows = emptyRows();
    customers.forEach((c, i) => {
      buildDispatch(rows, p.companyId, c.id, ist("2026-09-15T10:00:00"), [{ dieId: p.dieId, weightG: kg(i + 1) }]);
      buildDispatch(rows, p.companyId, c.id, ist("2026-08-15T10:00:00"), [{ dieId: p.dieId, weightG: kg(250 - i) }]);
    });
    for (let i = 0; i < 250; i += 1) {
      const day = new Date(ist("2025-10-05T10:00:00").getTime() + i * 86_400_000);
      buildDispatch(rows, p.companyId, p.customerId, day, [{ dieId: p.dieId, weightG: kg(2) }], { pl: `PL-${i}` });
    }
    await flush(rows);

    env.resetPeakParams();
    const board = await p.owner.analytics.customerLeaderboard({ from: "2026-09-01", to: "2026-10-01", limit: 25 });
    expect(board.rows).toHaveLength(25);
    expect(board.rows[0]).toMatchObject({ name: "Cust 249", rank: 1, previousRank: 250 });
    expect(board.totalKgG).toBe(kg((250 * 251) / 2));
    expect(board.otherKgG).toBe(board.totalKgG - board.rows.reduce((t, r) => t + r.kgG, 0));

    const s = await p.owner.analytics.customerSummary({ customerId: p.customerId, from: "2025-10-01", to: "2026-10-01", bucket: "week" });
    expect(s.totals.dispatches).toBe(250);
    expect(s.cadenceDays).toBe(1);
    await p.owner.analytics.trends({ days: 366 });
    await p.owner.analytics.dispatchVolume({ months: 36 });
    await p.owner.analytics.stockAgeing();
    const peak = env.peakParams();
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(D1_MAX_PARAMS);
    // Aggregation is in SQL: no statement's parameter count grows with the data.
    expect(peak).toBeLessThanOrEqual(12);
  });
});
