/**
 * Security review 2026-11-04, MEDIUM 4. `alchemy.run.ts` bound `process.env.ORRN_MASTER_KEY ?? devMasterKey`, the
 * public all-zero key, on every stage. A production deploy without the key (a laptop `.env`) shipped a key anyone
 * with the source knows: die-file and download URLs could be forged and wrapped node secrets read. Now:
 *   - the deploy refuses outside the dev stage when the key is missing or is the all-zero key;
 *   - the key is bound as an encrypted secret, never plain text;
 *   - a production Worker that still finds an unusable key refuses every request (503) instead of serving.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";

import { isUnsafeMasterKey, PUBLIC_DEV_MASTER_KEY } from "@orrn/crypto";

import { deployMasterKey } from "../src/infra/masterKey";
import { masterKeyGate } from "../src/lib/masterKeyGate";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOOD = Buffer.from("a-real-production-key-0123456789").toString("base64");
const ZERO_SPELLINGS = [PUBLIC_DEV_MASTER_KEY, ` ${PUBLIC_DEV_MASTER_KEY} `, Buffer.alloc(32).toString("base64")];

describe("isUnsafeMasterKey", () => {
  test("missing, blank and every spelling of the all-zero key are unsafe; a real key is not", () => {
    for (const key of [undefined, "", "   ", ...ZERO_SPELLINGS]) expect({ key, unsafe: isUnsafeMasterKey(key) }).toEqual({ key, unsafe: true });
    expect(isUnsafeMasterKey(GOOD)).toBe(false);
    expect(isUnsafeMasterKey("a long passphrase that is hashed into a key")).toBe(false);
  });
});

describe("deployMasterKey (alchemy.run.ts)", () => {
  test("outside the dev stage a missing or all-zero key stops the deploy", () => {
    for (const value of [undefined, "", ...ZERO_SPELLINGS]) {
      expect(() => deployMasterKey({ isDevStage: false, value })).toThrow(/ORRN_MASTER_KEY/);
    }
  });

  test("outside the dev stage a real key is used as given", () => {
    expect(deployMasterKey({ isDevStage: false, value: GOOD })).toBe(GOOD);
    expect(deployMasterKey({ isDevStage: false, value: ` ${GOOD} ` })).toBe(GOOD);
  });

  test("the dev stage may still fall back to the public dev key", () => {
    expect(deployMasterKey({ isDevStage: true, value: undefined })).toBe(PUBLIC_DEV_MASTER_KEY);
    expect(deployMasterKey({ isDevStage: true, value: GOOD })).toBe(GOOD);
  });

  test("alchemy.run.ts binds the key only through the guard, as an encrypted secret", () => {
    const src = readFileSync(join(HERE, "../src/infra/alchemy.run.ts"), "utf8");
    expect(src).not.toMatch(/ORRN_MASTER_KEY\s*\?\?/);
    expect(src).not.toContain("devMasterKey");
    expect(src).toMatch(/ORRN_MASTER_KEY:\s*alchemy\.secret\(masterKey\)/);
    expect(src).toMatch(/const masterKey = deployMasterKey\(\{ isDevStage, value: process\.env\.ORRN_MASTER_KEY \}\)/);
  });
});

describe("masterKeyGate (the Worker refuses to serve with an unusable key)", () => {
  function app(env: { NODE_ENV?: string; ORRN_MASTER_KEY?: string }) {
    const a = new Hono();
    a.use("*", masterKeyGate(() => env));
    a.get("/", (c) => c.text("OK"));
    a.post("/api/auth/sign-in/email", (c) => c.text("signed in"));
    return a;
  }

  test("production with a missing or all-zero key answers 503 on every path", async () => {
    for (const key of [undefined, "", ...ZERO_SPELLINGS]) {
      for (const [method, path] of [["GET", "/"], ["POST", "/api/auth/sign-in/email"]] as const) {
        const res = await app({ NODE_ENV: "production", ORRN_MASTER_KEY: key }).request(path, { method });
        expect({ key, path, status: res.status }).toEqual({ key, path, status: 503 });
      }
    }
  });

  test("production with a real key, and every non-production stage, serve normally", async () => {
    expect((await app({ NODE_ENV: "production", ORRN_MASTER_KEY: GOOD }).request("/")).status).toBe(200);
    for (const NODE_ENV of ["development", "test", undefined]) {
      expect((await app({ NODE_ENV, ORRN_MASTER_KEY: PUBLIC_DEV_MASTER_KEY }).request("/")).status).toBe(200);
    }
  });

  test("the API mounts the gate before anything else", () => {
    const src = readFileSync(join(HERE, "../../../apps/server/src/index.ts"), "utf8");
    const gate = src.indexOf("app.use(masterKeyGate(");
    expect(gate).toBeGreaterThan(-1);
    for (const later of ['app.on(["POST", "GET"], "/api/auth/*"', 'app.route("/", spoolRoutes)', '"/trpc/*"']) {
      expect(src.indexOf(later)).toBeGreaterThan(gate);
    }
  });
});
