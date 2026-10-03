import { redirect } from "@tanstack/react-router";

import { resolveRedirect } from "./redirects";

type LegacyLocation = { pathname: string; searchStr: string };

/**
 * For an old route's `beforeLoad`: `throw legacyRedirect(location)`. Sends the
 * visitor to the new URL from `resolveRedirect`, query intact, replacing the
 * old entry in history so Back doesn't bounce.
 */
export function legacyRedirect(location: LegacyLocation) {
  const href = resolveRedirect(location.pathname, location.searchStr) ?? "/today";
  return redirect({ href, replace: true });
}
