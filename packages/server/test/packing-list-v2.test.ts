/**
 * W1-PK-S FP-PK-13: packing list v2 on top of PL-8. Rows sort section → cut length → party number;
 * section subtotals; hollow / solid / semi summary without zero kinds; the original SO column (on by
 * default); branding off hides logo and tagline but never the legal name. Regenerate is a new
 * revision under the same number (the sent one is kept, C24); combine takes a new number over
 * several dispatches of one customer. The PL number advances on first issue and combine only.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { bundle, customer, die, dispatchItem, docSeries, packingList, packingListDispatch } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { precreateDevSeedUsers } from "./dev-seed-fixture";
import { kg, NOON, salesHelpers, SLOW, type SalesPlant } from "./sales-fixture";

let env: TestEnv;
let setClock: (at: Date | null) => void;
let plSchema: typeof import("../src/lib/packingListSnapshot").plSnapshotV2Schema;
type Snap = import("../src/lib/packingListSnapshot").PlSnapshotV2;

const docsPath = "../../documents/src/packing-list/index";
type Docs = {
  buildPackingListHtml(pl: never, code: string): string;
  buildPackingListXlsxBuffer(pl: never, code: string): Uint8Array;
};

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
  plSchema = (await import("../src/lib/packingListSnapshot")).plSnapshotV2Schema;
}, 60_000);
afterEach(() => setClock(null));
afterAll(async () => {
  await env.dispose();
});

const { plant, plRow, dispatchRow } = salesHelpers(() => env);

const LETTERHEAD = {
  legalName: "Fourcubes Aluminium Pvt Ltd",
  gstin: "24AAACF1234A1Z5",
  address: "Plot 12, GIDC, Surat 394 230",
  phone: "+91 98250 00000",
  tagline: "Extrusions since 1994",
  logoUrl: "https://example.com/logo.png",
};

async function lifelong(p: SalesPlant, customerId: string) {
  const [c] = await env.db.select({ name: customer.name }).from(customer).where(eq(customer.id, customerId));
  await p.owner.customer.update({ id: customerId, name: c!.name, bundleNumberPolicy: "lifelong" });
}

async function plSeries(companyId: string) {
  const [s] = await env.db.select().from(docSeries).where(and(eq(docSeries.companyId, companyId), eq(docSeries.docType, "pl")));
  return s?.value ?? 0;
}

/** Pack for a line with explicit rows; ship them all on one completed dispatch. */
async function shipped(p: SalesPlant, lineId: string, dieId: string, rows: { kg: number; mm?: number }[], cust?: string) {
  const serials = await p.pack(dieId, rows, lineId);
  const d = await p.held(serials, cust);
  const done = await p.owner.dispatch.complete({ id: d });
  return { d, done, serials };
}

