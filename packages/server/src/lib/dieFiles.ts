/**
 * Die files in R2 (FP-DR-07/13): photos, PDFs, CDR/DWG drawings. Bytes never go in D1; the
 * `die_file` row keeps the key `{companyId}/dies/{sectionId}/{fileId}`.
 *
 * - Bucket binding `DIE_FILES` (R2). Missing binding = file storage is not set up on this stage
 *   (PRECONDITION_FAILED), never a crash.
 * - Reads go through a worker URL signed with HMAC-SHA256 (key derived from ORRN_MASTER_KEY),
 *   valid 10 minutes, bound to the exact object key, which always starts with the company id:
 *   `GET /files/dies?key=…&exp=…&sig=…` (apps/server). Nobody can ask for an arbitrary key.
 * - Uploads never travel as base64 in a tRPC body (LEDGER D13). `files.beginUpload` checks kind,
 *   size and type and returns an upload ticket (HMAC-signed, 10 minutes) and its URL
 *   `PUT /files/dies/upload?u=<ticket>`; `handleDieFileUpload` streams that body into R2 under the
 *   ticket's key after checking Content-Length equals the declared size; `files.commit` checks the
 *   object exists with that size and writes the `die_file` row.
 * - No ORRN_MASTER_KEY = no signing at all (PRECONDITION_FAILED / 503), never an empty secret.
 */
import { env } from "@orrn/env/server";
import { TRPCError } from "@trpc/server";

/** Signed GET lifetime (spec DR §4 Files). */
export const DIE_FILE_URL_TTL_MS = 10 * 60 * 1000;

export const DIE_FILE_LIMITS = {
  image: 8 * 1024 * 1024,
  pdf: 25 * 1024 * 1024,
  cdr: 40 * 1024 * 1024,
  dwg: 40 * 1024 * 1024,
} as const;

export type DieFileKind = keyof typeof DIE_FILE_LIMITS;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** The R2 bucket for die files, or PRECONDITION_FAILED when this stage has none. */
export function dieFilesBucket(): R2Bucket {
  const bucket = (env as unknown as { DIE_FILES?: R2Bucket }).DIE_FILES;
  if (!bucket) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "File storage is not set up for this plant yet" });
  return bucket;
}

export function dieFileKey(companyId: string, sectionId: string, fileId: string): string {
  return `${companyId}/dies/${sectionId}/${fileId}`;
}

/**
 * Check type and size for a kind. Images: JPEG/PNG/WebP. PDF: application/pdf. CDR/DWG: by file
 * extension, when the browser sends no type or `application/octet-stream`.
 */
