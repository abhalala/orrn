import { homeTarget } from "@/shared/lib/home";
import type { Me } from "@/shared/lib/me";
import { safeNext } from "@/shared/lib/safe-next";

/**
 * Where a person goes right after signing in. Their home decides (staff to
 * the console, open welcome steps to /welcome, no company to /no-access);
 * `next` is honoured only when the home is the app or the console, and only
 * as a same-origin path (W4). If `me` couldn't be read, a safe `next` or
 * Today; the route guards sort out the rest.
 */
export function destinationAfterSignIn(me: Me | null, next?: string): string {
  if (!me) return safeNext(next, "/today");
  const home = homeTarget(me);
  return home === "/today" || home === "/admin" ? safeNext(next, home) : home;
}
