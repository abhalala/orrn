import { can, type Me } from "@orrn/server/lib/permissions";

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
 *   password for an owner who signed in by magic link;
 * - twoFactor: magic-link owners who haven't turned it on yet;
 * - company: people who may change company settings (owner, admin), while
 *   their onboarding is open. Same rule the server uses to accept the fields.
 *
 * An admin impersonating a company keeps only their own password chore (the
 * guards demand a forced change even then); the company is not theirs to set
 * up, and the magic-link two-factor step belongs to the company's owner.
 */
export function welcomeSteps(me: Me, options: WelcomeOptions = {}): WelcomeStep[] {
  const magic = options.magic === true;
  const ownCompany = me.company && !me.impersonation ? me.company : null;
  const steps: WelcomeStep[] = [];
  if (me.user.mustChangePassword || magic) steps.push("password");
  if (magic && ownCompany?.role === "owner" && !me.user.twoFactorEnabled) steps.push("twoFactor");
  if (ownCompany && !me.user.onboardingCompleted && can(me, "settings.update")) steps.push("company");
  return steps;
}

/** The stepper's stages: every open step, then "done". */
export function welcomeTimeline(steps: WelcomeStep[]): WelcomeStage[] {
  return [...steps, "done"];
}

/** `?magic=1` as the router hands it over (a number after JSON parsing, or the raw string). */
export function parseMagicFlag(value: unknown): boolean {
  return value === 1 || value === "1";
}
