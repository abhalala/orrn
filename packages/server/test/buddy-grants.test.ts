/**
 * orrn buddy grants (fix round 2026-11-20): Origin on every buddy mutation (security H1, M5), grants that last 30
 * days and need a fresh sign-in to make or renew (M4, L4, decision 5), revoked by the events that should end them
 * and never brought back, and "Cut off Hermes" expiring the grant's pending drafts (L1). Synthetic data only.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { account, buddyDraft, buddyGrant, buddyLink, membership, user, verification } from "@orrn/db/schema";
import { and, eq, like } from "drizzle-orm";

import { buddyPlant, connect, setHermesEnv, type BuddyPlant } from "./buddy-fixture";
import { createTestEnv, TEST_WEB_ORIGIN, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
  (await import("@orrn/auth")).resetAuthForTests();
}, 60_000);

afterAll(async () => {
  setHermesEnv(false);
  (await import("@orrn/auth")).resetAuthForTests();
  await env.dispose();
});

beforeEach(() => setHermesEnv(true));
afterEach(async () => {
  setHermesEnv(false);
  (await import("../src/lib/clock")).setClockForTests(null);
});

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60_000;

async function grantRow(grantId: string) {
  return env.db.select().from(buddyGrant).where(eq(buddyGrant.id, grantId)).get();
}

async function tokenWorks(token: string): Promise<boolean> {
  const { contextFromGrant } = await import("../src/lib/buddy/grantContext");
  return (await contextFromGrant(env.db, token)).ok;
}

async function refusal(p: Promise<unknown>): Promise<{ code: string; reason: unknown }> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; meta?: { reason?: unknown } };
    const { errorMetaOf } = await import("../src/lib/errorMeta");
    return { code: String(err.code), reason: (errorMetaOf(e as never) as { reason?: unknown } | null)?.reason ?? err.meta?.reason ?? null };
  }
  throw new Error("expected a refusal");
}

/** A caller like the harness's, with the request headers and session made here. */
async function callerWith(p: BuddyPlant, opts: { origin?: string | null; createdAt?: unknown }) {
  const { appRouter } = await import("../src/routers/index");
  const { resolveTenantContext } = await import("../src/lib/tenantContext");
  const u = await env.db.select().from(user).where(eq(user.id, p.users.owner.id)).get();
  const headers: Record<string, string> = {};
  if (opts.origin !== null) headers.origin = opts.origin ?? TEST_WEB_ORIGIN;
  return appRouter.createCaller(async () => ({
    auth: null,
    db: env.db,
    request: new Request("https://api.test/trpc", { method: "POST", headers }),
    session: { user: { id: u!.id, name: u!.name, email: u!.email }, session: { id: "s1", signInMethod: null, createdAt: "createdAt" in opts ? opts.createdAt : new Date() } },
    ...(await resolveTenantContext(env.db, { userId: u!.id, companyHeader: p.companyId, impersonateHeader: null })),
  }) as never);
}

describe("Origin on the buddy's mutations (security H1, M5; decision 4)", () => {
  test("every buddy.* mutation is FORBIDDEN from a foreign Origin, the string null, or no Origin", async () => {
    const { appRouter } = await import("../src/routers/index");
    const procedures = (appRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string } }> } })._def.procedures;
    const mutations = Object.entries(procedures)
      .filter(([path, proc]) => path.startsWith("buddy.") && proc._def.type === "mutation")
      .map(([path]) => path);
    expect(mutations).toEqual(expect.arrayContaining(["buddy.grant.create", "buddy.grant.revoke", "buddy.grant.renew", "buddy.drafts.confirm", "buddy.drafts.reject"]));
    const p = await buddyPlant(env);
    for (const origin of ["https://evil.example", "null", null]) {
      const caller = await callerWith(p, { origin });
      for (const path of mutations) {
        const fn = path.split(".").reduce<any>((o, k) => o[k], caller);
        const r = await refusal(fn({ grantId: "g", draftId: "d", via: "bubble", outcome: "done" }));
        expect({ path, origin, code: r.code }).toEqual({ path, origin, code: "FORBIDDEN" });
      }
    }
    expect(await env.db.select().from(buddyGrant).where(eq(buddyGrant.companyId, p.companyId))).toHaveLength(0);
    // The web origin passes.
    const ok = await callerWith(p, {});
    expect((await ok.buddy.grant.create()).token).toMatch(/^orrnb_/);
  });
});

