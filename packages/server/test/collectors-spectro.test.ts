/**
 * W4-COLLECTORS spectro watcher seam (FP-FD-12): node-signed ingest idempotent on the file's
 * SHA-256, signed PUT into (fake) R2 with a hash check, `pending_review` until a person with
 * cast.enter attaches it to a melt (never automatic), dismiss, permissions.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { wrapSecret } from "@orrn/crypto";
import { spectroInbox } from "@orrn/db/schema/collector";
import { cast, melt, spectroResult } from "@orrn/db/schema/foundry";
import { spoolDeployment } from "@orrn/db/schema/spool";
import { auditLog } from "@orrn/db/schema/audit";
import { and, eq } from "drizzle-orm";

import { DEV_MASTER_KEY } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;
let lib: typeof import("../src/lib/spectroInbox");
let node: typeof import("../src/lib/collectorNode");
let sc: typeof import("../src/lib/spool-crypto");

beforeAll(async () => {
  env = await createTestEnv();
  lib = await import("../src/lib/spectroInbox");
  node = await import("../src/lib/collectorNode");
  sc = await import("../src/lib/spool-crypto");
});

afterAll(async () => {
  await env.dispose();
});

const enc = (v: unknown) => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v));
const sha = async (b: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b)), (x) => x.toString(16).padStart(2, "0")).join("");

/** In-memory R2 with the two calls the upload uses. */
function fakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string; meta?: Record<string, string> }>();
  const bucket = {
    objects,
    puts: 0,
    async head(key: string) {
      return objects.has(key) ? ({ key } as unknown as R2Object) : null;
    },
    async put(key: string, value: unknown, opts?: R2PutOptions) {
      bucket.puts += 1;
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(await new Response(value as BodyInit).arrayBuffer());
      objects.set(key, { bytes, contentType: (opts?.httpMetadata as R2HTTPMetadata | undefined)?.contentType, meta: opts?.customMetadata });
      return { key } as unknown as R2Object;
    },
  };
  return bucket;
}

async function plant(secret = "spectro-secret") {
  const { companyId } = await env.seedCompany();
  const nodeId = crypto.randomUUID();
  const instanceId = crypto.randomUUID();
  await env.db.insert(spoolDeployment).values({
    id: nodeId,
    companyId,
    instanceId,
    status: "active",
    subdomain: `sp-${nodeId.slice(0, 8)}`,
    nodeDomain: `sp-${nodeId.slice(0, 8)}.spool.orrn.in`,
    cfTunnelTokenWrapped: await wrapSecret("tunnel", DEV_MASTER_KEY),
    sharedSecretHash: "hash",
    sharedSecretWrapped: await wrapSecret(secret, DEV_MASTER_KEY),
  });
  const castId = crypto.randomUUID();
  await env.db.insert(cast).values({ id: castId, companyId, number: "K31", period: "2026-10", year: 2026, month: 10, seq: 31, alloy: "6063", openedAt: new Date() });
  const meltId = crypto.randomUUID();
  await env.db.insert(melt).values({ id: meltId, companyId, castId, seq: 1, alloy: "6063" });
  const ingest = async (file: Uint8Array, over: Record<string, unknown> = {}, opts: { secret?: string; auth?: string | null; storageReady?: boolean } = {}) => {
    const rawBody = enc({
      instance_id: instanceId,
      sha256: await sha(file),
      fileName: "K31-1.csv",
      contentType: "text/csv",
      sizeBytes: file.byteLength,
      sampleRef: "K31/1",
      instrument: "sim-oes",
      simulated: true,
      valuesPct: { Si: 0.45, Fe: 0.18, Mg: 0.55 },
      ...over,
    });
    const token = await sc.signSpoolRequest("POST", lib.SPECTRO_INGEST_PATH, rawBody, opts.secret ?? secret);
    return node.handleSpectroIngestRequest(env.db, {
      rawBody,
      authorization: opts.auth === undefined ? `Bearer ${token}` : opts.auth,
      masterKey: DEV_MASTER_KEY,
      origin: "https://api.test",
      storageReady: opts.storageReady ?? true,
    });
  };
  return { companyId, nodeId, instanceId, castId, meltId, ingest };
}

