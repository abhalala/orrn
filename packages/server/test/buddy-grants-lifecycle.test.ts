/**
 * orrn buddy grants, delta round (2026-11-21, lead decisions 8 and 11; security D-L1, D-L4):
 * - an expired grant is refused on the MCP leg (401), the same as a revoked one;
 * - a plant suspended (the platform write, or found suspended by the MCP leg) or not listed in BUDDY_COMPANIES
 *   revokes its grants, and lifting the suspension or listing it again never brings one back;
 * - secure sign-in turned off for the person revokes: the plant dropping the requirement (only the grants whose
 *   sign-in method needed it), and the person removing a passkey, the authenticator app or Google;
 * - enrolling or removing a second factor remakes the session, and the remade session keeps the old `createdAt`, so it
 *   cannot pass the 10-minute fresh sign-in check without a real sign-in.
 * Synthetic data only.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { account, buddyDraft, buddyGrant, buddyLink, company, passkey, session, user } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { buddyPlant, connect, listPlant, mcpRequest, setHermesEnv, unlistPlant, type BuddyPlant } from "./buddy-fixture";
import { workersEnv } from "./env-mock";
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
afterEach(() => setHermesEnv(false));

const MINUTE = 60_000;

const grantRow = (grantId: string) => env.db.select().from(buddyGrant).where(eq(buddyGrant.id, grantId)).get();
const tools = (token: string) => mcpRequest(env, token, { jsonrpc: "2.0", id: 1, method: "tools/list" });

async function grantFor(p: BuddyPlant, userId: string, over: Partial<typeof buddyGrant.$inferInsert> = {}) {
  const { newBuddyToken, hashBuddyToken } = await import("../src/lib/buddy/token");
  const { createId } = await import("../src/lib/id");
  const token = newBuddyToken();
  const id = createId();
  await env.db.insert(buddyGrant).values({
    id,
    companyId: p.companyId,
    userId,
    tokenHash: await hashBuddyToken(token),
    createdBy: userId,
    expiresAt: new Date(Date.now() + 86_400_000),
    ...over,
  });
  return { token, grantId: id };
}

async function pendingDraft(companyId: string, userId: string, grantId: string): Promise<string> {
  const { createId } = await import("../src/lib/id");
  const id = createId();
  const at = new Date();
  await env.db.insert(buddyDraft).values({
    id,
    companyId,
    requestedByUserId: userId,
    grantId,
    path: "customer.create",
    inputJson: { name: "Synthetic Co" },
    summary: "Add a customer",
    status: "pending",
    createdAt: at,
    expiresAt: new Date(at.getTime() + 86_400_000),
  });
  return id;
}
const draftStatus = async (id: string) => (await env.db.select().from(buddyDraft).where(eq(buddyDraft.id, id)).get())!.status;

describe("expiry on the MCP leg (D-L1, decision 8)", () => {
  test("a grant past expires_at gets 401 on tools/list and tools/call, the same as a revoked one", async () => {
    const p = await buddyPlant(env);
    const { token, grantId } = await connect(p);
    expect((await tools(token)).status).toBe(200);
    await env.db.update(buddyGrant).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(buddyGrant.id, grantId));
    expect((await tools(token)).status).toBe(401);
    const call = await mcpRequest(env, token, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "orrn_call", arguments: { path: "customer.list", input: {} } } });
    expect(call.status).toBe(401);
    expect(await call.text()).toBe("");
  });
});

describe("plant suspended or not listed: revoked, never brought back (D-L4, decision 11)", () => {
  test("platform suspend revokes the plant's grants (plant_suspended) with their pending drafts; reactivating brings none back", async () => {
    const p = await buddyPlant(env);
    const { token, grantId } = await connect(p);
    const draftId = await pendingDraft(p.companyId, p.users.owner.id, grantId);
    const other = await buddyPlant(env);
    const kept = await connect(other);
    const staff = env.caller({ platformRole: "super_admin" });
    await staff.platform.companiesSuspend({ id: p.companyId });
    expect(await grantRow(grantId)).toMatchObject({ revokedReason: "plant_suspended" });
    expect(await draftStatus(draftId)).toBe("expired");
    const link = await env.db.select().from(buddyLink).where(eq(buddyLink.companyId, p.companyId)).get();
    expect(link!.status).toBe("revoked");
    await staff.platform.companiesReactivate({ id: p.companyId });
    expect((await tools(token)).status).toBe(401);
    expect((await grantRow(grantId))!.revokedReason).toBe("plant_suspended");
    // Another plant's grant is untouched.
    expect((await tools(kept.token)).status).toBe(200);
  });

  test("the MCP leg finds the plant suspended (a write outside the platform router): revoked, and lifting it brings nothing back", async () => {
    const p = await buddyPlant(env);
    const { token, grantId } = await connect(p);
    await env.db.update(company).set({ status: "suspended" }).where(eq(company.id, p.companyId));
    expect((await tools(token)).status).toBe(401);
    expect(await grantRow(grantId)).toMatchObject({ revokedReason: "plant_suspended" });
    await env.db.update(company).set({ status: "active" }).where(eq(company.id, p.companyId));
    expect((await tools(token)).status).toBe(401);
  });

  test("the MCP leg finds the plant not listed in BUDDY_COMPANIES: revoked (plant_delisted); listing it again brings nothing back", async () => {
    const p = await buddyPlant(env);
    const { token, grantId } = await connect(p);
    const draftId = await pendingDraft(p.companyId, p.users.owner.id, grantId);
    await unlistPlant(env, p.companyId);
    expect((await tools(token)).status).toBe(401);
    expect(await grantRow(grantId)).toMatchObject({ revokedReason: "plant_delisted" });
    expect(await draftStatus(draftId)).toBe("expired");
    await listPlant(env, p.companyId);
    expect((await tools(token)).status).toBe(401);
  });

  test("a stage with no BUDDY_COMPANIES at all (the buddy is off there) refuses but does not revoke", async () => {
    const p = await buddyPlant(env);
    const { token, grantId } = await connect(p);
    const saved = workersEnv.BUDDY_COMPANIES;
    try {
      delete workersEnv.BUDDY_COMPANIES;
      expect((await tools(token)).status).toBe(401);
      expect((await grantRow(grantId))!.revokedAt).toBeNull();
    } finally {
      workersEnv.BUDDY_COMPANIES = saved;
    }
    expect((await tools(token)).status).toBe(200);
  });
});

describe("secure sign-in turned off for the person (D-L4, decision 11)", () => {
  test("the plant drops the requirement: grants whose method needed it are revoked (secure_sign_in_off); strong ones stay; saving false again changes nothing", async () => {
    const p = await buddyPlant(env, { settings: { requireStrongSignIn: true } });
    const strongOwner = env.caller({ role: "owner", companyId: p.companyId, signInMethod: "passkey" });
    const strong = await strongOwner.buddy.grant.create();
    const weak = await grantFor(p, p.users.owner.id, { signInMethod: "password" });
    const none = await grantFor(p, p.users.owner.id, { signInMethod: null });
    const weakDraft = await pendingDraft(p.companyId, p.users.owner.id, weak.grantId);
    await strongOwner.company.updateSettings({ requireStrongSignIn: false });
    expect(await grantRow(weak.grantId)).toMatchObject({ revokedReason: "secure_sign_in_off" });
    expect(await grantRow(none.grantId)).toMatchObject({ revokedReason: "secure_sign_in_off" });
    expect(await draftStatus(weakDraft)).toBe("expired");
    expect((await grantRow(strong.grantId))!.revokedAt).toBeNull();
    // The password grant was refused while the rule held; it must not start working now.
    expect((await tools(weak.token)).status).toBe(401);
    // Saving "off" again (no change) revokes nothing, not even a password grant made since.
    const later = await grantFor(p, p.users.owner.id, { signInMethod: "password" });
    await strongOwner.company.updateSettings({ requireStrongSignIn: false });
    expect((await grantRow(later.grantId))!.revokedAt).toBeNull();
    expect((await grantRow(strong.grantId))!.revokedAt).toBeNull();
    // Turning it on revokes nothing either (the gate refuses weak grants by itself).
    await strongOwner.company.updateSettings({ requireStrongSignIn: true });
    expect((await grantRow(later.grantId))!.revokedAt).toBeNull();
  });

  test("another plant's policy change leaves this plant's grants alone", async () => {
    const p = await buddyPlant(env);
    const weak = await grantFor(p, p.users.owner.id, { signInMethod: "password" });
    const q = await buddyPlant(env, { settings: { requireStrongSignIn: true } });
    await env.caller({ role: "owner", companyId: q.companyId, signInMethod: "passkey" }).company.updateSettings({ requireStrongSignIn: false });
    expect((await grantRow(weak.grantId))!.revokedAt).toBeNull();
  });
});

const PASSWORD = "lifecycle-test-password-123";

function authEnv(): Env {
  return {
    DB: env.d1,
    NODE_ENV: "production",
    CORS_ORIGIN: TEST_WEB_ORIGIN,
    CORS_ALLOWED_ORIGINS: TEST_WEB_ORIGIN,
    WEB_PUBLIC_URL: TEST_WEB_ORIGIN,
    BETTER_AUTH_URL: "https://api.test",
    BETTER_AUTH_SECRET: "buddy-lifecycle-test-secret-0123456789",
    ORRN_MASTER_KEY: "",
    WEBHOOK_BASE_URL: "",
    CF_API_TOKEN: "",
    CF_ACCOUNT_ID: "",
    CF_ZONE_ID_IN: "",
  } as unknown as Env;
}

async function authCall(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const { createAuth } = await import("@orrn/auth");
  return createAuth(authEnv()).handler(
    new Request(`https://api.test/api/auth/${path}`, {
      method: init.method ?? "POST",
      headers: {
        origin: TEST_WEB_ORIGIN,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }),
  );
}

const setCookies = (res: Response): string[] => (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
/** The live session cookie a response set (an expired one, `Max-Age=0`, is skipped). */
function sessionCookie(res: Response): string | null {
  const c = setCookies(res).find((x) => x.startsWith("__Host-better-auth.session_token=") && !/max-age=0/i.test(x));
  return c ? c.split(";")[0]! : null;
}

