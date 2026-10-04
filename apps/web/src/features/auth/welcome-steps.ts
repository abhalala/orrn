import type { Me } from "@orrn/server/lib/permissions";

import { needsPassword } from "@/shared/lib/home";

export { needsPassword };

/** A step the welcome stepper can still ask for, in the order it asks. */
export type WelcomeStep = "password" | "twoFactor" | "company";

/** What the stepper shows: the open steps, then the closing "done" screen. */
export type WelcomeStage = WelcomeStep | "done";

/**
 * The steps this person still needs before the app, derived from `auth.me`
 * alone (spec section 3, `/welcome`), so leaving, reloading or signing in
 * again resumes where they are instead of skipping steps:
 *
 * - password: a forced change for temp-password accounts, or the first
 *   password for an account that has none (magic-link owners);
 * - twoFactor: owners whose onboarding is open and who haven't turned it on;
 * - company: owners and admins (the roles with `settings.update`, the rule
 *   the server uses to accept the fields), while their onboarding is open.
 *
 * An admin impersonating a company keeps only their own password chore (the
 * guards demand it even then); the company and its owner's two-factor are not
 * theirs to set up.
 */
export function welcomeSteps(me: Me): WelcomeStep[] {
  const ownCompany = me.company && !me.impersonation ? me.company : null;
  const setupOpen = Boolean(ownCompany) && !me.user.onboardingCompleted;
  const steps: WelcomeStep[] = [];
  if (needsPassword(me)) steps.push("password");
  if (setupOpen && ownCompany?.role === "owner" && !me.user.twoFactorEnabled) steps.push("twoFactor");
  if (setupOpen && ownCompany && COMPANY_SETUP_ROLES.includes(ownCompany.role)) steps.push("company");
  return steps;
}

/**
 * Roles that fill in company details. Kept as a list (not `can()`) so the
 * route guard doesn't pull the permission matrix into the entry chunk;
 * welcome-steps.test.ts checks it against `can(me, "settings.update")`.
 */
export const COMPANY_SETUP_ROLES: readonly string[] = ["owner", "admin"];

/**
 * True when `/welcome` has nothing for this person and should send them home
 * (like the old `/change-password` did). People whose only open item is the
 * onboarding flag (invited operators) stay for the closing screen; people in
 * no company never do, since their home (/no-access or the console) is the
 * screen that explains where they stand.
 */
export function leaveWelcome(me: Me, steps: WelcomeStep[]): boolean {
  if (steps.length > 0) return false;
  return me.user.onboardingCompleted === true || Boolean(me.impersonation) || !me.company;
}

/** The stepper's stages: every open step, then "done". */
export function welcomeTimeline(steps: WelcomeStep[]): WelcomeStage[] {
  return [...steps, "done"];
}
