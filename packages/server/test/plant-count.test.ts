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
  company,
  countLine,
  countLocation,
  countSeen,
  countSession,
  legacyBundleMap,
  stockLedger,
  user,
} from "@orrn/db/schema";
import { and, asc, eq } from "drizzle-orm";

import { APPROVAL_APPLIERS } from "../src/lib/approvalApply";
import { atomicBatch } from "../src/lib/atomic";
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
    env.beforeNextBatch(() => p.office.count.close({ sessionId: s.id, confirmUnscanned: true }));
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
      seenElsewhere: 0,
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
    const report = await p.supervisor.count.close({ sessionId: s.id, confirmUnscanned: true });
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
    await p.supervisor.count.close({ sessionId: closed.id, confirmUnscanned: true });
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
    const report = await p.supervisor.count.close({ sessionId: s.id, confirmUnscanned: true });
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
    const theirReport = await other.supervisor.count.close({ sessionId: theirCount.id, confirmUnscanned: true });
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
    // move_found also checks stock.move; a future split of the two keys must be noticed here.
    expect(ROLES.filter((r) => can(r, "stock.move")).sort()).toEqual([...COUNTERS].sort());
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
    await p.supervisor.count.scan({ sessionId: again.id, locationId: p.loc("Y1"), codes: [y1[1]!.serial, y2[0]!.serial] });
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
    expect(await p.viewer.count.phantomSummary()).toEqual({ lastCount: null, lastDay: null, open: { bundles: 0, weightG: 0 } });
    const { p: q, s, phantoms } = await closedWithPhantoms(3);
    const sum = await q.viewer.count.phantomSummary();
    expect(sum.lastCount).toMatchObject({ sessionId: s.id, number: "CNT-1", expected: 4, phantom: 3, phantomBp: 7_500 });
    expect(sum.open).toEqual({ bundles: 3, weightG: 75_000 });
    // A second count that scans nothing calls all four phantoms; the three repeats count once.
    const again = await q.office.count.start({ locationIds: [q.loc("Y1")] });
    await q.office.count.close({ sessionId: again.id, confirmUnscanned: true });
    const sum2 = await q.viewer.count.phantomSummary();
    expect(sum2.lastCount).toMatchObject({ number: "CNT-2", expected: 4, phantom: 4, phantomBp: 10_000 });
    expect(sum2.open).toEqual({ bundles: 4, weightG: 100_000 });
    // Voided (count 1's approval) and turned-up (moved) phantoms no longer count as open.
    const res = voided(await q.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [phantoms[0]!.id] }));
    await q.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    await q.owner.stock.move({ bundleIds: [phantoms[1]!.id], toLocationId: q.loc("Y3") });
    const sum3 = await q.viewer.count.phantomSummary();
    expect(sum3.open).toEqual({ bundles: 2, weightG: 50_000 });
  });
});

// ===========================================================================
// Review round 1 (reviews/PL10-*-r0.md). Behaviour fixes first, then the pins the mutation run
// asked for; bracketed ids in titles are the tests-r0 mutants each test kills.
// ===========================================================================

const DAY = 86_400_000;

/** Every active yard of the plant (a full count). */
function allYards(p: Awaited<ReturnType<typeof plant>>) {
  return p.locs.filter((l) => l.kind === "yard" && l.active).map((l) => l.id);
}

/** A legacy (pre-ledger) bundle sitting in a yard: no ledger rows, location set. */
async function legacyAt(p: Awaited<ReturnType<typeof plant>>, yard: string, n = 1) {
  const rows = await env.seedBundles(p.companyId, p.dieId, n);
  for (const r of rows) await env.db.update(bundle).set({ locationId: p.loc(yard) }).where(eq(bundle.id, r.id));
  return rows;
}

describe("fix r1: bundles with no place (legacy stock taken on at location unknown)", () => {
  test("a count over every active yard expects unplaced bundles: unseen ones are phantoms, void keeps ledger = projection", async () => {
    const p = await plant();
    const [a, b] = await p.pack("Y1", 2);
    const legacy = await env.seedBundles(p.companyId, p.dieId, 3);
    await p.owner.stock.openingBalance();
    const s = await p.supervisor.count.start({ locationIds: allYards(p) });
    expect((await p.viewer.count.get({ sessionId: s.id })).session.includeUnplaced).toBe(true);
    // legacy[0] is found in Y1; legacy[1] and legacy[2] are nowhere.
    await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: [a!.serial, b!.serial, legacy[0]!.serial] });
    const preview = (await p.viewer.count.get({ sessionId: s.id })).report;
    expect(ids(preview.phantom)).toEqual([legacy[1]!.id, legacy[2]!.id].sort());
    expect(preview.summary).toMatchObject({ expected: 5, phantom: 2, phantomBp: 4_000 });

    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(ids(report.phantom)).toEqual([legacy[1]!.id, legacy[2]!.id].sort());
    expect(report.phantom.every((x) => x.systemLocationId === null && x.systemLocationCode === null)).toBe(true);
    expect(report.found).toHaveLength(1);
    expect(report.found[0]).toMatchObject({ reason: "elsewhere", resolvedBundle: { bundleId: legacy[0]!.id, systemLocationId: null } });
    expect(report.summary).toEqual({
      expected: 5, seen: 3, matched: 2, phantom: 2, phantomG: 50_000, found: 1, moved: 0, changed: 0, seenElsewhere: 0, phantomBp: 4_000,
    });
    expect(preview.summary).toEqual(report.summary);
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 2, weightG: 50_000 });

    const opening = (await ledgerRows(p.companyId)).filter((r) => r.voucherType === "opening");
    const res = voided(
      await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [legacy[1]!.id, legacy[2]!.id] }),
    );
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    for (const g of [legacy[1]!, legacy[2]!]) {
      expect((await bundleRow(g.id)).status).toBe("void");
      const rev = (await ledgerRows(p.companyId)).filter((r) => r.itemRef === g.id && r.voucherType === "void");
      const open = opening.find((r) => r.itemRef === g.id)!;
      expect(rev).toHaveLength(1);
      expect(rev[0]).toMatchObject({ locationId: null, qtyG: -open.qtyG, reversalOf: open.id });
    }
    await expectConsistent(p.owner, p.companyId, "unplaced phantoms voided");
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 0, weightG: 0 });
    // The one found in Y1 is placed there.
    await p.supervisor.count.resolve({ sessionId: s.id, action: "move_found", bundleIds: [legacy[0]!.id] });
    expect((await bundleRow(legacy[0]!.id)).locationId).toBe(p.loc("Y1"));
    await expectConsistent(p.owner, p.companyId, "unplaced found placed");
  });

  test("a partial count never expects them; includeUnplaced needs every active yard; a full count can leave them out", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const [legacy] = await env.seedBundles(p.companyId, p.dieId, 1);
    await p.owner.stock.openingBalance();
    await expect(
      p.supervisor.count.start({ locationIds: [p.loc("Y1")], includeUnplaced: true }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const part = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    expect((await p.viewer.count.get({ sessionId: part.id })).session.includeUnplaced).toBe(false);
    await p.supervisor.count.scan({ sessionId: part.id, codes: [a!.serial] });
    const r1 = await p.supervisor.count.close({ sessionId: part.id });
    expect(r1.phantom).toEqual([]);
    expect(r1.summary).toMatchObject({ expected: 1, phantom: 0 });

    const off = await p.supervisor.count.start({ locationIds: allYards(p), includeUnplaced: false });
    await p.supervisor.count.scan({ sessionId: off.id, locationId: p.loc("Y1"), codes: [a!.serial] });
    const r2 = await p.supervisor.count.close({ sessionId: off.id });
    expect(r2.phantom).toEqual([]);
    expect(r2.summary).toMatchObject({ expected: 1, phantom: 0 });
    expect((await p.viewer.count.list({})).items.map((i) => [i.number, i.includeUnplaced])).toEqual([
      ["CNT-2", false],
      ["CNT-1", false],
    ]);
    expect((await bundleRow(legacy!.id)).status).toBe("available");
  });

  test("an unplaced bundle taken onto the ledger during the full count is 'changed', not a phantom", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const s = await p.supervisor.count.start({ locationIds: allYards(p) });
    await env.seedBundles(p.companyId, p.dieId, 1);
    await p.owner.stock.openingBalance();
    await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: [a!.serial] });
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(report.phantom).toEqual([]);
    expect(report.summary).toMatchObject({ expected: 1, changed: 1, phantom: 0 });
  });
});

describe("fix r1: phantomSummary uses the void hook's own 'still missing' rule", () => {
  test("phantomSummary.open drops a phantom that a later count scanned in place (no move needed)", async () => {
    const p = await plant();
    const [a, x] = await p.pack("Y1", 2);
    const c1 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: c1.id, codes: [a!.serial] });
    await p.supervisor.count.close({ sessionId: c1.id });
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 1, weightG: 25_000 });
    const c2 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: c2.id, codes: [x!.serial] });
    // Seen in a count that is still open: already not missing.
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 0, weightG: 0 });
    await p.supervisor.count.scan({ sessionId: c2.id, codes: [a!.serial] });
    const r2 = await p.supervisor.count.close({ sessionId: c2.id });
    expect(r2.phantom).toEqual([]);
    const sum = await p.viewer.count.phantomSummary();
    expect(sum.lastCount).toMatchObject({ number: "CNT-2", phantom: 0, phantomBp: 0 });
    expect(sum.open).toEqual({ bundles: 0, weightG: 0 });
  });
});

