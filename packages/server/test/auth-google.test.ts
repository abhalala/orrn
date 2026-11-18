/**
 * Google sign-in (plan 2026-11-18, Task 2; spec Design §3-6). ORRN has no public sign-up, so Google
 * makes an account only for an email with a live invite (any plant, member or portal kind), and then
 * accepts every live invite for that email in the same step through `acceptInvite`, the function
 * `invite.acceptByToken` uses. Godseye staff never sign in with Google. Only verified Google emails
 * count. Google proves the mailbox: an account whose email was never proven loses its password and
 * every other session when Google is linked.
 *
 * No network: the real Google provider runs, and `fetch` answers Google's JWKS and token endpoints
 * from a key made here, so `verifyIdToken` checks a real RS256 signature.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { account, auditLog, membership, passkey, platformAdmin, session, twoFactor, user } from "@orrn/db/schema";
import { invite } from "@orrn/db/schema/tenant";
import { and, eq } from "drizzle-orm";

import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";

const CLIENT_ID = "orrn-test.apps.googleusercontent.com";
const KID = "orrn-test-kid";
const PASSWORD = "google-test-password-123";

let env: TestEnv;
let privateKey: CryptoKey;
let publicJwk: JsonWebKey & { kid: string; alg: string; use: string };
const realFetch = globalThis.fetch;
/** The id token Google's token endpoint hands back in the redirect (callback) flow. */
let nextCallbackIdToken = "";

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const b64json = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

/** A Google-shaped id token, signed with the test key Google's (mocked) JWKS publishes. */
async function idToken(claims: { sub: string; email: string; email_verified?: boolean; name?: string }) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64json({ alg: "RS256", kid: KID, typ: "JWT" });
  const payload = b64json({
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    iat: now,
    exp: now + 3600,
    name: "Google Person",
    email_verified: true,
    ...claims,
  });
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

beforeAll(async () => {
  env = await createTestEnv();
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicJwk = { ...((await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey), kid: KID, alg: "RS256", use: "sig" };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://www.googleapis.com/oauth2/v3/certs")) return Response.json({ keys: [publicJwk] });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return Response.json({ access_token: "test-access", id_token: nextCallbackIdToken, expires_in: 3600, token_type: "Bearer", scope: "openid email profile" });
    }
    if (/googleapis\.com|accounts\.google\.com/.test(url)) throw new Error(`unexpected network call in a test: ${url}`);
    return realFetch(input, init);
  }) as typeof fetch;
  workersEnv.GOOGLE_CLIENT_ID = CLIENT_ID;
  workersEnv.GOOGLE_CLIENT_SECRET = "orrn-test-google-secret";
  // The real wiring: @orrn/server registers invite acceptance with the auth package when it loads.
  await import("../src/context");
  (await import("@orrn/auth")).resetAuthForTests();
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  delete workersEnv.GOOGLE_CLIENT_ID;
  delete workersEnv.GOOGLE_CLIENT_SECRET;
  (await import("@orrn/auth")).resetAuthForTests();
  await env.dispose();
});

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

async function googleSignIn(claims: Parameters<typeof idToken>[0]) {
  return call("sign-in/social", { body: { provider: "google", idToken: { token: await idToken(claims) } } });
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeInvite(email: string, over: Partial<typeof invite.$inferInsert> = {}) {
  const { companyId } = await env.seedCompany();
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  await env.db.insert(invite).values({
    id,
    companyId,
    email: email.toLowerCase(),
    role: "office",
    tokenHash: await sha256Hex(token),
    expiresAt: new Date(Date.now() + 86_400_000),
    ...over,
  });
  return { id, companyId, token };
}

async function makeUser(opts: { emailVerified: boolean; twoFactor?: boolean }) {
  const { hashPassword } = await import("@orrn/auth/password");
  const id = crypto.randomUUID();
  const email = unique("existing");
  await env.db.insert(user).values({ id, name: "Existing", email, emailVerified: opts.emailVerified, twoFactorEnabled: opts.twoFactor ?? false } as never);
  await env.db
    .insert(account)
    .values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(PASSWORD) } as never);
  return { id, email };
}

