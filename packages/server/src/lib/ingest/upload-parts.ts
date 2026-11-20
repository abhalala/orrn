/**
 * Raw files larger than one part go to the vault by the R2 multipart API, through the Worker (limits brief part B,
 * plan `docs/superpowers/plans/2026-11-20-chunked-upload.md`).
 *
 * - The plan of one upload (upload id, part size, part count and the SHA-256 of every part) is an object the Worker
 *   writes under the artifact's own folder, with the company from the session: `upload/plan.json`.
 * - Each part goes with a short signed ticket (purpose `ingest-part`, 10 minutes) that names one part, its exact size
 *   and its digest. The part route checks the digest as the part streams into R2 (`crypto.DigestStream`) and records
 *   the part only when it matches (`upload/<uploadId>/p<n>-<etag>`; the binding cannot list parts).
 * - R2 has no whole-object checksum for multipart. After `complete`, the object is streamed once through
 *   `DigestStream`; only a match marks the artifact stored. A mismatch deletes the object.
 * - R2 aborts an unfinished multipart upload after 7 days; the part route then answers 410 and the browser starts again.
 */
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import { ingestArtifact } from "@orrn/db/schema/ingest";

import { now } from "../clock";
import { base64url, dieFileSigningReady, fromBase64url, hex, hmacKey, apiOrigin } from "../dieFiles";
import { loadArtifact } from "./core";
import type { ArtifactSummary, IngestCtx } from "./types";
import { artifactPrefix, ingestVault, INGEST_TICKET_TTL_MS, rawKey, vaultReady } from "./vault";

/** One part: under the 100 MB Worker body limit, over R2's 5 MiB floor, a small slice of the 128 MB Worker memory. */
export const RAW_PART_BYTES = 16 * 1024 * 1024;
/** R2's most parts in one upload. */
export const RAW_MAX_PARTS = 10_000;
/** The largest raw file: 10,000 parts. The only size bound left, and not per kind. */
export const RAW_MAX_BYTES = RAW_PART_BYTES * RAW_MAX_PARTS;
/** Part tickets asked for in one call. */
export const PART_TICKETS_PER_CALL = 8;

/** Server sentences (the web maps each in `features/ingest/lib/errors.ts`, `UPLOAD_SENTENCES`). */
export const PARTS_MISSING = "Some parts of the file have not arrived. Add the same file again to send them.";
export const DIGEST_MISMATCH = "The file does not match its digest";
export const UPLOAD_RAN_OUT = "The upload ran out. Add the same file again.";
export const ONE_PIECE = "This file is sent in one piece";
export const PART_LIST_WRONG = "The part list does not match this file";

export function partCountFor(size: number, partSize: number = RAW_PART_BYTES): number {
  return Math.max(1, Math.ceil(size / partSize));
}

/** True when the file goes in parts: larger than one part. */
export function goesInParts(size: number): boolean {
  return size > RAW_PART_BYTES;
}

/** The exact byte count of part `n` (from 1) of a file. */
export function partBytes(size: number, n: number, partSize: number = RAW_PART_BYTES): number {
  const count = partCountFor(size, partSize);
  if (n < 1 || n > count) return 0;
  return n < count ? partSize : size - partSize * (count - 1);
}

export type UploadPlan = {
  v: 1;
  uploadId: string;
  artifactId: string;
  userId: string;
  size: number;
  partSize: number;
  partCount: number;
  /** Lower-case hex SHA-256 of every part, part 1 first. */
  parts: string[];
  createdAt: number;
};

export const uploadPlanKey = (companyId: string, sha256: string) => `${artifactPrefix(companyId, sha256)}/upload/plan.json`;
const markerPrefix = (companyId: string, sha256: string, uploadId: string) =>
  `${artifactPrefix(companyId, sha256)}/upload/${encodeURIComponent(uploadId)}/`;
const markerKey = (companyId: string, sha256: string, uploadId: string, n: number, etag: string) =>
  `${markerPrefix(companyId, sha256, uploadId)}p${n}-${encodeURIComponent(etag)}`;

