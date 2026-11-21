/**
 * Which invite page view to show (plan 2026-11-18, Task 8), from who is signed in, what
 * `invite.status` said about the link, and what the page learned since (an accept that came back
 * dead or for another account, an account that turned up on sign-up). Pure, so every combination is
 * unit-tested. The page never accepts on load: every view waits for a tap.
 */
export type InviteStatus =
  | { live: false }
  | { live: true; kind: "member" | "portal"; account: "none" | "password" | "noPassword"; google: boolean };

export type InviteStatusRead = { state: "pending" } | { state: "failed" } | { state: "ready"; status: InviteStatus };

export type InviteSession = "pending" | "failed" | "signedIn" | "signedOut";

/** Learned on the page: an accept answered dead or another account, or sign-up found an account. */
export type InviteLearned = "expired" | "wrongEmail" | "signIn";

export type InviteView = "loading" | "failed" | "dead" | "wrongEmail" | "join" | "create" | "signIn" | "noPassword";

export function inviteView(input: { session: InviteSession; status: InviteStatusRead; learned?: InviteLearned | null }): InviteView {
  const { session, status, learned } = input;
  if (learned === "expired") return "dead";
  if (learned === "wrongEmail") return "wrongEmail";
  if (session === "pending") return "loading";
  if (session === "failed") return "failed";
  if (status.state === "pending") return "loading";
  if (status.state === "failed") return "failed";
  if (!status.status.live) return "dead";
  if (session === "signedIn") return "join";
  if (learned === "signIn") return "signIn";
  switch (status.status.account) {
    case "none":
      return "create";
    case "password":
      return "signIn";
    default:
      return "noPassword";
  }
}
