/**
 * Sign-in facts, the link guard and the strong-method rule (plan 2026-11-18, Task 3; spec Design §7-10
 * and Settings > Sign-in).
 *
 * - A passkey or a linked Google account counts like a password: no sign-in link signs such an
 *   account in, and such an owner leaves Godseye's "waiting to sign in" list.
 * - `auth.me` says whether the account has a passkey or Google; `auth.signInMethods` lists them for
 *   the settings page.
 * - Removing the last way in (password, passkey, Google) is refused with `LAST_SIGN_IN_METHOD`.
 * - A member of an active plant that requires secure sign-in may not remove or turn off the last
 *   strong method (authenticator app, passkey, Google): `COMPANY_REQUIRES_STRONG_METHOD` (owner
 *   amendment 2026-11-18, Task 9; it replaced the owner-only rule). More in auth-plant-policy.test.ts.
 * - Adding or removing a passkey writes a user-level audit row (no plant).
 * - The daily cron removes expired `verification` rows (passkey challenges pile up otherwise).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { account, auditLog, passkey, session, user, verification } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
  (await import("@orrn/auth")).resetAuthForTests();
}, 60_000);

afterAll(async () => {
  (await import("@orrn/auth")).resetAuthForTests();
  await env.dispose();
});

const PASSWORD = "sign-in-methods-password-123";
const unique = (tag: string) => `${tag}.${crypto.randomUUID().slice(0, 8)}@test.orrn`;
const setCookies = (res: Response): string[] => (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
const cookieHeader = (res: Response) => setCookies(res).map((c) => c.slice(0, c.indexOf(";"))).join("; ");

async function auth() {
  return (await import("@orrn/auth")).createAuth();
}

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  return (await auth()).handler(
    new Request(`https://api.test/api/auth/${path}`, {
      method: init.method ?? "POST",
      headers: {
        origin: "https://app.test",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }),
  );
}

/** A user with a password (and, unless `password: false`, a credential row). */
async function makeUser(opts: { password?: boolean } = {}) {
  const { hashPassword } = await import("@orrn/auth/password");
  const id = crypto.randomUUID();
  const email = unique("methods");
  await env.db.insert(user).values({ id, name: "Methods test", email, emailVerified: true } as never);
  if (opts.password !== false) {
    await env.db
      .insert(account)
      .values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(PASSWORD) } as never);
  }
  return { id, email };
}

async function addPasskey(userId: string, name = "Phone") {
  const id = crypto.randomUUID();
  await env.db.insert(passkey).values({
    id,
    name,
    publicKey: "cHVibGljLWtleQ",
    userId,
    credentialID: `cred-${crypto.randomUUID()}`,
    counter: 0,
    deviceType: "multiDevice",
    backedUp: true,
    transports: "internal",
  });
  return id;
}

async function addGoogle(userId: string) {
  await env.db
    .insert(account)
    .values({ id: crypto.randomUUID(), accountId: `g-${crypto.randomUUID()}`, providerId: "google", userId } as never);
}

/** A member (any role) of a plant that requires secure sign-in (Settings > Security). */
async function makeStrictMember(userId: string, role: "owner" | "packer" = "packer") {
  const { companyId } = await env.seedCompany({ settings: { requireStrongSignIn: true } });
  await env.addMembership(userId, companyId, role);
  return companyId;
}

/** An owner of a plant without the policy: two-factor is their own choice. */
async function makeOwner(userId: string) {
  const { companyId } = await env.seedCompany();
  await env.addMembership(userId, companyId, "owner");
  return companyId;
}

/** A real (fresh) Better Auth session from a password sign-in. */
async function signIn(email: string) {
  const res = await call("sign-in/email", { body: { email, password: PASSWORD } });
  expect(res.status).toBe(200);
  return cookieHeader(res);
}

async function codeOf(res: Response) {
  const text = await res.text();
  try {
    return (JSON.parse(text) as { code?: string } | null)?.code;
  } catch {
    return undefined;
  }
}

const passkeysOf = (userId: string) => env.db.select().from(passkey).where(eq(passkey.userId, userId)).all();

