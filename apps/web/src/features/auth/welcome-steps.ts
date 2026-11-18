import type { Me } from "@orrn/server/lib/permissions";

import { hasStrongMethod, mustSecureSignIn, needsPassword, plantSetupPending } from "@/shared/lib/home";

export { hasStrongMethod, needsPassword };

/** A step the welcome stepper can still ask for, in the order it asks. */
export type WelcomeStep = "password" | "secureSignIn" | "company";

/** What the stepper shows: the open steps, then the closing "done" screen. */
export type WelcomeStage = WelcomeStep | "done";

/**
 * The steps this person still needs before the app, derived from `auth.me`
 * alone (spec section 3, `/welcome`; owner amendment 2026-11-18), so leaving,
 * reloading or signing in again resumes where they are instead of skipping steps:
 *
 * - password: a forced change for temp-password accounts, or the first
 *   password for an account with no way in at all (no password, passkey or
 *   Google). User-level: it does not depend on the plant;
 * - secureSignIn: the active plant requires secure sign-in
 *   (`company.requireStrongSignIn`) and the person has no strong method
 *   (`hasStrongMethod`). Any role, set up or not: it is asked whenever they
 *   enter that plant. Two-factor is otherwise the person's own choice;
 * - company: owners and admins (the roles with `settings.update`, the rule
 *   the server uses to accept the fields) while this plant's setup is open
 *   for them (`company.setupPending`).
 *
 * An admin impersonating a company keeps only their own password chore (the
 * guards demand it even then); the plant's setup and policy are not theirs.
 */
export function welcomeSteps(me: Me): WelcomeStep[] {
  const steps: WelcomeStep[] = [];
  if (needsPassword(me)) steps.push("password");
  if (mustSecureSignIn(me)) steps.push("secureSignIn");
  if (plantSetupPending(me) && me.company && COMPANY_SETUP_ROLES.includes(me.company.role)) steps.push("company");
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
 * (like the old `/change-password` did). People whose only open item is this
 * plant's setup (invited operators) stay for the closing screen, which marks
 * it done; people in no company never do, since their home (/no-access or the
 * console) is the screen that explains where they stand. The inverse of
 * `needsWelcome` (shared/lib/home.ts).
 */
export function leaveWelcome(me: Me, steps: WelcomeStep[]): boolean {
  if (steps.length > 0) return false;
  return !plantSetupPending(me);
}

/** The stepper's stages: every open step, then "done". */
export function welcomeTimeline(steps: WelcomeStep[]): WelcomeStage[] {
  return [...steps, "done"];
}
