/**
 * Onboarding repair (plan 2026-11-18, Task 8). Prod evidence: an account made by a magic-link approval
 * has no password, so the invite page's "Create account" (account exists) and "Sign in" (no credential)
 * were both dead ends, and an inviter could not resend or copy a pending invite's link.
 *
 * - `invite.status` (public, throttled per IP) tells the invite page which way in to offer, without the
 *   email, the company, the role or the account's methods.
 * - `invite.sendSetPasswordLink` emails a reset link that returns to the invite, only when the typed
 *   email is the invite's, and answers the same either way.
 * - `invite.resend` rotates the token, gives a fresh week and sends the invite email again.
 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, spyOn, test } from "bun:test";

import { account, auditLog, authThrottle, company, customerPortalUser, invite, passkey, user, verification } from "@orrn/db/schema";
import { and, eq, like } from "drizzle-orm";

import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
type AppRouter = typeof import("../src/routers/index").appRouter;
let appRouter: AppRouter;

beforeAll(async () => {
  env = await createTestEnv();
  appRouter = (await import("../src/routers/index")).appRouter;
  (await import("@orrn/auth")).resetAuthForTests();
}, 60_000);

afterAll(async () => {
  (await import("@orrn/auth")).resetAuthForTests();
  await env.dispose();
});

const saved: Record<string, unknown> = {};
function useEnv(values: Record<string, unknown>) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in saved)) saved[k] = workersEnv[k];
    workersEnv[k] = v;
  }
}
afterEach(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete workersEnv[k];
    else workersEnv[k] = v;
    delete saved[k];
  }
  (await import("@orrn/auth")).resetAuthForTests();
});

const uid = () => crypto.randomUUID().slice(0, 8);
const DAY = 24 * 60 * 60 * 1000;

async function sha256(text: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
}

/** A caller with no session, from `ip` (what Cloudflare reports in cf-connecting-ip). */
function visitor(ip: string | null = `198.51.100.${Math.floor(Math.random() * 250) + 1}`, waitUntil?: (job: Promise<unknown>) => void) {
  return appRouter.createCaller(async () => ({
    ...(waitUntil ? { waitUntil } : {}),
    auth: null,
    db: env.db,
    request: new Request("https://api.test", { headers: ip ? { "cf-connecting-ip": ip } : {} }),
    session: null,
    membership: null,
    companyId: null,
    role: null,
    isPlatformAdmin: false,
    platformRole: null,
    impersonation: null,
    impersonationHeaderRejected: false,
    companyHeaderRejected: false,
  })) as unknown as ReturnType<AppRouter["createCaller"]>;
}

type InviteOpts = { kind?: "member" | "portal"; expired?: boolean; revoked?: boolean; accepted?: boolean; role?: "viewer" | "operator" | "owner" | "admin"; companyId?: string };

/** An invite stored exactly as `invite.create` stores it; returns its plain token. */
async function makeInvite(email: string, opts: InviteOpts = {}) {
  const companyId = opts.companyId ?? (await env.seedCompany()).companyId;
  const token = crypto.randomUUID();
  const id = crypto.randomUUID();
  const now = Date.now();
  await env.db.insert(invite).values({
    id,
    companyId,
    email: email.toLowerCase(),
    role: opts.role ?? "viewer",
    tokenHash: await sha256(token),
    expiresAt: new Date(now + (opts.expired ? -DAY : 7 * DAY)),
    ...(opts.revoked ? { revokedAt: new Date(now - 1000) } : {}),
    ...(opts.accepted ? { acceptedAt: new Date(now - 1000) } : {}),
    kind: opts.kind ?? "member",
  });
  return { id, token, companyId };
}

