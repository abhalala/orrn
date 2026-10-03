/**
 * PL-10: stock count and phantom report (spec P6, §5 "Count close"; digest Stage 14).
 *
 * A count covers yard locations; every bundle there is scanned; close freezes the report:
 * - phantom: in stock at a counted location, not seen anywhere in the count;
 * - moved: seen at a counted location, the system had it at another counted location;
 * - found: seen, but not in the system there (unknown code, not in stock, or elsewhere).
 * Close posts no kg rows. Phantoms are voided only after a manager approves (phantom_void);
 * the void posts reversal rows. Found / moved bundles move to where they were seen.
 * Review Focus 1 is re-asserted: ledger balance per bundle and per location = the bundle rows.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import {
  approval,
  auditLog,
  bundle,
  bundleStatusEvent,
  countLine,
  countSeen,
  countSession,
  legacyBundleMap,
  stockLedger,
} from "@orrn/db/schema";
import { and, asc, eq } from "drizzle-orm";

import { can as canMe, type Action } from "../src/lib/permissions";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

// Fixtures make dozens of calls; a loaded machine (parallel agents) must not time them out.
setDefaultTimeout(60_000);

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

const can = (role: CompanyRole, action: Action) =>
  canMe({ company: { role }, isPlatformAdmin: false, platformRole: null }, action);

const COUNTERS = ROLES.filter((r) => can(r, "stock.count"));
const NOT_COUNTERS = ROLES.filter((r) => !can(r, "stock.count"));

const row = (weightG = 25_000) => ({ quantity: 10, weightG, lengthMm: 3_658 });

async function plant() {
  const { companyId, users } = await env.seedCompany();
  const as = Object.fromEntries(ROLES.map((role) => [role, env.caller({ role, companyId })])) as Record<
    CompanyRole,
    Api
  >;
  await as.owner.stock.locations.seedDefaults();
  const locs = (await as.owner.stock.locations.list()).items;
  const loc = (code: string) => {
    const l = locs.find((x) => x.code === code);
    if (!l) throw new Error(`no location ${code}`);
    return l.id;
  };
  const dieId = await env.seedDie(companyId);
  const customerId = await env.seedCustomer(companyId);

  /** Pack `n` bundles at a yard; returns them in serial order. */
  async function pack(code: string, n: number, weightG = 25_000) {
    const out: { id: string; serial: string; weightG: number }[] = [];
    for (let i = 0; i < n; i += 100) {
      const res = await as.owner.bundle.createReceipt({
        dieId,
        unit: "pcs",
        locationId: loc(code),
        rows: Array.from({ length: Math.min(100, n - i) }, () => row(weightG)),
      });
      const rows = await env.db
        .select({ id: bundle.id, serial: bundle.serial, weightG: bundle.weightG })
        .from(bundle)
        .where(eq(bundle.groupId, res.groupId))
        .orderBy(asc(bundle.serial));
      out.push(...rows);
    }
    return out;
  }

  async function dispatchOut(bundleIds: string[]) {
    const { id } = await as.owner.dispatch.create({ customerId });
    for (const bundleId of bundleIds) await as.owner.dispatch.addBundle({ id, bundleId });
    await as.owner.dispatch.reserve({ id });
    await as.owner.dispatch.complete({ id });
    return id;
  }

  async function reserveOn(bundleIds: string[]) {
    const { id } = await as.owner.dispatch.create({ customerId });
    for (const bundleId of bundleIds) await as.owner.dispatch.addBundle({ id, bundleId });
    await as.owner.dispatch.reserve({ id });
    return id;
  }

  return { companyId, users, ...as, as, locs, loc, dieId, customerId, pack, dispatchOut, reserveOn };
}

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

const sorted = (m: Map<string, number>) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b));

/** Review Focus 1: ledger per bundle+location and per location equals the projection. */
async function expectConsistent(api: Api, companyId: string, label: string) {
  const proj = await projection(companyId);
  const { items } = await api.stock.balance({ itemKind: "bundle" });
  const led = new Map(items.map((i) => [`${i.itemRef}|${i.locationId}`, i.qtyG ?? 0]));
  expect({ label, rows: sorted(led) }).toEqual({ label, rows: sorted(proj) });
  const perLoc = new Map<string, number>();
  for (const [key, g] of proj) {
    const l = key.split("|")[1]!;
    perLoc.set(l, (perLoc.get(l) ?? 0) + g);
  }
  const summary = await api.stock.byLocation();
  const fromSummary = new Map<string, number>();
  for (const l of summary.locations) {
    const g = l.totals.find((t) => t.itemKind === "bundle")?.qtyG ?? 0;
    if (g !== 0) fromSummary.set(l.id, g);
  }
  const unlocated = summary.unlocated.find((t) => t.itemKind === "bundle")?.qtyG ?? 0;
  if (unlocated !== 0) fromSummary.set("null", unlocated);
  expect({ label, perLocation: sorted(fromSummary) }).toEqual({ label, perLocation: sorted(perLoc) });
}

async function ledgerRows(companyId: string) {
  return env.db
    .select()
    .from(stockLedger)
    .where(eq(stockLedger.companyId, companyId))
    .orderBy(asc(stockLedger.postedAt), asc(stockLedger.serverSeq), asc(stockLedger.line));
}

async function bundleRow(id: string) {
  const [b] = await env.db.select().from(bundle).where(eq(bundle.id, id));
  return b!;
}

async function auditActions(companyId: string) {
  return (await env.db.select().from(auditLog).where(eq(auditLog.companyId, companyId))).map((r) => r.action);
}

async function linesOf(sessionId: string) {
  return env.db.select().from(countLine).where(eq(countLine.sessionId, sessionId));
}

/** Narrow a resolve result to its action (the procedure returns a union keyed by `action`). */
function voided<T extends { action: string }>(r: T): Extract<T, { action: "void_phantom" }> {
  if (r.action !== "void_phantom") throw new Error(`expected void_phantom, got ${r.action}`);
  return r as Extract<T, { action: "void_phantom" }>;
}
function movedFound<T extends { action: string }>(r: T): Extract<T, { action: "move_found" }> {
  if (r.action !== "move_found") throw new Error(`expected move_found, got ${r.action}`);
  return r as Extract<T, { action: "move_found" }>;
}

const ids = (xs: { bundleId: string }[]) => xs.map((x) => x.bundleId).sort();
const idsOf = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

/**
 * The classification fixture: count over Y1 + Y2.
 *   Y1: a, b (seen at Y1 → matched), c (not seen → phantom)
 *   Y2: d (seen at Y1 → moved)
 *   Y3: e (outside the count, seen at Y1 → found, elsewhere)
 *   f void, g dispatched (seen → found, not in stock)
 *   h legacy, no location, off ledger (seen → found, elsewhere)
 *   "NOPE-404" and another company's serial (seen → found, unknown)
 */