const userByEmail = (email: string) => env.db.select().from(user).where(eq(user.email, email.toLowerCase())).get();
const accountsOf = (userId: string) => env.db.select().from(account).where(eq(account.userId, userId)).all();

async function codeOf(res: Response) {
  return ((await res.json()) as { code?: string }).code;
}

async function passwordSignIn(email: string, password = PASSWORD) {
  return call("sign-in/email", { body: { email, password } });
}

async function sessionUser(cookie: string) {
  const res = await call("get-session", { method: "GET", cookie });
  return ((await res.json()) as { user?: { id: string } } | null)?.user?.id ?? null;
}

describe("Google creates an account only from a live invite", () => {
  test("google create allowed with a live invite", async () => {
    const email = unique("invited");
    const inv = await makeInvite(email);
    const res = await googleSignIn({ sub: crypto.randomUUID(), email });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token?: string; redirect?: boolean };
    expect(body.token).toBeTruthy();
    const made = await userByEmail(email);
    expect(made?.emailVerified).toBe(true);
    const member = await env.db
      .select()
      .from(membership)
      .where(and(eq(membership.userId, made!.id), eq(membership.companyId, inv.companyId)))
      .get();
    expect(member?.role).toBe("office");
    const row = await env.db.select().from(invite).where(eq(invite.id, inv.id)).get();
    expect(row?.acceptedAt).toBeInstanceOf(Date);
    expect((await accountsOf(made!.id)).map((a) => a.providerId)).toEqual(["google"]);
  });

  test("google create refused without an invite", async () => {
    const email = unique("stranger");
    const res = await googleSignIn({ sub: crypto.randomUUID(), email });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("GOOGLE_NOT_INVITED");
    expect(await userByEmail(email)).toBeUndefined();
  });

  test("google create refused for expired and revoked invites", async () => {
    for (const over of [
      { expiresAt: new Date(Date.now() - 60_000) },
      { revokedAt: new Date(Date.now() - 60_000) },
      { acceptedAt: new Date(Date.now() - 60_000) },
    ]) {
      const email = unique("dead");
      await makeInvite(email, over);
      const res = await googleSignIn({ sub: crypto.randomUUID(), email });
      expect(res.status).toBe(403);
      expect(await codeOf(res)).toBe("GOOGLE_NOT_INVITED");
      expect(await userByEmail(email)).toBeUndefined();
    }
  });

  test("google create accepts every live invite", async () => {
    const email = unique("twoplants");
    const a = await makeInvite(email);
    const b = await makeInvite(email, { role: "supervisor" });
    const res = await googleSignIn({ sub: crypto.randomUUID(), email: email.toUpperCase() });
    expect(res.status).toBe(200);
    const made = await userByEmail(email);
    const members = await env.db.select().from(membership).where(eq(membership.userId, made!.id)).all();
    expect(members.map((m) => m.companyId).sort()).toEqual([a.companyId, b.companyId].sort());
    const audits = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "member.invite.accept"), eq(auditLog.actorId, made!.id)))
      .all();
    expect(audits.map((r) => r.companyId).sort()).toEqual([a.companyId, b.companyId].sort());
  });

  test("an invite that acceptInvite refuses is skipped, the others still accepted", async () => {
    const email = unique("partyclash");
    const good = await makeInvite(email);
    // A portal invite with no `invited` portal row is refused by acceptInvite ("no longer valid").
    const bad = await makeInvite(email, { kind: "portal" });
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    let res: Response;
    let warned: unknown[][];
    try {
      res = await googleSignIn({ sub: crypto.randomUUID(), email });
      warned = [...warn.mock.calls];
    } finally {
      warn.mockRestore();
    }
    // Logged by invite id only, never the address.
    expect(warned).toContainEqual([`Google sign-up: invite ${bad.id} not accepted (BAD_REQUEST)`]);
    expect(warned.flat().join(" ")).not.toContain(email);
    expect(res.status).toBe(200);
    const made = await userByEmail(email);
    const members = await env.db.select().from(membership).where(eq(membership.userId, made!.id)).all();
    expect(members.map((m) => m.companyId)).toEqual([good.companyId]);
    expect((await env.db.select().from(invite).where(eq(invite.id, bad.id)).get())?.acceptedAt).toBeNull();
  });

  test("unverified google email refused", async () => {
    const email = unique("unverified");
    await makeInvite(email);
    const res = await googleSignIn({ sub: crypto.randomUUID(), email, email_verified: false });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("GOOGLE_EMAIL_NOT_VERIFIED");
    expect(await userByEmail(email)).toBeUndefined();

    const existing = await makeUser({ emailVerified: true });
    const again = await googleSignIn({ sub: crypto.randomUUID(), email: existing.email, email_verified: false });
    expect(again.status).toBe(403);
    expect((await accountsOf(existing.id)).map((a) => a.providerId)).toEqual(["credential"]);
  });

  test("an id token not signed by Google is refused", async () => {
    const email = unique("forged");
    await makeInvite(email);
    const good = await idToken({ sub: crypto.randomUUID(), email });
    const [h, p] = good.split(".");
    const res = await call("sign-in/social", { body: { provider: "google", idToken: { token: `${h}.${p}.${b64url(new Uint8Array(256))}` } } });
    expect(res.status).toBe(401);
    expect(await userByEmail(email)).toBeUndefined();
  });
});

