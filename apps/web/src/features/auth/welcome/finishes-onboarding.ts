// The permission module itself, not shared/lib/me (that one pulls in the tRPC client).
import { can, type Me } from "@orrn/server/lib/permissions";

import { plantSetupPending } from "@/shared/lib/home";

/**
 * The closing screen's button closes this person's onboarding in the active
 * plant (`auth.completeOnboarding({})`, which sets that membership's
 * `onboarded_at` only). Owners and admins (`settings.update`) already closed it
 * with the company step; everyone else (invited operators, packers, viewers)
 * closes it here, or `homeFor` would send them back to /welcome forever. Staff
 * in no plant with the old user flag open close that flag here too.
 */
export function finishesOnboardingHere(me: Me): boolean {
  const open = me.company ? plantSetupPending(me) : me.user.onboardingCompleted !== true;
  return open && !can(me, "settings.update");
}
