/**
 * BACKLOG 44 (print exactly once): `spool.printBundleLabel` sends the spool a job key
 * `bundle:<serial>:label:v<template version>:attempt:<n>`. `attempt` is stored on the print log row and
 * rises only on an explicit reprint; a retry of the same print reuses it. A 200 `duplicate:true` is
 * success (the first job id is recorded); a 409 `job_key_conflict` is a bug, logged and refused.
 * A fake orrn-spool (Bun.serve on loopback) implements the Go spool's job_key contract.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { wrapSecret } from "@orrn/crypto";
import { bundle, labelTemplate, printLog, printerProfile } from "@orrn/db/schema";
import { spoolDeployment } from "@orrn/db/schema/spool";
import { asc, eq } from "drizzle-orm";

import { DEV_MASTER_KEY } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { SPOOL_TOKEN_MAX_SKEW_MS, verifySpoolToken } from "../src/lib/spool-crypto";

let env: TestEnv;
let server: ReturnType<typeof Bun.serve>;
const SECRET = "fake-node-secret-for-job-key-tests";

type Stored = { id: number; key: string; body: string };
const stored = new Map<string, Stored>();
const posts: { job_key?: string; variables: Record<string, string> }[] = [];
let nextId = 100;
/**
 * "lose-reply": the spool stores the job but the answer never arrives (502).
 * "down": the request never reaches the spool's job store (502, nothing stored or answered).
 */
let mode: "normal" | "lose-reply" | "down" = "normal";

beforeAll(async () => {
  env = await createTestEnv();
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname + url.search;
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      const raw = new Uint8Array(await req.arrayBuffer());
      if (!(await verifySpoolToken(req.method, path, raw, token, SECRET, SPOOL_TOKEN_MAX_SKEW_MS))) {
        return Response.json({ error: "Invalid or expired token" }, { status: 401 });
      }
      if (req.method !== "POST" || path !== "/api/jobs") return new Response("not found", { status: 404 });
      if (mode === "down") return new Response("bad gateway", { status: 502 });
      const text = new TextDecoder().decode(raw);
      const body = JSON.parse(text) as { job_key?: string; variables: Record<string, string>; copies: number };
      posts.push(body);
      const key = body.job_key;
      const content = JSON.stringify({ v: body.variables, c: body.copies });
      if (key) {
        const first = stored.get(key);
        if (first) {
          if (first.body !== content) return Response.json({ error: "job_key_conflict", id: first.id, job_key: key }, { status: 409 });
          return Response.json({ id: first.id, job_id: first.id, duplicate: true, job_key: key }, { status: 200 });
        }
      }
      const id = nextId++;
      if (key) stored.set(key, { id, key, body: content });
      if (mode === "lose-reply") return new Response("bad gateway", { status: 502 });
      return Response.json({ id, duplicate: false, job_key: key }, { status: 201 });
    },
  });
}, 60_000);

afterAll(async () => {
  server.stop(true);
  await env.dispose();
});

beforeEach(async () => {
  await env.db.delete(spoolDeployment);
  stored.clear();
  posts.length = 0;
  mode = "normal";
});

async function plant(opts: { templateVersion?: number; node?: boolean } = {}) {
  const { companyId } = await env.seedCompany();
  // spool_domain is unique and the fake node is one loopback port: one node at a time.
  if (opts.node !== false) await env.db.insert(spoolDeployment).values({
    id: crypto.randomUUID(),
    companyId,
    instanceId: crypto.randomUUID(),
    status: "active",
    subdomain: `node-${companyId.slice(0, 8)}`,
    nodeDomain: `127.0.0.1:${server.port}`,
    cfTunnelTokenWrapped: await wrapSecret("tunnel", DEV_MASTER_KEY),
    sharedSecretHash: "hash",
    sharedSecretWrapped: await wrapSecret(SECRET, DEV_MASTER_KEY),
  });
  const dieId = await env.seedDie(companyId);
  const [b] = await env.seedBundles(companyId, dieId, 1);
  const templateId = crypto.randomUUID();
  await env.db.insert(labelTemplate).values({
    id: templateId,
    companyId,
    name: "Bundle",
    kind: "bundle",
    schema: {},
    spoolTemplateId: "5",
    version: opts.templateVersion ?? 1,
  });
  await env.db.insert(printerProfile).values({ id: crypto.randomUUID(), companyId, name: "Bay", spoolPrinterId: "3", templateId });
  const packer = env.caller({ role: "packer", companyId });
  const [row] = await env.db.select({ serial: bundle.serial }).from(bundle).where(eq(bundle.id, b!.id));
  const logs = () => env.db.select().from(printLog).where(eq(printLog.bundleId, b!.id)).orderBy(asc(printLog.createdAt));
  return { companyId, packer, bundleId: b!.id, serial: row!.serial, templateId, logs };
}