describe("fix r1: close confirmation, scan feedback, removeScans trail, paging", () => {
  test("close refuses while a counted yard that holds stock has no scans, unless confirmUnscanned", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    await p.pack("Y2", 2);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2"), p.loc("Y3")] });
    await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: [a!.serial] });
    await expect(p.supervisor.count.close({ sessionId: s.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("Y2"),
    });
    expect((await p.viewer.count.get({ sessionId: s.id })).session.status).toBe("open");
    expect(await linesOf(s.id)).toHaveLength(0);
    const report = await p.supervisor.count.close({ sessionId: s.id, confirmUnscanned: true });
    expect(report.summary).toMatchObject({ expected: 3, seen: 1, matched: 1, phantom: 2 });
    // A closed count closes again without the flag (idempotent), and an empty yard needs none.
    expect((await p.supervisor.count.close({ sessionId: s.id })).summary).toEqual(report.summary);
    const empty = await p.supervisor.count.start({ locationIds: [p.loc("Y4")] });
    expect((await p.supervisor.count.close({ sessionId: empty.id })).summary.expected).toBe(0);
  });

  test("unrecognised codes are kept in upper case: 'lot/7a' and 'LOT/7A' are one scan", async () => {
    const p = await plant();
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const r = await p.supervisor.count.scan({ sessionId: s.id, codes: ["lot/7a", " LOT/7A "] });
    expect(r.results.map((x) => [x.code, x.outcome, x.match])).toEqual([
      ["LOT/7A", "recorded", "unknown"],
      ["LOT/7A", "duplicate", "unknown"],
    ]);
    const again = await p.supervisor.count.scan({ sessionId: s.id, codes: ["Lot/7A"] });
    expect(again.results[0]!.outcome).toBe("duplicate");
    expect((await env.db.select().from(countSeen).where(eq(countSeen.sessionId, s.id))).map((x) => x.code)).toEqual(["LOT/7A"]);
  });

  test("scan with another company's location is NOT_FOUND; one of ours outside the count stays BAD_REQUEST", async () => {
    const p = await plant();
    const other = await plant();
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
    await expect(
      p.supervisor.count.scan({ sessionId: s.id, locationId: other.loc("Y1"), codes: ["Q"] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y3"), codes: ["Q"] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("RACE: a scan of the same bundle lands at another yard first — the duplicate names that yard", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
    env.beforeNextBatch(() => p.packer.count.scan({ sessionId: s.id, locationId: p.loc("Y2"), codes: [a!.serial] }));
    const late = await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: [a!.serial] });
    expect(late.results[0]).toMatchObject({ outcome: "duplicate", firstLocationId: p.loc("Y2"), seenId: null });
  });

  test("removeScans records what it removed (code, bundle, location) in the audit row", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const scan = await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial, "U-1"] });
    await p.supervisor.count.removeScans({ sessionId: s.id, seenIds: scan.results.map((r) => r.seenId!) });
    const [row] = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "count.removeScans")));
    const meta = row!.meta as { scans: { id: string; code: string; bundleId: string | null; locationId: string }[] };
    expect(meta.scans.map((x) => [x.code, x.bundleId, x.locationId]).sort()).toEqual(
      [
        [a!.serial, a!.id, p.loc("Y1")],
        ["U-1", null, p.loc("Y1")],
      ].sort(),
    );
    expect(meta.scans.map((x) => x.id).sort()).toEqual(scan.results.map((r) => r.seenId!).sort());
  });

  test("count.get pages the scans (newest first) and returns their total", async () => {
    const p = await plant();
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    for (const code of ["S-1", "S-2", "S-3"]) await p.supervisor.count.scan({ sessionId: s.id, codes: [code] });
    const first = await p.viewer.count.get({ sessionId: s.id, scanLimit: 2 });
    expect(first.scans.map((x) => x.code)).toEqual(["S-3", "S-2"]);
    expect(first).toMatchObject({ scanTotal: 3, scanNextOffset: 2 });
    const rest = await p.viewer.count.get({ sessionId: s.id, scanLimit: 2, scanOffset: 2 });
    expect(rest.scans.map((x) => x.code)).toEqual(["S-1"]);
    expect(rest.scanNextOffset).toBeNull();
    // The report is never paged: the missing list needs every line.
    expect(rest.report.found).toHaveLength(3);
  });

  test("a scan row of this company that points at another company's bundle reports as unknown (cross-wired join)", async () => {
    const p = await plant();
    const other = await plant();
    const [theirs] = await env.seedBundles(other.companyId, other.dieId, 1);
    await other.owner.stock.move({ bundleIds: [theirs!.id], toLocationId: other.loc("Y1") });
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await env.db.insert(countSeen).values({
      id: crypto.randomUUID(),
      companyId: p.companyId,
      serverSeq: 1,
      sessionId: s.id,
      locationId: p.loc("Y1"),
      code: "CROSS-1",
      resolveKind: "bundle",
      bundleId: theirs!.id,
      scannedAt: new Date(),
    });
    for (const report of [
      (await p.viewer.count.get({ sessionId: s.id })).report,
      await p.supervisor.count.close({ sessionId: s.id }),
    ]) {
      expect(report.found).toHaveLength(1);
      expect(report.found[0]).toMatchObject({ code: "CROSS-1", reason: "unknown", resolvedBundle: null });
      expect(JSON.stringify(report)).not.toContain(theirs!.serial);
      expect(report.moved).toEqual([]);
    }
  });
});

describe("review pins: report numbers", () => {
  test("[I-3] reserved bundles (held by an open dispatch) are in stock: scanned = matched, unseen = phantom, both expected", async () => {
    const p = await plant();
    const [a, b, c] = await p.pack("Y1", 3);
    await p.reserveOn([a!.id, b!.id]);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const scan = await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial, c!.serial] });
    expect(scan.results.map((r) => r.match)).toEqual(["here", "here"]);
    const preview = (await p.viewer.count.get({ sessionId: s.id })).report;
    expect(preview.phantom.map((x) => [x.bundleId, x.status])).toEqual([[b!.id, "reserved"]]);
    expect(preview.found).toEqual([]);
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(report.found).toEqual([]);
    expect(report.moved).toEqual([]);
    expect(report.phantom.map((x) => [x.bundleId, x.status])).toEqual([[b!.id, "reserved"]]);
    expect(report.summary).toMatchObject({ expected: 3, seen: 2, matched: 2, phantom: 1, found: 0 });
  });

  test("[C03,C36] a RESERVED bundle missing from the yard is a phantom (reserved stock is stock)", async () => {
    const p = await plant();
    const [a, b] = await p.pack("Y1", 2);
    await p.reserveOn([b!.id]);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const report = await p.supervisor.count.close({ sessionId: s.id, confirmUnscanned: true });
    expect(ids(report.phantom)).toEqual([a!.id, b!.id].sort());
    expect(report.phantom.find((x) => x.bundleId === b!.id)!.status).toBe("reserved");
    expect(report.summary).toMatchObject({ expected: 2, phantom: 2, phantomBp: 10_000 });
  });

  test("[C36] a reserved bundle seen outside the count is found 'elsewhere', not 'not_in_stock'", async () => {
    const p = await plant();
    const [a] = await p.pack("Y3", 1);
    await p.reserveOn([a!.id]);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const scan = await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] });
    expect(scan.results[0]!.match).toBe("elsewhere");
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(report.found[0]).toMatchObject({ reason: "elsewhere" });
  });

  test("[C07] a SEEN bundle moved into a counted yard during the count is matched, not 'changed': totals stay exact", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const [b] = await p.pack("Y2", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: [a!.serial, b!.serial] });
    await p.owner.stock.move({ bundleIds: [b!.id], toLocationId: p.loc("Y1") });
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(report.summary).toEqual({
      expected: 2, seen: 2, matched: 2, phantom: 0, phantomG: 0, found: 0, moved: 0, changed: 0, seenElsewhere: 0, phantomBp: 0,
    });
  });

  test("[C33] a count over an empty yard reports 0 bp, never NaN (report and phantomSummary)", async () => {
    const p = await plant();
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y6")] });
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(report.summary).toEqual({
      expected: 0, seen: 0, matched: 0, phantom: 0, phantomG: 0, found: 0, moved: 0, changed: 0, seenElsewhere: 0, phantomBp: 0,
    });
    expect((await p.viewer.count.phantomSummary()).lastCount).toMatchObject({ expected: 0, phantom: 0, phantomBp: 0 });
  });

  test("[C34] the phantom share rounds to the nearest basis point (2 of 3 = 6,667 bp)", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 3);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] });
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(report.summary).toMatchObject({ expected: 3, phantom: 2, phantomBp: 6_667 });
    expect((await p.viewer.count.phantomSummary()).lastCount).toMatchObject({ phantomBp: 6_667 });
  });

  test("[C32] age buckets: 15 days is 0-15, 16 and 30 are 16-30, 31 and 60 are 31-60, 61 is 60+", async () => {
    const p = await plant();
    const base = Date.UTC(2026, 6, 1, 6, 0, 0); // 1 Jul, 11:30 IST
    setClock(new Date(base));
    const rows = await p.pack("Y1", 7, 10_000);
    const ages = [0, 15, 16, 30, 31, 60, 61];
    for (const [i, d] of ages.entries()) {
      await env.db.update(bundle).set({ createdAt: new Date(base - d * DAY) }).where(eq(bundle.id, rows[i]!.id));
    }
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const report = await p.supervisor.count.close({ sessionId: s.id, confirmUnscanned: true });
    expect(report.byAge.map((x) => [x.bucket, x.bundles])).toEqual([
      ["0-15", 2], ["16-30", 2], ["31-60", 2], ["60+", 1],
    ]);
  });

  test("[C31] age is counted in company calendar days: packed 01:30 IST on 16 Jun (15 Jun in UTC) is 15 days old on 1 Jul", async () => {
    const p = await plant();
    const base = Date.UTC(2026, 6, 1, 6, 0, 0);
    setClock(new Date(base));
    const [a] = await p.pack("Y1", 1);
    await env.db.update(bundle).set({ createdAt: new Date(Date.UTC(2026, 5, 15, 20, 0, 0)) }).where(eq(bundle.id, a!.id));
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const report = await p.supervisor.count.close({ sessionId: s.id, confirmUnscanned: true });
    expect(report.byAge.map((x) => [x.bucket, x.bundles])).toEqual([
      ["0-15", 1], ["16-30", 0], ["31-60", 0], ["60+", 0],
    ]);
  });

  test("[C30] a closed report is frozen: reading it 40 days later does not age its phantoms", async () => {
    const p = await plant();
    const base = Date.UTC(2026, 6, 1, 6, 0, 0);
    setClock(new Date(base));
    const [a] = await p.pack("Y1", 1);
    await env.db.update(bundle).set({ createdAt: new Date(base - 2 * DAY) }).where(eq(bundle.id, a!.id));
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const report = await p.supervisor.count.close({ sessionId: s.id, confirmUnscanned: true });
    expect(report.byAge[0]).toEqual({ bucket: "0-15", bundles: 1, weightG: 25_000 });
    setClock(new Date(base + 40 * DAY));
    const later = (await p.viewer.count.get({ sessionId: s.id })).report;
    expect(later.byAge).toEqual(report.byAge);
  });

  test("[C35,R20,R21] an ambiguous old number (J540 = 26J540 or 27J540) is kept as an 'ambiguous' found line; the floor hears the candidates", async () => {
    const p = await plant();
    const [x, y] = await env.seedBundles(p.companyId, p.dieId, 2);
    await env.db.update(bundle).set({ serial: "26J540" }).where(eq(bundle.id, x!.id));
    await env.db.update(bundle).set({ serial: "27J540" }).where(eq(bundle.id, y!.id));
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const scan = await p.supervisor.count.scan({ sessionId: s.id, codes: ["J540"] });
    expect(scan.results[0]).toMatchObject({ outcome: "recorded", match: "ambiguous", bundle: null });
    // Newest year first: the floor asks which one (P8 defaults to the latest).
    expect(scan.results[0]!.candidates).toEqual([
      { bundleId: y!.id, serial: "27J540" },
      { bundleId: x!.id, serial: "26J540" },
    ]);
    const [seen] = await env.db.select().from(countSeen).where(eq(countSeen.sessionId, s.id));
    expect(seen).toMatchObject({ code: "J540", resolveKind: "ambiguous", bundleId: null });
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(report.found).toHaveLength(1);
    expect(report.found[0]).toMatchObject({ code: "J540", reason: "ambiguous", resolvedBundle: null });
  });

  test("[C37] byCast lists the unknown cast last even when it holds the most kg", async () => {
    const p = await plant();
    const small = await p.pack("Y1", 2, 10_000);
    await p.pack("Y1", 1, 50_000);
    for (const b of small) await env.db.update(bundle).set({ castId: "cast-a" }).where(eq(bundle.id, b.id));
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const report = await p.supervisor.count.close({ sessionId: s.id, confirmUnscanned: true });
    expect(report.byCast).toEqual([
      { castId: "cast-a", bundles: 2, weightG: 20_000 },
      { castId: null, bundles: 1, weightG: 50_000 },
    ]);
  });
});