describe("grants last 30 days and need a fresh sign-in (security M4, L4; decision 5)", () => {
  test("create: expires 30 days on; a session older than 10 minutes, or one with no sign-in time, is refused", async () => {
    const { setClockForTests } = await import("../src/lib/clock");
    const at = new Date("2026-11-20T06:00:00.000Z");
    setClockForTests(at);
    const p = await buddyPlant(env);
    const { grantId } = await connect(p);
    expect((await grantRow(grantId))!.expiresAt!.getTime()).toBe(at.getTime() + 30 * DAY);
    const stale = env.caller({ role: "owner", companyId: p.companyId, sessionCreatedAt: new Date(at.getTime() - 11 * MINUTE) });
    expect(await refusal(stale.buddy.grant.create())).toEqual({ code: "FORBIDDEN", reason: "FRESH_SIGN_IN_NEEDED" });
    expect(await refusal((await callerWith(p, { createdAt: undefined })).buddy.grant.create())).toEqual({ code: "FORBIDDEN", reason: "FRESH_SIGN_IN_NEEDED" });
    // The stale tries changed nothing: the first grant is still the live one.
    expect((await grantRow(grantId))!.revokedAt).toBeNull();
    // An ISO string (how a session may arrive) at 9 minutes is fresh.
    expect((await (await callerWith(p, { createdAt: new Date(at.getTime() - 9 * MINUTE).toISOString() })).buddy.grant.create()).token).toMatch(/^orrnb_/);
  });

  test("renew: 30 more days from now, renewedAt shows in status, the sign-in method is stamped again", async () => {
    const { setClockForTests } = await import("../src/lib/clock");
    const t0 = new Date("2026-11-01T06:00:00.000Z");
    setClockForTests(t0);
    const p = await buddyPlant(env);
    const { grantId, token } = await env.caller({ role: "owner", companyId: p.companyId, signInMethod: "password" }).buddy.grant.create();
    const t1 = new Date(t0.getTime() + 20 * DAY);
    setClockForTests(t1);
    const renewed = await env.caller({ role: "owner", companyId: p.companyId, signInMethod: "passkey" }).buddy.grant.renew({ grantId });
    expect(renewed).toEqual({ grantId, expiresAt: new Date(t1.getTime() + 30 * DAY).toISOString() });
    const row = await grantRow(grantId);
    expect(row).toMatchObject({ signInMethod: "passkey", revokedAt: null });
    expect(row!.renewedAt!.getTime()).toBe(t1.getTime());
    const status = await p.owner.buddy.status();
    expect(status.connected).toMatchObject({ grantId, renewedAt: t1.toISOString(), expiresAt: renewed.expiresAt });
    expect(await tokenWorks(token)).toBe(true);
    // Stale session: refused, nothing moves.
    const stale = env.caller({ role: "owner", companyId: p.companyId, sessionCreatedAt: new Date(t1.getTime() - 30 * MINUTE) });
    expect(await refusal(stale.buddy.grant.renew({ grantId }))).toEqual({ code: "FORBIDDEN", reason: "FRESH_SIGN_IN_NEEDED" });
  });

  test("renew refuses a revoked or run-out grant (CONFLICT) and someone else's (NOT_FOUND)", async () => {
    const { setClockForTests } = await import("../src/lib/clock");
    const t0 = new Date("2026-10-01T06:00:00.000Z");
    setClockForTests(t0);
    const p = await buddyPlant(env);
    const first = await connect(p);
    const second = await connect(p); // replaces the first
    expect((await grantRow(first.grantId))!.revokedReason).toBe("replaced");
    expect((await refusal(p.owner.buddy.grant.renew({ grantId: first.grantId }))).code).toBe("CONFLICT");
    setClockForTests(new Date(t0.getTime() + 31 * DAY));
    expect((await refusal(env.caller({ role: "owner", companyId: p.companyId }).buddy.grant.renew({ grantId: second.grantId }))).code).toBe("CONFLICT");
    expect(await tokenWorks(second.token)).toBe(false);
    const other = await buddyPlant(env);
    expect((await refusal(other.owner.buddy.grant.renew({ grantId: second.grantId }))).code).toBe("NOT_FOUND");
  });

  test("L4: a plant that requires secure sign-in refuses a grant made in a password session, renewed or not", async () => {
    const p = await buddyPlant(env, { settings: { requireStrongSignIn: true } });
    const strong = env.caller({ role: "owner", companyId: p.companyId, signInMethod: "passkey" });
    const { grantId, token } = await strong.buddy.grant.create();
    expect(await tokenWorks(token)).toBe(true);
    // Renewing needs the secure sign-in too: a password session cannot renew here.
    const weak = env.caller({ role: "owner", companyId: p.companyId, signInMethod: "password" });
    expect((await refusal(weak.buddy.grant.renew({ grantId }))).code).toBe("FORBIDDEN");
    expect((await grantRow(grantId))!.signInMethod).toBe("passkey");
  });
});

