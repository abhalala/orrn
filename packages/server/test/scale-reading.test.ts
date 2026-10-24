/**
 * scale.reading (FP-PK-02): the packing-bay scale through the plant's edge node.
 * A fake orrn-spool (Bun.serve on loopback) answers GET /scale/reading and checks ORRN's
 * Bearer v1 token exactly like the Go spool does.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { cast } from "@orrn/db/schema/foundry";
import { bundle, labelTemplate, printLog, printerProfile } from "@orrn/db/schema";
import { spoolDeployment } from "@orrn/db/schema/spool";
import { wrapSecret } from "@orrn/crypto";
import { eq } from "drizzle-orm";

import { DEV_MASTER_KEY, workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { normalizeScaleReading, simulatedScaleReading } from "../src/lib/scale";
import { SPOOL_TOKEN_MAX_SKEW_MS, verifySpoolToken } from "../src/lib/spool-crypto";
import { spoolBaseUrl } from "../src/lib/spool-client";

let env: TestEnv;

type Mode = "stable" | "settling" | "stale" | "zero" | "lying-stale" | "slow" | "error" | "garbage" | "not-configured";
let mode: Mode = "stable";
const seen: { path: string; tokenOk: boolean }[] = [];
const jobs: { variables: Record<string, string> }[] = [];
const NODE_SECRET = "fake-node-secret-for-scale-tests";
let server: ReturnType<typeof Bun.serve>;

function answer(): Response | Promise<Response> {
  switch (mode) {
    case "stable":
      return Response.json({ grams: 52415, stable: true, ageMs: 80, frames: 12, configured: true });
    case "settling":
      return Response.json({ grams: 52360, stable: false, ageMs: 60, frames: 3, reason: "settling", configured: true });
    case "stale":
      return Response.json({ stable: false, ageMs: 3400, frames: 0, reason: "stale", configured: true });
    case "zero":
      // A node that wrongly calls a steady zero stable: ORRN must still refuse it.
      return Response.json({ grams: 0, stable: true, ageMs: 50, frames: 30, configured: true });
    case "lying-stale":
      // Claims stable but the frame is 3.5 s old: ORRN must drop the grams.
      return Response.json({ grams: 52415, stable: true, ageMs: 3500, frames: 12, configured: true });
    case "slow":
      return new Promise((resolve) =>
        setTimeout(() => resolve(Response.json({ grams: 1, stable: true, ageMs: 1, frames: 5 })), 2500),
      );
    case "error":
      return new Response("boom", { status: 500 });
    case "garbage":
      return Response.json({ weight: "52.4 kg" });
    case "not-configured":
      return Response.json({ stable: false, frames: 0, reason: "not_configured", configured: false });
  }
}

beforeAll(async () => {
  env = await createTestEnv();
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname + url.search;
      const token = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
      const body = req.method === "GET" ? null : new Uint8Array(await req.arrayBuffer());
      const tokenOk = await verifySpoolToken(req.method, path, body, token, NODE_SECRET, SPOOL_TOKEN_MAX_SKEW_MS);
      seen.push({ path, tokenOk });
      if (!tokenOk) return Response.json({ error: "Invalid or expired token" }, { status: 401 });
      if (req.method === "POST" && path === "/api/jobs") {
        jobs.push(JSON.parse(new TextDecoder().decode(body!)));
        return Response.json({ id: 77 });
      }
      if (path !== "/scale/reading") return new Response("not found", { status: 404 });
      return answer();
    },
  });
});

afterAll(async () => {
  server.stop(true);
  delete workersEnv.SCALE_SIMULATOR;
  await env.dispose();
});

beforeEach(async () => {
  // spool_domain is unique and every fake node points at the same loopback port: one node at a time.
  await env.db.delete(spoolDeployment);
  mode = "stable";
  seen.length = 0;
  delete workersEnv.SCALE_SIMULATOR;
});

async function seedNode(
  companyId: string,
  opts: { status?: "pending" | "active" | "offline" | "revoked"; domain?: string; scaleConfigured?: boolean | null } = {},
) {
  const id = crypto.randomUUID();
  const tag = id.slice(0, 8);
  await env.db.insert(spoolDeployment).values({
    id,
    companyId,
    instanceId: crypto.randomUUID(),
    status: opts.status ?? "active",
    subdomain: `node-${tag}`,
    nodeDomain: opts.domain ?? `127.0.0.1:${server.port}`,
    cfTunnelTokenWrapped: await wrapSecret("tunnel", DEV_MASTER_KEY),
    sharedSecretHash: "hash",
    sharedSecretWrapped: await wrapSecret(NODE_SECRET, DEV_MASTER_KEY),
    scaleConfigured: opts.scaleConfigured ?? true,
  });
  return id;
}

describe("scale.reading through the node", () => {
  test("a packer gets the node's stable reading; ORRN signed the request with the node secret", async () => {
    const { companyId } = await env.seedCompany();
    const nodeId = await seedNode(companyId);
    const r = await env.caller({ role: "packer", companyId }).scale.reading({ nodeId });
    expect(r).toEqual({ grams: 52415, stable: true, ageMs: 80, frames: 12, configured: true, simulated: false, nodeId });
    expect(seen).toEqual([{ path: "/scale/reading", tokenOk: true }]);
  });

  test("without a nodeId the company's active node is used", async () => {
    const { companyId } = await env.seedCompany();
    const nodeId = await seedNode(companyId);
    const r = await env.caller({ role: "operator", companyId }).scale.reading();
    expect(r.nodeId).toBe(nodeId);
    expect(r.stable).toBe(true);
  });

  test("settling is passed through with grams and stable false", async () => {
    const { companyId } = await env.seedCompany();
    const nodeId = await seedNode(companyId);
    mode = "settling";
    const r = await env.caller({ role: "packer", companyId }).scale.reading({ nodeId });
    expect(r).toMatchObject({ grams: 52360, stable: false, reason: "settling" });
  });

  test("stale (> 3 s) is { stable: false } with no grams, even if the node claims stable", async () => {
    const { companyId } = await env.seedCompany();
    const nodeId = await seedNode(companyId);
    for (const m of ["stale", "lying-stale"] as const) {
      mode = m;
      const r = await env.caller({ role: "packer", companyId }).scale.reading({ nodeId });
      expect(r.stable).toBe(false);
      expect(r.reason).toBe("stale");
      expect(r.grams).toBeUndefined();
    }
  });

  test("a steady zero is never a stable weight", async () => {
    const { companyId } = await env.seedCompany();
    const nodeId = await seedNode(companyId);
    mode = "zero";
    const r = await env.caller({ role: "packer", companyId }).scale.reading({ nodeId });
    expect(r).toMatchObject({ grams: 0, stable: false, reason: "zero" });
  });

  test("a slow node times out to { stable: false } instead of hanging the pack screen", async () => {
    const { companyId } = await env.seedCompany();
    const nodeId = await seedNode(companyId);
    mode = "slow";
    const started = Date.now();
    const r = await env.caller({ role: "packer", companyId }).scale.reading({ nodeId });
    expect(Date.now() - started).toBeLessThan(2400);
    expect(r).toEqual({ stable: false, reason: "unreachable", configured: true, simulated: false, nodeId });
  });

  test("a node error or a malformed answer is { stable: false }", async () => {
    const { companyId } = await env.seedCompany();
    const nodeId = await seedNode(companyId);
    mode = "error";
    expect(await env.caller({ role: "packer", companyId }).scale.reading({ nodeId })).toMatchObject({
      stable: false,
      reason: "unreachable",
    });
    mode = "garbage";
    expect(await env.caller({ role: "packer", companyId }).scale.reading({ nodeId })).toMatchObject({
      stable: false,
      reason: "bad_answer",
    });
  });

  test("a node without a scale says configured false", async () => {
    const { companyId } = await env.seedCompany();
    const nodeId = await seedNode(companyId, { scaleConfigured: false });
    mode = "not-configured";
    const r = await env.caller({ role: "packer", companyId }).scale.reading({ nodeId });
    expect(r).toMatchObject({ stable: false, configured: false, reason: "not_configured" });
  });

  test("an unreachable node domain is { stable: false }", async () => {
    const { companyId } = await env.seedCompany();
    const nodeId = await seedNode(companyId, { domain: "127.0.0.1:1" });
    const r = await env.caller({ role: "packer", companyId }).scale.reading({ nodeId });
    expect(r).toMatchObject({ stable: false, reason: "unreachable" });
  });

  test("no node at all: no_node, configured false, no request made", async () => {
    const { companyId } = await env.seedCompany();
    const r = await env.caller({ role: "packer", companyId }).scale.reading();
    expect(r).toEqual({ stable: false, reason: "no_node", configured: false, simulated: false, nodeId: null });
    expect(seen).toHaveLength(0);
  });

  test("a revoked node is not asked", async () => {
    const { companyId } = await env.seedCompany();
    const nodeId = await seedNode(companyId, { status: "revoked" });
    const r = await env.caller({ role: "packer", companyId }).scale.reading({ nodeId });
    expect(r).toMatchObject({ stable: false, reason: "node_inactive", nodeId });
    expect(seen).toHaveLength(0);
  });
});

describe("scale.reading tenancy and permissions", () => {
  test("another company's node id is Not found and the node is never called", async () => {
    const a = await env.seedCompany();
    const b = await env.seedCompany();
    const bNode = await seedNode(b.companyId);
    await expect(env.caller({ role: "packer", companyId: a.companyId }).scale.reading({ nodeId: bNode })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Not found",
    });
    expect(seen).toHaveLength(0);
  });

  test("without a nodeId a company never falls back to another company's node", async () => {
    const a = await env.seedCompany();
    const b = await env.seedCompany();
    await seedNode(b.companyId);
    const r = await env.caller({ role: "packer", companyId: a.companyId }).scale.reading();
    expect(r).toMatchObject({ stable: false, reason: "no_node", nodeId: null });
  });

  test("only bundle.pack holders may read the scale", async () => {
    const { companyId } = await env.seedCompany();
    const nodeId = await seedNode(companyId);
    const allowed = ["owner", "admin", "manager", "supervisor", "operator", "packer"] as const;
    const refused = ["office", "accountant", "foundry", "press", "storekeeper", "die_room", "viewer"] as const;
    for (const role of allowed) {
      expect((await env.caller({ role, companyId }).scale.reading({ nodeId })).stable).toBe(true);
    }
    for (const role of refused) {
      await expect(env.caller({ role, companyId }).scale.reading({ nodeId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(env.caller(null).scale.reading({ nodeId })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(seen).toHaveLength(allowed.length);
  });
});

describe("SCALE_SIMULATOR dev path", () => {
  test("answers from the simulator without calling a node, and still checks permission", async () => {
    const { companyId } = await env.seedCompany();
    workersEnv.SCALE_SIMULATOR = "1";
    const r = await env.caller({ role: "packer", companyId }).scale.reading();
    expect(r.simulated).toBe(true);
    expect(r.configured).toBe(true);
    expect(seen).toHaveLength(0);
    await expect(env.caller({ role: "viewer", companyId }).scale.reading()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("is off in production even when the variable is set", async () => {
    const { companyId } = await env.seedCompany();
    workersEnv.SCALE_SIMULATOR = "1";
    const prev = workersEnv.NODE_ENV;
    workersEnv.NODE_ENV = "production";
    try {
      const r = await env.caller({ role: "packer", companyId }).scale.reading();
      expect(r).toMatchObject({ simulated: false, reason: "no_node" });
    } finally {
      workersEnv.NODE_ENV = prev;
    }
  });

  test("a cycle shows zero, settling, a stable weight, the nudge, and lift-off", () => {
    const cycle = 14_000 * 1000;
    const at = (ms: number) => simulatedScaleReading(cycle + ms);
    expect(at(1000)).toMatchObject({ grams: 0, stable: false, reason: "zero" });
    expect(at(4000)).toMatchObject({ stable: false, reason: "settling" });
    const held = at(7000);
    expect(held.stable).toBe(true);
    expect(held.grams).toBeGreaterThanOrEqual(25_000);
    expect(held.grams! % 5).toBe(0);
    expect(at(5900).stable).toBe(false); // held < 1 s
    expect(at(12_000)).toMatchObject({ stable: true, grams: held.grams! + 45 });
    expect(at(13_999).stable).toBe(false);
  });
});

describe("normalizeScaleReading (hard edges re-applied on the server)", () => {
  test("drops grams when stale or missing ageMs, refuses zero and negatives, flags bad answers", () => {
    expect(normalizeScaleReading({ grams: 5, stable: true, frames: 5 }, null)).toMatchObject({ stable: false });
    expect(normalizeScaleReading({ grams: 5000, stable: true, ageMs: 3001, frames: 5 }, null).grams).toBeUndefined();
    expect(normalizeScaleReading({ grams: 5000, stable: true, ageMs: 3000, frames: 5 }, null).stable).toBe(true);
    expect(normalizeScaleReading({ grams: -5, stable: true, ageMs: 10, frames: 9 }, null)).toMatchObject({
      stable: false,
      reason: "zero",
    });
    expect(normalizeScaleReading({ grams: 5000.5, stable: true, ageMs: 10 }, null).reason).toBe("bad_answer");
    expect(normalizeScaleReading("nope", "n1")).toMatchObject({ stable: false, reason: "bad_answer", nodeId: "n1" });
  });
});

describe("spoolBaseUrl", () => {
  test("https for real nodes, http only for loopback", () => {
    expect(spoolBaseUrl("fourcubes.spool.orrn.in")).toBe("https://fourcubes.spool.orrn.in");
    expect(spoolBaseUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    expect(spoolBaseUrl("localhost:8080")).toBe("http://localhost:8080");
    expect(spoolBaseUrl("localhost.evil.example")).toBe("https://localhost.evil.example");
  });
});

describe("deploymentStatus exposes scale presence", () => {
  test("scale fields come back for the Printing screen", async () => {
    const { companyId } = await env.seedCompany();
    const nodeId = await seedNode(companyId);
    const at = new Date("2026-10-24T06:29:59.900Z");
    await env.db.update(spoolDeployment).set({ scaleLastFrameAt: at, scaleReportedAt: at }).where(eq(spoolDeployment.id, nodeId));
    const s = await env.caller({ role: "viewer", companyId }).spool.deploymentStatus();
    expect(s).toMatchObject({ id: nodeId, scaleConfigured: true, scaleLastFrameAt: at, scaleReportedAt: at });
    const o = await env.caller({ role: "viewer", companyId }).edge.overview();
    expect(o.current).toMatchObject({ id: nodeId, scaleConfigured: true, scaleLastFrameAt: at });
  });
});

describe("cast label placeholder reaches the spool job", () => {
  test("printBundleLabel sends cast = the bundle's cast number, signed with the node secret", async () => {
    const { companyId } = await env.seedCompany();
    await seedNode(companyId);
    const dieId = await env.seedDie(companyId);
    const [b] = await env.seedBundles(companyId, dieId, 1);
    const castId = crypto.randomUUID();
    await env.db.insert(cast).values({
      id: castId,
      companyId,
      number: "K31",
      period: "2026-11",
      year: 2026,
      month: 11,
      seq: 31,
      alloy: "6063",
      openedAt: new Date(),
    });
    await env.db.update(bundle).set({ castId }).where(eq(bundle.id, b!.id));
    const templateId = crypto.randomUUID();
    await env.db.insert(labelTemplate).values({ id: templateId, companyId, name: "Bundle", kind: "bundle", schema: {}, spoolTemplateId: "5" });
    await env.db.insert(printerProfile).values({ id: crypto.randomUUID(), companyId, name: "Bay", spoolPrinterId: "3", templateId });
    jobs.length = 0;

    await env.caller({ role: "packer", companyId }).spool.printBundleLabel({ bundleId: b!.id });

    expect(seen).toEqual([{ path: "/api/jobs", tokenOk: true }]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.variables.cast).toBe("K31");
    const [log] = await env.db.select().from(printLog).where(eq(printLog.bundleId, b!.id));
    expect((log!.variables as Record<string, string>).cast).toBe("K31");
  });
});
