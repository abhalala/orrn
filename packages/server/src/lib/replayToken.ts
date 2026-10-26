/**
 * Replay keys for writes that hand out a secret once (a die share link, an invite link; final fixes 5, M4).
 *
 * The secret is not random when the caller sends a `clientMutationId`: it is SHA-256 of (kind, company, key), so a
 * repeat of the same request (the reply was lost, or a second tap got through) rebuilds the SAME link and the first
 * answer can be given again, while only the stored hash of it is ever kept. The key is a random id only the sender and
 * the server know (at least 16 characters), so the link is as unguessable as any token the sender could have made up;
 * a request without a key still gets a random token as before.
 */
import { requestRowIds } from "./importReplay";

export type ReplayTokenKind = "die_share.create" | "invite.create";

/** The shape every caller sends: 16 to 64 characters of letters, digits, - and _ (the key is a secret seed). */
export const REPLAY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/** The row id this request writes (UUID-shaped, derived from company, kind and key). */
export async function replayRowId(companyId: string, kind: ReplayTokenKind, key: string): Promise<string> {
  return (await requestRowIds(companyId, kind, key, 1))[0]!;
}

/** The secret this request hands out, derived from the key: 32 bytes as base64url (43 chars, a share link) or the first 16 as a UUID-shaped string (an invite link keeps the shape it always had). */
export async function replayToken(companyId: string, kind: ReplayTokenKind, key: string, format: "base64url" | "uuid"): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`replay-token\u0000${kind}\u0000${companyId}\u0000${key}`)));
  if (format === "uuid") {
    const h = Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  let bin = "";
  for (const b of digest) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
