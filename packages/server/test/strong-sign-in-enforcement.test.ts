/**
 * Council round 1, A4 (Claude C1; controller ruling "enforce"): "Require secure sign-in" holds every
 * tenant procedure, not only the welcome step's routing.
 *
 * - Every session records how it was made (`session.sign_in_method`, migration 0052), stamped by the
 *   path that made it (packages/auth/src/session-method.ts).
 * - In a plant that requires it, `companyProcedure` accepts only a session made with a passkey, Google
 *   or the authenticator code. A person who has one but signed in with a password alone is refused
 *   with `STRONG_SIGN_IN_NEEDED`; one who has none with `STRONG_METHOD_NEEDED` (the secure step).
 * - `auth.*` and `company.switch` stay open; an impersonating platform admin is exempt; a plant
 *   without the policy is unaffected.
 * - A strong method proven inside the session (passkey added, Google linked, the authenticator app
 *   turned on) upgrades that session.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { account, impersonationGrant, passkey, platformAdmin, session, user } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

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

const PASSWORD = "strong-sign-in-password-123";
const unique = (tag: string) => `${tag}.${crypto.randomUUID().slice(0, 8)}@test.orrn`;
const setCookies = (res: Response): string[] => (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
const cookieHeader = (res: Response) => setCookies(res).map((c) => c.slice(0, c.indexOf(";"))).join("; ");
/** Later cookies replace earlier ones of the same name. */
const mergeCookies = (...parts: string[]) => {
  const jar = new Map<string, string>();
  for (const part of parts) for (const pair of part.split("; ").filter(Boolean)) jar.set(pair.slice(0, pair.indexOf("=")), pair);
  return [...jar.values()].join("; ");
};

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const auth = (await import("@orrn/auth")).createAuth();
  return auth.handler(
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

async function makeUser(opts: { password?: boolean } = {}) {
  const { hashPassword } = await import("@orrn/auth/password");
  const id = crypto.randomUUID();
  const email = unique("strong");
  await env.db.insert(user).values({ id, name: "Kiran Desai", email, emailVerified: true } as never);
  if (opts.password !== false) {
    await env.db
      .insert(account)
      .values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(PASSWORD) } as never);
  }
  return { id, email };
}

async function addPasskey(userId: string) {
  await env.db.insert(passkey).values({
    id: crypto.randomUUID(),
    name: "Phone",
    publicKey: "cHVibGljLWtleQ",
    userId,
    credentialID: `cred-${crypto.randomUUID()}`,
    counter: 0,
    deviceType: "multiDevice",
    backedUp: true,
    transports: "internal",
  });
}

const strictPlant = () => env.seedCompany({ settings: { requireStrongSignIn: true } });
const methodOf = async (sessionId: string) => (await env.db.select().from(session).where(eq(session.id, sessionId)).get())?.signInMethod;
const sessionsOf = (userId: string) => env.db.select().from(session).where(eq(session.userId, userId)).all();

async function refusal(p: Promise<unknown>) {
  try {
    await p;
  } catch (error) {
    const e = error as { code?: string; meta?: Record<string, unknown> };
    return { code: e.code, reason: e.meta?.reason, plant: e.meta?.plant };
  }
  return null;
}

