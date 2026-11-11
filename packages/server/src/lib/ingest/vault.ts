/**
 * The Infinity Portal vault (plan A2): raw file bytes in R2, kept forever, under
 * `tenants/<companyId>/artifacts/<sha256>/`. Bytes never go in D1 and never through a tRPC body.
 *
 * - Binding `INGEST_VAULT`, optional. Without it (`ORRN_SKIP_R2`, or an account without R2) imports
 *   still work from D1 staged rows; `artifact.begin` answers `upload: null` and `vault_state =
 *   'not_stored'`.
 * - Upload tickets reuse the die-file HMAC derivation (`hmacKey` in lib/dieFiles.ts) with three
 *   purposes: `ingest-raw`, `ingest-canonical`, `ingest-page`. 10 minutes, like the die ticket.
 * - The raw PUT passes the ticket's SHA-256 to R2 (`sha256` put option), so R2 itself refuses bytes that
 *   do not match the digest. Checked on Miniflare: a wrong digest is refused with code 10037.
 * - No procedure deletes vault objects. Discarding an artifact keeps its bytes.
 */
import { env } from "@orrn/env/server";

import { base64url, dieFileSigningReady, fromBase64url, hex, hmacKey, apiOrigin } from "../dieFiles";

export const INGEST_TICKET_TTL_MS = 10 * 60 * 1000;

/** The largest canonical rows file accepted (gzip of up to 50,000 rows of 200 cells). */
export const CANONICAL_MAX_BYTES = 60 * 1024 * 1024;
/** A downscaled page image (slice 2). */
export const PAGE_MAX_BYTES = 10 * 1024 * 1024;

export type IngestTicketPurpose = "ingest-raw" | "ingest-canonical" | "ingest-page";
const PURPOSES: readonly IngestTicketPurpose[] = ["ingest-raw", "ingest-canonical", "ingest-page"];

export type IngestTicket = {
  v: 1;
  purpose: IngestTicketPurpose;
  companyId: string;
  userId: string;
  artifactId: string;
  sha256: string;
  /** The full object key. Always under `tenants/<companyId>/artifacts/<sha256>/`. */
  key: string;
  /** raw: the exact byte count. canonical and page: the most bytes accepted. */
  size: number;
  exactSize: boolean;
  contentType: string;
  fileName: string;
  exp: number;
};

/** The vault bucket, or null when this stage has none. */
export function ingestVault(): R2Bucket | null {
  return (env as unknown as { INGEST_VAULT?: R2Bucket }).INGEST_VAULT ?? null;
}

/** True when uploads can be taken: a bucket and the signing key. */
export function vaultReady(): boolean {
  return ingestVault() !== null && dieFileSigningReady();
}

export function artifactPrefix(companyId: string, sha256: string): string {
  return `tenants/${companyId}/artifacts/${sha256}`;
}
export const rawKey = (companyId: string, sha256: string) => `${artifactPrefix(companyId, sha256)}/raw`;
export const canonicalKey = (companyId: string, sha256: string, ordinal: number) =>
  `${artifactPrefix(companyId, sha256)}/canonical/${ordinal}.jsonl.gz`;
export const digestKey = (companyId: string, sha256: string) => `${artifactPrefix(companyId, sha256)}/digest.json`;
export const pageKey = (companyId: string, sha256: string, n: number) => `${artifactPrefix(companyId, sha256)}/pages/${n}.jpg`;

function keyBelongs(t: Pick<IngestTicket, "key" | "companyId" | "sha256">): boolean {
  return t.key.startsWith(`${artifactPrefix(t.companyId, t.sha256)}/`) && !t.key.includes("..");
}

/** `{payload}.{hex HMAC}` signed with the purpose's key. */
export async function signIngestTicket(ticket: IngestTicket): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(ticket)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(ticket.purpose), new TextEncoder().encode(`${ticket.purpose}:${payload}`));
  return `${payload}.${hex(sig)}`;
}

/**
 * The ticket when it carries a valid signature for its own purpose, has not expired and names a key
 * of its own artifact; else null. Throws PRECONDITION_FAILED when the stage has no signing key.
 */