describe("review pins: reads and scoping", () => {
  test("[R02,R03,R04] count.list filters by status and pages newest first", async () => {
    const p = await plant();
    const one = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.close({ sessionId: one.id });
    const two = await p.supervisor.count.start({ locationIds: [p.loc("Y2")] });
    await p.supervisor.count.cancel({ sessionId: two.id, reason: "x" });
    await p.supervisor.count.start({ locationIds: [p.loc("Y3")] });
    expect((await p.viewer.count.list({ status: "closed" })).items.map((i) => i.number)).toEqual(["CNT-1"]);
    expect((await p.viewer.count.list({ status: "open" })).items.map((i) => i.number)).toEqual(["CNT-3"]);
    const first = await p.viewer.count.list({ limit: 2 });
    expect(first.items.map((i) => i.number)).toEqual(["CNT-3", "CNT-2"]);
    expect(first).toMatchObject({ total: 3, nextOffset: 2 });
    const rest = await p.viewer.count.list({ limit: 2, offset: 2 });
    expect(rest.items.map((i) => i.number)).toEqual(["CNT-1"]);
    expect(rest.nextOffset).toBeNull();
  });

  test("[R06,C41] two counts open at once: each one lists and previews only its own scans", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const [b] = await p.pack("Y2", 1);
    const s1 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const s2 = await p.supervisor.count.start({ locationIds: [p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: s1.id, codes: [a!.serial, "ZZ-ONLY-IN-1"] });
    await p.supervisor.count.scan({ sessionId: s2.id, codes: [b!.serial] });
    const g2 = await p.viewer.count.get({ sessionId: s2.id });
    expect(g2.scans.map((s) => s.code)).toEqual([b!.serial]);
    expect(g2.scanTotal).toBe(1);
    expect(g2.report.found).toEqual([]);
    expect(g2.report.moved).toEqual([]);
    expect(g2.report.summary).toMatchObject({ expected: 1, seen: 1, matched: 1, found: 0, moved: 0, phantom: 0 });
    const g1 = await p.viewer.count.get({ sessionId: s1.id });
    expect(g1.scans.map((s) => s.code).sort()).toEqual([a!.serial, "ZZ-ONLY-IN-1"].sort());
  });

  test("[R22] a duplicate names the yard where the code was FIRST seen, not the yard being scanned now", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: [a!.serial] });
    const again = await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y2"), codes: [a!.serial] });
    expect(again.results[0]).toMatchObject({ outcome: "duplicate", firstLocationId: p.loc("Y1") });
  });

  test("[R07] a count covers at most 20 locations", async () => {
    const p = await plant();
    await expect(
      p.supervisor.count.start({ locationIds: Array.from({ length: 21 }, (_, i) => `loc-${i}`) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("[R88] count.get lists scans newest first", async () => {
    const p = await plant();
    const [a, b] = await p.pack("Y1", 2);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] });
    await p.supervisor.count.scan({ sessionId: s.id, codes: [b!.serial] });
    expect((await p.viewer.count.get({ sessionId: s.id })).scans.map((x) => x.code)).toEqual([b!.serial, a!.serial]);
  });

  test("[S03] RACE: the same unknown code scanned twice at once is recorded once", async () => {
    const p = await plant();
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    env.beforeNextBatch(() => p.packer.count.scan({ sessionId: s.id, codes: ["ZZ-9"] }));
    const late = await p.supervisor.count.scan({ sessionId: s.id, codes: ["ZZ-9"] });
    expect(late.results[0]!.outcome).toBe("duplicate");
    expect(await env.db.select().from(countSeen).where(eq(countSeen.sessionId, s.id))).toHaveLength(1);
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(report.found).toHaveLength(1);
  });

  test("[S02] RACE: one bundle scanned under two different codes at once is recorded once, and the count still closes", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const cuid = "ckz3p1x9q0000abcd1234efgh";
    await env.db.insert(legacyBundleMap).values({ id: crypto.randomUUID(), companyId: p.companyId, legacyId: cuid, bundleId: a!.id });
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    env.beforeNextBatch(() => p.packer.count.scan({ sessionId: s.id, codes: [cuid] }));
    const late = await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] });
    expect(late.results[0]!.outcome).toBe("duplicate");
    expect(await env.db.select().from(countSeen).where(eq(countSeen.sessionId, s.id))).toHaveLength(1);
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(report.summary).toMatchObject({ expected: 1, seen: 1, matched: 1, phantom: 0 });
  });
});

describe("review pins: removeScans, close and cancel races", () => {
  test("[R30] removeScans only touches scans of the count it names (another count's evidence survives)", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const [b] = await p.pack("Y2", 1);
    const s1 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const scan1 = await p.supervisor.count.scan({ sessionId: s1.id, codes: [a!.serial] });
    await p.supervisor.count.close({ sessionId: s1.id });
    const s2 = await p.supervisor.count.start({ locationIds: [p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: s2.id, codes: [b!.serial] });
    const res = await p.supervisor.count.removeScans({ sessionId: s2.id, seenIds: [scan1.results[0]!.seenId!] });
    expect(res.removed).toBe(0);
    expect(await env.db.select().from(countSeen).where(eq(countSeen.sessionId, s1.id))).toHaveLength(1);
    expect(await env.db.select().from(countSeen).where(eq(countSeen.sessionId, s2.id))).toHaveLength(1);
  });

  test("[R32] RACE: the count is closed between removeScans' read and write — the frozen evidence is not deleted", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const scan = await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] });
    env.beforeNextBatch(() => p.office.count.close({ sessionId: s.id }));
    await expect(
      p.supervisor.count.removeScans({ sessionId: s.id, seenIds: [scan.results[0]!.seenId!] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await env.db.select().from(countSeen).where(eq(countSeen.sessionId, s.id))).toHaveLength(1);
    expect(await auditActions(p.companyId)).not.toContain("count.removeScans");
  });

  test("[R33] removeScans with 120 ids stays under 100 bound parameters per statement", async () => {
    const p = await plant();
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const scan = await p.supervisor.count.scan({
      sessionId: s.id,
      codes: Array.from({ length: 120 }, (_, i) => `UNK-${i}`),
    });
    expect(scan.recorded).toBe(120);
    env.resetPeakParams();
    const res = await p.supervisor.count.removeScans({ sessionId: s.id, seenIds: scan.results.map((r) => r.seenId!) });
    expect(res.removed).toBe(120);
    expect(env.peakParams()).toBeLessThanOrEqual(100);
    expect(await env.db.select().from(countSeen).where(eq(countSeen.sessionId, s.id))).toHaveLength(0);
  });

  test("[R50,R51] RACE: the count is closed between cancel's read and write — a closed count is never turned into cancelled", async () => {
    const p = await plant();
    await p.pack("Y1", 2);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    env.beforeNextBatch(() => p.office.count.close({ sessionId: s.id, confirmUnscanned: true }));
    await expect(p.supervisor.count.cancel({ sessionId: s.id, reason: "changed my mind" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const got = await p.viewer.count.get({ sessionId: s.id });
    expect(got.session.status).toBe("closed");
    expect(got.report.phantom).toHaveLength(2);
    expect(await auditActions(p.companyId)).not.toContain("count.cancel");
  });

  test("[R40] RACE: the count is cancelled between close's read and write — close fails, it does not report a cancelled count", async () => {
    const p = await plant();
    await p.pack("Y1", 2);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    env.beforeNextBatch(() => p.office.count.cancel({ sessionId: s.id, reason: "wrong yard" }));
    await expect(p.supervisor.count.close({ sessionId: s.id, confirmUnscanned: true })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await p.viewer.count.get({ sessionId: s.id })).session.status).toBe("cancelled");
    expect(await linesOf(s.id)).toHaveLength(0);
  });
});