describe("spool.printBundleLabel job key", () => {
  test("the first print sends bundle:<serial>:label:v<version>:attempt:1 and stores attempt, version and key on the log", async () => {
    const p = await plant({ templateVersion: 3 });
    const r = await p.packer.spool.printBundleLabel({ bundleId: p.bundleId });
    const key = `bundle:${p.serial}:label:v3:attempt:1`;
    expect(posts.map((x) => x.job_key)).toEqual([key]);
    const [log] = await p.logs();
    expect(log).toMatchObject({ attempt: 1, labelVersion: 3, jobKey: key, status: "sent", spoolJobId: String(r.spoolJobId) });
  });

  test("a transport retry (the reply was lost) reuses the key: the spool answers duplicate:true, which is success with the first job id", async () => {
    const p = await plant();
    mode = "lose-reply";
    await expect(p.packer.spool.printBundleLabel({ bundleId: p.bundleId })).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    mode = "normal";
    const r = await p.packer.spool.printBundleLabel({ bundleId: p.bundleId });
    expect(new Set(posts.map((x) => x.job_key)).size).toBe(1);
    const firstId = [...stored.values()][0]!.id;
    expect(r.spoolJobId).toBe(firstId); // the first (stored) job, not a new one
    expect(stored.size).toBe(1);
    const logs = await p.logs();
    expect(logs.map((l) => [l.status, l.attempt])).toEqual([
      ["failed", 1],
      ["sent", 1],
    ]);
    expect(logs[1]!.spoolJobId).toBe(String(firstId));
  });

  test("a plain second print of an already printed bundle is the same intent: no second label, attempt stays 1", async () => {
    const p = await plant();
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId });
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId });
    expect(stored.size).toBe(1);
    expect((await p.logs()).map((l) => l.attempt)).toEqual([1, 1]);
  });

  test("an explicit reprint is a new key: attempt 2, then 3, each stored on its own log row", async () => {
    const p = await plant();
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId });
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId, reprint: true });
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId, reprint: true });
    expect(posts.map((x) => x.job_key)).toEqual([
      `bundle:${p.serial}:label:v1:attempt:1`,
      `bundle:${p.serial}:label:v1:attempt:2`,
      `bundle:${p.serial}:label:v1:attempt:3`,
    ]);
    expect(stored.size).toBe(3);
    expect((await p.logs()).map((l) => l.attempt)).toEqual([1, 2, 3]);
  });

  test("a retry of a reprint reuses the reprint's key, not a further attempt", async () => {
    const p = await plant();
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId });
    mode = "lose-reply";
    await expect(p.packer.spool.printBundleLabel({ bundleId: p.bundleId, reprint: true })).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    mode = "normal";
    // The transport retry is the same print (no reprint flag): it carries attempt 2 again.
    const r = await p.packer.spool.printBundleLabel({ bundleId: p.bundleId });
    expect(r.spoolJobId).toBeGreaterThan(0);
    expect(posts.map((x) => x.job_key).slice(1)).toEqual([`bundle:${p.serial}:label:v1:attempt:2`, `bundle:${p.serial}:label:v1:attempt:2`]);
  });

  test("I-1(a): the spool failed the job (webhook job_failed); a Reprint is a new key and a label comes out", async () => {
    const p = await plant();
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId });
    // The spool's job_failed webhook marks the row failed; its spool job id stays.
    await env.db.update(printLog).set({ status: "failed", responseText: "jam" }).where(eq(printLog.bundleId, p.bundleId));
    const r = await p.packer.spool.printBundleLabel({ bundleId: p.bundleId, reprint: true });
    expect(posts.map((x) => x.job_key)).toEqual([`bundle:${p.serial}:label:v1:attempt:1`, `bundle:${p.serial}:label:v1:attempt:2`]);
    expect(stored.size).toBe(2); // a second job was queued, not answered as a duplicate
    expect(r.spoolJobId).not.toBe([...stored.values()][0]!.id);
    expect((await p.logs()).map((l) => [l.attempt, l.status])).toEqual([
      [1, "failed"],
      [2, "sent"],
    ]);
  });

  test("I-1(b): attempt 1 printed, a later plain print lost its reply (newest attempt-1 row failed); a Reprint is still a new key", async () => {
    const p = await plant();
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId });
    mode = "down";
    await expect(p.packer.spool.printBundleLabel({ bundleId: p.bundleId })).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    mode = "normal";
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId, reprint: true });
    expect(posts.map((x) => x.job_key).at(-1)).toBe(`bundle:${p.serial}:label:v1:attempt:2`);
    expect(stored.size).toBe(2);
    expect((await p.logs()).map((l) => [l.attempt, l.status])).toEqual([
      [1, "sent"],
      [1, "failed"],
      [2, "sent"],
    ]);
  });

  test("I-1: the first print's reply was lost; a retry without reprint reuses the key and nothing new is queued", async () => {
    const p = await plant();
    mode = "lose-reply";
    await expect(p.packer.spool.printBundleLabel({ bundleId: p.bundleId })).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    mode = "normal";
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId });
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId });
    expect(new Set(posts.map((x) => x.job_key))).toEqual(new Set([`bundle:${p.serial}:label:v1:attempt:1`]));
    expect(stored.size).toBe(1);
  });

  test("I-1: a print that never reached the spool is not a label that went out; Reprint reuses attempt 1", async () => {
    const p = await plant();
    mode = "down";
    await expect(p.packer.spool.printBundleLabel({ bundleId: p.bundleId })).rejects.toMatchObject({ code: "BAD_GATEWAY" });
    mode = "normal";
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId, reprint: true });
    expect(posts.at(-1)!.job_key).toBe(`bundle:${p.serial}:label:v1:attempt:1`);
    expect(stored.size).toBe(1);
  });

  test("m-3: new label content under the same intent (other copies, a changed sales order) is a new attempt, not a 409", async () => {
    const p = await plant();
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId });
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      await p.packer.spool.printBundleLabel({ bundleId: p.bundleId, copies: 3 });
      expect(spy.mock.calls.some((c) => String(c[0]).includes("job_key_conflict"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
    // The same content again is a retry of that new intent.
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId, copies: 3 });
    expect(posts.map((x) => x.job_key)).toEqual([
      `bundle:${p.serial}:label:v1:attempt:1`,
      `bundle:${p.serial}:label:v1:attempt:2`,
      `bundle:${p.serial}:label:v1:attempt:2`,
    ]);
    expect(stored.size).toBe(2);
    expect((await p.logs()).every((l) => typeof l.payloadHash === "string" && l.payloadHash.length === 64)).toBe(true);
  });

  test("a changed label layout (template version) is a deliberately new print with its own key", async () => {
    const p = await plant();
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId });
    await env.db.update(labelTemplate).set({ version: 2 }).where(eq(labelTemplate.id, p.templateId));
    await p.packer.spool.printBundleLabel({ bundleId: p.bundleId });
    expect(posts.map((x) => x.job_key)).toEqual([`bundle:${p.serial}:label:v1:attempt:1`, `bundle:${p.serial}:label:v2:attempt:1`]);
  });

  test("409 job_key_conflict is a bug: logged, the row fails with it, and the caller gets an internal error (never a silent success)", async () => {
    const p = await plant();
    // A key already used by the spool for different content.
    stored.set(`bundle:${p.serial}:label:v1:attempt:1`, { id: 999, key: "k", body: "{}" });
    const spy = spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(p.packer.spool.printBundleLabel({ bundleId: p.bundleId })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
      expect(spy.mock.calls.some((c) => String(c[0]).includes("job_key_conflict"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
    const [log] = await p.logs();
    expect(log).toMatchObject({ status: "failed" });
    expect(log!.responseText).toContain("job_key_conflict");
  });

  test("a bundle of another plant is still not found (the key logic never reads across companies)", async () => {
    const a = await plant();
    const b = await plant({ node: false });
    await expect(b.packer.spool.printBundleLabel({ bundleId: a.bundleId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(posts).toHaveLength(0);
  });
});