describe("auth.me and auth.signInMethods", () => {
  test("auth.me reports passkey and google", async () => {
    const plain = await makeUser();
    const plainMe = await env.callerForUser(plain.id).auth.me();
    expect(plainMe.user).toMatchObject({ hasPassword: true, hasPasskey: false, hasGoogle: false });

    const rich = await makeUser({ password: false });
    await addPasskey(rich.id);
    await addGoogle(rich.id);
    const richMe = await env.callerForUser(rich.id).auth.me();
    expect(richMe.user).toMatchObject({ hasPassword: false, hasPasskey: true, hasGoogle: true });
  });

  test("auth.signInMethods lists the account's own methods and passkeys", async () => {
    const u = await makeUser();
    const passkeyId = await addPasskey(u.id, "Ramesh's phone");
    const other = await makeUser();
    await addPasskey(other.id, "Someone else");
    const methods = await env.callerForUser(u.id).auth.signInMethods();
    expect(methods).toMatchObject({ password: true, authenticator: false, google: false, requiredByPlant: false });
    expect(methods.emailVerified).toBe(true);
    expect(methods.passkeys).toHaveLength(1);
    expect(methods.passkeys[0]).toMatchObject({ id: passkeyId, name: "Ramesh's phone", lastUsedAt: null });
    expect(methods.passkeys[0]!.createdAt).toBeInstanceOf(Date);
    // Never the public key or the credential id.
    expect(Object.keys(methods.passkeys[0]!).sort()).toEqual(["createdAt", "id", "lastUsedAt", "name"]);

    await makeOwner(u.id);
    await env.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, u.id));
    // Owning a plant alone no longer makes the rule apply; the plant's policy does.
    expect(await env.callerForUser(u.id).auth.signInMethods()).toMatchObject({ authenticator: true, requiredByPlant: false });
    await makeStrictMember(u.id);
    expect(await env.callerForUser(u.id).auth.signInMethods()).toMatchObject({ requiredByPlant: true });
    // Linking Google to an unconfirmed email clears the other methods (google-guard.ts): Settings warns first.
    await env.db.update(user).set({ emailVerified: false }).where(eq(user.id, u.id));
    expect(await env.callerForUser(u.id).auth.signInMethods()).toMatchObject({ emailVerified: false });
  });

  test("auth.signInMethods needs a session", async () => {
    await expect(env.caller(null).auth.signInMethods()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("sign-in links never beat a passkey or Google", () => {
  async function issueLink(email: string) {
    const token = `tok${crypto.randomUUID().replace(/-/g, "")}`;
    await env.db.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: token,
      value: JSON.stringify({ email, attempt: 0 }),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } as never);
    return token;
  }
  const verify = async (token: string) => call(`magic-link/verify?token=${encodeURIComponent(token)}`, { method: "GET" });
  const sessionsOf = async (userId: string) => (await env.db.select().from(session).where(eq(session.userId, userId))).length;

  test("magic link refused for passkey-only account", async () => {
    const u = await makeUser({ password: false });
    await addPasskey(u.id);
    const res = await verify(await issueLink(u.email));
    expect(res.status).toBe(403);
    expect(await sessionsOf(u.id)).toBe(0);
  });

  test("magic link refused for google-only account", async () => {
    const u = await makeUser({ password: false });
    await addGoogle(u.id);
    const res = await verify(await issueLink(u.email));
    expect(res.status).toBe(403);
    expect(await sessionsOf(u.id)).toBe(0);
  });

  test("a link still signs in an account with no way in yet", async () => {
    const u = await makeUser({ password: false });
    const res = await verify(await issueLink(u.email));
    expect(res.status).toBe(200);
    expect(await sessionsOf(u.id)).toBe(1);
  });
});

describe("Godseye: waiting to sign in", () => {
  async function approvedOwner() {
    const { waitlistRequest } = await import("@orrn/db/schema/tenant");
    const { id } = await env.caller(null).waitlist.submit({
      companyName: `Awaiting ${crypto.randomUUID().slice(0, 8)}`,
      requesterName: "Requester",
      requesterEmail: unique("req"),
    });
    const staff = env.caller({ platformRole: "super_admin" });
    await staff.platform.waitlistApprove({ id });
    const request = await env.db.select().from(waitlistRequest).where(eq(waitlistRequest.id, id)).get();
    const owner = await env.db.select().from(user).where(eq(user.email, request!.requesterEmail)).get();
    return { requestId: id, ownerId: owner!.id, staff };
  }

  test("waitlist awaiting sign-in skips owners with a passkey or google", async () => {
    const waiting = await approvedOwner();
    const withPasskey = await approvedOwner();
    const withGoogle = await approvedOwner();
    await addPasskey(withPasskey.ownerId);
    await addGoogle(withGoogle.ownerId);
    const ids = (await waiting.staff.platform.waitlistAwaitingSignIn()).map((r) => r.id);
    expect(ids).toContain(waiting.requestId);
    expect(ids).not.toContain(withPasskey.requestId);
    expect(ids).not.toContain(withGoogle.requestId);
  });

  test("no fresh sign-in link for an owner who signs in with a passkey", async () => {
    const owner = await approvedOwner();
    await addPasskey(owner.ownerId);
    await expect(owner.staff.platform.waitlistSignInDetails({ id: owner.requestId })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("removing a sign-in method", () => {
  test("last sign-in method cannot be removed", async () => {
    const u = await makeUser();
    const cookie = await signIn(u.email);
    const passkeyId = await addPasskey(u.id);
    // Now passkey-only: the password goes, the session stays.
    await env.db.delete(account).where(and(eq(account.userId, u.id), eq(account.providerId, "credential")));
    const res = await call("passkey/delete-passkey", { body: { id: passkeyId }, cookie });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("LAST_SIGN_IN_METHOD");
    expect(await passkeysOf(u.id)).toHaveLength(1);
  });

  test("a second passkey can go while another way in stays", async () => {
    const u = await makeUser();
    const cookie = await signIn(u.email);
    const first = await addPasskey(u.id, "Laptop");
    await addPasskey(u.id, "Phone");
    await env.db.delete(account).where(and(eq(account.userId, u.id), eq(account.providerId, "credential")));
    const res = await call("passkey/delete-passkey", { body: { id: first }, cookie });
    expect(res.status).toBe(200);
    expect((await passkeysOf(u.id)).map((p) => p.name)).toEqual(["Phone"]);
  });

  test("someone else's passkey is left to the plugin (not found), never counted as ours", async () => {
    const u = await makeUser();
    const cookie = await signIn(u.email);
    const mine = await addPasskey(u.id);
    await env.db.delete(account).where(and(eq(account.userId, u.id), eq(account.providerId, "credential")));
    const other = await makeUser();
    const theirs = await addPasskey(other.id);
    const res = await call("passkey/delete-passkey", { body: { id: theirs }, cookie });
    expect(await codeOf(res)).not.toBe("LAST_SIGN_IN_METHOD");
    expect(res.status).not.toBe(200);
    expect(await passkeysOf(other.id)).toHaveLength(1);
    expect((await passkeysOf(u.id)).map((p) => p.id)).toEqual([mine]);
  });

  test("a member of a plant that requires secure sign-in cannot drop the last strong method", async () => {
    const u = await makeUser();
    await makeStrictMember(u.id);
    const cookie = await signIn(u.email);
    const passkeyId = await addPasskey(u.id);
    const refused = await call("passkey/delete-passkey", { body: { id: passkeyId }, cookie });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe("COMPANY_REQUIRES_STRONG_METHOD");
    expect(await passkeysOf(u.id)).toHaveLength(1);

    // With the authenticator app on, the passkey is not the last strong method.
    await env.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, u.id));
    const allowed = await call("passkey/delete-passkey", { body: { id: passkeyId }, cookie });
    expect(allowed.status).toBe(200);
    expect(await passkeysOf(u.id)).toHaveLength(0);
  });

  test("without a plant policy anyone may keep only a password, owners too", async () => {
    const u = await makeUser();
    await makeOwner(u.id);
    const cookie = await signIn(u.email);
    const passkeyId = await addPasskey(u.id);
    const res = await call("passkey/delete-passkey", { body: { id: passkeyId }, cookie });
    expect(res.status).toBe(200);
  });

  test("under the policy the authenticator cannot be turned off when it is the last strong method", async () => {
    const u = await makeUser();
    await makeStrictMember(u.id, "owner");
    const cookie = await signIn(u.email);
    await env.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, u.id));
    const res = await call("two-factor/disable", { body: { password: PASSWORD }, cookie });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("COMPANY_REQUIRES_STRONG_METHOD");
    expect((await env.db.select().from(user).where(eq(user.id, u.id)).get())?.twoFactorEnabled).toBe(true);
  });

  test("under the policy Google cannot be unlinked when it is the last strong method; with a passkey left it may", async () => {
    const u = await makeUser();
    await makeStrictMember(u.id);
    const cookie = await signIn(u.email);
    await addGoogle(u.id);
    const refused = await call("unlink-account", { body: { providerId: "google" }, cookie });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe("COMPANY_REQUIRES_STRONG_METHOD");

    await addPasskey(u.id);
    const allowed = await call("unlink-account", { body: { providerId: "google" }, cookie });
    expect(allowed.status).toBe(200);
    const left = await env.db.select().from(account).where(eq(account.userId, u.id)).all();
    expect(left.map((a) => a.providerId)).toEqual(["credential"]);
  });

  test("Google + a passkey, no password: Google may be unlinked (a passkey is a way in, though it is no account row)", async () => {
    const u = await makeUser();
    const cookie = await signIn(u.email);
    await addGoogle(u.id);
    await addPasskey(u.id);
    // Now Google is the account's only `account` row; the passkey stays a way in.
    await env.db.delete(account).where(and(eq(account.userId, u.id), eq(account.providerId, "credential")));
    const res = await call("unlink-account", { body: { providerId: "google" }, cookie });
    expect(res.status).toBe(200);
    expect(await env.db.select().from(account).where(eq(account.userId, u.id)).all()).toHaveLength(0);
    expect(await passkeysOf(u.id)).toHaveLength(1);
  });

  test("Google as the only way in: unlink refused with LAST_SIGN_IN_METHOD, Google kept", async () => {
    const u = await makeUser();
    const cookie = await signIn(u.email);
    await addGoogle(u.id);
    await env.db.delete(account).where(and(eq(account.userId, u.id), eq(account.providerId, "credential")));
    const res = await call("unlink-account", { body: { providerId: "google" }, cookie });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("LAST_SIGN_IN_METHOD");
    const left = await env.db.select().from(account).where(eq(account.userId, u.id)).all();
    expect(left.map((a) => a.providerId)).toEqual(["google"]);
  });

  test("unlinking the password of a google + passkey member is allowed under the policy (strong methods stay)", async () => {
    const u = await makeUser();
    await makeStrictMember(u.id);
    const cookie = await signIn(u.email);
    await addGoogle(u.id);
    await addPasskey(u.id);
    const res = await call("unlink-account", { body: { providerId: "credential" }, cookie });
    expect(res.status).toBe(200);
  });
});

describe("audit", () => {
  test("removing a passkey writes auth.passkey.remove (no plant, no credential data)", async () => {
    const u = await makeUser();
    const cookie = await signIn(u.email);
    const passkeyId = await addPasskey(u.id);
    expect((await call("passkey/delete-passkey", { body: { id: passkeyId }, cookie })).status).toBe(200);
    const rows = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.actorId, u.id), eq(auditLog.action, "auth.passkey.remove")))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ companyId: null, subjectType: "user", subjectId: u.id, meta: { passkeyId } });
  });

  test("a refused removal writes no audit row", async () => {
    const u = await makeUser();
    await makeStrictMember(u.id);
    const cookie = await signIn(u.email);
    const passkeyId = await addPasskey(u.id);
    expect((await call("passkey/delete-passkey", { body: { id: passkeyId }, cookie })).status).toBe(403);
    const rows = await env.db.select().from(auditLog).where(and(eq(auditLog.actorId, u.id), eq(auditLog.action, "auth.passkey.remove"))).all();
    expect(rows).toHaveLength(0);
  });

  test("adding a passkey writes auth.passkey.add, from either response shape", async () => {
    const { signInAuditAfter } = await import("@orrn/auth/sign-in-methods");
    const u = await makeUser();
    const created = { id: crypto.randomUUID(), userId: u.id, credentialID: "secret-cred", publicKey: "secret-key", name: "Phone" };
    // In-process `auth.api.*` hands the hook the plain object; the HTTP handler wraps it.
    await signInAuditAfter(env.db, { path: "/passkey/verify-registration", context: { returned: created } } as never);
    await signInAuditAfter(env.db, {
      path: "/passkey/verify-registration",
      context: { returned: { body: { ...created, id: "second" }, _flag: "json" } },
    } as never);
    const rows = await env.db.select().from(auditLog).where(and(eq(auditLog.actorId, u.id), eq(auditLog.action, "auth.passkey.add"))).all();
    expect(rows.map((r) => (r.meta as { passkeyId: string }).passkeyId).sort()).toEqual([created.id, "second"].sort());
    for (const row of rows) {
      expect(row.companyId).toBeNull();
      expect(JSON.stringify(row.meta)).not.toContain("secret");
    }
  });

  test("a failed registration writes nothing", async () => {
    const { signInAuditAfter } = await import("@orrn/auth/sign-in-methods");
    const before = (await env.db.select().from(auditLog).where(eq(auditLog.action, "auth.passkey.add")).all()).length;
    await signInAuditAfter(env.db, {
      path: "/passkey/verify-registration",
      // An APIError-shaped answer (the server package does not depend on better-auth directly).
      context: { returned: Object.assign(new Error("nope"), { status: "BAD_REQUEST", statusCode: 400, body: { code: "FAILED_TO_VERIFY_REGISTRATION" } }) },
    } as never);
    expect((await env.db.select().from(auditLog).where(eq(auditLog.action, "auth.passkey.add")).all()).length).toBe(before);
  });
});

