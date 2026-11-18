/**
 * The invite screen's decisions (audit N4; plan 2026-11-18, Task 8), kept pure so they are unit-tested.
 * `invite.status` says whether the link is live and what the invited email's account needs, without
 * the email, the company or the role; the screen never accepts until the person taps.
 */
type AuthError = { code?: string; status?: number; message?: string } | null | undefined;

/** Better Auth renamed the sign-up conflict code; accept both. */
const EXISTING_ACCOUNT_CODES = new Set(["USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"]);

export function isExistingAccount(error: AuthError): boolean {
  return !!error?.code && EXISTING_ACCOUNT_CODES.has(error.code);
}

export type InviteOutcome = "expired" | "wrongEmail" | "signedOut" | "failed";

/**
 * Sign-up refused by the server's invite check (packages/auth/src/sign-up-guard.ts): the invite is
 * dead (expired, used, revoked) or is for another email. Null for any other error.
 */
export function inviteSignUpRefusal(error: AuthError): "expired" | "wrongEmail" | null {
  if (error?.code === "SIGN_UP_INVITE_EMAIL_MISMATCH") return "wrongEmail";
  if (error?.code === "SIGN_UP_INVITE_NOT_VALID" || error?.code === "SIGN_UP_NEEDS_INVITE") return "expired";
  return null;
}

/** What a failed `invite.acceptByToken` means for the person. */
export function inviteAcceptOutcome(error: unknown): InviteOutcome {
  const code = (error as { data?: { code?: unknown } } | null | undefined)?.data?.code;
  if (code === "NOT_FOUND" || code === "BAD_REQUEST") return "expired";
  if (code === "FORBIDDEN") return "wrongEmail";
  if (code === "UNAUTHORIZED") return "signedOut";
  return "failed";
}

/** What `invite.status` answers (packages/server/src/routers/invite.ts). */
export type InviteStatus =
  | { live: false }
  | { live: true; kind: "member" | "portal"; account: "none" | "password" | "noPassword"; google: boolean };

export type InviteScreen = "checking" | "failed" | "expired" | "join" | "create" | "signIn" | "noPassword";

/** Which screen the invite link opens, from the session on this phone and `invite.status`. */
export function inviteScreen(hasSession: boolean, status: InviteStatus | "pending" | "failed"): InviteScreen {
  if (status === "pending") return "checking";
  if (status === "failed") return "failed";
  if (!status.live) return "expired";
  if (hasSession) return "join";
  if (status.account === "none") return "create";
  return status.account === "password" ? "signIn" : "noPassword";
}