async function classified() {
  const p = await plant();
  const other = await plant();
  const [a, b, c] = await p.pack("Y1", 3, 25_000);
  const [d] = await p.pack("Y2", 1, 31_500);
  const [e] = await p.pack("Y3", 1);
  const [f, g] = await p.pack("Y1", 2);
  await p.owner.bundle.transitionStatus({ id: f!.id, toStatus: "void", reason: "bent" });
  await p.dispatchOut([g!.id]);
  const [h] = await env.seedBundles(p.companyId, p.dieId, 1);
  // Cutover: legacy stock is taken onto the ledger where it is (place unknown).
  await p.owner.stock.openingBalance();
  // Receipt serials (BG-000001-B001) repeat across companies; a seeded serial is unique.
  const [x] = await env.seedBundles(other.companyId, other.dieId, 1);

  const started = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
  const scan = await p.supervisor.count.scan({
    sessionId: started.id,
    locationId: p.loc("Y1"),
    codes: [a!.serial, b!.serial, d!.serial, e!.serial, f!.serial, g!.serial, h!.serial, "NOPE-404", x!.serial],
  });
  return { p, other, a: a!, b: b!, c: c!, d: d!, e: e!, f: f!, g: g!, h: h!, x: x!, started, scan };
}

// ---------------------------------------------------------------------------
// count.start
// ---------------------------------------------------------------------------

