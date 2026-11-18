/**
 * Passkeys (plan 2026-11-18, Task 1). The Better Auth passkey plugin is registered with the web
 * app's host as the relying party (`WEB_PUBLIC_URL`, the value `lib/webUrl.ts` reads), never the
 * API host, and only the web origin (plus an Android APK key hash when one is set) may answer a
 * challenge. A passkey must live on the device (resident key required) so sign-in needs no email.
 * `auth.methods` is public: the sign-in screen asks it whether to offer Google and passkeys.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { account, user } from "@orrn/db/schema";

import { workersEnv } from "./env-mock";
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

const PASSWORD = "passkey-test-password-123";
/** The test stage's web app (`WEB_PUBLIC_URL` in test/env-mock.ts); the API is `api.test`. */
const WEB_HOST = "app.test";

/** A production-shaped environment: https API (so `__Host-` cookies), web app on app.test. */
function productionEnv(): Env {
  return {
    DB: env.d1,
    NODE_ENV: "production",
    CORS_ORIGIN: "https://app.test",
    CORS_ALLOWED_ORIGINS: "https://app.test",
    WEB_PUBLIC_URL: "https://app.test",
    BETTER_AUTH_URL: "https://api.test",
    BETTER_AUTH_SECRET: "passkey-test-secret-0123456789abcdef",
    ORRN_MASTER_KEY: "",
    WEBHOOK_BASE_URL: "",
    CF_API_TOKEN: "",
    CF_ACCOUNT_ID: "",
    CF_ZONE_ID_IN: "",
  } as unknown as Env;
}

async function makeUser() {
  const { hashPassword } = await import("@orrn/auth/password");
  const id = crypto.randomUUID();
  const email = `passkey.${id.slice(0, 8)}@test.orrn`;
  await env.db.insert(user).values({ id, name: "Passkey test", email, emailVerified: true } as never);
  await env.db
    .insert(account)
    .values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(PASSWORD) } as never);
  return { id, email };
}

/** Every Set-Cookie of a response (the Workers `Headers` type here does not declare getSetCookie). */
const setCookies = (res: Response): string[] => (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
/** `name=value; name2=value2` for a Cookie header, from a response's Set-Cookie lines. */
const cookieHeader = (res: Response) => setCookies(res).map((c) => c.slice(0, c.indexOf(";"))).join("; ");

async function authFor(environment?: Env) {
  const { createAuth } = await import("@orrn/auth");
  return environment ? createAuth(environment) : createAuth();
}

/** Signs in through Better Auth's own handler, so the session is a real (fresh) one. */
async function signIn(email: string, environment?: Env) {
  const auth = await authFor(environment);
  const res = await auth.handler(
    new Request("https://api.test/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.test" },
      body: JSON.stringify({ email, password: PASSWORD }),
    }),
  );
  expect(res.status).toBe(200);
  return cookieHeader(res);
}