const put = (bucket: ReturnType<typeof fakeBucket>, url: string, bytes: Uint8Array, nowMs?: number) =>
  lib.handleSpectroUpload(env.db, new Request(url, { method: "PUT", body: bytes, headers: { "content-length": String(bytes.byteLength) } }), {
    bucket,
    masterKey: DEV_MASTER_KEY,
    nowMs,
  });

const csv = (n: number) => enc(`sample,Si,Fe,Cu,Mn,Mg,Zn,Ti,Cr\nK31/${n},0.45,0.18,0.01,0.02,0.55,0.01,0.01,0.00\n`);

describe("POST /collector/spectro/ingest + signed PUT", () => {
  test("first ingest asks for the bytes; the PUT lands pending_review; same hash again is a duplicate", async () => {
    const p = await plant();
    const bucket = fakeBucket();
    const file = csv(1);
    const r1 = await p.ingest(file);
    expect(r1.status).toBe(200);
    const b1 = r1.body as { status: string; id: string; uploadUrl: string };
    expect(b1.status).toBe("upload");
    expect(b1.uploadUrl.startsWith("https://api.test/collector/spectro/upload?u=")).toBe(true);

    // Lost the response, asked again before uploading: same row, a fresh link.
    const r2 = await p.ingest(file);
    expect(r2.body).toMatchObject({ status: "upload", id: b1.id });

    const res = await put(bucket, b1.uploadUrl, file);
    expect(res.status).toBe(200);
    const key = `${p.companyId}/spectro/${b1.id}`;
    expect(bucket.objects.get(key)?.bytes).toEqual(file);
    expect(bucket.objects.get(key)?.contentType).toBe("text/csv");

    const row = await env.db.select().from(spectroInbox).where(eq(spectroInbox.id, b1.id)).get();
    expect(row).toMatchObject({ status: "pending_review", simulated: true, sampleRef: "K31/1", valuesPpm: { Si: 4500, Fe: 1800, Mg: 5500 }, meltId: null, spectroResultId: null });

    // Idempotent on sha256: the watcher re-sends after a restart.
    const r3 = await p.ingest(file, { fileName: "K31-1 (copy).csv" });
    expect(r3.body).toEqual({ status: "duplicate", id: b1.id, inboxStatus: "pending_review" });
    // A repeated PUT is harmless.
    expect((await put(bucket, b1.uploadUrl, file)).status).toBe(200);
    expect(bucket.puts).toBe(1);
    expect(await env.db.select().from(spectroInbox).where(eq(spectroInbox.companyId, p.companyId))).toHaveLength(1);
    // Never attached on its own.
    expect(await env.db.select().from(spectroResult).where(eq(spectroResult.meltId, p.meltId))).toHaveLength(0);
  });

  test("the PUT refuses bytes that do not match the hash or size, a forged or expired link", async () => {
    const p = await plant();
    const bucket = fakeBucket();
    const file = csv(2);
    const b = (await p.ingest(file)).body as { id: string; uploadUrl: string };
    const evil = csv(3);
    expect((await put(bucket, b.uploadUrl, evil)).status).toBe(422);
    expect((await put(bucket, b.uploadUrl, enc("short"))).status).toBe(400);
    const forged = b.uploadUrl.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    expect((await put(bucket, forged, file)).status).toBe(403);
    expect((await put(bucket, b.uploadUrl, file, Date.now() + 11 * 60_000)).status).toBe(403);
    expect(bucket.objects.size).toBe(0);
    expect((await env.db.select().from(spectroInbox).where(eq(spectroInbox.id, b.id)).get())!.status).toBe("uploading");
    expect((await put(bucket, b.uploadUrl, file, undefined)).status).toBe(200);
  });

  test("no storage: 503, nothing recorded; bad body: 400", async () => {
    const p = await plant();
    expect((await p.ingest(csv(4), {}, { storageReady: false })).status).toBe(503);
    expect((await p.ingest(csv(4), { contentType: "application/x-msdownload" })).status).toBe(400);
    expect((await p.ingest(csv(4), { sizeBytes: 6 * 1024 * 1024 })).status).toBe(400);
    expect(await env.db.select().from(spectroInbox).where(eq(spectroInbox.companyId, p.companyId))).toHaveLength(0);
  });

  test("permissions: node HMAC only (unsigned, wrong secret refused); hashes are per company", async () => {
    const p = await plant();
    const q = await plant("other-plant");
    const file = csv(5);
    expect((await p.ingest(file, {}, { auth: null })).status).toBe(401);
    expect((await p.ingest(file, {}, { secret: "other-plant" })).status).toBe(403);
    expect(await env.db.select().from(spectroInbox).where(eq(spectroInbox.companyId, p.companyId))).toHaveLength(0);
    // The same file at another plant is that plant's own row.
    const a = (await p.ingest(file)).body as { id: string };
    const b = (await q.ingest(file)).body as { id: string };
    expect(a.id).not.toBe(b.id);
  });
});

