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

/** Ask the PUBLIC endpoint for a link, then read the token the plugin stored. */
async function requestLink(email: string): Promise<string> {
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const res = await auth.handler(
      new Request("https://api.test/api/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.test" },
        body: JSON.stringify({ email }),
      }),
    );
    expect(res.status).toBe(200);
  } finally {
    log.mockRestore();
  }
  const rows = await env.db.select().from(verification);
  const row = rows.find((r) => {
    try {
      return (JSON.parse(r.value) as { email?: string }).email === email;
    } catch {
      return false;
    }
  });
  expect(row).toBeDefined();
  return row!.identifier;
}

async function verify(token: string) {
  return auth.handler(
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
    test(`${kind.label}: the public link is refused at verify, no session, token gone`, async () => {
      const u = await makeUser(kind);
      const token = await requestLink(u.email);
      const res = await verify(token);
      expect(res.status).toBe(403);
      expect(await res.text()).toContain("password and authenticator code");
      expect(await sessionsOf(u.id)).toBe(0);
      expect((await env.db.select().from(verification).where(eq(verification.identifier, token))).length).toBe(0);
    });
  }

  test("a magic-link-only account (no password, no 2FA yet) still signs in by link", async () => {
    const u = await makeUser({ password: false, twoFactor: false });
    const token = await requestLink(u.email);
    const res = await verify(token);
    expect(res.status).toBe(200);
    expect(await sessionsOf(u.id)).toBe(1);
  });

  test("a link issued before the owner set a password stops working once the password exists", async () => {
    const u = await makeUser({ password: false, twoFactor: false });
    const token = await requestLink(u.email);
    await env.db.insert(account).values({ id: crypto.randomUUID(), accountId: u.id, providerId: "credential", userId: u.id, password: "hashed" } as never);
    const res = await verify(token);
    expect(res.status).toBe(403);
    expect(await sessionsOf(u.id)).toBe(0);
  });

  test("nothing weakened: twoFactor plugin on, no email OTP plugin, no IP / CIDR bypass in auth or settings", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const authSrc = readFileSync(join(here, "../../auth/src/index.ts"), "utf8");
    expect(authSrc).toContain("twoFactor()");
    expect(authSrc).toContain("magicLinkSecondFactorGuard(db)");
    expect(authSrc).not.toMatch(/emailOTP|ipAddress.*skip|cidr|trustedIp/i);
    const companySrc = readFileSync(join(here, "../src/routers/company.ts"), "utf8");
    expect(companySrc).not.toMatch(/cidr|ipAllow|gatewayKey|skipTwoFactor/i);
  });
});
