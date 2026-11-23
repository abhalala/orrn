/**
 * XE-BILL row 15: how the orrn Worker signs a call to the GST relay (`apps/gst-relay`), and how the relay
 * checks it. The Worker never calls a government endpoint: NIC and the IRPs refuse non-Indian IPs, so the
 * relay runs on an Indian static-IP host and holds the GST credentials.
 *
 * Headers:
 *   x-orrn-timestamp  epoch milliseconds
 *   x-orrn-nonce      a fresh random id per request (16 to 64 of [A-Za-z0-9-])
 *   x-orrn-tenant     the orrn company id the call is for (review S2)
 *   x-orrn-signature  "v2=" + hex HMAC-SHA256(tenantKey, `${timestamp}.${nonce}.${tenant}.${METHOD}.${path}.${sha256hex(body)}`)
 *
 * Authority is the TENANT, never the GSTIN in the body (a plant admin can edit the letterhead GSTIN). Each tenant
 * signs with its own key, `relayTenantKey(GST_RELAY_SECRET, companyId)`, derived on the Worker. The relay holds
 * only the per-tenant keys, each bound to the GSTINs (and their credentials) that tenant may use, and refuses a
 * GSTIN not bound to the signing tenant. One tenant's key cannot sign for another.
 *
 * The relay refuses a timestamp more than `RELAY_REPLAY_WINDOW_MS` away from its clock and a nonce it has
 * already seen inside that window. Pure WebCrypto: runs in Workers, Bun and Node 20+.
 */

export const RELAY_REPLAY_WINDOW_MS = 5 * 60 * 1000;
export const RELAY_HEADERS = {
  timestamp: "x-orrn-timestamp",
  nonce: "x-orrn-nonce",
  tenant: "x-orrn-tenant",
  signature: "x-orrn-signature",
} as const;
export const RELAY_MIN_SECRET_LENGTH = 32;

const NONCE_RE = /^[A-Za-z0-9-]{16,64}$/;
/** An orrn company id (uuid or seed id): no dots, so the canonical string stays unambiguous. */
export const RELAY_TENANT_RE = /^[A-Za-z0-9_-]{1,64}$/;
const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(body: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(body)));
}

/** The exact string that is signed. `path` is the URL path only (no host, no query). */
export async function relayCanonical(timestamp: string, nonce: string, tenant: string, method: string, path: string, body: string): Promise<string> {
  return `${timestamp}.${nonce}.${tenant}.${method.toUpperCase()}.${path}.${await sha256Hex(body)}`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

/** One tenant's signing key (64 hex), derived from the Worker's master secret. The relay stores only this. */
export async function relayTenantKey(masterSecret: string, tenant: string): Promise<string> {
  if (masterSecret.length < RELAY_MIN_SECRET_LENGTH) throw new Error("GST relay secret is too short");
  if (!RELAY_TENANT_RE.test(tenant)) throw new Error("GST relay tenant id is malformed");
  return hmacHex(masterSecret, `orrn-gst-relay-tenant:${tenant}`);
}

/** Headers for one relay request, signed with the tenant's key. `now` and `nonce` are parameters so tests can pin them. */
export async function signRelayRequest(
  tenantKey: string,
  req: { method: string; path: string; body: string; tenant: string },
  now: number = Date.now(),
  nonce: string = crypto.randomUUID(),
): Promise<Record<string, string>> {
  if (tenantKey.length < RELAY_MIN_SECRET_LENGTH) throw new Error("GST relay key is too short");
  if (!RELAY_TENANT_RE.test(req.tenant)) throw new Error("GST relay tenant id is malformed");
  const timestamp = String(now);
  const signature = await hmacHex(tenantKey, await relayCanonical(timestamp, nonce, req.tenant, req.method, req.path, req.body));
  return {
    [RELAY_HEADERS.timestamp]: timestamp,
    [RELAY_HEADERS.nonce]: nonce,
    [RELAY_HEADERS.tenant]: req.tenant,
    [RELAY_HEADERS.signature]: `v2=${signature}`,
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

/** The tenant a request names (read before the key is known; the signature then proves it). */
export function relayTenantOf(headers: { get(name: string): string | null }): string | null {
  const t = headers.get(RELAY_HEADERS.tenant);
  return t && RELAY_TENANT_RE.test(t) ? t : null;
}

/**
 * Check a request's signature (with the key of the tenant it names) and its time window. Nonce re-use is the
 * caller's check (it owns the nonce store); the verdict returns the nonce so the caller can record it.
 */
export async function verifyRelaySignature(
  tenantKey: string,
  req: { method: string; path: string; body: string; headers: { get(name: string): string | null } },
  now: number = Date.now(),
): Promise<RelayVerdict> {
  const ts = req.headers.get(RELAY_HEADERS.timestamp);
  const nonce = req.headers.get(RELAY_HEADERS.nonce);
  const tenant = req.headers.get(RELAY_HEADERS.tenant);
  const sig = req.headers.get(RELAY_HEADERS.signature);
  if (!ts || !nonce || !sig || !tenant) return { ok: false, reason: "missing" };
  if (!/^\d{1,16}$/.test(ts) || !NONCE_RE.test(nonce) || !RELAY_TENANT_RE.test(tenant) || !/^v2=[0-9a-f]{64}$/.test(sig)) return { ok: false, reason: "malformed" };
  const timestamp = Number(ts);
  if (Math.abs(now - timestamp) > RELAY_REPLAY_WINDOW_MS) return { ok: false, reason: "stale" };
  const expected = `v2=${await hmacHex(tenantKey, await relayCanonical(ts, nonce, tenant, req.method, req.path, req.body))}`;
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

/** Relay endpoints (POST, JSON body `{ gstin, ... }`; the GSTIN only picks among the signing tenant's bound ones). */
export const RELAY_PATHS = {
  irnGenerate: "/v1/irn/generate",
  irnCancel: "/v1/irn/cancel",
  irnByDocument: "/v1/irn/by-document",
  ewbByIrn: "/v1/ewb/generate-by-irn",
  ewbCancel: "/v1/ewb/cancel",
} as const;
