/**
 * orrn buddy edges (fix round 2026-11-20): `HERMES_BASE_URL` must be https, http only for a localhost fake on the dev
 * stage (security L5); `auth.me` never fails when the buddy tables are missing, and reads nothing of the buddy for a
 * person who may not use it (review N4). Synthetic data only.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { sql } from "drizzle-orm";

import { buddyPlant, connect, FAKE_HERMES_ENV, setHermesEnv } from "./buddy-fixture";
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

describe("HERMES_BASE_URL must be https (security L5)", () => {
  test("https anywhere; http only for localhost or 127.0.0.1 on a development stage", async () => {
    const { resolveHermesConfig, hermesReady } = await import("../src/lib/buddy/config");
    const on = (url: string, NODE_ENV?: string) => resolveHermesConfig({ ...FAKE_HERMES_ENV, HERMES_BASE_URL: url, NODE_ENV }).ok;
    expect(on("https://hermes.orrn.in", "production")).toBe(true);
    expect(on("https://hermes.orrn.in")).toBe(true);
    expect(on("http://hermes.orrn.in", "production")).toBe(false);
    expect(on("http://hermes.orrn.in", "development")).toBe(false);
    expect(on("http://localhost:4790", "production")).toBe(false);
    expect(on("http://localhost:4790", "test")).toBe(false);
    expect(on("http://localhost:4790")).toBe(false);
    expect(on("http://localhost:4790", "development")).toBe(true);
    expect(on("http://127.0.0.1:4860", "development")).toBe(true);
    expect(on("http://localhost.evil.example:4790", "development")).toBe(false);
    const warn = (await import("bun:test")).spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(hermesReady({ ...FAKE_HERMES_ENV, HERMES_BASE_URL: "http://hermes.orrn.in", NODE_ENV: "production" })).toBe(false);
      expect(warn.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("hermes.orrn.in");
    } finally {
      warn.mockRestore();
    }
  });

  test("an http Hermes on a production stage keeps the buddy off: auth.me.buddy is false", async () => {
    const { workersEnv } = await import("./env-mock");
    const p = await buddyPlant(env);
    await connect(p);
    expect((await p.owner.auth.me()).buddy).toBe(true);
    workersEnv.HERMES_BASE_URL = "http://hermes.orrn.in";
    expect((await p.owner.auth.me()).buddy).toBe(false);
  });
});

describe("auth.me and the buddy (review N4)", () => {
  test("a person who may not use the buddy: buddyAccess reads nothing", async () => {
    const { buddyAccess } = await import("../src/lib/buddy/access");
    const p = await buddyPlant(env);
    const boom = new Proxy(env.db, {
      get(target, key) {
        if (key === "select" || key === "all" || key === "get") throw new Error("read");
        return Reflect.get(target, key);
      },
    });
    const ctx = { db: boom, companyId: p.companyId, role: "admin", impersonation: null, session: { user: { id: p.users.admin.id } } } as never;
    expect(await buddyAccess(ctx)).toMatchObject({ person: false, link: null });
  });

  test("the buddy tables are missing (the app deployed before its migrations): auth.me answers, buddy false", async () => {
    // Its own database, so dropping the tables touches no other test.
    const own = await createTestEnv();
    try {
      const p = await buddyPlant(own);
      await own.db.run(sql`drop table buddy_draft`);
      await own.db.run(sql`drop table buddy_call`);
      await own.db.run(sql`drop table buddy_grant`);
      await own.db.run(sql`drop table buddy_link`);
      const err = (await import("bun:test")).spyOn(console, "error").mockImplementation(() => {});
      try {
        const me = await p.owner.auth.me();
        expect(me.buddy).toBe(false);
        expect(me.company?.role).toBe("owner");
      } finally {
        err.mockRestore();
      }
    } finally {
      await own.dispose();
      // createTestEnv points the shared env at the newest database: point it back.
      const { workersEnv } = await import("./env-mock");
      workersEnv.DB = env.d1;
    }
  });
});