async function get(path: string, opts: { cookie?: string; environment?: Env } = {}) {
  const auth = await authFor(opts.environment);
  return auth.handler(
    new Request(`https://api.test/api/auth/${path}`, {
      method: "GET",
      headers: { origin: "https://app.test", ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    }),
  );
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/src/migrations");

describe("migration 0050_passkey", () => {
  test("creates the passkey table on a fresh D1", async () => {
    const cols = await env.d1.prepare("select name from pragma_table_info('passkey') order by cid").all<{ name: string }>();
    expect(cols.results.map((c) => c.name)).toEqual([
      "id", "name", "public_key", "user_id", "credential_id", "counter", "device_type", "backed_up", "transports", "created_at", "aaguid",
    ]);
  });

  test("follows 0049 in the journal and chains off its snapshot", () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const entry = journal.entries.find((e) => e.tag === "0050_passkey")!;
    expect(entry.idx).toBe(50);
    expect(entry.when).toBeGreaterThan(journal.entries[49]!.when);
    const s50 = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/0050_snapshot.json"), "utf8")) as { prevId: string };
    const s49 = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/0049_snapshot.json"), "utf8")) as { id: string };
    expect(s50.prevId).toBe(s49.id);
  });
});

describe("passkeyConfigFor", () => {
  test("the relying party is the web host and the web origin", async () => {
    const { passkeyConfigFor } = await import("@orrn/auth/passkey-config");
    expect(passkeyConfigFor("https://orrn.in")).toEqual({ rpID: "orrn.in", rpName: "ORRN", origin: ["https://orrn.in"] });
    expect(passkeyConfigFor("https://dev.orrn.app/")).toEqual({ rpID: "dev.orrn.app", rpName: "ORRN", origin: ["https://dev.orrn.app"] });
  });

  test("an Android APK key hash is a second allowed origin", async () => {
    const { passkeyConfigFor } = await import("@orrn/auth/passkey-config");
    expect(passkeyConfigFor("https://orrn.in", "abc").origin).toEqual(["https://orrn.in", "android:apk-key-hash:abc"]);
    expect(passkeyConfigFor("https://orrn.in", "").origin).toEqual(["https://orrn.in"]);
  });

  test("local dev keeps the port in the origin but not in the rpID", async () => {
    const { passkeyConfigFor } = await import("@orrn/auth/passkey-config");
    expect(passkeyConfigFor("http://localhost:3001").rpID).toBe("localhost");
    expect(passkeyConfigFor("http://localhost:3001").origin).toEqual(["http://localhost:3001"]);
  });

  test("a stage with no usable web URL allows no origin (never the request's own)", async () => {
    const { passkeyConfigForEnv } = await import("@orrn/auth/passkey-config");
    expect(passkeyConfigForEnv({}).origin).toEqual([]);
    expect(passkeyConfigForEnv({ WEB_PUBLIC_URL: "not a url" }).origin).toEqual([]);
    expect(passkeyConfigForEnv({ CORS_ORIGIN: "https://orrn.in" })).toEqual({ rpID: "orrn.in", rpName: "ORRN", origin: ["https://orrn.in"] });
    expect(passkeyConfigForEnv({ WEB_PUBLIC_URL: "https://orrn.in", ANDROID_APK_KEY_HASH: "abc" }).origin).toEqual([
      "https://orrn.in",
      "android:apk-key-hash:abc",
    ]);
  });

  test("a web URL without an http(s) scheme or host is closed", async () => {
    const { passkeyConfigForEnv } = await import("@orrn/auth/passkey-config");
    const closed = { rpID: "localhost", rpName: "ORRN" as const, origin: [] as string[] };
    // `new URL("localhost:3001")` parses (scheme `localhost:`), so the try/catch alone would let it through.
    expect(passkeyConfigForEnv({ WEB_PUBLIC_URL: "localhost:3001" })).toEqual(closed);
    expect(passkeyConfigForEnv({ WEB_PUBLIC_URL: "file:///tmp/x" })).toEqual(closed);
    expect(passkeyConfigForEnv({ CORS_ORIGIN: "javascript:alert(1)" })).toEqual(closed);
    expect(passkeyConfigForEnv({ WEB_PUBLIC_URL: "http://localhost:3001" }).origin).toEqual(["http://localhost:3001"]);
  });
});

describe("passkey endpoints", () => {
  test("passkey registration options need a session", async () => {
    const res = await get("passkey/generate-register-options");
    expect(res.status).toBe(401);
  });

  test("passkey registration options use the stage rpID", async () => {
    const { email } = await makeUser();
    const cookie = await signIn(email);
    const res = await get("passkey/generate-register-options", { cookie });
    expect(res.status).toBe(200);
    const options = (await res.json()) as {
      rp: { id: string; name: string };
      authenticatorSelection: { residentKey: string; userVerification: string };
    };
    // Not the API host (`api.test`), which is the plugin's default.
    expect(options.rp).toEqual({ id: WEB_HOST, name: "ORRN" });
    expect(options.authenticatorSelection.residentKey).toBe("required");
    expect(options.authenticatorSelection.userVerification).toBe("preferred");
  });

  test("passkey sign-in options are public", async () => {
    const res = await get("passkey/generate-authenticate-options");
    expect(res.status).toBe(200);
    const options = (await res.json()) as { challenge?: string; rpId?: string; userVerification?: string };
    expect(typeof options.challenge).toBe("string");
    expect(options.challenge!.length).toBeGreaterThan(10);
    expect(options.rpId).toBe(WEB_HOST);
    expect(options.userVerification).toBe("preferred");
  });

  test("the challenge cookie is host-only with the __Host- prefix on an https API", async () => {
    const res = await get("passkey/generate-authenticate-options", { environment: productionEnv() });
    expect(res.status).toBe(200);
    const challenge = setCookies(res).filter((c) => c.includes("passkey"));
    expect(challenge).toHaveLength(1);
    expect(challenge[0]!.startsWith("__Host-better-auth.")).toBe(true);
    expect(challenge[0]!.toLowerCase()).not.toContain("domain=");
  });

  test("a stored passkey row is read back by the plugin (schema keys match)", async () => {
    const { passkey } = await import("@orrn/db/schema/auth");
    const { id, email } = await makeUser();
    await env.db.insert(passkey).values({
      id: crypto.randomUUID(),
      name: "Test phone",
      publicKey: "cHVibGljLWtleQ",
      userId: id,
      credentialID: "Y3JlZGVudGlhbC1pZA",
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      transports: "internal,hybrid",
      aaguid: "00000000-0000-0000-0000-000000000000",
    });
    const cookie = await signIn(email);
    const res = await get("passkey/list-user-passkeys", { cookie });
    expect(res.status).toBe(200);
    const list = (await res.json()) as { name: string; credentialID: string; userId: string; backedUp: boolean; counter: number }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Test phone", credentialID: "Y3JlZGVudGlhbC1pZA", userId: id, backedUp: true, counter: 0 });
  });
});

describe("auth.methods", () => {
  test("auth.methods without Google secrets", async () => {
    const methods = await env.caller(null).auth.methods();
    expect(methods).toEqual({ google: false, passkey: { rpID: WEB_HOST } });
  });

  test("auth.methods names the same rpID the registration options use", async () => {
    const methods = await env.caller(null).auth.methods();
    const { email } = await makeUser();
    const cookie = await signIn(email);
    const options = (await (await get("passkey/generate-register-options", { cookie })).json()) as { rp: { id: string } };
    expect(methods.passkey.rpID).toBe(options.rp.id);
  });

  test("auth.methods offers Google only when both secrets are set", async () => {
    try {
      workersEnv.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
      expect((await env.caller(null).auth.methods()).google).toBe(false);
      workersEnv.GOOGLE_CLIENT_SECRET = "client-secret";
      expect((await env.caller(null).auth.methods()).google).toBe(true);
    } finally {
      delete workersEnv.GOOGLE_CLIENT_ID;
      delete workersEnv.GOOGLE_CLIENT_SECRET;
    }
  });
});
