/**
 * Chunked raw upload (limits brief part B, plan docs/superpowers/plans/2026-11-20-chunked-upload.md): a file over one
 * part goes to the vault by the R2 multipart API, each part checked by its SHA-256 as it streams, the whole file checked
 * after complete. Real D1 and a real Miniflare R2 bucket (part size rules, ETags and aborts as R2 does them). Bun has no
 * `crypto.DigestStream` or `FixedLengthStream`; small stand-ins with the same contract are installed below.
 */
import { createHash, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Miniflare } from "miniflare";

import { workersEnv } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { plant, putBlocksPicked, type Plant } from "./ingest-portal-helpers";
import { handleIngestRead, handleIngestUpload, issueReadTicket, issueTicket, pageKey, rawKey } from "../src/lib/ingest/vault";
import { ingestArtifact } from "@orrn/db/schema/ingest";
import { eq } from "drizzle-orm";
import {
  CHECK_FAILED,
  CHECK_RUNNING,
  DIGEST_MISMATCH,
  PARTS_MISSING,
  SOMEONE_ELSE_SENDING,
  UPLOAD_RAN_OUT,
  abortIfAbandoned,
  checkKey,
  sweepUnfinishedUploads,
  RAW_PART_BYTES,
  handleIngestPart,
  partBytes,
  partCountFor,
  readPartTicket,
  uploadPlanKey,
} from "../src/lib/ingest/upload-parts";

// --- Workers stand-ins (workerd has these natively) -------------------------------------------------------------
const g = globalThis as unknown as { FixedLengthStream?: unknown; crypto: { DigestStream?: unknown } };
if (!g.FixedLengthStream) {
  g.FixedLengthStream = class extends TransformStream {
    constructor(_length: number) {
      super();
    }
  };
}
if (!g.crypto.DigestStream) {
  g.crypto.DigestStream = class extends WritableStream<Uint8Array> {
    readonly digest: Promise<ArrayBuffer>;
    constructor(_alg: string) {
      const h = createHash("sha256");
      let done!: (b: ArrayBuffer) => void;
      const digest = new Promise<ArrayBuffer>((r) => (done = r));
      super({
        write(chunk) {
          h.update(chunk);
        },
        close() {
          const b = h.digest();
          done(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
        },
      });
      this.digest = digest;
    }
  };
}

let env: TestEnv;
let mf: Miniflare;
let raw: R2Bucket;

/**
 * The Miniflare bucket lives in another process: a stream crossing into it needs a known length and a body cannot
 * cross back as a stream. This wrapper buffers at that boundary; the Worker's own binding streams.
 */
const toBytes = async (v: unknown) =>
  v instanceof Uint8Array ? v : typeof v === "string" ? new TextEncoder().encode(v) : new Uint8Array(await new Response(v as ReadableStream).arrayBuffer());
function wrapUpload(u: R2MultipartUpload): R2MultipartUpload {
  return {
    key: u.key,
    uploadId: u.uploadId,
    uploadPart: async (n: number, v: unknown) => u.uploadPart(n, await toBytes(v)),
    abort: () => u.abort(),
    complete: (parts: R2UploadedPart[]) => u.complete(parts),
  } as R2MultipartUpload;
}
/** Calls the Worker made on the bucket, by method, for the cost tests (S9). */
const calls: { method: string; key: string }[] = [];
/** Runs after a `get` body is read to its end (to race the whole-file check, N6). */
let afterBodyRead: ((key: string) => Promise<void>) | null = null;
const vault = () =>
  ({
    head: (k: string) => (calls.push({ method: "head", key: k }), raw.head(k)),
    list: (o: R2ListOptions) => (calls.push({ method: "list", key: o.prefix ?? "" }), raw.list(o)),
    delete: (k: string | string[]) => raw.delete(k),
    put: async (k: string, v: unknown, o?: R2PutOptions) => (calls.push({ method: "put", key: k }), raw.put(k, await toBytes(v), o)),
    get: async (k: string, o?: R2GetOptions) => {
      calls.push({ method: "get", key: k });
      const obj = await raw.get(k, o);
      if (!obj) return null;
      const bytes = new Uint8Array(await obj.arrayBuffer());
      const hook = afterBodyRead;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(bytes);
        },
        async pull(c) {
          if (hook) await hook(k);
          c.close();
        },
      });
      return { size: obj.size, etag: obj.etag, customMetadata: obj.customMetadata, body, text: async () => new TextDecoder().decode(bytes) };
    },
    createMultipartUpload: async (k: string, o?: R2MultipartOptions) => wrapUpload(await raw.createMultipartUpload(k, o)),
    resumeMultipartUpload: (k: string, id: string) => wrapUpload(raw.resumeMultipartUpload(k, id)),
  }) as unknown as R2Bucket;

beforeAll(async () => {
  env = await createTestEnv();
  mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", r2Buckets: ["VAULT"] });
  raw = (await mf.getR2Bucket("VAULT")) as unknown as R2Bucket;
}, 60_000);

afterEach(async () => {
  workersEnv.INGEST_VAULT = vault();
  afterBodyRead = null;
  const { setClockForTests } = await import("../src/lib/clock");
  setClockForTests(null);
});

afterAll(async () => {
  delete workersEnv.INGEST_VAULT;
  await mf.dispose();
  await env.dispose();
});

const hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** A synthetic file just over one part (two parts), different for every call. */
function bigFile(extra = 4096): Uint8Array {
  const bytes = new Uint8Array(RAW_PART_BYTES + extra);
  const seed = new TextEncoder().encode(randomUUID());
  for (let i = 0; i < bytes.length; i += 4096) bytes.set(seed.subarray(0, Math.min(seed.length, bytes.length - i)), i);
  bytes[bytes.length - 1] = 7;
  return bytes;
}
const partsOf = (bytes: Uint8Array) =>
  Array.from({ length: partCountFor(bytes.length) }, (_, i) => bytes.subarray(i * RAW_PART_BYTES, i * RAW_PART_BYTES + partBytes(bytes.length, i + 1)));

async function begun(p?: Plant, bytes = bigFile()) {
  workersEnv.INGEST_VAULT = vault();
  const pl = p ?? (await plant(env));
  const sha256 = hex(bytes);
  const begin = await pl.owner.ingest.artifact.begin({ sha256, fileName: "big.pdf", sizeBytes: bytes.length, contentType: "application/pdf", kind: "pdf_scan" });
  return { p: pl, bytes, sha256, artifactId: begin.artifactId, begin, parts: partsOf(bytes) };
}

function putPart(url: string, body: Uint8Array, length = body.byteLength) {
  return handleIngestPart(new Request(url, { method: "PUT", body, headers: { "content-length": String(length) } }), { bucket: vault() });
}