describe("review pins: void hook and phantomSummary", () => {
  test("[L03] voiding an off-ledger (legacy) phantom posts no ledger row: ledger still equals projection", async () => {
    const p = await plant();
    const [legacy] = await legacyAt(p, "Y1");
    const [a] = await p.pack("Y1", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] });
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(ids(report.phantom)).toEqual([legacy!.id]);
    const before = (await ledgerRows(p.companyId)).length;
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [legacy!.id] }));
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    expect((await bundleRow(legacy!.id)).status).toBe("void");
    expect((await ledgerRows(p.companyId)).length).toBe(before);
    await expectConsistent(p.owner, p.companyId, "off-ledger phantom void");
  });

  test("[L04] a phantom that came onto the ledger by opening balance is reversed against its opening row", async () => {
    const p = await plant();
    const [legacy] = await env.seedBundles(p.companyId, p.dieId, 1);
    await p.owner.stock.openingBalance();
    await p.owner.stock.move({ bundleIds: [legacy!.id], toLocationId: p.loc("Y1") });
    const opening = (await ledgerRows(p.companyId)).find((r) => r.itemRef === legacy!.id && r.voucherType === "opening")!;
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const report = await p.supervisor.count.close({ sessionId: s.id, confirmUnscanned: true });
    expect(ids(report.phantom)).toEqual([legacy!.id]);
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [legacy!.id] }));
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    const rev = (await ledgerRows(p.companyId)).find((r) => r.itemRef === legacy!.id && r.voucherType === "void")!;
    expect(rev).toMatchObject({ reversalOf: opening.id, qtyG: -opening.qtyG, locationId: p.loc("Y1") });
    await expectConsistent(p.owner, p.companyId, "opening-balance phantom void");
  });

  test("[L02,A09] a phantom voided by hand after the request is not reversed (or logged) a second time by the approval", async () => {
    const p = await plant();
    const yard = await p.pack("Y1", 3);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: s.id, codes: [yard[0]!.serial] });
    await p.supervisor.count.close({ sessionId: s.id });
    const [first, second] = [yard[1]!, yard[2]!];
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [first.id, second.id] }));
    await p.owner.bundle.transitionStatus({ id: first.id, toStatus: "void", reason: "found bent in the yard" });
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    const rows = (await ledgerRows(p.companyId)).filter((r) => r.itemRef === first.id);
    expect(rows.map((r) => r.voucherType).sort()).toEqual(["pack", "void"]);
    const events = await env.db.select().from(bundleStatusEvent).where(eq(bundleStatusEvent.bundleId, first.id));
    expect(events.filter((e) => e.toStatus === "void")).toHaveLength(1);
    const lines = await linesOf(s.id);
    expect(lines.find((l) => l.bundleId === first.id)!.resolution).toBe("cleared");
    expect(lines.find((l) => l.bundleId === second.id)!.resolution).toBe("voided");
    await expectConsistent(p.owner, p.companyId, "manual void then approval");
  });

  test("[L05] a bundle that is a phantom of two counts is reversed once when one approval is decided", async () => {
    const p = await plant();
    const [a, x] = await p.pack("Y1", 2);
    const c1 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: c1.id, codes: [a!.serial] });
    await p.supervisor.count.close({ sessionId: c1.id });
    const c2 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: c2.id, codes: [a!.serial] });
    const r2 = await p.supervisor.count.close({ sessionId: c2.id });
    expect(ids(r2.phantom)).toEqual([x!.id]);
    const req1 = voided(await p.supervisor.count.resolve({ sessionId: c1.id, action: "void_phantom", bundleIds: [x!.id] }));
    const req2 = voided(await p.office.count.resolve({ sessionId: c2.id, action: "void_phantom", bundleIds: [x!.id] }));
    await p.manager.approval.decide({ id: req1.approvalId, decision: "approved" });
    expect((await ledgerRows(p.companyId)).filter((r) => r.itemRef === x!.id).map((r) => r.voucherType).sort()).toEqual(["pack", "void"]);
    await expectConsistent(p.owner, p.companyId, "first of two approvals");
    await p.admin.approval.decide({ id: req2.approvalId, decision: "approved" });
    expect((await ledgerRows(p.companyId)).filter((r) => r.itemRef === x!.id)).toHaveLength(2);
    await expectConsistent(p.owner, p.companyId, "second of two approvals");
  });

  test("[A03] an off-ledger phantom moved before the approval (no ledger row) is cleared, not voided", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const [legacy] = await legacyAt(p, "Y1");
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] });
    await p.supervisor.count.close({ sessionId: s.id });
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [legacy!.id] }));
    await p.owner.stock.move({ bundleIds: [legacy!.id], toLocationId: p.loc("Y2") });
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    expect(await bundleRow(legacy!.id)).toMatchObject({ status: "available", locationId: p.loc("Y2") });
    expect((await linesOf(s.id)).find((l) => l.bundleId === legacy!.id)!.resolution).toBe("cleared");
  });

  test("[A04] a phantom moved away and back before the approval is cleared, not voided", async () => {
    const { p, s, phantoms } = await closedWithPhantoms(2);
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: phantoms.map((b) => b.id) }));
    await p.owner.stock.move({ bundleIds: [phantoms[0]!.id], toLocationId: p.loc("Y2") });
    await p.owner.stock.move({ bundleIds: [phantoms[0]!.id], toLocationId: p.loc("Y1") });
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    expect((await bundleRow(phantoms[0]!.id)).status).toBe("available");
    expect((await bundleRow(phantoms[1]!.id)).status).toBe("void");
    expect((await linesOf(s.id)).find((l) => l.bundleId === phantoms[0]!.id)!.resolution).toBe("cleared");
    await expectConsistent(p.owner, p.companyId, "moved away and back");
  });

  test("[A06] an off-ledger phantom dispatched after the request is never voided by the approval", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const [legacy] = await legacyAt(p, "Y1");
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] });
    await p.supervisor.count.close({ sessionId: s.id });
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [legacy!.id] }));
    await p.dispatchOut([legacy!.id]);
    expect((await bundleRow(legacy!.id)).status).toBe("dispatched");
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    expect((await bundleRow(legacy!.id)).status).toBe("dispatched");
    expect((await linesOf(s.id)).find((l) => l.bundleId === legacy!.id)!.resolution).toBe("cleared");
  });

  test("[C51] phantomSummary.open leaves out a phantom the approval cleared because a later count saw it", async () => {
    const { p, s, phantoms } = await closedWithPhantoms(2);
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: phantoms.map((b) => b.id) }));
    const later = await p.office.count.start({ locationIds: [p.loc("Y1")] });
    await p.office.count.scan({ sessionId: later.id, codes: [phantoms[0]!.serial] });
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    expect((await linesOf(s.id)).find((l) => l.bundleId === phantoms[0]!.id)!.resolution).toBe("cleared");
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 0, weightG: 0 });
  });

  test("[C51] a phantom put on a dispatch after the void request is cleared by the approval and no longer 'still missing'", async () => {
    // Reserving posts no ledger row and no scan: only the line's resolution says it turned up.
    const { p, s, phantoms } = await closedWithPhantoms(2);
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: phantoms.map((b) => b.id) }));
    await p.reserveOn([phantoms[0]!.id]);
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    expect(await bundleRow(phantoms[0]!.id)).toMatchObject({ status: "reserved", locationId: p.loc("Y1") });
    expect((await linesOf(s.id)).find((l) => l.bundleId === phantoms[0]!.id)!.resolution).toBe("cleared");
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 0, weightG: 0 });
  });

  test("[C53] a phantom moved away and back is changed since the close: no longer 'still missing'", async () => {
    const { p, phantoms } = await closedWithPhantoms(2);
    await p.owner.stock.move({ bundleIds: [phantoms[0]!.id], toLocationId: p.loc("Y2") });
    await p.owner.stock.move({ bundleIds: [phantoms[0]!.id], toLocationId: p.loc("Y1") });
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 1, weightG: 25_000 });
  });

  test("[C50,C52] off-ledger phantoms moved or voided after the close stop counting as missing", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const [moved, gone] = await legacyAt(p, "Y1", 2);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] });
    await p.supervisor.count.close({ sessionId: s.id });
    expect((await p.viewer.count.phantomSummary()).open.bundles).toBe(2);
    await p.owner.stock.move({ bundleIds: [moved!.id], toLocationId: p.loc("Y2") });
    await p.owner.bundle.transitionStatus({ id: gone!.id, toStatus: "void", reason: "bent" });
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 0, weightG: 0 });
  });

  test("[spec M-1] a void approval clears a phantom that went away and came back to the same yard", async () => {
    const p = await plant();
    const [a, b] = await p.pack("Y1", 2);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] });
    await p.supervisor.count.close({ sessionId: s.id });
    const req = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [b!.id] }));
    await p.owner.stock.move({ bundleIds: [b!.id], toLocationId: p.loc("Y2") });
    await p.owner.stock.move({ bundleIds: [b!.id], toLocationId: p.loc("Y1") });
    await p.manager.approval.decide({ id: req.approvalId, decision: "approved" });
    expect((await bundleRow(b!.id)).status).toBe("available");
  });
});