describe("Google on an existing account", () => {
  test("google sign-in on account with two-factor needs no code", async () => {
    const existing = await makeUser({ emailVerified: true, twoFactor: true });
    // Control: the password path on the same account does ask for the code.
    const pw = await passwordSignIn(existing.email);
    expect(((await pw.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);

    const res = await googleSignIn({ sub: crypto.randomUUID(), email: existing.email });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token?: string; twoFactorRedirect?: boolean };
    expect(body.twoFactorRedirect).toBeUndefined();
    expect(body.token).toBeTruthy();
    expect(await sessionUser(cookieHeader(res))).toBe(existing.id);
  });

  test("google links to a verified account and keeps the password", async () => {
    const existing = await makeUser({ emailVerified: true });
    const before = await passwordSignIn(existing.email);
    expect(before.status).toBe(200);
    const oldCookie = cookieHeader(before);

    const res = await googleSignIn({ sub: crypto.randomUUID(), email: existing.email });
    expect(res.status).toBe(200);
    const accounts = await accountsOf(existing.id);
    expect(accounts.map((a) => a.providerId).sort()).toEqual(["credential", "google"]);
    expect(accounts.find((a) => a.providerId === "credential")?.password).toBeTruthy();
    expect(await sessionUser(oldCookie)).toBe(existing.id);
    expect((await passwordSignIn(existing.email)).status).toBe(200);
  });

  test("linking Google writes auth.google.link (user-level, no plant, no Google data)", async () => {
    const existing = await makeUser({ emailVerified: true });
    const sub = crypto.randomUUID();
    expect((await googleSignIn({ sub, email: existing.email })).status).toBe(200);
    const rows = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "auth.google.link"), eq(auditLog.actorId, existing.id)))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ companyId: null, subjectType: "user", subjectId: existing.id });
    expect(JSON.stringify(rows[0]!.meta)).not.toContain(sub);
    // A second Google sign-in reuses the link and writes nothing more.
    expect((await googleSignIn({ sub, email: existing.email })).status).toBe(200);
    expect(
      await env.db.select().from(auditLog).where(and(eq(auditLog.action, "auth.google.link"), eq(auditLog.actorId, existing.id))).all(),
    ).toHaveLength(1);
  });

  test("an account made by Google writes auth.google.link too", async () => {
    const email = unique("newlink");
    await makeInvite(email);
    expect((await googleSignIn({ sub: crypto.randomUUID(), email })).status).toBe(200);
    const made = await userByEmail(email);
    const rows = await env.db.select().from(auditLog).where(and(eq(auditLog.action, "auth.google.link"), eq(auditLog.actorId, made!.id))).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.companyId).toBeNull();
  });

  test("google on an unverified account drops the password, passkeys, two-factor and other sessions", async () => {
    const existing = await makeUser({ emailVerified: false });
    await env.db.update(user).set({ mustChangePassword: true }).where(eq(user.id, existing.id));
    // Whoever set the account up may have enrolled their own passkey and authenticator app too.
    await env.db.insert(passkey).values({
      id: crypto.randomUUID(), name: "admin laptop", publicKey: "pk", userId: existing.id, credentialID: crypto.randomUUID(),
      counter: 0, deviceType: "singleDevice", backedUp: false, transports: "internal", createdAt: new Date(),
    } as never);
    await env.db.insert(twoFactor).values({ id: crypto.randomUUID(), secret: "s", backupCodes: "b", userId: existing.id } as never);
    const before = await passwordSignIn(existing.email);
    expect(before.status).toBe(200);
    const oldCookie = cookieHeader(before);
    expect(await sessionUser(oldCookie)).toBe(existing.id);
    // Turned on after that session was made (with it on, the password sign-in would stop at the code).
    await env.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, existing.id));

    const res = await googleSignIn({ sub: crypto.randomUUID(), email: existing.email });
    expect(res.status).toBe(200);
    const googleCookie = cookieHeader(res);

    const accounts = await accountsOf(existing.id);
    expect(accounts.filter((a) => a.providerId === "credential" && a.password)).toEqual([]);
    expect(accounts.map((a) => a.providerId)).toEqual(["google"]);
    expect(await sessionUser(oldCookie)).toBeNull();
    expect(await sessionUser(googleCookie)).toBe(existing.id);
    const row = await userByEmail(existing.email);
    expect(row?.emailVerified).toBe(true);
    // The temporary password is gone, so there is nothing left to change.
    expect(row?.mustChangePassword).toBe(false);
    expect(row?.twoFactorEnabled).toBe(false);
    expect(await env.db.select().from(passkey).where(eq(passkey.userId, existing.id)).all()).toEqual([]);
    expect(await env.db.select().from(twoFactor).where(eq(twoFactor.userId, existing.id)).all()).toEqual([]);
    expect((await passwordSignIn(existing.email)).status).toBe(401);
    expect((await env.db.select().from(session).where(eq(session.userId, existing.id)).all()).length).toBe(1);

    // A new password set later (Settings > Sign-in) works.
    const fresh = "a-brand-new-password-456";
    await (await auth()).api.setPassword({ body: { newPassword: fresh }, headers: new Headers({ cookie: googleCookie }) });
    expect((await passwordSignIn(existing.email, fresh)).status).toBe(200);
  });

  test("google refused for platform staff", async () => {
    const staff = await makeUser({ emailVerified: true });
    await env.db.insert(platformAdmin).values({ userId: staff.id, role: "support" });
    const res = await googleSignIn({ sub: crypto.randomUUID(), email: staff.email });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("GOOGLE_NOT_FOR_STAFF");
    expect((await accountsOf(staff.id)).map((a) => a.providerId)).toEqual(["credential"]);
    expect(setCookies(res).some((c) => c.includes("session_token=") && !c.includes("Max-Age=0"))).toBe(false);
  });

  test("staff whose Google account was linked earlier is refused too", async () => {
    const staff = await makeUser({ emailVerified: true });
    const sub = crypto.randomUUID();
    expect((await googleSignIn({ sub, email: staff.email })).status).toBe(200);
    await env.db.insert(platformAdmin).values({ userId: staff.id, role: "support" });
    const res = await googleSignIn({ sub, email: staff.email });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("GOOGLE_NOT_FOR_STAFF");
  });
});