describe("companyProcedure in a plant that requires secure sign-in", () => {
  test("a password session of a person with a passkey is refused with STRONG_SIGN_IN_NEEDED and the plant's name", async () => {
    const { companyId } = await strictPlant();
    const u = await makeUser();
    await addPasskey(u.id);
    await env.addMembership(u.id, companyId, "packer");
    const plant = await env.caller({ role: "owner", companyId, signInMethod: "passkey" }).company.getSettings();
    expect(plant).toBeDefined();
    const answer = await refusal(env.callerForUser(u.id, { signInMethod: "password" }).company.getSettings());
    expect(answer?.code).toBe("FORBIDDEN");
    expect(answer?.reason).toBe("STRONG_SIGN_IN_NEEDED");
    expect(String(answer?.plant)).toMatch(/^Test Co /);
  });

  test("a session made before the column (null) counts as not strong", async () => {
    const { companyId } = await strictPlant();
    const u = await makeUser();
    await addPasskey(u.id);
    await env.addMembership(u.id, companyId, "packer");
    expect((await refusal(env.callerForUser(u.id).company.getSettings()))?.reason).toBe("STRONG_SIGN_IN_NEEDED");
  });

  test("a person with no strong method is refused with STRONG_METHOD_NEEDED (the secure step)", async () => {
    const { companyId } = await strictPlant();
    const u = await makeUser();
    await env.addMembership(u.id, companyId, "packer");
    expect((await refusal(env.callerForUser(u.id, { signInMethod: "password" }).company.getSettings()))?.reason).toBe("STRONG_METHOD_NEEDED");
    expect((await refusal(env.callerForUser(u.id, { signInMethod: "magicLink" }).company.getSettings()))?.reason).toBe("STRONG_METHOD_NEEDED");
  });

  test("passkey, Google and authenticator-code sessions pass", async () => {
    const { companyId } = await strictPlant();
    const u = await makeUser();
    await addPasskey(u.id);
    await env.addMembership(u.id, companyId, "packer");
    for (const method of ["passkey", "google", "totp"]) {
      await expect(env.callerForUser(u.id, { signInMethod: method }).company.getSettings()).resolves.toBeDefined();
    }
    for (const method of ["password", "magicLink", "other"]) {
      expect((await refusal(env.callerForUser(u.id, { signInMethod: method }).company.getSettings()))?.reason).toBe("STRONG_SIGN_IN_NEEDED");
    }
  });

  test("a plant without the policy is unaffected: a password session works", async () => {
    const { companyId } = await env.seedCompany();
    const u = await makeUser();
    await env.addMembership(u.id, companyId, "packer");
    await expect(env.callerForUser(u.id, { signInMethod: "password" }).company.getSettings()).resolves.toBeDefined();
    await expect(env.callerForUser(u.id).company.getSettings()).resolves.toBeDefined();
  });

  test("a person in a strict plant and a relaxed one passes only in the relaxed one", async () => {
    const strict = await strictPlant();
    const relaxed = await env.seedCompany();
    const u = await makeUser();
    await addPasskey(u.id);
    await env.addMembership(u.id, strict.companyId, "packer");
    await env.addMembership(u.id, relaxed.companyId, "packer");
    const inStrict = env.callerForUser(u.id, { company: strict.companyId, signInMethod: "password" });
    const inRelaxed = env.callerForUser(u.id, { company: relaxed.companyId, signInMethod: "password" });
    expect((await refusal(inStrict.company.getSettings()))?.reason).toBe("STRONG_SIGN_IN_NEEDED");
    await expect(inRelaxed.company.getSettings()).resolves.toBeDefined();
    // The plant picker and auth.me stay open in both.
    expect((await inStrict.auth.me()).company?.requireStrongSignIn).toBe(true);
    await expect(inStrict.company.switch({ companyId: relaxed.companyId })).resolves.toBeDefined();
  });

  test("what the secure step needs stays open: auth.me, auth.signInMethods, auth.completeOnboarding", async () => {
    const { companyId } = await strictPlant();
    const u = await makeUser();
    await env.addMembership(u.id, companyId, "packer");
    const api = env.callerForUser(u.id, { signInMethod: "password" });
    await expect(api.auth.me()).resolves.toBeDefined();
    await expect(api.auth.signInMethods()).resolves.toBeDefined();
    await expect(api.auth.completeOnboarding({})).resolves.toEqual({ success: true });
  });

  test("an impersonating platform admin is not held by it (support can reach a locked plant)", async () => {
    const { companyId } = await strictPlant();
    const staffId = crypto.randomUUID();
    await env.db.insert(user).values({ id: staffId, name: "Support", email: `support.${staffId}@test.orrn` });
    await env.db.insert(platformAdmin).values({ userId: staffId, role: "admin" });
    await env.db.insert(impersonationGrant).values({ id: crypto.randomUUID(), platformAdminId: staffId, companyId, expiresAt: new Date(Date.now() + 600_000) });
    const staff = env.callerForUser(staffId, { impersonate: companyId, signInMethod: "password" });
    await expect(staff.company.getSettings()).resolves.toBeDefined();
    // And may turn the policy off.
    await staff.company.updateSettings({ requireStrongSignIn: false });
  });
});

