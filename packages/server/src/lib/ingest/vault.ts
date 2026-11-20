/**
 * The Infinity Portal vault (plan A2): raw file bytes in R2, kept forever, under
 * `tenants/<companyId>/artifacts/<sha256>/`. Bytes never go in D1 and never through a tRPC body.
 *
 * - Binding `INGEST_VAULT`, optional. Without it (`ORRN_SKIP_R2`, or an account without R2) imports
 *   still work from D1 staged rows; `artifact.begin` answers `upload: null` and `vault_state =
 *   'not_stored'`.
 * - Upload tickets reuse the die-file HMAC derivation (`hmacKey` in lib/dieFiles.ts) with three
 *   purposes: `ingest-raw`, `ingest-canonical`, `ingest-page`. 10 minutes, like the die ticket.
 * - Read tickets (vision read, contract section 8) use a fourth purpose, `ingest-read`, and their own
 *   route `GET /files/ingest/read`. The two kinds are not interchangeable: the upload route takes only
 *   the three upload purposes and the read route only `ingest-read`.
 * - The raw PUT passes the ticket's SHA-256 to R2 (`sha256` put option), so R2 itself refuses bytes that
 *   do not match the digest. Checked on Miniflare: a wrong digest is refused with code 10037.
 * - A file over one part goes in parts (`upload-parts.ts`): each part checked by its SHA-256 as it streams, the whole
 *   file checked after complete. Only a mismatch or an unfinished upload taken off the strip deletes a raw object;
 *   discarding an import keeps its bytes.
 */
import { createDb } from "@orrn/db";
import { VISION_PARAMS } from "@orrn/ingest";
import { ingestBlock } from "@orrn/db/schema/ingest";
import { env } from "@orrn/env/server";
import { and, eq } from "drizzle-orm";

import type { OrrnDb } from "../atomic";
import { base64url, dieFileSigningReady, fromBase64url, hex, hmacKey, apiOrigin } from "../dieFiles";

export const INGEST_TICKET_TTL_MS = 10 * 60 * 1000;
/**
 * A read ticket of the raw file (security L1): the browser fetches at once and asks for a new link a minute before
 * one runs out (`vision-read.ts`), so two minutes is enough and a leaked link is useful for less time.
 */
export const RAW_READ_TTL_MS = 2 * 60 * 1000;

/** The largest canonical rows file accepted (gzip of up to 50,000 rows of 200 cells). */
export const CANONICAL_MAX_BYTES = 60 * 1024 * 1024;
/** A page image (vision read): the ticket size and the model's limit. */
export const PAGE_MAX_BYTES: number = VISION_PARAMS.maxPageBytes;

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
  return env.INGEST_VAULT ?? null;
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
/** The validated tables of one page, written before its blocks (contract section 6). */
export const pageTablesKey = (companyId: string, sha256: string, n: number) => `${artifactPrefix(companyId, sha256)}/pages/${n}.tables.json`;
/** The pdfjs text of one text PDF page (`{ v: 1, items: string[] }`), for the digit check (contract section 11.5). */
export const pageTextKey = (companyId: string, sha256: string, n: number) => `${artifactPrefix(companyId, sha256)}/pages/${n}.text.json`;
/** The image of band `k` of page `n` (contract section 11.3). */
export const bandKey = (companyId: string, sha256: string, n: number, k: number) => `${artifactPrefix(companyId, sha256)}/pages/${n}/b${k}.jpg`;
/** The validated tables of band `k` of page `n`, written before any block of the page. */
export const bandTablesKey = (companyId: string, sha256: string, n: number, k: number) => `${artifactPrefix(companyId, sha256)}/pages/${n}/b${k}.tables.json`;
/** The page plan of a file read page by page (contract section 5). */
export const pagesIndexKey = (companyId: string, sha256: string) => `${artifactPrefix(companyId, sha256)}/pages/index.json`;

function keyBelongs(t: Pick<IngestTicket, "key" | "companyId" | "sha256">): boolean {
  return t.key.startsWith(`${artifactPrefix(t.companyId, t.sha256)}/`) && !t.key.includes("..");
}

/**
 * The key shapes each upload purpose may name under its artifact (security L4): the raw file itself; one canonical
 * rows file; and for a page ticket one page image, one band image or one page's text, by page number. The key is
 * built on the server from the artifact row (sha) and the page number, and the ticket is signed, so a page ticket
 * names exactly one page of exactly one file.
 */