describe("revoked by the events that end them, and never brought back (security M4; decision 5)", () => {
  async function twoOwners() {
    const p = await buddyPlant(env);
    const second = await env.seedUser("second owner");
    await env.addMembership(second, p.companyId, "owner");
    const holder = env.callerForUser(p.users.owner.id, { company: p.companyId });
    const other = env.callerForUser(second, { company: p.companyId });
    const g = await holder.buddy.grant.create();
    const m = await env.db.select().from(membership).where(and(eq(membership.companyId, p.companyId), eq(membership.userId, p.users.owner.id))).get();
    return { p, holder, other, g, membershipId: m!.id };
  }

  test("removed from the plant: revoked (membership_removed); invited back, the old key stays dead", async () => {
    const { p, other, g, membershipId } = await twoOwners();
    await other.company.membersRemove({ membershipId });
    expect(await grantRow(g.grantId)).toMatchObject({ revokedReason: "membership_removed" });
    expect((await grantRow(g.grantId))!.revokedAt).not.toBeNull();
    const link = await env.db.select().from(buddyLink).where(and(eq(buddyLink.companyId, p.companyId), eq(buddyLink.userId, p.users.owner.id))).get();
    expect(link?.status).toBe("revoked");
    await env.addMembership(p.users.owner.id, p.companyId, "owner");
    expect(await tokenWorks(g.token)).toBe(false);
  });

  test("any role change: revoked (role_changed); promoted back to owner, the old key stays dead", async () => {
    const { other, g, membershipId } = await twoOwners();
    await other.company.membersUpdateRole({ membershipId, role: "admin" });
    expect(await grantRow(g.grantId)).toMatchObject({ revokedReason: "role_changed" });
    await other.company.membersUpdateRole({ membershipId, role: "owner" });
    expect(await tokenWorks(g.token)).toBe(false);
  });

  test("a role change in another plant leaves this plant's grant alone", async () => {
    const { p, g } = await twoOwners();
    const elsewhere = await buddyPlant(env);
    const mine = await env.addMembership(p.users.owner.id, elsewhere.companyId, "viewer");
    await elsewhere.owner.company.membersUpdateRole({ membershipId: mine, role: "office" });
    expect((await grantRow(g.grantId))!.revokedAt).toBeNull();
    expect(await tokenWorks(g.token)).toBe(true);
  });

  const PASSWORD = "grant-test-password-123";
  const NEW_PASSWORD = "grant-test-password-456";

  function authEnv(): Env {
    return {
      DB: env.d1,
      NODE_ENV: "production",
      CORS_ORIGIN: TEST_WEB_ORIGIN,
      CORS_ALLOWED_ORIGINS: TEST_WEB_ORIGIN,
      WEB_PUBLIC_URL: TEST_WEB_ORIGIN,
      BETTER_AUTH_URL: "https://api.test",
      BETTER_AUTH_SECRET: "buddy-grant-test-secret-0123456789ab",
      ORRN_MASTER_KEY: "",
      WEBHOOK_BASE_URL: "",
      CF_API_TOKEN: "",
      CF_ACCOUNT_ID: "",
      CF_ZONE_ID_IN: "",
    } as unknown as Env;
  }

  /** An owner with a password account in a listed plant. */
  async function passwordOwner() {
    const p = await buddyPlant(env);
    const { hashPassword } = await import("@orrn/auth/password");
    const id = crypto.randomUUID();
    const email = `grant.${id.slice(0, 8)}@test.orrn`;
    await env.db.insert(user).values({ id, name: "Grant test", email, emailVerified: true } as never);
    await env.db.insert(account).values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(PASSWORD) } as never);
    await env.addMembership(id, p.companyId, "owner");
    return { p, id, email };
  }

  async function authPost(path: string, body: unknown, headers: Record<string, string> = {}) {
    const { createAuth } = await import("@orrn/auth");
    return createAuth(authEnv()).handler(
      new Request(`https://api.test/api/auth/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: TEST_WEB_ORIGIN, ...headers },
        body: JSON.stringify(body),
      }),
    );
  }

  async function signIn(email: string): Promise<string> {
    const res = await authPost("sign-in/email", { email, password: PASSWORD });
    expect(res.status).toBe(200);
    const cookies = (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
    return cookies.find((c) => c.startsWith("__Host-better-auth.session_token="))!.split(";")[0]!;
  }

  test("a real Better Auth session: create works right after sign-in (its createdAt counts as fresh)", async () => {
    const { p, id, email } = await passwordOwner();
    const cookie = await signIn(email);
    const { createAuth } = await import("@orrn/auth");
    const session = await createAuth(authEnv()).api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.id).toBe(id);
    const { appRouter } = await import("../src/routers/index");
    const { resolveTenantContext } = await import("../src/lib/tenantContext");
    const caller = appRouter.createCaller(async () => ({
      auth: null,
      db: env.db,
      request: new Request("https://api.test/trpc", { method: "POST", headers: { origin: TEST_WEB_ORIGIN } }),
      session,
      ...(await resolveTenantContext(env.db, { userId: id, companyHeader: p.companyId, impersonateHeader: null })),
    }) as never);
    expect((await caller.buddy.grant.create()).token).toMatch(/^orrnb_/);
  });

  test("password reset: revoked (password_reset), with its pending drafts", async () => {
    const { p, id, email } = await passwordOwner();
    const g = await env.callerForUser(id, { company: p.companyId }).buddy.grant.create();
    const draftId = await pendingDraft(p.companyId, id, g.grantId);
    const log = (await import("bun:test")).spyOn(console, "log").mockImplementation(() => {});
    try {
      expect((await authPost("request-password-reset", { email, redirectTo: `${TEST_WEB_ORIGIN}/reset-password` })).status).toBe(200);
    } finally {
      log.mockRestore();
    }
    const row = (await env.db.select().from(verification).where(like(verification.identifier, "reset-password:%"))).find((r) => r.value === id)!;
    const token = row.identifier.slice("reset-password:".length);
    expect((await authPost("reset-password", { newPassword: NEW_PASSWORD, token })).status).toBe(200);
    expect(await grantRow(g.grantId)).toMatchObject({ revokedReason: "password_reset" });
    expect(await tokenWorks(g.token)).toBe(false);
    expect((await env.db.select().from(buddyDraft).where(eq(buddyDraft.id, draftId)).get())!.status).toBe("expired");
  });

  test("sign out of every session: revoked (signed_out_everywhere); a refused request leaves the grant", async () => {
    const { p, id, email } = await passwordOwner();
    const g = await env.callerForUser(id, { company: p.companyId }).buddy.grant.create();
    const cookie = await signIn(email);
    // No session: Better Auth refuses it, and the grant stays. (Better Auth's own Origin check is off under bun test,
    // `isTest()`, so a foreign Origin cannot be shown refused here; the after-hook acts only on a success.)
    expect((await authPost("revoke-sessions", {})).status).not.toBe(200);
    expect((await authPost("revoke-sessions", {}, { cookie: "__Host-better-auth.session_token=forged.value" })).status).not.toBe(200);
    expect((await grantRow(g.grantId))!.revokedAt).toBeNull();
    expect((await authPost("revoke-sessions", {}, { cookie })).status).toBe(200);
    expect(await grantRow(g.grantId)).toMatchObject({ revokedReason: "signed_out_everywhere" });
    expect(await tokenWorks(g.token)).toBe(false);
  });

  test("sign out of the other sessions: revoked too", async () => {
    const { p, id, email } = await passwordOwner();
    const g = await env.callerForUser(id, { company: p.companyId }).buddy.grant.create();
    const cookie = await signIn(email);
    expect((await authPost("revoke-other-sessions", {}, { cookie })).status).toBe(200);
    expect(await grantRow(g.grantId)).toMatchObject({ revokedReason: "signed_out_everywhere" });
  });

  test("password change (change-password, other sessions kept): revoked (password_changed); a wrong current password leaves the grant", async () => {
    const { p, id, email } = await passwordOwner();
    const g = await env.callerForUser(id, { company: p.companyId }).buddy.grant.create();
    const draftId = await pendingDraft(p.companyId, id, g.grantId);
    const cookie = await signIn(email);
    expect((await authPost("change-password", { currentPassword: "not-the-password-000", newPassword: NEW_PASSWORD }, { cookie })).status).not.toBe(200);
    expect((await grantRow(g.grantId))!.revokedAt).toBeNull();
    expect(await tokenWorks(g.token)).toBe(true);
    expect((await authPost("change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD }, { cookie })).status).toBe(200);
    expect(await grantRow(g.grantId)).toMatchObject({ revokedReason: "password_changed" });
    expect(await tokenWorks(g.token)).toBe(false);
    expect((await env.db.select().from(buddyDraft).where(eq(buddyDraft.id, draftId)).get())!.status).toBe("expired");
  });

  test("password change that also signs out the other sessions: revoked (password_changed); an earlier revoke keeps its reason", async () => {
    const { p, id, email } = await passwordOwner();
    const caller = env.callerForUser(id, { company: p.companyId });
    const old = await caller.buddy.grant.create();
    await caller.buddy.grant.revoke({ grantId: old.grantId });
    const before = await grantRow(old.grantId);
    expect(before).toMatchObject({ revokedReason: "owner" });
    const g = await caller.buddy.grant.create();
    const cookie = await signIn(email);
    expect((await authPost("change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, revokeOtherSessions: true }, { cookie })).status).toBe(200);
    expect(await grantRow(g.grantId)).toMatchObject({ revokedReason: "password_changed" });
    expect(await grantRow(old.grantId)).toMatchObject({ revokedReason: "owner", revokedAt: before!.revokedAt });
  });

  test("forced password change (auth.changeInitialPassword): revoked (password_changed) with the sessions; refused while not required", async () => {
    const { p, id } = await passwordOwner();
    const g = await env.callerForUser(id, { company: p.companyId }).buddy.grant.create();
    const draftId = await pendingDraft(p.companyId, id, g.grantId);
    // Not required: FORBIDDEN, and the grant stays.
    expect(await refusal(env.callerForUser(id).auth.changeInitialPassword({ newPassword: NEW_PASSWORD }))).toMatchObject({ code: "FORBIDDEN" });
    expect((await grantRow(g.grantId))!.revokedAt).toBeNull();
    await env.db.update(user).set({ mustChangePassword: true }).where(eq(user.id, id));
    expect(await env.callerForUser(id).auth.changeInitialPassword({ newPassword: NEW_PASSWORD })).toEqual({ success: true });
    expect(await grantRow(g.grantId)).toMatchObject({ revokedReason: "password_changed" });
    expect(await tokenWorks(g.token)).toBe(false);
    expect((await env.db.select().from(buddyDraft).where(eq(buddyDraft.id, draftId)).get())!.status).toBe("expired");
    const links = await env.db.select().from(buddyLink).where(eq(buddyLink.userId, id)).all();
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.status === "revoked")).toBe(true);
  });
});

async function pendingDraft(companyId: string, userId: string, grantId: string, over: Partial<typeof buddyDraft.$inferInsert> = {}): Promise<string> {
  const { createId } = await import("../src/lib/id");
  const id = createId();
  await env.db.insert(buddyDraft).values({
    id,
    companyId,
    requestedByUserId: userId,
    grantId,
    path: "customer.create",
    inputJson: { name: "Synthetic Co" },
    summary: "Add a customer",
    status: "pending",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + DAY),
    ...over,
  });
  return id;
}

describe('"Cut off Hermes" (security L1)', () => {
  test("revoke expires the grant's pending drafts in the same batch; a running confirm and other grants are left", async () => {
    const p = await buddyPlant(env);
    const old = await connect(p);
    const g = await connect(p);
    const a = await pendingDraft(p.companyId, p.users.owner.id, g.grantId);
    const claimed = await pendingDraft(p.companyId, p.users.owner.id, g.grantId, { claimedAt: new Date() });
    const done = await pendingDraft(p.companyId, p.users.owner.id, g.grantId, { status: "confirmed" });
    const other = await buddyPlant(env);
    const og = await connect(other);
    const elsewhere = await pendingDraft(other.companyId, other.users.owner.id, og.grantId);
    await p.owner.buddy.grant.revoke({ grantId: g.grantId });
    const status = async (id: string) => (await env.db.select().from(buddyDraft).where(eq(buddyDraft.id, id)).get())!.status;
    expect(await status(a)).toBe("expired");
    expect(await status(claimed)).toBe("pending");
    expect(await status(done)).toBe("confirmed");
    expect(await status(elsewhere)).toBe("pending");
    expect(await grantRow(g.grantId)).toMatchObject({ revokedReason: "owner" });
    expect((await grantRow(old.grantId))!.revokedReason).toBe("replaced");
  });

  test("Connect Hermes again (replacing the key) expires the old key's pending drafts", async () => {
    const p = await buddyPlant(env);
    const g = await connect(p);
    const a = await pendingDraft(p.companyId, p.users.owner.id, g.grantId);
    await connect(p);
    expect((await env.db.select().from(buddyDraft).where(eq(buddyDraft.id, a)).get())!.status).toBe("expired");
  });
});