describe("review pins: resolve validation and return values", () => {
  test("[R63,R64] void_phantom with a mix of valid and invalid bundles is refused whole: nothing is stamped", async () => {
    const { p, c, d, started } = await classified();
    await p.supervisor.count.close({ sessionId: started.id });
    await expect(
      p.supervisor.count.resolve({ sessionId: started.id, action: "void_phantom", bundleIds: [c.id, d.id] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await linesOf(started.id)).find((l) => l.bundleId === c.id)!.resolution).toBe("open");
    // One already waiting for its approval, one still open.
    const k2 = await closedWithPhantoms(2);
    voided(await k2.p.supervisor.count.resolve({ sessionId: k2.s.id, action: "void_phantom", bundleIds: [k2.phantoms[0]!.id] }));
    await expect(
      k2.p.supervisor.count.resolve({ sessionId: k2.s.id, action: "void_phantom", bundleIds: k2.phantoms.map((b) => b.id) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await linesOf(k2.s.id)).find((l) => l.bundleId === k2.phantoms[1]!.id)!.resolution).toBe("open");
  });

  test("[R67] RACE: the same phantoms requested twice at once — the loser is refused, not handed a ghost approval id", async () => {
    const { p, s, phantoms } = await closedWithPhantoms(2);
    const same = { sessionId: s.id, action: "void_phantom" as const, bundleIds: phantoms.map((b) => b.id) };
    env.beforeNextBatch(() => p.office.count.resolve(same));
    await expect(p.supervisor.count.resolve(same)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      await env.db.select().from(approval).where(and(eq(approval.companyId, p.companyId), eq(approval.kind, "phantom_void"))),
    ).toHaveLength(1);
  });

  test("[R78] the requester's note travels with the approval; [R85] removeScans is audited", async () => {
    const { p, s, phantoms } = await closedWithPhantoms(1);
    const res = voided(
      await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [phantoms[0]!.id], note: "Searched twice" }),
    );
    const [ap] = await env.db.select().from(approval).where(eq(approval.id, res.approvalId));
    expect(ap!.requestNote).toBe("Searched twice");

    const q = await plant();
    const open = await q.supervisor.count.start({ locationIds: [q.loc("Y1")] });
    const scan = await q.supervisor.count.scan({ sessionId: open.id, codes: ["U-1"] });
    await q.supervisor.count.removeScans({ sessionId: open.id, seenIds: [scan.results[0]!.seenId!] });
    expect(await auditActions(q.companyId)).toContain("count.removeScans");
  });

  test("[R86] move_found reports only the vouchers that landed", async () => {
    const p = await plant();
    const [d] = await p.pack("Y2", 1);
    const [e] = await p.pack("Y3", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: [d!.serial] });
    await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y2"), codes: [e!.serial] });
    await p.supervisor.count.close({ sessionId: s.id });
    // d is moved elsewhere (Y5) after the read: its voucher (target Y1) must not be reported.
    env.beforeNextBatch(() => p.owner.stock.move({ bundleIds: [d!.id], toLocationId: p.loc("Y5") }));
    const res = movedFound(await p.supervisor.count.resolve({ sessionId: s.id, action: "move_found", bundleIds: [d!.id, e!.id] }));
    expect(res.moved).toBe(1);
    expect(res.skipped).toEqual([d!.id]);
    expect(res.voucherIds).toHaveLength(1);
    const posted = (await ledgerRows(p.companyId)).filter((r) => r.voucherId === res.voucherIds[0]);
    expect(posted.every((r) => r.itemRef === e!.id)).toBe(true);
  });

  test("[R87] move rows carry the reason 'Found at count CNT-n'", async () => {
    const { p, d, started } = await classified();
    await p.supervisor.count.close({ sessionId: started.id });
    await p.supervisor.count.resolve({ sessionId: started.id, action: "move_found", bundleIds: [d.id] });
    const rows = (await ledgerRows(p.companyId)).filter((r) => r.itemRef === d.id && r.voucherType === "move");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.reason === "Found at count CNT-1")).toBe(true);
  });
});

describe("review pins: cross-wired rows (a foreign key does not check the company)", () => {
  test("[C01] another company's bundle that points at this company's yard is never expected or a phantom", async () => {
    const p = await plant();
    const other = await plant();
    const [theirs] = await env.seedBundles(other.companyId, other.dieId, 1);
    await env.db.update(bundle).set({ locationId: p.loc("Y1") }).where(eq(bundle.id, theirs!.id));
    const [a] = await p.pack("Y1", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const preview = (await p.viewer.count.get({ sessionId: s.id })).report;
    expect(ids(preview.phantom)).toEqual([a!.id]);
    expect(preview.summary.expected).toBe(1);
    const report = await p.supervisor.count.close({ sessionId: s.id, confirmUnscanned: true });
    expect(ids(report.phantom)).toEqual([a!.id]);
    expect(report.summary).toMatchObject({ expected: 1, phantom: 1 });
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 1, weightG: 25_000 });
  });

  test("[C10,C16] another company's ledger rows never mark this company's bundle changed or supersede its scan", async () => {
    const p = await plant();
    const other = await plant();
    const [a] = await p.pack("Y2", 1); // seen at Y1 below: moved
    const [b] = await p.pack("Y1", 1); // never seen: phantom
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: [a!.serial] });
    for (const bundleId of [a!.id, b!.id]) {
      await env.db.insert(stockLedger).values({
        id: crypto.randomUUID(),
        companyId: other.companyId,
        serverSeq: 9_000_000_000,
        voucherType: "pack",
        voucherId: crypto.randomUUID(),
        line: 1,
        itemKind: "bundle",
        itemRef: bundleId,
        locationId: other.loc("Y1"),
        qtyG: 1,
        postedAt: new Date(),
      });
    }
    // Y2 was never scanned, but its one bundle was seen at Y1: no confirmation needed.
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(ids(report.phantom)).toEqual([b!.id]);
    expect(ids(report.moved)).toEqual([a!.id]);
    expect(report.summary.changed).toBe(0);
  });

  test("[C39] another company's approval that names this company's count is never its pending approval", async () => {
    const { p, s } = await closedWithPhantoms(1);
    const attacker = await plant();
    await env.db.insert(approval).values({
      id: crypto.randomUUID(),
      companyId: attacker.companyId,
      kind: "phantom_void",
      subjectId: s.id,
      requestedBy: attacker.users.supervisor.id,
    });
    expect((await p.viewer.count.get({ sessionId: s.id })).report.pendingApprovalId).toBeNull();
  });
});

// ===========================================================================
// Review round 1, second pass (reviews/PL10-*-r0.md re-run on 8491dd1): a bundle another count
// saw is not "missing", the demo-seed reset with counts, and the second mutation wave's pins.
// ===========================================================================

describe("cross-count sightings (spec r0 I-1, correctness r0 I-1: digest §12 phantom = not in the yard)", () => {
  test("two counts open at once: x is packed at Y2 but sits in Y1; CNT-1 scans it at Y1, so CNT-2 does not call it a phantom", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const [x, y] = await p.pack("Y2", 2);
    const c1 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const c2 = await p.supervisor.count.start({ locationIds: [p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: c1.id, codes: [a!.serial, x!.serial] });
    await p.supervisor.count.scan({ sessionId: c2.id, codes: [y!.serial] });
    // The missing list before close already agrees.
    const preview = (await p.viewer.count.get({ sessionId: c2.id })).report;
    expect(preview.phantom).toEqual([]);
    expect(preview.summary).toMatchObject({ expected: 2, seen: 1, matched: 1, phantom: 0, seenElsewhere: 1, phantomBp: 0 });
    const r2 = await p.supervisor.count.close({ sessionId: c2.id });
    expect(ids(r2.phantom)).not.toContain(x!.id);
    expect(r2.summary).toEqual(preview.summary);
    const r1 = await p.supervisor.count.close({ sessionId: c1.id });
    expect(r1.found.map((f) => [f.reason, f.resolvedBundle?.bundleId])).toEqual([["elsewhere", x!.id]]);
    expect((await p.supervisor.count.phantomSummary()).open).toEqual({ bundles: 0, weightG: 0 });
    // CNT-1's found line puts x where it was seen; nothing else is owed.
    expect(movedFound(await p.supervisor.count.resolve({ sessionId: c1.id, action: "move_found", bundleIds: [x!.id] })).moved).toBe(1);
    expect((await bundleRow(x!.id)).locationId).toBe(p.loc("Y1"));
    await expectConsistent(p.owner, p.companyId, "two counts at once");
  });

  test("yards counted one after the other: CNT-2 lists x flagged 'seen at Y1 in CNT-1', refuses its void naming CNT-1, and x is not 'still missing'", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const [x, y] = await p.pack("Y2", 2);
    const c1 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: c1.id, codes: [a!.serial, x!.serial] });
    await p.supervisor.count.close({ sessionId: c1.id });
    const c2 = await p.supervisor.count.start({ locationIds: [p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: c2.id, codes: [y!.serial] });
    const r2 = await p.supervisor.count.close({ sessionId: c2.id });
    // CNT-2 did not see x where the system has it, so it stays on CNT-2's report, flagged.
    expect(ids(r2.phantom)).toEqual([x!.id]);
    expect(r2.phantom[0]!.seenElsewhere).toEqual({
      sessionId: c1.id, number: "CNT-1", locationId: p.loc("Y1"), locationCode: "Y1", countOpen: false, resolveThere: true,
    });
    await expect(
      p.supervisor.count.resolve({ sessionId: c2.id, action: "void_phantom", bundleIds: [x!.id] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("seen at Y1 in CNT-1") });
    expect((await linesOf(c2.id)).find((l) => l.bundleId === x!.id)!.resolution).toBe("open");
    expect(await env.db.select().from(approval).where(eq(approval.companyId, p.companyId))).toEqual([]);
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 0, weightG: 0 });
    // Moving it to where CNT-1 saw it settles both counts.
    expect(movedFound(await p.supervisor.count.resolve({ sessionId: c1.id, action: "move_found", bundleIds: [x!.id] })).moved).toBe(1);
    expect((await p.viewer.count.get({ sessionId: c2.id })).report.phantom[0]!.seenElsewhere).toBeNull();
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 0, weightG: 0 });
    await expectConsistent(p.owner, p.companyId, "found line moved, phantom of the later count settled");
  });

  test("a sighting in a count still open: CNT-1 scanned x before CNT-2 began; CNT-2 flags it and refuses its void until the scan is taken back", async () => {
    const p = await plant();
    const [x, y] = await p.pack("Y2", 2);
    const c1 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const scan = await p.supervisor.count.scan({ sessionId: c1.id, codes: [x!.serial] });
    const c2 = await p.supervisor.count.start({ locationIds: [p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: c2.id, codes: [y!.serial] });
    const r2 = await p.supervisor.count.close({ sessionId: c2.id });
    expect(ids(r2.phantom)).toEqual([x!.id]);
    expect(r2.phantom[0]!.seenElsewhere).toMatchObject({ number: "CNT-1", locationCode: "Y1", countOpen: true, resolveThere: true });
    await expect(
      p.supervisor.count.resolve({ sessionId: c2.id, action: "void_phantom", bundleIds: [x!.id] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("CNT-1") });
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 0, weightG: 0 });
    // The scan was a misread label: taken back, x is missing again and can be voided.
    await p.supervisor.count.removeScans({ sessionId: c1.id, seenIds: [scan.results[0]!.seenId!] });
    expect((await p.viewer.count.get({ sessionId: c2.id })).report.phantom[0]!.seenElsewhere).toBeNull();
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 1, weightG: 25_000 });
    expect(voided(await p.supervisor.count.resolve({ sessionId: c2.id, action: "void_phantom", bundleIds: [x!.id] })).requested).toBe(1);
  });

  test("RACE: another count's scan took its sequence before this count's close but landed after it: not still missing, void refused", async () => {
    const p = await plant();
    const [x, y] = await p.pack("Y2", 2);
    const c1 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const c2 = await p.supervisor.count.start({ locationIds: [p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: c2.id, codes: [y!.serial] });
    env.beforeNextBatch(() => p.office.count.close({ sessionId: c2.id }));
    await p.supervisor.count.scan({ sessionId: c1.id, codes: [x!.serial] });
    const r2 = (await p.viewer.count.get({ sessionId: c2.id })).report;
    expect(r2.status).toBe("closed");
    // Close could not see the scan (seq order is not commit order, ruling 169)...
    expect(ids(r2.phantom)).toEqual([x!.id]);
    // ...but it was made after CNT-2 began: x is not missing.
    expect(r2.phantom[0]!.seenElsewhere).toMatchObject({ number: "CNT-1", countOpen: true, resolveThere: true });
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 0, weightG: 0 });
    await expect(
      p.supervisor.count.resolve({ sessionId: c2.id, action: "void_phantom", bundleIds: [x!.id] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("CNT-1") });
  });

  test("the hook re-checks at decision: a phantom with a live sighting in another count from before this count began is cleared, not voided", async () => {
    // CNT-1 (Y1) is open and has scanned x; CNT-2 (Y2) closes with x a phantom. The request refuses
    // it up front, so the sighting is hidden from that read (parked on CNT-2 itself) and put back
    // just before the request's batch: the hook's copy of the rule (stillPhantomOfLine) must catch it.
    const p = await plant();
    const [x, y] = await p.pack("Y2", 2);
    const c1 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: c1.id, codes: [x!.serial] });
    const c2 = await p.supervisor.count.start({ locationIds: [p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: c2.id, codes: [y!.serial] });
    await p.supervisor.count.close({ sessionId: c2.id });
    const sighting = await env.db.select().from(countSeen).where(eq(countSeen.sessionId, c1.id));
    // Hide the sighting from the up-front check only: move it to a session id nobody reads, then back.
    env.beforeNextBatch(async () => {
      await env.db.update(countSeen).set({ sessionId: c1.id }).where(eq(countSeen.id, sighting[0]!.id));
    });
    await env.db.update(countSeen).set({ sessionId: c2.id }).where(eq(countSeen.id, sighting[0]!.id));
    const res = voided(await p.supervisor.count.resolve({ sessionId: c2.id, action: "void_phantom", bundleIds: [x!.id] }));
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    expect((await bundleRow(x!.id)).status).toBe("available");
    expect((await linesOf(c2.id)).find((l) => l.bundleId === x!.id)!.resolution).toBe("cleared");
    await expectConsistent(p.owner, p.companyId, "hook cleared a phantom seen in an open count");
  });
});