async function readPlan(bucket: R2Bucket, companyId: string, sha256: string): Promise<UploadPlan | null> {
  const obj = await bucket.get(uploadPlanKey(companyId, sha256));
  if (!obj) return null;
  try {
    const plan = JSON.parse(await obj.text()) as UploadPlan;
    return plan && plan.v === 1 && typeof plan.uploadId === "string" && Array.isArray(plan.parts) ? plan : null;
  } catch {
    return null;
  }
}

/** The parts recorded for an upload: part number to ETag. */
async function recordedParts(bucket: R2Bucket, companyId: string, sha256: string, uploadId: string): Promise<Map<number, { etag: string; key: string }>> {
  const prefix = markerPrefix(companyId, sha256, uploadId);
  const out = new Map<number, { etag: string; key: string }>();
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    for (const o of page.objects) {
      const m = /^p(\d{1,5})-(.+)$/.exec(o.key.slice(prefix.length));
      if (m) out.set(Number(m[1]), { etag: decodeURIComponent(m[2]!), key: o.key });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** Deletes the plan and every part record of the upload folder. */
async function clearUpload(bucket: R2Bucket, companyId: string, sha256: string): Promise<void> {
  const prefix = `${artifactPrefix(companyId, sha256)}/upload/`;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor, limit: 1000 });
    const keys = page.objects.map((o) => o.key);
    if (keys.length > 0) await bucket.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

function needBucket(): R2Bucket {
  const bucket = ingestVault();
  if (!bucket || !vaultReady()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "File storage is not set up for this plant yet" });
  return bucket;
}

/** NoSuchUpload (10024): R2 aborted the upload (7 days) or another call did. */
function isGone(error: unknown): boolean {
  return /10024|NoSuchUpload|does not exist|InvalidPart|10025/i.test(String((error as Error)?.message ?? error));
}

/** `crypto.DigestStream` (workerd), reached through a cast: the web build type-checks this file without Workers types. */
type DigestStreamLike = WritableStream<Uint8Array> & { readonly digest: Promise<ArrayBuffer> };
function newDigestStream(): DigestStreamLike {
  const C = (crypto as unknown as { DigestStream: new (algorithm: string) => DigestStreamLike }).DigestStream;
  return new C("SHA-256");
}

// ---------------------------------------------------------------------------
// Whole-file check
// ---------------------------------------------------------------------------

/** SHA-256 of a stream, hex, through `crypto.DigestStream` (never buffered). */
export async function streamSha256(body: ReadableStream): Promise<{ sha256: string; bytes: number }> {
  const digest = newDigestStream();
  let bytes = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, c) {
      bytes += chunk.byteLength;
      c.enqueue(chunk);
    },
  });
  await body.pipeThrough(counter).pipeTo(digest);
  return { sha256: hex(await digest.digest), bytes };
}

/**
 * The stored object must give the artifact's SHA-256 and size. On a match the artifact is stored and the upload
 * folder goes; on a mismatch the object and the upload folder go and the call fails.
 */
async function confirmWhole(ctx: IngestCtx, bucket: R2Bucket, a: { id: string; sha256: string; sizeBytes: number }): Promise<void> {
  const key = rawKey(ctx.companyId, a.sha256);
  const obj = await bucket.get(key);
  if (!obj) throw new TRPCError({ code: "BAD_REQUEST", message: PARTS_MISSING });
  const got = await streamSha256(obj.body);
  if (got.sha256 !== a.sha256 || got.bytes !== a.sizeBytes) {
    await bucket.delete(key);
    await clearUpload(bucket, ctx.companyId, a.sha256);
    throw new TRPCError({ code: "BAD_REQUEST", message: DIGEST_MISMATCH });
  }
  await ctx.db
    .update(ingestArtifact)
    .set({ vaultState: "stored", updatedAt: now() })
    .where(and(eq(ingestArtifact.id, a.id), eq(ingestArtifact.companyId, ctx.companyId)));
  await clearUpload(bucket, ctx.companyId, a.sha256);
}

// ---------------------------------------------------------------------------
// Procedures
// ---------------------------------------------------------------------------

