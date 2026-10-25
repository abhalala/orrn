/**
 * W3-PORTAL-S dispatches, packing list and test certificate for the party (FP-PF-03/04, C30, D28, Q39):
 * completed dispatches of the party's own customer only (draft and held hidden, other parties Not
 * found); the PL snapshot without cast numbers (Q39), the author id or office notes; the certificate
 * (TC/{FY}/n, revisions keep the number) with the BIS pair and the cast numbers behind the bundles,
 * each with its own chemistry (ppm and % to 3 dp) or "pending" while the foundry has no result; a
 * failed cast is shown as failed, never hidden. Q39 is the PL only (D28).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, bundle, cast, die, dispatch, melt, spectroResult, testCertificate } from "@orrn/db/schema";
import { and, eq, inArray } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { portalHelpers } from "./portal-w3-fixture";
import { kg, NOON, ROLES, SLOW, type SalesPlant } from "./sales-fixture";

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

const helpers = portalHelpers(() => env);
/** Casts with melts exist in these plants; bundles here are packed without naming one (set below). */
const h = { ...helpers, portalPlant: (settings: Record<string, unknown> = {}) => helpers.portalPlant({ requireCastOnBundle: false, ...settings }) };

async function errOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    return { code: (e as { code?: string }).code, message: (e as Error).message };
  }
  return { code: "OK", message: "" };
}

/** A cast with a melt; `spectro` adds a live spectro result. */
async function seedCast(
  companyId: string,
  n: number,
  spectro?: { verdict: "pass" | "fail" | "incomplete"; si: number; mg: number; fe?: number; al?: number; alSource?: "measured" | "balance" },
) {
  const castId = crypto.randomUUID();
  await env.db.insert(cast).values({ id: castId, companyId, number: `K${n}`, period: "2026-10", year: 2026, month: 10, seq: n, alloy: "6063", openedAt: NOON });
  const meltId = crypto.randomUUID();
  await env.db.insert(melt).values({ id: meltId, companyId, castId, seq: 1, alloy: "6063" });
  if (spectro) {
    await env.db.insert(spectroResult).values({
      id: crypto.randomUUID(),
      companyId,
      meltId,
      castId,
      fileName: "s.pdf",
      mime: "application/pdf",
      sizeBytes: 1,
      dataBase64: "AA==",
      siPpm: spectro.si,
      mgPpm: spectro.mg,
      fePpm: spectro.fe ?? null,
      alPpm: spectro.al ?? null,
      alSource: spectro.alSource ?? null,
      verdict: spectro.verdict,
      limitsSnapshot: { alloyId: null, alloyCode: "6063", limits: [] },
    });
  }
  return castId;
}

/** Pack `rows`, ship them for `cust` on a completed dispatch; returns dispatch id and serials. */
async function shipped(p: SalesPlant, rows: number[], cust = p.customerId, castId?: string, notes?: string) {
  const serials = await p.pack(p.dieA, rows.map((k) => ({ kg: k })));
  if (castId) await env.db.update(bundle).set({ castId }).where(and(eq(bundle.companyId, p.companyId), inArray(bundle.serial, serials)));
  const d = await p.held(serials, cust);
  if (notes) await env.db.update(dispatch).set({ notes }).where(eq(dispatch.id, d));
  await p.owner.dispatch.complete({ id: d });
  return { d, serials };
}

describe("dispatches", () => {
  test("only completed dispatches of this party; draft / held / other party hidden; get of another's is Not found", async () => {
    setClock(NOON);
    const p = await h.portalPlant();
    const party = await h.partyLogin(p);
    const mine = await shipped(p, [10, 12]);
    const theirs = await shipped(p, [9], p.otherCustomer);
    const held = await p.held(await p.pack(p.dieA, [{ kg: 5 }]));
    const draft = (await p.owner.dispatch.create({ customerId: p.customerId })).id;
    const list = await party.api.portal.dispatches.list();
    expect(list.items.map((d) => d.id)).toEqual([mine.d]);
    expect(list.items[0]).toMatchObject({ bundles: 2, weightG: kg(22), hasPackingList: true, hasCertificate: false });
    const got = await party.api.portal.dispatches.get({ id: mine.d });
    expect(got.bundles.map((b) => b.bundleNo).sort()).toEqual([...mine.serials].sort());
    expect(got.totals).toMatchObject({ bundles: 2, weightG: kg(22) });
    for (const id of [theirs.d, held, draft, "nope"]) {
      expect(await errOf(party.api.portal.dispatches.get({ id }))).toEqual({ code: "NOT_FOUND", message: "Not found" });
      expect(await errOf(party.api.portal.packingList.get({ dispatchId: id }))).toEqual({ code: "NOT_FOUND", message: "Not found" });
      expect(await errOf(party.api.portal.certificate.get({ dispatchId: id }))).toEqual({ code: "NOT_FOUND", message: "Not found" });
    }
    expect((await party.api.portal.today()).lastDispatch?.id).toBe(mine.d);
  }, SLOW);
});