async function sendAll(f: Awaited<ReturnType<typeof begun>>, only?: number[]) {
  const start = await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: f.parts.map(hex) });
  const want = (only ?? f.parts.map((_, i) => i + 1)).filter((n) => !start.done.includes(n));
  for (const t of await ticketsFor(f, want)) expect((await putPart(t.url, f.parts[t.part - 1]!)).status).toBe(200);
  return start;
}

/** Tickets for every part named, asked as the browser asks: a few at a time (PART_TICKETS_ISSUED a call). */
async function ticketsFor(f: { p: Plant; artifactId: string }, want: number[]) {
  const out: { part: number; url: string }[] = [];
  let left = [...want];
  while (left.length > 0) {
    const { tickets } = await f.p.owner.ingest.artifact.uploadTickets({ artifactId: f.artifactId, parts: left.slice(0, 8) });
    out.push(...tickets);
    left = left.filter((n) => !tickets.some((t) => t.part === n));
  }
  return out;
}

/** The recorded parts as R2 completes them: one marker per part, the ETag in its custom metadata. */
async function markerEtags(companyId: string, sha256: string, uploadId: string) {
  const list = await raw.list({ prefix: `tenants/${companyId}/artifacts/${sha256}/upload/${uploadId}/`, include: ["customMetadata"] } as R2ListOptions);
  return list.objects
    .map((o) => ({ partNumber: Number(/p(\d+)$/.exec(o.key)![1]), etag: o.customMetadata!.etag! }))
    .sort((a, b) => a.partNumber - b.partNumber);
}

const artifactRow = (f: { p: Plant; artifactId: string }) => f.p.owner.ingest.artifact.get({ artifactId: f.artifactId });

describe("begin", () => {
  test("no size refusal by kind: a photo of 40 MB and a sheet of 300 MB begin; over one part the answer is parts", async () => {
    workersEnv.INGEST_VAULT = vault();
    const p = await plant(env);
    const photo = await p.owner.ingest.artifact.begin({ sha256: hex(new TextEncoder().encode(randomUUID())), fileName: "slip.png", sizeBytes: 40 * 1024 * 1024, contentType: "image/png", kind: "image" });
    expect(photo.upload).toBeNull();
    expect(photo.parts).toEqual({ partSize: RAW_PART_BYTES, partCount: 3 });
    const sheet = await p.owner.ingest.artifact.begin({ sha256: hex(new TextEncoder().encode(randomUUID())), fileName: "book.xlsx", sizeBytes: 300 * 1024 * 1024, contentType: null, kind: "sheet" });
    expect(sheet.parts?.partCount).toBe(19);
    // A file of one part keeps the single PUT.
    const small = await p.owner.ingest.artifact.begin({ sha256: hex(new TextEncoder().encode(randomUUID())), fileName: "a.csv", sizeBytes: RAW_PART_BYTES, contentType: "text/csv", kind: "csv" });
    expect(small.upload?.url).toContain("/files/ingest/upload?ticket=");
    expect(small.parts).toBeNull();
  });
});

