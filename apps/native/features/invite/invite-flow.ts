import type { MessageKey } from "@orrn/i18n";

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

/**
 * Which screen the invite link opens, from the session on this phone and `invite.status`. `carried`: a
 * sign-in on this screen was followed by a failed accept (another account, a timeout), so the signed-in
 * view shows it with its way out, even while the status is read again or that read fails (council r1, B2).
 */
export function inviteScreen(hasSession: boolean, status: InviteStatus | "pending" | "failed", carried = false): InviteScreen {
  if (hasSession && carried) return "join";
  if (status === "pending") return "checking";
  if (status === "failed") return "failed";
  if (!status.live) return "expired";
  if (hasSession) return "join";
  if (status.account === "none") return "create";
  return status.account === "password" ? "signIn" : "noPassword";
}

/**
 * Options for the `invite.status` read (council r1, B3). Plant phones share one IP against the status
 * limit (30 per 10 minutes), and a refetch could swap the form under typed input, so the status is read
 * once; only the no-password view's "link sent" state reads it again on focus (`createFocusRecheck`).
 */
export function inviteStatusQueryOptions() {
  return { staleTime: Number.POSITIVE_INFINITY, refetchOnWindowFocus: false, refetchOnReconnect: false, retry: false } as const;
}

/**
 * A `focusManager` listener that reads the status again when the app comes back to the front, at most
 * once per focus, and never while `blocked()` (a passkey or Google sheet takes the app out of focus too,
 * and its sign-in must not race a screen swap).
 */
export function createFocusRecheck({ refetch, blocked }: { refetch(): void; blocked(): boolean }): (focused: boolean) => void {
  let readThisFocus = false;
  return (focused) => {
    if (!focused) {
      readThisFocus = false;
      return;
    }
    if (readThisFocus || blocked()) return;
    readThisFocus = true;
    refetch();
  };
}

export type AcceptAfterSignInDeps = {
  accept(): Promise<unknown>;
  /** The usual after-sign-in (`afterSignIn`: fresh `auth.me`, then the gate learns of the session). */
  signedIn(): Promise<void>;
  /** Joined: the usual finish, which runs `afterSignIn` itself and leaves the screen. */
  finish(): Promise<void>;
  onExpired(): void;
  /** Hands a failed accept to the signed-in view before the session becomes known (no bare view in between). */
  carry(outcome: InviteOutcome, error: unknown): void;
};

/**
 * Accept after a sign-in on the invite screen (council r1, B2). The sign-in stored a session cookie,
 * so the phone must know it whatever the accept answered: another account's session left unknown
 * stayed in SecureStore with no way to sign it out, and opened the app as that person later. A failed
 * accept is carried to the signed-in view first (another account: its "Sign out" offer), then the
 * session is made known the usual way. A dead link shows the expired notice.
 */
export async function acceptAfterSignInWith(deps: AcceptAfterSignInDeps): Promise<"joined" | InviteOutcome> {
  try {
    await deps.accept();
  } catch (error) {
    const outcome = inviteAcceptOutcome(error);
    if (outcome === "expired") deps.onExpired();
    else deps.carry(outcome, error);
    await deps.signedIn();
    return outcome;
  }
  await deps.finish();
  return "joined";
}

/** After a failed password on the invite, "Email me a link to set a password" shows (council r1, B4; the web form's rule). */
export function offersSetPasswordLink(key: MessageKey | null): boolean {
  return key === "auth.login.wrongCredentials";
}

/** Words for a refused `invite.sendSetPasswordLink`; never the server's text. */
export function setPasswordLinkError(error: unknown): MessageKey {
  const code = (error as { data?: { code?: unknown } | null } | null | undefined)?.data?.code;
  return code === "TOO_MANY_REQUESTS" ? "native.tooManyTries" : "errors.network";
}
