/**
 * Pure helpers for the forgot-password pages: the reset address's query, the redirect the server
 * sends the person back to, and the checks on the new password. Plain code, no zod: the route
 * options that call it sit in the entry chunk.
 */
import type { MessageKey } from "@orrn/i18n";

/** Better Auth's password rule (server `minPasswordLength` default is 8). */
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 128;

export type ResetSearch = { token?: string; error?: string };

/** `/reset-password?token=` (the link) or `?error=INVALID_TOKEN` (Better Auth refused the token). */
export function parseResetSearch(search: Record<string, unknown>): ResetSearch {
  return {
    ...(typeof search.token === "string" && search.token && search.token.length <= 256 ? { token: search.token } : {}),
    ...(typeof search.error === "string" && search.error ? { error: search.error.slice(0, 64) } : {}),
  };
}

/** The page a reset link lands on: Better Auth redirects there with `?token=` once it has checked the token. */
export function resetRedirectUrl(origin: string): string {
  return `${origin}/reset-password`;
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
