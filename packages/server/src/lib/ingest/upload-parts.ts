/**
 * Raw files larger than one part go to the vault by the R2 multipart API, through the Worker (limits brief part B,
 * plan `docs/superpowers/plans/2026-11-20-chunked-upload.md`).
 *
 * - The plan of one upload (upload id, part size, part count and the SHA-256 of every part) is an object the Worker
 *   writes under the artifact's own folder, with the company from the session: `upload/plan.json`.
 * - Each part goes with a short signed ticket (purpose `ingest-part`, 10 minutes) that names one part, its exact size
 *   and its digest. The part route checks the digest as the part streams into R2 (`crypto.DigestStream`) and records
 *   the part only when it matches: one marker per part, `upload/<uploadId>/p<n>`, with the ETag in its custom
 *   metadata (the binding cannot list parts). The part route reads only the plan's head, never the plan body.
 * - R2 has no whole-object checksum for multipart. After `complete`, the object is streamed once through
 *   `DigestStream`; only a match marks the artifact stored. One check runs at a time (`upload/check.json`); a check
 *   that fails, or that never finished (the request ran out of CPU), marks the file failed and is not run again.
 * - The vault's lifecycle rule (`alchemy.run.ts`) aborts an unfinished multipart upload after 1 day; the part route
 *   then answers 410 and the browser starts again. The daily cron clears what is left (`sweepUnfinishedUploads`).
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, lt, ne, sql, type SQL } from "drizzle-orm";

import { ingestArtifact, ingestCandidate } from "@orrn/db/schema/ingest";

import type { OrrnDb, SqliteBatchItem } from "../atomic";
import { effectiveLimits } from "../effectiveLimits";
import { now } from "../clock";
import { base64url, dieFileSigningReady, fromBase64url, hex, hmacKey, apiOrigin } from "../dieFiles";
import { GIB, PLANT_LIMITS, UPLOAD_FILE_CEILING_BYTES } from "../plantLimits";
import { guardedBatch, ingestAbortUnlessChanged, loadArtifact, type ArtifactRow } from "./core";
import { digestTap, streamSha256 } from "./stream-digest";
import { isVisualKind, type ArtifactSummary, type IngestCtx } from "./types";
import { artifactPrefix, ingestVault, INGEST_TICKET_TTL_MS, rawKey, vaultReady } from "./vault";

export { streamSha256 } from "./stream-digest";

/** One part: under the 100 MB Worker body limit, over R2's 5 MiB floor, a small slice of the 128 MB Worker memory. */
export const RAW_PART_BYTES = 16 * 1024 * 1024;
/** R2's most parts in one upload. */
export const RAW_MAX_PARTS = 10_000;
/** R2's structural bound (10,000 parts): the zod bound, loose on purpose so `begin` refuses with plant words. */
export const RAW_MAX_BYTES = RAW_PART_BYTES * RAW_MAX_PARTS;
/** The most parts any plant's file can have (the `uploadFileMiB` ceiling, 2 GiB, is 128 parts). */
export const RAW_PLAN_MAX_PARTS = Math.ceil(UPLOAD_FILE_CEILING_BYTES / RAW_PART_BYTES);
/** An unfinished upload older than this is not resumed: the vault's lifecycle rule aborts it after 1 day. */
export const PLAN_RESUME_MS = 20 * 60 * 60 * 1000;
/** An upload begun longer ago than this holds no part in R2 (lifecycle rule) and is cleared by the daily cron. */
export const UNFINISHED_UPLOAD_MS = 24 * 60 * 60 * 1000;
/** The daily sweep looks at rows that crossed the one-day line within this window (each is seen on two runs). */
export const SWEEP_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
/** Part tickets asked for in one call (the zod bound). */
export const PART_TICKETS_PER_CALL = 8;
/**
 * Part tickets issued in one call, the first ones asked for. A ticket lasts 10 minutes, so on a slow line a ticket
 * issued far ahead of its part would run out before the part starts (server review N8).
 */
