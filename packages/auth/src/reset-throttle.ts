import type { createDb } from "@orrn/db";
import { authThrottle } from "@orrn/db/schema/auth";
import { APIError } from "better-auth/api";
import { lt, sql } from "drizzle-orm";

type Db = ReturnType<typeof createDb>;

/**
 * BACKLOG 23 (review m-9): `POST /request-password-reset` sends mail to any address, so it is
 * limited per address and per client IP: 5 calls in 15 minutes each. The answer to a limited call is
 * the same for every address, whether or not it has an account (429, neutral body), so the limit
 * cannot be used to find out which addresses exist. The counters are keyed on a hash of the address
 * (never the address) and on the IP, in `auth_throttle` (a fixed window per key, one atomic upsert).
 * A request with no readable IP is limited by address only.
 */
export const RESET_REQUEST_PATH = "/request-password-reset";
export const RESET_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 } as const;
export const RESET_LIMITED_MESSAGE = "Too many requests. Try again in a few minutes.";

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

async function emailKey(email: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
  return `pwreset:e:${hex(digest)}`;
}

/** The client IP the platform reports (Cloudflare first), or null. */
export function clientIp(headers: Headers | undefined | null): string | null {
  const raw = headers?.get("cf-connecting-ip") ?? headers?.get("x-forwarded-for")?.split(",")[0] ?? null;
  const ip = raw?.trim();
  return ip ? ip.slice(0, 64) : null;
}

/** Counts one call on `key`; true while it is within `max` for the current window. */
export async function throttleHit(db: Db, key: string, nowMs: number, limit: { max: number; windowMs: number } = RESET_LIMIT): Promise<boolean> {
  const expired = sql`${authThrottle.windowStart} <= ${nowMs - limit.windowMs}`;
  const [row] = await db
    .insert(authThrottle)
    .values({ key, windowStart: nowMs, hits: 1 })
    .onConflictDoUpdate({
      target: authThrottle.key,
      set: {
        hits: sql`case when ${expired} then 1 else ${authThrottle.hits} + 1 end`,
        windowStart: sql`case when ${expired} then ${nowMs} else ${authThrottle.windowStart} end`,
      },
    })
    .returning({ hits: authThrottle.hits });
  return (row?.hits ?? 1) <= limit.max;
}

/** Counts the call against its address and its IP; throws the neutral 429 when either is over. */
export async function limitPasswordReset(
  db: Db,
  input: { email: unknown; headers: Headers | undefined | null; nowMs?: number },
): Promise<void> {
  const nowMs = input.nowMs ?? Date.now();
  // Old windows are of no use; keep the table small (cheap: indexed on window_start).
  await db.delete(authThrottle).where(lt(authThrottle.windowStart, nowMs - 2 * RESET_LIMIT.windowMs));
  const ip = clientIp(input.headers);
  const keys = [
    ...(typeof input.email === "string" && input.email.trim() ? [await emailKey(input.email)] : []),
    ...(ip ? [`pwreset:i:${ip}`] : []),
  ];
  // Count every key (no short circuit), so one noisy address does not hide the IP's own count.
  const allowed = await Promise.all(keys.map((key) => throttleHit(db, key, nowMs)));
  if (allowed.some((ok) => !ok)) throw new APIError("TOO_MANY_REQUESTS", { message: RESET_LIMITED_MESSAGE });
}
