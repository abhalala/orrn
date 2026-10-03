import { redirect } from "@tanstack/react-router";

import { resolveRedirect } from "./redirects";

type LegacyLocation = { pathname: string; searchStr: string };

/**
 * For an old route's `beforeLoad`: `throw legacyRedirect(location)`. Sends the
 * visitor to the new URL from `resolveRedirect`, query intact, replacing the
 * old entry in history so Back doesn't bounce.
 */
export function legacyRedirect(location: LegacyLocation) {
  const href = resolveRedirect(location.pathname, location.searchStr);
  if (!href) {
    // A route file is wired to this helper but `redirects.ts` has no row for it.
    if (import.meta.env.DEV) throw new Error(`No redirect mapped for ${location.pathname}; add it to STATIC_REDIRECTS.`);
    return redirect({ href: "/today", replace: true });
  }
  return redirect({ href, replace: true });
}