describe("count.start", () => {
  test("starts a count over yard locations: CNT-1 then CNT-2, open, locations listed, audited", async () => {
    const p = await plant();
    const one = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")], note: "Quarterly" });
    expect(one.number).toBe("CNT-1");
    const two = await p.office.count.start({ locationIds: [p.loc("Y3")] });
    expect(two.number).toBe("CNT-2");

    const got = await p.viewer.count.get({ sessionId: one.id });
    expect(got.session.status).toBe("open");
    expect(got.session.number).toBe("CNT-1");
    expect(got.session.note).toBe("Quarterly");
    expect(got.locations.map((l) => l.code).sort()).toEqual(["Y1", "Y2"]);
    expect(got.scans).toEqual([]);

    const [s] = await env.db.select().from(countSession).where(eq(countSession.id, one.id));
    expect(s!.companyId).toBe(p.companyId);
    expect(s!.startSeq).toBeGreaterThan(0);
    expect(s!.createdBy).toBe(p.users.supervisor.id);
    expect(await auditActions(p.companyId)).toContain("count.start");

    const listed = await p.viewer.count.list({});
    expect(listed.items.map((i) => i.number)).toEqual(["CNT-2", "CNT-1"]);
    expect(listed.items[1]!.locationCodes.sort()).toEqual(["Y1", "Y2"]);
  });

  test("validation: at least one location, yards only, active only; another company's location is NOT_FOUND", async () => {
    const p = await plant();
    const other = await plant();
    await expect(p.supervisor.count.start({ locationIds: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.supervisor.count.start({ locationIds: [p.loc("BILLET")] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(p.supervisor.count.start({ locationIds: [other.loc("Y1")] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await p.owner.stock.locations.update({ id: p.loc("Y6"), active: false });
    await expect(p.supervisor.count.start({ locationIds: [p.loc("Y6")] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    // Duplicates collapse to one location.
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y1")] });
    expect((await p.supervisor.count.get({ sessionId: s.id })).locations).toHaveLength(1);
    expect(await env.db.select().from(countSession).where(eq(countSession.companyId, p.companyId))).toHaveLength(1);
  });

  test("a location already in an open count is CONFLICT naming that count; free again after close or cancel", async () => {
    const p = await plant();
    const one = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await expect(p.office.count.start({ locationIds: [p.loc("Y2"), p.loc("Y1")] })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("CNT-1"),
    });
    await p.supervisor.count.close({ sessionId: one.id });
    const two = await p.office.count.start({ locationIds: [p.loc("Y1")] });
    await p.office.count.cancel({ sessionId: two.id, reason: "Started on the wrong yard" });
    const three = await p.office.count.start({ locationIds: [p.loc("Y1")] });
    expect(three.number).toBe("CNT-3");
  });

  test("RACE: two starts over the same yard at once — exactly one lands", async () => {
    const p = await plant();
    const results = await Promise.allSettled([
      p.supervisor.count.start({ locationIds: [p.loc("Y1")] }),
      p.office.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: "CONFLICT" });
    expect(
      await env.db
        .select()
        .from(countSession)
        .where(and(eq(countSession.companyId, p.companyId), eq(countSession.status, "open"))),
    ).toHaveLength(1);
  });

  test("RACE: another start lands between this start's read and write — CONFLICT, nothing half-written", async () => {
    const p = await plant();
    env.beforeNextBatch(() => p.office.count.start({ locationIds: [p.loc("Y1")] }));
    await expect(p.supervisor.count.start({ locationIds: [p.loc("Y2"), p.loc("Y1")] })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const sessions = await env.db.select().from(countSession).where(eq(countSession.companyId, p.companyId));
    expect(sessions).toHaveLength(1);
    // Y2 was not locked by the failed start.
    await p.supervisor.count.start({ locationIds: [p.loc("Y2")] });
  });
});

// ---------------------------------------------------------------------------
// count.scan
// ---------------------------------------------------------------------------

describe("count.scan", () => {
  test("records each scan with its location and gives floor feedback (here / moved / elsewhere / not in stock / unknown)", async () => {
    const { p, a, b, d, e, f, g, h, scan, started } = await classified();
    expect(scan.recorded).toBe(9);
    expect(scan.duplicates).toBe(0);
    const match = Object.fromEntries(scan.results.map((r) => [r.code, r.match]));
    expect(match[a.serial]).toBe("here");
    expect(match[b.serial]).toBe("here");
    expect(match[d.serial]).toBe("moved");
    expect(match[e.serial]).toBe("elsewhere");
    expect(match[f.serial]).toBe("not_in_stock");
    expect(match[g.serial]).toBe("not_in_stock");
    expect(match[h.serial]).toBe("elsewhere");
    expect(match["NOPE-404"]).toBe("unknown");
    const dRes = scan.results.find((r) => r.code === d.serial)!;
    expect(dRes.bundle).toMatchObject({ id: d.id, serial: d.serial, locationId: p.loc("Y2"), weightG: 31_500 });

    const seen = await env.db.select().from(countSeen).where(eq(countSeen.sessionId, started.id));
    expect(seen).toHaveLength(9);
    expect(seen.every((s) => s.locationId === p.loc("Y1") && s.companyId === p.companyId)).toBe(true);
    expect(seen.filter((s) => s.bundleId === null).map((s) => s.resolveKind).sort()).toEqual(["not_found", "not_found"]);

    const got = await p.viewer.count.get({ sessionId: started.id });
    expect(got.scans).toHaveLength(9);
    expect(got.scans.find((s) => s.bundleId === a.id)).toMatchObject({ serial: a.serial, locationCode: "Y1" });
  });

  test("duplicates are ignored: the same code twice, another form of the same code, repeats in one request", async () => {
    const p = await plant();
    const [a, b] = await p.pack("Y1", 2);
    const s = await p.packer.count.start({ locationIds: [p.loc("Y1")] });
    const first = await p.packer.count.scan({ sessionId: s.id, codes: [a!.serial, a!.serial, ` ${a!.serial.toLowerCase()} `] });
    expect(first.recorded).toBe(1);
    expect(first.duplicates).toBe(2);
    expect(first.results.map((r) => r.outcome)).toEqual(["recorded", "duplicate", "duplicate"]);
    const again = await p.packer.count.scan({ sessionId: s.id, codes: [`https://orrn.in/b/${a!.serial}`, b!.serial] });
    expect(again.results.map((r) => r.outcome)).toEqual(["duplicate", "recorded"]);
    expect(again.results[0]!.firstLocationId).toBe(p.loc("Y1"));
    // An unknown code repeated is also recorded once.
    await p.packer.count.scan({ sessionId: s.id, codes: ["ZZ-1"] });
    const rep = await p.packer.count.scan({ sessionId: s.id, codes: ["ZZ-1"] });
    expect(rep.results[0]!.outcome).toBe("duplicate");
    expect(await env.db.select().from(countSeen).where(eq(countSeen.sessionId, s.id))).toHaveLength(3);
  });

  test("the old cuid label and the bundle's number are the same bundle: counted once (legacy coexistence)", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const cuid = "ckz3p1x9q0000abcd1234efgh";
    await env.db.insert(legacyBundleMap).values({ id: crypto.randomUUID(), companyId: p.companyId, legacyId: cuid, bundleId: a!.id });
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const r = await p.supervisor.count.scan({ sessionId: s.id, codes: [cuid, a!.serial] });
    expect(r.results.map((x) => [x.outcome, x.match, x.bundle?.id])).toEqual([
      ["recorded", "here", a!.id],
      ["duplicate", "here", a!.id],
    ]);
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(report.summary).toMatchObject({ expected: 1, seen: 1, matched: 1, phantom: 0 });
  });

  test("a count over two locations needs the location; a location outside the count is BAD_REQUEST", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
    await expect(p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y3"), codes: [a!.serial] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: [] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: Array.from({ length: 201 }, (_, i) => `C${i}`) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // One-location counts default to that location.
    const one = await p.supervisor.count.start({ locationIds: [p.loc("Y4")] });
    const r = await p.supervisor.count.scan({ sessionId: one.id, codes: [a!.serial] });
    expect(r.results[0]!.match).toBe("elsewhere");
  });

  test("another company's bundle code is recorded as unknown (never resolved across tenants)", async () => {
    const { x, scan } = await classified();
    const res = scan.results.find((r) => r.code === x.serial)!;
    expect(res.match).toBe("unknown");
    expect(res.bundle).toBeNull();
  });

  test("RACE: two people scan the same bundle at once — recorded once, the other hears duplicate", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const [r1, r2] = await Promise.all([
      p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] }),
      p.packer.count.scan({ sessionId: s.id, codes: [a!.serial.toLowerCase()] }),
    ]);
    expect([r1.results[0]!.outcome, r2.results[0]!.outcome].sort()).toEqual(["duplicate", "recorded"]);
    expect(await env.db.select().from(countSeen).where(eq(countSeen.sessionId, s.id))).toHaveLength(1);
    // Deterministic interleave: the other scan lands between this scan's read and write.
    const [b] = await p.pack("Y1", 1);
    env.beforeNextBatch(() => p.packer.count.scan({ sessionId: s.id, codes: [b!.serial] }));
    const late = await p.supervisor.count.scan({ sessionId: s.id, codes: [b!.serial] });
    expect(late.results[0]!.outcome).toBe("duplicate");
    expect(await env.db.select().from(countSeen).where(eq(countSeen.sessionId, s.id))).toHaveLength(2);
  });

  test("RACE: the count is closed between the scan's read and write — nothing is recorded, BAD_REQUEST", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    env.beforeNextBatch(() => p.office.count.close({ sessionId: s.id }));
    await expect(p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await env.db.select().from(countSeen).where(eq(countSeen.sessionId, s.id))).toHaveLength(0);
    // Closed counts take no scans at all.
    await expect(p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("removeScans takes back scans while open (wrong location picked); never after close", async () => {
    const p = await plant();
    const [a, b] = await p.pack("Y2", 2);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
    const wrong = await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: [a!.serial, b!.serial] });
    expect(wrong.results.map((r) => r.match)).toEqual(["moved", "moved"]);
    const removed = await p.supervisor.count.removeScans({
      sessionId: s.id,
      seenIds: wrong.results.map((r) => r.seenId!),
    });
    expect(removed.removed).toBe(2);
    const right = await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y2"), codes: [a!.serial, b!.serial] });
    expect(right.results.map((r) => r.match)).toEqual(["here", "here"]);
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(report.moved).toEqual([]);
    expect(report.phantom).toEqual([]);
    await expect(
      p.supervisor.count.removeScans({ sessionId: s.id, seenIds: right.results.map((r) => r.seenId!) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await env.db.select().from(countSeen).where(eq(countSeen.sessionId, s.id))).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// count.close: classification
// ---------------------------------------------------------------------------

describe("count.close classification", () => {
  test("phantom / moved / found are classified and frozen; close posts no ledger rows", async () => {
    const { p, a, b, c, d, e, f, g, h, x, started } = await classified();
    const before = await ledgerRows(p.companyId);
    const report = await p.supervisor.count.close({ sessionId: started.id });
    expect((await ledgerRows(p.companyId)).length).toBe(before.length);

    expect(ids(report.phantom)).toEqual([c.id]);
    expect(report.phantom[0]).toMatchObject({
      bundleId: c.id,
      serial: c.serial,
      weightG: 25_000,
      status: "available",
      systemLocationCode: "Y1",
      seenLocationId: null,
      resolution: "open",
    });
    expect(report.phantom[0]!.lineId).toBeTruthy();

    expect(ids(report.moved)).toEqual([d.id]);
    expect(report.moved[0]).toMatchObject({ systemLocationCode: "Y2", seenLocationCode: "Y1", weightG: 31_500 });

    const found = Object.fromEntries(report.found.map((l) => [l.code, l]));
    expect(Object.keys(found).sort()).toEqual([e.serial, f.serial, g.serial, h.serial, "NOPE-404", x.serial].sort());
    expect(found[e.serial]).toMatchObject({ reason: "elsewhere", seenLocationCode: "Y1" });
    expect(found[e.serial]!.resolvedBundle).toMatchObject({ bundleId: e.id, systemLocationCode: "Y3", status: "available" });
    expect(found[f.serial]).toMatchObject({ reason: "not_in_stock" });
    expect(found[f.serial]!.resolvedBundle).toMatchObject({ bundleId: f.id, status: "void" });
    expect(found[g.serial]!.resolvedBundle).toMatchObject({ bundleId: g.id, status: "dispatched" });
    expect(found[h.serial]).toMatchObject({ reason: "elsewhere" });
    expect(found[h.serial]!.resolvedBundle).toMatchObject({ bundleId: h.id, systemLocationId: null });
    expect(found["NOPE-404"]).toMatchObject({ reason: "unknown", resolvedBundle: null });
    expect(found[x.serial]).toMatchObject({ reason: "unknown", resolvedBundle: null });

    // a and b matched: on no line.
    const lines = await linesOf(started.id);
    expect(lines.map((l) => l.bundleId)).not.toContain(a.id);
    expect(lines.map((l) => l.bundleId)).not.toContain(b.id);
    expect(lines).toHaveLength(8);
    expect(lines.every((l) => l.companyId === p.companyId)).toBe(true);

    expect(report.summary).toEqual({
      expected: 4,
      seen: 9,
      matched: 2,
      phantom: 1,
      phantomG: 25_000,
      found: 6,
      moved: 1,
      changed: 0,
      phantomBp: 2_500,
    });
    expect(report.status).toBe("closed");
    expect(report.frozen).toBe(true);

    const got = await p.viewer.count.get({ sessionId: started.id });
    expect(got.session.status).toBe("closed");
    expect(got.report.summary).toEqual(report.summary);
    expect(ids(got.report.phantom)).toEqual([c.id]);
    expect(await auditActions(p.companyId)).toContain("count.close");
  });

  test("the missing list is shown before close: count.get previews the same classification live", async () => {
    const { p, c, d, started } = await classified();
    const preview = (await p.viewer.count.get({ sessionId: started.id })).report;
    expect(preview.frozen).toBe(false);
    expect(ids(preview.phantom)).toEqual([c.id]);
    expect(ids(preview.moved)).toEqual([d.id]);
    expect(preview.found).toHaveLength(6);
    expect(preview.phantom[0]!.lineId).toBeNull();
    // Nothing persisted by a preview.
    expect(await linesOf(started.id)).toHaveLength(0);
    const closed = await p.supervisor.count.close({ sessionId: started.id });
    expect(closed.summary).toEqual(preview.summary);
  });

  test("a bundle packed into a counted yard after the count began is not called a phantom", async () => {
    const p = await plant();
    const [a, b] = await p.pack("Y1", 2);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] });
    const late = await p.pack("Y1", 3); // packed while the yard was being counted
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(ids(report.phantom)).toEqual([b!.id]);
    expect(report.summary.changed).toBe(3);
    expect(report.summary.expected).toBe(2);
    expect(report.phantom.map((x) => x.bundleId)).not.toContain(late[0]!.id);
  });

  test("a bundle moved after it was scanned is not reported (the system is newer than the scan)", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const [b] = await p.pack("Y2", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: [a!.serial, b!.serial] });
    await p.owner.stock.move({ bundleIds: [a!.id], toLocationId: p.loc("Y5") });
    await p.owner.stock.move({ bundleIds: [b!.id], toLocationId: p.loc("Y1") });
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(report.phantom).toEqual([]);
    expect(report.moved).toEqual([]);
    expect(report.found).toEqual([]);
  });

  test("close is idempotent; RACE: two concurrent closes write one set of lines", async () => {
    const { p, started } = await classified();
    const [r1, r2] = await Promise.all([
      p.supervisor.count.close({ sessionId: started.id }),
      p.office.count.close({ sessionId: started.id }),
    ]);
    expect(r1.summary).toEqual(r2.summary);
    expect(await linesOf(started.id)).toHaveLength(8);
    const again = await p.supervisor.count.close({ sessionId: started.id });
    expect(again.summary).toEqual(r1.summary);
    expect(await linesOf(started.id)).toHaveLength(8);
    expect((await auditActions(p.companyId)).filter((a) => a === "count.close")).toHaveLength(1);
  });

  test("RACE: a bundle is dispatched between close's read and write — it is not a phantom", async () => {
    const p = await plant();
    const [a, b] = await p.pack("Y1", 2);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    env.beforeNextBatch(() => p.dispatchOut([b!.id]));
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(ids(report.phantom)).toEqual([a!.id]);
  });

  test("cancel: reason required, releases the locations, reports nothing; only open counts", async () => {
    const p = await plant();
    await p.pack("Y1", 2);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await expect(p.supervisor.count.cancel({ sessionId: s.id, reason: " " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await p.supervisor.count.cancel({ sessionId: s.id, reason: "Rain stopped the count" });
    const got = await p.viewer.count.get({ sessionId: s.id });
    expect(got.session).toMatchObject({ status: "cancelled", cancelReason: "Rain stopped the count" });
    expect(got.report.phantom).toEqual([]);
    expect(await linesOf(s.id)).toHaveLength(0);
    await expect(p.supervisor.count.close({ sessionId: s.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.supervisor.count.cancel({ sessionId: s.id, reason: "again" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const closed = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.close({ sessionId: closed.id });
    await expect(p.supervisor.count.cancel({ sessionId: closed.id, reason: "late" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await auditActions(p.companyId)).toContain("count.cancel");
  });

  test("phantoms are grouped by cast and by age (days since packed, at close)", async () => {
    const p = await plant();
    const base = Date.UTC(2026, 6, 1, 6, 0, 0);
    setClock(new Date(base));
    const old = await p.pack("Y1", 2, 20_000);
    const fresh = await p.pack("Y1", 1, 30_000);
    await env.db.update(bundle).set({ createdAt: new Date(base - 70 * 86_400_000), castId: "cast-a" }).where(eq(bundle.id, old[0]!.id));
    await env.db.update(bundle).set({ createdAt: new Date(base - 20 * 86_400_000), castId: "cast-a" }).where(eq(bundle.id, old[1]!.id));
    await env.db.update(bundle).set({ createdAt: new Date(base - 2 * 86_400_000) }).where(eq(bundle.id, fresh[0]!.id));
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(report.byCast).toEqual([
      { castId: "cast-a", bundles: 2, weightG: 40_000 },
      { castId: null, bundles: 1, weightG: 30_000 },
    ]);
    expect(report.byAge).toEqual([
      { bucket: "0-15", bundles: 1, weightG: 30_000 },
      { bucket: "16-30", bundles: 1, weightG: 20_000 },
      { bucket: "31-60", bundles: 0, weightG: 0 },
      { bucket: "60+", bundles: 1, weightG: 20_000 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// count.resolve: void_phantom (approval phantom_void)
// ---------------------------------------------------------------------------

async function closedWithPhantoms(n = 3) {
  const p = await plant();
  const yard = await p.pack("Y1", n + 1);
  const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
  await p.supervisor.count.scan({ sessionId: s.id, codes: [yard[0]!.serial] });
  const report = await p.supervisor.count.close({ sessionId: s.id });
  expect(report.phantom).toHaveLength(n);
  return { p, s, seen: yard[0]!, phantoms: yard.slice(1), report };
}

describe("count.resolve void_phantom", () => {
  test("opens one phantom_void approval for the count; lines wait; the requester cannot approve", async () => {
    const { p, s, phantoms } = await closedWithPhantoms(3);
    const res = voided(await p.supervisor.count.resolve({
      sessionId: s.id,
      action: "void_phantom",
      bundleIds: phantoms.map((b) => b.id),
      note: "Searched the whole yard twice",
    }));
    expect(res.requested).toBe(3);
    const [ap] = await env.db.select().from(approval).where(eq(approval.id, res.approvalId));
    expect(ap).toMatchObject({ kind: "phantom_void", subjectId: s.id, status: "pending", requestedBy: p.users.supervisor.id });
    expect(ap!.meta).toMatchObject({ number: "CNT-1", bundles: 3, weightG: 75_000 });
    const lines = (await linesOf(s.id)).filter((l) => l.kind === "phantom");
    expect(lines.every((l) => l.resolution === "void_requested" && l.approvalId === res.approvalId)).toBe(true);
    // Bundles untouched until the decision.
    for (const b of phantoms) expect((await bundleRow(b.id)).status).toBe("available");
    await expect(p.supervisor.approval.decide({ id: res.approvalId, decision: "approved" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const report = (await p.viewer.count.get({ sessionId: s.id })).report;
    expect(report.pendingApprovalId).toBe(res.approvalId);
    expect(report.phantom.every((x) => x.resolution === "void_requested")).toBe(true);
    expect(await auditActions(p.companyId)).toContain("count.voidRequested");
  });

  test("the owner cannot approve their own request", async () => {
    const { p, s, phantoms } = await closedWithPhantoms(1);
    const res = voided(await p.owner.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [phantoms[0]!.id] }));
    await expect(p.owner.approval.decide({ id: res.approvalId, decision: "approved" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("after manager approval: bundles void, reversal rows reference the pack rows, status events, lines voided", async () => {
    const { p, s, phantoms, seen } = await closedWithPhantoms(3);
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: phantoms.map((b) => b.id) }));
    const before = await ledgerRows(p.companyId);
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });

    for (const b of phantoms) expect((await bundleRow(b.id)).status).toBe("void");
    expect((await bundleRow(seen.id)).status).toBe("available");

    const after = await ledgerRows(p.companyId);
    const added = after.filter((r) => !before.some((x) => x.id === r.id));
    expect(added).toHaveLength(3);
    const lines = (await linesOf(s.id)).filter((l) => l.kind === "phantom");
    for (const r of added) {
      const pack = before.find((x) => x.itemRef === r.itemRef && x.voucherType === "pack")!;
      expect(r).toMatchObject({
        voucherType: "void",
        itemKind: "bundle",
        qtyG: -pack.qtyG,
        locationId: p.loc("Y1"),
        reversalOf: pack.id,
        createdBy: p.users.manager.id,
      });
      expect(r.reason).toContain("CNT-1");
      expect(lines.find((l) => l.bundleId === r.itemRef)!.id).toBe(r.voucherId);
    }
    expect(lines.every((l) => l.resolution === "voided" && l.resolvedBy === p.users.manager.id)).toBe(true);

    const events = await env.db
      .select()
      .from(bundleStatusEvent)
      .where(and(eq(bundleStatusEvent.companyId, p.companyId), eq(bundleStatusEvent.toStatus, "void")));
    expect(events.map((e) => e.bundleId).sort()).toEqual(idsOf(phantoms));
    expect(events.every((e) => e.fromStatus === "available" && e.reason?.includes("CNT-1"))).toBe(true);

    const bal = await p.owner.stock.balance({ itemKind: "bundle", locationId: p.loc("Y1") });
    expect(bal.items.map((i) => i.itemRef)).toEqual([seen.id]);
    await expectConsistent(p.owner, p.companyId, "after phantom void");
    const report = (await p.viewer.count.get({ sessionId: s.id })).report;
    expect(report.pendingApprovalId).toBeNull();
    expect(report.phantom.every((x) => x.resolution === "voided")).toBe(true);
    // Voided phantoms can't be requested again.
    await expect(
      p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [phantoms[0]!.id] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("rejection puts the lines back to open; no ledger rows; bundles stay available; a new request can follow", async () => {
    const { p, s, phantoms } = await closedWithPhantoms(2);
    const res = voided(await p.office.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: phantoms.map((b) => b.id) }));
    const before = await ledgerRows(p.companyId);
    await p.admin.approval.decide({ id: res.approvalId, decision: "rejected", note: "Look in Y6 first" });
    expect((await ledgerRows(p.companyId)).length).toBe(before.length);
    for (const b of phantoms) expect((await bundleRow(b.id)).status).toBe("available");
    expect((await linesOf(s.id)).every((l) => l.resolution === "open")).toBe(true);
    const again = voided(await p.office.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [phantoms[0]!.id] }));
    expect(again.requested).toBe(1);
  });

  test("only open phantom lines of this count; reserved phantoms are refused naming the dispatch; one pending request", async () => {
    const { p, s, phantoms, seen } = await closedWithPhantoms(3);
    // The matched bundle is not a phantom.
    await expect(
      p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [seen.id] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Unknown id.
    await expect(
      p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: ["nope"] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Reserved on a dispatch.
    await p.reserveOn([phantoms[0]!.id]);
    await expect(
      p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [phantoms[0]!.id] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("held by") });
    // One pending request per count.
    await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [phantoms[1]!.id] });
    await expect(
      p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [phantoms[2]!.id] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await linesOf(s.id)).find((l) => l.bundleId === phantoms[2]!.id)!.resolution).toBe("open");
  });

  test("resolve on an open or cancelled count is BAD_REQUEST", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const open = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await expect(
      p.supervisor.count.resolve({ sessionId: open.id, action: "void_phantom", bundleIds: [a!.id] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.supervisor.count.cancel({ sessionId: open.id, reason: "x" });
    await expect(
      p.supervisor.count.resolve({ sessionId: open.id, action: "move_found", bundleIds: [a!.id] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("RACE: a phantom turns up (moved) before the approval lands — it is cleared, not voided", async () => {
    const { p, s, phantoms } = await closedWithPhantoms(3);
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: phantoms.map((b) => b.id) }));
    env.beforeNextBatch(() => p.owner.stock.move({ bundleIds: [phantoms[0]!.id], toLocationId: p.loc("Y2") }));
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    expect((await bundleRow(phantoms[0]!.id)).status).toBe("available");
    expect((await bundleRow(phantoms[0]!.id)).locationId).toBe(p.loc("Y2"));
    expect((await bundleRow(phantoms[1]!.id)).status).toBe("void");
    expect((await bundleRow(phantoms[2]!.id)).status).toBe("void");
    const lines = await linesOf(s.id);
    expect(lines.find((l) => l.bundleId === phantoms[0]!.id)!.resolution).toBe("cleared");
    expect(lines.filter((l) => l.resolution === "voided")).toHaveLength(2);
    await expectConsistent(p.owner, p.companyId, "after race void");
  });

  test("a phantom seen in a later count or dispatched after the request is cleared, not voided", async () => {
    const { p, s, phantoms } = await closedWithPhantoms(3);
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: phantoms.map((b) => b.id) }));
    // Seen at Y1 in a later count (no move): it was there after all.
    const later = await p.office.count.start({ locationIds: [p.loc("Y1")] });
    await p.office.count.scan({ sessionId: later.id, codes: [phantoms[0]!.serial] });
    // Dispatched: it existed.
    await p.dispatchOut([phantoms[1]!.id]);
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    expect((await bundleRow(phantoms[0]!.id)).status).toBe("available");
    expect((await bundleRow(phantoms[1]!.id)).status).toBe("dispatched");
    expect((await bundleRow(phantoms[2]!.id)).status).toBe("void");
    const lines = await linesOf(s.id);
    expect(lines.filter((l) => l.resolution === "cleared").map((l) => l.bundleId).sort()).toEqual(
      [phantoms[0]!.id, phantoms[1]!.id].sort(),
    );
    await expectConsistent(p.owner, p.companyId, "after cleared void");
  });

  test("RACE: two concurrent void requests on one count — one approval", async () => {
    const { p, s, phantoms } = await closedWithPhantoms(2);
    const results = await Promise.allSettled([
      p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [phantoms[0]!.id] }),
      p.office.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [phantoms[1]!.id] }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const pending = await env.db
      .select()
      .from(approval)
      .where(and(eq(approval.companyId, p.companyId), eq(approval.kind, "phantom_void")));
    expect(pending).toHaveLength(1);
    expect((await linesOf(s.id)).filter((l) => l.resolution === "void_requested")).toHaveLength(1);
  });

  test("RACE: two approvers at once — one decision, one set of reversal rows", async () => {
    const { p, s, phantoms } = await closedWithPhantoms(2);
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: phantoms.map((b) => b.id) }));
    const before = (await ledgerRows(p.companyId)).length;
    const results = await Promise.allSettled([
      p.manager.approval.decide({ id: res.approvalId, decision: "approved" }),
      p.admin.approval.decide({ id: res.approvalId, decision: "approved" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await ledgerRows(p.companyId)).length).toBe(before + 2);
    await expectConsistent(p.owner, p.companyId, "after double approve");
  });
});

// ---------------------------------------------------------------------------
// count.resolve: move_found
// ---------------------------------------------------------------------------

describe("count.resolve move_found", () => {
  test("moves moved and found-elsewhere bundles to where they were seen with move rows; lines moved", async () => {
    const { p, d, e, h, started } = await classified();
    await p.supervisor.count.close({ sessionId: started.id });
    const before = await ledgerRows(p.companyId);
    const res = movedFound(await p.supervisor.count.resolve({ sessionId: started.id, action: "move_found", bundleIds: [d.id, e.id, h.id] }));
    expect(res.moved).toBe(3);
    expect(res.skipped).toEqual([]);
    for (const b of [d, e, h]) expect((await bundleRow(b.id)).locationId).toBe(p.loc("Y1"));

    const added = (await ledgerRows(p.companyId)).filter((r) => !before.some((x) => x.id === r.id));
    // d: − at Y2, + at Y1; e: − at Y3, + at Y1; h (legacy, place unknown): − at unknown, + at Y1.
    expect(added.every((r) => r.voucherType === "move")).toBe(true);
    const of = (id: string) => added.filter((r) => r.itemRef === id).map((r) => [r.locationId, r.qtyG]).sort();
    expect(of(d.id)).toEqual([[p.loc("Y1"), 31_500], [p.loc("Y2"), -31_500]].sort());
    expect(of(e.id)).toEqual([[p.loc("Y1"), 25_000], [p.loc("Y3"), -25_000]].sort());
    expect(of(h.id)).toEqual([[p.loc("Y1"), 25_000], [null, -25_000]].sort());

    const lines = await linesOf(started.id);
    for (const b of [d, e, h]) {
      const l = lines.find((x) => x.bundleId === b.id)!;
      expect(l.resolution).toBe("moved");
      expect(l.resolutionVoucherId).toBeTruthy();
    }
    expect(added.every((r) => r.voucherId === lines.find((l) => l.bundleId === d.id)!.resolutionVoucherId)).toBe(true);
    await expectConsistent(p.owner, p.companyId, "after move_found");
    expect(await auditActions(p.companyId)).toContain("count.moveFound");
  });

  test("void or dispatched found bundles, unknown codes and phantoms are refused; nothing moves", async () => {
    const { p, c, d, f, g, started } = await classified();
    await p.supervisor.count.close({ sessionId: started.id });
    for (const bad of [[f.id], [g.id], [c.id], [d.id, f.id]]) {
      await expect(
        p.supervisor.count.resolve({ sessionId: started.id, action: "move_found", bundleIds: bad }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect((await bundleRow(d.id)).locationId).toBe(p.loc("Y2"));
  });

  test("RACE: the bundle is moved elsewhere between read and write — it is not moved back; reported skipped", async () => {
    const { p, d, e, started } = await classified();
    await p.supervisor.count.close({ sessionId: started.id });
    env.beforeNextBatch(() => p.owner.stock.move({ bundleIds: [d.id], toLocationId: p.loc("Y5") }));
    const res = movedFound(await p.supervisor.count.resolve({ sessionId: started.id, action: "move_found", bundleIds: [d.id, e.id] }));
    expect(res.moved).toBe(1);
    expect(res.skipped).toEqual([d.id]);
    expect((await bundleRow(d.id)).locationId).toBe(p.loc("Y5"));
    expect((await bundleRow(e.id)).locationId).toBe(p.loc("Y1"));
    expect((await linesOf(started.id)).find((l) => l.bundleId === d.id)!.resolution).toBe("open");
    await expectConsistent(p.owner, p.companyId, "after race move_found");
  });

  test("a resolved line cannot be moved twice", async () => {
    const { p, d, started } = await classified();
    await p.supervisor.count.close({ sessionId: started.id });
    await p.supervisor.count.resolve({ sessionId: started.id, action: "move_found", bundleIds: [d.id] });
    await expect(
      p.supervisor.count.resolve({ sessionId: started.id, action: "move_found", bundleIds: [d.id] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe("tenant isolation", () => {
  test("another company's count is NOT_FOUND everywhere; list shows only own counts", async () => {
    const { p, started, c } = await classified();
    const other = await plant();
    const theirs = other.supervisor;
    await expect(theirs.count.get({ sessionId: started.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(theirs.count.scan({ sessionId: started.id, codes: ["X"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(theirs.count.removeScans({ sessionId: started.id, seenIds: ["x"] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(theirs.count.close({ sessionId: started.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(theirs.count.cancel({ sessionId: started.id, reason: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await p.supervisor.count.close({ sessionId: started.id });
    await expect(
      theirs.count.resolve({ sessionId: started.id, action: "void_phantom", bundleIds: [c.id] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await theirs.count.list({})).items).toEqual([]);
    expect((await p.viewer.count.list({})).items).toHaveLength(1);
  });

  test("bundle ids of another company are not lines of this count; their stock is never touched", async () => {
    const p = await plant();
    const other = await plant();
    // A seeded serial (unique across companies), then put in their Y1.
    const [theirs] = await env.seedBundles(other.companyId, other.dieId, 1);
    await other.owner.stock.move({ bundleIds: [theirs!.id], toLocationId: other.loc("Y1") });
    await p.pack("Y1", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    // Their bundle scanned here is an unknown code, never their bundle.
    await p.supervisor.count.scan({ sessionId: s.id, codes: [theirs!.serial] });
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(report.found[0]).toMatchObject({ reason: "unknown", resolvedBundle: null });
    for (const action of ["void_phantom", "move_found"] as const) {
      await expect(
        p.supervisor.count.resolve({ sessionId: s.id, action, bundleIds: [theirs!.id] }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect((await bundleRow(theirs!.id))).toMatchObject({ status: "available", locationId: other.loc("Y1") });
    // Their phantom report is theirs alone.
    const theirCount = await other.supervisor.count.start({ locationIds: [other.loc("Y1")] });
    const theirReport = await other.supervisor.count.close({ sessionId: theirCount.id });
    expect(ids(theirReport.phantom)).toEqual([theirs!.id]);
    await expect(p.manager.approval.decide({ id: "nope", decision: "approved" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  test("a forged phantom_void approval pointing at another company's count changes nothing", async () => {
    const { p: mine, s: theirSession, phantoms } = await closedWithPhantoms(1);
    const attacker = await plant();
    // Their own (legit) request, then an approval row of the attacker's company forged to the victim's session.
    const forgedId = crypto.randomUUID();
    await env.db.insert(approval).values({
      id: forgedId,
      companyId: attacker.companyId,
      kind: "phantom_void",
      subjectId: theirSession.id,
      requestedBy: attacker.users.supervisor.id,
    });
    // Mark the victim's line as if requested under the forged approval id.
    await env.db.update(countLine).set({ resolution: "void_requested", approvalId: forgedId }).where(eq(countLine.sessionId, theirSession.id));
    await attacker.manager.approval.decide({ id: forgedId, decision: "approved" });
    expect((await bundleRow(phantoms[0]!.id)).status).toBe("available");
    expect((await linesOf(theirSession.id))[0]!.resolution).toBe("void_requested");
    await expectConsistent(mine.owner, mine.companyId, "victim untouched");
  });
});

// ---------------------------------------------------------------------------
// Permission matrix
// ---------------------------------------------------------------------------

describe("permission matrix", () => {
  test("stock.count holders are exactly owner, office, supervisor, packer, operator (digest §4.2)", () => {
    expect(COUNTERS.sort()).toEqual(["office", "operator", "owner", "packer", "supervisor"]);
  });

  test("start, scan, removeScans, close, cancel and resolve need stock.count; everyone else is FORBIDDEN", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    for (const role of COUNTERS) {
      const code = `Z-${role.toUpperCase().replace("_", "-")}`;
      const { id: locId } = await p.owner.stock.locations.create({ code, name: `Yard ${role}`, kind: "yard" });
      const s = await p[role].count.start({ locationIds: [locId] });
      const scanned = await p[role].count.scan({ sessionId: s.id, codes: [a!.serial, `${code}-X`] });
      await p[role].count.removeScans({ sessionId: s.id, seenIds: [scanned.results[1]!.seenId!] });
      const report = await p[role].count.close({ sessionId: s.id });
      await p[role].count.resolve({ sessionId: s.id, action: "move_found", bundleIds: [a!.id] });
      expect(report.found).toHaveLength(1);
      const c2 = await p[role].count.start({ locationIds: [locId] });
      await p[role].count.cancel({ sessionId: c2.id, reason: "test" });
    }
    const s = await p.owner.count.start({ locationIds: [p.loc("Y2")] });
    const scanned = await p.owner.count.scan({ sessionId: s.id, codes: ["Q-1"] });
    for (const role of NOT_COUNTERS) {
      const api = p[role];
      await expect(api.count.start({ locationIds: [p.loc("Y3")] })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(api.count.scan({ sessionId: s.id, codes: ["Q-2"] })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(api.count.removeScans({ sessionId: s.id, seenIds: [scanned.results[0]!.seenId!] })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(api.count.close({ sessionId: s.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(api.count.cancel({ sessionId: s.id, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        api.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [a!.id] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await env.db.select().from(countSeen).where(eq(countSeen.sessionId, s.id))).toHaveLength(1);
  });

  test("reads (list, get, phantomSummary) are open to every member", async () => {
    const { p, started } = await classified();
    await p.supervisor.count.close({ sessionId: started.id });
    for (const role of ROLES) {
      expect((await p[role].count.list({})).items).toHaveLength(1);
      expect((await p[role].count.get({ sessionId: started.id })).report.phantom).toHaveLength(1);
      expect((await p[role].count.phantomSummary()).open.bundles).toBe(1);
    }
  });

  test("phantom_void approvers are owner, admin and manager; everyone else is FORBIDDEN", async () => {
    const { p, s, phantoms } = await closedWithPhantoms(1);
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [phantoms[0]!.id] }));
    for (const role of ROLES.filter((r) => !["owner", "admin", "manager"].includes(r))) {
      await expect(p[role].approval.decide({ id: res.approvalId, decision: "approved" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    await p.owner.approval.decide({ id: res.approvalId, decision: "approved" });
    expect((await bundleRow(phantoms[0]!.id)).status).toBe("void");
  });

  test("unauthenticated callers are rejected", async () => {
    const anon = env.caller(null);
    await expect(anon.count.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anon.count.start({ locationIds: ["x"] })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ---------------------------------------------------------------------------
// D1 limits, ledger = projection, summary
// ---------------------------------------------------------------------------

describe("D1 limits and ledger = projection", () => {
  test("200-code scan, 150-phantom close and void, 120-bundle move_found: no statement binds over 100 params", async () => {
    const p = await plant();
    const y1 = await p.pack("Y1", 150);
    const y2 = await p.pack("Y2", 120);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
    env.resetPeakParams();
    const codes = [...y2.map((b) => b.serial), ...Array.from({ length: 80 }, (_, i) => `UNKNOWN-${i}`)];
    const scan = await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes });
    expect(scan.recorded).toBe(200);
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(report.phantom).toHaveLength(150);
    expect(report.moved).toHaveLength(120);
    expect(report.found).toHaveLength(80);
    const preview = await p.viewer.count.get({ sessionId: s.id });
    expect(preview.report.phantom).toHaveLength(150);
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: y1.map((b) => b.id) }));
    expect(res.requested).toBe(150);
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    const moved = movedFound(await p.supervisor.count.resolve({ sessionId: s.id, action: "move_found", bundleIds: y2.map((b) => b.id) }));
    expect(moved.moved).toBe(120);
    expect(env.peakParams()).toBeLessThanOrEqual(100);
    await expectConsistent(p.owner, p.companyId, "after big count");
    const voidRows = await env.db
      .select()
      .from(bundle)
      .where(and(eq(bundle.companyId, p.companyId), eq(bundle.status, "void")));
    expect(voidRows).toHaveLength(150);
  }, 120_000);

  test("ledger = projection across count → void → move_found → dispatch → recount", async () => {
    const p = await plant();
    const y1 = await p.pack("Y1", 4);
    const y2 = await p.pack("Y2", 3);
    await expectConsistent(p.owner, p.companyId, "packed");
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: [y1[0]!.serial, y1[1]!.serial, y2[0]!.serial] });
    await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y2"), codes: [y2[1]!.serial, y1[2]!.serial] });
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(ids(report.phantom)).toEqual([y1[3]!.id, y2[2]!.id].sort());
    expect(ids(report.moved)).toEqual([y1[2]!.id, y2[0]!.id].sort());
    await expectConsistent(p.owner, p.companyId, "closed");
    const req = voided(await p.office.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: report.phantom.map((x) => x.bundleId) }));
    await p.manager.approval.decide({ id: req.approvalId, decision: "approved" });
    await expectConsistent(p.owner, p.companyId, "voided");
    await p.office.count.resolve({ sessionId: s.id, action: "move_found", bundleIds: report.moved.map((x) => x.bundleId) });
    await expectConsistent(p.owner, p.companyId, "moved");
    await p.dispatchOut([y1[0]!.id, y2[0]!.id]);
    await expectConsistent(p.owner, p.companyId, "dispatched");
    // A recount right after finds the yard matching the screen: no phantoms, nothing moved.
    const again = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: again.id, locationId: p.loc("Y1"), codes: [y1[1]!.serial, y2[0]!.serial].filter(Boolean) });
    await p.supervisor.count.scan({ sessionId: again.id, locationId: p.loc("Y2"), codes: [y2[1]!.serial] });
    await p.supervisor.count.scan({ sessionId: again.id, locationId: p.loc("Y2"), codes: [y1[2]!.serial] });
    const recount = await p.supervisor.count.close({ sessionId: again.id });
    // y1[2] was moved to Y2 (where it was seen); y2[0] was dispatched → found (not in stock).
    expect(recount.phantom).toEqual([]);
    expect(recount.moved).toEqual([]);
    expect(recount.found.map((f) => f.resolvedBundle?.bundleId)).toEqual([y2[0]!.id]);
    expect(recount.summary.phantomBp).toBe(0);
    await expectConsistent(p.owner, p.companyId, "recounted");
  });

  test("phantomSummary: the last count's phantom share and the phantoms still open (each bundle once)", async () => {
    const p = await plant();
    expect(await p.viewer.count.phantomSummary()).toEqual({ lastCount: null, open: { bundles: 0, weightG: 0 } });
    const { p: q, s, phantoms, seen } = await closedWithPhantoms(3);
    const sum = await q.viewer.count.phantomSummary();
    expect(sum.lastCount).toMatchObject({ sessionId: s.id, number: "CNT-1", expected: 4, phantom: 3, phantomBp: 7_500 });
    expect(sum.open).toEqual({ bundles: 3, weightG: 75_000 });
    // A second count that scans nothing calls all four phantoms; the three repeats count once.
    const again = await q.office.count.start({ locationIds: [q.loc("Y1")] });
    await q.office.count.close({ sessionId: again.id });
    const sum2 = await q.viewer.count.phantomSummary();
    expect(sum2.lastCount).toMatchObject({ number: "CNT-2", expected: 4, phantom: 4, phantomBp: 10_000 });
    expect(sum2.open).toEqual({ bundles: 4, weightG: 100_000 });
    // Voided (count 1's approval) and turned-up (moved) phantoms no longer count as open.
    const res = voided(await q.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [phantoms[0]!.id] }));
    await q.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    await q.owner.stock.move({ bundleIds: [phantoms[1]!.id], toLocationId: q.loc("Y3") });
    const sum3 = await q.viewer.count.phantomSummary();
    expect(sum3.open).toEqual({ bundles: 2, weightG: 50_000 });
    expect(seen.id).toBeTruthy();
  });
});
