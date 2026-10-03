import type { Me } from "@orrn/server/lib/permissions";

/** A step the welcome stepper can still ask for, in the order it asks. */
export type WelcomeStep = "password" | "twoFactor" | "company";

/** What the stepper shows: the open steps, then the closing "done" screen. */
export type WelcomeStage = WelcomeStep | "done";

export type WelcomeOptions = {
  /**
   * The person arrived from the emailed magic link (waitlist approval). The old
   * `/setup-credentials` URL redirects to `/welcome?magic=1` (ruling R6).
   */
  magic?: boolean;
};

/**
 * The steps this person still needs before the app, derived from `auth.me`
 * (spec section 3, `/welcome`):
 *
 * - password: a forced change for temp-password accounts, or the first
 *   password for an owner who signed in by magic link (onboarding still open);
 * - twoFactor: magic-link owners who haven't turned it on yet;
 * - company: owners and admins (the roles with `settings.update`, the rule
 *   the server uses to accept the fields), while their onboarding is open.
 *
 * An admin impersonating a company keeps only their own password chore (the
 * guards demand a forced change even then); the company is not theirs to set
 * up, and the magic-link two-factor step belongs to the company's owner.
 */
export function welcomeSteps(me: Me, options: WelcomeOptions = {}): WelcomeStep[] {
  // The magic link only means something while onboarding is open: once an
  // owner is set up, an old emailed link must not walk them through it again.
  const magic = options.magic === true && !me.user.onboardingCompleted;
  const ownCompany = me.company && !me.impersonation ? me.company : null;
  const steps: WelcomeStep[] = [];
  if (me.user.mustChangePassword || magic) steps.push("password");
  if (magic && ownCompany?.role === "owner" && !me.user.twoFactorEnabled) steps.push("twoFactor");
  if (ownCompany && !me.user.onboardingCompleted && COMPANY_SETUP_ROLES.includes(ownCompany.role)) steps.push("company");
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

/** `?magic=1` as the router hands it over (a number after JSON parsing, or the raw string). */
export function parseMagicFlag(value: unknown): boolean {
  return value === 1 || value === "1";
}