describe("PL v2 snapshot", () => {
  test("rows sort by cut length then party number (natural); sections subtotal; kinds omit zero; original SO on", async () => {
    setClock(NOON);
    const p = await plant({ settings: { letterhead: LETTERHEAD } });
    await env.db.update(die).set({ profileKind: "hollow" }).where(eq(die.id, p.dieA));
    await env.db.update(die).set({ profileKind: "solid" }).where(eq(die.id, p.dieB));
    await lifelong(p, p.customerId);
    const o = await p.order([
      { dieId: p.dieA, kg: 5000 },
      { dieId: p.dieA, kg: 5000 },
      { dieId: p.dieB, kg: 5000 },
    ]);
    // Party numbers 1..10 on line 1; longer cuts first in pack order.
    const a = await p.pack(
      p.dieA,
      Array.from({ length: 10 }, (_, i) => ({ kg: 10 + i, mm: i < 5 ? 4_877 : 3_658 })),
      o.lineIds[0],
    );
    const b = await p.pack(p.dieA, [{ kg: 5 }], o.lineIds[1]);
    const c = await p.pack(p.dieB, [{ kg: 7 }], o.lineIds[2]);
    const d = await p.held([...a, ...b, ...c]);
    await p.owner.dispatch.complete({ id: d });
    const snap = plSchema.parse((await plRow(d))!.snapshot) as Snap;

    const g1 = snap.groups.find((g) => g.lineNo === 1)!;
    const party = (bundleNo: string) => snap.rowInfo![bundleNo]!.partyNo;
    expect(g1.rows.map((r) => [r.cutFt, party(r.bundleNo)])).toEqual([
      [12, "6"], [12, "7"], [12, "8"], [12, "9"], [12, "10"],
      [16, "1"], [16, "2"], [16, "3"], [16, "4"], [16, "5"],
    ]);
    expect(snap.rowInfo![g1.rows[0]!.bundleNo]!.originalSo).toBe(`${o.number}/1`);
    expect(snap.print).toEqual({ showBranding: true, showOriginalSo: true });

    // Two groups of section A, one of B: one subtotal per section.
    const secA = snap.sections!.find((s) => s.sectionCode === g1.sectionCode)!;
    expect(secA).toMatchObject({ bundles: 11, weightG: kg(10 + 11 + 12 + 13 + 14 + 15 + 16 + 17 + 18 + 19 + 5) });
    expect(snap.sections).toHaveLength(2);
    expect(snap.profileSummary!.map((k) => [k.kind, k.bundles])).toEqual([
      ["hollow", 11],
      ["solid", 1],
    ]);
    expect(snap.issue).toEqual({
      revision: 1,
      dispatchCodes: [snap.header.dispatchCode],
      branding: { show: true, tagline: LETTERHEAD.tagline, logoUrl: LETTERHEAD.logoUrl },
    });
    expect(snap.header.company.legalName).toBe(LETTERHEAD.legalName);

    const docs = (await import(docsPath)) as Docs;
    const html = docs.buildPackingListHtml(snap as never, snap.header.plNumber);
    for (const text of ["Party no", "Original SO", `Section ${g1.sectionCode}`, "Hollow 11 bundles", "Solid 1 bundle", LETTERHEAD.tagline, LETTERHEAD.logoUrl]) {
      expect(html).toContain(text);
    }
  }, SLOW);

  test("the PL header prints the transporter master's name", async () => {
    setClock(NOON);
    const p = await plant();
    const t = await p.owner.transporter.create({ name: "Shree Roadlines" });
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 10 }], o.lineIds[0]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId, transporterId: t.id });
    await p.owner.dispatch.addBundlesBySerial({ allowUnassigned: true,  id, serials });
    await p.owner.dispatch.reserve({ id });
    await p.owner.dispatch.complete({ id });
    expect(((await plRow(id))!.snapshot as Snap).header.transporter).toBe("Shree Roadlines");
  }, SLOW);
});

describe("regenerate = new revision, same number", () => {
  test("rev 1 survives and stays readable; rev 2 is current; the number does not advance", async () => {
    setClock(NOON);
    const p = await plant({ settings: { letterhead: LETTERHEAD } });
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const { d, done } = await shipped(p, o.lineIds[0]!, p.dieA, [{ kg: 10 }, { kg: 11 }]);
    const rev1 = (await plRow(d))!;
    expect(await plSeries(p.companyId)).toBe(1);

    const rev2 = await p.owner.packingList.regenerate({ id: rev1.id, showBranding: false });
    expect(rev2).toMatchObject({ code: done.plNumber, revision: 2, supersedesId: rev1.id, showBranding: false });
    expect(await plSeries(p.companyId)).toBe(1);
    const s2 = rev2.snapshot as unknown as Snap;
    expect(s2.issue!.branding).toEqual({ show: false, tagline: null, logoUrl: null });
    expect(s2.header.company.legalName).toBe(LETTERHEAD.legalName);

    const old = await p.owner.packingList.get({ id: rev1.id });
    expect(old.revision).toBe(1);
    expect((old.snapshot as unknown as Snap).issue!.branding.show).toBe(true);
    expect((await p.owner.packingList.byDispatch({ dispatchId: d }))!.id).toBe(rev2.id);
    const revs = await p.owner.packingList.revisions({ id: rev1.id });
    expect(revs.revisions.map((r) => r.revision)).toEqual([1, 2]);
    expect(revs.currentId).toBe(rev2.id);
    expect(revs.revisions[1]!.changes).toBeDefined();
    expect((await p.owner.packingList.list({})).items.filter((i) => i.code === done.plNumber).map((i) => i.revision)).toEqual([2]);

    // Branding off: the legal name prints, the tagline and logo do not.
    const docs = (await import(docsPath)) as Docs;
    const html = docs.buildPackingListHtml(s2 as never, rev2.code);
    expect(html).toContain(LETTERHEAD.legalName);
    expect(html).not.toContain(LETTERHEAD.tagline);
    expect(html).not.toContain(LETTERHEAD.logoUrl);
    expect(html).toContain("Rev 2");

    // Only the current revision regenerates.
    await expect(p.owner.packingList.regenerate({ id: rev1.id })).rejects.toThrow("A newer revision");
  }, SLOW);

  test("a header correction after completion rewrites only the current revision", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const { d } = await shipped(p, o.lineIds[0]!, p.dieA, [{ kg: 10 }]);
    const rev1 = (await plRow(d))!;
    const rev2 = await p.owner.packingList.regenerate({ id: rev1.id });
    await p.owner.dispatch.update({ id: d, vehicleNo: "GJ05AB9999" });
    const [r1] = await env.db.select().from(packingList).where(eq(packingList.id, rev1.id));
    const [r2] = await env.db.select().from(packingList).where(eq(packingList.id, rev2.id));
    expect((r1!.snapshot as unknown as Snap).header.vehicleNo).toBeNull();
    expect((r2!.snapshot as unknown as Snap).header.vehicleNo).toBe("GJ05AB9999");
  }, SLOW);
});