describe("packing list", () => {
  test("the current PL snapshot of the party's dispatch, with no cast number, author id or office notes", async () => {
    setClock(NOON);
    const p = await h.portalPlant();
    const party = await h.partyLogin(p);
    const castId = await seedCast(p.companyId, 31);
    const officeNote = "rate 245 agreed with Bhavesh; hold 2 bundles";
    const mine = await shipped(p, [10, 11], p.customerId, castId, officeNote);
    // The staff copy carries the note (so this test bites); the party's never does.
    const staffPl = await p.owner.packingList.byDispatch({ dispatchId: mine.d });
    expect(JSON.stringify(staffPl)).toContain(officeNote);
    const pl = await party.api.portal.packingList.get({ dispatchId: mine.d });
    const text = JSON.stringify(pl);
    expect(text).not.toMatch(/cast/i);
    expect(text).not.toContain("K31");
    expect(text).not.toContain(castId);
    expect(text).not.toContain("generatedBy");
    expect(text).not.toContain("rate 245");
    expect(text).not.toMatch(/"notes"|salesOrderLineId|"groupId"/);
    expect((pl.snapshot as { dispatch: Record<string, unknown> }).dispatch.notes).toBeUndefined();
    for (const serial of mine.serials) expect(text).toContain(serial);
    // Regenerated: the party gets the newest revision.
    const staff = await p.owner.packingList.byDispatch({ dispatchId: mine.d });
    await p.owner.packingList.regenerate({ id: staff!.id });
    const again = await party.api.portal.packingList.get({ dispatchId: mine.d });
    expect(again.revision).toBe(2);
    expect(again.code).toBe(pl.code);
  }, SLOW);

  test("stripForParty (PL) drops cast keys, rate keys, the author id, notes and grouping ids at any depth", async () => {
    const { stripForParty } = await import("../src/lib/portal");
    expect(
      stripForParty({
        a: 1,
        castNo: "K31",
        generatedBy: "u",
        generatedAt: "t",
        rows: [{ cast: "K", ratePaise: 1, weightG: 5, groupId: "g" }],
        header: { castCode: "x", plNumber: "PL/1" },
        dispatch: { code: "D-1", notes: "rate 245" },
        groups: [{ key: "k", salesOrderLineId: "sol" }],
      }),
    ).toEqual({ a: 1, generatedAt: "t", rows: [{ weightG: 5 }], header: { plNumber: "PL/1" }, dispatch: { code: "D-1" }, groups: [{ key: "k" }] });
  });

  test("stripCertificateForParty keeps casts and chemistry; drops only the author id and rate keys (D28)", async () => {
    const { stripCertificateForParty } = await import("../src/lib/portal");
    expect(
      stripCertificateForParty({
        generatedBy: "u",
        ratePerKg: 1,
        amountPaise: 2,
        casts: [{ castNo: "K31", status: "tested", elements: [{ element: "si", ppm: 4500, pct: "0.450" }] }],
        chemistry: { status: "ready" },
      }),
    ).toEqual({ casts: [{ castNo: "K31", status: "tested", elements: [{ element: "si", ppm: 4500, pct: "0.450" }] }], chemistry: { status: "ready" } });
  });
});

