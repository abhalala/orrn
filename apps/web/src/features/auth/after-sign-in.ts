import { homeFor } from "@/shared/lib/home";
import type { Me } from "@/shared/lib/me";
import { safeNext } from "@/shared/lib/safe-next";

/** `/invite/<token>`, optionally with its query (a party invite's `?kind=portal`). */
const INVITE_PATH = /^\/invite\/[^/?#]+(?:\?[^#]*)?$/;

/**
 * Where a person goes right after signing in. Their home decides (staff to
 * the console, open welcome steps to /welcome, no company to /no-access,
 * several plants to /choose-plant); `next` is honoured only when the home is
 * the app or the console, and only as a same-origin path (W4). A person in
 * several plants carries it through the picker (`/choose-plant?next=`). Right
 * after a sign-in nothing is picked yet in this tab. An `/invite/<token>` next
 * always wins: the join happens on that page. If `me` couldn't be read, a
 * safe `next` or Today; the route guards sort out the rest.
 */
export function destinationAfterSignIn(me: Me | null, next?: string): string {
  if (!me) return safeNext(next, "/today");
  // Back to an invite (Google from the invite page, plan 2026-11-18 Task 8): the join happens there,
  // and after it the person goes home as usual. Their home now must not swallow the way back.
  const invite = safeNext(next, "");
  if (INVITE_PATH.test(invite)) return invite;
  const home = homeFor(me, false);
  if (home === "/choose-plant") {
    const kept = safeNext(next, "");
    return kept ? `/choose-plant?next=${encodeURIComponent(kept)}` : home;
  }
  return home === "/today" || home === "/admin" ? safeNext(next, home) : home;
}