export const PART_TICKETS_ISSUED = 2;
/** A whole-file check younger than this may still be running; an older one never finished. */
export const CHECK_HOLD_MS = 5 * 60 * 1000;

/** Server sentences (the web maps each in `features/ingest/lib/errors.ts`, `UPLOAD_SENTENCES`). */
export const PARTS_MISSING = "Some parts of the file have not arrived. Add the same file again to send them.";
export const DIGEST_MISMATCH = "The file does not match its digest";
export const UPLOAD_RAN_OUT = "The upload ran out. Add the same file again.";
export const ONE_PIECE = "This file is sent in one piece";
export const PART_LIST_WRONG = "The part list does not match this file";
export const CHECK_RUNNING = "This file is still being checked. Try again in a minute.";
export const CHECK_FAILED = "orrn could not check this file after it arrived. Remove it and add it again.";
export const SOMEONE_ELSE_SENDING = "Someone else is sending this file now. Try again when they finish.";

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
const markerKey = (companyId: string, sha256: string, uploadId: string, n: number) => `${markerPrefix(companyId, sha256, uploadId)}p${n}`;
/** The lock of the whole-file check (`{ at, userId }`), created only when absent. */
export const checkKey = (companyId: string, sha256: string) => `${artifactPrefix(companyId, sha256)}/upload/check.json`;

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