describe("multipart upload", () => {
  test("parts go up with their digests, complete checks the whole file, the artifact is stored and the records go", async () => {
    const f = await begun();
    expect(f.begin.parts).toEqual({ partSize: RAW_PART_BYTES, partCount: 2 });
    const start = await sendAll(f);
    expect(start).toEqual({ partSize: RAW_PART_BYTES, partCount: 2, done: [] });
    expect((await artifactRow(f)).vaultState).toBe("pending");
    expect(await f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).toEqual({ vaultState: "stored" });
    expect((await artifactRow(f)).vaultState).toBe("stored");
    const obj = await raw.get(rawKey(f.p.companyId, f.sha256));
    expect(hex(new Uint8Array(await obj!.arrayBuffer()))).toBe(f.sha256);
    expect(obj!.customMetadata?.upload).toBe("parts");
    expect((await raw.list({ prefix: `tenants/${f.p.companyId}/artifacts/${f.sha256}/upload/` })).objects).toEqual([]);
    // Again is a no-op.
    expect(await f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).toEqual({ vaultState: "stored" });
  });

  test("a part ticket names one part, its exact size and digest; other purposes and sizes are refused", async () => {
    const f = await begun();
    await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: f.parts.map(hex) });
    const { tickets } = await f.p.owner.ingest.artifact.uploadTickets({ artifactId: f.artifactId, parts: [2] });
    const ticket = new URL(tickets[0]!.url).searchParams.get("ticket")!;
    expect(await readPartTicket(ticket)).toMatchObject({ part: 2, size: 4096, partSha256: hex(f.parts[1]!), companyId: f.p.companyId });
    // A wrong length is refused before any byte goes to R2.
    expect((await putPart(tickets[0]!.url, f.parts[1]!, 4095)).status).toBe(400);
    // A part ticket is not an upload ticket, and an upload ticket is not a part ticket.
    expect((await handleIngestUpload(new Request(tickets[0]!.url.replace("/part?", "/upload?"), { method: "PUT", body: f.parts[1]!, headers: { "content-length": "4096" } }), { bucket: vault() })).status).toBe(403);
    const small = await f.p.owner.ingest.artifact.begin({ sha256: hex(new TextEncoder().encode(randomUUID())), fileName: "a.csv", sizeBytes: 4, contentType: "text/csv", kind: "csv" });
    expect((await putPart(small.upload!.url.replace("/upload?", "/part?"), new Uint8Array(4))).status).toBe(403);
    // Expired.
    expect((await handleIngestPart(new Request(tickets[0]!.url, { method: "PUT", body: f.parts[1]!, headers: { "content-length": "4096" } }), { bucket: vault(), now: Date.now() + 11 * 60 * 1000 })).status).toBe(403);
    // A part past the file is refused when tickets are asked.
    await expect(f.p.owner.ingest.artifact.uploadTickets({ artifactId: f.artifactId, parts: [3] })).rejects.toThrow("The part list does not match this file");
    // Another plant cannot name this artifact.
    const other = await plant(env);
    await expect(other.owner.ingest.artifact.uploadTickets({ artifactId: f.artifactId, parts: [1] })).rejects.toThrow("Import file not found");
  });

  test("a wrong part digest is refused with 400 and the part stays missing until the right bytes come", async () => {
    const f = await begun();
    await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: f.parts.map(hex) });
    const tickets = await ticketsFor(f, [1, 2]);
    expect((await putPart(tickets[0]!.url, f.parts[0]!)).status).toBe(200);
    const wrong = new Uint8Array(f.parts[1]!);
    wrong[0] = wrong[0]! ^ 0xff;
    const res = await putPart(tickets[1]!.url, wrong);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("The part does not match its digest");
    await expect(f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).rejects.toThrow(PARTS_MISSING);
    // Resume answers part 1 done; part 2 with the right bytes, then complete.
    const again = await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: f.parts.map(hex) });
    expect(again.done).toEqual([1]);
    expect((await putPart(tickets[1]!.url, f.parts[1]!)).status).toBe(200);
    expect((await f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).vaultState).toBe("stored");
  });

  test("a wrong whole digest: parts that match their own digests but not the file's SHA-256 are deleted, never stored", async () => {
    // The browser names the SHA-256 of one file and sends the parts of another: each part matches the digest it was
    // signed with, so only the whole-file check can catch it.
    const p = await plant(env);
    const named = bigFile();
    const sent = bigFile();
    const f = await begun(p, named);
    const otherParts = partsOf(sent);
    await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: otherParts.map(hex) });
    const tickets = await ticketsFor(f, [1, 2]);
    for (const t of tickets) expect((await putPart(t.url, otherParts[t.part - 1]!)).status).toBe(200);
    await expect(f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).rejects.toThrow(DIGEST_MISMATCH);
    expect(await raw.head(rawKey(p.companyId, f.sha256))).toBeNull();
    expect(await raw.head(uploadPlanKey(p.companyId, f.sha256))).toBeNull();
    expect((await artifactRow(f)).vaultState).toBe("pending");
    // One failed check marks the file failed with plain words (decision 4); complete is not tried forever.
    expect((await artifactRow(f)).readState).toBe("failed");
    expect((await artifactRow(f)).readError).toBe(DIGEST_MISMATCH);
    await expect(f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).rejects.toThrow("The upload ran out");
    // Nothing to read: the raw read is not signed.
    await expect(f.p.owner.ingest.vision.readUrl({ artifactId: f.artifactId, what: "raw" })).rejects.toThrow("Import file not found");
  });

  test("resume after a dropped connection sends only the missing parts", async () => {
    const f = await begun();
    await sendAll(f, [2]);
    const start = await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: f.parts.map(hex) });
    expect(start.done).toEqual([2]);
    const { tickets } = await f.p.owner.ingest.artifact.uploadTickets({ artifactId: f.artifactId, parts: [1] });
    expect((await putPart(tickets[0]!.url, f.parts[0]!)).status).toBe(200);
    expect((await f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).vaultState).toBe("stored");
    // A begin of the same bytes now hands nothing to send.
    const again = await f.p.owner.ingest.artifact.begin({ sha256: f.sha256, fileName: "big.pdf", sizeBytes: f.bytes.length, contentType: "application/pdf", kind: "pdf_scan" });
    expect(again.upload).toBeNull();
    expect(again.parts).toBeNull();
  });

  test("a plan close to the 1-day lifecycle abort is started again, not resumed", async () => {
    const f = await begun();
    await sendAll(f, [1]);
    // The plan as if it were written 21 hours ago (resumed only within 20 hours).
    const key = uploadPlanKey(f.p.companyId, f.sha256);
    const old = await raw.get(key);
    const plan = JSON.parse(await old!.text()) as { createdAt: number };
    await raw.put(key, JSON.stringify({ ...plan, createdAt: Date.now() - 21 * 60 * 60 * 1000 }), { customMetadata: old!.customMetadata });
    const start = await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: f.parts.map(hex) });
    expect(start.done).toEqual([]);
    await sendAll(f);
    expect((await f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).vaultState).toBe("stored");
  });

  test("other digests for the same file start a new upload; the old one's tickets answer 409", async () => {
    const f = await begun();
    await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: f.parts.map(hex) });
    const { tickets } = await f.p.owner.ingest.artifact.uploadTickets({ artifactId: f.artifactId, parts: [1] });
    const fake = [hex(new Uint8Array([1])), hex(new Uint8Array([2]))];
    expect((await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: fake })).done).toEqual([]);
    expect((await putPart(tickets[0]!.url, f.parts[0]!)).status).toBe(409);
  });

  test("abort on discard: the multipart upload and its records go; the next begin starts afresh", async () => {
    const f = await begun();
    await sendAll(f, [1]);
    const plan = JSON.parse(await (await raw.get(uploadPlanKey(f.p.companyId, f.sha256)))!.text()) as { uploadId: string };
    expect(await f.p.owner.ingest.artifact.uploadAbort({ artifactId: f.artifactId })).toEqual({ aborted: true });
    expect((await raw.list({ prefix: `tenants/${f.p.companyId}/artifacts/${f.sha256}/` })).objects).toEqual([]);
    // R2 no longer has the upload.
    await expect(raw.resumeMultipartUpload(rawKey(f.p.companyId, f.sha256), plan.uploadId).uploadPart(2, f.parts[1]!)).rejects.toThrow();
    // A part ticket of the old upload has nothing to go to.
    await expect(f.p.owner.ingest.artifact.uploadTickets({ artifactId: f.artifactId, parts: [2] })).rejects.toThrow("The upload ran out. Add the same file again.");
    const start = await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: f.parts.map(hex) });
    expect(start.done).toEqual([]);
  });

  test("commitRaw inside the window: an object made from parts is stored only through the whole-file check", async () => {
    const p = await plant(env);
    const named = bigFile();
    const f = await begun(p, named);
    const otherParts = partsOf(bigFile());
    await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: otherParts.map(hex) });
    const tickets = await ticketsFor(f, [1, 2]);
    for (const t of tickets) await putPart(t.url, otherParts[t.part - 1]!);
    // Completed straight on R2 (as if the answer of uploadComplete were lost before the check ran).
    const plan = JSON.parse(await (await raw.get(uploadPlanKey(p.companyId, f.sha256)))!.text()) as { uploadId: string };
    await raw.resumeMultipartUpload(rawKey(p.companyId, f.sha256), plan.uploadId).complete(await markerEtags(p.companyId, f.sha256, plan.uploadId));
    expect(await raw.head(rawKey(p.companyId, f.sha256))).not.toBeNull();
    // The raw read is not signed before the check.
    await expect(f.p.owner.ingest.vision.readUrl({ artifactId: f.artifactId, what: "raw" })).rejects.toThrow("Import file not found");
    // The single PUT's commitRaw goes through the check, which deletes the object.
    await expect(f.p.owner.ingest.artifact.commitRaw({ artifactId: f.artifactId })).rejects.toThrow(DIGEST_MISMATCH);
    expect(await raw.head(rawKey(p.companyId, f.sha256))).toBeNull();
    expect((await artifactRow(f)).vaultState).toBe("pending");
  });

  test("a lost answer after complete: start says every part is done, complete checks again and stores", async () => {
    const f = await begun();
    await sendAll(f);
    const plan = JSON.parse(await (await raw.get(uploadPlanKey(f.p.companyId, f.sha256)))!.text()) as { uploadId: string };
    await raw.resumeMultipartUpload(rawKey(f.p.companyId, f.sha256), plan.uploadId).complete(await markerEtags(f.p.companyId, f.sha256, plan.uploadId));
    expect((await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: f.parts.map(hex) })).done).toEqual([1, 2]);
    expect((await f.p.owner.ingest.artifact.commitRaw({ artifactId: f.artifactId })).vaultState).toBe("stored");
  });
});

