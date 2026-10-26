import type { Me } from "./me";

export type HomePath = "/admin" | "/today" | "/welcome" | "/no-access";

/**
 * The account can't sign in with email + password yet: a temp password to
 * replace, or no password at all (a magic-link account from waitlist
 * approval; the link is single use and /login takes only a password, so
 * without one they are locked out when the session ends). `hasPassword`
 * missing (an older `auth.me`) counts as having one.
 */
export function needsPassword(me: Me): boolean {
  return me.user.mustChangePassword === true || me.user.hasPassword === false;
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
