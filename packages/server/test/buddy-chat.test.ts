/**
 * orrn buddy, chat leg: `POST /buddy/chat` against the fake Hermes (design 2026-11-18, §4.1, §6, §7, §13).
 * No network: Hermes is the fake (`lib/buddy/fakeHermes.ts`, run by `apps/server/scripts/fake-hermes.ts`) answering in-process, and its orrn tool calls
 * go to the in-process `/mcp` handler.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { buddyCall, buddyDraft, buddyLink, user } from "@orrn/db/schema";
import { and, eq, sql } from "drizzle-orm";

import { createFakeHermes, fakeHermesFetch } from "../src/lib/buddy/fakeHermes";
import { buddyPlant, connect, FAKE_HERMES_ENV, setHermesEnv, type BuddyPlant } from "./buddy-fixture";
import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";

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

/** The browser request's context, resolved as production does (session + x-orrn-company). */
async function browserCtx(userId: string, companyId: string, opts: { signInMethod?: string; impersonate?: string } = {}) {
  const { resolveTenantContext } = await import("../src/lib/tenantContext");
  const u = await env.db.select().from(user).where(eq(user.id, userId)).get();
  const tenant = await resolveTenantContext(env.db, { userId, companyHeader: opts.impersonate ? null : companyId, impersonateHeader: opts.impersonate ?? null });
  return {
    auth: null,
    db: env.db,
    request: new Request("https://api.test/buddy/chat"),
    session: { user: { id: u!.id, name: u!.name, email: u!.email }, session: { id: "s1", signInMethod: opts.signInMethod ?? null } },
    ...tenant,
  } as never;
}

