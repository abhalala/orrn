import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { DEV_LOCAL_TRUSTED_ORIGINS } from "@orrn/auth/origins";

import { isDevLocalOrigin } from "../src/lib/devOrigins";
import { resolveCorsOrigin } from "../src/lib/corsOrigin";

const WEB = "https://app.orrn.in";
const prod = { NODE_ENV: "production", CORS_ORIGIN: WEB, CORS_ALLOWED_ORIGINS: WEB };
const dev = { NODE_ENV: "development", CORS_ORIGIN: "http://localhost:3002", CORS_ALLOWED_ORIGINS: "http://localhost:3002" };

/** The same middleware wiring as apps/server/src/index.ts, driven through Hono. */
function appFor(env: typeof prod | typeof dev) {
  const app = new Hono();
  app.use("/*", cors({ origin: (origin) => resolveCorsOrigin(env, origin), credentials: true }));
  app.get("/", (c) => c.text("OK"));
  return app;
}

async function allowOrigin(env: typeof prod | typeof dev, origin: string) {
  const res = await appFor(env).request("/", { headers: { Origin: origin } });
  return res.headers.get("access-control-allow-origin");
}

describe("isDevLocalOrigin (per-worktree ports)", () => {
  test("any localhost / 127.0.0.1 port is accepted in development", () => {
    for (const port of [3001, 3002, 3003, 3201, 3291, 3293, 5173, 65535]) {
      expect(isDevLocalOrigin({ NODE_ENV: "development" }, `http://localhost:${port}`)).toBe(true);
      expect(isDevLocalOrigin({ NODE_ENV: "development" }, `http://127.0.0.1:${port}`)).toBe(true);
    }
  });

  test("production, test and unset NODE_ENV never accept them", () => {
    for (const NODE_ENV of ["production", "test", "staging", undefined]) {
      expect(isDevLocalOrigin({ NODE_ENV }, "http://localhost:3201")).toBe(false);
      expect(isDevLocalOrigin({ NODE_ENV }, "http://127.0.0.1:3201")).toBe(false);
    }
  });

  test("lookalikes and non-http origins are refused even in development", () => {
    const d = { NODE_ENV: "development" };
    for (const origin of [
      "http://localhost", // no port: not a dev server of ours
      "http://localhost:",
      "http://localhost:abc",
      "http://localhost:3201/path",
      "http://localhost:3201.evil.example",
      "http://localhost.evil.example:3201",
      "http://evil.example:3201",
      "http://evil.example/localhost:3201",
      "http://user@localhost:3201",
      "https://localhost:3201",
      "http://[::1]:3201",
      "http://localhost:99999",
      "http://localhost:0",
      "",
    ]) {
      expect(isDevLocalOrigin(d, origin)).toBe(false);
    }
  });
});

describe("Better Auth trusted origins mirror the CORS rule", () => {
  // packages/auth adds these patterns in development only; CORS uses isDevLocalOrigin. A browser needs both
  // to agree, or sign-in from a worktree's web port passes CORS and then fails with INVALID_ORIGIN.
  test("the auth wildcard hosts are exactly the hosts isDevLocalOrigin accepts", () => {
    const hosts = DEV_LOCAL_TRUSTED_ORIGINS.map((pattern) => pattern.replace(/:\*$/, ""));
    expect(hosts).toEqual(["http://localhost", "http://127.0.0.1"]);
    for (const host of hosts) {
      expect(isDevLocalOrigin({ NODE_ENV: "development" }, `${host}:3293`)).toBe(true);
    }
    expect(DEV_LOCAL_TRUSTED_ORIGINS.every((pattern) => pattern.endsWith(":*") && pattern.startsWith("http://"))).toBe(true);
  });
});

describe("CORS through the middleware", () => {
  test("production still rejects localhost origins on any port (no allow-origin echo)", async () => {
    for (const origin of [
      "http://localhost:3001",
      "http://localhost:3002",
      "http://localhost:3201",
      "http://127.0.0.1:3293",
    ]) {
      expect(await allowOrigin(prod, origin)).toBe(WEB); // falls back to the one configured origin, never echoes
      expect(await allowOrigin(prod, origin)).not.toBe(origin);
    }
  });

  test("production still allows its configured web origin", async () => {
    expect(await allowOrigin(prod, WEB)).toBe(WEB);
  });

  test("development echoes any localhost and 127.0.0.1 port, with credentials", async () => {
    for (const origin of ["http://localhost:3201", "http://127.0.0.1:3293", "http://localhost:3002"]) {
      const res = await appFor(dev).request("/", { headers: { Origin: origin } });
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    }
  });

  test("development still refuses foreign origins", async () => {
    expect(await allowOrigin(dev, "https://evil.example")).toBe(dev.CORS_ORIGIN);
    expect(await allowOrigin(dev, "http://localhost.evil.example:3201")).toBe(dev.CORS_ORIGIN);
  });

  test("a request without an Origin header gets the configured origin", () => {
    expect(resolveCorsOrigin(prod, "")).toBe(WEB);
    expect(resolveCorsOrigin(dev, "")).toBe(dev.CORS_ORIGIN);
  });
});
