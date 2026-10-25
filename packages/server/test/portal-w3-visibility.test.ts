/**
 * W3-PORTAL-S visibility matrix (specs §E7 Rules; platform spec §6 "Portal visibility"):
 * granted section visible; a section the party owns (or one of whose copies it owns) visible without a
 * grant; a copy another customer owns hidden even when the section is granted; a section another
 * customer owns stays hidden even when granted by mistake; retired copies, archived / deleted
 * sections hidden; dieBands off hides the band; a miss is NOT_FOUND "Not found", never FORBIDDEN.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { die } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { portalHelpers } from "./portal-w3-fixture";
import { SLOW } from "./sales-fixture";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const h = portalHelpers(() => env);

async function notFound(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return { code: (e as { code?: string }).code, message: (e as Error).message };
  }
  return { code: "OK", message: "" };
}

describe("visibility matrix", () => {
  test("grant, ownership, foreign copy, foreign section, retired, archived, ungranted", async () => {
    const p = await h.portalPlant();
    const party = await h.partyLogin(p);
    const office = p.as("office");
    const sec = (code: string, over: Record<string, unknown> = {}) =>
      env.seedDie(p.companyId, { series: "Vis", sectionCode: code, weightMinG: 2_400, weightMaxG: 2_600, ...over });

    // G: plant section, granted. Copies: plant (seen), other party's (hidden), retired (hidden), the party's own (seen).
    const G = await sec("G1");
    await office.portal.sections.grant({ customerId: p.customerId, dieId: G });
    const gPlant = await h.copy(p.companyId, G, 1, { readingMilli: 2_480 });
    const gForeign = await h.copy(p.companyId, G, 2, { owner: p.otherCustomer, readingMilli: 2_500 });
    const gRetired = await h.copy(p.companyId, G, 3, { status: "retired" });
    const gOwn = await h.copy(p.companyId, G, 4, { owner: p.customerId });
    // O: no grant, section owned by the party: visible with its copies.
    const O = await sec("O1", { ownerCustomerId: p.customerId });
    const oCopy = await h.copy(p.companyId, O, 1);
    // C: no grant, plant section, one copy overridden to the party: visible; the plant copy too.
    const C = await sec("C1");
    const cOwn = await h.copy(p.companyId, C, 1, { owner: p.customerId });
    const cPlant = await h.copy(p.companyId, C, 2);
    // F: owned by the other party and granted to this one by mistake: hidden.
    const F = await sec("F1", { ownerCustomerId: p.otherCustomer });
    const g = await office.portal.sections.grant({ customerId: p.customerId, dieId: F });
    expect(g.ownedByOther).toBe(true);
    await h.copy(p.companyId, F, 1);
    // F2: owned by the other party, one copy overridden to this party: shows only that copy.
    const F2 = await sec("F2", { ownerCustomerId: p.otherCustomer });
    const f2Own = await h.copy(p.companyId, F2, 1, { owner: p.customerId });
    await h.copy(p.companyId, F2, 2);
    // A: granted but archived; D: granted but deleted; N: never granted, plant-owned.
    const A = await sec("A1", { status: "archived" });
    await office.portal.sections.grant({ customerId: p.customerId, dieId: A });
    const D = await sec("D1");
    await office.portal.sections.grant({ customerId: p.customerId, dieId: D });
    await env.db.update(die).set({ deletedAt: new Date() }).where(eq(die.id, D));
    const N = await sec("N1");
    await h.copy(p.companyId, N, 1);
    // R: granted then revoked.
    const R = await sec("R1");
    const rg = await office.portal.sections.grant({ customerId: p.customerId, dieId: R });
    await office.portal.sections.revoke({ id: rg.id });

    const visible = await party.api.portal.sections.visible();
    const byId = new Map(visible.map((s) => [s.id, s]));
    expect([...byId.keys()].sort()).toEqual([G, O, C, F2].sort());
    expect(byId.get(G)!.copies.map((c) => c.id).sort()).toEqual([gPlant, gOwn].sort());
    expect(byId.get(G)).toMatchObject({ granted: true, owned: true });
    expect(byId.get(G)!.copies.find((c) => c.id === gPlant)).toMatchObject({ latestKgPer12ftMilli: 2_480, band: { minG: 2_400, maxG: 2_600 } });
    expect(byId.get(O)!.copies.map((c) => c.id)).toEqual([oCopy]);
    expect(byId.get(O)).toMatchObject({ granted: false, owned: true });
    expect(byId.get(C)!.copies.map((c) => c.id).sort()).toEqual([cOwn, cPlant].sort());
    expect(byId.get(F2)!.copies.map((c) => c.id)).toEqual([f2Own]);
    const json = JSON.stringify(visible);
    expect(json).not.toContain(gForeign);
    expect(json).not.toContain(gRetired);
    expect(json).not.toContain(p.otherCustomer);
    // me lists the same sections.
    expect((await party.api.portal.me()).sections.map((s) => s.id).sort()).toEqual([G, O, C, F2].sort());
    // Ordering follows the same rule: hidden sections are Not found.
    for (const hidden of [F, A, D, N, R]) {
      expect(await notFound(party.api.portal.orders.create({ lines: [{ sectionId: hidden, cutLengthMm: 3658, pcs: 10 }] }))).toEqual({
        code: "NOT_FOUND",
        message: "Not found",
      });
    }
  }, SLOW);

  test("dieBands off: the band is absent on sections and copies", async () => {
    const p = await h.portalPlant({ dieBands: false });
    const party = await h.partyLogin(p);
    await p.as("office").portal.sections.grant({ customerId: p.customerId, dieId: p.dieA });
    await h.copy(p.companyId, p.dieA, 1, { readingMilli: 25_000 });
    const [s] = await party.api.portal.sections.visible();
    expect(s!.band).toBeNull();
    expect(s!.copies[0]).toMatchObject({ band: null, latestKgPer12ftMilli: 25_000 });
  }, SLOW);

  test("another party of the same plant sees none of this party's grants; other plants see nothing", async () => {
    const p = await h.portalPlant();
    const mine = await h.partyLogin(p);
    const theirs = await h.partyLogin(p, p.otherCustomer);
    await p.as("office").portal.sections.grant({ customerId: p.customerId, dieId: p.dieA });
    expect((await mine.api.portal.sections.visible()).map((s) => s.id)).toEqual([p.dieA]);
    expect(await theirs.api.portal.sections.visible()).toEqual([]);
    expect((await theirs.api.portal.today()).canOrder).toBe(false);
    const q = await h.portalPlant();
    const elsewhere = await h.partyLogin(q);
    expect(await elsewhere.api.portal.sections.visible()).toEqual([]);
    expect(await notFound(elsewhere.api.portal.orders.create({ lines: [{ sectionId: p.dieA, cutLengthMm: 3658, pcs: 1 }] }))).toEqual({
      code: "NOT_FOUND",
      message: "Not found",
    });
  }, SLOW);

  test("a large catalogue stays within 100 bound parameters per statement", async () => {
    const p = await h.portalPlant();
    const party = await h.partyLogin(p);
    const office = p.as("office");
    for (let i = 0; i < 120; i += 1) {
      const id = await env.seedDie(p.companyId, { series: "Big", sectionCode: `B${i}`, weightMinG: 2_000, weightMaxG: 2_200 });
      await office.portal.sections.grant({ customerId: p.customerId, dieId: id });
    }
    env.resetPeakParams();
    const list = await party.api.portal.sections.visible();
    expect(list).toHaveLength(120);
    await party.api.portal.me();
    await party.api.portal.today();
    expect(env.peakParams()).toBeLessThanOrEqual(100);
  }, SLOW);
});