const UPLOAD_KEY_SHAPES: Record<IngestTicketPurpose, RegExp> = {
  "ingest-raw": /^\/raw$/,
  "ingest-canonical": /^\/canonical\/\d{1,4}\.jsonl\.gz$/,
  "ingest-page": /^\/pages\/[1-9]\d{0,4}(\.jpg|\.text\.json|\/b[1-9]\.jpg)$/,
};
function keyShapeFits(t: Pick<IngestTicket, "key" | "companyId" | "sha256" | "purpose">): boolean {
  return UPLOAD_KEY_SHAPES[t.purpose].test(t.key.slice(artifactPrefix(t.companyId, t.sha256).length));
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
  if (!/^[0-9a-f]{64}$/.test(ticket.sha256) || !keyBelongs(ticket) || !keyShapeFits(ticket)) return null;
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
 * object is put with the ticket's SHA-256, so R2 refuses bytes that do not match. Every object is created only
 * when absent (`onlyIf: { etagDoesNotMatch: "*" }`): of two PUTs at once exactly one lands, so a page cannot be
 * swapped after the model or the checker saw it (security L4).
 */
export async function handleIngestUpload(
  request: Request,
  opts: { bucket?: R2Bucket | null; now?: number; db?: OrrnDb } = {},
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
  if (await bucket.head(ticket.key)) {
    // A retry after a lost answer: the file is there, so the mark is set again.
    await markCanonical(ticket, opts.db);
    return text("This upload is already done", 409);
  }
  const customMetadata: Record<string, string> = {
    companyId: ticket.companyId,
    artifactId: ticket.artifactId,
    uploadedBy: ticket.userId,
    fileName: ticket.fileName.slice(0, 255),
    contentType: ticket.contentType.slice(0, 200),
  };
  try {
    const put = await bucket.put(ticket.key, request.body, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: ticket.purpose === "ingest-raw" ? ticket.contentType || "application/octet-stream" : ticket.contentType },
      customMetadata,
      ...(ticket.purpose === "ingest-raw" ? { sha256: ticket.sha256 } : {}),
    });
    // Another PUT of the same key landed first while this one streamed.
    if (put === null) {
      await markCanonical(ticket, opts.db);
      return text("This upload is already done", 409);
    }
  } catch (error) {
    // R2 code 10037: the bytes do not match the digest the browser signed into the ticket.
    if (/10037|SHA-256 checksum/i.test(String((error as Error)?.message ?? error))) {
      return text("The file does not match its digest", 400);
    }
    throw error;
  }
  await markCanonical(ticket, opts.db);
  return new Response(JSON.stringify({ ok: true, bytes: length }), { status: 200, headers: { "content-type": "application/json" } });
}

/** Records that a block's canonical rows file landed (`ingest_block.canonical_stored`). Scoped by the signed ticket. */
async function markCanonical(ticket: IngestTicket, db?: OrrnDb): Promise<void> {
  if (ticket.purpose !== "ingest-canonical") return;
  const m = /\/canonical\/(\d{1,4})\.jsonl\.gz$/.exec(ticket.key);
  if (!m) return;
  const conn = db ?? createDb();
  await conn
    .update(ingestBlock)
    .set({ canonicalStored: true })
    .where(and(eq(ingestBlock.companyId, ticket.companyId), eq(ingestBlock.artifactId, ticket.artifactId), eq(ingestBlock.ordinal, Number(m[1]))));
}

// ---------------------------------------------------------------------------
// Signed read (vision read, contract section 8)
// ---------------------------------------------------------------------------

export type IngestReadTicket = {
  v: 1;
  purpose: "ingest-read";
  companyId: string;
  userId: string;
  artifactId: string;
  sha256: string;
  /** The full object key, built on the server. Always under `tenants/<companyId>/artifacts/<sha256>/`. */
  key: string;
  /** `raw`: the stored file, served as an attachment. `page`: a page image, served inline. */
  as: "raw" | "page";
  exp: number;
};

const READ_PURPOSE = "ingest-read" as const;

export async function signIngestReadTicket(ticket: IngestReadTicket): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(ticket)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(READ_PURPOSE), new TextEncoder().encode(`${READ_PURPOSE}:${payload}`));
  return `${payload}.${hex(sig)}`;
}

/**
 * The read ticket when it carries a valid `ingest-read` signature, says `ingest-read`, has not expired,
 * and names a key of its own artifact with the right shape for `as`; else null. The signature is always
 * checked with the `ingest-read` key, never with a key picked from the ticket's own fields.
 */
