/**
 * W3-PORTAL-S: who gets into the party portal. Migration 0031_portal (renumbered 0032 at merge),
 * the invite path (office grant -> party password account -> invite.acceptByToken, no membership),
 * portalProcedure refusals (no login, revoked, portal off, suspended plant, impersonation, member of
 * the plant, wrong plant header), PF §9-12 (one email never staff and party in a plant), grant /
 * revoke audits for logins and sections, and the portal.manage matrix.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, company, customerPortalUser, invite, membership, user } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";
import { portalHelpers } from "./portal-w3-fixture";
import { NOON, ROLES, SLOW } from "./sales-fixture";

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

const h = portalHelpers(() => env);

async function audits(companyId: string, action: string) {
  return env.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, action)));
}

describe("migration", () => {
  test("0031_portal: portal tables, test_certificate and invite.kind exist; invites default to member", async () => {
    const tables = await env.d1
      .prepare("select name from sqlite_master where type = 'table' and name in ('customer_portal_user','customer_portal_section','test_certificate')")
      .all<{ name: string }>();
    expect(tables.results.map((r) => r.name).sort()).toEqual(["customer_portal_section", "customer_portal_user", "test_certificate"]);
    const cols = await env.d1.prepare("pragma table_info(invite)").all<{ name: string; dflt_value: string | null }>();
    const kind = cols.results.find((c) => c.name === "kind");
    expect(kind?.dflt_value).toBe("'member'");
    expect(cols.results.some((c) => c.name === "customer_id")).toBe(true);
    const idx = await env.d1
      .prepare("select name from sqlite_master where type = 'index' and name = 'customer_portal_section_live_unique'")
      .all<{ name: string }>();
    expect(idx.results).toHaveLength(1);
  });
});

describe("invite path", () => {
  test("grant makes an invited login + portal invite; accept turns it active with no membership; audits", async () => {
    setClock(NOON);
    const p = await h.portalPlant();
    const party = await h.partyLogin(p);
    const [row] = await env.db.select().from(customerPortalUser).where(eq(customerPortalUser.id, party.portalUserId));
    expect(row).toMatchObject({ status: "active", userId: party.userId, customerId: p.customerId, email: party.email });
    expect(row!.acceptedAt).not.toBeNull();
    const [inv] = await env.db.select().from(invite).where(eq(invite.id, row!.inviteId!));
    expect(inv).toMatchObject({ kind: "portal", customerId: p.customerId, role: "viewer" });
    expect(inv!.acceptedAt).not.toBeNull();
    // Never a membership.
    expect(await env.db.select().from(membership).where(eq(membership.userId, party.userId))).toHaveLength(0);
    const grants = await audits(p.companyId, "portal.user.grant");
    expect(grants.map((a) => a.subjectId)).toContain(party.portalUserId);
    expect((await audits(p.companyId, "portal.user.accept")).map((a) => a.subjectId)).toContain(party.portalUserId);
    // The member invite list never shows party invites.
    expect((await p.owner.invite.list()).some((i) => i.email === party.email)).toBe(false);
    const me = await party.api.portal.me();
    expect(me.customer.id).toBe(p.customerId);
    expect(me.company.id).toBe(p.companyId);
    expect(await party.api.portal.access()).toEqual([
      expect.objectContaining({ companyId: p.companyId, portalEnabled: true }),
    ]);
  }, SLOW);

  test("grant refuses: portal off (BAD_REQUEST), unknown / other plant customer (NOT_FOUND), an active login again", async () => {
    const off = await h.portalPlant({ portalEnabled: false });
    expect(await h.codeOf(off.as("office").portal.users.grant({ customerId: off.customerId, email: "x@test.orrn" }))).toBe("BAD_REQUEST");
    const p = await h.portalPlant();
    expect(await h.codeOf(p.as("office").portal.users.grant({ customerId: off.customerId, email: "y@test.orrn" }))).toBe("NOT_FOUND");
    const party = await h.partyLogin(p);
    expect(await h.codeOf(p.as("office").portal.users.grant({ customerId: p.customerId, email: party.email }))).toBe("BAD_REQUEST");
    // Same email for another party while live: refused.
    expect(await h.codeOf(p.as("office").portal.users.grant({ customerId: p.otherCustomer, email: party.email }))).toBe("BAD_REQUEST");
  }, SLOW);

  test("an expired invite cannot be accepted; a resend replaces the pending invite (old link dead)", async () => {
    const p = await h.portalPlant();
    const email = `late.${Date.now()}@test.orrn`;
    const first = await p.as("office").portal.users.grant({ customerId: p.customerId, email });
    const second = await p.as("office").portal.users.grant({ customerId: p.customerId, email });
    expect(second.id).toBe(first.id);
    const uid = crypto.randomUUID();
    await env.db.insert(user).values({ id: uid, name: "Late", email });
    const oldToken = first.inviteUrl!.split("/invite/")[1]!;
    expect(await h.codeOf(env.callerForUser(uid).invite.acceptByToken({ token: oldToken }))).toBe("BAD_REQUEST");
    const [row] = await env.db.select().from(customerPortalUser).where(eq(customerPortalUser.id, first.id));
    await env.db.update(invite).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invite.id, row!.inviteId!));
    const newToken = second.inviteUrl!.split("/invite/")[1]!;
    expect(await h.codeOf(env.callerForUser(uid).invite.acceptByToken({ token: newToken }))).toBe("BAD_REQUEST");
  }, SLOW);
});

describe("PF §9-12: never staff and party in one plant", () => {
  test("grant refuses a plant member's email; member invite refuses a party email; accepts cross-check", async () => {
    const p = await h.portalPlant();
    // A member's email cannot become a party login here.
    expect(await h.codeOf(p.as("office").portal.users.grant({ customerId: p.customerId, email: p.users.packer.email }))).toBe("BAD_REQUEST");
    const party = await h.partyLogin(p);
    // A party email cannot get a member invite here.
    expect(await h.codeOf(p.owner.invite.create({ email: party.email, role: "viewer" }))).toBe("BAD_REQUEST");
    // A pending member invite blocks a party grant for that email.
    const staffEmail = `staff.${Date.now()}@test.orrn`;
    await p.owner.invite.create({ email: staffEmail, role: "office" });
    expect(await h.codeOf(p.as("office").portal.users.grant({ customerId: p.customerId, email: staffEmail }))).toBe("BAD_REQUEST");
  }, SLOW);

  test("accepting a party invite with an account that is staff here is refused; a member made later is locked out of the portal", async () => {
    const p = await h.portalPlant();
    // The account becomes a member after the grant (race): accept refuses.
    const email = `both.${Date.now()}@test.orrn`;
    const granted = await p.as("office").portal.users.grant({ customerId: p.customerId, email });
    const uid = crypto.randomUUID();
    await env.db.insert(user).values({ id: uid, name: "Both", email });
    await env.addMembership(uid, p.companyId, "viewer");
    const token = granted.inviteUrl!.split("/invite/")[1]!;
    expect(await h.codeOf(env.callerForUser(uid).invite.acceptByToken({ token }))).toBe("BAD_REQUEST");

    // An active party who is later added as a member: portalProcedure refuses.
    const party = await h.partyLogin(p);
    await env.addMembership(party.userId, p.companyId, "viewer");
    expect(await h.codeOf(party.api.portal.me())).toBe("FORBIDDEN");
  }, SLOW);

  test("a party login in plant A may be staff in plant B (different plants)", async () => {
    const a = await h.portalPlant();
    const b = await h.portalPlant();
    const party = await h.partyLogin(a);
    await env.addMembership(party.userId, b.companyId, "viewer");
    const me = await (await h.headerCaller(party.userId, { company: a.companyId })).portal.me();
    expect(me.company.id).toBe(a.companyId);
  }, SLOW);
});

describe("portalProcedure refusals", () => {
  test("no session UNAUTHORIZED; a member with no portal login FORBIDDEN", async () => {
    const p = await h.portalPlant();
    expect(await h.codeOf(env.caller(null).portal.me())).toBe("UNAUTHORIZED");
    expect(await h.codeOf((await h.headerCaller(p.users.office.id)).portal.me())).toBe("FORBIDDEN");
    expect(await h.codeOf(env.caller({ role: "owner", companyId: p.companyId }).portal.today())).toBe("FORBIDDEN");
  }, SLOW);

  test("revoked login FORBIDDEN on its next call; audit portal.user.revoke; re-grant goes straight back to active", async () => {
    const p = await h.portalPlant();
    const party = await h.partyLogin(p);
    expect((await party.api.portal.today()).openOrders).toBe(0);
    await p.as("office").portal.users.revoke({ id: party.portalUserId });
    expect(await h.codeOf(party.api.portal.today())).toBe("FORBIDDEN");
    expect(await h.codeOf(party.api.portal.orders.list())).toBe("FORBIDDEN");
    const revokes = await audits(p.companyId, "portal.user.revoke");
    expect(revokes.find((a) => a.subjectId === party.portalUserId)?.meta).toMatchObject({ from: "active", customerId: p.customerId });
    // Revoked -> Active: office grants again; no new invite needed for an account that accepted once.
    const again = await p.as("office").portal.users.grant({ customerId: p.customerId, email: party.email });
    expect(again).toMatchObject({ id: party.portalUserId, status: "active", inviteUrl: null });
    expect((await party.api.portal.today()).openOrders).toBe(0);
    const regrant = (await audits(p.companyId, "portal.user.grant")).filter((a) => a.subjectId === party.portalUserId);
    expect(regrant.some((a) => (a.meta as { regrant?: boolean }).regrant === true)).toBe(true);
    // Revoking twice is refused.
    await p.as("office").portal.users.revoke({ id: party.portalUserId });
    expect(await h.codeOf(p.as("office").portal.users.revoke({ id: party.portalUserId }))).toBe("BAD_REQUEST");
  }, SLOW);

  test("portal switched off: FORBIDDEN (grants kept); back on: works", async () => {
    const p = await h.portalPlant();
    const party = await h.partyLogin(p);
    await p.owner.company.updateSettings({ portalEnabled: false });
    expect(await h.codeOf(party.api.portal.me())).toBe("FORBIDDEN");
    const [row] = await env.db.select().from(customerPortalUser).where(eq(customerPortalUser.id, party.portalUserId));
    expect(row!.status).toBe("active");
    await p.owner.company.updateSettings({ portalEnabled: true });
    expect((await party.api.portal.me()).customer.id).toBe(p.customerId);
  }, SLOW);

  test("suspended plant FORBIDDEN", async () => {
    const p = await h.portalPlant();
    const party = await h.partyLogin(p);
    await env.db.update(company).set({ status: "suspended" }).where(eq(company.id, p.companyId));
    expect(await h.codeOf(party.api.portal.me())).toBe("FORBIDDEN");
    expect(await party.api.portal.access()).toEqual([]);
  }, SLOW);

  test("impersonation never enters the portal: a grant-holding platform admin and a party sending the header are refused", async () => {
    const p = await h.portalPlant();
    const party = await h.partyLogin(p);
    // A party sending the impersonation header (no grant) is refused.
    expect(await h.codeOf((await h.headerCaller(party.userId, { impersonate: p.companyId })).portal.me())).toBe("FORBIDDEN");
    // A platform admin with a live grant acting as the plant is refused too.
    const admin = await env.seedUser("admin");
    const { platformAdmin, impersonationGrant } = await import("@orrn/db/schema");
    await env.db.insert(platformAdmin).values({ userId: admin, role: "super_admin" });
    await env.db.insert(impersonationGrant).values({
      id: crypto.randomUUID(),
      platformAdminId: admin,
      companyId: p.companyId,
      expiresAt: new Date(Date.now() + 3_600_000),
      reason: "test",
    });
    const imp = await h.headerCaller(admin, { impersonate: p.companyId });
    expect((await imp.auth.me()).company?.id).toBe(p.companyId);
    expect(await h.codeOf(imp.portal.me())).toBe("FORBIDDEN");
    expect(await h.codeOf(imp.portal.orders.create({ lines: [{ sectionId: p.dieA, cutLengthMm: 3658, pcs: 1 }] }))).toBe("FORBIDDEN");
  }, SLOW);

  test("x-orrn-company picks among the party's plants; another plant is FORBIDDEN, never a fallback", async () => {
    const a = await h.portalPlant();
    const b = await h.portalPlant();
    const c = await h.portalPlant();
    const party = await h.partyLogin(a);
    await h.partyLogin(b, b.customerId, { email: party.email, userId: party.userId });
    const inB = await (await h.headerCaller(party.userId, { company: b.companyId })).portal.me();
    expect(inB.customer.id).toBe(b.customerId);
    expect(inB.plants.map((x) => x.companyId).sort()).toEqual([a.companyId, b.companyId].sort());
    expect(await h.codeOf((await h.headerCaller(party.userId, { company: c.companyId })).portal.me())).toBe("FORBIDDEN");
  }, SLOW);
});

describe("portal.manage matrix and section grants", () => {
  test("only office, manager, admin and owner manage logins and sections", async () => {
    const p = await h.portalPlant();
    const allowed: CompanyRole[] = ["owner", "admin", "manager", "office"];
    for (const role of ROLES) {
      const code = await h.codeOf(p.as(role).portal.users.list());
      expect([role, code]).toEqual([role, allowed.includes(role) ? "OK" : "FORBIDDEN"]);
      if (!allowed.includes(role)) {
        expect(await h.codeOf(p.as(role).portal.users.grant({ customerId: p.customerId, email: `${role}.x@test.orrn` }))).toBe("FORBIDDEN");
        expect(await h.codeOf(p.as(role).portal.sections.grant({ customerId: p.customerId, dieId: p.dieA }))).toBe("FORBIDDEN");
      }
    }
    expect(await env.db.select().from(customerPortalUser).where(eq(customerPortalUser.companyId, p.companyId))).toHaveLength(0);
  }, SLOW);

  test("section grant / revoke write audits; a live duplicate is refused; another plant's die is NOT_FOUND", async () => {
    const p = await h.portalPlant();
    const other = await h.portalPlant();
    const g = await p.as("office").portal.sections.grant({ customerId: p.customerId, dieId: p.dieA });
    expect(g.ownedByOther).toBe(false);
    expect(await h.codeOf(p.as("office").portal.sections.grant({ customerId: p.customerId, dieId: p.dieA }))).toBe("BAD_REQUEST");
    expect(await h.codeOf(p.as("office").portal.sections.grant({ customerId: p.customerId, dieId: other.dieA }))).toBe("NOT_FOUND");
    expect(await h.codeOf(other.as("office").portal.sections.revoke({ id: g.id }))).toBe("NOT_FOUND");
    expect((await p.as("office").portal.sections.list({ customerId: p.customerId })).map((r) => r.dieId)).toEqual([p.dieA]);
    await p.as("manager").portal.sections.revoke({ id: g.id });
    expect(await p.as("office").portal.sections.list({ customerId: p.customerId })).toEqual([]);
    expect((await audits(p.companyId, "portal.section.grant"))[0]?.meta).toMatchObject({ customerId: p.customerId, dieId: p.dieA });
    expect((await audits(p.companyId, "portal.section.revoke"))[0]?.subjectId).toBe(g.id);
    // Granted again after a revoke: a new live row.
    const g2 = await p.as("office").portal.sections.grant({ customerId: p.customerId, dieId: p.dieA });
    expect(g2.id).not.toBe(g.id);
  }, SLOW);
});
