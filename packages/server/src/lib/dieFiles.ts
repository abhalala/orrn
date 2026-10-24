/**
 * Die files in R2 (FP-DR-07/13): photos, PDFs, CDR/DWG drawings. Bytes never go in D1; the
 * `die_file` row keeps the key `{companyId}/dies/{sectionId}/{fileId}`.
 *
 * - Bucket binding `DIE_FILES` (R2). Missing binding = file storage is not set up on this stage
 *   (PRECONDITION_FAILED), never a crash.
 * - Reads go through a worker URL signed with HMAC-SHA256 (key derived from ORRN_MASTER_KEY),
 *   valid 10 minutes, bound to the exact object key, which always starts with the company id:
 *   `GET /files/dies?key=…&exp=…&sig=…` (apps/server). Nobody can ask for an arbitrary key.
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

async function hmacKey(): Promise<CryptoKey> {
  const secret = `orrn-die-files:${env.ORRN_MASTER_KEY ?? ""}`;
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

/** Decode a base64 upload body (data: URL prefix allowed). */
export function decodeBase64(body: string): Uint8Array {
  const raw = body.includes(",") && body.startsWith("data:") ? body.slice(body.indexOf(",") + 1) : body;
  try {
    const bin = atob(raw.replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The upload is not readable; pick the file again" });
  }
}
