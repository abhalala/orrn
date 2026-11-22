/**
 * orrn buddy rate limits (fix round 2026-11-20, security L2): the call log reserves a place before the work starts,
 * in one conditional statement, so parallel requests cannot all pass the count, and the count is per person and plant,
 * so a new grant starts nothing at zero. Synthetic data only; Hermes is the in-process fake.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { buddyCall, user } from "@orrn/db/schema";
import { and, eq, sql } from "drizzle-orm";

import { createFakeHermes, fakeHermesFetch } from "../src/lib/buddy/fakeHermes";
import { buddyPlant, connect, setHermesEnv } from "./buddy-fixture";
import { createTestEnv, TEST_WEB_ORIGIN, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  setHermesEnv(false);
  await env.dispose();
});

beforeEach(() => setHermesEnv(true));
afterEach(() => setHermesEnv(false));

const count = async (where: ReturnType<typeof and>) =>
  Number((await env.db.select({ n: sql<number>`count(*)` }).from(buddyCall).where(where).get())?.n ?? 0);

describe("reserveBuddyCall", () => {
  test("parallel reservations never pass the limit; refused ones leave no row; the row starts pending", async () => {
    const { reserveBuddyCall } = await import("../src/lib/buddy/callLog");
    const p = await buddyPlant(env);
    const call = { companyId: p.companyId, userId: p.users.owner.id, grantId: null, tool: "orrn_call", path: "stock.summary", platform: "api_server" };
    const results = await Promise.all(Array.from({ length: 12 }, () => reserveBuddyCall(env.db, call, { max: 5, windowMs: 60_000 })));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    const rows = await env.db.select().from(buddyCall).where(eq(buddyCall.companyId, p.companyId));
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.outcome === "pending" && r.platform === "api_server" && r.path === "stock.summary")).toBe(true);
  });

  test("the count is per person, plant and tool class (chat apart from tools), not per grant", async () => {
    const { reserveBuddyCall } = await import("../src/lib/buddy/callLog");
    const p = await buddyPlant(env);
    const owner = p.users.owner.id;
    const lim = { max: 2, windowMs: 60_000 };
    const base = { companyId: p.companyId, userId: owner, path: null, platform: null };
    expect((await reserveBuddyCall(env.db, { ...base, grantId: null, tool: "orrn_call" }, lim)).ok).toBe(true);
    // Another tool, another grant: still the same count.
    const g1 = await connect(p);
    expect((await reserveBuddyCall(env.db, { ...base, grantId: g1.grantId, tool: "orrn_search" }, lim)).ok).toBe(true);
    const g2 = await connect(p);
    expect((await reserveBuddyCall(env.db, { ...base, grantId: g2.grantId, tool: "orrn_call" }, lim)).ok).toBe(false);
    // Chat has its own count; another person has their own.
    expect((await reserveBuddyCall(env.db, { ...base, grantId: g2.grantId, tool: "chat" }, lim)).ok).toBe(true);
    expect((await reserveBuddyCall(env.db, { ...base, userId: p.users.admin.id, grantId: null, tool: "orrn_call" }, lim)).ok).toBe(true);
  });

  test("rate_limited rows do not count; rows outside the window do not count", async () => {
    const { reserveBuddyCall, logBuddyCall } = await import("../src/lib/buddy/callLog");
    const p = await buddyPlant(env);
    const base = { companyId: p.companyId, userId: p.users.owner.id, grantId: null, tool: "orrn_call" };
    for (let i = 0; i < 3; i++) await logBuddyCall(env.db, { ...base, outcome: "rate_limited", ms: 0 });
    const { createId } = await import("../src/lib/id");
    await env.db.insert(buddyCall).values({ id: createId(), ...base, outcome: "ok", at: new Date(Date.now() - 120_000) });
    expect((await reserveBuddyCall(env.db, base, { max: 1, windowMs: 60_000 })).ok).toBe(true);
    expect((await reserveBuddyCall(env.db, base, { max: 1, windowMs: 60_000 })).ok).toBe(false);
  });

  test("finishBuddyCall sets the outcome once; a finished row is not rewritten", async () => {
    const { reserveBuddyCall, finishBuddyCall } = await import("../src/lib/buddy/callLog");
    const p = await buddyPlant(env);
    const r = await reserveBuddyCall(env.db, { companyId: p.companyId, userId: p.users.owner.id, grantId: null, tool: "orrn_call" }, { max: 5, windowMs: 60_000 });
    if (!r.ok) throw new Error("not reserved");
    await finishBuddyCall(env.db, r.id, { outcome: "ok", ms: 12.4, resultBytes: 300 });
    await finishBuddyCall(env.db, r.id, { outcome: "error", ms: 99 });
    expect(await env.db.select().from(buddyCall).where(eq(buddyCall.id, r.id)).get()).toMatchObject({ outcome: "ok", ms: 12, resultBytes: 300 });
  });
});

describe("chat turns under parallel requests", () => {
  test("40 turns at once: only 30 reach Hermes and 30 rows count; a new grant does not reset the count", async () => {
    const { handleBuddyChat } = await import("../src/lib/buddy/chat");
    const { resolveTenantContext } = await import("../src/lib/tenantContext");
    const p = await buddyPlant(env);
    await connect(p);
    const u = await env.db.select().from(user).where(eq(user.id, p.users.owner.id)).get();
    const ctx = async () =>
      ({
        auth: null,
        db: env.db,
        request: new Request("https://api.test/buddy/chat"),
        session: { user: { id: u!.id, name: u!.name, email: u!.email }, session: { id: "s1", signInMethod: null, createdAt: new Date() } },
        ...(await resolveTenantContext(env.db, { userId: u!.id, companyHeader: p.companyId, impersonateHeader: null })),
      }) as never;
    const req = () =>
      new Request("https://api.test/buddy/chat", {
        method: "POST",
        headers: { "content-type": "application/json", origin: TEST_WEB_ORIGIN },
        body: JSON.stringify({ message: "hi", screen: "/" }),
      });
    const fake = createFakeHermes();
    const deps = { fetch: fakeHermesFetch(fake) };
    const answers = await Promise.all(Array.from({ length: 40 }, async () => (await handleBuddyChat(req(), await ctx(), deps)).text()));
    expect(fake.turns()).toBe(30);
    expect(answers.filter((a) => a.includes('"rate_limited"'))).toHaveLength(10);
    const counted = and(eq(buddyCall.companyId, p.companyId), eq(buddyCall.tool, "chat"), sql`${buddyCall.outcome} <> 'rate_limited'`);
    expect(await count(counted)).toBe(30);
    // A new grant (Connect Hermes again) changes nothing.
    await connect(p);
    await (await handleBuddyChat(req(), await ctx(), deps)).text();
    expect(fake.turns()).toBe(30);
  });
});
