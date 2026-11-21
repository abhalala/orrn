/**
 * Buddy grant tokens (design 2026-11-18, §4.3): 32 random bytes, shown once, stored as SHA-256 hex.
 * The `orrnb_` prefix lets a secret scanner and a person tell what the string is.
 */
export const BUDDY_TOKEN_PREFIX = "orrnb_";

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newBuddyToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${BUDDY_TOKEN_PREFIX}${base64url(bytes)}`;
}

export async function hashBuddyToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A string that could be a token (prefix and length); anything else is refused before a lookup. */
export function looksLikeBuddyToken(token: string): boolean {
  return token.startsWith(BUDDY_TOKEN_PREFIX) && /^[A-Za-z0-9_-]{43}$/.test(token.slice(BUDDY_TOKEN_PREFIX.length));
}