export async function readIngestReadTicket(text: string, now: number = Date.now()): Promise<IngestReadTicket | null> {
  const m = /^([A-Za-z0-9_-]{1,4000})\.([0-9a-f]{64})$/.exec(text);
  if (!m) return null;
  const [, payload, sigHex] = m as unknown as [string, string, string];
  const sig = new Uint8Array(sigHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  if (!(await crypto.subtle.verify("HMAC", await hmacKey(READ_PURPOSE), sig, new TextEncoder().encode(`${READ_PURPOSE}:${payload}`)))) return null;
  let ticket: IngestReadTicket;
  try {
    ticket = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as IngestReadTicket;
  } catch {
    return null;
  }
  if (!ticket || typeof ticket !== "object" || ticket.purpose !== READ_PURPOSE || ticket.v !== 1) return null;
  if (!Number.isFinite(ticket.exp) || ticket.exp < now) return null;
  if (typeof ticket.companyId !== "string" || typeof ticket.key !== "string" || !/^[0-9a-f]{64}$/.test(ticket.sha256) || !keyBelongs(ticket)) return null;
  const prefix = artifactPrefix(ticket.companyId, ticket.sha256);
  if (ticket.as === "raw") {
    if (ticket.key !== `${prefix}/raw`) return null;
  } else if (ticket.as === "page") {
    // A page image, or the image of one band of a page (contract section 11.3).
    if (!/^\/pages\/[1-9]\d{0,3}(\/b[1-9])?\.jpg$/.test(ticket.key.slice(prefix.length))) return null;
  } else {
    return null;
  }
  return ticket;
}

export function ingestReadUrl(ctx: { request?: Request | null }, ticket: string): string {
  return `${apiOrigin(ctx)}/files/ingest/read?${new URLSearchParams({ ticket }).toString()}`;
}

/** Issue a signed GET for one object of an artifact. The caller builds `key` from its own company and the artifact row. */
export async function issueReadTicket(
  ctx: { request?: Request | null },
  t: Omit<IngestReadTicket, "v" | "exp" | "purpose">,
  now: number = Date.now(),
): Promise<{ url: string; expiresAt: number }> {
  const exp = now + (t.as === "raw" ? RAW_READ_TTL_MS : INGEST_TICKET_TTL_MS);
  const ticket = await signIngestReadTicket({ ...t, purpose: READ_PURPOSE, v: 1, exp });
  return { url: ingestReadUrl(ctx, ticket), expiresAt: exp };
}

/**
 * Worker route `GET /files/ingest/read?ticket=...` (no session: the ticket is the authority). Verifies
 * the ticket, reads the object, and serves it with fixed headers. A raw file is untrusted, so it goes
 * out as `application/octet-stream` attachment, never with its stored type; a page is a JPEG, inline.
 * The stored HTTP metadata is never copied onto the response.
 */
export async function handleIngestRead(request: Request, opts: { bucket?: R2Bucket | null; now?: number } = {}): Promise<Response> {
  const text = (body: string, status: number) =>
    new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } });
  if (!dieFileSigningReady()) return text("File storage is not set up", 503);
  const bucket = opts.bucket === undefined ? ingestVault() : opts.bucket;
  if (!bucket) return text("File storage is not set up", 503);
  const ticket = await readIngestReadTicket(new URL(request.url).searchParams.get("ticket") ?? "", opts.now ?? Date.now());
  if (!ticket) return text("Link expired or not valid", 403);
  const headers = new Headers({
    // A raw file is never kept in the browser cache (security L1: a shared plant PC); a page image may be, briefly.
    "cache-control": ticket.as === "raw" ? "no-store" : "private, max-age=600",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "referrer-policy": "no-referrer",
    "accept-ranges": "bytes",
  });
  // A range read (a large PDF read back page by page): one `bytes=` range answers 206; several or a malformed one, the whole object.
  const wanted = parseByteRange(request.headers.get("range"));
  let range: { offset: number; length: number; size: number } | null = null;
  if (wanted) {
    const head = await bucket.head(ticket.key);
    if (!head) return text("Not found", 404);
    const r = resolveByteRange(wanted, head.size);
    if (!r) {
      headers.set("content-range", `bytes */${head.size}`);
      headers.set("content-type", "text/plain; charset=utf-8");
      return new Response("Range not satisfiable", { status: 416, headers });
    }
    range = { ...r, size: head.size };
  }
  const object = await bucket.get(ticket.key, range ? { range: { offset: range.offset, length: range.length } } : undefined);
  if (!object) return text("Not found", 404);
  if (ticket.as === "raw") {
    headers.set("content-type", "application/octet-stream");
    headers.set("content-disposition", "attachment");
  } else {
    headers.set("content-type", VISION_PARAMS.pageContentType);
    headers.set("content-disposition", "inline");
  }
  if (range) {
    headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${range.size}`);
    headers.set("content-length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { status: 200, headers });
}

type ByteRange = { start: number; end: number | null } | { suffix: number };

/** One `bytes=a-b`, `bytes=a-` or `bytes=-n` range, or null (none, several, or malformed: the whole object is sent). */
export function parseByteRange(header: string | null): ByteRange | null {
  if (!header) return null;
  const m = /^\s*bytes=(\d{0,15})-(\d{0,15})\s*$/i.exec(header);
  if (!m) return null;
  const [, a, b] = m as unknown as [string, string, string];
  if (a === "" && b === "") return null;
  if (a === "") return Number(b) > 0 ? { suffix: Number(b) } : null;
  const start = Number(a);
  const end = b === "" ? null : Number(b);
  if (end !== null && end < start) return null;
  return { start, end };
}

/** The range within an object of `size` bytes, or null when it is past the end (416). */
export function resolveByteRange(r: ByteRange, size: number): { offset: number; length: number } | null {
  if ("suffix" in r) {
    if (size === 0) return null;
    const length = Math.min(r.suffix, size);
    return { offset: size - length, length };
  }
  if (r.start >= size) return null;
  const end = Math.min(r.end ?? size - 1, size - 1);
  return { offset: r.start, length: end - r.start + 1 };
}