describe("how a session was made (real Better Auth)", () => {
  test("a password sign-in is stamped password, and getSession reports it", async () => {
    const u = await makeUser();
    const res = await call("sign-in/email", { body: { email: u.email, password: PASSWORD } });
    expect(res.status).toBe(200);
    const [row] = await sessionsOf(u.id);
    expect(row?.signInMethod).toBe("password");
    const got = await (await import("@orrn/auth")).createAuth().api.getSession({ headers: new Headers({ cookie: cookieHeader(res) }) });
    expect((got?.session as { signInMethod?: string } | undefined)?.signInMethod).toBe("password");
  });

  test("a sign-in link is stamped magicLink", async () => {
    const u = await makeUser({ password: false });
    const token = `ml-${crypto.randomUUID()}`;
    const { verification } = await import("@orrn/db/schema");
    await env.db.insert(verification).values({
      id: crypto.randomUUID(),
      identifier: token,
      value: JSON.stringify({ email: u.email }),
      expiresAt: new Date(Date.now() + 600_000),
    } as never);
    const res = await call(`magic-link/verify?token=${token}&callbackURL=${encodeURIComponent("https://app.test/")}`, { method: "GET" });
    expect([200, 302]).toContain(res.status);
    const [row] = await sessionsOf(u.id);
    expect(row?.signInMethod).toBe("magicLink");
  });

  test("the authenticator app: turning it on makes the session totp, and the code after a password is totp", async () => {
    const { createOTP } = await import("@better-auth/utils/otp");
    const u = await makeUser();
    const first = await call("sign-in/email", { body: { email: u.email, password: PASSWORD } });
    let cookie = cookieHeader(first);
    const [before] = await sessionsOf(u.id);
    expect(before?.signInMethod).toBe("password");

    const enabled = await call("two-factor/enable", { body: { password: PASSWORD }, cookie });
    expect(enabled.status).toBe(200);
    // The URI carries the secret in base32; Better Auth's createOTP takes the raw secret.
    const { base32 } = await import("@better-auth/utils/base32");
    const encoded = new URL(((await enabled.json()) as { totpURI: string }).totpURI).searchParams.get("secret")!;
    const secret = new TextDecoder().decode(base32.decode(encoded));
    const code = async () => createOTP(secret, { digits: 6, period: 30 }).totp();

    const verified = await call("two-factor/verify-totp", { body: { code: await code() }, cookie });
    expect(verified.status).toBe(200);
    cookie = mergeCookies(cookie, cookieHeader(verified));
    const afterOn = await sessionsOf(u.id);
    expect(afterOn).toHaveLength(1);
    expect(afterOn[0]!.signInMethod).toBe("totp");

    // Next day: password, then the code.
    const again = await call("sign-in/email", { body: { email: u.email, password: PASSWORD } });
    expect(((await again.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
    const twoFactorCookie = cookieHeader(again);
    const done = await call("two-factor/verify-totp", { body: { code: await code(), trustDevice: true }, cookie: twoFactorCookie });
    expect(done.status).toBe(200);
    const made = (await sessionsOf(u.id)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!;
    expect(made.signInMethod).toBe("totp");

    // A device trusted after the code keeps its password session: it counts as the code.
    const trusted = await call("sign-in/email", { body: { email: u.email, password: PASSWORD }, cookie: cookieHeader(done) });
    expect(trusted.status).toBe(200);
    expect(((await trusted.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBeUndefined();
    const latest = (await sessionsOf(u.id)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!;
    expect(latest.signInMethod).toBe("totp");
  });

  test("turning two-factor off remakes the session and keeps how it was made", async () => {
    const u = await makeUser();
    await addPasskey(u.id);
    const res = await call("sign-in/email", { body: { email: u.email, password: PASSWORD } });
    const [row] = await sessionsOf(u.id);
    await env.db.update(session).set({ signInMethod: "passkey" }).where(eq(session.id, row!.id));
    await env.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, u.id));
    const off = await call("two-factor/disable", { body: { password: PASSWORD }, cookie: cookieHeader(res) });
    expect(off.status).toBe(200);
    const after = await sessionsOf(u.id);
    expect(after).toHaveLength(1);
    expect(after[0]!.id).not.toBe(row!.id);
    expect(after[0]!.signInMethod).toBe("passkey");
  });

  test("a passkey added in this session upgrades it to passkey (the secure step lets them in)", async () => {
    const { sessionMethodAfter } = await import("@orrn/auth/session-method");
    const u = await makeUser();
    const res = await call("sign-in/email", { body: { email: u.email, password: PASSWORD } });
    expect(res.status).toBe(200);
    const [row] = await sessionsOf(u.id);
    expect(row?.signInMethod).toBe("password");
    await sessionMethodAfter(
      env.db,
      { path: "/passkey/verify-registration", context: { returned: { id: "pk-1", userId: u.id } } },
      async () => ({ id: row!.id, userId: u.id }),
    );
    expect(await methodOf(row!.id)).toBe("passkey");
    // Another person's passkey never upgrades this session.
    await env.db.update(session).set({ signInMethod: "password" }).where(eq(session.id, row!.id));
    await sessionMethodAfter(
      env.db,
      { path: "/passkey/verify-registration", context: { returned: { id: "pk-2", userId: "someone-else" } } },
      async () => ({ id: row!.id, userId: u.id }),
    );
    expect(await methodOf(row!.id)).toBe("password");
  });
});

describe("the path decides the method", () => {
  test("signInMethodForPath and stampSignInMethod", async () => {
    const { signInMethodForPath, stampSignInMethod, isStrongSession } = await import("@orrn/auth/session-method");
    expect(signInMethodForPath("/passkey/verify-authentication")).toBe("passkey");
    expect(signInMethodForPath("/callback/:id")).toBe("google");
    expect(signInMethodForPath("/sign-in/social")).toBe("google");
    expect(signInMethodForPath("/two-factor/verify-totp")).toBe("totp");
    expect(signInMethodForPath("/two-factor/verify-backup-code")).toBe("totp");
    expect(signInMethodForPath("/two-factor/verify-otp")).toBeNull();
    expect(signInMethodForPath("/sign-in/email")).toBe("password");
    expect(signInMethodForPath("/magic-link/verify")).toBe("magicLink");
    // A remade session keeps what it carried unless the path decides; nothing carried is "other".
    expect(stampSignInMethod({ signInMethod: "google" }, { path: "/two-factor/disable" }).data.signInMethod).toBe("google");
    expect(stampSignInMethod({ signInMethod: "password" }, { path: "/two-factor/verify-totp" }).data.signInMethod).toBe("totp");
    expect(stampSignInMethod({}, { path: "/update-session" }).data.signInMethod).toBe("other");
    expect(stampSignInMethod({ signInMethod: "made-up" }, null).data.signInMethod).toBe("other");
    expect([isStrongSession("passkey"), isStrongSession("google"), isStrongSession("totp")]).toEqual([true, true, true]);
    expect([isStrongSession("password"), isStrongSession("magicLink"), isStrongSession(null)]).toEqual([false, false, false]);
  });
});
