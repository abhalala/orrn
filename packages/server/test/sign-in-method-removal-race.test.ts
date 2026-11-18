/**
 * Council rounds 1 and 2 (GPT I1): removals sent at the same moment, or one stalled at its write while
 * another runs, must not together break "a way in" or "a strong method in a strict plant". Each removal
 * is one conditional statement that holds both rules against the rows as they are when it runs
 * (packages/auth/src/sign-in-removal.ts); there is no lock any more.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { account, passkey, session, twoFactor, user } from "@orrn/db/schema";
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

  test("a passkey delete answers the endpoint's own body, writes the audit row, and echoes no request header", async () => {
    const u = await passwordlessSession();
    const a = await addPasskey(u.id);
    await addPasskey(u.id);
    const res = await call("passkey/delete-passkey", { body: { id: a }, cookie: u.cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: true });
    expect(res.headers.get("cookie")).toBeNull();
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await passkeysOf(u.id)).toHaveLength(1);
    const { auditLog } = await import("@orrn/db/schema");
    const rows = await env.db.select().from(auditLog).where(eq(auditLog.actorId, u.id)).all();
    expect(rows.filter((r) => r.action === "auth.passkey.remove").map((r) => r.meta)).toEqual([{ passkeyId: a }]);
  });

  test("someone else's passkey, or none, is left to the endpoint's own answer and nothing is deleted", async () => {
    const u = await passwordlessSession();
    await addPasskey(u.id);
    await addPasskey(u.id);
    const other = await makeUser();
    const theirs = await addPasskey(other.id);
    const res = await call("passkey/delete-passkey", { body: { id: theirs }, cookie: u.cookie });
    expect(res.status).not.toBe(200);
    expect(await passkeysOf(other.id)).toHaveLength(1);
    const none = await call("passkey/delete-passkey", { body: { id: crypto.randomUUID() }, cookie: u.cookie });
    expect(none.status).not.toBe(200);
  });

  test("unlinking a provider the account does not have answers ACCOUNT_NOT_FOUND", async () => {
    const u = await passwordlessSession();
    await addPasskey(u.id);
    const res = await call("unlink-account", { body: { providerId: "google" }, cookie: u.cookie });
    expect(res.status).toBe(400);
    expect(await codeOf(res)).toBe("ACCOUNT_NOT_FOUND");
  });

  test("an unlink from a session over a day old is refused SESSION_NOT_FRESH, nothing removed", async () => {
    const u = await passwordlessSession();
    await addPasskey(u.id);
    await addGoogle(u.id);
    await env.db.update(session).set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }).where(eq(session.userId, u.id));
    const res = await call("unlink-account", { body: { providerId: "google" }, cookie: u.cookie });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("SESSION_NOT_FRESH");
    expect((await env.db.select().from(account).where(eq(account.userId, u.id)).all()).length).toBe(1);
  });

  test("one after the other still works, and a refused removal frees the lock too", async () => {
    const u = await passwordlessSession();
    const a = await addPasskey(u.id);
    const b = await addPasskey(u.id);
    expect((await call("passkey/delete-passkey", { body: { id: a }, cookie: u.cookie })).status).toBe(200);
    const last = await call("passkey/delete-passkey", { body: { id: b }, cookie: u.cookie });
    expect(last.status).toBe(403);
    expect(await codeOf(last)).toBe("LAST_SIGN_IN_METHOD");
    // And the next request is judged on its own.
    const again = await call("passkey/delete-passkey", { body: { id: b }, cookie: u.cookie });
    expect(await codeOf(again)).toBe("LAST_SIGN_IN_METHOD");
  });

  test("turning the authenticator app off does what the plugin does: new session carried over, old one gone, row deleted", async () => {
    const u = await makeUser();
    await addPasskey(u.id);
    await env.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, u.id));
    // Signed in before two-factor was on, so no code is asked here.
    await env.db.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, u.id));
    const res = await call("sign-in/email", { body: { email: u.email, password: PASSWORD } });
    const cookie = cookieHeader(res);
    await env.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, u.id));
    await env.db.insert(twoFactor).values({ id: crypto.randomUUID(), secret: "s", backupCodes: "b", userId: u.id } as never);
    const [old] = await env.db.select().from(session).where(eq(session.userId, u.id)).all();
    const wrong = await call("two-factor/disable", { body: { password: "not-the-password" }, cookie });
    expect(wrong.status).toBe(400);
    expect(await codeOf(wrong)).toBe("INVALID_PASSWORD");
    const off = await call("two-factor/disable", { body: { password: PASSWORD }, cookie });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ status: true });
    const sessions = await env.db.select().from(session).where(eq(session.userId, u.id)).all();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).not.toBe(old!.id);
    expect(sessions[0]!.signInMethod).toBe(old!.signInMethod);
    // The new cookie names the new session.
    const fresh = cookieHeader(off);
    expect(fresh).toContain("session_token=");
    const got = await (await import("@orrn/auth")).createAuth().api.getSession({ headers: new Headers({ cookie: fresh }) });
    expect(got?.session.id).toBe(sessions[0]!.id);
    expect((await env.db.select({ on: user.twoFactorEnabled }).from(user).where(eq(user.id, u.id)).get())?.on).toBe(false);
    expect(await env.db.select().from(twoFactor).where(eq(twoFactor.userId, u.id)).all()).toEqual([]);
  });
});

/**
 * Council round 2 (GPT I1): a removal already approved by its checks can stall past any lock. The
 * first request is paused at its actual write (`env.beforeStatement`), the clock moves past the old
 * 30 s lease, the competing removal runs to the end, then the first resumes. The rules must hold at
 * the write itself.
 */