describe("the invite page after Google sign-up (acceptByToken is idempotent for the holder)", () => {
  async function invitedViaGoogle() {
    const email = unique("invitepage");
    const inv = await makeInvite(email);
    expect((await googleSignIn({ sub: crypto.randomUUID(), email })).status).toBe(200);
    const made = await userByEmail(email);
    return { ...inv, email, userId: made!.id };
  }
  const codeOfCall = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code);

  test("an invite Google already accepted for this account answers success", async () => {
    const { token, userId, companyId } = await invitedViaGoogle();
    await expect(env.callerForUser(userId).invite.acceptByToken({ token })).resolves.toEqual({ success: true });
    const members = await env.db.select().from(membership).where(eq(membership.userId, userId)).all();
    expect(members.map((m) => m.companyId)).toEqual([companyId]);
  });

  test("an accepted invite the account does not hold is refused", async () => {
    const { token, userId, companyId } = await invitedViaGoogle();
    await env.db.delete(membership).where(and(eq(membership.userId, userId), eq(membership.companyId, companyId)));
    expect(await codeOfCall(env.callerForUser(userId).invite.acceptByToken({ token }))).toBe("BAD_REQUEST");
  });

  test("an accepted invite is refused to another account and to nobody", async () => {
    const { token } = await invitedViaGoogle();
    const other = await makeUser({ emailVerified: true });
    expect(await codeOfCall(env.callerForUser(other.id).invite.acceptByToken({ token }))).toBe("BAD_REQUEST");
    expect(await codeOfCall(env.caller(null).invite.acceptByToken({ token }))).toBe("BAD_REQUEST");
  });

  test("a revoked invite is refused even to an account that holds the membership", async () => {
    const { token, id, userId } = await invitedViaGoogle();
    await env.db.update(invite).set({ revokedAt: new Date() }).where(eq(invite.id, id));
    expect(await codeOfCall(env.callerForUser(userId).invite.acceptByToken({ token }))).toBe("BAD_REQUEST");
  });

  test("an expired invite never accepted is still refused", async () => {
    const existing = await makeUser({ emailVerified: true });
    const { token } = await makeInvite(existing.email, { expiresAt: new Date(Date.now() - 60_000) });
    expect(await codeOfCall(env.callerForUser(existing.id).invite.acceptByToken({ token }))).toBe("BAD_REQUEST");
  });
});

