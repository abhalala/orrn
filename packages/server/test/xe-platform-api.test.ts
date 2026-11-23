/**
 * XE PLATFORM row 83: plant API tokens, the `/api/v1` read API, and webhooks (outbox, delivery, SSRF guard).
 * No network: the resolver and fetch are fakes.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { unwrapSecret } from "@orrn/crypto";
import { apiToken, company, webhookDelivery, webhookEndpoint } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { DEV_MASTER_KEY } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { FT12, opHelpers } from "./orders-w1-fixture";
import { API_OPENAPI } from "../src/lib/publicApi/openapi";
import { handlePublicApi, ROUTES } from "../src/lib/publicApi/app";
import { drainWebhooks, hmacHex } from "../src/lib/webhooks/deliver";
import { setWebhookResolverForTests } from "../src/lib/webhooks/schedule";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.dispose();
});
afterEach(() => setWebhookResolverForTests(null));

const { opPlant } = opHelpers(() => env);

const PUBLIC = async () => ["93.184.216.34"];
const PRIVATE = async () => ["10.0.0.7"];

async function apiPlant(modules: string[] = ["api"]) {
  const p = await opPlant();
  await env.db.update(company).set({ modules }).where(eq(company.id, p.companyId));
  const admin = p.as("admin");
  return { ...p, admin };
}

const get = (path: string, token?: string, nowMs?: number) =>
  handlePublicApi(new Request(`https://api.test${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), { db: env.db, nowMs });

describe("tokens (api.manage, module api)", () => {
  test("make, list, revoke; shown once and stored hashed", async () => {
    const p = await apiPlant();
    const made = await p.admin.api.tokens.create({ name: "Tally bridge", scopes: ["orders.read"], expiresInDays: 30 });
    expect(made.token).toMatch(/^orrna_[0-9A-Z]{26}_[0-9a-f]{64}$/);
    const row = await env.db.select().from(apiToken).where(eq(apiToken.id, made.id)).get();
    expect(row?.tokenHash).not.toContain(made.token.slice(-64));
    expect(JSON.stringify(await p.admin.api.tokens.list())).not.toContain(made.token.slice(-64));
    expect((await get("/api/v1/orders", made.token)).status).toBe(200);
    await p.admin.api.tokens.revoke({ id: made.id });
    const res = await get("/api/v1/orders", made.token);
    expect(res.status).toBe(401);
  });

  test("refusals: module off (reads too), permission, tenancy, invoices without billing", async () => {
    const off = await apiPlant([]);
    await expect(off.admin.api.tokens.list()).rejects.toThrow("That module is not on for this plant");
    const p = await apiPlant();
    await expect(p.as("manager").api.tokens.list()).rejects.toThrow("You don't have permission to do that");
    await expect(p.admin.api.tokens.create({ name: "x", scopes: ["invoices.read"], expiresInDays: null })).rejects.toThrow("Invoices can be read only when billing is on");
    const other = await apiPlant();
    const made = await p.admin.api.tokens.create({ name: "x", scopes: ["orders.read"], expiresInDays: null });
    await expect(other.admin.api.tokens.revoke({ id: made.id })).rejects.toThrow("Not found");
  });
});

describe("/api/v1", () => {
  test("auth, scope, module and expiry answers", async () => {
    const p = await apiPlant();
    expect((await get("/api/v1/orders")).status).toBe(401);
    expect((await get("/api/v1/orders", "orrna_nope")).status).toBe(401);
    const { token } = await p.admin.api.tokens.create({ name: "stock only", scopes: ["stock.read"], expiresInDays: 1 });
    expect((await get("/api/v1/orders", token)).status).toBe(403);
    expect((await get("/api/v1/stock", token)).status).toBe(200);
    expect((await get("/api/v1/stock", token, Date.now() + 2 * 86_400_000)).status).toBe(401);
    expect((await get("/api/v1/nowhere", token)).status).toBe(404);
    expect((await handlePublicApi(new Request("https://api.test/api/v1/orders", { method: "POST" }), { db: env.db })).status).toBe(405);
    // The plant turns the API off: every token stops.
    await env.db.update(company).set({ modules: [] }).where(eq(company.id, p.companyId));
    expect((await get("/api/v1/stock", token)).status).toBe(403);
  });

  test("orders: same data as the screen, rates only with prices.read, cursor pages", async () => {
    const p = await apiPlant();
    await env.db.update(company).set({ settings: { ...(await env.db.select({ s: company.settings }).from(company).where(eq(company.id, p.companyId)).get())!.s as object, priceOnSalesOrder: true } }).where(eq(company.id, p.companyId));
    const sectionId = await p.section();
    const orders = [];
    for (let i = 0; i < 3; i += 1) orders.push(await p.confirmedOrder([{ sectionId, pcs: 10, mm: FT12 }]));
    const plain = (await p.admin.api.tokens.create({ name: "plain", scopes: ["orders.read"], expiresInDays: null })).token;
    const priced = (await p.admin.api.tokens.create({ name: "priced", scopes: ["orders.read", "prices.read"], expiresInDays: null })).token;

    const first = (await (await get("/api/v1/orders?limit=2", plain)).json()) as { data: { id: string }[]; nextCursor: string | null };
    expect(first.data.length).toBe(2);
    expect(first.nextCursor).not.toBeNull();
    const second = (await (await get(`/api/v1/orders?limit=2&cursor=${first.nextCursor}`, plain)).json()) as { data: { id: string }[]; nextCursor: string | null };
    expect(second.data.length).toBe(1);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.data, ...second.data].map((o) => o.id))).toEqual(new Set(orders.map((o) => o.id)));

    const detailPlain = await (await get(`/api/v1/orders/${orders[0]!.id}`, plain)).text();
    expect(detailPlain).not.toMatch(/rate|price|paise/i);
    const detailPriced = (await (await get(`/api/v1/orders/${orders[0]!.id}`, priced)).json()) as { data: { lines: Record<string, unknown>[] } };
    expect(Object.keys(detailPriced.data.lines[0]!)).toContain("ratePaise");

    // Another plant's order is Not found.
    const other = await apiPlant();
    const otherToken = (await other.admin.api.tokens.create({ name: "o", scopes: ["orders.read"], expiresInDays: null })).token;
    expect((await get(`/api/v1/orders/${orders[0]!.id}`, otherToken)).status).toBe(404);
    expect((await get("/api/v1/orders?cursor=%%%", plain)).status).toBe(400);
  });

  test("the rate limit: the 61st call in a minute is 429; a call writes only the counter and last used", async () => {
    const p = await apiPlant();
    const made = await p.admin.api.tokens.create({ name: "busy", scopes: ["stock.read"], expiresInDays: null });
    const t0 = Math.floor(Date.now() / 60_000) * 60_000 + 1000;
    for (let i = 0; i < 60; i += 1) expect((await get("/api/v1/stock/locations", made.token, t0)).status).toBe(200);
    const refused = await get("/api/v1/stock/locations", made.token, t0);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).not.toBeNull();
    expect((await get("/api/v1/stock/locations", made.token, t0 + 60_000)).status).toBe(200);
    const row = await env.db.select({ lastUsedAt: apiToken.lastUsedAt }).from(apiToken).where(eq(apiToken.id, made.id)).get();
    expect(row?.lastUsedAt).not.toBeNull();
  });

  test("the OpenAPI document lists exactly the routes", async () => {
    const res = await get("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    const doc = (await res.json()) as typeof API_OPENAPI;
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths).sort()).toEqual(ROUTES.map((r) => r.path).sort());
    for (const r of ROUTES) expect((doc.paths as Record<string, { get: { "x-orrn-scope": string } }>)[r.path]!.get["x-orrn-scope"]).toBe(r.scope);
  });
});

describe("webhooks", () => {
  test("SSRF: private, tailnet, http and unresolvable addresses are refused at registration", async () => {
    const p = await apiPlant();
    setWebhookResolverForTests(PRIVATE);
    await expect(p.admin.api.webhooks.create({ url: "https://hooks.example.com/x", events: ["order.confirmed"] })).rejects.toThrow("Use a public https address");
    setWebhookResolverForTests(PUBLIC);
    for (const url of ["http://hooks.example.com/x", "https://10.1.1.1/x", "https://box.tail99.ts.net/x", "https://localhost/x", "https://[::1]/x"]) {
      await expect(p.admin.api.webhooks.create({ url, events: ["order.confirmed"] })).rejects.toThrow("Use a public https address");
    }
    setWebhookResolverForTests(async () => {
      throw new Error("nxdomain");
    });
    await expect(p.admin.api.webhooks.create({ url: "https://nowhere.example.com/x", events: ["order.confirmed"] })).rejects.toThrow("Use a public https address");
  });

  test("order.confirmed: outbox row in the same batch, delivered signed; nothing for a plant without api", async () => {
    setWebhookResolverForTests(PUBLIC);
    const p = await apiPlant();
    const { id: endpointId, secret } = await p.admin.api.webhooks.create({ url: "https://hooks.example.com/orrn", events: ["order.confirmed"] });
    const stored = await env.db.select().from(webhookEndpoint).where(eq(webhookEndpoint.id, endpointId)).get();
    expect(stored?.secretWrapped).not.toContain(secret);
    expect(await unwrapSecret(stored!.secretWrapped, DEV_MASTER_KEY)).toBe(secret);

    const sectionId = await p.section();
    const order = await p.confirmedOrder([{ sectionId, pcs: 5, mm: FT12 }]);
    const rows = await env.db.select().from(webhookDelivery).where(eq(webhookDelivery.companyId, p.companyId));
    expect(rows.length).toBe(1);
    expect(rows[0]!.event).toBe("order.confirmed");
    expect(JSON.parse(rows[0]!.payload).data.orderId).toBe(order.id);
    expect(rows[0]!.payload).not.toMatch(/rate|paise/i);

    const sent: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    const r = await drainWebhooks(env.db, { nowMs: Date.now() + 1000, masterKey: DEV_MASTER_KEY, resolve: PUBLIC, fetch: fakeFetch, companyId: p.companyId });
    expect(r.delivered).toBe(1);
    expect(sent[0]!.init.redirect).toBe("manual");
    const headers = sent[0]!.init.headers as Record<string, string>;
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(headers["x-orrn-signature"]!)!;
    expect(await hmacHex(secret, `${t}.${sent[0]!.init.body as string}`)).toBe(v1!);
    expect(headers["x-orrn-event"]).toBe("order.confirmed");

    // A plant without the module writes no outbox row on confirm.
    const off = await apiPlant([]);
    await env.db.insert(webhookEndpoint).values({ id: crypto.randomUUID(), companyId: off.companyId, url: "https://hooks.example.com/x", events: ["order.confirmed"], secretWrapped: stored!.secretWrapped });
    await off.confirmedOrder([{ sectionId: await off.section(), pcs: 5, mm: FT12 }]);
    expect((await env.db.select().from(webhookDelivery).where(eq(webhookDelivery.companyId, off.companyId))).length).toBe(0);
  });

  test("retries with backoff, failed after 24 h, resend; redirects are not followed; a host now private is refused", async () => {
    setWebhookResolverForTests(PUBLIC);
    const p = await apiPlant();
    const { id: endpointId } = await p.admin.api.webhooks.create({ url: "https://hooks.example.com/orrn", events: ["order.confirmed"] });
    await p.confirmedOrder([{ sectionId: await p.section(), pcs: 5, mm: FT12 }]);
    const redirect = (async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } })) as unknown as typeof fetch;
    const t0 = Date.now() + 1000;
    let r = await drainWebhooks(env.db, { nowMs: t0, masterKey: DEV_MASTER_KEY, resolve: PUBLIC, fetch: redirect, companyId: p.companyId });
    expect(r.retried).toBe(1);
    let [row] = await env.db.select().from(webhookDelivery).where(eq(webhookDelivery.endpointId, endpointId));
    expect(row!.lastError).toBe("Redirects are not followed");
    expect(row!.nextAttemptAt.getTime()).toBe(t0 + 60_000);

    // The host now resolves to a private address: refused without a send.
    let calls = 0;
    const counting = (async () => {
      calls += 1;
      return new Response("ok");
    }) as unknown as typeof fetch;
    r = await drainWebhooks(env.db, { nowMs: t0 + 61_000, masterKey: DEV_MASTER_KEY, resolve: PRIVATE, fetch: counting, companyId: p.companyId });
    expect(calls).toBe(0);
    [row] = await env.db.select().from(webhookDelivery).where(eq(webhookDelivery.endpointId, endpointId));
    expect(row!.lastError).toContain("URL refused");

    // Past 24 h: failed.
    const down = (async () => new Response("no", { status: 503 })) as unknown as typeof fetch;
    r = await drainWebhooks(env.db, { nowMs: t0 + 25 * 3_600_000, masterKey: DEV_MASTER_KEY, resolve: PUBLIC, fetch: down, companyId: p.companyId });
    expect(r.failed).toBe(1);
    const failed = await p.admin.api.webhooks.deliveries({ id: endpointId, status: "failed" });
    expect(failed.items.length).toBe(1);

    await p.admin.api.webhooks.resend({ id: failed.items[0]!.id });
    r = await drainWebhooks(env.db, { nowMs: Date.now() + 5000, masterKey: DEV_MASTER_KEY, resolve: PUBLIC, fetch: counting, companyId: p.companyId });
    expect(r.delivered).toBe(1);

    // Tenancy: another plant cannot read or resend these.
    const other = await apiPlant();
    await expect(other.admin.api.webhooks.deliveries({ id: endpointId })).rejects.toThrow("Not found");
    await expect(other.admin.api.webhooks.resend({ id: failed.items[0]!.id })).rejects.toThrow("Not found");
    const paused = await env.db.select().from(webhookEndpoint).where(and(eq(webhookEndpoint.id, endpointId), eq(webhookEndpoint.companyId, p.companyId))).get();
    expect(paused?.active).toBe(true);
  });
});
