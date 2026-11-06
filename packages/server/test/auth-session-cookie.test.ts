/**
 * Security review 2026-11-04, CRITICAL 1: the session cookie was `Domain=.orrn.in`, so every
 * `*.orrn.in` host (plant-run `*.spool.orrn.in` tunnels included) received every visitor's session.
 * The cookie is now host-only on the API host and, on an https API, carries the `__Host-` prefix
 * (a browser refuses a `__Host-` cookie that names a Domain, so no subdomain can set or toss one).
 * Old `__Secure-better-auth.*` cookies are cleared on the next visit and their sessions ended.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { account, session, user } from "@orrn/db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

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

const PASSWORD = "cookie-test-password-123";

/** A production-shaped environment, still carrying the old cookie domain the deploy used to bind. */
function productionEnv(): Env {
  return {
    DB: env.d1,
    NODE_ENV: "production",
    CORS_ORIGIN: "https://app.test",
    CORS_ALLOWED_ORIGINS: "https://app.test",
    WEB_PUBLIC_URL: "https://app.test",
    BETTER_AUTH_URL: "https://api.test",
    BETTER_AUTH_SECRET: "session-cookie-test-secret-0123456789",
    ORRN_MASTER_KEY: "",
    WEBHOOK_BASE_URL: "",
    CF_API_TOKEN: "",
    CF_ACCOUNT_ID: "",
    CF_ZONE_ID_IN: "",
    // Both names: the old binding and the clean-up one. Neither may reach the session cookie.
    COOKIE_DOMAIN: ".orrn.in",
    LEGACY_COOKIE_DOMAIN: ".orrn.in",
  } as unknown as Env;
}

async function makeUser() {
  const { hashPassword } = await import("@orrn/auth/password");
  const id = crypto.randomUUID();
  const email = `cookie.${id.slice(0, 8)}@test.orrn`;
  await env.db.insert(user).values({ id, name: "Cookie test", email, emailVerified: true } as never);
  await env.db
    .insert(account)
    .values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(PASSWORD) } as never);
  return { id, email };
}

