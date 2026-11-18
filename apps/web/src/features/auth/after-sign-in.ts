import { homeFor } from "@/shared/lib/home";
import type { Me } from "@/shared/lib/me";
import { safeNext } from "@/shared/lib/safe-next";

/**
 * Where a person goes right after signing in. Their home decides (staff to
 * the console, open welcome steps to /welcome, no company to /no-access,
 * several plants to /choose-plant); `next` is honoured only when the home is
 * the app or the console, and only as a same-origin path (W4). A person in
 * several plants carries it through the picker (`/choose-plant?next=`). Right
 * after a sign-in nothing is picked yet in this tab. If `me` couldn't be read,
 * a safe `next` or Today; the route guards sort out the rest.
 */
export function destinationAfterSignIn(me: Me | null, next?: string): string {
  if (!me) return safeNext(next, "/today");
  const home = homeFor(me, false);
  if (home === "/choose-plant") {
    const kept = safeNext(next, "");
    return kept ? `/choose-plant?next=${encodeURIComponent(kept)}` : home;
  }
  return home === "/today" || home === "/admin" ? safeNext(next, home) : home;
}
