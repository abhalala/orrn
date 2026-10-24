/**
 * The invite screen's decisions (audit N4), kept pure so they are unit-tested.
 *
 * `invite.acceptByToken` looks the token up before it looks at the session, so
 * calling it while signed out is the one way to check an invite before asking
 * for a password: UNAUTHORIZED means the invite is live, NOT_FOUND or
 * BAD_REQUEST means it is dead.
 */
type AuthError = { code?: string; status?: number; message?: string } | null | undefined;

/** Better Auth renamed the sign-up conflict code; accept both. */
const EXISTING_ACCOUNT_CODES = new Set(["USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"]);

export function isExistingAccount(error: AuthError): boolean {
  return !!error?.code && EXISTING_ACCOUNT_CODES.has(error.code);
}

export type InviteOutcome = "expired" | "wrongEmail" | "signedOut" | "failed";

/** What a failed `invite.acceptByToken` means for the person. */
export function inviteAcceptOutcome(error: unknown): InviteOutcome {
  const code = (error as { data?: { code?: unknown } } | null | undefined)?.data?.code;
  if (code === "NOT_FOUND" || code === "BAD_REQUEST") return "expired";
  if (code === "FORBIDDEN") return "wrongEmail";
  if (code === "UNAUTHORIZED") return "signedOut";
  return "failed";
}

/** The first thing the screen does with a token while nobody is signed in. */
export type InviteProbe = "valid" | "expired" | "failed";

export function inviteProbeResult(error: unknown): InviteProbe {
  const outcome = inviteAcceptOutcome(error);
  if (outcome === "signedOut") return "valid";
  if (outcome === "expired") return "expired";
  return "failed";
}
