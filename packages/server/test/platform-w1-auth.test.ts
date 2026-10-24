/**
 * FP-PF-08 second factor stays TOTP (C27): a magic link never signs in an account that has a
 * password or an authenticator, whichever path issued it (the public `/sign-in/magic-link`
 * endpoint or a stale Godseye link). A magic-link-only account (waitlist owner before the
 * password step) still signs in. Nothing else about TOTP is weakened: no IP/CIDR fields, no
 * email OTP plugin.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { account, session, user, verification } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
type AuthModule = typeof import("@orrn/auth");
let auth: ReturnType<AuthModule["createAuth"]>;

beforeAll(async () => {
  env = await createTestEnv();
  const mod = await import("@orrn/auth");
  // Another test file may have built the singleton against its own (now disposed) D1.
  mod.resetAuthForTests();
  auth = mod.createAuth();
});

afterAll(async () => {
  (await import("@orrn/auth")).resetAuthForTests();
  await env.dispose();
});

async function makeUser(opts: { password: boolean; twoFactor: boolean }) {
  const id = crypto.randomUUID();
  const email = `link.${id.slice(0, 8)}@test.orrn`;
  await env.db.insert(user).values({ id, name: "Link test", email, emailVerified: true, twoFactorEnabled: opts.twoFactor } as never);
  if (opts.password) {
    await env.db.insert(account).values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: "hashed" } as never);
  }
  return { id, email };
}

/** SHA-256, base64url without padding: Better Auth's magic-link `storeToken: "hashed"` form. */
async function hashToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Buffer.from(digest).toString("base64url");
}

/**
 * Issue a link the way Godseye does (routers/platform/waitlist.ts): a `verification` row written
 * server-side. `hashed` stores the token the way `storeToken: "hashed"` would.
 */
async function issueLink(email: string, opts: { hashed?: boolean } = {}): Promise<{ token: string; identifier: string }> {
  const token = `tok${crypto.randomUUID().replace(/-/g, "")}`;
  const identifier = opts.hashed ? await hashToken(token) : token;
  await env.db.insert(verification).values({
    id: crypto.randomUUID(),
    identifier,
    value: JSON.stringify({ email, attempt: 0 }),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  } as never);
  return { token, identifier };
}

const verificationRows = async (identifier: string) =>
  (await env.db.select().from(verification).where(eq(verification.identifier, identifier))).length;

async function verify(token: string, instance: ReturnType<AuthModule["createAuth"]> = auth) {
  return instance.handler(
    new Request(`https://api.test/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`, {
      method: "GET",
      headers: { origin: "https://app.test" },
    }),
  );
}

const sessionsOf = async (userId: string) => (await env.db.select().from(session).where(eq(session.userId, userId))).length;