describe("vision.readUrl raw (gate 5)", () => {
  test("a raw read is signed only once the artifact is stored, even when the object is already in the bucket", async () => {
    workersEnv.INGEST_VAULT = vault();
    const p = await plant(env);
    const bytes = new TextEncoder().encode(`%PDF synthetic ${randomUUID()}`);
    const sha256 = hex(bytes);
    const begin = await p.owner.ingest.artifact.begin({ sha256, fileName: "small.pdf", sizeBytes: bytes.length, contentType: "application/pdf", kind: "pdf_scan" });
    await raw.put(rawKey(p.companyId, sha256), bytes);
    await expect(p.owner.ingest.vision.readUrl({ artifactId: begin.artifactId, what: "raw" })).rejects.toThrow("Import file not found");
    await p.owner.ingest.artifact.commitRaw({ artifactId: begin.artifactId });
    expect((await p.owner.ingest.vision.readUrl({ artifactId: begin.artifactId, what: "raw" })).url).toContain("/files/ingest/read?ticket=");
  });
});

describe("read route Range", () => {
  const stored = async () => {
    workersEnv.INGEST_VAULT = vault();
    const p = await plant(env);
    const bytes = new TextEncoder().encode("0123456789abcdefghij");
    const sha256 = hex(bytes);
    await raw.put(rawKey(p.companyId, sha256), bytes);
    const read = await issueReadTicket({ request: null }, { companyId: p.companyId, userId: "u_1", artifactId: "a_1", sha256, key: rawKey(p.companyId, sha256), as: "raw" });
    return read.url.startsWith("http") ? read.url : `https://api.test${read.url}`;
  };
  const get = (url: string, range?: string) => handleIngestRead(new Request(url, range ? { headers: { range } } : {}), { bucket: vault() });

  test("one range answers 206 with Content-Range and Content-Length; the gate 5 headers stay", async () => {
    const url = await stored();
    const r = await get(url, "bytes=2-5");
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 2-5/20");
    expect(r.headers.get("content-length")).toBe("4");
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(await r.text()).toBe("2345");
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
    expect(r.headers.get("content-disposition")).toBe("attachment");
    expect(r.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await (await get(url, "bytes=15-")).text()).toBe("fghij");
    expect(await (await get(url, "bytes=-3")).text()).toBe("hij");
    const clamp = await get(url, "bytes=18-99");
    expect(clamp.headers.get("content-range")).toBe("bytes 18-19/20");
  });

  test("a range past the end is 416; several or a malformed range gets the whole file with Accept-Ranges", async () => {
    const url = await stored();
    const past = await get(url, "bytes=20-");
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */20");
    for (const h of [undefined, "bytes=0-1,4-5", "items=0-1", "bytes=5-2"]) {
      const r = await get(url, h);
      expect(r.status).toBe(200);
      expect(r.headers.get("accept-ranges")).toBe("bytes");
      expect(r.headers.get("content-length")).toBe("20");
      expect((await r.text()).length).toBe(20);
    }
  });
});