export function checkDieFile(kind: DieFileKind, input: { filename: string; contentType: string | null | undefined; bytes: number }): string {
  const type = (input.contentType ?? "").toLowerCase();
  const ext = input.filename.toLowerCase().split(".").pop() ?? "";
  const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
  if (input.bytes <= 0) throw new TRPCError({ code: "BAD_REQUEST", message: "The file is empty" });
  if (input.bytes > DIE_FILE_LIMITS[kind]) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `This ${kind === "image" ? "image" : kind.toUpperCase()} is larger than ${mb(DIE_FILE_LIMITS[kind])}` });
  }
  switch (kind) {
    case "image":
      if (!IMAGE_TYPES.includes(type)) throw new TRPCError({ code: "BAD_REQUEST", message: "Images must be JPEG, PNG or WebP" });
      return type;
    case "pdf":
      if (type !== "application/pdf") throw new TRPCError({ code: "BAD_REQUEST", message: "This is not a PDF" });
      return type;
    case "cdr":
    case "dwg":
      if (ext !== kind || (type !== "" && type !== "application/octet-stream")) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Pick a .${kind} file` });
      }
      return "application/octet-stream";
  }
}

/** True when this stage has the master key the file links are signed with. */
export function dieFileSigningReady(): boolean {
  const master = (env as unknown as { ORRN_MASTER_KEY?: string }).ORRN_MASTER_KEY;
  return typeof master === "string" && master.length > 0;
}

/** HMAC key for one purpose. Throws PRECONDITION_FAILED when ORRN_MASTER_KEY is missing. */
async function hmacKey(purpose: "orrn-die-files" | "orrn-die-upload" = "orrn-die-files"): Promise<CryptoKey> {
  if (!dieFileSigningReady()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "File links are not set up for this plant yet" });
  }
  const secret = `${purpose}:${(env as unknown as { ORRN_MASTER_KEY: string }).ORRN_MASTER_KEY}`;
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function signature(key: string, exp: number): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(`die-file:${key}:${exp}`));
  return hex(sig);
}

/** The API origin the URL points at: this request's origin, else BETTER_AUTH_URL. */
function apiOrigin(ctx: { request?: Request | null }): string {
  try {
    if (ctx.request?.url) return new URL(ctx.request.url).origin;
  } catch {
    // fall through
  }
  const base = (env as unknown as { BETTER_AUTH_URL?: string }).BETTER_AUTH_URL ?? "";
  try {
    return base ? new URL(base).origin : "";
  } catch {
    return "";
  }
}

/**
 * A signed GET for one object key of this company (10 minutes). The key must start with
 * `{companyId}/dies/` (company prefix check); anything else is NOT_FOUND.
 */
export async function signDieFileUrl(
  ctx: { request?: Request | null },
  companyId: string,
  key: string,
  now: number = Date.now(),
): Promise<{ url: string; expiresAt: number }> {
  if (!key.startsWith(`${companyId}/dies/`)) throw new TRPCError({ code: "NOT_FOUND", message: "File not found" });
  const exp = now + DIE_FILE_URL_TTL_MS;
  const sig = await signature(key, exp);
  const qs = new URLSearchParams({ key, exp: String(exp), sig });
  return { url: `${apiOrigin(ctx)}/files/dies?${qs.toString()}`, expiresAt: exp };
}

/** True when `sig` is this key's signature and `exp` has not passed. */
export async function verifyDieFileUrl(key: string, exp: number, sig: string, now: number = Date.now()): Promise<boolean> {
  if (!key || !Number.isFinite(exp) || exp < now || !/^[0-9a-f]{64}$/.test(sig)) return false;
  if (!/^[^/]+\/dies\/[^/]+\/[^/]+$/.test(key)) return false;
  const bytes = new Uint8Array(sig.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return crypto.subtle.verify("HMAC", await hmacKey(), bytes, new TextEncoder().encode(`die-file:${key}:${exp}`));
}

// ---------------------------------------------------------------------------
// Upload: ticket -> signed PUT (streamed to R2) -> commit
// ---------------------------------------------------------------------------

/** Signed PUT lifetime: the bytes must arrive within 10 minutes of `beginUpload`. */
export const DIE_FILE_UPLOAD_TTL_MS = 10 * 60 * 1000;
/** `commit` is accepted until this long after the PUT link expired (a slow 40 MB PUT on site Wi-Fi). */
export const DIE_FILE_COMMIT_GRACE_MS = 10 * 60 * 1000;

/** What `beginUpload` decided, carried (signed) through the PUT and the commit. Never trusted unsigned. */
export type DieUploadTicket = {
  v: 1;
  companyId: string;
  userId: string;
  sectionId: string;
  dieInstanceId: string | null;
  fileId: string;
  kind: DieFileKind;
  name: string;
  size: number;
  contentType: string;
  pressDrawing: boolean;
  /** Bulk attach (FP-DR-19): the PDF becomes the press drawing only if the section has none at commit. */
  drawingIfNone?: boolean;
  exp: number;
};

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function ticketKey(t: Pick<DieUploadTicket, "companyId" | "sectionId" | "fileId">): string {
  return dieFileKey(t.companyId, t.sectionId, t.fileId);
}

/** `{payload}.{hex HMAC}`: the upload id handed to the client and put in the PUT URL. */
export async function signUploadTicket(ticket: DieUploadTicket): Promise<string> {
  const payload = base64url(new TextEncoder().encode(JSON.stringify(ticket)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey("orrn-die-upload"), new TextEncoder().encode(`die-upload:${payload}`));
  return `${payload}.${hex(sig)}`;
}

/**
 * The ticket when `uploadId` carries a valid signature and has not expired (`exp + graceMs`), else
 * null. Throws PRECONDITION_FAILED when the stage has no signing key.
 */
export async function readUploadTicket(uploadId: string, now: number = Date.now(), graceMs = 0): Promise<DieUploadTicket | null> {
  const key = await hmacKey("orrn-die-upload");
  const m = /^([A-Za-z0-9_-]{1,4000})\.([0-9a-f]{64})$/.exec(uploadId);
  if (!m) return null;
  const [, payload, sigHex] = m as unknown as [string, string, string];
  const sig = new Uint8Array(sigHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  if (!(await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(`die-upload:${payload}`)))) return null;
  let ticket: DieUploadTicket;
  try {
    ticket = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as DieUploadTicket;
  } catch {
    return null;
  }
  if (ticket.v !== 1 || !Number.isFinite(ticket.exp) || ticket.exp + graceMs < now) return null;
  return ticket;
}

/** The PUT URL for a ticket, on this API's origin. */
export function dieFileUploadUrl(ctx: { request?: Request | null }, uploadId: string): string {
  return `${apiOrigin(ctx)}/files/dies/upload?${new URLSearchParams({ u: uploadId }).toString()}`;
}

function inlineDisposition(name: string): string {
  return `inline; filename="${name.replace(/["\\\r\n]/g, "_")}"`;
}