function chatRequest(body: unknown): Request {
  return new Request("https://api.test/buddy/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function events(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((f) => f.startsWith("data: "))
    .map((f) => JSON.parse(f.slice(6)) as Record<string, unknown>);
}

async function chat(p: BuddyPlant, body: unknown, deps: { fetch: typeof fetch }, opts: { userId?: string; signInMethod?: string } = {}) {
  const { handleBuddyChat } = await import("../src/lib/buddy/chat");
  return handleBuddyChat(chatRequest(body), await browserCtx(opts.userId ?? p.users.owner.id, p.companyId, opts), deps);
}

describe("who may chat: 403 / 404 with no body", () => {
  test("a non-owner 403; not configured, not listed or not connected 404; a bad body 400", async () => {
    const p = await buddyPlant(env);
    const fake = createFakeHermes();
    const deps = { fetch: fakeHermesFetch(fake) };
    const msg = { message: "hello", screen: "/today" };
    let r = await chat(p, msg, deps);
    expect(r.status).toBe(404); // not connected yet
    expect(await r.text()).toBe("");
    await connect(p);
    r = await chat(p, msg, deps, { userId: p.users.admin.id });
    expect(r.status).toBe(403);
    expect(await r.text()).toBe("");
    setHermesEnv(false);
    expect((await chat(p, msg, deps)).status).toBe(404);
    setHermesEnv(true);
    expect((await chat(p, { screen: "/today" }, deps)).status).toBe(400);
    expect((await chat(p, { ...msg, conversationId: "../../etc" }, deps)).status).toBe(400);
    expect(fake.last()).toBeNull();
  });

  test("a plant that requires secure sign-in: a password session is refused", async () => {
    const p = await buddyPlant(env, { settings: { requireStrongSignIn: true } });
    await env.caller({ role: "owner", companyId: p.companyId, signInMethod: "passkey" }).buddy.grant.create();
    const deps = { fetch: fakeHermesFetch(createFakeHermes()) };
    expect((await chat(p, { message: "hi", screen: "/" }, deps, { signInMethod: "password" })).status).toBe(403);
    expect((await chat(p, { message: "hi", screen: "/" }, deps, { signInMethod: "passkey" })).status).toBe(200);
  });
});

describe("a turn", () => {
  test("Hermes's frames come back as orrn's events only; reasoning, status, commentary and tool output are dropped", async () => {
    const p = await buddyPlant(env);
    await connect(p);
    const fake = createFakeHermes();
    const res = await chat(p, { message: "how much 12170 is in the yard", screen: "/stock", conversationId: "conv_abcdef12" }, { fetch: fakeHermesFetch(fake) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const evs = await events(res);
    const types = [...new Set(evs.map((e) => e.type))];
    expect(types).toEqual(["tool", "text", "done"]);
    expect(evs.find((e) => e.type === "tool")).toEqual({ type: "tool", path: "stock.summary" });
    const text = evs.filter((e) => e.type === "text").map((e) => e.delta).join("");
    expect(text).toBe("Fake Hermes heard: how much 12170 is in the yard");
    expect(JSON.stringify(evs)).not.toContain("thinking");
    expect(JSON.stringify(evs)).not.toContain("Looking it up");
    expect(JSON.stringify(evs)).not.toContain("fake result");
    expect(evs.at(-1)).toEqual({ type: "done", conversationId: "conv_abcdef12" });
  });

  test("what orrn sends Hermes: the message, a context block, the conversation named by plant and person, no token", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const fake = createFakeHermes();
    await (await chat(p, { message: "hello", screen: "/orders", conversationId: "conv_12345678", notes: ["draft D1 confirmed: order SO-1"] }, { fetch: fakeHermesFetch(fake) })).text();
    const sent = fake.last()!;
    expect(sent).toMatchObject({ input: "hello", stream: true, store: true, conversation: `orrn:${p.companyId}:${p.users.owner.id}:conv_12345678` });
    expect(sent.previous_response_id).toBeUndefined();
    const instructions = String(sent.instructions);
    expect(instructions).toContain("Role: owner");
    expect(instructions).toContain("/orders");
    expect(instructions).toContain("draft D1 confirmed: order SO-1");
    expect(JSON.stringify(sent)).not.toContain(token);
    expect(JSON.stringify(sent)).not.toContain(FAKE_HERMES_ENV.HERMES_API_KEY);
  });

  test("a new conversation gets an id from orrn", async () => {
    const p = await buddyPlant(env);
    await connect(p);
    const evs = await events(await chat(p, { message: "hi", screen: "/" }, { fetch: fakeHermesFetch(createFakeHermes()) }));
    const done = evs.at(-1)!;
    expect(done.type).toBe("done");
    expect(String(done.conversationId)).toMatch(/^[0-9a-f]{32}$/);
  });

  test("response.failed is an error event", async () => {
    const p = await buddyPlant(env);
    await connect(p);
    const evs = await events(await chat(p, { message: "/fail now", screen: "/" }, { fetch: fakeHermesFetch(createFakeHermes()) }));
    expect(evs.at(-1)).toEqual({ type: "error", code: "error" });
  });

  test("offline: a login page (bad Access token), a 401, a network error, a timeout", async () => {
    const p = await buddyPlant(env);
    await connect(p);
    const fake = createFakeHermes();
    expect(await events(await chat(p, { message: "/offline", screen: "/" }, { fetch: fakeHermesFetch(fake) }))).toEqual([{ type: "error", code: "offline" }]);
    const wrongKey = createFakeHermes({ apiKey: "another-key" });
    expect(await events(await chat(p, { message: "hi", screen: "/" }, { fetch: fakeHermesFetch(wrongKey) }))).toEqual([{ type: "error", code: "offline" }]);
    const down = (async () => {
      throw new TypeError("network down");
    }) as unknown as typeof fetch;
    expect(await events(await chat(p, { message: "hi", screen: "/" }, { fetch: down }))).toEqual([{ type: "error", code: "offline" }]);
    const { handleBuddyChat } = await import("../src/lib/buddy/chat");
    const hang = ((_u: unknown, init?: RequestInit) =>
      new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    const slow = await handleBuddyChat(chatRequest({ message: "hi", screen: "/" }), await browserCtx(p.users.owner.id, p.companyId), { fetch: hang, connectTimeoutMs: 50 });
    expect(await events(slow)).toEqual([{ type: "error", code: "offline" }]);
    const rows = await env.db.select({ outcome: buddyCall.outcome }).from(buddyCall).where(and(eq(buddyCall.companyId, p.companyId), eq(buddyCall.tool, "chat")));
    expect(rows.every((r) => r.outcome === "error")).toBe(true);
  });

  test("a draft made during the turn comes back as a draft event (from the buddy_draft row)", async () => {
    const p = await buddyPlant(env);
    const { token } = await connect(p);
    const { handleMcpRequest } = await import("../src/lib/buddy/mcp");
    const mcpFetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      handleMcpRequest(new Request(String(input), init), { db: env.db })) as typeof fetch;
    const fake = createFakeHermes({ mcpUrl: "https://api.test/mcp", mcpToken: token, fetch: mcpFetch });
    const evs = await events(await chat(p, { message: '/draft customer.create {"name":"Rho Synthetic Co"}', screen: "/customers" }, { fetch: fakeHermesFetch(fake) }));
    const draft = evs.find((e) => e.type === "draft");
    expect(draft).toBeDefined();
    const row = await env.db.select().from(buddyDraft).where(eq(buddyDraft.id, String(draft!.draftId))).get();
    expect(row).toMatchObject({ companyId: p.companyId, path: "customer.create", status: "pending" });
    expect(evs.find((e) => e.type === "tool")).toEqual({ type: "tool", path: "customer.create" });
    expect(evs.filter((e) => e.type === "text").map((e) => e.delta).join("")).toContain("I made a draft");
    expect(evs.at(-1)!.type).toBe("done");
  });
});

describe("the buddy's own Hermes profile (owner decision 2026-11-20, security H2)", () => {
  test("Connect Hermes links the person to orrn-buddy; every turn goes to /p/orrn-buddy/v1/responses, never the default profile", async () => {
    const p = await buddyPlant(env);
    await connect(p);
    const link = await env.db.select().from(buddyLink).where(and(eq(buddyLink.companyId, p.companyId), eq(buddyLink.userId, p.users.owner.id))).get();
    expect(link?.hermesProfile).toBe("orrn-buddy");
    const fake = createFakeHermes();
    await (await chat(p, { message: "hi", screen: "/" }, { fetch: fakeHermesFetch(fake) })).text();
    expect(fake.lastPath()).toBe("/p/orrn-buddy/v1/responses");
  });

  test("BUDDY_HERMES_PROFILE names the profile of new links; a value that is not a profile name keeps the buddy off", async () => {
    const p = await buddyPlant(env);
    workersEnv.BUDDY_HERMES_PROFILE = "plant-buddy_2";
    try {
      await connect(p);
      const fake = createFakeHermes();
      await (await chat(p, { message: "hi", screen: "/" }, { fetch: fakeHermesFetch(fake) })).text();
      expect(fake.lastPath()).toBe("/p/plant-buddy_2/v1/responses");
      workersEnv.BUDDY_HERMES_PROFILE = "../default";
      const before = fake.turns();
      expect((await chat(p, { message: "hi", screen: "/" }, { fetch: fakeHermesFetch(fake) })).status).toBe(404);
      expect(fake.turns()).toBe(before);
      expect((await p.owner.auth.me()).buddy).toBe(false);
    } finally {
      delete workersEnv.BUDDY_HERMES_PROFILE;
    }
  });
});

describe("limits (§7)", () => {
  test("30 chat turns an hour, then a rate_limited event and no call to Hermes; each turn is one chat row, no text", async () => {
    const p = await buddyPlant(env);
    const { grantId } = await connect(p);
    const fake = createFakeHermes();
    await (await chat(p, { message: "first", screen: "/" }, { fetch: fakeHermesFetch(fake) })).text();
    const row = await env.db.select().from(buddyCall).where(and(eq(buddyCall.companyId, p.companyId), eq(buddyCall.tool, "chat"))).get();
    expect(row).toMatchObject({ userId: p.users.owner.id, grantId, outcome: "ok", path: null });
    const { createId } = await import("../src/lib/id");
    const rows = Array.from({ length: 29 }, () => ({ id: createId(), companyId: p.companyId, userId: p.users.owner.id, grantId, tool: "chat", outcome: "ok" as const, at: new Date() }));
    for (let i = 0; i < rows.length; i += 10) await env.db.insert(buddyCall).values(rows.slice(i, i + 10));
    const before = fake.last();
    expect(await events(await chat(p, { message: "one more", screen: "/" }, { fetch: fakeHermesFetch(fake) }))).toEqual([{ type: "error", code: "rate_limited" }]);
    expect(fake.last()).toBe(before);
    const n = await env.db.select({ n: sql<number>`count(*)` }).from(buddyCall).where(and(eq(buddyCall.companyId, p.companyId), eq(buddyCall.outcome, "rate_limited"))).get();
    expect(Number(n?.n)).toBe(1);
  });
});
