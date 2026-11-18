/**
 * Council round 1, A2 (GPT I1): two removals sent at the same moment must not together break "a way
 * in" or "a strong method in a strict plant". The guard counts before the plugin writes, so removals
 * of one person are serialised: the before-hook takes a short lock row in `auth_throttle`
 * (`signin-lock:<userId>`, 30 s expiry) and the after-hook frees it. A second removal while the first
 * is in flight is refused with `SIGN_IN_CHANGE_BUSY`; once the first is done, the next one counts again.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { account, authThrottle, passkey, user } from "@orrn/db/schema";
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

const PASSWORD = "removal-race-password-123";
const unique = (tag: string) => `${tag}.${crypto.randomUUID().slice(0, 8)}@test.orrn`;
const setCookies = (res: Response): string[] => (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
const cookieHeader = (res: Response) => setCookies(res).map((c) => c.slice(0, c.indexOf(";"))).join("; ");

async function call(path: string, init: { body?: unknown; cookie?: string } = {}) {
  const auth = (await import("@orrn/auth")).createAuth();
  return auth.handler(
    new Request(`https://api.test/api/auth/${path}`, {
      method: "POST",
      headers: {
        origin: "https://app.test",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }),
  );
}

async function makeUser() {
  const { hashPassword } = await import("@orrn/auth/password");
  const id = crypto.randomUUID();
  const email = unique("race");
  await env.db.insert(user).values({ id, name: "Race test", email, emailVerified: true } as never);
  await env.db
    .insert(account)
    .values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(PASSWORD) } as never);
  return { id, email };
}

async function addPasskey(userId: string) {
  const id = crypto.randomUUID();
  await env.db.insert(passkey).values({
    id,
    name: "Phone",
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
  await env.db.insert(account).values({ id: crypto.randomUUID(), accountId: `g-${crypto.randomUUID()}`, providerId: "google", userId } as never);
}

/** A fresh session, then the password removed: passkeys (and Google) are the only ways in. */
async function passwordlessSession() {
  const u = await makeUser();
  const res = await call("sign-in/email", { body: { email: u.email, password: PASSWORD } });
  expect(res.status).toBe(200);
  const cookie = cookieHeader(res);
  await env.db.delete(account).where(eq(account.userId, u.id));
  return { ...u, cookie };
}

async function codeOf(res: Response) {
  try {
    return (JSON.parse(await res.text()) as { code?: string } | null)?.code;
  } catch {
    return undefined;
  }
}

const passkeysOf = (userId: string) => env.db.select().from(passkey).where(eq(passkey.userId, userId)).all();
const lockOf = (userId: string) => env.db.select().from(authThrottle).where(eq(authThrottle.key, `signin-lock:${userId}`)).get();

describe("concurrent removals", () => {
  test("two passkeys deleted at once leave one: at least one delete is refused", async () => {
    const u = await passwordlessSession();
    const a = await addPasskey(u.id);
    const b = await addPasskey(u.id);
    const results = await Promise.all([
      call("passkey/delete-passkey", { body: { id: a }, cookie: u.cookie }),
      call("passkey/delete-passkey", { body: { id: b }, cookie: u.cookie }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).not.toBe(200);
    expect(await passkeysOf(u.id)).toHaveLength(1);
    // The lock is freed once the winner is done.
    expect(await lockOf(u.id)).toBeUndefined();
  });

  test("a passkey delete and a Google unlink at once leave a way in", async () => {
    const u = await passwordlessSession();
    const a = await addPasskey(u.id);
    await addGoogle(u.id);
    const results = await Promise.all([
      call("passkey/delete-passkey", { body: { id: a }, cookie: u.cookie }),
      call("unlink-account", { body: { providerId: "google" }, cookie: u.cookie }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const ways = (await passkeysOf(u.id)).length + (await env.db.select().from(account).where(eq(account.userId, u.id)).all()).length;
    expect(ways).toBe(1);
  });

  test("a removal while another is in flight is refused with SIGN_IN_CHANGE_BUSY and changes nothing", async () => {
    const u = await passwordlessSession();
    const a = await addPasskey(u.id);
    await addPasskey(u.id);
    // The first removal holds the lock (taken by its before-hook, not yet freed by its after-hook).
    await env.db.insert(authThrottle).values({ key: `signin-lock:${u.id}`, windowStart: Date.now(), hits: 1 });
    const res = await call("passkey/delete-passkey", { body: { id: a }, cookie: u.cookie });
    expect(res.status).toBe(409);
    expect(await codeOf(res)).toBe("SIGN_IN_CHANGE_BUSY");
    expect(await passkeysOf(u.id)).toHaveLength(2);
  });

  test("a lock left by a request that died is taken over after 30 seconds", async () => {
    const u = await passwordlessSession();
    const a = await addPasskey(u.id);
    await addPasskey(u.id);
    await env.db.insert(authThrottle).values({ key: `signin-lock:${u.id}`, windowStart: Date.now() - 31_000, hits: 1 });
    const res = await call("passkey/delete-passkey", { body: { id: a }, cookie: u.cookie });
    expect(res.status).toBe(200);
    expect(await passkeysOf(u.id)).toHaveLength(1);
    expect(await lockOf(u.id)).toBeUndefined();
  });

  test("one after the other still works, and a refused removal frees the lock too", async () => {
    const u = await passwordlessSession();
    const a = await addPasskey(u.id);
    const b = await addPasskey(u.id);
    expect((await call("passkey/delete-passkey", { body: { id: a }, cookie: u.cookie })).status).toBe(200);
    const last = await call("passkey/delete-passkey", { body: { id: b }, cookie: u.cookie });
    expect(last.status).toBe(403);
    expect(await codeOf(last)).toBe("LAST_SIGN_IN_METHOD");
    expect(await lockOf(u.id)).toBeUndefined();
    // And the next request is judged on its own (not refused as busy).
    const again = await call("passkey/delete-passkey", { body: { id: b }, cookie: u.cookie });
    expect(await codeOf(again)).toBe("LAST_SIGN_IN_METHOD");
  });

  test("turning the authenticator app off (which swaps the session) frees the lock too", async () => {
    const u = await makeUser();
    await addPasskey(u.id);
    await env.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, u.id));
    // Signed in before two-factor was on, so no code is asked here.
    await env.db.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, u.id));
    const res = await call("sign-in/email", { body: { email: u.email, password: PASSWORD } });
    const cookie = cookieHeader(res);
    await env.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, u.id));
    const off = await call("two-factor/disable", { body: { password: PASSWORD }, cookie });
    expect(off.status).toBe(200);
    expect(await lockOf(u.id)).toBeUndefined();
  });
});