/** An owner with a password in a listed plant (no secure sign-in rule), signed in for real. */
async function signedInOwner(opts: { passkey?: boolean; google?: boolean } = {}) {
  const p = await buddyPlant(env);
  const { hashPassword } = await import("@orrn/auth/password");
  const id = crypto.randomUUID();
  const email = `life.${id.slice(0, 8)}@test.orrn`;
  await env.db.insert(user).values({ id, name: "Lifecycle test", email, emailVerified: true } as never);
  await env.db.insert(account).values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(PASSWORD) } as never);
  if (opts.passkey) {
    await env.db.insert(passkey).values({
      id: crypto.randomUUID(),
      name: "Phone",
      publicKey: "cHVibGljLWtleQ",
      userId: id,
      credentialID: `cred-${crypto.randomUUID()}`,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
      transports: "internal",
      createdAt: new Date(),
    } as never);
  }
  if (opts.google) {
    await env.db.insert(account).values({ id: crypto.randomUUID(), accountId: `g-${id}`, providerId: "google", userId: id } as never);
  }
  await env.addMembership(id, p.companyId, "owner");
  const res = await authCall("sign-in/email", { body: { email, password: PASSWORD } });
  expect(res.status).toBe(200);
  return { p, id, email, cookie: sessionCookie(res)! };
}