export type UploadStartOut = { partSize: number; partCount: number; done: number[] };

/** Opens the multipart upload, or the one already open for the same parts (resume). */
export async function uploadStart(ctx: IngestCtx, input: { artifactId: string; parts: string[] }): Promise<UploadStartOut> {
  const a = await loadArtifact(ctx, input.artifactId);
  const bucket = needBucket();
  const partCount = partCountFor(a.sizeBytes);
  const all = Array.from({ length: partCount }, (_, i) => i + 1);
  if (a.vaultState === "stored") return { partSize: RAW_PART_BYTES, partCount, done: all };
  if (!goesInParts(a.sizeBytes)) throw new TRPCError({ code: "BAD_REQUEST", message: ONE_PIECE });
  if (input.parts.length !== partCount) throw new TRPCError({ code: "BAD_REQUEST", message: PART_LIST_WRONG });
  const key = rawKey(ctx.companyId, a.sha256);
  // Completed but not checked yet (a lost answer): every part is in, the browser goes on to complete.
  if (await bucket.head(key)) return { partSize: RAW_PART_BYTES, partCount, done: all };

  const plan = await readPlan(bucket, ctx.companyId, a.sha256);
  if (plan && plan.partSize === RAW_PART_BYTES && plan.size === a.sizeBytes && plan.parts.join() === input.parts.join()) {
    const done = await recordedParts(bucket, ctx.companyId, a.sha256, plan.uploadId);
    return { partSize: RAW_PART_BYTES, partCount, done: [...done.keys()].sort((x, y) => x - y) };
  }
  if (plan) {
    await bucket.resumeMultipartUpload(key, plan.uploadId).abort().catch(() => undefined);
    await clearUpload(bucket, ctx.companyId, a.sha256);
  }
  const upload = await bucket.createMultipartUpload(key, {
    httpMetadata: { contentType: a.contentType || "application/octet-stream" },
    customMetadata: {
      upload: "parts",
      companyId: ctx.companyId,
      artifactId: a.id,
      uploadedBy: ctx.session.user.id,
      fileName: a.fileName.slice(0, 255),
      contentType: (a.contentType ?? "").slice(0, 200),
    },
  });
  const fresh: UploadPlan = {
    v: 1,
    uploadId: upload.uploadId,
    artifactId: a.id,
    userId: ctx.session.user.id,
    size: a.sizeBytes,
    partSize: RAW_PART_BYTES,
    partCount,
    parts: input.parts,
    createdAt: now().getTime(),
  };
  await bucket.put(uploadPlanKey(ctx.companyId, a.sha256), JSON.stringify(fresh), { httpMetadata: { contentType: "application/json" } });
  return { partSize: RAW_PART_BYTES, partCount, done: [] };
}

export type PartTicketOut = { part: number; url: string; expiresAt: number };

/** Signed PUTs for the named parts, each 10 minutes, digests from the plan. */
export async function uploadTickets(ctx: IngestCtx, input: { artifactId: string; parts: number[] }): Promise<{ tickets: PartTicketOut[] }> {
  const a = await loadArtifact(ctx, input.artifactId);
  const bucket = needBucket();
  const plan = await readPlan(bucket, ctx.companyId, a.sha256);
  if (!plan) throw new TRPCError({ code: "BAD_REQUEST", message: UPLOAD_RAN_OUT });
  const at = now().getTime();
  const tickets: PartTicketOut[] = [];
  for (const n of [...new Set(input.parts)]) {
    if (!Number.isInteger(n) || n < 1 || n > plan.partCount) throw new TRPCError({ code: "BAD_REQUEST", message: PART_LIST_WRONG });
    const exp = at + INGEST_TICKET_TTL_MS;
    const ticket = await signPartTicket({
      v: 1,
      purpose: PART_PURPOSE,
      companyId: ctx.companyId,
      userId: ctx.session.user.id,
      artifactId: a.id,
      sha256: a.sha256,
      key: rawKey(ctx.companyId, a.sha256),
      uploadId: plan.uploadId,
      part: n,
      size: partBytes(plan.size, n, plan.partSize),
      partSha256: plan.parts[n - 1]!,
      exp,
    });
    tickets.push({ part: n, url: `${apiOrigin(ctx)}/files/ingest/part?${new URLSearchParams({ ticket }).toString()}`, expiresAt: exp });
  }
  return { tickets };
}

