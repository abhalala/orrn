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

function isRateLimited(code: string, status: number | undefined) {
  return status === 429 || code.startsWith("TOO_MANY");
}

/** Message for a failed email + password sign-in. Shown inline under the form. */
export function signInErrorKey(error: AuthClientError): MessageKey {
  const { code, status, network } = parts(error);
  if (network) return "errors.network";
  if (isRateLimited(code, status)) return "auth.errors.tooMany";
  if (code === "INVALID_EMAIL_OR_PASSWORD" || code === "INVALID_PASSWORD" || status === 401) {
    return "auth.login.wrongCredentials";
  }
  return "errors.generic";
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