export async function readIngestTicket(text: string, now: number = Date.now()): Promise<IngestTicket | null> {
  const m = /^([A-Za-z0-9_-]{1,4000})\.([0-9a-f]{64})$/.exec(text);
  if (!m) return null;
  const [, payload, sigHex] = m as unknown as [string, string, string];
  let ticket: IngestTicket;
  try {
    ticket = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as IngestTicket;
  } catch {
    return null;
  }
  if (!ticket || typeof ticket !== "object" || !PURPOSES.includes(ticket.purpose)) return null;
  const sig = new Uint8Array(sigHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const key = await hmacKey(ticket.purpose);
  if (!(await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(`${ticket.purpose}:${payload}`)))) return null;
  if (ticket.v !== 1 || !Number.isFinite(ticket.exp) || ticket.exp < now) return null;
  if (!/^[0-9a-f]{64}$/.test(ticket.sha256) || !keyBelongs(ticket)) return null;
  return ticket;
}

export function ingestUploadUrl(ctx: { request?: Request | null }, ticket: string): string {
  return `${apiOrigin(ctx)}/files/ingest/upload?${new URLSearchParams({ ticket }).toString()}`;
}

/** Issue a signed PUT for one object. */
export async function issueTicket(
  ctx: { request?: Request | null },
  t: Omit<IngestTicket, "v" | "exp">,
  now: number = Date.now(),
): Promise<{ url: string; ticket: string; expiresAt: number }> {
  const exp = now + INGEST_TICKET_TTL_MS;
  const ticket = await signIngestTicket({ ...t, v: 1, exp });
  return { url: ingestUploadUrl(ctx, ticket), ticket, expiresAt: exp };
}

/**
 * Worker route `PUT /files/ingest/upload?ticket=...` (no session: the ticket is the authority). O(1):
 * verify the ticket, check Content-Length, refuse an existing object, stream the body into R2. The raw
 * object is put with the ticket's SHA-256, so R2 refuses bytes that do not match.
 */
export async function handleIngestUpload(
  request: Request,
  opts: { bucket?: R2Bucket | null; now?: number } = {},
): Promise<Response> {
  const text = (body: string, status: number) =>
    new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } });
  if (!dieFileSigningReady()) return text("File storage is not set up", 503);
  const bucket = opts.bucket === undefined ? ingestVault() : opts.bucket;
  if (!bucket) return text("File storage is not set up", 503);
  const ticket = await readIngestTicket(new URL(request.url).searchParams.get("ticket") ?? "", opts.now ?? Date.now());
  if (!ticket) return text("Link expired or not valid", 403);
  const declared = request.headers.get("content-length");
  if (declared === null || !/^\d+$/.test(declared)) return text("Send the file with its length", 411);
  const length = Number(declared);
  if (length > ticket.size) return text("The file is larger than declared", 413);
  if ((ticket.exactSize && length !== ticket.size) || length === 0 || !request.body) return text("The file size does not match", 400);
  if (await bucket.head(ticket.key)) return text("This upload is already done", 409);
  const customMetadata: Record<string, string> = {
    companyId: ticket.companyId,
    artifactId: ticket.artifactId,
    uploadedBy: ticket.userId,
    fileName: ticket.fileName.slice(0, 255),
    contentType: ticket.contentType.slice(0, 200),
  };
  try {
    await bucket.put(ticket.key, request.body, {
      httpMetadata: { contentType: ticket.purpose === "ingest-raw" ? ticket.contentType || "application/octet-stream" : ticket.contentType },
      customMetadata,
      ...(ticket.purpose === "ingest-raw" ? { sha256: ticket.sha256 } : {}),
    });
  } catch (error) {
    // R2 code 10037: the bytes do not match the digest the browser signed into the ticket.
    if (/10037|SHA-256 checksum/i.test(String((error as Error)?.message ?? error))) {
      return text("The file does not match its digest", 400);
    }
    throw error;
  }
  return new Response(JSON.stringify({ ok: true, bytes: length }), { status: 200, headers: { "content-type": "application/json" } });
}