describe("cross-count sightings: settled ones", () => {
  test("a sighting the system has since overtaken (the bundle was moved after it) no longer blocks the void", async () => {
    const p = await plant();
    const [x] = await p.pack("Y2", 2);
    const c1 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: c1.id, codes: [x!.serial] });
    // Moved to Y3 after CNT-1 saw it at Y1; then CNT-2 does not find it at Y3.
    await p.owner.stock.move({ bundleIds: [x!.id], toLocationId: p.loc("Y3") });
    const c2 = await p.supervisor.count.start({ locationIds: [p.loc("Y3")] });
    const r2 = await p.supervisor.count.close({ sessionId: c2.id, confirmUnscanned: true });
    expect(ids(r2.phantom)).toEqual([x!.id]);
    expect(r2.phantom[0]!.seenElsewhere).toBeNull();
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 1, weightG: 25_000 });
    expect(voided(await p.supervisor.count.resolve({ sessionId: c2.id, action: "void_phantom", bundleIds: [x!.id] })).requested).toBe(1);
  });

  test("a later count that matched the bundle in place: the earlier phantom line is flagged but not blocked, and the approval clears it", async () => {
    const p = await plant();
    const [a, x] = await p.pack("Y1", 2);
    const c1 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: c1.id, codes: [a!.serial] });
    await p.supervisor.count.close({ sessionId: c1.id });
    const c2 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: c2.id, codes: [a!.serial, x!.serial] });
    await p.supervisor.count.close({ sessionId: c2.id });
    const flag = (await p.viewer.count.get({ sessionId: c1.id })).report.phantom[0]!.seenElsewhere;
    expect(flag).toMatchObject({ number: "CNT-2", locationCode: "Y1", countOpen: false, resolveThere: false });
    const res = voided(await p.supervisor.count.resolve({ sessionId: c1.id, action: "void_phantom", bundleIds: [x!.id] }));
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    expect((await bundleRow(x!.id)).status).toBe("available");
    expect((await linesOf(c1.id)).find((l) => l.bundleId === x!.id)!.resolution).toBe("cleared");
    // A settled line carries no flag.
    expect((await p.viewer.count.get({ sessionId: c1.id })).report.phantom[0]!.seenElsewhere).toBeNull();
  });
});

describe("phantomSummary over an evening of yard counts (correctness r0 M-2)", () => {
  test("lastDay adds up every count closed on the last count's company calendar day (IST, not UTC); lastCount names its yards", async () => {
    const p = await plant();
    // 1 Jul 09:30 IST: Y3 counted, its one bundle missing (a different local day).
    setClock(new Date(Date.UTC(2026, 6, 1, 4, 0, 0)));
    await p.pack("Y3", 1);
    const y3 = await p.supervisor.count.start({ locationIds: [p.loc("Y3")] });
    await p.supervisor.count.close({ sessionId: y3.id, confirmUnscanned: true });
    // 2 Jul 00:30 and 01:30 IST (still 1 Jul in UTC): Y1 one of two missing, then Y2 all there.
    setClock(new Date(Date.UTC(2026, 6, 1, 19, 0, 0)));
    const [a1] = await p.pack("Y1", 2);
    const y1 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: y1.id, codes: [a1!.serial] });
    await p.supervisor.count.close({ sessionId: y1.id });
    setClock(new Date(Date.UTC(2026, 6, 1, 20, 0, 0)));
    const y2b = await p.pack("Y2", 2);
    const y2 = await p.supervisor.count.start({ locationIds: [p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: y2.id, codes: y2b.map((b) => b.serial) });
    await p.supervisor.count.close({ sessionId: y2.id });
    const sum = await p.viewer.count.phantomSummary();
    expect(sum.lastCount).toMatchObject({ number: "CNT-3", locationCodes: ["Y2"], expected: 2, phantom: 0, phantomBp: 0 });
    expect(sum.lastDay).toEqual({
      date: "2026-07-02", counts: 2, numbers: ["CNT-2", "CNT-3"], expected: 4, phantom: 1, phantomG: 25_000, phantomBp: 2_500,
    });
  });
});

describe("dev seed reset with counts (spec r0 I-2)", () => {
  test("the demo reset clears the demo company's counts (RESTRICT keys to location), runs again, and numbering restarts at CNT-1", async () => {
    for (const key of ["owner", "operator", "viewer", "office", "staff"]) {
      await env.db.insert(user).values({ id: `dev-user-${key}`, name: key, email: `${key}@orrn.local` }).onConflictDoNothing();
    }
    // Non-literal specifier: apps/server is not part of this package's TypeScript project.
    const seedPath = "../../../apps/server/src/dev-seed";
    const { seedDevData } = (await import(seedPath)) as {
      seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
    };
    const companyId = "dev-company-orrn";
    expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
    const owner = env.caller({ role: "owner", companyId });
    const [first] = await env.db
      .select()
      .from(bundle)
      .where(and(eq(bundle.companyId, companyId), eq(bundle.status, "available")))
      .orderBy(asc(bundle.serial))
      .limit(1);
    const yard = first!.locationId!;
    const otherYard = (await owner.stock.locations.list()).items.find((l) => l.kind === "yard" && l.id !== yard)!.id;
    // A closed count with found and phantom lines and a waiting void request, plus an open count.
    const closed = await owner.count.start({ locationIds: [yard] });
    expect(closed.number).toBe("CNT-1");
    await owner.count.scan({ sessionId: closed.id, codes: [first!.serial, "NOT-A-BUNDLE"] });
    const report = await owner.count.close({ sessionId: closed.id, confirmUnscanned: true });
    if (report.phantom.length > 0) {
      await owner.count.resolve({ sessionId: closed.id, action: "void_phantom", bundleIds: [report.phantom[0]!.bundleId] });
    }
    const open = await owner.count.start({ locationIds: [otherYard] });
    await owner.count.scan({ sessionId: open.id, codes: [first!.serial] });

    expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
    for (const t of [countSession, countLocation, countSeen, countLine]) {
      expect(await env.db.select().from(t).where(eq(t.companyId, companyId))).toHaveLength(0);
    }
    expect((await owner.count.start({ locationIds: [yard] })).number).toBe("CNT-1");
    await expectConsistent(owner, companyId, "dev seed rerun after counts");
  }, 180_000);
});

// Second mutation wave (reviews/PL10-tests-r0.md on 8491dd1): each bracketed id is a mutant the
// suite left alive and the test kills (reviews/PL10-tests-r0-proposed-gaps-8491dd1.test.ts).

