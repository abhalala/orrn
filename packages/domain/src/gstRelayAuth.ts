/**
 * XE-BILL row 15: how the orrn Worker signs a call to the GST relay (`apps/gst-relay`), and how the relay
 * checks it. The Worker never calls a government endpoint: NIC and the IRPs refuse non-Indian IPs, so the
 * relay runs on an Indian static-IP host and holds the GST credentials.
 *
 * Headers:
 *   x-orrn-timestamp  epoch milliseconds
 *   x-orrn-nonce      a fresh random id per request (16 to 64 of [A-Za-z0-9-])
 *   x-orrn-signature  "v1=" + hex HMAC-SHA256(secret, `${timestamp}.${nonce}.${METHOD}.${path}.${sha256hex(body)}`)
 *
 * The relay refuses a timestamp more than `RELAY_REPLAY_WINDOW_MS` away from its clock and a nonce it has
 * already seen inside that window. Pure WebCrypto: runs in Workers, Bun and Node 20+.
 */

export const RELAY_REPLAY_WINDOW_MS = 5 * 60 * 1000;
export const RELAY_HEADERS = {
  timestamp: "x-orrn-timestamp",
  nonce: "x-orrn-nonce",
  signature: "x-orrn-signature",
} as const;
export const RELAY_MIN_SECRET_LENGTH = 32;

const NONCE_RE = /^[A-Za-z0-9-]{16,64}$/;
const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(body: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(body)));
}

/** The exact string that is signed. `path` is the URL path only (no host, no query). */
export async function relayCanonical(timestamp: string, nonce: string, method: string, path: string, body: string): Promise<string> {
  return `${timestamp}.${nonce}.${method.toUpperCase()}.${path}.${await sha256Hex(body)}`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** Headers for one relay request. `now` and `nonce` are parameters so tests can pin them. */
export async function signRelayRequest(
  secret: string,
  req: { method: string; path: string; body: string },
  now: number = Date.now(),
  nonce: string = crypto.randomUUID(),
): Promise<Record<string, string>> {
  if (secret.length < RELAY_MIN_SECRET_LENGTH) throw new Error("GST relay secret is too short");
  const timestamp = String(now);
  const signature = await hmacHex(secret, await relayCanonical(timestamp, nonce, req.method, req.path, req.body));
  return {
    [RELAY_HEADERS.timestamp]: timestamp,
    [RELAY_HEADERS.nonce]: nonce,
    [RELAY_HEADERS.signature]: `v1=${signature}`,
  };
}

/** Constant-time string compare (same length required). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type RelayVerdict =
  | { ok: true; nonce: string; timestamp: number }
  | { ok: false; reason: "missing" | "malformed" | "stale" | "bad_signature" };

/**
 * Check a request's signature and its time window. Nonce re-use is the caller's check (it owns the
 * nonce store); the verdict returns the nonce so the caller can record it.
 */
export async function verifyRelaySignature(
  secret: string,
  req: { method: string; path: string; body: string; headers: { get(name: string): string | null } },
  now: number = Date.now(),
): Promise<RelayVerdict> {
  const ts = req.headers.get(RELAY_HEADERS.timestamp);
  const nonce = req.headers.get(RELAY_HEADERS.nonce);
  const sig = req.headers.get(RELAY_HEADERS.signature);
  if (!ts || !nonce || !sig) return { ok: false, reason: "missing" };
  if (!/^\d{1,16}$/.test(ts) || !NONCE_RE.test(nonce) || !/^v1=[0-9a-f]{64}$/.test(sig)) return { ok: false, reason: "malformed" };
  const timestamp = Number(ts);
  if (Math.abs(now - timestamp) > RELAY_REPLAY_WINDOW_MS) return { ok: false, reason: "stale" };
  const expected = `v1=${await hmacHex(secret, await relayCanonical(ts, nonce, req.method, req.path, req.body))}`;
  if (!safeEqual(expected, sig)) return { ok: false, reason: "bad_signature" };
  return { ok: true, nonce, timestamp };
}

/** What every relay endpoint answers (the relay normalises IRP and NIC errors to this). */
export type RelayResponse<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** The IRP / NIC error code ("2150" duplicate IRN), or a relay code ("relay_unauthorised", "upstream_unreachable"). */
      code: string;
      message: string;
      /** True when trying again later may succeed (network, timeout, 5xx). Validation errors are false. */
      retryable: boolean;
      /** NIC InfoDtls on a duplicate (2150): carries the existing Irn, AckNo, AckDt. */
      info?: unknown;
    };

/** Relay endpoints (POST, JSON body `{ gstin, ... }`). */
export const RELAY_PATHS = {
  irnGenerate: "/v1/irn/generate",
  irnCancel: "/v1/irn/cancel",
  irnByDocument: "/v1/irn/by-document",
  ewbByIrn: "/v1/ewb/generate-by-irn",
  ewbCancel: "/v1/ewb/cancel",
} as const;