/** A tRPC caller on the real Better Auth session the cookie names. */
async function callerOnCookie(p: BuddyPlant, userId: string, cookie: string) {
  const { createAuth } = await import("@orrn/auth");
  const s = await createAuth(authEnv()).api.getSession({ headers: new Headers({ cookie }) });
  if (!s) throw new Error("no session for the cookie");
  const { appRouter } = await import("../src/routers/index");
  const { resolveTenantContext } = await import("../src/lib/tenantContext");
  return appRouter.createCaller(async () => ({
    auth: null,
    db: env.db,
    request: new Request("https://api.test/trpc", { method: "POST", headers: { origin: TEST_WEB_ORIGIN } }),
    session: s,
    ...(await resolveTenantContext(env.db, { userId, companyHeader: p.companyId, impersonateHeader: null })),
  }) as never);
}

async function refusalReason(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    const { errorMetaOf } = await import("../src/lib/errorMeta");
    return (errorMetaOf(e as never) as { reason?: unknown } | null)?.reason ?? (e as { code?: string }).code;
  }
  return "no refusal";
}

/** Makes every session of the person 20 minutes old (a session held past the fresh sign-in window). */
async function ageSessions(userId: string) {
  await env.db.update(session).set({ createdAt: new Date(Date.now() - 20 * MINUTE) }).where(eq(session.userId, userId));
}