describe("combine", () => {
  test("same customer: a new number over both dispatches; each list points at it", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const one = await shipped(p, o.lineIds[0]!, p.dieA, [{ kg: 10 }]);
    const two = await shipped(p, o.lineIds[0]!, p.dieA, [{ kg: 12 }, { kg: 13 }]);
    const pl1 = (await plRow(one.d))!;
    const pl2 = (await plRow(two.d))!;
    expect(await plSeries(p.companyId)).toBe(2);

    const combined = await p.owner.packingList.combine({ ids: [pl1.id, pl2.id] });
    expect(combined.code).toBe("PL/2026-27/3");
    expect(await plSeries(p.companyId)).toBe(3);
    const snap = combined.snapshot as unknown as Snap;
    const codes = [(await dispatchRow(one.d)).code, (await dispatchRow(two.d)).code];
    expect([...snap.issue!.dispatchCodes].sort()).toEqual(codes.sort());
    expect(snap.summary.bundles).toBe(3);
    const covered = await env.db.select().from(packingListDispatch).where(eq(packingListDispatch.packingListId, combined.id));
    expect(covered.map((c) => c.dispatchId).sort()).toEqual([one.d, two.d].sort());
    for (const id of [pl1.id, pl2.id]) {
      const [row] = await env.db.select().from(packingList).where(eq(packingList.id, id));
      expect(row!.combinedIntoId).toBe(combined.id);
    }
    // Each dispatch still shows its own list.
    expect((await p.owner.packingList.byDispatch({ dispatchId: one.d }))!.id).toBe(pl1.id);

    await expect(p.owner.packingList.combine({ ids: [pl1.id, pl2.id] })).rejects.toThrow("already combined");
    await expect(p.owner.packingList.regenerate({ id: pl1.id })).rejects.toThrow("combined into another");
    const again = await p.owner.packingList.regenerate({ id: combined.id });
    expect(again).toMatchObject({ code: combined.code, revision: 2 });
    expect((again.snapshot as unknown as Snap).summary.bundles).toBe(3);
    expect(await plSeries(p.companyId)).toBe(3);
  }, SLOW);

  test("different customers are refused; a viewer cannot combine", async () => {
    setClock(NOON);
    const p = await plant();
    const mine = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const theirs = await p.order([{ dieId: p.dieA, kg: 1000 }], { customerId: p.otherCustomer });
    const one = await shipped(p, mine.lineIds[0]!, p.dieA, [{ kg: 10 }]);
    const two = await shipped(p, theirs.lineIds[0]!, p.dieA, [{ kg: 10 }], p.otherCustomer);
    const ids = [(await plRow(one.d))!.id, (await plRow(two.d))!.id];
    await expect(p.owner.packingList.combine({ ids })).rejects.toThrow("Only packing lists of one customer can be combined");
    await expect(p.as("viewer").packingList.combine({ ids })).rejects.toThrow();
    expect(await plSeries(p.companyId)).toBe(2);
  }, SLOW);
});

