import type { Me } from "./me";

export type HomePath = "/admin" | "/today" | "/welcome" | "/no-access";

/** Where a signed-in user belongs: the one place every post-login redirect agrees on. */
export function homeFor(me: Me): HomePath {
  if (me.user.mustChangePassword) return "/welcome";
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