/** The parts recorded for an upload: part number to ETag (one marker per part, the ETag in its custom metadata). */
async function recordedParts(bucket: R2Bucket, companyId: string, sha256: string, uploadId: string): Promise<Map<number, { etag: string; key: string }>> {
  const prefix = markerPrefix(companyId, sha256, uploadId);
  const out = new Map<number, { etag: string; key: string }>();
  let cursor: string | undefined;
  do {
    // `include` is honoured at every compatibility date this Worker runs (2022-08-04 and later); the default
    // workers-types entry point predates it, hence the cast.
    const page = await bucket.list({ prefix, cursor, limit: 1000, include: ["customMetadata"] } as R2ListOptions);
    for (const o of page.objects) {
      const m = /^p(\d{1,5})$/.exec(o.key.slice(prefix.length));
      const etag = o.customMetadata?.etag;
      if (m && etag) out.set(Number(m[1]), { etag, key: o.key });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

/** Deletes every part marker of one upload; the plan and the multipart upload stay. */
async function clearMarkers(bucket: R2Bucket, companyId: string, sha256: string, uploadId: string): Promise<void> {
  const keys = [...(await recordedParts(bucket, companyId, sha256, uploadId)).values()].map((p) => p.key);
  for (let i = 0; i < keys.length; i += 1000) await bucket.delete(keys.slice(i, i + 1000));
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

/** The plant's storage quota (`vaultQuotaGiB`) would be passed. */
export function storageFullWords(quotaGiB: number): string {
  return quotaGiB >= PLANT_LIMITS.vaultQuotaGiB.ceiling
    ? `This plant's file storage is full (${quotaGiB} GB).`
    : `This plant's file storage is full (${quotaGiB} GB). orrn support can raise it.`;
}

/**
 * Raw bytes the plant holds in the vault, from D1 (never an R2 listing): stored files, plus uploads begun or resumed
 * in the last day. An older unfinished upload holds no parts: the lifecycle rule aborts them after 1 day.
 */
export function vaultBytesSql(companyId: string, at: Date): SQL {
  const since = new Date(at.getTime() - UNFINISHED_UPLOAD_MS);
  return sql`(select coalesce(sum(${ingestArtifact.sizeBytes}), 0) from ${ingestArtifact} where ${ingestArtifact.companyId} = ${companyId} and (${ingestArtifact.vaultState} = 'stored' or (${ingestArtifact.vaultState} = 'pending' and ${ingestArtifact.updatedAt} >= ${since.getTime()})))`;
}

/**
 * Fails the batch when the statements before it took the plant past its quota: a no-op update of the file's own row
 * that matches only while the plant's bytes are within the quota, then the abort (D1 batches take builder statements
 * with bound values; a raw statement with values does not prepare in a batch).
 */
export function quotaGuard(ctx: Pick<IngestCtx, "db" | "companyId">, artifactId: string, at: Date, quotaGiB: number): SqliteBatchItem[] {
  return [
    ctx.db
      .update(ingestArtifact)
      .set({ updatedAt: at })
      .where(and(eq(ingestArtifact.id, artifactId), eq(ingestArtifact.companyId, ctx.companyId), sql`${vaultBytesSql(ctx.companyId, at)} <= ${quotaGiB * GIB}`)),
    ingestAbortUnlessChanged(ctx.db),
  ];
}

function needBucket(): R2Bucket {
  const bucket = ingestVault();
  if (!bucket || !vaultReady()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "File storage is not set up for this plant yet" });
  return bucket;
}

const errorText = (error: unknown) => String((error as Error)?.message ?? error);
/** NoSuchUpload (10024): the lifecycle rule (1 day) or another call aborted the upload. */
function isGone(error: unknown): boolean {
  return /10024|NoSuchUpload|does not exist/i.test(errorText(error));
}
/** InvalidPart (10025): a recorded ETag is not the part R2 holds (two PUTs of one part crossed). The upload stays. */
function isInvalidPart(error: unknown): boolean {
  return /10025|InvalidPart/i.test(errorText(error));
}

// ---------------------------------------------------------------------------
// Whole-file check
// ---------------------------------------------------------------------------

type CheckLock = { at: number; userId: string };

/**
 * Takes the lock of the whole-file check. `null` when taken; else the age of the lock already there. A lock is created
 * only when absent (`etagDoesNotMatch: "*"`), so two completes never hash at once.
 */
async function takeCheck(ctx: IngestCtx, bucket: R2Bucket, sha256: string): Promise<number | null> {
  const body: CheckLock = { at: now().getTime(), userId: ctx.session.user.id };
  const put = await bucket.put(checkKey(ctx.companyId, sha256), JSON.stringify(body), {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" },
  });
  if (put) return null;
  const held = await bucket.get(checkKey(ctx.companyId, sha256));
  if (!held) return 0;
  try {
    const lock = JSON.parse(await held.text()) as CheckLock;
    return Number.isFinite(lock.at) ? Math.max(0, now().getTime() - lock.at) : CHECK_HOLD_MS;
  } catch {
    return CHECK_HOLD_MS;
  }
}

/**
 * One failed whole-file check (a wrong digest, or a check that never finished): the object and the upload folder go,
 * the file is marked failed with plain words, and the check is not run again until the file is added again.
 */
async function failWhole(ctx: IngestCtx, bucket: R2Bucket, a: Pick<ArtifactRow, "id" | "sha256" | "kind">, words: string): Promise<never> {
  const key = rawKey(ctx.companyId, a.sha256);
  const plan = await readPlan(bucket, ctx.companyId, a.sha256);
  if (plan) await bucket.resumeMultipartUpload(key, plan.uploadId).abort().catch(() => undefined);
  const head = await bucket.head(key);
  if (madeFromParts(head)) await bucket.delete(key);
  await clearUpload(bucket, ctx.companyId, a.sha256);
  // A PDF or photo is only its bytes, so the file is marked failed. A sheet, CSV or SQL file was read in the browser:
  // its tables stay, and marking it failed would make the next add read it again and drop them. With the object gone
  // the check cannot run again either way; the next complete says the upload ran out.
  if (isVisualKind(a.kind)) {
    await ctx.db
      .update(ingestArtifact)
      .set({ readState: "failed", readError: words, updatedAt: now() })
      .where(and(eq(ingestArtifact.id, a.id), eq(ingestArtifact.companyId, ctx.companyId), ne(ingestArtifact.vaultState, "stored")));
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: words });
}

/**
 * The stored object must give the artifact's SHA-256 and size. On a match the artifact is stored and the upload
 * folder goes; on a mismatch the object and the upload folder go, the file is marked failed and the call fails.
 */
async function confirmWhole(ctx: IngestCtx, bucket: R2Bucket, a: ArtifactRow): Promise<void> {
  const key = rawKey(ctx.companyId, a.sha256);
  const obj = await bucket.get(key);
  if (!obj) throw new TRPCError({ code: "BAD_REQUEST", message: PARTS_MISSING });
  const held = await takeCheck(ctx, bucket, a.sha256);
  if (held !== null) {
    await obj.body.cancel().catch(() => undefined);
    // Another complete is hashing it now; a lock older than any check can run means that check died (CPU limit).
    if (held < CHECK_HOLD_MS) throw new TRPCError({ code: "CONFLICT", message: CHECK_RUNNING });
    return failWhole(ctx, bucket, a, CHECK_FAILED);
  }
  const sha256 = await streamSha256(obj.body);
  if (sha256 !== a.sha256 || obj.size !== a.sizeBytes) return failWhole(ctx, bucket, a, DIGEST_MISMATCH);
  // A file marked failed by an earlier check and added again goes back to where a new file starts.
  const back = a.readError === CHECK_FAILED || a.readError === DIGEST_MISMATCH;
  await ctx.db
    .update(ingestArtifact)
    .set({ vaultState: "stored", updatedAt: now(), ...(back ? { readState: isVisualKind(a.kind) ? "kept_unread" : a.readState, readError: isVisualKind(a.kind) ? null : a.readError } : {}) })
    .where(and(eq(ingestArtifact.id, a.id), eq(ingestArtifact.companyId, ctx.companyId), ne(ingestArtifact.vaultState, "stored")));
  // Taken off the strip while it was hashed (server review N6, security L8): the bytes must still be the ones hashed.
  const after = await bucket.head(key);
  if (!after || after.etag !== obj.etag) {
    await ctx.db
      .update(ingestArtifact)
      .set({ vaultState: "pending", updatedAt: now() })
      .where(and(eq(ingestArtifact.id, a.id), eq(ingestArtifact.companyId, ctx.companyId)));
    await clearUpload(bucket, ctx.companyId, a.sha256);
    throw new TRPCError({ code: "BAD_REQUEST", message: UPLOAD_RAN_OUT });
  }
  await clearUpload(bucket, ctx.companyId, a.sha256);
}

/** True while a whole-file check of this file may still be running. */
async function checkRunning(bucket: R2Bucket, companyId: string, sha256: string): Promise<boolean> {
  const held = await bucket.get(checkKey(companyId, sha256));
  if (!held) return false;
  try {
    const lock = JSON.parse(await held.text()) as CheckLock;
    return now().getTime() - lock.at < CHECK_HOLD_MS;
  } catch {
    return false;
  }
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
  // R2 aborts an unfinished upload after 7 days: a plan close to that age is started again rather than resumed.
  const fresh0 = plan !== null && now().getTime() - plan.createdAt < PLAN_RESUME_MS;
  if (plan && fresh0 && plan.partSize === RAW_PART_BYTES && plan.size === a.sizeBytes && plan.parts.join() === input.parts.join()) {
    const done = await recordedParts(bucket, ctx.companyId, a.sha256, plan.uploadId);
    return { partSize: RAW_PART_BYTES, partCount, done: [...done.keys()].sort((x, y) => x - y) };
  }
  // Another person's upload of this file still running is not replaced; they, or anyone, may remove it first (L7).
  if (plan && fresh0 && plan.userId !== ctx.session.user.id) throw new TRPCError({ code: "CONFLICT", message: SOMEONE_ELSE_SENDING });
  // A new multipart upload holds bytes from now: the file counts against the plant's quota again (security M1), even
  // when its row is older than a day and had dropped out of the count.
  const at = now();
  const quotaGiB = (await effectiveLimits(ctx)).vaultQuotaGiB;
  await guardedBatch(
    ctx.db,
    [
      ctx.db
        .update(ingestArtifact)
        .set({ updatedAt: at })
        .where(and(eq(ingestArtifact.id, a.id), eq(ingestArtifact.companyId, ctx.companyId), ne(ingestArtifact.vaultState, "stored"))),
      ingestAbortUnlessChanged(ctx.db),
      ...quotaGuard(ctx, a.id, at, quotaGiB),
    ],
    { code: "PRECONDITION_FAILED", message: storageFullWords(quotaGiB) },
  );
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
  // The upload id rides in the custom metadata too, so the part route reads only the head (server review S9).
  await bucket.put(uploadPlanKey(ctx.companyId, a.sha256), JSON.stringify(fresh), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { uploadId: upload.uploadId },
  });
  return { partSize: RAW_PART_BYTES, partCount, done: [] };
}

export type PartTicketOut = { part: number; url: string; expiresAt: number };

/** Signed PUTs for the first `PART_TICKETS_ISSUED` parts named, each 10 minutes, digests from the plan. */
export async function uploadTickets(ctx: IngestCtx, input: { artifactId: string; parts: number[] }): Promise<{ tickets: PartTicketOut[] }> {
  const a = await loadArtifact(ctx, input.artifactId);
  const bucket = needBucket();
  const plan = await readPlan(bucket, ctx.companyId, a.sha256);
  if (!plan) throw new TRPCError({ code: "BAD_REQUEST", message: UPLOAD_RAN_OUT });
  const at = now().getTime();
  const tickets: PartTicketOut[] = [];
  const asked = [...new Set(input.parts)];
  for (const n of asked) {
    if (!Number.isInteger(n) || n < 1 || n > plan.partCount) throw new TRPCError({ code: "BAD_REQUEST", message: PART_LIST_WRONG });
  }
  for (const n of asked.slice(0, PART_TICKETS_ISSUED)) {
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
      // Two PUTs of one part crossed and a marker names the part R2 replaced (S8): the upload stays, the parts are
      // sent again.
      if (isInvalidPart(error)) {
        await clearMarkers(bucket, ctx.companyId, a.sha256, plan.uploadId);
        throw new TRPCError({ code: "BAD_REQUEST", message: PARTS_MISSING });
      }
      if (!isGone(error)) throw error;
      // A second complete at the same time (N5): the first one completed it, or already stored it.
      const again = await loadArtifact(ctx, artifactId);
      if (again.vaultState === "stored") return { vaultState: "stored" };
      if (!(await bucket.head(key))) {
        await clearUpload(bucket, ctx.companyId, a.sha256);
        throw new TRPCError({ code: "BAD_REQUEST", message: UPLOAD_RAN_OUT });
      }
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
  // The whole-file check is reading the object: removing it now would leave a stored row with no bytes (N6, L8).
  if (await checkRunning(bucket, ctx.companyId, a.sha256)) throw new TRPCError({ code: "CONFLICT", message: CHECK_RUNNING });
  return { aborted: await dropUnfinished(bucket, ctx.companyId, a.sha256) };
}

/** Aborts the multipart upload, deletes an object made from parts that was never checked, and the upload folder. */
async function dropUnfinished(bucket: R2Bucket, companyId: string, sha256: string): Promise<boolean> {
  const key = rawKey(companyId, sha256);
  const plan = await readPlan(bucket, companyId, sha256);
  if (plan) await bucket.resumeMultipartUpload(key, plan.uploadId).abort().catch(() => undefined);
  // An object completed from parts but never checked is not kept either.
  if (madeFromParts(await bucket.head(key))) await bucket.delete(key);
  await clearUpload(bucket, companyId, sha256);
  return plan !== null;
}

/**
 * Discard (security L6): when a file's last live sheet is discarded and its bytes never finished arriving, the
 * multipart upload is aborted and its plan and part markers deleted. A file with another live sheet, or stored
 * bytes, keeps everything. Called after the discard has landed; never throws.
 */
export async function abortIfAbandoned(ctx: Pick<IngestCtx, "db" | "companyId">, artifactId: string): Promise<boolean> {
  const bucket = ingestVault();
  if (!bucket || !vaultReady()) return false;
  try {
    const a = await loadArtifact(ctx, artifactId);
    if (a.vaultState === "stored") return false;
    const [live] = await ctx.db
      .select({ id: ingestCandidate.id })
      .from(ingestCandidate)
      .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.artifactId, artifactId), ne(ingestCandidate.state, "discarded")))
      .limit(1);
    if (live) return false;
    if (await checkRunning(bucket, ctx.companyId, a.sha256)) return false;
    return await dropUnfinished(bucket, ctx.companyId, a.sha256);
  } catch {
    return false;
  }
}