describe("the browser redirect flow ends on the web login page", () => {
  async function redirectFlow(claims: Parameters<typeof idToken>[0]) {
    const start = await call("sign-in/social", { body: { provider: "google", callbackURL: "https://app.test/", disableRedirect: true } });
    expect(start.status).toBe(200);
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    nextCallbackIdToken = await idToken(claims);
    return call(`callback/google?code=test-code&state=${encodeURIComponent(state)}`, { method: "GET", cookie: cookieHeader(start) });
  }

  test("not invited: redirected to /login?error=GOOGLE_NOT_INVITED, no user row", async () => {
    const email = unique("redirect-stranger");
    const res = await redirectFlow({ sub: crypto.randomUUID(), email });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.test/login?error=GOOGLE_NOT_INVITED");
    expect(await userByEmail(email)).toBeUndefined();
  });

  test("staff: redirected to /login?error=GOOGLE_NOT_FOR_STAFF, nothing linked", async () => {
    const staff = await makeUser({ emailVerified: true });
    await env.db.insert(platformAdmin).values({ userId: staff.id, role: "support" });
    const res = await redirectFlow({ sub: crypto.randomUUID(), email: staff.email });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.test/login?error=GOOGLE_NOT_FOR_STAFF");
    expect((await accountsOf(staff.id)).map((a) => a.providerId)).toEqual(["credential"]);
  });

  test("invited: account made, invite accepted, back to the callback URL", async () => {
    const email = unique("redirect-invited");
    const inv = await makeInvite(email);
    const res = await redirectFlow({ sub: crypto.randomUUID(), email });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://app.test/");
    const made = await userByEmail(email);
    expect(made?.emailVerified).toBe(true);
    expect((await env.db.select().from(invite).where(eq(invite.id, inv.id)).get())?.acceptedAt).toBeInstanceOf(Date);
  });
});