async function signIn(environment: Env, email: string) {
  const { createAuth } = await import("@orrn/auth");
  return createAuth(environment).handler(
    new Request("https://api.test/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.test" },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
}

const cookieName = (setCookie: string) => setCookie.slice(0, setCookie.indexOf("="));
/** Every Set-Cookie of a response (the Workers `Headers` type here does not declare getSetCookie). */
const setCookies = (res: Response): string[] => (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();

describe("session cookie scope (CRITICAL 1)", () => {
  test("on an https API every auth cookie is host-only, Secure, Path=/ and named __Host-", async () => {
    const { email } = await makeUser();
    const res = await signIn(productionEnv(), email);
    expect(res.status).toBe(200);
    const cookies = setCookies(res);
    expect(cookies.map(cookieName)).toContain("__Host-better-auth.session_token");
    for (const cookie of cookies) {
      expect(cookieName(cookie).startsWith("__Host-")).toBe(true);
      expect(cookie.toLowerCase()).not.toContain("domain=");
      expect(cookie).toMatch(/;\s*Secure/i);
      expect(cookie).toMatch(/;\s*Path=\/(;|$)/i);
    }
  });

  test("the new cookie signs the browser in: the API reads the session it set", async () => {
    const { email, id } = await makeUser();
    const environment = productionEnv();
    const res = await signIn(environment, email);
    const pair = setCookies(res).find((c) => c.startsWith("__Host-better-auth.session_token="))!.split(";")[0]!;
    const { createAuth } = await import("@orrn/auth");
    const got = await createAuth(environment).api.getSession({ headers: new Headers({ cookie: pair }) });
    expect(got?.user.id).toBe(id);
  });

  test("a local http API keeps the plain names (no prefix a browser would refuse on http)", async () => {
    const { email } = await makeUser();
    const res = await signIn({ ...productionEnv(), NODE_ENV: "development", BETTER_AUTH_URL: "http://localhost:3000" } as Env, email);
    expect(res.status).toBe(200);
    const names = setCookies(res).map(cookieName);
    expect(names).toContain("better-auth.session_token");
    for (const cookie of setCookies(res)) expect(cookie.toLowerCase()).not.toContain("domain=");
  });
});

describe("old Domain=.orrn.in cookies (deploy clean-up)", () => {
  async function legacyApp(legacyDomain: string | undefined) {
    const { legacyCookieCleanup } = await import("../src/lib/legacyCookies");
    const app = new Hono();
    app.use("*", legacyCookieCleanup({ legacyDomain: () => legacyDomain, db: () => env.db }));
    app.get("/", (c) => c.text("OK"));
    return app;
  }

  async function legacySession(userId: string) {
    const token = `legacy${crypto.randomUUID().replaceAll("-", "")}`.slice(0, 32);
    const id = crypto.randomUUID();
    const now = new Date();
    await env.db
      .insert(session)
      .values({ id, token, userId, expiresAt: new Date(now.getTime() + 86_400_000), createdAt: now, updatedAt: now } as never);
    return { id, token };
  }

  test("a request carrying the old session cookie gets it cleared on both scopes and its session ended", async () => {
    const { id: userId } = await makeUser();
    const old = await legacySession(userId);
    const app = await legacyApp(".orrn.in");
    const res = await app.request("/", {
      headers: { cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${old.token}.c2lnbmF0dXJl`)}; __Secure-better-auth.session_data=x; other=1` },
    });
    expect(res.status).toBe(200);
    const cleared = setCookies(res);
    for (const name of ["__Secure-better-auth.session_token", "__Secure-better-auth.session_data"]) {
      const forName = cleared.filter((c) => cookieName(c) === name);
      expect(forName).toHaveLength(2); // host-only and the old parent domain
      for (const c of forName) {
        expect(c).toMatch(/Max-Age=0/i);
        expect(c).toMatch(/;\s*Secure/i);
        expect(c).toMatch(/;\s*Path=\//i);
      }
      expect(forName.some((c) => /Domain=\.orrn\.in/i.test(c))).toBe(true);
    }
    expect(cleared.some((c) => cookieName(c) === "other")).toBe(false);
    expect(await env.db.select().from(session).where(eq(session.id, old.id))).toHaveLength(0);
  });

  test("no legacy cookie: no Set-Cookie and no session touched", async () => {
    const { id: userId } = await makeUser();
    const live = await legacySession(userId);
    const app = await legacyApp(".orrn.in");
    const res = await app.request("/", { headers: { cookie: `__Host-better-auth.session_token=${live.token}.sig; other=1` } });
    expect(setCookies(res)).toEqual([]);
    expect(await env.db.select().from(session).where(eq(session.id, live.id))).toHaveLength(1);
  });

  test("without a legacy domain only the host-only copy is cleared", async () => {
    const app = await legacyApp(undefined);
    const res = await app.request("/", { headers: { cookie: "__Secure-better-auth.dont_remember=x" } });
    const cleared = setCookies(res);
    expect(cleared).toHaveLength(1);
    expect(cleared[0]!.toLowerCase()).not.toContain("domain=");
  });
});

describe("migration 0046 ends every session once", () => {
  const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/src/migrations");

  test("it follows 0045, changes no schema, and deletes only session rows", () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const e45 = journal.entries.find((e) => e.tag === "0045_printer_discovery")!;
    const e46 = journal.entries.find((e) => e.tag === "0046_revoke_sessions_cookie_scope")!;
    expect(e46.idx).toBe(e45.idx + 1);
    expect(e46.when).toBeGreaterThan(e45.when);
    const s45 = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/0045_snapshot.json"), "utf8")) as Record<string, unknown>;
    const s46 = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/0046_snapshot.json"), "utf8")) as Record<string, unknown>;
    expect(s46.prevId).toBe(s45.id);
    const { id: _a, prevId: _b, ...schema45 } = s45;
    const { id: _c, prevId: _d, ...schema46 } = s46;
    expect(schema46).toEqual(schema45);

    const sqlText = readFileSync(join(MIGRATIONS_DIR, "0046_revoke_sessions_cookie_scope.sql"), "utf8");
    const statements = sqlText
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split("--> statement-breakpoint")
      .map((st) => st.trim())
      .filter(Boolean);
    expect(statements).toEqual(["DELETE FROM `session`;"]);
  });
});