/**
 * Daily cron (security L6, server review N7): uploads begun more than a day ago and never stored. The lifecycle rule
 * has aborted their parts by then; the plan, the markers and any object made from parts that was never checked go.
 * A file sent in one piece whose commit never came (the bytes are there, checked by R2 against the signed SHA-256)
 * is marked stored, so its bytes count against the plant's quota. The row stays `pending` otherwise: the approve
 * gate keeps refusing a file whose bytes are not stored. Only rows that crossed the one-day line in the last
 * `SWEEP_WINDOW_MS` are looked at, newest first, at most `limit` a run: a row the sweep cannot resolve stays `pending`,
 * and an unbounded query would pick the same old rows every day and never reach new ones.
 */
export async function sweepUnfinishedUploads(db: OrrnDb, bucket: R2Bucket, at: Date, limit = 500): Promise<{ cleared: number; stored: number }> {
  const line = at.getTime() - UNFINISHED_UPLOAD_MS;
  const rows = await db
    .select({ id: ingestArtifact.id, companyId: ingestArtifact.companyId, sha256: ingestArtifact.sha256, sizeBytes: ingestArtifact.sizeBytes })
    .from(ingestArtifact)
    .where(
      and(
        eq(ingestArtifact.vaultState, "pending"),
        lt(ingestArtifact.updatedAt, new Date(line)),
        gte(ingestArtifact.updatedAt, new Date(line - SWEEP_WINDOW_MS)),
      ),
    )
    .orderBy(desc(ingestArtifact.updatedAt))
    .limit(limit);
  let cleared = 0;
  let stored = 0;
  for (const r of rows) {
    const head = await bucket.head(rawKey(r.companyId, r.sha256));
    if (head && !madeFromParts(head) && head.size === r.sizeBytes) {
      await db
        .update(ingestArtifact)
        .set({ vaultState: "stored", updatedAt: at })
        .where(and(eq(ingestArtifact.id, r.id), eq(ingestArtifact.companyId, r.companyId), eq(ingestArtifact.vaultState, "pending")));
      stored += 1;
      continue;
    }
    if (await checkRunning(bucket, r.companyId, r.sha256)) continue;
    if (await dropUnfinished(bucket, r.companyId, r.sha256)) cleared += 1;
    else if (head) cleared += 1;
  }
  return { cleared, stored };
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
  // The plan's head only (S9): the ticket already carries the part's digest, and the upload id rides in the metadata.
  const planHead = await bucket.head(uploadPlanKey(t.companyId, t.sha256));
  const current = planHead ? (planHead.customMetadata?.uploadId ?? (await readPlan(bucket, t.companyId, t.sha256))?.uploadId) : undefined;
  if (current !== t.uploadId) return text("This upload was started again", 409);

  const marker = markerKey(t.companyId, t.sha256, t.uploadId, t.part);
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
  if (got !== t.partSha256) {
    // R2 now holds these wrong bytes for the part: any earlier record of it no longer counts.
    await bucket.delete(marker);
    return text("The part does not match its digest", 400);
  }
  // One marker per part (S8): a later PUT of the same part replaces it, so no stale ETag is left to list.
  await bucket.put(marker, "", { customMetadata: { etag } });
  return new Response(JSON.stringify({ ok: true, part: t.part }), { status: 200, headers: { "content-type": "application/json" } });
}