describe("the phone's redirect flow comes back on the app's deep link", () => {
  /** What the Expo client sends: no Origin, an `expo-origin` the server's expo plugin turns into one. */
  async function nativeCall(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
    return (await auth()).handler(
      new Request(`https://api.test/api/auth/${path}`, {
        method: init.method ?? "POST",
        headers: {
          "expo-origin": "orrn://",
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(init.cookie ? { cookie: init.cookie } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      }),
    );
  }

  /** apps/native/lib/google-flow.ts: one deep link for success and refusal, no redirect from the start call. */
  async function nativeFlow(claims: Parameters<typeof idToken>[0]) {
    const start = await nativeCall("sign-in/social", {
      body: { provider: "google", callbackURL: "orrn:///", errorCallbackURL: "orrn:///", disableRedirect: true },
    });
    expect(start.status).toBe(200);
    const { url, redirect } = (await start.json()) as { url: string; redirect: boolean };
    expect(redirect).toBe(false);
    const state = new URL(url).searchParams.get("state")!;
    nextCallbackIdToken = await idToken(claims);
    return call(`callback/google?code=test-code&state=${encodeURIComponent(state)}`, { method: "GET", cookie: cookieHeader(start) });
  }

  test("not invited: back to orrn:///?error=GOOGLE_NOT_INVITED, no session cookie in the link", async () => {
    const email = unique("native-stranger");
    const res = await nativeFlow({ sub: crypto.randomUUID(), email });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(`${location.protocol}//${location.host}${location.pathname}`).toBe("orrn:///");
    expect(location.searchParams.get("error")).toBe("GOOGLE_NOT_INVITED");
    expect(location.searchParams.get("cookie") ?? "").not.toContain("session_token");
    expect(await userByEmail(email)).toBeUndefined();
  });

  test("staff: back to orrn:///?error=GOOGLE_NOT_FOR_STAFF", async () => {
    const staff = await makeUser({ emailVerified: true });
    await env.db.insert(platformAdmin).values({ userId: staff.id, role: "support" });
    const res = await nativeFlow({ sub: crypto.randomUUID(), email: staff.email });
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("GOOGLE_NOT_FOR_STAFF");
  });

  test("invited: back to orrn:/// with the session cookie for the app to store", async () => {
    const email = unique("native-invited");
    await makeInvite(email);
    const res = await nativeFlow({ sub: crypto.randomUUID(), email });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("error")).toBeNull();
    const cookie = location.searchParams.get("cookie") ?? "";
    expect(cookie).toContain("better-auth.session_token=");
    // The same cookie the app stores and sends back is a live session for the new account.
    const [, name, value] = /((?:__Host-)?better-auth\.session_token)=([^;,\s]+)/.exec(cookie)!;
    const made = await userByEmail(email);
    expect(await sessionUser(`${name}=${value}`)).toBe(made!.id);
  });
});

describe("without Google configured", () => {
  test("the provider is absent and nothing else breaks", async () => {
    const { createAuth } = await import("@orrn/auth");
    const bare = { ...workersEnv, GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined } as unknown as Env;
    const res = await createAuth(bare).handler(
      new Request("https://api.test/api/auth/sign-in/social", {
        method: "POST",
        headers: { origin: "https://app.test", "content-type": "application/json" },
        body: JSON.stringify({ provider: "google", idToken: { token: await idToken({ sub: "x", email: unique("bare") }) } }),
      }),
    );
    expect(res.status).toBe(404);
    const existing = await makeUser({ emailVerified: true });
    const pw = await createAuth(bare).handler(
      new Request("https://api.test/api/auth/sign-in/email", {
        method: "POST",
        headers: { origin: "https://app.test", "content-type": "application/json" },
        body: JSON.stringify({ email: existing.email, password: PASSWORD }),
      }),
    );
    expect(pw.status).toBe(200);
  });
});