describe("daily cron: expired verification rows", () => {
  test("the daily cron removes expired verification rows and keeps live ones", async () => {
    const { runDailyCron } = await import("../src/lib/dailyCron");
    const now = new Date();
    const tag = crypto.randomUUID().slice(0, 8);
    const rows = [
      { id: `old-${tag}`, identifier: `old-${tag}`, value: "{}", expiresAt: new Date(now.getTime() - 60_000) },
      { id: `live-${tag}`, identifier: `live-${tag}`, value: "{}", expiresAt: new Date(now.getTime() + 60 * 60_000) },
    ];
    await env.db.insert(verification).values(rows as never);
    const result = await runDailyCron(env.db, now, { log: () => {}, error: () => {} });
    expect(result.verifications.ok).toBe(true);
    const left = (await env.db.select().from(verification).all()).map((r) => r.id);
    expect(left).toContain(`live-${tag}`);
    expect(left).not.toContain(`old-${tag}`);
  });

  test("the purge is bounded per run", async () => {
    const { purgeExpiredVerifications, VERIFICATION_PURGE_BATCH } = await import("../src/lib/verificationPurge");
    const past = new Date(Date.now() - 60_000);
    const tag = crypto.randomUUID().slice(0, 8);
    const n = VERIFICATION_PURGE_BATCH + 5;
    for (let i = 0; i < n; i += 10) {
      await env.db.insert(verification).values(
        Array.from({ length: Math.min(10, n - i) }, (_, j) => ({ id: `b-${tag}-${i + j}`, identifier: `b-${tag}`, value: "{}", expiresAt: past })) as never,
      );
    }
    const first = await purgeExpiredVerifications(env.db, new Date(), { maxBatches: 1 });
    expect(first).toEqual({ removed: VERIFICATION_PURGE_BATCH, capped: true });
    const second = await purgeExpiredVerifications(env.db, new Date(), { maxBatches: 1 });
    expect(second.removed).toBeGreaterThanOrEqual(5);
    expect(second.capped).toBe(false);
  });
});
