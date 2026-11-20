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
import { plant, type Plant } from "./ingest-portal-helpers";
import { handleIngestRead, handleIngestUpload, issueReadTicket, rawKey } from "../src/lib/ingest/vault";
import {
  DIGEST_MISMATCH,
  PARTS_MISSING,
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
const vault = () =>
  ({
    head: (k: string) => raw.head(k),
    list: (o: R2ListOptions) => raw.list(o),
    delete: (k: string | string[]) => raw.delete(k),
    put: async (k: string, v: unknown, o?: R2PutOptions) => raw.put(k, await toBytes(v), o),
    get: async (k: string, o?: R2GetOptions) => {
      const obj = await raw.get(k, o);
      if (!obj) return null;
      const bytes = new Uint8Array(await obj.arrayBuffer());
      return { size: obj.size, customMetadata: obj.customMetadata, body: new Response(bytes).body!, text: async () => new TextDecoder().decode(bytes) };
    },
    createMultipartUpload: async (k: string, o?: R2MultipartOptions) => wrapUpload(await raw.createMultipartUpload(k, o)),
    resumeMultipartUpload: (k: string, id: string) => wrapUpload(raw.resumeMultipartUpload(k, id)),
  }) as unknown as R2Bucket;

beforeAll(async () => {
  env = await createTestEnv();
  mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", r2Buckets: ["VAULT"] });
  raw = (await mf.getR2Bucket("VAULT")) as unknown as R2Bucket;
}, 60_000);

afterEach(() => {
  workersEnv.INGEST_VAULT = vault();
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
  if (want.length === 0) return start;
  const { tickets } = await f.p.owner.ingest.artifact.uploadTickets({ artifactId: f.artifactId, parts: want });
  for (const t of tickets) expect((await putPart(t.url, f.parts[t.part - 1]!)).status).toBe(200);
  return start;
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
    const { tickets } = await f.p.owner.ingest.artifact.uploadTickets({ artifactId: f.artifactId, parts: [1, 2] });
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
    const { tickets } = await f.p.owner.ingest.artifact.uploadTickets({ artifactId: f.artifactId, parts: [1, 2] });
    for (const t of tickets) expect((await putPart(t.url, otherParts[t.part - 1]!)).status).toBe(200);
    await expect(f.p.owner.ingest.artifact.uploadComplete({ artifactId: f.artifactId })).rejects.toThrow(DIGEST_MISMATCH);
    expect(await raw.head(rawKey(p.companyId, f.sha256))).toBeNull();
    expect(await raw.head(uploadPlanKey(p.companyId, f.sha256))).toBeNull();
    expect((await artifactRow(f)).vaultState).toBe("pending");
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

  test("a plan close to R2's 7-day abort is started again, not resumed", async () => {
    const f = await begun();
    await sendAll(f, [1]);
    // The plan as if it were written six and a half days ago.
    const key = uploadPlanKey(f.p.companyId, f.sha256);
    const plan = JSON.parse(await (await raw.get(key))!.text()) as { createdAt: number };
    await raw.put(key, JSON.stringify({ ...plan, createdAt: Date.now() - 6.5 * 24 * 60 * 60 * 1000 }));
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
    const { tickets } = await f.p.owner.ingest.artifact.uploadTickets({ artifactId: f.artifactId, parts: [1, 2] });
    for (const t of tickets) await putPart(t.url, otherParts[t.part - 1]!);
    // Completed straight on R2 (as if the answer of uploadComplete were lost before the check ran).
    const plan = JSON.parse(await (await raw.get(uploadPlanKey(p.companyId, f.sha256)))!.text()) as { uploadId: string };
    const list = await raw.list({ prefix: `tenants/${p.companyId}/artifacts/${f.sha256}/upload/${plan.uploadId}/` });
    const etags = list.objects.map((o) => /p(\d+)-(.+)$/.exec(o.key)!).map((m) => ({ partNumber: Number(m[1]), etag: decodeURIComponent(m[2]!) }));
    await raw.resumeMultipartUpload(rawKey(p.companyId, f.sha256), plan.uploadId).complete(etags.sort((a, b) => a.partNumber - b.partNumber));
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
    const list = await raw.list({ prefix: `tenants/${f.p.companyId}/artifacts/${f.sha256}/upload/${plan.uploadId}/` });
    const etags = list.objects.map((o) => /p(\d+)-(.+)$/.exec(o.key)!).map((m) => ({ partNumber: Number(m[1]), etag: decodeURIComponent(m[2]!) }));
    await raw.resumeMultipartUpload(rawKey(f.p.companyId, f.sha256), plan.uploadId).complete(etags.sort((a, b) => a.partNumber - b.partNumber));
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
