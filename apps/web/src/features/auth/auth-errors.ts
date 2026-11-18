import type { MessageKey } from "@orrn/i18n";

/**
 * A Better Auth client error (`{ code, status }`), a thrown fetch failure, or
 * nothing. The client returns `{ data, error }` instead of throwing for HTTP
 * errors; a dead network either throws a TypeError or reports status 0.
 */
export type AuthClientError = { code?: string; status?: number; message?: string } | Error | null | undefined;

function parts(error: AuthClientError): { code: string; status: number | undefined; network: boolean } {
  if (!error) return { code: "", status: undefined, network: false };
  if (error instanceof Error) return { code: "", status: undefined, network: error instanceof TypeError };
  return { code: error.code ?? "", status: error.status, network: error.status === 0 };
}

/** The browser's "the person closed the passkey sheet, or it timed out" (a DOMException or a plain Error). */
function isNotAllowed(error: AuthClientError): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: unknown }).name === "NotAllowedError");
}

/**
 * Codes a passkey or Google sign-in can end with, and what the sign-in page says. The Google codes come
 * from `packages/auth/src/google-guard.ts`. The passkey client (`@better-auth/passkey/client`) turns
 * every browser failure into `AUTH_CANCELLED`; the server answers an unknown or unverifiable passkey
 * with `PASSKEY_NOT_FOUND` / `AUTHENTICATION_FAILED` at status 401, which must not read as a wrong
 * password.
 */
const METHOD_ERRORS: Record<string, MessageKey> = {
  GOOGLE_NOT_INVITED: "auth.errors.googleNotInvited",
  GOOGLE_NOT_FOR_STAFF: "auth.errors.googleNotForStaff",
  GOOGLE_EMAIL_NOT_VERIFIED: "auth.errors.googleEmailNotVerified",
  AUTH_CANCELLED: "auth.errors.passkeyCancelled",
  PASSKEY_NOT_FOUND: "auth.errors.passkeyNotFound",
  AUTHENTICATION_FAILED: "auth.errors.passkeyNotFound",
  // Better Auth 1.6.9 only logs "Credential account not found" and answers INVALID_EMAIL_OR_PASSWORD,
  // so this code does not reach the browser today; if it ever does, it gets its own words.
  CREDENTIAL_ACCOUNT_NOT_FOUND: "auth.errors.noPasswordYet",
};

/** Google refusals that can reach the sign-in page as `?error=CODE`. */
const LOGIN_PAGE_ERRORS = new Set(["GOOGLE_NOT_INVITED", "GOOGLE_NOT_FOR_STAFF", "GOOGLE_EMAIL_NOT_VERIFIED"]);

/**
 * The sign-in page's `?error=`: Google refusals (the callback lands on `/login?error=CODE`) and
 * anything Better Auth's own error page forwards (`/api/auth/error` redirects to `/login?error=` because
 * `onAPIError.errorURL` is the web sign-in page), such as `access_denied` or `state_mismatch`. Known
 * codes get their own words, every other code the generic one. The URL's text is never shown.
 */
export function loginErrorKey(code: string | undefined): MessageKey | null {
  if (!code) return null;
  return LOGIN_PAGE_ERRORS.has(code) ? METHOD_ERRORS[code]! : "auth.errors.signInFailed";
}

function isRateLimited(code: string, status: number | undefined) {
  return status === 429 || code.startsWith("TOO_MANY");
}

/** Message for a failed sign-in (email + password, passkey or Google). Shown inline, never a toast. */
export function signInErrorKey(error: AuthClientError): MessageKey {
  if (isNotAllowed(error)) return "auth.errors.passkeyCancelled";
  const { code, status, network } = parts(error);
  if (network) return "errors.network";
  if (isRateLimited(code, status)) return "auth.errors.tooMany";
  const method = METHOD_ERRORS[code];
  if (method) return method;
  if (code === "INVALID_EMAIL_OR_PASSWORD" || code === "INVALID_PASSWORD" || status === 401) {
    return "auth.login.wrongCredentials";
  }
  return "errors.generic";
}

/**
 * Offer "Email me a link to set a password" under this sign-in error (plan 2026-11-18, Task 8). Better
 * Auth answers an account with no password (a magic-link approval, Google or a passkey only) exactly as
 * a wrong password, so the link is offered on both; the answer to it never says whether the email has
 * an account.
 */
export function offersPasswordLink(key: MessageKey | null): boolean {
  return key === "auth.login.wrongCredentials" || key === "auth.errors.noPasswordYet";
}

/** Message for a failed authenticator code. */
export function totpErrorKey(error: AuthClientError): MessageKey {
  const { code, status, network } = parts(error);
  if (network) return "errors.network";
  if (isRateLimited(code, status)) return "auth.errors.tooMany";
  // The short-lived two-factor cookie from the password step ran out.
  if (code === "INVALID_TWO_FACTOR_COOKIE") return "auth.errors.twoFactorExpired";
  if (code === "INVALID_CODE" || code === "INVALID_TWO_FACTOR_CODE" || status === 401) return "auth.totp.wrongCode";
  return "errors.generic";
}

/**
 * Sign-up refused because the email already has an account. Better Auth 1.6
 * says `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`; older builds said
 * `USER_ALREADY_EXISTS` (audit N4: the invite page checked only the old one).
 */
export function isExistingAccount(error: AuthClientError): boolean {
  const { code } = parts(error);
  return code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" || code === "USER_ALREADY_EXISTS";
}

/**
 * Sign-up refused by the server's invite check (packages/auth/src/sign-up-guard.ts): the invite is
 * dead (expired, used, revoked) or is for another email. Null for any other error.
 */
export function inviteSignUpRefusal(error: AuthClientError): "expired" | "wrongEmail" | null {
  const { code } = parts(error);
  if (code === "SIGN_UP_INVITE_EMAIL_MISMATCH") return "wrongEmail";
  if (code === "SIGN_UP_INVITE_NOT_VALID" || code === "SIGN_UP_NEEDS_INVITE") return "expired";
  return null;
}

/** What the invite page shows when `invite.acceptByToken` fails. */
export type InviteAcceptOutcome = "wrongEmail" | "expired" | "failed";

export function inviteAcceptOutcome(error: unknown): InviteAcceptOutcome {
  const code =
    error && typeof error === "object" ? (error as { data?: { code?: unknown } | null }).data?.code : undefined;
  // Signed in as someone else than the invited email.
  if (code === "FORBIDDEN") return "wrongEmail";
  // Unknown token, or expired / revoked / already used.
  if (code === "NOT_FOUND" || code === "BAD_REQUEST") return "expired";
  return "failed";
}
