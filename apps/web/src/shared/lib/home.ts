import type { Me } from "./me";

export type HomePath = "/admin" | "/today" | "/welcome" | "/no-access";

/**
 * The account can't sign in on its own yet: a temp password to replace, or no
 * way in at all (a magic-link account from waitlist approval; the link is
 * single use, so without a password, a passkey or Google they are locked out
 * when the session ends). A passkey or Google counts like a password (plan
 * 2026-11-18). A missing `hasPassword` (an older `auth.me`) counts as having
 * one, and a missing `hasPasskey` / `hasGoogle` as not having it.
 */
export function needsPassword(me: Me): boolean {
  if (me.user.mustChangePassword === true) return true;
  return me.user.hasPassword === false && me.user.hasPasskey !== true && me.user.hasGoogle !== true;
}

/** Where a signed-in user belongs: the one place every post-login redirect agrees on. */
export function homeFor(me: Me): HomePath {
  if (needsPassword(me)) return "/welcome";
  if (!me.company) {
    return me.isPlatformAdmin && me.platformRole ? "/admin" : "/no-access";
  }
  // An admin impersonating a tenant is judged on the tenant view, not their own onboarding.
  if (!me.impersonation && !me.user.onboardingCompleted) return "/welcome";
  return "/today";
}

/** Router path to send a signed-in user to. */
export function homeTarget(me: Me): HomePath {
  return homeFor(me);
}