/**
 * Worker route `PUT /files/dies/upload?u=<ticket>` (no session: the ticket is the authority). O(1):
 * verify the ticket, check Content-Length equals the declared size, refuse an existing object, and
 * stream the body into R2. The bytes are never buffered in the Worker.
 */
export async function handleDieFileUpload(
  request: Request,
  opts: { bucket?: R2Bucket | null; now?: number } = {},
): Promise<Response> {
  const text = (body: string, status: number) =>
    new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" } });
  if (!dieFileSigningReady()) return text("File storage is not set up", 503);
  const bucket = opts.bucket === undefined ? (env as unknown as { DIE_FILES?: R2Bucket }).DIE_FILES : opts.bucket;
  if (!bucket) return text("File storage is not set up", 503);
  const uploadId = new URL(request.url).searchParams.get("u") ?? "";
  const ticket = await readUploadTicket(uploadId, opts.now ?? Date.now());
  if (!ticket) return text("Link expired or not valid", 403);
  const declared = request.headers.get("content-length");
  if (declared === null || !/^\d+$/.test(declared)) return text("Send the file with its length", 411);
  const length = Number(declared);
  if (length > ticket.size) return text("The file is larger than declared", 413);
  if (length !== ticket.size || !request.body) return text("The file size does not match", 400);
  const key = ticketKey(ticket);
  if (await bucket.head(key)) return text("This upload is already done", 409);
  await bucket.put(key, request.body, {
    httpMetadata: { contentType: ticket.contentType, contentDisposition: inlineDisposition(ticket.name) },
    customMetadata: { companyId: ticket.companyId, sectionId: ticket.sectionId, fileId: ticket.fileId, uploadedBy: ticket.userId },
  });
  return new Response(JSON.stringify({ ok: true, bytes: length }), { status: 200, headers: { "content-type": "application/json" } });
}

// ---------------------------------------------------------------------------
// Bulk attach by file name (FP-DR-19)
// ---------------------------------------------------------------------------

/** The die file kind a file extension means, or null when orrn does not keep that file. */
export function dieFileKindOfName(name: string): DieFileKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["jpg", "jpeg", "png", "webp"].includes(ext)) return "image";
  if (ext === "pdf" || ext === "cdr" || ext === "dwg") return ext;
  return null;
}

/**
 * The die name in a file name: `12170.pdf` -> `12170`, `12170-1.cdr` -> `12170-1`. A typed slash
 * (`12170/1`) reads as the hyphen the copy code uses. Lower-cased for matching.
 */
export function dieNameOfFile(name: string): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return stem.trim().replace(/\//g, "-").toLowerCase();
}