describe("fix round: part markers, the whole-file check and who may restart", () => {
  test("S8: a recorded ETag R2 no longer holds (two PUTs of one part crossed) asks for the parts again; the upload stays", async () => {
    const f = await begun();
    await sendAll(f);
    const planKey = uploadPlanKey(f.p.companyId, f.sha256);
    const plan = JSON.parse(await (await raw.get(planKey))!.text()) as { uploadId: string };
    // Part 1's marker names an ETag that is not the part R2 holds.
    await raw.put(`tenants/${f.p.companyId}/artifacts/${f.sha256}/upload/${encodeURIComponent(plan.uploadId)}/p1`, "", { customMetadata: { etag: "0123456789abcdef0123456789abcdef" } });
    await expect(f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).rejects.toThrow(PARTS_MISSING);
    // Not wiped: the same plan and multipart upload, every part to send again.
    expect(JSON.parse(await (await raw.get(planKey))!.text()).uploadId).toBe(plan.uploadId);
    const again = await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: f.parts.map(hex) });
    expect(again.done).toEqual([]);
    await sendAll(f);
    expect((await f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).vaultState).toBe("stored");
  });

  test("S8: two PUTs of the same part at once leave one marker for it, and complete stores the file", async () => {
    const f = await begun();
    await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: f.parts.map(hex) });
    const [t1, t2] = await ticketsFor(f, [1, 2]);
    const both = await Promise.all([putPart(t1!.url, f.parts[0]!), putPart(t1!.url, f.parts[0]!)]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    expect((await putPart(t2!.url, f.parts[1]!)).status).toBe(200);
    const plan = JSON.parse(await (await raw.get(uploadPlanKey(f.p.companyId, f.sha256)))!.text()) as { uploadId: string };
    expect((await markerEtags(f.p.companyId, f.sha256, plan.uploadId)).map((m) => m.partNumber)).toEqual([1, 2]);
    expect((await f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).vaultState).toBe("stored");
  });

  test("S9: a part PUT reads only the plan's head: no marker listing, no plan body", async () => {
    const f = await begun();
    await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: f.parts.map(hex) });
    const [t1] = await ticketsFor(f, [1]);
    calls.length = 0;
    expect((await putPart(t1!.url, f.parts[0]!)).status).toBe(200);
    expect(calls.filter((c) => c.method === "list")).toEqual([]);
    expect(calls.filter((c) => c.method === "get")).toEqual([]);
    expect(calls.filter((c) => c.method === "head").map((c) => c.key)).toEqual([uploadPlanKey(f.p.companyId, f.sha256)]);
  });

  test("N8: tickets are issued two at a time, the first ones asked for", async () => {
    const f = await begun(undefined, bigFile(3 * 16 * 1024 * 1024));
    await f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: f.parts.map(hex) });
    const { tickets } = await f.p.owner.ingest.artifact.uploadTickets({ artifactId: f.artifactId, parts: [3, 1, 2, 4] });
    expect(tickets.map((t) => t.part)).toEqual([3, 1]);
  });

  test("decision 4: a check that never finished (CPU limit) marks the file failed once and is not run again", async () => {
    const f = await begun();
    await sendAll(f);
    // As if an earlier complete took the lock and the Worker died while hashing.
    await raw.put(checkKey(f.p.companyId, f.sha256), JSON.stringify({ at: Date.now() - 6 * 60 * 1000, userId: "u_x" }));
    await expect(f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).rejects.toThrow(CHECK_FAILED);
    const row = await artifactRow(f);
    expect([row.vaultState, row.readState, row.readError]).toEqual(["pending", "failed", CHECK_FAILED]);
    expect((await raw.list({ prefix: `tenants/${f.p.companyId}/artifacts/${f.sha256}/` })).objects).toEqual([]);
    calls.length = 0;
    await expect(f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).rejects.toThrow(UPLOAD_RAN_OUT);
    expect(calls.filter((c) => c.method === "get" && c.key === rawKey(f.p.companyId, f.sha256))).toEqual([]);
    // Added again by the person: it goes up and is checked, and the PDF is back to kept.
    await f.p.owner.ingest.artifact.begin({ sha256: f.sha256, fileName: "big.pdf", sizeBytes: f.bytes.length, contentType: "application/pdf", kind: "pdf_scan" });
    await sendAll(f);
    expect((await f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).vaultState).toBe("stored");
    expect((await artifactRow(f)).readState).toBe("kept_unread");
  });

  test("M2: a check running now is not run twice; abort waits for it (N6, L8)", async () => {
    const f = await begun();
    await sendAll(f);
    await raw.put(checkKey(f.p.companyId, f.sha256), JSON.stringify({ at: Date.now(), userId: "u_x" }));
    await expect(f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).rejects.toThrow(CHECK_RUNNING);
    await expect(f.p.owner.ingest.artifact.uploadAbort({ artifactId: f.artifactId })).rejects.toThrow(CHECK_RUNNING);
    expect(await raw.head(rawKey(f.p.companyId, f.sha256))).not.toBeNull();
  });

  test("N5: two completes at once never say the upload ran out", async () => {
    const f = await begun();
    await sendAll(f);
    const out = await Promise.allSettled([
      f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId }),
      f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId }),
    ]);
    const said = out.map((r) => (r.status === "fulfilled" ? r.value.vaultState : String((r.reason as Error).message)));
    expect(said).toContain("stored");
    expect(said.every((x) => x === "stored" || x === CHECK_RUNNING)).toBe(true);
    expect((await artifactRow(f)).vaultState).toBe("stored");
  });

  test("N6/L8: an object removed while it was hashed is not marked stored", async () => {
    const f = await begun();
    await sendAll(f);
    const key = rawKey(f.p.companyId, f.sha256);
    const plan = JSON.parse(await (await raw.get(uploadPlanKey(f.p.companyId, f.sha256)))!.text()) as { uploadId: string };
    await raw.resumeMultipartUpload(key, plan.uploadId).complete(await markerEtags(f.p.companyId, f.sha256, plan.uploadId));
    afterBodyRead = async (k) => {
      if (k === key) await raw.delete(key);
    };
    await expect(f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).rejects.toThrow(UPLOAD_RAN_OUT);
    expect((await artifactRow(f)).vaultState).toBe("pending");
  });

  test("L7: another person cannot restart a running upload with other parts; they may remove it first", async () => {
    const f = await begun();
    await sendAll(f, [1]);
    const fake = [hex(new Uint8Array([1])), hex(new Uint8Array([2]))];
    await expect(f.p.admin.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: fake })).rejects.toThrow(SOMEONE_ELSE_SENDING);
    // The same parts resume for anyone.
    expect((await f.p.admin.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: f.parts.map(hex) })).done).toEqual([1]);
    expect((await f.p.admin.ingest.artifact.uploadAbort({ artifactId: f.artifactId })).aborted).toBe(true);
    expect((await f.p.admin.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: fake })).done).toEqual([]);
  });

  test("L6: a file with no live sheet and bytes not stored has its upload aborted and its records deleted", async () => {
    const f = await begun();
    await sendAll(f, [1]);
    expect(await abortIfAbandoned({ db: env.db, companyId: f.p.companyId }, f.artifactId)).toBe(true);
    expect((await raw.list({ prefix: `tenants/${f.p.companyId}/artifacts/${f.sha256}/` })).objects).toEqual([]);
    // A stored file keeps everything.
    const g = await begun();
    await sendAll(g);
    await g.p.owner.ingest.artifact.uploadComplete({ artifactId: g.artifactId });
    expect(await abortIfAbandoned({ db: env.db, companyId: g.p.companyId }, g.artifactId)).toBe(false);
    expect(await raw.head(rawKey(g.p.companyId, g.sha256))).not.toBeNull();
  });

  test("L6: discarding the last sheet of a file still arriving aborts its upload; another live sheet keeps it", async () => {
    workersEnv.INGEST_VAULT = vault();
    const pl = await plant(env);
    const bytes = bigFile();
    const sha256 = hex(bytes);
    const b = await pl.owner.ingest.artifact.begin({ sha256, fileName: "big.csv", sizeBytes: bytes.length, contentType: "text/csv", kind: "csv" });
    const sheet = (ordinal: number) => ({ ordinal, sheetName: `S${ordinal}`, title: null, headerRow: 0, headerRows: 1, headers: ["Name", "GSTIN", "City"], rowCount: 1, sample: [["A", "", "X"]] });
    const put = await putBlocksPicked(pl.owner, { artifactId: b.artifactId, blocks: [sheet(0), sheet(1)] });
    const f = { p: pl, bytes, sha256, artifactId: b.artifactId, begin: b, parts: partsOf(bytes) };
    await sendAll(f, [1]);
    const [c0, c1] = put.candidates.sort((x, y) => x.blockOrdinal - y.blockOrdinal);
    const seq = async (id: string) => (await pl.owner.ingest.candidate.get({ candidateId: id })).serverSeq;
    await pl.owner.ingest.candidate.discard({ candidateId: c0!.id, expectSeq: await seq(c0!.id) });
    expect(await raw.head(uploadPlanKey(pl.companyId, sha256))).not.toBeNull();
    await pl.owner.ingest.candidate.discard({ candidateId: c1!.id, expectSeq: await seq(c1!.id) });
    expect((await raw.list({ prefix: `tenants/${pl.companyId}/artifacts/${sha256}/` })).objects).toEqual([]);
  });

  test("N7/L6: the daily sweep clears uploads begun over a day ago and stores a one-piece file whose commit never came", async () => {
    const f = await begun();
    await sendAll(f, [1]);
    workersEnv.INGEST_VAULT = vault();
    const small = new TextEncoder().encode(`%PDF one piece ${randomUUID()}`);
    const one = await f.p.owner.ingest.artifact.begin({ sha256: hex(small), fileName: "one.pdf", sizeBytes: small.length, contentType: "application/pdf", kind: "pdf_scan" });
    await raw.put(rawKey(f.p.companyId, hex(small)), small);
    // A fresh one is left alone.
    expect(await sweepUnfinishedUploads(env.db, vault(), new Date())).toEqual({ cleared: 0, stored: 0 });
    const later = new Date(Date.now() + 25 * 60 * 60 * 1000);
    const out = await sweepUnfinishedUploads(env.db, vault(), later);
    expect(out.cleared).toBeGreaterThanOrEqual(1);
    expect(out.stored).toBeGreaterThanOrEqual(1);
    expect(await raw.head(uploadPlanKey(f.p.companyId, f.sha256))).toBeNull();
    expect((await artifactRow(f)).vaultState).toBe("pending");
    expect((await f.p.owner.ingest.artifact.get({ artifactId: one.artifactId })).vaultState).toBe("stored");
  });
});

