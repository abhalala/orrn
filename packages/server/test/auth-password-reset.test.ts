/**
 * Forgot password (backlog 9). `/request-password-reset` gives the same neutral answer whether or
 * not the address has an account; a reset link works once, for an hour; it revokes the account's
 * sessions; the authenticator code is not touched; and the email body (a live reset link) is
 * printed only on a development stack.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";

import { account, session, user, verification } from "@orrn/db/schema";
import { eq, like } from "drizzle-orm";

import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
type AuthModule = typeof import("@orrn/auth");
let auth: ReturnType<AuthModule["createAuth"]>;

beforeAll(async () => {
  env = await createTestEnv();
  const mod = await import("@orrn/auth");
  mod.resetAuthForTests();
  auth = mod.createAuth();
});

afterAll(async () => {
  (await import("@orrn/auth")).resetAuthForTests();
  await env.dispose();
});

const OLD_PASSWORD = "old-password-123";
const NEW_PASSWORD = "brand-new-password-456";

async function makeUser(opts: { twoFactor?: boolean; password?: boolean } = {}) {
  const { hashPassword } = await import("@orrn/auth/password");
  const id = crypto.randomUUID();
  const email = `reset.${id.slice(0, 8)}@test.orrn`;
  await env.db.insert(user).values({ id, name: "Reset test", email, emailVerified: true, twoFactorEnabled: opts.twoFactor ?? false } as never);
  if (opts.password !== false) {
    await env.db
      .insert(account)
      .values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword(OLD_PASSWORD) } as never);
  }
  return { id, email };
}

const post = (path: string, body: unknown) =>
  auth.handler(
    new Request(`https://api.test/api/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.test" },
      body: JSON.stringify(body),
    }),
  );

async function request(email: string) {
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const res = await post("request-password-reset", { email, redirectTo: "https://app.test/reset-password" });
    return { res, logged: log.mock.calls.map((a) => a.map(String).join(" ")).join("\n") };
  } finally {
    log.mockRestore();
  }
}

const resetTokens = async () =>
  (await env.db.select().from(verification).where(like(verification.identifier, "reset-password:%"))).map((r) => ({
    token: r.identifier.slice("reset-password:".length),
    userId: r.value,
  }));

describe("forgot password", () => {
  test("an address with and without an account get the same neutral answer", async () => {
    const real = await makeUser();
    const a = await request(real.email);
    const b = await request(`nobody.${crypto.randomUUID().slice(0, 8)}@test.orrn`);
    expect(a.res.status).toBe(200);
    expect(b.res.status).toBe(200);
    expect(await a.res.json()).toEqual(await b.res.json());
  });

  test("only a real account gets a reset token, and the email body is not logged outside development", async () => {
    workersEnv.NODE_ENV = "production";
    delete workersEnv.RESEND_API_KEY;
    const before = (await resetTokens()).length;
    const stranger = await request(`ghost.${crypto.randomUUID().slice(0, 8)}@test.orrn`);
    expect((await resetTokens()).length).toBe(before);
    expect(stranger.logged).not.toContain("reset-password");

    const real = await makeUser();
    const { res, logged } = await request(real.email);
    expect(res.status).toBe(200);
    const mine = (await resetTokens()).filter((t) => t.userId === real.id);
    expect(mine).toHaveLength(1);
    // The link is a credential: never in the log on this stack, nor the address.
    expect(logged).not.toContain(mine[0]!.token);
    expect(logged).not.toContain("reset-password");
    expect(logged).not.toContain(real.email);
    expect(logged).toContain("Reset your ORRN password");
  });

  test("the link sets a new password once, ends old sessions, and the old password stops working", async () => {
    const u = await makeUser();
    await env.db.insert(session).values({
      id: crypto.randomUUID(),
      userId: u.id,
      token: crypto.randomUUID(),
      expiresAt: new Date(Date.now() + 3_600_000),
    } as never);
    await request(u.email);
    const token = (await resetTokens()).find((t) => t.userId === u.id)!.token;

    const done = await post("reset-password", { newPassword: NEW_PASSWORD, token });
    expect(done.status).toBe(200);
    expect((await env.db.select().from(session).where(eq(session.userId, u.id))).length).toBe(0);

    const oldLogin = await post("sign-in/email", { email: u.email, password: OLD_PASSWORD });
    expect(oldLogin.status).not.toBe(200);
    const newLogin = await post("sign-in/email", { email: u.email, password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);

    const again = await post("reset-password", { newPassword: "another-password-789", token });
    expect(again.status).toBe(400);
  });

  test("a token that never existed, or has expired, is refused", async () => {
    const u = await makeUser();
    expect((await post("reset-password", { newPassword: NEW_PASSWORD, token: "nope" })).status).toBe(400);
    await request(u.email);
    const token = (await resetTokens()).find((t) => t.userId === u.id)!.token;
    await env.db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, `reset-password:${token}`));
    expect((await post("reset-password", { newPassword: NEW_PASSWORD, token })).status).toBe(400);
  });

  test("a short new password is refused and the token stays usable", async () => {
    const u = await makeUser();
    await request(u.email);
    const token = (await resetTokens()).find((t) => t.userId === u.id)!.token;
    expect((await post("reset-password", { newPassword: "short", token })).status).toBe(400);
    expect((await post("reset-password", { newPassword: NEW_PASSWORD, token })).status).toBe(200);
  });

  test("an account with an authenticator keeps it: the reset does not sign in or switch two-factor off", async () => {
    const u = await makeUser({ twoFactor: true });
    await request(u.email);
    const token = (await resetTokens()).find((t) => t.userId === u.id)!.token;
    expect((await post("reset-password", { newPassword: NEW_PASSWORD, token })).status).toBe(200);
    expect((await env.db.select().from(session).where(eq(session.userId, u.id))).length).toBe(0);
    const row = await env.db.query.user.findFirst({ where: eq(user.id, u.id) });
    expect(row?.twoFactorEnabled).toBe(true);
    // The next sign-in still asks for the code (twoFactorRedirect), it does not open a session.
    const login = await post("sign-in/email", { email: u.email, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    expect(((await login.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
  });
});