describe("review pins (wave 2): start and close with bundles that have no place", () => {
  test("[N19] a second count of a yard that an EARLIER count scanned still asks before closing with no scan at all", async () => {
    const p = await plant();
    const [a, b] = await p.pack("Y1", 2);
    const one = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: one.id, codes: [a!.serial, b!.serial] });
    await p.supervisor.count.close({ sessionId: one.id });
    const two = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await expect(p.supervisor.count.close({ sessionId: two.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("Y1 (2 bundles)"),
    });
    expect((await p.viewer.count.get({ sessionId: two.id })).session.status).toBe("open");
    const report = await p.supervisor.count.close({ sessionId: two.id, confirmUnscanned: true });
    expect(report.summary).toMatchObject({ expected: 2, seen: 0, phantom: 2, phantomBp: 10_000 });
  });


  test("[N08] a retired yard does not make a full count partial: every ACTIVE yard still expects bundles with no place", async () => {
    const p = await plant();
    await p.owner.stock.locations.update({ id: p.loc("Y6"), active: false });
    const [legacy] = await env.seedBundles(p.companyId, p.dieId, 1);
    await p.owner.stock.openingBalance();
    const active = allYards(p).filter((y) => y !== p.loc("Y6"));
    const s = await p.supervisor.count.start({ locationIds: active });
    expect((await p.viewer.count.get({ sessionId: s.id })).session.includeUnplaced).toBe(true);
    await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: ["NOT-A-BUNDLE"] });
    const report = await p.supervisor.count.close({ sessionId: s.id });
    expect(ids(report.phantom)).toEqual([legacy!.id]);
    expect(report.summary).toMatchObject({ expected: 1, phantom: 1, phantomBp: 10_000 });
  });

  test("[N17,N21] close of a full count with no scan at all asks first when only bundles with no place would go missing, and names them", async () => {
    const p = await plant();
    await env.seedBundles(p.companyId, p.dieId, 2);
    await p.owner.stock.openingBalance();
    const s = await p.supervisor.count.start({ locationIds: allYards(p) });
    await expect(p.supervisor.count.close({ sessionId: s.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("2 bundles with no place"),
    });
    expect((await p.viewer.count.get({ sessionId: s.id })).session.status).toBe("open");
    const report = await p.supervisor.count.close({ sessionId: s.id, confirmUnscanned: true });
    expect(report.summary).toMatchObject({ expected: 2, seen: 0, phantom: 2 });
  });
});

describe("review pins (wave 2): void hook scope", () => {
  test("[K28] a bundle listed twice in one void request counts once (requested, bundles and kg in the approval)", async () => {
    const p = await plant();
    const [a, b] = await p.pack("Y1", 2);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] });
    await p.supervisor.count.close({ sessionId: s.id });
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [b!.id, b!.id] }));
    expect(res.requested).toBe(1);
    const [ap] = await env.db.select().from(approval).where(eq(approval.id, res.approvalId));
    expect(ap!.meta).toMatchObject({ bundles: 1, weightG: 25_000 });
  });

  test("[K31] approving one count's void request voids only that approval's phantoms, never another count's pending ones", async () => {
    const p = await plant();
    const [a1, b1] = await p.pack("Y1", 2);
    const [a2, b2] = await p.pack("Y2", 2);
    const c1 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: c1.id, codes: [a1!.serial] });
    await p.supervisor.count.close({ sessionId: c1.id });
    const c2 = await p.supervisor.count.start({ locationIds: [p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: c2.id, codes: [a2!.serial] });
    await p.supervisor.count.close({ sessionId: c2.id });
    const r1 = voided(await p.supervisor.count.resolve({ sessionId: c1.id, action: "void_phantom", bundleIds: [b1!.id] }));
    const r2 = voided(await p.office.count.resolve({ sessionId: c2.id, action: "void_phantom", bundleIds: [b2!.id] }));
    expect(r1.approvalId).not.toBe(r2.approvalId);
    await p.manager.approval.decide({ id: r1.approvalId, decision: "approved" });
    expect((await bundleRow(b1!.id)).status).toBe("void");
    // Count 2's phantom waits for its own approval: still in stock, line still requested, ledger = projection.
    expect((await bundleRow(b2!.id)).status).toBe("available");
    expect((await linesOf(c2.id)).find((l) => l.bundleId === b2!.id)).toMatchObject({ resolution: "void_requested", approvalId: r2.approvalId });
    await expectConsistent(p.owner, p.companyId, "one of two approvals decided");
    await p.manager.approval.decide({ id: r2.approvalId, decision: "approved" });
    expect((await bundleRow(b2!.id)).status).toBe("void");
    await expectConsistent(p.owner, p.companyId, "both approvals decided");
  });
});

describe("review pins (wave 2): report scope", () => {
  test("[K09] phantom ages follow THIS company's time zone, not another company's", async () => {
    await plant(); // an older company on the default (IST) clock
    const p = await plant();
    await env.db.update(company).set({ settings: { timezone: "America/New_York" } }).where(eq(company.id, p.companyId));
    setClock(new Date(Date.UTC(2026, 6, 1, 6, 0, 0)));
    const [a] = await p.pack("Y1", 1);
    // Packed 15 Jun 16:00 in New York (16 Jun 01:30 IST); closed 2 Jul 02:00 New York... 1 Jul 11:30 IST.
    await env.db.update(bundle).set({ createdAt: new Date(Date.UTC(2026, 5, 15, 20, 0, 0)) }).where(eq(bundle.id, a!.id));
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const report = await p.supervisor.count.close({ sessionId: s.id, confirmUnscanned: true });
    // New York: 15 Jun -> 1 Jul = 16 days (IST would say 15).
    expect(report.byAge.map((x) => [x.bucket, x.bundles])).toEqual([
      ["0-15", 0], ["16-30", 1], ["31-60", 0], ["60+", 0],
    ]);
  });

  test("[K10] pendingApprovalId is the count's own: another count's waiting void request never shows on it", async () => {
    const p = await plant();
    const [a1, b1] = await p.pack("Y1", 2);
    const [a2] = await p.pack("Y2", 2);
    const c1 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: c1.id, codes: [a1!.serial] });
    await p.supervisor.count.close({ sessionId: c1.id });
    const c2 = await p.supervisor.count.start({ locationIds: [p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: c2.id, codes: [a2!.serial] });
    await p.supervisor.count.close({ sessionId: c2.id });
    const r1 = voided(await p.supervisor.count.resolve({ sessionId: c1.id, action: "void_phantom", bundleIds: [b1!.id] }));
    expect((await p.viewer.count.get({ sessionId: c1.id })).report.pendingApprovalId).toBe(r1.approvalId);
    expect((await p.viewer.count.get({ sessionId: c2.id })).report.pendingApprovalId).toBeNull();
    // A closed count read again (idempotent close) reports the same.
    expect((await p.supervisor.count.close({ sessionId: c2.id })).pendingApprovalId).toBeNull();
  });
});

describe("review pins (wave 2): cross-wired rows and paging defaults", () => {
  test("[N62] a bundle row that points at another company's die never shows that die's section code", async () => {
    const p = await plant();
    const other = await plant();
    const [a] = await p.pack("Y1", 1);
    await env.db.update(bundle).set({ dieId: other.dieId }).where(eq(bundle.id, a!.id));
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    expect((await p.viewer.count.get({ sessionId: s.id })).report.phantom[0]!.sectionCode).toBeNull();
    const report = await p.supervisor.count.close({ sessionId: s.id, confirmUnscanned: true });
    expect(report.phantom[0]!.sectionCode).toBeNull();
  });

  test("[N50,N51] another company's ledger rows or scans of this company's phantom never clear it (7 am number and void hook)", async () => {
    const p = await plant();
    const other = await plant();
    const [a, x1, x2] = await p.pack("Y1", 3);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] });
    await p.supervisor.count.close({ sessionId: s.id });
    const theirs = await other.supervisor.count.start({ locationIds: [other.loc("Y1")] });
    await env.db.insert(stockLedger).values({
      id: crypto.randomUUID(),
      companyId: other.companyId,
      serverSeq: 9_000_000_000,
      voucherType: "pack",
      voucherId: crypto.randomUUID(),
      line: 1,
      itemKind: "bundle",
      itemRef: x1!.id,
      locationId: other.loc("Y1"),
      qtyG: 1,
      postedAt: new Date(),
    });
    await env.db.insert(countSeen).values({
      id: crypto.randomUUID(),
      companyId: other.companyId,
      serverSeq: 9_000_000_000,
      sessionId: theirs.id,
      locationId: other.loc("Y1"),
      code: "CROSS-1",
      resolveKind: "bundle",
      bundleId: x2!.id,
      scannedAt: new Date(),
    });
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 2, weightG: 50_000 });
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [x1!.id, x2!.id] }));
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    expect((await bundleRow(x1!.id)).status).toBe("void");
    expect((await bundleRow(x2!.id)).status).toBe("void");
  });

  test("[N48] count.get returns 100 scans by default, newest first, and says where the next page starts", async () => {
    const p = await plant();
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    for (const from of [0, 100, 200]) {
      await p.supervisor.count.scan({
        sessionId: s.id,
        codes: Array.from({ length: from === 200 ? 1 : 100 }, (_, i) => `U-${String(from + i).padStart(3, "0")}`),
      });
    }
    const page = await p.viewer.count.get({ sessionId: s.id });
    expect(page.scans).toHaveLength(100);
    expect(page).toMatchObject({ scanTotal: 201, scanNextOffset: 100 });
    expect(page.scans[0]!.code).toBe("U-200");
    // The page size is capped at 500.
    await expect(p.viewer.count.get({ sessionId: s.id, scanLimit: 501 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, 120_000);

  test("[C57] a count line of this company that points at another company's bundle never counts as a missing phantom", async () => {
    const p = await plant();
    const other = await plant();
    const [theirs] = await env.seedBundles(other.companyId, other.dieId, 1);
    await env.db.update(bundle).set({ locationId: other.loc("Y1") }).where(eq(bundle.id, theirs!.id));
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.close({ sessionId: s.id });
    await env.db.insert(countLine).values({
      id: crypto.randomUUID(),
      companyId: p.companyId,
      sessionId: s.id,
      kind: "phantom",
      bundleId: theirs!.id,
      systemLocationId: other.loc("Y1"),
      weightG: 25_000,
    });
    expect((await p.viewer.count.phantomSummary()).open).toEqual({ bundles: 0, weightG: 0 });
  });
});

describe("review pins (wave 2): closed totals are per count", () => {
  test("[K14] two counts closed in the same millisecond: the later one is the last count (ties break on server_seq)", async () => {
    const p = await plant();
    setClock(new Date(Date.UTC(2026, 6, 1, 6, 0, 0)));
    const [a] = await p.pack("Y1", 1);
    for (const n of ["CNT-1", "CNT-2"]) {
      const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
      expect(s.number).toBe(n);
      await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] });
      await p.supervisor.count.close({ sessionId: s.id });
    }
    expect((await p.viewer.count.phantomSummary()).lastCount).toMatchObject({ number: "CNT-2" });
    expect((await p.viewer.count.list({})).items.map((r) => r.number)).toEqual(["CNT-2", "CNT-1"]);
  });

  test("[K04,K07] a closed count's totals are its own: seen, matched and phantom kg never include another count's scans or phantoms", async () => {
    const p = await plant();
    const [a1] = await p.pack("Y1", 2, 25_000);
    const [a2] = await p.pack("Y2", 3, 10_000);
    const one = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: one.id, codes: [a1!.serial, "ZZ-UNKNOWN"] });
    const r1 = await p.supervisor.count.close({ sessionId: one.id });
    expect(r1.summary).toEqual({ expected: 2, seen: 2, matched: 1, phantom: 1, phantomG: 25_000, found: 1, moved: 0, changed: 0, seenElsewhere: 0, phantomBp: 5_000 });
    const two = await p.supervisor.count.start({ locationIds: [p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: two.id, codes: [a2!.serial] });
    const r2 = await p.supervisor.count.close({ sessionId: two.id });
    expect(r2.summary).toEqual({ expected: 3, seen: 1, matched: 1, phantom: 2, phantomG: 20_000, found: 0, moved: 0, changed: 0, seenElsewhere: 0, phantomBp: 6_667 });
    // Count 1 read again after count 2 closed, and the list rows, still carry count 1's own numbers.
    expect((await p.viewer.count.get({ sessionId: one.id })).report.summary).toEqual(r1.summary);
    const rows = (await p.viewer.count.list({})).items;
    expect(rows.map((r) => [r.number, r.seen, r.phantom, r.phantomG, r.found])).toEqual([
      ["CNT-2", 1, 2, 20_000, 0],
      ["CNT-1", 2, 1, 25_000, 1],
    ]);
  });
});

