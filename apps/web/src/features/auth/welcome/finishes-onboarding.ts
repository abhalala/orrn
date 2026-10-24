// The permission module itself, not shared/lib/me (that one pulls in the tRPC client).
import { can, type Me } from "@orrn/server/lib/permissions";

/**
 * The closing screen's button closes this person's onboarding
 * (`auth.completeOnboarding({})`). Owners and admins (`settings.update`)
 * already closed it with the company step; everyone else (invited operators,
 * packers, viewers, staff with the flag open) closes it here, or `homeFor`
 * would send them back to /welcome forever.
 */
export function finishesOnboardingHere(me: Me): boolean {
  return !me.user.onboardingCompleted && !can(me, "settings.update");
}