describe("fix round: review of the fix (quota at uploadStart, sweep window, a sheet's failed check)", () => {
  test("M1: a new multipart upload on a row that dropped out of the count is checked against the quota again", async () => {
    workersEnv.INGEST_VAULT = vault();
    const pl = await plant(env);
    await env.caller({ platformRole: "support" }).platform.companiesSetLimits({ companyId: pl.companyId, limits: { vaultQuotaGiB: 1 } });
    const f = await begun(pl, bigFile());
    // The row as if begun two days ago: uncounted. Then the plant fills up with another file.
    await env.db.update(ingestArtifact).set({ updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }).where(eq(ingestArtifact.id, f.artifactId));
    await pl.owner.ingest.artifact.begin({ sha256: hex(new TextEncoder().encode(randomUUID())), fileName: "full.pdf", sizeBytes: 1024 * 1024 * 1024 - 1000, contentType: "application/pdf", kind: "pdf_scan" });
    await expect(f.p.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: f.parts.map(hex) })).rejects.toThrow(
      "This plant's file storage is full (1 GB). orrn support can raise it.",
    );
    expect(await raw.head(uploadPlanKey(pl.companyId, f.sha256))).toBeNull();
  });

  test("N7: the sweep looks only at rows that crossed the one-day line lately, newest first", async () => {
    const day = 24 * 60 * 60 * 1000;
    const old = await begun();
    await sendAll(old, [1]);
    const recent = await begun();
    await sendAll(recent, [1]);
    const at = new Date(Date.now() + 10 * day);
    const set = (id: string, ms: number) => env.db.update(ingestArtifact).set({ updatedAt: new Date(ms) }).where(eq(ingestArtifact.id, id));
    // Outside the two-day window: left alone, so dead rows never crowd out new ones.
    await set(old.artifactId, at.getTime() - 9 * day);
    await set(recent.artifactId, at.getTime() - 1.5 * day);
    await sweepUnfinishedUploads(env.db, vault(), at, 1);
    expect(await raw.head(uploadPlanKey(recent.p.companyId, recent.sha256))).toBeNull();
    expect(await raw.head(uploadPlanKey(old.p.companyId, old.sha256))).not.toBeNull();
  });

  test("decision 4: a sheet whose whole-file check fails keeps its tables and is not read again on the next add", async () => {
    workersEnv.INGEST_VAULT = vault();
    const pl = await plant(env);
    const named = bigFile();
    const sha256 = hex(named);
    const b = await pl.owner.ingest.artifact.begin({ sha256, fileName: "big.csv", sizeBytes: named.length, contentType: "text/csv", kind: "csv" });
    const sheet = { ordinal: 0, sheetName: "S0", title: null, headerRow: 0, headerRows: 1, headers: ["Name", "GSTIN", "City"], rowCount: 1, sample: [["A", "", "X"]] };
    const put = await putBlocksPicked(pl.owner, { artifactId: b.artifactId, blocks: [sheet] });
    const f = { p: pl, bytes: named, sha256, artifactId: b.artifactId, begin: b, parts: partsOf(named) };
    const otherParts = partsOf(bigFile());
    await pl.owner.ingest.artifact.uploadStart({ artifactId: f.artifactId, parts: otherParts.map(hex) });
    for (const t of await ticketsFor(f, [1, 2])) await putPart(t.url, otherParts[t.part - 1]!);
    await expect(pl.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).rejects.toThrow(DIGEST_MISMATCH);
    expect((await artifactRow(f)).readState).not.toBe("failed");
    await expect(pl.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).rejects.toThrow(UPLOAD_RAN_OUT);
    const again = await pl.owner.ingest.artifact.begin({ sha256, fileName: "big.csv", sizeBytes: named.length, contentType: "text/csv", kind: "csv" });
    expect(again.existing).toBe(true);
    expect((await pl.owner.ingest.candidate.get({ candidateId: put.candidates[0]!.id })).id).toBe(put.candidates[0]!.id);
  });
});

