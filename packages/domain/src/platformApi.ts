/**
 * XE PLATFORM row 83: pure rules of the plant API and webhooks. No I/O here; the server injects DNS and fetch.
 */

/** Scopes a plant API token may carry. `prices.read` is separate: rates leave orrn only with it. */
export const API_TOKEN_SCOPES = ["orders.read", "stock.read", "dispatch.read", "invoices.read", "prices.read"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export const WEBHOOK_EVENT_KEYS = ["order.confirmed", "dispatch.done", "invoice.issued", "stock.adjusted"] as const;
export type WebhookEventKey = (typeof WEBHOOK_EVENT_KEYS)[number];

/** At most this many rows a page. */
export const API_PAGE_MAX = 100;
/** Calls a token may make in one minute. */
export const API_RATE_PER_MINUTE = 60;
/** A delivery is retried up to this long after the event, then marked failed. */
export const WEBHOOK_GIVE_UP_MS = 24 * 60 * 60 * 1000;
/** Clock window a receiver should allow on the signature timestamp. */
export const WEBHOOK_TOLERANCE_S = 300;

/**
 * Delay before attempt number `attempts + 1` (attempts already made): 1 min, 5 min, 15 min, 1 h, 3 h, then every
 * 6 h. Null once the next try would fall after the 24 h window that started at `createdAtMs`.
 */
export function nextWebhookAttemptAt(attempts: number, createdAtMs: number, nowMs: number): number | null {
  const steps = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];
  const delay = steps[Math.max(0, attempts - 1)] ?? 6 * 60 * 60_000;
  const at = nowMs + delay;
  return at - createdAtMs > WEBHOOK_GIVE_UP_MS ? null : at;
}

/** The string signed for a delivery: `<unix seconds>.<raw body>` (header `x-orrn-signature: t=<s>,v1=<hex>`). */
export function webhookSigningInput(timestampS: number, body: string): string {
  return `${timestampS}.${body}`;
}

export function webhookSignatureHeader(timestampS: number, hexSignature: string): string {
  return `t=${timestampS},v1=${hexSignature}`;
}

/** Opaque page cursor: base64url of the next offset. */
export function encodeApiCursor(offset: number): string {
  return btoa(JSON.stringify({ o: offset })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeApiCursor(cursor: string | null | undefined): number | null {
  if (!cursor) return 0;
  if (cursor.length > 64 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const pad = cursor.length % 4 === 0 ? "" : "=".repeat(4 - (cursor.length % 4));
    const parsed = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/") + pad)) as { o?: unknown };
    return typeof parsed.o === "number" && Number.isInteger(parsed.o) && parsed.o >= 0 && parsed.o <= 1_000_000 ? parsed.o : null;
  } catch {
    return null;
  }
}

/** Page size from a query string value: 1..100, default 50. Null when it is not a whole number. */
export function apiPageLimit(raw: string | null | undefined): number | null {
  if (raw == null || raw === "") return 50;
  if (!/^\d{1,4}$/.test(raw)) return null;
  return Math.min(API_PAGE_MAX, Math.max(1, Number(raw)));
}

// ---------------------------------------------------------------------------------------------------------------
// SSRF guard for webhook URLs.

const parseV4 = (ip: string): number[] | null => {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : Number.NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
};

/** True for an IPv4 address that is not public: private, loopback, link-local, CGNAT/tailnet, multicast, reserved. */
export function isBlockedIpv4(ip: string): boolean {
  const n = parseV4(ip);
  if (!n) return true;
  const [a, b] = n as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT, Tailscale 100.64.0.0/10
  if (a === 169 && b === 254) return true; // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (n[2] === 0 || n[2] === 2)) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && n[2] === 100) return true;
  if (a === 203 && b === 0 && n[2] === 113) return true;
  if (a >= 224) return true; // multicast and reserved, broadcast
  return false;
}

/** Expands an IPv6 literal to 8 hextets, or null. */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf("%");
  if (zone >= 0) return null; // a zone id is link-local by nature
  let tailV4: number[] | null = null;
  const lastColon = s.lastIndexOf(":");
  if (s.includes(".") && lastColon >= 0) {
    tailV4 = parseV4(s.slice(lastColon + 1));
    if (!tailV4) return null;
    s = `${s.slice(0, lastColon)}:${((tailV4[0]! << 8) | tailV4[1]!).toString(16)}:${((tailV4[2]! << 8) | tailV4[3]!).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (all.length !== 8 || !all.every((h) => /^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => parseInt(h, 16));
}

/** True for an IPv6 address that is not global unicast, or that maps onto a blocked IPv4 address. */
export function isBlockedIpv6(ip: string): boolean {
  const h = expandV6(ip.replace(/^\[|\]$/g, ""));
  if (!h) return true;
  if (h.every((x) => x === 0)) return true; // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true; // ::1
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return isBlockedIpv4(v4(h[6]!, h[7]!)); // ::ffff:a.b.c.d
  if (h.slice(0, 6).every((x) => x === 0)) return true; // IPv4-compatible (deprecated)
  if (h[0] === 0x64 && h[1] === 0xff9b) return isBlockedIpv4(v4(h[6]!, h[7]!)); // NAT64
  if (h[0] === 0x2002) return isBlockedIpv4(v4(h[1]!, h[2]!)); // 6to4
  if ((h[0]! & 0xfe00) === 0xfc00) return true; // unique local fc00::/7 (Tailscale fd7a:115c:a1e0::/48 too)
  if ((h[0]! & 0xffc0) === 0xfe80) return true; // link-local
  if ((h[0]! & 0xff00) === 0xff00) return true; // multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
  if (h[0] === 0x2001 && h[1]! < 0x0200) return true; // Teredo, benchmarking, ORCHID and other special 2001::/23
  if ((h[0]! & 0xe000) !== 0x2000) return true; // only 2000::/3 is global unicast
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  return ip.includes(":") ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

export type WebhookUrlProblem = "not_url" | "not_https" | "credentials" | "port" | "private_host" | "too_long";

/**
 * Static check of a webhook URL: https only, no user:pass, default port only, and a host that is neither a blocked IP
 * literal nor a name that only resolves inside a network (localhost, .local, .internal, .ts.net, and so on). The
 * server also resolves the name and checks every address (`lib/webhooks/ssrf.ts`).
 */
export function webhookUrlProblem(raw: string): WebhookUrlProblem | null {
  if (raw.length > 500) return "too_long";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "not_url";
  }
  if (url.protocol !== "https:") return "not_https";
  if (url.username || url.password) return "credentials";
  if (url.port && url.port !== "443") return "port";
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return "not_url";
  if (host.startsWith("[")) return isBlockedIpv6(host) ? "private_host" : null;
  if (/^[\d.]+$/.test(host)) return isBlockedIpv4(host) ? "private_host" : null;
  if (/^0x|^\d+$/.test(host)) return "private_host"; // hex or decimal IPv4 forms
  if (!host.includes(".")) return "private_host";
  const internal = ["localhost", ".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".ts.net", ".home.arpa", ".arpa"];
  if (internal.some((s) => (s.startsWith(".") ? host.endsWith(s) : host === s))) return "private_host";
  return null;
}