describe("foundry.spectroInbox", () => {
  /** A received (pending_review) file; real unless `simulated` (a simulated file cannot be attached, I-4). */
  async function received(p: Awaited<ReturnType<typeof plant>>, n: number, simulated = false) {
    const bucket = fakeBucket();
    const file = csv(n);
    const b = (await p.ingest(file, { simulated, instrument: simulated ? "sim-oes" : "oes" })).body as { id: string; uploadUrl: string };
    await put(bucket, b.uploadUrl, file);
    return b.id;
  }

  test("cast.enter attaches to a melt it names; the result keeps the R2 key and the parsed values", async () => {
    const p = await plant();
    const id = await received(p, 10);
    const foundry = env.caller({ role: "foundry", companyId: p.companyId });
    expect((await foundry.foundry.spectroInbox.list()).map((r) => r.id)).toEqual([id]);
    const out = await foundry.foundry.spectroInbox.attach({ id, meltId: p.meltId });
    const result = await env.db.select().from(spectroResult).where(eq(spectroResult.id, out.spectroResultId)).get();
    expect(result).toMatchObject({ meltId: p.meltId, castId: p.castId, fileKey: `${p.companyId}/spectro/${id}`, dataBase64: "", valuesPpm: { Si: 4500, Fe: 1800, Mg: 5500 } });
    expect(await env.db.select().from(spectroInbox).where(eq(spectroInbox.id, id)).get()).toMatchObject({ status: "attached", meltId: p.meltId, spectroResultId: out.spectroResultId });
    const audit = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.subjectId, out.spectroResultId))).get();
    expect(audit).toMatchObject({ action: "spectro.attach" });
    expect((audit!.meta as Record<string, unknown>).source).toBe("collector");
    // Twice: refused.
    await expect(foundry.foundry.spectroInbox.attach({ id, meltId: p.meltId })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await foundry.foundry.spectroInbox.list()).toEqual([]);
  });

  test("a file still uploading cannot be attached; dismiss needs a reason; other roles are refused", async () => {
    const p = await plant();
    const pending = ((await p.ingest(csv(11))).body as { id: string }).id;
    const foundry = env.caller({ role: "foundry", companyId: p.companyId });
    await expect(foundry.foundry.spectroInbox.attach({ id: pending, meltId: p.meltId })).rejects.toMatchObject({ code: "CONFLICT" });
    const id = await received(p, 12);
    for (const role of ["viewer", "press", "office", "packer"] as const) {
      await expect(env.caller({ role, companyId: p.companyId }).foundry.spectroInbox.attach({ id, meltId: p.meltId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(env.caller({ role, companyId: p.companyId }).foundry.spectroInbox.dismiss({ id, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(foundry.foundry.spectroInbox.dismiss({ id, reason: " " })).rejects.toBeDefined();
    await env.caller({ role: "supervisor", companyId: p.companyId }).foundry.spectroInbox.dismiss({ id, reason: "Test sample, not a melt" });
    expect(await env.db.select().from(spectroInbox).where(eq(spectroInbox.id, id)).get()).toMatchObject({ status: "dismissed", dismissReason: "Test sample, not a melt" });
    // A dismissed file is still known by hash: the watcher re-sending it gets "duplicate".
    expect((await p.ingest(csv(12))).body).toMatchObject({ status: "duplicate", inboxStatus: "dismissed" });
    // Another company's melt is not found.
    const q = await plant("q");
    const other = await received(q, 13);
    await expect(env.caller({ role: "foundry", companyId: q.companyId }).foundry.spectroInbox.attach({ id: other, meltId: p.meltId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a simulated file is listed, marked simulated, and cannot be attached to a melt (I-4)", async () => {
    const p = await plant();
    const id = await received(p, 20, true);
    const foundry = env.caller({ role: "foundry", companyId: p.companyId });
    expect(await foundry.foundry.spectroInbox.list()).toEqual([expect.objectContaining({ id, simulated: true, status: "pending_review" })]);
    await expect(foundry.foundry.spectroInbox.attach({ id, meltId: p.meltId })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Simulated file — demo only" });
    expect(await env.db.select().from(spectroResult).where(eq(spectroResult.meltId, p.meltId))).toHaveLength(0);
    expect(await env.db.select().from(spectroInbox).where(eq(spectroInbox.id, id)).get()).toMatchObject({ status: "pending_review", meltId: null });
    // Dismissing it is fine.
    await foundry.foundry.spectroInbox.dismiss({ id, reason: "Demo file from the simulator" });
    expect(await env.db.select().from(spectroInbox).where(eq(spectroInbox.id, id)).get()).toMatchObject({ status: "dismissed" });
  });
});

describe("review round 1: spectro values sanity and bounded upload", () => {
  test("values that add up to more than 10 % of alloying elements are dropped as a suggestion (m-5)", async () => {
    const p = await plant();
    // A ppm export read as percent: Ti 50 ppm became 50 %.
    const b = (await p.ingest(csv(30), { valuesPct: { Si: 45, Ti: 50, Mg: 55 } })).body as { id: string };
    expect((await env.db.select().from(spectroInbox).where(eq(spectroInbox.id, b.id)).get())!.valuesPpm).toBeNull();
    // An aluminium figure alongside is not counted.
    const c = (await p.ingest(csv(31), { valuesPct: { Al: 98.2, Si: 0.45, Mg: 0.55 } })).body as { id: string };
    expect((await env.db.select().from(spectroInbox).where(eq(spectroInbox.id, c.id)).get())!.valuesPpm).toEqual({ Al: 982_000, Si: 4500, Mg: 5500 });
  });

  test("the PUT needs a Content-Length and a node body is refused past the limit before it is read (m-8)", async () => {
    const p = await plant();
    const bucket = fakeBucket();
    const file = csv(32);
    const b = (await p.ingest(file)).body as { id: string; uploadUrl: string };
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(file);
        c.close();
      },
    });
    const res = await lib.handleSpectroUpload(env.db, new Request(b.uploadUrl, { method: "PUT", body: stream, duplex: "half" } as RequestInit), { bucket, masterKey: DEV_MASTER_KEY });
    expect(res.status).toBe(411);
    expect(bucket.objects.size).toBe(0);

    const big = new Uint8Array(node.COLLECTOR_MAX_BODY_BYTES + 1);
    expect(await node.readCollectorBody(new Request("https://api.test/x", { method: "POST", body: big, headers: { "content-length": String(big.byteLength) } }))).toEqual({ ok: false, status: 413 });
    const chunked = new ReadableStream({
      start(c) {
        c.enqueue(big.subarray(0, 200_000));
        c.enqueue(big.subarray(200_000));
        c.close();
      },
    });
    expect(await node.readCollectorBody(new Request("https://api.test/x", { method: "POST", body: chunked, duplex: "half" } as RequestInit))).toEqual({ ok: false, status: 413 });
    const ok = await node.readCollectorBody(new Request("https://api.test/x", { method: "POST", body: "{}" }));
    expect(ok.ok && new TextDecoder().decode(ok.body)).toBe("{}");
  });
});
