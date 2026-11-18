/**
 * Plant policy, per-plant onboarding and the plant picker's facts (plan 2026-11-18, Task 9; spec
 * "Amendment 2026-11-18" items 2-6).
 *
 * - `company.updateSettings({ requireStrongSignIn })` is the owner's alone (an admin is refused) and
 *   writes `company.security.update`; `auth.me.company.requireStrongSignIn` reads it.
 * - Onboarding is per plant: `membership.onboarded_at`. `auth.me` says `setupPending` for the active
 *   plant and for every membership; `completeOnboarding` marks only the active plant.
 * - Migration 0051 backfills `onboarded_at` from the old user flag, so nobody set up is sent back.
 * - Removing the last strong method is refused only while an active plant of the person requires
 *   secure sign-in (`COMPANY_REQUIRES_STRONG_METHOD`).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";

import { account, auditLog, company, membership, passkey, user } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

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

const PASSWORD = "plant-policy-password-123";
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
  const email = unique("policy");
  await env.db.insert(user).values({ id, name: "Policy test", email, emailVerified: true } as never);
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

async function signIn(email: string) {
  const res = await call("sign-in/email", { body: { email, password: PASSWORD } });
  expect(res.status).toBe(200);
  return cookieHeader(res);
}

async function codeOf(res: Response) {
  try {
    return (JSON.parse(await res.text()) as { code?: string } | null)?.code;
  } catch {
    return undefined;
  }
}

const membershipOf = (userId: string, companyId: string) =>
  env.db
    .select()
    .from(membership)
    .where(and(eq(membership.userId, userId), eq(membership.companyId, companyId)))
    .get();

describe("company.updateSettings requireStrongSignIn", () => {
  test("updateSettings requireStrongSignIn owner only", async () => {
    const { companyId } = await env.seedCompany();
    await expect(
      env.caller({ role: "admin", companyId }).company.updateSettings({ requireStrongSignIn: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Only an owner can change secure sign-in" });
    const untouched = await env.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).get();
    expect(untouched?.settings?.requireStrongSignIn).toBeUndefined();

    await env.caller({ role: "owner", companyId }).company.updateSettings({ requireStrongSignIn: true });
    const me = await env.caller({ role: "owner", companyId }).auth.me();
    expect(me.company?.requireStrongSignIn).toBe(true);
    // Every member of the plant reads the policy.
    expect((await env.caller({ role: "packer", companyId }).auth.me()).company?.requireStrongSignIn).toBe(true);

    const rows = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "company.security.update")))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.meta).toEqual({ requireStrongSignIn: { from: false, to: true } });
    // The policy has its own row, not a copy in the general settings row.
    const general = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "company.settings.update")))
      .all();
    expect(general).toHaveLength(0);

    // Turning it off is the owner's too, and is audited.
    await env.caller({ role: "owner", companyId }).company.updateSettings({ requireStrongSignIn: false });
    expect((await env.caller({ role: "owner", companyId }).auth.me()).company?.requireStrongSignIn).toBe(false);
    const after = await env.db
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "company.security.update")))
      .all();
    expect(after.map((r) => r.meta)).toContainEqual({ requireStrongSignIn: { from: true, to: false } });
  });

  test("a plant that never set it reads false", async () => {
    const { companyId } = await env.seedCompany();
    expect((await env.caller({ role: "owner", companyId }).auth.me()).company?.requireStrongSignIn).toBe(false);
  });

  test("other settings sent with it still write the general row", async () => {
    const { companyId } = await env.seedCompany();
    await env.caller({ role: "owner", companyId }).company.updateSettings({ requireStrongSignIn: true, orderLeadDays: 9 });
    const actions = (
      await env.db.select({ action: auditLog.action, meta: auditLog.meta }).from(auditLog).where(eq(auditLog.companyId, companyId)).all()
    ).map((r) => r.action);
    expect(actions.sort()).toEqual(["company.security.update", "company.settings.update"]);
  });
});

describe("per-plant onboarding", () => {
  test("auth.me setupPending per membership", async () => {
    const a = await env.seedCompany();
    const b = await env.seedCompany();
    const u = await env.seedUser("two plants");
    const inA = await env.addMembership(u, a.companyId, "owner");
    await env.addMembership(u, b.companyId, "admin");
    await env.db.update(membership).set({ onboardedAt: new Date() }).where(eq(membership.id, inA));

    const inPlantA = await env.callerForUser(u, { company: a.companyId }).auth.me();
    expect(inPlantA.company?.id).toBe(a.companyId);
    expect(inPlantA.company?.setupPending).toBe(false);
    const byId = Object.fromEntries(inPlantA.memberships.map((m) => [m.companyId, m]));
    expect(byId[a.companyId]).toMatchObject({ role: "owner", setupPending: false });
    expect(byId[b.companyId]).toMatchObject({ role: "admin", setupPending: true });

    const inPlantB = await env.callerForUser(u, { company: b.companyId }).auth.me();
    expect(inPlantB.company?.setupPending).toBe(true);
  });

  test("completeOnboarding only marks the active plant", async () => {
    const a = await env.seedCompany();
    const b = await env.seedCompany();
    const u = await env.seedUser("onboard one");
    await env.addMembership(u, a.companyId, "packer");
    await env.addMembership(u, b.companyId, "packer");

    await env.callerForUser(u, { company: b.companyId }).auth.completeOnboarding({});
    expect((await membershipOf(u, b.companyId))?.onboardedAt).toBeInstanceOf(Date);
    expect((await membershipOf(u, a.companyId))?.onboardedAt ?? null).toBeNull();
    // The old user flag is still written for clients that read it.
    expect((await env.db.select().from(user).where(eq(user.id, u)).get())?.onboardingCompleted).toBe(true);

    const me = await env.callerForUser(u, { company: a.companyId }).auth.me();
    expect(me.company?.setupPending).toBe(true);
    expect(me.memberships.find((m) => m.companyId === b.companyId)?.setupPending).toBe(false);
  });

  test("a second completeOnboarding keeps the first time", async () => {
    const a = await env.seedCompany();
    const u = await env.seedUser("onboard twice");
    await env.addMembership(u, a.companyId, "packer");
    const caller = env.callerForUser(u, { company: a.companyId });
    await caller.auth.completeOnboarding({});
    const first = (await membershipOf(u, a.companyId))?.onboardedAt?.getTime();
    await new Promise((r) => setTimeout(r, 5));
    await caller.auth.completeOnboarding({});
    expect((await membershipOf(u, a.companyId))?.onboardedAt?.getTime()).toBe(first);
  });
});

describe("migration 0051_membership_onboarded", () => {
  const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../db/src/migrations");

  test("backfill marks existing onboarded users", async () => {
    const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", d1Databases: ["DB"] });
    try {
      const d1 = await mf.getD1Database("DB");
      const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
      expect(files).toContain("0051_membership_onboarded.sql");
      const apply = async (file: string) => {
        const statements = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
          .split("--> statement-breakpoint")
          .map((x) => x.trim())
          .filter(Boolean);
        await d1.batch(statements.map((x) => d1.prepare(x)));
      };
      for (const f of files.filter((f) => f < "0051")) await apply(f);
      await d1.batch([
        d1.prepare("insert into company (id, name, slug) values ('c1', 'One', 'one'), ('c2', 'Two', 'two')"),
        d1.prepare(
          "insert into user (id, name, email, onboarding_completed) values ('done', 'Done', 'done@x', 1), ('open', 'Open', 'open@x', 0)",
        ),
        d1.prepare(
          "insert into membership (id, user_id, company_id, role, created_at) values " +
            "('m-done-1', 'done', 'c1', 'owner', 1000), ('m-done-2', 'done', 'c2', 'packer', 2000), ('m-open', 'open', 'c1', 'packer', 3000)",
        ),
      ]);
      for (const f of files.filter((f) => f >= "0051")) await apply(f);

      const { results } = await d1.prepare("select id, onboarded_at from membership order by id").all<{ id: string; onboarded_at: number | null }>();
      expect(results).toEqual([
        { id: "m-done-1", onboarded_at: 1000 },
        { id: "m-done-2", onboarded_at: 2000 },
        { id: "m-open", onboarded_at: null },
      ]);
    } finally {
      await mf.dispose();
    }
  });

  test("follows 0050 in the journal and chains off its snapshot; only adds", () => {
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string; when: number }[];
    };
    const entry = journal.entries.find((e) => e.tag === "0051_membership_onboarded")!;
    expect(entry.idx).toBe(51);
    expect(entry.when).toBeGreaterThan(journal.entries[50]!.when);
    const s51 = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/0051_snapshot.json"), "utf8")) as { prevId: string };
    const s50 = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta/0050_snapshot.json"), "utf8")) as { id: string };
    expect(s51.prevId).toBe(s50.id);
    const sql = readFileSync(join(MIGRATIONS_DIR, "0051_membership_onboarded.sql"), "utf8");
    expect(sql).not.toMatch(/\b(DROP|DELETE)\b/i);
  });
});

describe("strong methods and the plant policy", () => {
  async function strictPlant(status: "active" | "suspended" = "active") {
    const { companyId } = await env.seedCompany({ settings: { requireStrongSignIn: true } });
    if (status !== "active") await env.db.update(company).set({ status }).where(eq(company.id, companyId));
    return companyId;
  }

  test("strong method removal refused only when a plant requires it", async () => {
    // An owner of a plant without the policy may drop to a password alone (two-factor is opt-in).
    const free = await makeUser();
    const { companyId: plain } = await env.seedCompany();
    await env.addMembership(free.id, plain, "owner");
    const freeCookie = await signIn(free.email);
    const freeKey = await addPasskey(free.id);
    const allowed = await call("passkey/delete-passkey", { body: { id: freeKey }, cookie: freeCookie });
    expect(allowed.status).toBe(200);

    // A packer of a plant that requires secure sign-in may not.
    const strict = await makeUser();
    await env.addMembership(strict.id, await strictPlant(), "packer");
    const cookie = await signIn(strict.email);
    const key = await addPasskey(strict.id);
    const refused = await call("passkey/delete-passkey", { body: { id: key }, cookie });
    expect(refused.status).toBe(403);
    expect(await codeOf(refused)).toBe("COMPANY_REQUIRES_STRONG_METHOD");
    expect(await env.db.select().from(passkey).where(eq(passkey.userId, strict.id)).all()).toHaveLength(1);

    // With another strong method left, the passkey may go.
    await env.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, strict.id));
    const second = await call("passkey/delete-passkey", { body: { id: key }, cookie });
    expect(second.status).toBe(200);
  });

  test("turning the authenticator off is refused under the policy", async () => {
    const u = await makeUser();
    await env.addMembership(u.id, await strictPlant(), "office");
    const cookie = await signIn(u.email);
    await env.db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, u.id));
    const res = await call("two-factor/disable", { body: { password: PASSWORD }, cookie });
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe("COMPANY_REQUIRES_STRONG_METHOD");
  });

  test("a suspended plant's policy does not hold the person", async () => {
    const u = await makeUser();
    await env.addMembership(u.id, await strictPlant("suspended"), "owner");
    const cookie = await signIn(u.email);
    const key = await addPasskey(u.id);
    const res = await call("passkey/delete-passkey", { body: { id: key }, cookie });
    expect(res.status).toBe(200);
  });

  test("auth.signInMethods says when a plant requires a strong method", async () => {
    const u = await makeUser();
    const { companyId: plain } = await env.seedCompany();
    await env.addMembership(u.id, plain, "owner");
    expect(await env.callerForUser(u.id).auth.signInMethods()).toMatchObject({ requiredByPlant: false });
    await env.addMembership(u.id, await strictPlant(), "viewer");
    const methods = await env.callerForUser(u.id).auth.signInMethods();
    expect(methods).toMatchObject({ requiredByPlant: true });
    expect("isOwnerAnywhere" in methods).toBe(false);
  });
});
