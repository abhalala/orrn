/**
 * XE PLATFORM row 83: plant API tokens. A token reads `orrna_<tokenId>_<secret>`: the id finds the row (so the
 * per-token salt can be read), the secret is 64 hex characters. Only SHA-256(salt + ":" + secret) is stored; the
 * token is shown once. The prefix differs from the buddy's `orrnb_` grant tokens.
 */
export const API_TOKEN_PREFIX = "orrna_";
const TOKEN_RE = /^orrna_([0-9A-HJKMNP-TV-Z]{26})_([0-9a-f]{64})$/;

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return hex(buf);
}

export async function hashApiSecret(salt: string, secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${secret}`));
  return hex(new Uint8Array(digest));
}

/** A new token for a row id: the full token (shown once), its salt, hash and the hint kept for the list. */
export async function mintApiToken(tokenId: string): Promise<{ token: string; salt: string; tokenHash: string; hint: string }> {
  const secret = randomHex(32);
  const salt = randomHex(16);
  return { token: `${API_TOKEN_PREFIX}${tokenId}_${secret}`, salt, tokenHash: await hashApiSecret(salt, secret), hint: secret.slice(0, 6) };
}

/** The id and secret of a well-formed token, else null. */
export function parseApiToken(token: string | null | undefined): { tokenId: string; secret: string } | null {
  if (!token) return null;
  const m = TOKEN_RE.exec(token);
  return m ? { tokenId: m[1]!, secret: m[2]! } : null;
}

/** Constant-time compare of two hex strings of equal length. */
export function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