describe("test certificate", () => {
  test("pending chemistry while the foundry has no result; BIS pair as of issue; number TC/FY/n; party reads it", async () => {
    setClock(NOON);
    const p = await h.portalPlant({ standards: { solid: { standard: "IS 733", cml: "" }, hollow: { standard: "IS 1285", cml: "CM/L-1234" } } });
    await env.db.update(die).set({ alloy: "6063", temper: "T6", profileKind: "hollow" }).where(eq(die.id, p.dieA));
    const party = await h.partyLogin(p);
    const castId = await seedCast(p.companyId, 40);
    const mine = await shipped(p, [10, 12], p.customerId, castId);
    expect(await errOf(party.api.portal.certificate.get({ dispatchId: mine.d }))).toEqual({ code: "NOT_FOUND", message: "Not found" });
    const issued = await p.as("office").portal.certificates.issue({ dispatchId: mine.d });
    expect(issued).toMatchObject({ number: "TC/2026-27/1", revision: 1, chemistry: "pending" });
    const cert = await party.api.portal.certificate.get({ dispatchId: mine.d });
    const snap = cert.snapshot as {
      lines: { sectionCode: string; alloy: string; temper: string; standard: string; cml: string | null; standardSource: string; bundles: number; weightG: number }[];
      chemistry: { status: string; verdict: string | null; testedBundles: number; untestedBundles: number };
      totals: { bundles: number; weightG: number };
      notTaxDocument: boolean;
    };
    expect(snap.chemistry).toMatchObject({ status: "pending", verdict: null, testedBundles: 0, untestedBundles: 2 });
    expect(snap.lines).toHaveLength(1);
    // Bundles packed through the real pack path carry the pair as packed; legacy ones read it at issue.
    expect(snap.lines[0]).toMatchObject({ alloy: "6063", temper: "T6", standard: "IS 1285", bundles: 2, weightG: kg(22) });
    expect(snap.notTaxDocument).toBe(true);
    // D28: the certificate cites the cast by number, with "chemistry pending" for it (Q39 is the PL only).
    const casts = (cert.snapshot as { casts: Record<string, unknown>[] }).casts;
    expect(casts).toEqual([
      { castNo: "K40", alloy: "6063", status: "pending", verdict: null, bundles: 2, pcs: expect.any(Number), weightG: kg(22), sectionCodes: [expect.any(String)], alBalance: false, elements: [] },
    ]);
    const text = JSON.stringify(cert);
    expect(text).toContain("K40");
    expect(text).not.toContain(castId);
    expect(text).not.toContain("generatedBy");
    expect(text).not.toMatch(/rate|paise/i);
    expect((await party.api.portal.dispatches.list()).items[0]!.hasCertificate).toBe(true);
    const a = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "portal.certificate.issue")));
    expect(a[0]?.meta).toMatchObject({ dispatchId: mine.d, number: "TC/2026-27/1", revision: 1, chemistry: "pending" });
  }, SLOW);

  test("one row per (dispatch, revision): a second revision 1 under another number cannot land (two racing first issues)", async () => {
    setClock(NOON);
    const p = await h.portalPlant();
    const mine = await shipped(p, [10]);
    await p.as("office").portal.certificates.issue({ dispatchId: mine.d });
    const [first] = await env.db.select().from(testCertificate).where(eq(testCertificate.dispatchId, mine.d));
    let msg = "";
    try {
      await env.db.insert(testCertificate).values({ ...first!, id: crypto.randomUUID(), number: "TC/2026-27/99" });
    } catch (e) {
      msg = `${(e as Error).message} ${String((e as { cause?: Error }).cause?.message ?? "")}`;
    }
    expect(msg).toContain("UNIQUE constraint failed: test_certificate");
    expect(await env.db.select().from(testCertificate).where(eq(testCertificate.dispatchId, mine.d))).toHaveLength(1);
  }, SLOW);

  test("a blank CM/L prints no licence; legacy bundles without a packed pair use the live pair as of issue", async () => {
    setClock(NOON);
    const p = await h.portalPlant({ standards: { solid: { standard: "IS 733", cml: "" } } });
    const party = await h.partyLogin(p);
    const mine = await shipped(p, [10]);
    await env.db.update(bundle).set({ bisStandard: null, cmlNo: null }).where(and(eq(bundle.companyId, p.companyId), inArray(bundle.serial, mine.serials)));
    await p.as("office").portal.certificates.issue({ dispatchId: mine.d });
    const cert = await party.api.portal.certificate.get({ dispatchId: mine.d });
    const line = (cert.snapshot as { lines: Record<string, unknown>[] }).lines[0]!;
    expect(line).toMatchObject({ standard: "IS 733", cml: null, standardSource: "as_of_issue", profileKindSet: false });
  }, SLOW);

  test("chemistry: partial with one cast tested, ready with all; re-issue keeps the number, adds a revision", async () => {
    setClock(NOON);
    const p = await h.portalPlant();
    const party = await h.partyLogin(p);
    const tested = await seedCast(p.companyId, 51, { verdict: "pass", si: 4_500, mg: 5_000 });
    const untested = await seedCast(p.companyId, 52);
    const a = await p.pack(p.dieA, [{ kg: 10 }]);
    const b = await p.pack(p.dieA, [{ kg: 11 }]);
    await env.db.update(bundle).set({ castId: tested }).where(and(eq(bundle.companyId, p.companyId), inArray(bundle.serial, a)));
    await env.db.update(bundle).set({ castId: untested }).where(and(eq(bundle.companyId, p.companyId), inArray(bundle.serial, b)));
    const d = await p.held([...a, ...b]);
    await p.owner.dispatch.complete({ id: d });
    const first = await p.as("office").portal.certificates.issue({ dispatchId: d });
    expect(first.chemistry).toBe("partial");
    const firstCasts = (await party.api.portal.certificate.get({ dispatchId: d })).snapshot.casts as {
      castNo: string;
      status: string;
      verdict: string | null;
      bundles: number;
      elements: { element: string; ppm: number | null; pct: string | null }[];
    }[];
    expect(firstCasts.map((c) => [c.castNo, c.status, c.verdict, c.bundles])).toEqual([
      ["K51", "tested", "pass", 1],
      ["K52", "pending", null, 1],
    ]);
    expect(firstCasts[0]!.elements.find((e) => e.element === "si")).toEqual({ element: "si", ppm: 4_500, pct: "0.450" });
    expect(firstCasts[0]!.elements.find((e) => e.element === "mg")).toEqual({ element: "mg", ppm: 5_000, pct: "0.500" });
    expect(firstCasts[0]!.elements.find((e) => e.element === "cu")).toEqual({ element: "cu", ppm: null, pct: null });
    expect(firstCasts[1]!.elements).toEqual([]);
    // The foundry tests the second cast; the office re-issues.
    const meltRow = (await env.db.select().from(melt).where(eq(melt.castId, untested)))[0]!;
    await env.db.insert(spectroResult).values({
      id: crypto.randomUUID(),
      companyId: p.companyId,
      meltId: meltRow.id,
      castId: untested,
      fileName: "s.pdf",
      mime: "application/pdf",
      sizeBytes: 1,
      dataBase64: "AA==",
      siPpm: 4_300,
      mgPpm: 5_200,
      verdict: "pass",
      limitsSnapshot: { alloyId: null, alloyCode: "6063", limits: [] },
    });
    const second = await p.as("supervisor").portal.certificates.issue({ dispatchId: d });
    expect(second).toMatchObject({ number: first.number, revision: 2, chemistry: "ready" });
    const cert = await party.api.portal.certificate.get({ dispatchId: d });
    expect(cert.revision).toBe(2);
    const chem = (cert.snapshot as { chemistry: { verdict: string; elements: { element: string; minPpm: number; maxPpm: number }[]; alloys: string[] } }).chemistry;
    expect(chem.verdict).toBe("pass");
    expect(chem.alloys).toEqual(["6063"]);
    expect(chem.elements.find((e) => e.element === "si")).toEqual({ element: "si", minPpm: 4_300, maxPpm: 4_500 });
    expect(chem.elements.find((e) => e.element === "mg")).toEqual({ element: "mg", minPpm: 5_000, maxPpm: 5_200 });
    // Each cast keeps its own chemistry (not a range across casts).
    const casts = (cert.snapshot as { casts: { castNo: string; status: string; elements: { element: string; pct: string | null }[] }[] }).casts;
    expect(casts.map((c) => [c.castNo, c.status, c.elements.find((e) => e.element === "si")?.pct])).toEqual([
      ["K51", "tested", "0.450"],
      ["K52", "tested", "0.430"],
    ]);
    expect(await env.db.select().from(testCertificate).where(eq(testCertificate.dispatchId, d))).toHaveLength(2);
  }, SLOW);

  test("a failed cast is shown as failed (issue not refused); no-cast bundles counted apart; Al balance; dieBands off: no band", async () => {
    setClock(NOON);
    const p = await h.portalPlant({ dieBands: false });
    const party = await h.partyLogin(p);
    const failed = await seedCast(p.companyId, 61, { verdict: "fail", si: 9_100, mg: 5_000, fe: 3_500, al: 982_400, alSource: "balance" });
    const a = await p.pack(p.dieA, [{ kg: 10 }, { kg: 12 }]);
    const none = await p.pack(p.dieA, [{ kg: 7 }]);
    await env.db.update(bundle).set({ castId: failed }).where(and(eq(bundle.companyId, p.companyId), inArray(bundle.serial, a)));
    await env.db.update(bundle).set({ castId: null }).where(and(eq(bundle.companyId, p.companyId), inArray(bundle.serial, none)));
    const d = await p.held([...a, ...none]);
    await p.owner.dispatch.complete({ id: d });
    const issued = await p.as("office").portal.certificates.issue({ dispatchId: d });
    expect(issued.chemistry).toBe("partial");
    const cert = await party.api.portal.certificate.get({ dispatchId: d });
    const snap = cert.snapshot as {
      chemistry: { verdict: string; failedCasts: number; noCastBundles: number; testedBundles: number; untestedBundles: number };
      casts: { castNo: string; status: string; verdict: string; bundles: number; weightG: number; alBalance: boolean; elements: { element: string; ppm: number | null; pct: string | null }[] }[];
    };
    expect(snap.chemistry).toMatchObject({ verdict: "fail", failedCasts: 1, noCastBundles: 1, testedBundles: 2, untestedBundles: 1 });
    expect(snap.casts).toHaveLength(1);
    expect(snap.casts[0]).toMatchObject({ castNo: "K61", status: "failed", verdict: "fail", bundles: 2, weightG: kg(22), alBalance: true });
    expect(snap.casts[0]!.elements.find((e) => e.element === "si")).toEqual({ element: "si", ppm: 9_100, pct: "0.910" });
    expect(snap.casts[0]!.elements.find((e) => e.element === "al")).toEqual({ element: "al", ppm: 982_400, pct: "98.240" });
    // dieBands off: nothing on the certificate gives a band away.
    expect(JSON.stringify(cert)).not.toMatch(/band|minG|maxG|kgPer12ft|range/i);
  }, SLOW);

  test("issue / forDispatch: completed dispatch only; portal.manage or dispatch.complete holders; another plant Not found", async () => {
    setClock(NOON);
    const p = await h.portalPlant();
    const other = await h.portalPlant();
    const held = await p.held(await p.pack(p.dieA, [{ kg: 5 }]));
    expect((await errOf(p.as("office").portal.certificates.issue({ dispatchId: held }))).code).toBe("BAD_REQUEST");
    const mine = await shipped(p, [10]);
    expect((await errOf(other.as("office").portal.certificates.issue({ dispatchId: mine.d }))).code).toBe("NOT_FOUND");
    const allowed = new Set(["owner", "admin", "manager", "office", "supervisor"]);
    for (const role of ROLES) {
      if (allowed.has(role)) continue;
      expect([role, (await errOf(p.as(role).portal.certificates.issue({ dispatchId: mine.d }))).code]).toEqual([role, "FORBIDDEN"]);
    }
    expect(await env.db.select().from(testCertificate).where(eq(testCertificate.dispatchId, mine.d))).toHaveLength(0);
    // forDispatch (casts + chemistry) has the same gate as issue: portal.manage or dispatch.complete.
    for (const role of ROLES) {
      const res = await errOf(p.as(role).portal.certificates.forDispatch({ dispatchId: mine.d }));
      expect([role, res.code]).toEqual([role, allowed.has(role) ? "OK" : "FORBIDDEN"]);
    }
    expect(await p.as("supervisor").portal.certificates.forDispatch({ dispatchId: mine.d })).toBeNull();
  }, SLOW);
});