describe("removing a factor revokes the person's grants (D-L4: secure_sign_in_off)", () => {
  test("a passkey removed: every grant of the person ends with its pending drafts; a refused removal leaves them", async () => {
    const { p, id, cookie } = await signedInOwner({ passkey: true });
    const g = await env.callerForUser(id, { company: p.companyId }).buddy.grant.create();
    const draftId = await pendingDraft(p.companyId, id, g.grantId);
    // Someone else's passkey id: the endpoint refuses, nothing is removed, the grant stays.
    expect((await authCall("passkey/delete-passkey", { body: { id: "not-a-passkey" }, cookie })).status).not.toBe(200);
    expect((await grantRow(g.grantId))!.revokedAt).toBeNull();
    const key = await env.db.select().from(passkey).where(eq(passkey.userId, id)).get();
    expect((await authCall("passkey/delete-passkey", { body: { id: key!.id }, cookie })).status).toBe(200);
    expect(await grantRow(g.grantId)).toMatchObject({ revokedReason: "secure_sign_in_off" });
    expect(await draftStatus(draftId)).toBe("expired");
  });

  test("the authenticator app turned off: revoked; a wrong password leaves the grant", async () => {
    const { p, id, cookie } = await signedInOwner();
    await env.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, id));
    const g = await env.callerForUser(id, { company: p.companyId }).buddy.grant.create();
    expect((await authCall("two-factor/disable", { body: { password: "wrong-password-000" }, cookie })).status).not.toBe(200);
    expect((await grantRow(g.grantId))!.revokedAt).toBeNull();
    expect((await authCall("two-factor/disable", { body: { password: PASSWORD }, cookie })).status).toBe(200);
    expect(await grantRow(g.grantId)).toMatchObject({ revokedReason: "secure_sign_in_off" });
  });

  test("Google unlinked: revoked; a password unlink is not a secure sign-in change and leaves the grant", async () => {
    const { p, id, cookie } = await signedInOwner({ google: true, passkey: true });
    const g = await env.callerForUser(id, { company: p.companyId }).buddy.grant.create();
    expect((await authCall("unlink-account", { body: { providerId: "credential" }, cookie })).status).toBe(200);
    expect((await grantRow(g.grantId))!.revokedAt).toBeNull();
    expect((await authCall("unlink-account", { body: { providerId: "google" }, cookie })).status).toBe(200);
    expect(await grantRow(g.grantId)).toMatchObject({ revokedReason: "secure_sign_in_off" });
  });
});

