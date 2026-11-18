import type { Me } from "./me";
import { readPlantChosen } from "./plant-chosen";

export type HomePath = "/admin" | "/today" | "/welcome" | "/no-access" | "/choose-plant";

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

/**
 * A strong method: the authenticator app, a passkey or a linked Google account (plan 2026-11-18). A
 * plant that requires secure sign-in asks for one; the server refuses to remove the last one while such
 * a plant holds the person (`COMPANY_REQUIRES_STRONG_METHOD`).
 */
export function hasStrongMethod(me: Me): boolean {
  return me.user.twoFactorEnabled === true || me.user.hasPasskey === true || me.user.hasGoogle === true;
}

/**
 * The active plant requires secure sign-in and the person has no strong method: the mandatory "Secure
 * your sign-in" step (owner amendment 2026-11-18, item 3). Never while impersonating.
 */
export function mustSecureSignIn(me: Me): boolean {
  const plant = me.company;
  return Boolean(plant && !me.impersonation && plant.requireStrongSignIn === true && !hasStrongMethod(me));
}

/**
 * The active plant's onboarding is still open for the person (`membership.onboarded_at` is null; item
 * 5). An older `auth.me` without `setupPending` falls back to the user-level flag. Never while
 * impersonating: the plant is not the admin's to set up.
 */
export function plantSetupPending(me: Me): boolean {
  if (!me.company || me.impersonation) return false;
  return me.company.setupPending ?? me.user.onboardingCompleted !== true;
}

/**
 * The one rule for "send them to /welcome", shared by `homeFor`, the tenant guard and the bundle page,
 * so the guards and /welcome never bounce a person between them (`leaveWelcome` is its inverse;
 * welcome-steps.test.ts checks the two agree).
 */
export function needsWelcome(me: Me): boolean {
  return needsPassword(me) || plantSetupPending(me) || mustSecureSignIn(me);
}

/**
 * The person has more than one active plant and has not picked one since this sign-in (item 4). Never
 * while impersonating (the banner is the only exit) and never without an active plant (their home
 * explains where they stand).
 */
export function needsPlantChoice(me: Me, chosenThisSession: boolean): boolean {
  if (chosenThisSession || !me.company || me.impersonation) return false;
  return (me.memberships?.length ?? 0) > 1;
}

/**
 * Where a signed-in user belongs: the one place every post-login redirect agrees on.
 * `plantChosen`: a plant was picked since this sign-in (`orrn.plantChosen`).
 */
export function homeFor(me: Me, plantChosen = false): HomePath {
  if (needsPassword(me)) return "/welcome";
  if (!me.company) {
    return me.isPlatformAdmin && me.platformRole ? "/admin" : "/no-access";
  }
  if (needsPlantChoice(me, plantChosen)) return "/choose-plant";
  // An admin impersonating a tenant is judged on the tenant view, not their own onboarding.
  if (needsWelcome(me)) return "/welcome";
  return "/today";
}

/** Router path to send a signed-in user to, with this tab's plant choice. */
export function homeTarget(me: Me): HomePath {
  return homeFor(me, readPlantChosen());
}