describe("fix round: limits on file size and storage (decision 3)", () => {
  const MiB = 1024 * 1024;
  const begin = (pl: Plant, sizeBytes: number, kind: "pdf_scan" | "csv" | "sheet" = "pdf_scan") =>
    pl.owner.ingest.artifact.begin({
      sha256: hex(new TextEncoder().encode(randomUUID())),
      fileName: kind === "csv" ? "a.csv" : kind === "sheet" ? "a.xlsx" : "a.pdf",
      sizeBytes,
      contentType: kind === "pdf_scan" ? "application/pdf" : null,
      kind,
    });
  const staff = () => env.caller({ platformRole: "support" });

  test("largest file per upload: the default 2 GiB is the ceiling; a lowered limit names itself and who can raise it", async () => {
    workersEnv.INGEST_VAULT = vault();
    const pl = await plant(env);
    expect((await begin(pl, 2048 * MiB)).parts?.partCount).toBe(128);
    await expect(begin(pl, 2048 * MiB + 1)).rejects.toThrow("a.pdf is too big. The largest file orrn can take is 2 GB.");
    await staff().platform.companiesSetLimits({ companyId: pl.companyId, limits: { uploadFileMiB: 100 } });
    await expect(begin(pl, 100 * MiB + 1, "csv")).rejects.toThrow("a.csv is too big. The largest file for this plant is 100 MB. orrn support can raise it.");
    expect((await begin(pl, 100 * MiB, "csv")).parts?.partCount).toBe(7);
  });

  test("storage quota: counted from D1 with unfinished uploads; two begins at once cannot both pass", async () => {
    workersEnv.INGEST_VAULT = vault();
    const pl = await plant(env);
    await staff().platform.companiesSetLimits({ companyId: pl.companyId, limits: { vaultQuotaGiB: 1 } });
    const two = await Promise.allSettled([begin(pl, 600 * MiB), begin(pl, 600 * MiB)]);
    expect(two.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = two.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((refused.reason as Error).message).toBe("This plant's file storage is full (1 GB). orrn support can raise it.");
    expect((await begin(pl, 400 * MiB)).parts).not.toBeNull();
    // An upload begun more than a day ago holds no parts (lifecycle rule) and no longer counts.
    await env.db.update(ingestArtifact).set({ updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }).where(eq(ingestArtifact.companyId, pl.companyId));
    expect((await begin(pl, 900 * MiB)).parts).not.toBeNull();
  });

  test("decision 2: with no vault the old refusal by kind holds, with the old words", async () => {
    delete workersEnv.INGEST_VAULT;
    const pl = await plant(env);
    await expect(begin(pl, 21 * MiB, "sheet")).rejects.toThrow("a.xlsx is too big. The limit for this kind of file is 20 MB.");
    await expect(begin(pl, 300 * MiB, "csv")).rejects.toThrow("a.csv is too big. The limit for this kind of file is 50 MB.");
    expect((await begin(pl, 20 * MiB, "sheet")).parts).toBeNull();
    // With a vault there is no refusal by kind.
    workersEnv.INGEST_VAULT = vault();
    expect((await begin(pl, 300 * MiB, "csv")).parts?.partCount).toBe(19);
  });
});

describe("fix round: read tickets and page uploads (security L1, L4)", () => {
  test("L1: a raw read is never cached and its link lasts two minutes; a page image may be cached briefly", async () => {
    workersEnv.INGEST_VAULT = vault();
    const pl = await plant(env);
    const bytes = new TextEncoder().encode("raw bytes");
    const sha256 = hex(bytes);
    await raw.put(rawKey(pl.companyId, sha256), bytes);
    await raw.put(pageKey(pl.companyId, sha256, 1), bytes);
    const at = Date.now();
    const rawLink = await issueReadTicket({ request: null }, { companyId: pl.companyId, userId: "u_1", artifactId: "a_1", sha256, key: rawKey(pl.companyId, sha256), as: "raw" }, at);
    const pageLink = await issueReadTicket({ request: null }, { companyId: pl.companyId, userId: "u_1", artifactId: "a_1", sha256, key: pageKey(pl.companyId, sha256, 1), as: "page" }, at);
    expect(rawLink.expiresAt - at).toBe(2 * 60 * 1000);
    expect(pageLink.expiresAt - at).toBe(10 * 60 * 1000);
    const abs = (u: string) => (u.startsWith("http") ? u : `https://api.test${u}`);
    expect((await handleIngestRead(new Request(abs(rawLink.url)), { bucket: vault() })).headers.get("cache-control")).toBe("no-store");
    expect((await handleIngestRead(new Request(abs(pageLink.url)), { bucket: vault() })).headers.get("cache-control")).toBe("private, max-age=600");
  });

  test("L4: of two uploads of one page at once exactly one lands; a page ticket names only a page key", async () => {
    workersEnv.INGEST_VAULT = vault();
    const pl = await plant(env);
    const sha256 = hex(new TextEncoder().encode(randomUUID()));
    const base = { purpose: "ingest-page" as const, companyId: pl.companyId, userId: "u_1", artifactId: "a_1", sha256, size: 1000, exactSize: false, contentType: "image/jpeg", fileName: "1.jpg" };
    const t = await issueTicket({ request: null }, { ...base, key: pageKey(pl.companyId, sha256, 1) });
    const url = t.url.startsWith("http") ? t.url : `https://api.test${t.url}`;
    const a = new Uint8Array(500).fill(1);
    const b = new Uint8Array(500).fill(2);
    const put = (body: Uint8Array) => handleIngestUpload(new Request(url, { method: "PUT", body, headers: { "content-length": "500" } }), { bucket: vault() });
    const both = await Promise.all([put(a), put(b)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    const stored = new Uint8Array(await (await raw.get(pageKey(pl.companyId, sha256, 1)))!.arrayBuffer());
    expect(stored[0]).toBe(both[0]!.status === 200 ? 1 : 2);
    // A later upload of the same page is refused too.
    expect((await put(a)).status).toBe(409);
    // A page ticket that names the raw file (or any other key) is not valid.
    const bad = await issueTicket({ request: null }, { ...base, key: rawKey(pl.companyId, sha256) });
    const badUrl = bad.url.startsWith("http") ? bad.url : `https://api.test${bad.url}`;
    expect((await handleIngestUpload(new Request(badUrl, { method: "PUT", body: a, headers: { "content-length": "500" } }), { bucket: vault() })).status).toBe(403);
  });
});

describe("delta review SF1: no delete path removes the bytes of a file whose check passed", () => {
  type Gate = { bucket: R2Bucket; reached: Promise<void>; release: () => void };
  /**
   * A vault that holds the first call `when` names until `release` (controlled promises). The call is held before it
   * runs, so a check can finish in between. `resumeMultipartUpload` is synchronous and passes straight through.
   */
  function gatedVault(when: (method: string, key: string) => boolean): Gate {
    let hit!: () => void;
    const reached = new Promise<void>((r) => (hit = r));
    let open!: () => void;
    const opened = new Promise<void>((r) => (open = r));
    let fired = false;
    const inner = vault() as unknown as Record<string, (...args: unknown[]) => unknown>;
    const held = (method: string) => async (...args: unknown[]) => {
      const a0 = args[0];
      const key = typeof a0 === "string" ? a0 : Array.isArray(a0) ? String(a0[0] ?? "") : String((a0 as R2ListOptions | undefined)?.prefix ?? "");
      if (!fired && when(method, key)) {
        fired = true;
        hit();
        await opened;
      }
      return inner[method]!(...args);
    };
    const bucket = {
      head: held("head"),
      list: held("list"),
      delete: held("delete"),
      put: held("put"),
      get: held("get"),
      createMultipartUpload: held("createMultipartUpload"),
      resumeMultipartUpload: (...args: unknown[]) => inner.resumeMultipartUpload!(...args),
    } as unknown as R2Bucket;
    return { bucket, reached, release: open };
  }

  /** Holds the whole-file check of `key` once its body is read, until `free`. */
  function holdCheck(key: string) {
    let hold!: () => void;
    const held = new Promise<void>((r) => (hold = r));
    let free!: () => void;
    const freed = new Promise<void>((r) => (free = r));
    let once = false;
    afterBodyRead = async (k) => {
      if (k !== key || once) return;
      once = true;
      hold();
      await freed;
    };
    return { held, free };
  }

  const survives = async (f: { p: Plant; artifactId: string; sha256: string }) => {
    expect((await artifactRow(f)).vaultState).toBe("stored");
    expect(await raw.head(rawKey(f.p.companyId, f.sha256))).not.toBeNull();
  };

  test("abort: a check that finishes after abort read the row and before its delete keeps the stored file", async () => {
    const f = await begun();
    await sendAll(f);
    const lock = checkKey(f.p.companyId, f.sha256);
    const gate = gatedVault((_m, k) => k === lock);
    workersEnv.INGEST_VAULT = gate.bucket;
    const abort = f.p.owner.ingest.artifact.uploadAbort({ artifactId: f.artifactId });
    await gate.reached;
    workersEnv.INGEST_VAULT = vault();
    try {
      expect((await f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).vaultState).toBe("stored");
    } finally {
      gate.release();
    }
    expect((await abort).aborted).toBe(false);
    await survives(f);
  });

  test("discard: a check that finishes after the discard hook read the row and before its delete keeps the stored file", async () => {
    const f = await begun();
    await sendAll(f);
    const lock = checkKey(f.p.companyId, f.sha256);
    const gate = gatedVault((_m, k) => k === lock);
    workersEnv.INGEST_VAULT = gate.bucket;
    const discard = abortIfAbandoned({ db: env.db, companyId: f.p.companyId }, f.artifactId);
    await gate.reached;
    workersEnv.INGEST_VAULT = vault();
    try {
      expect((await f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).vaultState).toBe("stored");
    } finally {
      gate.release();
    }
    expect(await discard).toBe(false);
    await survives(f);
  });

  test("daily sweep: a check that finishes after the sweep picked the row and before its delete keeps the stored file", async () => {
    const f = await begun();
    await sendAll(f);
    const lock = checkKey(f.p.companyId, f.sha256);
    const gate = gatedVault((_m, k) => k === lock);
    const sweep = sweepUnfinishedUploads(env.db, gate.bucket, new Date(Date.now() + 25 * 60 * 60 * 1000));
    await gate.reached;
    workersEnv.INGEST_VAULT = vault();
    try {
      expect((await f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).vaultState).toBe("stored");
    } finally {
      gate.release();
    }
    await sweep;
    await survives(f);
  });

  test("5-minute limit: a slow check that finishes after a second complete judged its lock dead keeps the stored file", async () => {
    const f = await begun();
    await sendAll(f);
    const key = rawKey(f.p.companyId, f.sha256);
    const lock = checkKey(f.p.companyId, f.sha256);
    const a = holdCheck(key);
    const { setClockForTests } = await import("../src/lib/clock");
    // Check A takes its lock as if 6 minutes ago, then hashes slowly.
    setClockForTests(new Date(Date.now() - 6 * 60 * 1000));
    workersEnv.INGEST_VAULT = vault();
    const first = f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId });
    await a.held;
    setClockForTests(null);
    // Complete B finds A's lock past 5 minutes; it is held on the call after it read the lock.
    let sawLock = false;
    const gate = gatedVault((m, k) => {
      if (sawLock) return true;
      if (m === "get" && k === lock) sawLock = true;
      return false;
    });
    workersEnv.INGEST_VAULT = gate.bucket;
    const second = f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId });
    try {
      await gate.reached;
      a.free();
      expect((await first).vaultState).toBe("stored");
    } finally {
      a.free();
      gate.release();
    }
    const said = await second.then((r) => r.vaultState, (e: Error) => e.message);
    await survives(f);
    expect(["stored", CHECK_RUNNING]).toContain(said);
  });

  test("5-minute limit, other order: a slow check that finishes after a second complete took its dead lock is not kept stored", async () => {
    const f = await begun();
    await sendAll(f);
    const key = rawKey(f.p.companyId, f.sha256);
    const lock = checkKey(f.p.companyId, f.sha256);
    const a = holdCheck(key);
    const { setClockForTests } = await import("../src/lib/clock");
    setClockForTests(new Date(Date.now() - 6 * 60 * 1000));
    workersEnv.INGEST_VAULT = vault();
    const first = f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId });
    const firstSaid = first.then((r) => r.vaultState, (e: Error) => e.message);
    await a.held;
    setClockForTests(null);
    // Complete B judges A's lock dead and is held right before it heads the object to delete it.
    let sawLock = false;
    const gate = gatedVault((m, k) => {
      if (m === "get" && k === lock) sawLock = true;
      return sawLock && m === "head" && k === key;
    });
    workersEnv.INGEST_VAULT = gate.bucket;
    const second = f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId });
    const secondSaid = second.then((r) => r.vaultState, (e: Error) => e.message);
    try {
      await gate.reached;
      a.free();
      await firstSaid;
    } finally {
      a.free();
      gate.release();
    }
    await secondSaid;
    // Never a stored row with no bytes: A lost its lock, so it does not keep the row stored.
    const stored = (await artifactRow(f)).vaultState === "stored";
    const bytes = (await raw.head(key)) !== null;
    expect({ stored, bytes: stored ? bytes : "n/a" }).toEqual({ stored, bytes: stored ? true : "n/a" });
    expect(await firstSaid).toBe(CHECK_RUNNING);
    expect(stored).toBe(false);
  });

  test("a late part PUT after complete does not release the check lock; abort still waits for the check", async () => {
    const f = await begun();
    await sendAll(f);
    const [late] = await ticketsFor(f, [1]);
    const key = rawKey(f.p.companyId, f.sha256);
    const plan = JSON.parse(await (await raw.get(uploadPlanKey(f.p.companyId, f.sha256)))!.text()) as { uploadId: string };
    await raw.resumeMultipartUpload(key, plan.uploadId).complete(await markerEtags(f.p.companyId, f.sha256, plan.uploadId));
    const a = holdCheck(key);
    workersEnv.INGEST_VAULT = vault();
    const check = f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId });
    const settled = check.then((r) => r.vaultState, (e: Error) => e.message);
    try {
      await a.held;
      expect((await putPart(late!.url, f.parts[0]!)).status).toBe(410);
      expect(await raw.head(checkKey(f.p.companyId, f.sha256))).not.toBeNull();
      await expect(f.p.owner.ingest.artifact.uploadAbort({ artifactId: f.artifactId })).rejects.toThrow(CHECK_RUNNING);
    } finally {
      a.free();
      await settled;
    }
    expect(await settled).toBe("stored");
    await survives(f);
  });
});
