/**
 * Spectro watcher ingest (FP-FD-12). Contract: orrn-spool `docs/spectro-watcher.md`.
 *
 * 1. `POST /collector/spectro/ingest` (node-signed JSON, the HTTP face of `foundry.spectro.ingest`):
 *    `{ instance_id, sha256, fileName, contentType, sizeBytes, capturedAt?, sampleRef?, instrument?,
 *    simulated?, valuesPct? }`. Idempotent on (company, sha256): a file already received answers
 *    `duplicate` with its id; one still waiting for its bytes gets a fresh upload link.
 * 2. `PUT /collector/spectro/upload?u=<ticket>`: the ticket (HMAC, 10 minutes, key derived from
 *    ORRN_MASTER_KEY) names the inbox row, size and SHA-256. The bytes (≤ 5 MB) are hashed before
 *    they are stored; a mismatch is refused. Stored in R2 under `{companyId}/spectro/{inboxId}`,
 *    and the row turns `pending_review`.
 * 3. A person with `cast.enter` attaches it to a melt (`foundry.spectroInbox.attach`) or dismisses
 *    it. Nothing is ever attached automatically: the sample label on the printout is free text and
 *    is never matched to a cast.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { OrrnDb } from "@orrn/db";
import { spectroInbox } from "@orrn/db/schema/collector";

import type { CollectorNode } from "./collectorNode";
import { createId } from "./id";

export const SPECTRO_INGEST_PATH = "/collector/spectro/ingest";
export const SPECTRO_UPLOAD_PATH = "/collector/spectro/upload";
export const SPECTRO_INBOX_MAX_BYTES = 5 * 1024 * 1024;
export const SPECTRO_UPLOAD_TTL_MS = 10 * 60 * 1000;
/** What a spectrometer PC exports: a PDF report, a CSV/TXT result, or a photo / screenshot. */
export const SPECTRO_INBOX_MIMES = ["application/pdf", "text/csv", "text/plain", "image/png", "image/jpeg"] as const;
const ELEMENT_RE = /^[A-Za-z][A-Za-z0-9]{0,7}$/;

export const spectroIngestSchema = z.object({
  instance_id: z.string().min(1).max(128),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, "sha256 is 64 lower-case hex"),
  fileName: z.string().trim().min(1).max(120),
  contentType: z.enum(SPECTRO_INBOX_MIMES),
  sizeBytes: z.number().int().min(1).max(SPECTRO_INBOX_MAX_BYTES),
  capturedAt: z.string().datetime({ offset: true }).nullable().optional(),
  sampleRef: z.string().trim().max(64).nullable().optional(),
  instrument: z.string().trim().max(64).nullable().optional(),
  simulated: z.boolean().optional(),
  /** Parsed by the watcher from a CSV, percent per element (`{ "Si": 0.45 }`). A suggestion only. */
  valuesPct: z.record(z.string().regex(ELEMENT_RE), z.number().finite().min(0).max(100)).optional(),
});
export type SpectroIngestInput = z.infer<typeof spectroIngestSchema>;

/** Alloying elements together above this share mean the units were misread (a ppm export read as %). */
export const SPECTRO_ALLOYING_MAX_PCT = 10;

/**
 * The watcher's parsed values as ppm, or null when they cannot be percent (m-5): the export's units
 * are owner-only, and 6xxx alloying elements (everything but Al) add up to a few percent. The values
 * stay a suggestion either way; the file itself is what a person attaches.
 */
export function plausibleValues(valuesPct: Record<string, number> | undefined): Record<string, number> | null {
  if (!valuesPct) return null;
  const alloying = Object.entries(valuesPct).reduce((sum, [k, v]) => (k.toLowerCase() === "al" ? sum : sum + v), 0);
  if (alloying > SPECTRO_ALLOYING_MAX_PCT) return null;
  return Object.fromEntries(Object.entries(valuesPct).map(([k, v]) => [k, Math.round(v * 10_000)]));
}

export type SpectroIngestResult =
  | { status: "duplicate"; id: string; inboxStatus: string }
  | { status: "upload"; id: string; uploadUrl: string; expiresAt: number };

export function spectroFileKey(companyId: string, inboxId: string): string {
  return `${companyId}/spectro/${inboxId}`;
}

type Ticket = { v: 1; companyId: string; inboxId: string; sha256: string; size: number; contentType: string; exp: number };

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}
async function ticketKey(masterKey: string): Promise<CryptoKey> {
  if (!masterKey) throw new Error("ORRN_MASTER_KEY is not set");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(`orrn-spectro-upload:${masterKey}`), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signSpectroTicket(ticket: Ticket, masterKey: string): Promise<string> {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(ticket)));
  const sig = await crypto.subtle.sign("HMAC", await ticketKey(masterKey), new TextEncoder().encode(`spectro-upload:${payload}`));
  return `${payload}.${hex(sig)}`;
}

