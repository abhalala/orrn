import type { MessageKey } from "@orrn/i18n";

/**
 * What the sign-in screen does after each Better Auth call. Pure, so the
 * 2FA branch (audit N5) and the error copy are unit-tested.
 */
type AuthError = { status?: number; code?: string; message?: string } | null | undefined;
type AuthResult = { data?: unknown; error?: AuthError };

export type PasswordOutcome = { step: "totp" } | { step: "done" } | { step: "error"; messageKey: MessageKey };
export type TotpOutcome =
  | { step: "done" }
  | { step: "error"; messageKey: MessageKey }
  /** The short-lived 2FA cookie expired: start again from email and password. */
  | { step: "restart"; messageKey: MessageKey };

function commonError(error: NonNullable<AuthError>): MessageKey {
  if (error.status === 429 || error.code?.startsWith("TOO_MANY_ATTEMPTS")) return "native.tooManyTries";
  // better-fetch reports a failed request (no connection, DNS, timeout) as status 0.
  if (!error.status) return "errors.network";
  return "errors.generic";
}

export function afterPassword({ data, error }: AuthResult): PasswordOutcome {
  if (error) {
    if (error.status === 401 || error.code === "INVALID_EMAIL_OR_PASSWORD") {
      return { step: "error", messageKey: "auth.login.wrongCredentials" };
    }
    return { step: "error", messageKey: commonError(error) };
  }
  if ((data as { twoFactorRedirect?: boolean } | null | undefined)?.twoFactorRedirect) return { step: "totp" };
  return { step: "done" };
}

export function afterTotp({ error }: AuthResult): TotpOutcome {
  if (!error) return { step: "done" };
  if (error.code === "INVALID_TWO_FACTOR_COOKIE") return { step: "restart", messageKey: "native.codeTimedOut" };
  if (error.code === "INVALID_CODE" || error.status === 401) return { step: "error", messageKey: "auth.totp.wrongCode" };
  return { step: "error", messageKey: commonError(error) };
}

/** Digits only, at most six: pasted codes often carry spaces or dashes. */
export function cleanTotp(input: string): string {
  return input.replace(/\D/g, "").slice(0, 6);
}

/**
 * Checked before sending the code. The button is disabled until six digits
 * are typed, but the number pad's go key still submits; it must say why
 * nothing was sent instead of doing nothing.
 */
export function totpInputError(code: string): MessageKey | null {
  return code.length === 6 ? null : "native.codeTooShort";
}