/** An account for `email`: with a password (credential row), a credential row with no password, or none. */
async function makeAccount(email: string, opts: { password?: boolean; nullPassword?: boolean; google?: boolean; passkey?: boolean } = {}) {
  const id = crypto.randomUUID();
  await env.db.insert(user).values({ id, name: "Bhavesh Patel", email, emailVerified: false } as never);
  if (opts.password) {
    const { hashPassword } = await import("@orrn/auth/password");
    await env.db.insert(account).values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: await hashPassword("old-password-123") } as never);
  }
  if (opts.nullPassword) {
    await env.db.insert(account).values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: null } as never);
  }
  if (opts.google) {
    await env.db.insert(account).values({ id: crypto.randomUUID(), accountId: `g-${id}`, providerId: "google", userId: id } as never);
  }
  if (opts.passkey) {
    await env.db.insert(passkey).values({
      id: crypto.randomUUID(),
      name: "Phone",
      publicKey: "pk",
      userId: id,
      credentialID: `cred-${id}`,
      counter: 0,
      deviceType: "singleDevice",
      backedUp: false,
    } as never);
  }
  return id;
}

describe("invite.status", () => {
  test("dead links answer exactly { live: false }: unknown, expired, revoked and accepted", async () => {
    const email = `dead.${uid()}@test.orrn`;
    const tokens = [
      crypto.randomUUID(),
      (await makeInvite(email, { expired: true })).token,
      (await makeInvite(email, { revoked: true })).token,
      (await makeInvite(email, { accepted: true })).token,
    ];
    for (const token of tokens) expect(await visitor().invite.status({ token })).toEqual({ live: false });
  });

  test("no account for the invite email: account none", async () => {
    const { token } = await makeInvite(`new.${uid()}@test.orrn`);
    expect(await visitor().invite.status({ token })).toEqual({ live: true, kind: "member", account: "none", google: false });
  });

  test("an account with a password: account password", async () => {
    const email = `pw.${uid()}@test.orrn`;
    await makeAccount(email, { password: true });
    const { token } = await makeInvite(email);
    expect(await visitor().invite.status({ token })).toMatchObject({ live: true, account: "password" });
  });

  test("an account with no password (magic link, Google only, passkey only, credential row without a password): account noPassword", async () => {
    for (const opts of [{}, { google: true }, { passkey: true }, { nullPassword: true }, { google: true, passkey: true }]) {
      const email = `nopw.${uid()}@test.orrn`;
      await makeAccount(email, opts);
      const { token } = await makeInvite(email);
      expect(await visitor().invite.status({ token })).toMatchObject({ live: true, account: "noPassword" });
    }
  });

  test("the email's case does not hide the account", async () => {
    const email = `Case.${uid()}@Test.orrn`;
    await makeAccount(email, { password: true });
    const { token } = await makeInvite(email.toLowerCase());
    expect(await visitor().invite.status({ token })).toMatchObject({ account: "password" });
  });

  test("google follows the stage's Google setup", async () => {
    const { token } = await makeInvite(`g.${uid()}@test.orrn`);
    useEnv({ GOOGLE_CLIENT_ID: "x.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "s" });
    expect(await visitor().invite.status({ token })).toMatchObject({ google: true });
    useEnv({ GOOGLE_CLIENT_SECRET: undefined });
    expect(await visitor().invite.status({ token })).toMatchObject({ google: false });
  });

  test("a party invite says kind portal", async () => {
    const { token } = await makeInvite(`party.${uid()}@test.orrn`, { kind: "portal" });
    expect(await visitor().invite.status({ token })).toMatchObject({ live: true, kind: "portal" });
  });

  test("never leaks the email, the company, the role or the account's methods", async () => {
    const email = `leak.${uid()}@test.orrn`;
    await makeAccount(email, { google: true, passkey: true });
    const { token, companyId } = await makeInvite(email, { role: "owner" });
    const name = (await env.db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).get())!.name;
    const res = await visitor().invite.status({ token });
    expect(Object.keys(res).sort()).toEqual(["account", "google", "kind", "live"]);
    const text = JSON.stringify(res);
    for (const secret of [email, email.split("@")[0]!, name, companyId, "owner", "passkey"]) expect(text).not.toContain(secret);
  });

  test("an invite this account already holds stays live for it (Google sign-up accepted it on the way in), dead for anyone else", async () => {
    const email = `held.${uid()}@test.orrn`;
    const { companyId } = await env.seedCompany();
    const { token, id } = await makeInvite(email, { companyId });
    const userId = await makeAccount(email, { google: true });
    await env.addMembership(userId, companyId, "viewer");
    await env.db.update(invite).set({ acceptedAt: new Date() }).where(eq(invite.id, id));

    expect(await env.callerForUser(userId).invite.status({ token })).toMatchObject({ live: true, kind: "member" });
    expect(await visitor().invite.status({ token })).toEqual({ live: false });
    const other = await makeAccount(`other.${uid()}@test.orrn`, { password: true });
    expect(await env.callerForUser(other).invite.status({ token })).toEqual({ live: false });
  });

  test("throttled after 30 a window per IP; another IP is fine", async () => {
    const { token } = await makeInvite(`busy.${uid()}@test.orrn`);
    const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    for (let i = 0; i < 30; i += 1) await visitor(ip).invite.status({ token: i % 2 ? token : crypto.randomUUID() });
    await expect(visitor(ip).invite.status({ token })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(await visitor("192.0.2.200").invite.status({ token })).toMatchObject({ live: true });
  });

  test("is a mutation, so the token travels in a POST body and never in a URL the request log could keep", () => {
    const procedures = appRouter._def.procedures as unknown as Record<string, { _def: { type: string } }>;
    expect(procedures["invite.status"]?._def.type).toBe("mutation");
  });

  test("never accepts: a status read writes no membership and leaves the invite pending", async () => {
    const email = `look.${uid()}@test.orrn`;
    const userId = await makeAccount(email, { password: true });
    const { token, id } = await makeInvite(email);
    await env.callerForUser(userId).invite.status({ token });
    await visitor().invite.status({ token });
    const row = await env.db.select().from(invite).where(eq(invite.id, id)).get();
    expect(row?.acceptedAt).toBeNull();
  });
});

describe("invite.sendSetPasswordLink", () => {
  const resetTokensFor = async (userId: string) =>
    (await env.db.select().from(verification).where(like(verification.identifier, "reset-password:%")))
      .filter((r) => r.value === userId)
      .map((r) => r.identifier.slice("reset-password:".length));

  /** Runs `fn` on a development stack with no mail provider, where the unsent email body is printed. */
  async function capturingMail<T>(fn: () => Promise<T>) {
    useEnv({ NODE_ENV: "development", PURELYMAIL_SMTP_PASSWORD: undefined, EMAIL: undefined, BETTER_AUTH_URL: "https://api.test" });
    (await import("@orrn/auth")).resetAuthForTests();
    const log = spyOn(console, "log").mockImplementation(() => {});
    const err = spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await fn();
      return { result, printed: log.mock.calls.flat().map(String).join("\n") };
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  }

  test("the invite's email gets a reset link that comes back to this invite", async () => {
    const email = `dad.${uid()}@test.orrn`;
    const userId = await makeAccount(email);
    const { token } = await makeInvite(email);
    const { result, printed } = await capturingMail(() => visitor().invite.sendSetPasswordLink({ token, email: email.toUpperCase() }));
    expect(result).toEqual({ success: true });
    const tokens = await resetTokensFor(userId);
    expect(tokens).toHaveLength(1);
    const link = printed.match(/https?:\/\/[^\s"<]*reset-password\/[^\s"<]+/)?.[0];
    expect(link).toBeTruthy();
    const callback = new URL(link!.replaceAll("&amp;", "&")).searchParams.get("callbackURL");
    expect(callback).toBe(`https://app.test/reset-password?next=${encodeURIComponent(`/invite/${token}`)}`);
  });

  test("another email, a dead invite or an unknown token: the same answer and no link", async () => {
    const email = `real.${uid()}@test.orrn`;
    const userId = await makeAccount(email);
    const live = await makeInvite(email);
    const dead = await makeInvite(email, { expired: true });
    const strangerId = await makeAccount(`stranger.${uid()}@test.orrn`);
    const asks = [
      { token: live.token, email: `stranger.${uid()}@test.orrn` },
      { token: dead.token, email },
      { token: crypto.randomUUID(), email },
    ];
    for (const ask of asks) {
      const { result } = await capturingMail(() => visitor().invite.sendSetPasswordLink(ask));
      expect(result).toEqual({ success: true });
    }
    expect(await resetTokensFor(userId)).toHaveLength(0);
    expect(await resetTokensFor(strangerId)).toHaveLength(0);
  });

  test("finishing the emailed reset makes a password and proves the email (a later Google link keeps it)", async () => {
    const email = `fin.${uid()}@test.orrn`;
    const userId = await makeAccount(email);
    const { token } = await makeInvite(email);
    await capturingMail(() => visitor().invite.sendSetPasswordLink({ token, email }));
    const [resetToken] = await resetTokensFor(userId);
    const { createAuth } = await import("@orrn/auth");
    const res = await createAuth().handler(
      new Request("https://api.test/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://app.test" },
        body: JSON.stringify({ token: resetToken, newPassword: "a-brand-new-password" }),
      }),
    );
    expect(res.status).toBe(200);
    const { signInMethodsFor } = await import("@orrn/auth/sign-in-methods");
    expect((await signInMethodsFor(env.db as never, userId)).password).toBe(true);
    expect((await env.db.select({ v: user.emailVerified }).from(user).where(eq(user.id, userId)).get())?.v).toBe(true);
    // The invite is still there to join with the new password.
    expect(await visitor().invite.status({ token })).toMatchObject({ live: true, account: "password" });
  });

  test("the reset request runs after the answer (waitUntil), so a match answers as fast as a mismatch", async () => {
    const email = `fast.${uid()}@test.orrn`;
    await makeAccount(email);
    const { token } = await makeInvite(email);
    const { createAuth } = await import("@orrn/auth");
    // A reset request that never finishes: an answer that waited for it would never come.
    const hang = spyOn(createAuth().api, "requestPasswordReset").mockImplementation((() => new Promise(() => {})) as never);
    const jobs: Promise<unknown>[] = [];
    try {
      const answer = await Promise.race([
        visitor(undefined, (job) => void jobs.push(job)).invite.sendSetPasswordLink({ token, email }),
        new Promise((resolve) => setTimeout(() => resolve("waited"), 2_000)),
      ]);
      expect(answer).toEqual({ success: true });
      expect(hang).toHaveBeenCalledTimes(1);
      expect(jobs).toHaveLength(1);
      // A wrong email schedules nothing and answers the same.
      expect(await visitor(undefined, (job) => void jobs.push(job)).invite.sendSetPasswordLink({ token, email: `no.${uid()}@test.orrn` })).toEqual({ success: true });
      expect(jobs).toHaveLength(1);
    } finally {
      hang.mockRestore();
    }
  });

  test("once the IP is over its limit, a new link is not counted (no row for it), and old rows are swept on the refused call too", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    const stale = `invite:setpw:t:stale-${uid()}`;
    await env.db.insert(authThrottle).values({ key: stale, windowStart: Date.now() - 31 * 60 * 1000, hits: 1 });
    for (let i = 0; i < 5; i += 1) await visitor(ip).invite.sendSetPasswordLink({ token: crypto.randomUUID(), email: `x${i}@test.orrn` });
    const refused = crypto.randomUUID();
    await expect(visitor(ip).invite.sendSetPasswordLink({ token: refused, email: "y@test.orrn" })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    const key = `invite:setpw:t:${(await sha256(refused)).slice(0, 32)}`;
    expect(await env.db.select().from(authThrottle).where(eq(authThrottle.key, key)).get()).toBeUndefined();
    expect(await env.db.select().from(authThrottle).where(eq(authThrottle.key, stale)).get()).toBeUndefined();
  });

  test("throttled per IP before the email is compared: the 429 is the same for the right and a wrong email", async () => {
    const email = `limit.${uid()}@test.orrn`;
    await makeAccount(email);
    const { token } = await makeInvite(email);
    const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    for (let i = 0; i < 5; i += 1) await capturingMail(() => visitor(ip).invite.sendSetPasswordLink({ token, email: `w${i}.${uid()}@test.orrn` }));
    for (const typed of [email, `wrong.${uid()}@test.orrn`]) {
      await expect(visitor(ip).invite.sendSetPasswordLink({ token, email: typed })).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    }
  });
});

