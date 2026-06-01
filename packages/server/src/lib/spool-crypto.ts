/**
 * HMAC-SHA256 signing and verification for orrn-spool ↔ ORRN server
 * machine-to-machine authentication.
 *
 * The shared secret is provisioned per-deployment and stored AES-GCM wrapped
 * in the spool_deployment table. At runtime it is unwrapped with
 * @orrn/crypto.unwrapSecret and used to sign/verify all spool API calls
 * and webhook callbacks.
 *
 * Signing format:
 *   Authorization: Bearer v1:<timestamp>:<hex(HMAC-SHA256(secret, method|path|timestamp|bodySha256))>
 */

/** Sign an outgoing request to orrn-spool. Returns the full Bearer token string. */
export async function signSpoolRequest(
  method: string,
  path: string,
  body: Uint8Array | null,
  sharedSecret: string,
): Promise<string> {
  const timestamp = Date.now().toString(36);
  const bodyHash = body ? await sha256Hex(body) : "";
  const message = `${method.toUpperCase()}|${path}|${timestamp}|${bodyHash}`;
  const signature = await hmacSha256Hex(sharedSecret, message);
  return `v1:${timestamp}:${signature}`;
}

/** Verify an incoming Bearer token from orrn-spool (or from ORRN to spool). */
export async function verifySpoolToken(
  method: string,
  path: string,
  body: Uint8Array | null,
  token: string,
  sharedSecret: string,
  maxAgeMs = 30_000,
): Promise<boolean> {
  const parts = token.split(":");
  if (parts.length !== 3 || parts[0] !== "v1") return false;

  const timestampStr = parts[1]!;
  const signature = parts[2]!;
  const timestamp = parseInt(timestampStr, 36);
  if (Number.isNaN(timestamp)) return false;

  const age = Date.now() - timestamp;
  if (age < -maxAgeMs || age > maxAgeMs) return false;

  const bodyHash = body ? await sha256Hex(body) : "";
  const message = `${method.toUpperCase()}|${path}|${timestampStr}|${bodyHash}`;
  const expected = await hmacSha256Hex(sharedSecret, message);

  return timingSafeEqual(signature, expected);
}

/** Sign a webhook payload (sent by orrn-spool → ORRN or vice versa). */
export async function signWebhookPayload(
  payload: Uint8Array,
  sharedSecret: string,
): Promise<string> {
  return hmacSha256Hex(sharedSecret, new TextDecoder().decode(payload));
}

/** Verify a webhook signature. */
export async function verifyWebhookSignature(
  payload: Uint8Array,
  signature: string,
  sharedSecret: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(sharedSecret, new TextDecoder().decode(payload));
  return timingSafeEqual(signature, expected);
}

/**
 * Sign a short-lived download token for spool deliverable downloads.
 * Token format: v1:<expiry_ms>:<hex(HMAC-SHA256(secret, "download:" + deploymentId + ":" + expiry))>
 */
export async function signDownloadToken(deploymentId: string, platform: string, secret: string): Promise<string> {
  const expiry = Date.now() + 10 * 60 * 1000; // 10 minutes
  const message = `download:${deploymentId}:${platform}:${expiry}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  const sigHex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `v1:${expiry}:${sigHex}`;
}

/**
 * Verify a download token for spool deliverable downloads.
 */
export async function verifyDownloadToken(deploymentId: string, platform: string, token: string, secret: string): Promise<boolean> {
  if (!token.startsWith("v1:")) return false;
  const parts = token.substring(3).split(":");
  if (parts.length !== 2) return false;
  const part0 = parts[0];
  const part1 = parts[1];
  if (!part0 || !part1) return false;
  const expiry = parseInt(part0, 10);
  if (isNaN(expiry) || expiry < Date.now()) return false;
  const message = `download:${deploymentId}:${platform}:${expiry}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const sigHex = part1;
  const sigBytes = new Uint8Array(sigHex.match(/.{2}/g)!.map((byte: string) => parseInt(byte, 16)));
  return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(message));
}

// ─── Internal helpers ────────────────────────────────────────────────────────

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return bufToHex(sig);
}

async function sha256Hex(data: Uint8Array | ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return bufToHex(hash);
}

function bufToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison to prevent timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}