export async function readSpectroTicket(uploadId: string, masterKey: string, nowMs: number = Date.now()): Promise<Ticket | null> {
  const m = /^([A-Za-z0-9_-]{1,2000})\.([0-9a-f]{64})$/.exec(uploadId);
  if (!m) return null;
  const payload = m[1]!;
  const sig = Uint8Array.from(m[2]!.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  if (!(await crypto.subtle.verify("HMAC", await ticketKey(masterKey), sig, new TextEncoder().encode(`spectro-upload:${payload}`)))) return null;
  let t: Ticket;
  try {
    t = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Ticket;
  } catch {
    return null;
  }
  if (t.v !== 1 || !Number.isFinite(t.exp) || t.exp < nowMs) return null;
  return t;
}

/** Step 1: record the file (or find it by hash) and hand out a signed PUT link when bytes are owed. */
export async function ingestSpectroFile(
  db: OrrnDb,
  node: CollectorNode,
  input: SpectroIngestInput,
  opts: { origin: string; masterKey: string; nowMs?: number },
): Promise<SpectroIngestResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const companyId = node.companyId;
  let row = await db
    .select({ id: spectroInbox.id, status: spectroInbox.status, sizeBytes: spectroInbox.sizeBytes, mime: spectroInbox.mime })
    .from(spectroInbox)
    .where(and(eq(spectroInbox.companyId, companyId), eq(spectroInbox.sha256, input.sha256)))
    .get();
  if (row && row.status !== "uploading") return { status: "duplicate", id: row.id, inboxStatus: row.status };
  if (!row) {
    const id = createId(nowMs);
    const valuesPpm = plausibleValues(input.valuesPct);
    await db
      .insert(spectroInbox)
      .values({
        id,
        companyId,
        nodeId: node.id,
        sha256: input.sha256,
        fileName: input.fileName,
        mime: input.contentType,
        sizeBytes: input.sizeBytes,
        fileKey: spectroFileKey(companyId, id),
        status: "uploading",
        simulated: input.simulated === true,
        capturedAt: input.capturedAt ? new Date(input.capturedAt) : null,
        sampleRef: input.sampleRef ?? null,
        instrument: input.instrument ?? null,
        valuesPpm,
      })
      .onConflictDoNothing();
    row = await db
      .select({ id: spectroInbox.id, status: spectroInbox.status, sizeBytes: spectroInbox.sizeBytes, mime: spectroInbox.mime })
      .from(spectroInbox)
      .where(and(eq(spectroInbox.companyId, companyId), eq(spectroInbox.sha256, input.sha256)))
      .get();
    if (!row) throw new Error("spectro inbox row vanished");
    if (row.status !== "uploading") return { status: "duplicate", id: row.id, inboxStatus: row.status };
  }
  const exp = nowMs + SPECTRO_UPLOAD_TTL_MS;
  const ticket = await signSpectroTicket(
    { v: 1, companyId, inboxId: row.id, sha256: input.sha256, size: row.sizeBytes, contentType: row.mime, exp },
    opts.masterKey,
  );
  return { status: "upload", id: row.id, uploadUrl: `${opts.origin}${SPECTRO_UPLOAD_PATH}?${new URLSearchParams({ u: ticket })}`, expiresAt: exp };
}

/** Minimal R2 surface used here (a fake in tests). */
export type SpectroBucket = Pick<R2Bucket, "head" | "put">;

/**
 * Step 2: `PUT /collector/spectro/upload?u=<ticket>`. No session and no node token: the ticket is
 * the authority. Hash-checked before storing; idempotent (a second PUT of a received file is 200).
 */
export async function handleSpectroUpload(
  db: OrrnDb,
  request: Request,
  opts: { bucket: SpectroBucket | null | undefined; masterKey: string; nowMs?: number },
): Promise<Response> {
  const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (!opts.masterKey) return json({ error: "File storage is not set up" }, 503);
  if (!opts.bucket) return json({ error: "File storage is not set up" }, 503);
  const ticket = await readSpectroTicket(new URL(request.url).searchParams.get("u") ?? "", opts.masterKey, opts.nowMs);
  if (!ticket) return json({ error: "Link expired or not valid" }, 403);
  // m-8: the size is known up front (the ticket carries it), so a PUT without Content-Length is
  // refused rather than read unbounded.
  const declared = request.headers.get("content-length");
  if (declared === null) return json({ error: "Content-Length required" }, 411);
  if (!/^\d+$/.test(declared) || Number(declared) !== ticket.size) return json({ error: "The file size does not match" }, 400);
  const row = await db
    .select({ id: spectroInbox.id, status: spectroInbox.status, fileKey: spectroInbox.fileKey })
    .from(spectroInbox)
    .where(and(eq(spectroInbox.id, ticket.inboxId), eq(spectroInbox.companyId, ticket.companyId)))
    .get();
  if (!row) return json({ error: "Not found" }, 404);
  if (row.status !== "uploading") return json({ ok: true, id: row.id, status: row.status, already: true }, 200);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength !== ticket.size) return json({ error: "The file size does not match" }, 400);
  const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (digest !== ticket.sha256) return json({ error: "The file does not match its sha256" }, 422);
  if (!(await opts.bucket.head(row.fileKey))) {
    await opts.bucket.put(row.fileKey, bytes, {
      httpMetadata: { contentType: ticket.contentType },
      customMetadata: { companyId: ticket.companyId, inboxId: row.id, sha256: digest },
    });
  }
  await db
    .update(spectroInbox)
    .set({ status: "pending_review", uploadedAt: new Date(opts.nowMs ?? Date.now()) })
    .where(and(eq(spectroInbox.id, row.id), eq(spectroInbox.status, "uploading")));
  return json({ ok: true, id: row.id, status: "pending_review" }, 200);
}