describe("invite.resend", () => {
  /** Purelymail switched on through the SMTP_TRANSPORT hook; returns what was written to the socket. */
  function usePurelymail(ok = true) {
    const written: string[] = [];
    const transport = mock(async () => {
      const script = ok
        ? ["220 hi", "250 ehlo", "220 tls", "250 ehlo", "334 u", "334 p", "235 ok", "250 from", "250 to", "354 data", "250 queued"]
        : ["220 hi", "250 ehlo", "220 tls", "250 ehlo", "334 u", "334 p", "235 ok", "250 from", "550 no such user"];
      return { readLine: async () => script.shift() ?? "421 closed", write: async (s: string) => void written.push(s), startTls: async () => {}, close: () => {} };
    });
    useEnv({ NODE_ENV: "production", PURELYMAIL_SMTP_PASSWORD: "smtp-test-pass", SMTP_TRANSPORT: transport });
    return { transport, written };
  }

  const tokenOf = (link: string) => link.split("/invite/")[1]!;

  test("rotates the token: the old link dies, the new one is live for a fresh week, the email goes, an audit row without the link", async () => {
    const { companyId, users } = await env.seedCompany();
    const email = `lalu.${uid()}@test.orrn`;
    const old = await makeInvite(email, { companyId, role: "operator", expired: true });
    expect(await visitor().invite.status({ token: old.token })).toEqual({ live: false });

    const { written } = usePurelymail();
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    let res;
    try {
      res = await env.caller({ role: "owner", companyId }).invite.resend({ inviteId: old.id });
    } finally {
      warn.mockRestore();
    }
    expect(res.emailSent).toBe(true);
    expect(res.link).toMatch(/^https:\/\/app\.test\/invite\//);
    const fresh = tokenOf(res.link);
    expect(fresh).not.toBe(old.token);
    expect(new Date(res.expiresAt).getTime()).toBeGreaterThan(Date.now() + 7 * DAY - 60_000);
    expect(await visitor().invite.status({ token: old.token })).toEqual({ live: false });
    expect(await visitor().invite.status({ token: fresh })).toMatchObject({ live: true, kind: "member" });
    // The same email as invite.create, with the new link in it.
    const raw = written.join("");
    // The body parts are base64 (smtp.ts); read them back.
    const mail = [raw, ...[...raw.matchAll(/base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map((m) => Buffer.from(m[1]!.replace(/\r\n/g, ""), "base64").toString("utf8"))].join("\n");
    expect(mail).toContain(`https://app.test/invite/${fresh}`);
    expect(mail).toContain("You've been invited to join a company on ORRN");
    expect(mail).toContain(email);

    const [row] = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "member.invite.resend")));
    expect(row?.subjectId).toBe(old.id);
    expect(row?.actorId).toBe(users.owner.id);
    expect(row?.meta).toMatchObject({ email, role: "operator" });
    expect(JSON.stringify(row?.meta)).not.toContain(fresh);
    expect(JSON.stringify(row?.meta)).not.toContain("/invite/");
  });

  test("a replayed invite.create after a resend does not hand back the dead first link", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const key = `replay-${uid()}-${uid()}`;
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const first = await owner.invite.create({ email: `rep.${uid()}@test.orrn`, role: "viewer", clientMutationId: key });
      await owner.invite.resend({ inviteId: first.inviteId });
      await expect(owner.invite.create({ email: first.email, role: "viewer", clientMutationId: key })).rejects.toMatchObject({ code: "CONFLICT" });
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  test("a failed email still hands back the link, with emailSent false", async () => {
    const { companyId } = await env.seedCompany();
    const inv = await makeInvite(`ymail.${uid()}@test.orrn`, { companyId });
    usePurelymail(false);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const res = await env.caller({ role: "admin", companyId }).invite.resend({ inviteId: inv.id });
      expect(res.emailSent).toBe(false);
      expect(await visitor().invite.status({ token: tokenOf(res.link) })).toMatchObject({ live: true });
      const printed = warn.mock.calls.flat().map(String).join("\n");
      expect(printed).not.toContain("/invite/");
    } finally {
      warn.mockRestore();
    }
  });

  test("refused, as create is, when the email is already a member here or a party login here", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const memberEmail = `joined.${uid()}@test.orrn`;
    const memberId = await makeAccount(memberEmail, { password: true });
    await env.addMembership(memberId, companyId, "viewer");
    const asMember = await makeInvite(memberEmail.toUpperCase(), { companyId });
    await expect(owner.invite.resend({ inviteId: asMember.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "User is already a member" });

    const partyEmail = `party.${uid()}@test.orrn`;
    await env.db.insert(customerPortalUser).values({ id: crypto.randomUUID(), companyId, customerId: await env.seedCustomer(companyId), email: partyEmail, status: "active" } as never);
    const asParty = await makeInvite(partyEmail, { companyId });
    await expect(owner.invite.resend({ inviteId: asParty.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This email is a party login here. Use another email for staff.",
    });
    for (const inv of [asMember, asParty]) {
      const row = await env.db.select({ h: invite.tokenHash }).from(invite).where(eq(invite.id, inv.id)).get();
      expect(row?.h).toBe(await sha256(inv.token));
    }
  });

  test("refused for accepted, revoked, portal and other-company invites, and for roles that cannot invite", async () => {
    const { companyId } = await env.seedCompany();
    const other = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    const accepted = await makeInvite(`a.${uid()}@test.orrn`, { companyId, accepted: true });
    const revoked = await makeInvite(`r.${uid()}@test.orrn`, { companyId, revoked: true });
    const portal = await makeInvite(`p.${uid()}@test.orrn`, { companyId, kind: "portal" });
    const elsewhere = await makeInvite(`e.${uid()}@test.orrn`, { companyId: other.companyId });
    for (const inv of [accepted, revoked]) {
      await expect(owner.invite.resend({ inviteId: inv.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    for (const inv of [portal, elsewhere]) {
      await expect(owner.invite.resend({ inviteId: inv.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    const pending = await makeInvite(`m.${uid()}@test.orrn`, { companyId });
    for (const role of ["manager", "operator", "viewer"] as const) {
      await expect(env.caller({ role, companyId }).invite.resend({ inviteId: pending.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // An owner invite is an owner's to resend, as it was to send.
    const ownerInvite = await makeInvite(`o.${uid()}@test.orrn`, { companyId, role: "owner" });
    await expect(env.caller({ role: "admin", companyId }).invite.resend({ inviteId: ownerInvite.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Nothing changed on any refused row.
    for (const inv of [accepted, revoked, portal, elsewhere, pending, ownerInvite]) {
      const row = await env.db.select({ h: invite.tokenHash }).from(invite).where(eq(invite.id, inv.id)).get();
      expect(row?.h).toBe(await sha256(inv.token));
    }
  });
});