describe("revision diff and analytics over revisions (I-2, I-5)", () => {
  test("the revisions list names the added, removed and changed bundles between revisions", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const { d, serials } = await shipped(p, o.lineIds[0]!, p.dieA, [{ kg: 10 }, { kg: 11 }, { kg: 12 }]);
    const rev1 = (await plRow(d))!;
    const [extra] = await p.pack(p.dieA, [{ kg: 9 }], o.lineIds[0]);
    const row = async (serial: string) =>
      (await env.db.query.bundle.findFirst({ where: (x, { and: a, eq: e }) => a(e(x.companyId, p.companyId), e(x.serial, serial)) }))!;
    const [gone, reweighed, added] = [await row(serials[0]!), await row(serials[1]!), await row(extra!)];
    // A correction between revisions, made in the tables: one bundle came off, one went on, one was re-weighed.
    await env.db.delete(dispatchItem).where(and(eq(dispatchItem.dispatchId, d), eq(dispatchItem.bundleId, gone.id)));
    await env.db
      .insert(dispatchItem)
      .values({ id: crypto.randomUUID(), companyId: p.companyId, dispatchId: d, bundleId: added.id, salesOrderLineId: o.lineIds[0]! });
    await env.db.update(bundle).set({ weightG: kg(11.5) }).where(eq(bundle.id, reweighed.id));

    const rev2 = await p.owner.packingList.regenerate({ id: rev1.id });
    const revs = await p.owner.packingList.revisions({ id: rev2.id });
    expect(revs).toMatchObject({ code: rev1.code, currentId: rev2.id });
    expect(revs.revisions.map((r) => [r.revision, r.bundleCount, r.supersedesId])).toEqual([
      [1, 3, null],
      [2, 3, rev1.id],
    ]);
    expect(revs.revisions[0]!.changes).toBeNull();
    expect(revs.revisions[1]!.changes).toEqual({
      added: [extra!],
      removed: [serials[0]!],
      changed: [{ serial: serials[1]!, fields: ["weightG"] }],
      unchanged: 1,
      weightDeltaG: kg(9) - kg(10) + kg(0.5),
      same: false,
    });
  }, SLOW);

  test("customer analytics counts each bundle once for a dispatch with two revisions folded into a combined list", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const one = await shipped(p, o.lineIds[0]!, p.dieA, [{ kg: 10 }, { kg: 12 }]);
    const two = await shipped(p, o.lineIds[0]!, p.dieA, [{ kg: 5 }]);
    const summary = () => p.owner.analytics.customerSummary({ customerId: p.customerId, from: "2026-10-01", to: "2026-10-31" });
    const before = await summary();
    expect(before.recentDispatches.find((r) => r.id === one.d)).toMatchObject({ bundles: 2, kgG: kg(22), plNumber: one.done.plNumber });

    const rev2 = await p.owner.packingList.regenerate({ id: (await plRow(one.d))!.id });
    await p.owner.packingList.combine({ ids: [rev2.id, (await plRow(two.d))!.id] });
    expect(await env.db.select().from(packingList).where(eq(packingList.companyId, p.companyId))).toHaveLength(4);

    const after = await summary();
    expect(after.recentDispatches).toEqual(before.recentDispatches);
    expect(after.totals).toEqual(before.totals);
    expect(after.topSections).toEqual(before.topSections);
  }, SLOW);
});

describe("dev seed: W1-PK-S rows (idempotent)", () => {
  test("transporter, a PL with two revisions, party numbers for two customers with different policies", async () => {
    const { bundle, transporter } = await import("@orrn/db/schema");
    await precreateDevSeedUsers(env);
    const seedPath = "../../../apps/server/src/dev-seed";
    const { seedDevData } = (await import(seedPath)) as {
      seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
    };
    const companyId = "dev-company-orrn";
    for (let run = 0; run < 2; run += 1) {
      expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
      // Three transporters (one inactive) since W2-SEED.
      expect(await env.db.select().from(transporter).where(eq(transporter.companyId, companyId))).toHaveLength(3);
      const lists = await env.db.select().from(packingList).where(eq(packingList.companyId, companyId));
      // done-1 rev 1 and rev 2, done-2, done-3, done-4 and the combined Tejura list (W2-SEED).
      expect(lists).toHaveLength(6);
      const rev2 = lists.find((l) => l.revision === 2)!;
      expect(lists.find((l) => l.id === rev2.supersedesId)).toMatchObject({ code: rev2.code, revision: 1 });
      expect(rev2.showBranding).toBe(false);
      const party = await env.db
        .select({ partyNo: bundle.partyNo, serial: bundle.serial })
        .from(bundle)
        .where(eq(bundle.companyId, companyId));
      const own = party.filter((b) => b.partyNo && b.partyNo !== b.serial).map((b) => b.partyNo!);
      expect(own.some((n) => /^\d{2}[A-L]\d+$/.test(n))).toBe(true);
      expect(own.some((n) => /^\d{4}-\d{2}\/\d+$/.test(n))).toBe(true);
      expect(new Set(own).size).toBe(own.length);
      // D15: the seed keeps a monthly party number that is also another bundle's plant serial, and
      // scanning it is ambiguous (never a silent pick).
      const serials = new Map(party.map((b) => [b.serial, b]));
      const clash = own.find((n) => serials.has(n));
      expect(clash).toBeDefined();
      const { resolveCode } = await import("../src/lib/codeResolver");
      const hit = await resolveCode(env.db as never, companyId, clash!);
      expect(hit.kind).toBe("ambiguous");
    }
  }, SLOW);
});
