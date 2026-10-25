/**
 * Die share links (FP-DR-20): a read-only, expiring, revocable page for ONE section, opened by a
 * party with no sign-in. The token is 32 random bytes (base64url, 43 characters), shown once at
 * create; only its SHA-256 is stored. Every public read is limited like the auth throttle: per client
 * IP before the lookup, per link after it (`auth_throttle`, fixed window). An unknown, revoked or
 * expired link all answer the same NOT_FOUND, so nothing says which links exist.
 */
import { authThrottle } from "@orrn/db/schema/auth";
import { clientIp, throttleHit } from "@orrn/auth/reset-throttle";
import { TRPCError } from "@trpc/server";
import { and, like, lt } from "drizzle-orm";

import type { OrrnDb } from "./atomic";

export const SHARE_DEFAULT_DAYS = 7;
export const SHARE_MAX_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const shareExpiry = (from: number, days: number): number => from + days * DAY_MS;

/** The one sentence the public page and every refused public read use. */
export const SHARE_GONE = "This link is no longer available";
export const SHARE_BUSY = "Too many requests. Try again in a few minutes.";

/** Public reads allowed in one window: per client IP, and per link. */
export const SHARE_VIEW_LIMIT = { perIp: 60, perLink: 30, windowMs: 10 * 60 * 1000 } as const;

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

/** A new link token: 256 random bits as base64url (43 characters). */
export function newShareToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What is stored: the SHA-256 of the token, hex. */
export async function hashShareToken(token: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}

/** True when the token has the shape `newShareToken` makes (anything else is "gone" without a lookup). */
export const looksLikeShareToken = (token: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(token);

const tooBusy = () => new TRPCError({ code: "TOO_MANY_REQUESTS", message: SHARE_BUSY });

/** Counts one public read against the caller's IP (when the platform reports one); throws 429 over the limit. */
export async function limitShareIp(db: OrrnDb, request: Request | null | undefined, nowMs: number): Promise<void> {
  // Old windows are of no use; keep the table small (indexed on window_start).
  await db.delete(authThrottle).where(and(like(authThrottle.key, "dieshare:%"), lt(authThrottle.windowStart, nowMs - 2 * SHARE_VIEW_LIMIT.windowMs)));
  const ip = clientIp(request?.headers);
  if (!ip) return;
  const ok = await throttleHit(db as never, `dieshare:i:${ip}`, nowMs, { max: SHARE_VIEW_LIMIT.perIp, windowMs: SHARE_VIEW_LIMIT.windowMs });
  if (!ok) throw tooBusy();
}

/** Counts one public read against this link; throws 429 over the limit. */
export async function limitShareLink(db: OrrnDb, tokenHash: string, nowMs: number): Promise<void> {
  const ok = await throttleHit(db as never, `dieshare:t:${tokenHash.slice(0, 32)}`, nowMs, { max: SHARE_VIEW_LIMIT.perLink, windowMs: SHARE_VIEW_LIMIT.windowMs });
  if (!ok) throw tooBusy();
}