describe("enrolling a factor is not a fresh sign-in (D-L4)", () => {
  test("turning the authenticator app on in a held session remakes it with its old createdAt: grant.create says FRESH_SIGN_IN_NEEDED", async () => {
    const { createOTP } = await import("@better-auth/utils/otp");
    const { base32 } = await import("@better-auth/utils/base32");
    const { p, id, cookie } = await signedInOwner();
    await ageSessions(id);
    const enabled = await authCall("two-factor/enable", { body: { password: PASSWORD }, cookie });
    expect(enabled.status).toBe(200);
    const encoded = new URL(((await enabled.json()) as { totpURI: string }).totpURI).searchParams.get("secret")!;
    const secret = new TextDecoder().decode(base32.decode(encoded));
    const verified = await authCall("two-factor/verify-totp", { body: { code: await createOTP(secret, { digits: 6, period: 30 }).totp() }, cookie });
    expect(verified.status).toBe(200);
    const remade = sessionCookie(verified)!;
    expect(remade).not.toBe(cookie);
    const rows = await env.db.select().from(session).where(eq(session.userId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.signInMethod).toBe("totp");
    expect(Date.now() - rows[0]!.createdAt.getTime()).toBeGreaterThan(15 * MINUTE);
    expect(await refusalReason((await callerOnCookie(p, id, remade)).buddy.grant.create())).toBe("FRESH_SIGN_IN_NEEDED");
  });

  test("turning the authenticator app off remakes the session with its old createdAt too", async () => {
    const { p, id, cookie } = await signedInOwner();
    await env.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, id));
    await ageSessions(id);
    const off = await authCall("two-factor/disable", { body: { password: PASSWORD }, cookie });
    expect(off.status).toBe(200);
    const remade = sessionCookie(off)!;
    expect(remade).not.toBe(cookie);
    expect(await refusalReason((await callerOnCookie(p, id, remade)).buddy.grant.create())).toBe("FRESH_SIGN_IN_NEEDED");
  });

  test("a real sign-in while still signed in is fresh: grant.create works", async () => {
    const { p, id, email, cookie } = await signedInOwner();
    await ageSessions(id);
    expect(await refusalReason((await callerOnCookie(p, id, cookie)).buddy.grant.create())).toBe("FRESH_SIGN_IN_NEEDED");
    const again = await authCall("sign-in/email", { body: { email, password: PASSWORD }, cookie });
    expect(again.status).toBe(200);
    const fresh = sessionCookie(again)!;
    const made = await (await callerOnCookie(p, id, fresh)).buddy.grant.create();
    expect(made.token).toMatch(/^orrnb_/);
  });

  test("the code after a password (no session yet) is a real sign-in: fresh", async () => {
    const { createOTP } = await import("@better-auth/utils/otp");
    const { base32 } = await import("@better-auth/utils/base32");
    const { p, id, email, cookie } = await signedInOwner();
    const enabled = await authCall("two-factor/enable", { body: { password: PASSWORD }, cookie });
    const encoded = new URL(((await enabled.json()) as { totpURI: string }).totpURI).searchParams.get("secret")!;
    const secret = new TextDecoder().decode(base32.decode(encoded));
    const code = () => createOTP(secret, { digits: 6, period: 30 }).totp();
    expect((await authCall("two-factor/verify-totp", { body: { code: await code() }, cookie })).status).toBe(200);
    await env.db.delete(session).where(eq(session.userId, id));
    const pw = await authCall("sign-in/email", { body: { email, password: PASSWORD } });
    expect(((await pw.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    const twoFactorCookie = setCookies(pw).map((c) => c.split(";")[0]!).join("; ");
    const done = await authCall("two-factor/verify-totp", { body: { code: await code() }, cookie: twoFactorCookie });
    expect(done.status).toBe(200);
    const made = await (await callerOnCookie(p, id, sessionCookie(done)!)).buddy.grant.create();
    expect(made.token).toMatch(/^orrnb_/);
  });
});
