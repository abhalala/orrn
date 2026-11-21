import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { initTRPC } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { resolveCorsOrigin } from "../src/lib/corsOrigin";
import { trpcCsrfRefusal } from "../src/lib/trpcCsrf";

/**
 * Fix round item 15 (BUDDY-SECURITY-REVIEW M5): a tRPC POST must be JSON, and an Origin, when sent, must be on the
 * CORS allowlist. The app below is wired like apps/server/src/index.ts: CORS, then the guard, then tRPC. Its one
 * mutation takes no input, the class a cross-site form could fire before the guard.
 */
const WEB = "https://app.orrn.in";
const env = { NODE_ENV: "production", CORS_ORIGIN: WEB, CORS_ALLOWED_ORIGINS: WEB };

function makeApp(guard: boolean) {
  const t = initTRPC.create();
  let fired = 0;
  const router = t.router({
    ping: t.procedure.query(() => "pong"),
    fire: t.procedure.mutation(() => ++fired),
  });
  const app = new Hono();
  app.use("/*", cors({ origin: (origin) => resolveCorsOrigin(env, origin), credentials: true }));
  if (guard) {
    app.use("/trpc/*", async (c, next) => {
      const refused = trpcCsrfRefusal(env, c.req.raw);
      if (refused) return c.text(refused.message, refused.status);
      await next();
    });
  }
  // What @hono/trpc-server does in the Worker: hand the raw request to the fetch adapter.
  app.all("/trpc/*", (c) => fetchRequestHandler({ endpoint: "/trpc", req: c.req.raw, router }));
  return { app, fired: () => fired };
}

const post = (headers: Record<string, string>, body: BodyInit) => ({ method: "POST", headers, body });

describe("tRPC CSRF guard", () => {
  test("without the guard, a multipart form reaches a no-input mutation (the hole this closes)", async () => {
    const { app, fired } = makeApp(false);
    const form = new FormData();
    form.set("x", "1");
    const res = await app.request("/trpc/fire", { method: "POST", headers: { Origin: "https://evil.example" }, body: form });
    expect(res.status).toBe(200);
    expect(fired()).toBe(1);
  });

  test("a text/plain mutation is refused with 415 and does not run", async () => {
    const { app, fired } = makeApp(true);
    const res = await app.request("/trpc/fire", post({ "content-type": "text/plain", Origin: "https://evil.example" }, "{}"));
    expect(res.status).toBe(415);
    expect(fired()).toBe(0);
  });

  test("a multipart mutation is refused with 415 and does not run", async () => {
    const { app, fired } = makeApp(true);
    const form = new FormData();
    form.set("x", "1");
    const res = await app.request("/trpc/fire", { method: "POST", body: form });
    expect(res.status).toBe(415);
    expect(fired()).toBe(0);
  });

  test("a urlencoded mutation is refused with 415", async () => {
    const { app, fired } = makeApp(true);
    const res = await app.request("/trpc/fire", post({ "content-type": "application/x-www-form-urlencoded" }, "a=1"));
    expect(res.status).toBe(415);
    expect(fired()).toBe(0);
  });

  test("JSON from the allowed origin passes, and keeps its CORS header", async () => {
    const { app, fired } = makeApp(true);
    const res = await app.request("/trpc/fire", post({ "content-type": "application/json", Origin: WEB }, "{}"));
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(fired()).toBe(1);
  });

  test("JSON from a foreign origin is refused with 403 and does not run", async () => {
    const { app, fired } = makeApp(true);
    const res = await app.request("/trpc/fire", post({ "content-type": "application/json; charset=utf-8", Origin: "https://evil.example" }, "{}"));
    expect(res.status).toBe(403);
    expect(fired()).toBe(0);
  });

  test("JSON with no Origin passes (the native app, server to server)", async () => {
    const { app, fired } = makeApp(true);
    const res = await app.request("/trpc/fire", post({ "content-type": "application/json" }, "{}"));
    expect(res.status).toBe(200);
    expect(fired()).toBe(1);
  });

  test("a batched JSON call (httpBatchLink's shape) passes", async () => {
    const { app, fired } = makeApp(true);
    const res = await app.request("/trpc/fire?batch=1", post({ "content-type": "application/json", Origin: WEB }, JSON.stringify({ 0: {} })));
    expect(res.status).toBe(200);
    expect(fired()).toBe(1);
  });

  test("GET queries are unchanged, from any origin and with no content type", async () => {
    const { app } = makeApp(true);
    for (const headers of [{}, { Origin: WEB }, { Origin: "https://evil.example" }] as Record<string, string>[]) {
      const res = await app.request("/trpc/ping", { headers });
      expect(res.status).toBe(200);
    }
  });

  test("the Worker mounts the guard on /trpc/* before the tRPC handler", () => {
    const src = readFileSync(join(import.meta.dir, "..", "..", "..", "apps", "server", "src", "index.ts"), "utf8");
    const guard = src.indexOf("trpcCsrfRefusal(env, c.req.raw)");
    const handler = src.indexOf("trpcServer({");
    expect(guard).toBeGreaterThan(-1);
    expect(handler).toBeGreaterThan(guard);
    expect(src.indexOf('app.use("/trpc/*", async (c, next) => {')).toBeGreaterThan(src.indexOf("cors({"));
  });
});