/** Completes the upload and checks the whole file. Safe to call again. */
export async function uploadComplete(ctx: IngestCtx, artifactId: string): Promise<{ vaultState: ArtifactSummary["vaultState"] }> {
  const a = await loadArtifact(ctx, artifactId);
  if (a.vaultState === "stored") return { vaultState: "stored" };
  const bucket = needBucket();
  const key = rawKey(ctx.companyId, a.sha256);
  if (!(await bucket.head(key))) {
    const plan = await readPlan(bucket, ctx.companyId, a.sha256);
    if (!plan) throw new TRPCError({ code: "BAD_REQUEST", message: UPLOAD_RAN_OUT });
    const done = await recordedParts(bucket, ctx.companyId, a.sha256, plan.uploadId);
    const parts: R2UploadedPart[] = [];
    for (let n = 1; n <= plan.partCount; n += 1) {
      const p = done.get(n);
      if (!p) throw new TRPCError({ code: "BAD_REQUEST", message: PARTS_MISSING });
      parts.push({ partNumber: n, etag: p.etag });
    }
    try {
      await bucket.resumeMultipartUpload(key, plan.uploadId).complete(parts);
    } catch (error) {
      if (!isGone(error)) throw error;
      await clearUpload(bucket, ctx.companyId, a.sha256);
      throw new TRPCError({ code: "BAD_REQUEST", message: UPLOAD_RAN_OUT });
    }
  }
  await confirmWhole(ctx, bucket, a);
  return { vaultState: "stored" };
}

/** The file was taken off the strip while it was saving: the multipart upload and its records go. */
export async function uploadAbort(ctx: IngestCtx, artifactId: string): Promise<{ aborted: boolean }> {
  const a = await loadArtifact(ctx, artifactId);
  if (a.vaultState === "stored") return { aborted: false };
  const bucket = needBucket();
  const key = rawKey(ctx.companyId, a.sha256);
  const plan = await readPlan(bucket, ctx.companyId, a.sha256);
  if (plan) await bucket.resumeMultipartUpload(key, plan.uploadId).abort().catch(() => undefined);
  // An object completed from parts but never checked is not kept either.
  const head = await bucket.head(key);
  if (head?.customMetadata?.upload === "parts") await bucket.delete(key);
  await clearUpload(bucket, ctx.companyId, a.sha256);
  return { aborted: plan !== null };
}

/** `commitRaw` for an object made from parts: stored only through the whole-file check. */
export function madeFromParts(head: R2Object | null): boolean {
  return head?.customMetadata?.upload === "parts";
}

// ---------------------------------------------------------------------------
// Part ticket and route
// ---------------------------------------------------------------------------

const PART_PURPOSE = "ingest-part" as const;

export type IngestPartTicket = {
  v: 1;
  purpose: typeof PART_PURPOSE;
  companyId: string;
  userId: string;
  artifactId: string;
  sha256: string;
  /** The raw key, built on the server. */
  key: string;
  uploadId: string;
  part: number;
  /** The exact byte count of this part. */
  size: number;
  partSha256: string;
  exp: number;
};

export async function signPartTicket(ticket: IngestPartTicket): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(ticket)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(PART_PURPOSE), new TextEncoder().encode(`${PART_PURPOSE}:${payload}`));
  return `${payload}.${hex(sig)}`;
}