describe("magic links cannot stand in for the second factor (FP-PF-08)", () => {
  for (const kind of [
    { label: "password + authenticator", password: true, twoFactor: true },
    { label: "password only", password: true, twoFactor: false },
    { label: "authenticator only", password: false, twoFactor: true },
  ]) {
    test(`${kind.label}: a link is refused at verify, no session, token gone`, async () => {
      const u = await makeUser(kind);
      const { token, identifier } = await issueLink(u.email);
      const res = await verify(token);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain("password and authenticator code");
      expect(await sessionsOf(u.id)).toBe(0);
      expect(await verificationRows(identifier)).toBe(0);
    });
  }

  test("a magic-link-only account (no password, no 2FA yet) still signs in by link", async () => {
    const u = await makeUser({ password: false, twoFactor: false });
    const { token } = await issueLink(u.email);
    const res = await verify(token);
    expect(res.status).toBe(200);
    expect(await sessionsOf(u.id)).toBe(1);
  });

  test("a link issued before the owner set a password stops working once the password exists", async () => {
    const u = await makeUser({ password: false, twoFactor: false });
    const { token } = await issueLink(u.email);
    await env.db.insert(account).values({ id: crypto.randomUUID(), accountId: u.id, providerId: "credential", userId: u.id, password: "hashed" } as never);
    const res = await verify(token);
    expect(res.status).toBe(403);
    expect(await sessionsOf(u.id)).toBe(0);
  });

  test("D14: a link for an email with no account creates no user and no session", async () => {
    const email = `nobody.${crypto.randomUUID().slice(0, 8)}@test.orrn`;
    const sessionsBefore = (await env.db.select().from(session)).length;
    const { token } = await issueLink(email);
    const res = await verify(token);
    expect(res.status).not.toBe(200);
    expect(await env.db.select().from(user).where(eq(user.email, email))).toHaveLength(0);
    expect((await env.db.select().from(session)).length).toBe(sessionsBefore);
  });

  test("D14: the public POST /sign-in/magic-link is refused; no token is stored and no mail is sent", async () => {
    for (const email of [
      `nobody.${crypto.randomUUID().slice(0, 8)}@test.orrn`,
      (await makeUser({ password: false, twoFactor: false })).email,
      (await makeUser({ password: true, twoFactor: true })).email,
    ]) {
      const log = spyOn(console, "log").mockImplementation(() => {});
      let res: Response;
      try {
        res = await auth.handler(
          new Request("https://api.test/api/auth/sign-in/magic-link", {
            method: "POST",
            headers: { "content-type": "application/json", origin: "https://app.test" },
            body: JSON.stringify({ email, callbackURL: "/" }),
          }),
        );
        expect(log.mock.calls.flat().join(" ")).not.toContain("Mock Auth Email");
      } finally {
        log.mockRestore();
      }
      expect(res.status).toBe(403);
      const rows = (await env.db.select().from(verification)).filter((r) => r.value.includes(email));
      expect(rows).toHaveLength(0);
      expect(await env.db.select().from(user).where(eq(user.email, email))).toHaveLength(email.startsWith("nobody.") ? 0 : 1);
    }
  });

  describe('token stored hashed (storeToken: "hashed"): the guard finds it the same way the plugin does', () => {
    let hashedAuth: ReturnType<AuthModule["createAuth"]>;
    beforeAll(async () => {
      hashedAuth = (await import("@orrn/auth")).buildAuthForTests({ magicLinkStoreToken: "hashed" });
    });

    test("password + authenticator: refused at verify, no session, hashed row gone", async () => {
      const u = await makeUser({ password: true, twoFactor: true });
      const { token, identifier } = await issueLink(u.email, { hashed: true });
      expect(identifier).not.toBe(token);
      const res = await verify(token, hashedAuth);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain("password and authenticator code");
      expect(await sessionsOf(u.id)).toBe(0);
      expect(await verificationRows(identifier)).toBe(0);
    });

    test("magic-link-only account still signs in with a hashed token", async () => {
      const u = await makeUser({ password: false, twoFactor: false });
      const { token } = await issueLink(u.email, { hashed: true });
      const res = await verify(token, hashedAuth);
      expect(res.status).toBe(200);
      expect(await sessionsOf(u.id)).toBe(1);
    });

    test("plain storage: a password user's plain-stored token is refused too", async () => {
      const u = await makeUser({ password: true, twoFactor: false });
      const { token, identifier } = await issueLink(u.email);
      expect(identifier).toBe(token);
      const res = await verify(token);
      expect(res.status).toBe(403);
      expect(await verificationRows(identifier)).toBe(0);
    });
  });

  test("nothing weakened: twoFactor plugin on, no email OTP plugin, no IP / CIDR bypass in auth or settings", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const authSrc = readFileSync(join(here, "../../auth/src/index.ts"), "utf8");
    expect(authSrc).toContain("twoFactor()");
    expect(authSrc).toContain("magicLinkSecondFactorGuard(db)");
    expect(authSrc).toContain("disableSignUp: true");
    expect(authSrc).not.toContain("custom-hasher");
    expect(authSrc).not.toMatch(/emailOTP|ipAddress.*skip|cidr|trustedIp/i);
    const companySrc = readFileSync(join(here, "../src/routers/company.ts"), "utf8");
    expect(companySrc).not.toMatch(/cidr|ipAllow|gatewayKey|skipTwoFactor/i);
  });
});