describe("a removal paused at its write while another one runs (council round 2, GPT I1)", () => {
  const PASSKEY_WRITE = /delete from "passkey"/i;
  const ACCOUNT_WRITE = /delete from "account"/i;
  const TWO_FACTOR_WRITE = /update "user" set .*"two_factor_enabled"/i;

  async function interleave(pattern: RegExp, first: () => Promise<Response>, second: () => Promise<Response>) {
    const realNow = Date.now;
    let secondRes: Response | undefined;
    env.beforeStatement(pattern, async () => {
      const t = realNow();
      Date.now = () => t + 31_000;
      secondRes = await second();
    });
    try {
      const firstRes = await first();
      expect(secondRes, "the first request never reached its write").toBeDefined();
      return [firstRes, secondRes!] as const;
    } finally {
      Date.now = realNow;
    }
  }

  async function strictMember(opts: { google?: boolean; authenticator?: boolean } = {}) {
    const u = await makeUser();
    const { companyId } = await env.seedCompany({ settings: { requireStrongSignIn: true } });
    await env.addMembership(u.id, companyId, "packer");
    const res = await call("sign-in/email", { body: { email: u.email, password: PASSWORD } });
    expect(res.status).toBe(200);
    const pk = await addPasskey(u.id);
    if (opts.google) await addGoogle(u.id);
    if (opts.authenticator) {
      await env.db.insert(twoFactor).values({ id: crypto.randomUUID(), secret: "s", backupCodes: "b", userId: u.id } as never);
      await env.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, u.id));
    }
    return { ...u, cookie: cookieHeader(res), passkeyId: pk };
  }

  const googleRows = (userId: string) =>
    env.db.select().from(account).where(eq(account.userId, userId)).all().then((rows) => rows.filter((r) => r.providerId === "google"));
  const authenticatorOn = async (userId: string) =>
    (await env.db.select({ on: user.twoFactorEnabled }).from(user).where(eq(user.id, userId)).get())?.on === true;

  test("no way in: two passkey deletes, the first paused at its delete", async () => {
    const u = await passwordlessSession();
    const a = await addPasskey(u.id);
    const b = await addPasskey(u.id);
    const [first, second] = await interleave(
      PASSKEY_WRITE,
      () => call("passkey/delete-passkey", { body: { id: a }, cookie: u.cookie }),
      () => call("passkey/delete-passkey", { body: { id: b }, cookie: u.cookie }),
    );
    expect(second.status).toBe(200);
    expect(first.status).toBe(403);
    expect(await codeOf(first)).toBe("LAST_SIGN_IN_METHOD");
    expect(await passkeysOf(u.id)).toHaveLength(1);
  });

  test("no way in: a passkey delete paused while Google is unlinked", async () => {
    const u = await passwordlessSession();
    const a = await addPasskey(u.id);
    await addGoogle(u.id);
    const [first, second] = await interleave(
      PASSKEY_WRITE,
      () => call("passkey/delete-passkey", { body: { id: a }, cookie: u.cookie }),
      () => call("unlink-account", { body: { providerId: "google" }, cookie: u.cookie }),
    );
    expect(second.status).toBe(200);
    expect(await codeOf(first)).toBe("LAST_SIGN_IN_METHOD");
    expect(await passkeysOf(u.id)).toHaveLength(1);
  });

  test("no way in: a Google unlink paused while the passkey is deleted", async () => {
    const u = await passwordlessSession();
    const a = await addPasskey(u.id);
    await addGoogle(u.id);
    const [first, second] = await interleave(
      ACCOUNT_WRITE,
      () => call("unlink-account", { body: { providerId: "google" }, cookie: u.cookie }),
      () => call("passkey/delete-passkey", { body: { id: a }, cookie: u.cookie }),
    );
    expect(second.status).toBe(200);
    expect(await codeOf(first)).toBe("LAST_SIGN_IN_METHOD");
    expect(await googleRows(u.id)).toHaveLength(1);
  });

  test("strict plant: a passkey delete paused while Google is unlinked keeps a strong method", async () => {
    const u = await strictMember({ google: true });
    const [first, second] = await interleave(
      PASSKEY_WRITE,
      () => call("passkey/delete-passkey", { body: { id: u.passkeyId }, cookie: u.cookie }),
      () => call("unlink-account", { body: { providerId: "google" }, cookie: u.cookie }),
    );
    expect(second.status).toBe(200);
    expect(await codeOf(first)).toBe("COMPANY_REQUIRES_STRONG_METHOD");
    expect(await passkeysOf(u.id)).toHaveLength(1);
  });

  test("strict plant: turning the authenticator off, paused at its write, while the passkey is deleted", async () => {
    const u = await strictMember({ authenticator: true });
    const [first, second] = await interleave(
      TWO_FACTOR_WRITE,
      () => call("two-factor/disable", { body: { password: PASSWORD }, cookie: u.cookie }),
      () => call("passkey/delete-passkey", { body: { id: u.passkeyId }, cookie: u.cookie }),
    );
    expect(second.status).toBe(200);
    expect(await codeOf(first)).toBe("COMPANY_REQUIRES_STRONG_METHOD");
    expect(await authenticatorOn(u.id)).toBe(true);
  });

  test("strict plant: a passkey delete paused while the authenticator is turned off", async () => {
    const u = await strictMember({ authenticator: true });
    const [first, second] = await interleave(
      PASSKEY_WRITE,
      () => call("passkey/delete-passkey", { body: { id: u.passkeyId }, cookie: u.cookie }),
      () => call("two-factor/disable", { body: { password: PASSWORD }, cookie: u.cookie }),
    );
    expect(second.status).toBe(200);
    expect(await codeOf(first)).toBe("COMPANY_REQUIRES_STRONG_METHOD");
    expect(await passkeysOf(u.id)).toHaveLength(1);
  });

  test("strict plant: a Google unlink paused while the authenticator is turned off", async () => {
    const u = await strictMember({ google: true, authenticator: true });
    await env.db.delete(passkey).where(eq(passkey.userId, u.id));
    const [first, second] = await interleave(
      ACCOUNT_WRITE,
      () => call("unlink-account", { body: { providerId: "google" }, cookie: u.cookie }),
      () => call("two-factor/disable", { body: { password: PASSWORD }, cookie: u.cookie }),
    );
    expect(second.status).toBe(200);
    expect(await codeOf(first)).toBe("COMPANY_REQUIRES_STRONG_METHOD");
    expect(await googleRows(u.id)).toHaveLength(1);
  });
});