/** The part ticket when it carries a valid `ingest-part` signature, has not expired and names its own raw key; else null. */
export async function readPartTicket(text: string, at: number = Date.now()): Promise<IngestPartTicket | null> {
  const m = /^([A-Za-z0-9_-]{1,4000})\.([0-9a-f]{64})$/.exec(text);
  if (!m) return null;
  const [, payload, sigHex] = m as unknown as [string, string, string];
  const sig = new Uint8Array(sigHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  if (!(await crypto.subtle.verify("HMAC", await hmacKey(PART_PURPOSE), sig, new TextEncoder().encode(`${PART_PURPOSE}:${payload}`)))) return null;
  let t: IngestPartTicket;
  try {
    t = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as IngestPartTicket;
  } catch {
    return null;
  }
  if (!t || typeof t !== "object" || t.purpose !== PART_PURPOSE || t.v !== 1) return null;
  if (!Number.isFinite(t.exp) || t.exp < at) return null;
  if (typeof t.companyId !== "string" || !/^[0-9a-f]{64}$/.test(t.sha256) || !/^[0-9a-f]{64}$/.test(t.partSha256)) return null;
  if (t.key !== rawKey(t.companyId, t.sha256)) return null;
  if (!Number.isInteger(t.part) || t.part < 1 || t.part > RAW_MAX_PARTS) return null;
  if (!Number.isInteger(t.size) || t.size < 1 || t.size > RAW_PART_BYTES || typeof t.uploadId !== "string") return null;
  return t;
}

/** A stream of known length (for `uploadPart`) whose bytes also run into `DigestStream`. */
function digestTap(body: ReadableStream<Uint8Array>, length: number): { stream: ReadableStream; done: Promise<string> } {
  const digest = newDigestStream();
  const writer = digest.getWriter();
  const fixed = new FixedLengthStream(length);
  const tap = new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, c) {
      await writer.write(chunk);
      c.enqueue(chunk);
    },
    async flush() {
      await writer.close();
    },
  });
  const piped = body.pipeThrough(tap).pipeTo(fixed.writable as WritableStream<Uint8Array>);
  return { stream: fixed.readable, done: piped.then(async () => hex(await digest.digest)) };
}

/**
 * Worker route `PUT /files/ingest/part?ticket=...` (no session: the ticket is the authority). Exact Content-Length,
 * the plan must still name the ticket's upload, the part's old record goes first, the bytes stream into R2 and into
 * `DigestStream`, and the part is recorded only when its digest matches the ticket.
 */
export async function handleIngestPart(request: Request, opts: { bucket?: R2Bucket | null; now?: number } = {}): Promise<Response> {
  const text = (body: string, status: number) =>
    new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } });
  if (!dieFileSigningReady()) return text("File storage is not set up", 503);
  const bucket = opts.bucket === undefined ? ingestVault() : opts.bucket;
  if (!bucket) return text("File storage is not set up", 503);
  const t = await readPartTicket(new URL(request.url).searchParams.get("ticket") ?? "", opts.now ?? Date.now());
  if (!t) return text("Link expired or not valid", 403);
  const declared = request.headers.get("content-length");
  if (declared === null || !/^\d+$/.test(declared)) return text("Send the part with its length", 411);
  if (Number(declared) !== t.size || !request.body) return text("The part size does not match", 400);
  const plan = await readPlan(bucket, t.companyId, t.sha256);
  if (!plan || plan.uploadId !== t.uploadId) return text("This upload was started again", 409);

  const old = await recordedParts(bucket, t.companyId, t.sha256, t.uploadId);
  const stale = old.get(t.part);
  if (stale) await bucket.delete(stale.key);

  const tap = digestTap(request.body, t.size);
  let etag: string;
  let got: string;
  try {
    const [part, digest] = await Promise.all([bucket.resumeMultipartUpload(t.key, t.uploadId).uploadPart(t.part, tap.stream), tap.done]);
    etag = part.etag;
    got = digest;
  } catch (error) {
    if (isGone(error)) {
      await clearUpload(bucket, t.companyId, t.sha256);
      return text("This upload ran out. Start it again.", 410);
    }
    throw error;
  }
  if (got !== t.partSha256) return text("The part does not match its digest", 400);
  await bucket.put(markerKey(t.companyId, t.sha256, t.uploadId, t.part, etag), "");
  return new Response(JSON.stringify({ ok: true, part: t.part }), { status: 200, headers: { "content-type": "application/json" } });
}