describe("review pins (wave 2): scan races", () => {
  test("[N27,N28,N32] RACE: the other scan landed at another yard first, under the same unknown code or under another form of the same bundle: the duplicate names that yard", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const cuid = "ckz3p1x9q0000abcd1234efgh";
    await env.db.insert(legacyBundleMap).values({ id: crypto.randomUUID(), companyId: p.companyId, legacyId: cuid, bundleId: a!.id });
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
    env.beforeNextBatch(() => p.packer.count.scan({ sessionId: s.id, locationId: p.loc("Y2"), codes: ["LOT/9"] }));
    const sameCode = await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: ["LOT/9"] });
    expect(sameCode.results[0]).toMatchObject({ outcome: "duplicate", firstLocationId: p.loc("Y2"), seenId: null });
    env.beforeNextBatch(() => p.packer.count.scan({ sessionId: s.id, locationId: p.loc("Y2"), codes: [cuid] }));
    const otherForm = await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: [a!.serial] });
    expect(otherForm.results[0]).toMatchObject({ outcome: "duplicate", firstLocationId: p.loc("Y2"), seenId: null });
  });
});

describe("review pins (wave 2): move_found and resolve", () => {
  test("[R77] a bundle that is a found line in one count and a phantom of a later count resolves per count", async () => {
    const p = await plant();
    const [b, x] = await p.pack("Y2", 2);
    const c1 = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: c1.id, codes: [b!.serial] });
    const r1 = await p.supervisor.count.close({ sessionId: c1.id });
    expect(r1.found).toHaveLength(1);
    const c2 = await p.supervisor.count.start({ locationIds: [p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: c2.id, codes: [x!.serial] });
    const r2 = await p.supervisor.count.close({ sessionId: c2.id });
    expect(ids(r2.phantom)).toEqual([b!.id]);
    // Count 1's line says "seen at Y1": move it there. Count 2's line (a phantom) must not be consulted.
    const res = movedFound(await p.supervisor.count.resolve({ sessionId: c1.id, action: "move_found", bundleIds: [b!.id] }));
    expect(res.moved).toBe(1);
    expect((await bundleRow(b!.id)).locationId).toBe(p.loc("Y1"));
    await expectConsistent(p.owner, p.companyId, "found line moved, phantom line of another count");
  });

  test("[R13,R34] scanning or removing scans on a closed count is refused even when nothing new would be written", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    await p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] });
    await p.supervisor.count.close({ sessionId: s.id });
    await expect(p.supervisor.count.scan({ sessionId: s.id, codes: [a!.serial] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.supervisor.count.removeScans({ sessionId: s.id, seenIds: [crypto.randomUUID()] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("[K29] RACE: someone moves the bundle to the very yard it was seen at before move_found lands — nothing is posted for it, the line stays open", async () => {
    const p = await plant();
    const [a] = await p.pack("Y2", 1);
    const [x] = await p.pack("Y1", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
    await p.supervisor.count.scan({ sessionId: s.id, locationId: p.loc("Y1"), codes: [a!.serial, x!.serial] });
    await p.supervisor.count.close({ sessionId: s.id });
    env.beforeNextBatch(() => p.owner.stock.move({ bundleIds: [a!.id], toLocationId: p.loc("Y1") }));
    const res = movedFound(await p.supervisor.count.resolve({ sessionId: s.id, action: "move_found", bundleIds: [a!.id] }));
    expect(res).toMatchObject({ moved: 0, skipped: [a!.id], voucherIds: [] });
    const line = (await linesOf(s.id)).find((l) => l.bundleId === a!.id)!;
    expect(line).toMatchObject({ resolution: "open", resolutionVoucherId: null });
    // Only the other request's own move rows (one pair) exist for the bundle.
    expect((await ledgerRows(p.companyId)).filter((r) => r.itemRef === a!.id && r.voucherType === "move")).toHaveLength(2);
    await expectConsistent(p.owner, p.companyId, "after race to the seen yard");
  });

  test("[K27] resolve on an open count says to close it first (not 'not on the report')", async () => {
    const p = await plant();
    const [a] = await p.pack("Y1", 1);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    for (const action of ["void_phantom", "move_found"] as const) {
      await expect(p.supervisor.count.resolve({ sessionId: s.id, action, bundleIds: [a!.id] })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("Close CNT-1 first"),
      });
    }
    await p.supervisor.count.cancel({ sessionId: s.id, reason: "test" });
    await expect(p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: [a!.id] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Close CNT-1 first"),
    });
  });
});

describe("review pins (wave 2): permission pins", () => {
  test("[R70] move_found also needs stock.move; today both actions have the same holders, so the extra check cannot fail: pin it", () => {
    expect([...COUNTERS].sort()).toEqual(ROLES.filter((r) => can(r, "stock.move")).sort());
  });
});

describe("review pins (wave 2): small contracts", () => {
  test("[K37] byCast breaks a tie between casts of equal kg by cast id, so the report is stable", async () => {
    const p = await plant();
    const [a, b] = await p.pack("Y1", 2, 10_000);
    await env.db.update(bundle).set({ castId: "cast-b" }).where(eq(bundle.id, a!.id));
    await env.db.update(bundle).set({ castId: "cast-a" }).where(eq(bundle.id, b!.id));
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    const report = await p.supervisor.count.close({ sessionId: s.id, confirmUnscanned: true });
    expect(report.byCast.map((c) => c.castId)).toEqual(["cast-a", "cast-b"]);
  });

  test("[N20] the close warning says '1 bundle' for one bundle and '2 bundles' for two", async () => {
    const p = await plant();
    await p.pack("Y1", 1);
    await p.pack("Y2", 2);
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1"), p.loc("Y2")] });
    await expect(p.supervisor.count.close({ sessionId: s.id })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("Y1 (1 bundle), Y2 (2 bundles)"),
    });
  });

  test("[K23] removeScans with ids that are not in the count removes 0 and writes no audit row", async () => {
    const p = await plant();
    const s = await p.supervisor.count.start({ locationIds: [p.loc("Y1")] });
    expect(await p.supervisor.count.removeScans({ sessionId: s.id, seenIds: [crypto.randomUUID()] })).toEqual({ removed: 0 });
    expect(await auditActions(p.companyId)).not.toContain("count.removeScans");
  });
});

describe("review pins (wave 2): hook guards", () => {
  test("[A01,A07,A11] the phantom_void hook changes nothing for a decision that did not land (decided row with another sequence)", async () => {
    const { p, s, phantoms } = await closedWithPhantoms(2);
    const res = voided(await p.supervisor.count.resolve({ sessionId: s.id, action: "void_phantom", bundleIds: phantoms.map((b) => b.id) }));
    const before = await ledgerRows(p.companyId);
    const events = () => env.db.select().from(bundleStatusEvent).where(eq(bundleStatusEvent.companyId, p.companyId));
    const eventsBefore = await events();
    // The approval row is still pending: no decision carries this sequence, so nothing may land.
    const ctx = { db: env.db, companyId: p.companyId, userId: p.users.manager.id, seq: 9_000_000_001, decidedAt: new Date() };
    for (const decision of ["approved", "rejected"] as const) {
      await atomicBatch(env.db, APPROVAL_APPLIERS.phantom_void!(ctx, { id: res.approvalId, subjectId: s.id }, decision));
    }
    for (const b of phantoms) expect((await bundleRow(b.id)).status).toBe("available");
    expect((await linesOf(s.id)).filter((l) => l.kind === "phantom").map((l) => l.resolution)).toEqual(["void_requested", "void_requested"]);
    expect(await ledgerRows(p.companyId)).toEqual(before);
    expect(await events()).toEqual(eventsBefore);
    await expectConsistent(p.owner, p.companyId, "forged decision");
    // The real decision still applies.
    await p.manager.approval.decide({ id: res.approvalId, decision: "approved" });
    for (const b of phantoms) expect((await bundleRow(b.id)).status).toBe("void");
    await expectConsistent(p.owner, p.companyId, "real decision");
  });
});
