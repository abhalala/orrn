/**
 * Pure helpers for the forgot-password pages: the reset address's query, the redirect the server
 * sends the person back to, and the checks on the new password. Plain code, no zod: the route
 * options that call it sit in the entry chunk.
 */
import type { MessageKey } from "@orrn/i18n";

import { safeNext } from "@/shared/lib/safe-next";

/** Better Auth's password rule (server `minPasswordLength` default is 8). */
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 128;

export type ResetSearch = { token?: string; error?: string; next?: string };

/** A same-origin path to carry through the reset (an invite page), or nothing. */
function keptNext(next: unknown): string {
  return typeof next === "string" && next.length <= 512 ? safeNext(next, "") : "";
}

/**
 * `/reset-password?token=` (the link) or `?error=INVALID_TOKEN` (Better Auth refused the token), and
 * the `next` page the person came from (plan 2026-11-18, Task 8: the invite they are joining).
 */
export function parseResetSearch(search: Record<string, unknown>): ResetSearch {
  const next = keptNext(search.next);
  return {
    ...(typeof search.token === "string" && search.token && search.token.length <= 256 ? { token: search.token } : {}),
    ...(typeof search.error === "string" && search.error ? { error: search.error.slice(0, 64) } : {}),
    ...(next ? { next } : {}),
  };
}

/**
 * The page a reset link lands on: Better Auth redirects there with `?token=` once it has checked the
 * token, keeping the query it was given, so a same-origin `next` survives the email round trip.
 */
export function resetRedirectUrl(origin: string, next?: string): string {
  const kept = keptNext(next);
  return kept ? `${origin}/reset-password?next=${encodeURIComponent(kept)}` : `${origin}/reset-password`;
}

/** Where "done" sends the person: back to their invite (to sign in and join), else to sign in. */
export function afterResetLink(next: string | undefined): { href: string; label: MessageKey } {
  const kept = keptNext(next);
  if (/^\/invite\//.test(kept)) return { href: kept, label: "auth.reset.backToInvite" };
  return { href: kept ? `/login?next=${encodeURIComponent(kept)}` : "/login", label: "auth.reset.goSignIn" };
}

/** Message key for a new password and its repeat, or null when both are fine. */
export function newPasswordError(password: string, confirm: string): MessageKey | null {
  if (password.length < MIN_PASSWORD) return "auth.validation.passwordShort";
  if (password.length > MAX_PASSWORD) return "auth.validation.passwordShort";
  if (password !== confirm) return "auth.reset.mismatch";
  return null;
}

/** A link that cannot be used: no token, an error from the server, or the server refusing it at reset time. */
export function resetLinkBroken(search: ResetSearch): boolean {
  return Boolean(search.error) || !search.token;
}
