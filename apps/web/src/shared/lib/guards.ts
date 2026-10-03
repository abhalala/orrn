import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import { homeTarget } from "./home";
import { clearImpersonation } from "./impersonation";
import type { Me } from "./me";
import { isImpersonationForbidden } from "./session-errors";
import { trpc } from "../utils/trpc";

type GuardContext = {
  queryClient: QueryClient;
};

type GuardArgs = {
  context: GuardContext;
  location: { href: string };
};

/** Session check is cheap but must not go stale for a whole visit (W11). */
export const ME_STALE_MS = 30_000;

/**
 * Guard-time options for `auth.me`: no retries (a guard must answer fast) and
 * `networkMode: "always"` so an offline navigation attempts the request and
 * fails, instead of pausing forever and hanging the navigation.
 */
function meGuardOptions() {
  return {
    ...trpc.auth.me.queryOptions(),
    staleTime: ME_STALE_MS,
    retry: false as const,
    networkMode: "always" as const,
  };
}

/**
 * Current `auth.me`. Null means signed out, and only means that when the
 * server says UNAUTHORIZED or there is no cached `me` to fall back on.
 *
 * - Cached `me` (fresh or stale): returned immediately. When stale it
 *   revalidates in the background, so a dead session (401) still reaches the
 *   global handler and a 5xx or offline blip never bounces a signed-in user to
 *   /login or hangs the navigation.
 * - No cache: fetched once. UNAUTHORIZED or any other failure means null.
 * - A FORBIDDEN impersonation-grant error (expired or revoked grant) drops the
 *   stored grant and retries once as the plain user instead of looping (W2).
 */
export async function loadMe(queryClient: QueryClient): Promise<Me | null> {
  const options = meGuardOptions();
  if (queryClient.getQueryData(options.queryKey) !== undefined) {
    return (await queryClient.ensureQueryData({ ...options, revalidateIfStale: true })) as Me;
  }
  try {
    return (await queryClient.fetchQuery(options)) as Me;
  } catch (error) {
    if (!isImpersonationForbidden(error)) return null;
    clearImpersonation();
    try {
      return (await queryClient.fetchQuery(meGuardOptions())) as Me;
    } catch {
      return null;
    }
  }
}

export function toLogin(location: { href: string }) {
  return redirect({ to: "/login", search: { next: location.href } });
}

/** Any signed-in user, no further steps checked. For the `_authed` layout. */
export async function requireSignedIn({ context, location }: GuardArgs) {
  const me = await loadMe(context.queryClient);
  if (!me) throw toLogin(location);
  return { me };
}

/** Tenant app: session + company membership; unauthenticated → login with `next`. */
export async function requireCompanyMe({ context, location }: GuardArgs) {
  const me = await loadMe(context.queryClient);
  if (!me) throw toLogin(location);
  if (me.user.mustChangePassword) throw redirect({ to: "/welcome" });
  if (!me.company) {
    // Staff have no company of their own; their home is the console.
    throw redirect({ to: me.isPlatformAdmin && me.platformRole ? "/admin" : "/no-access" });
  }
  if (!me.impersonation && !me.user.onboardingCompleted) throw redirect({ to: "/welcome" });
  return { me };
}

/** Signed-in user who has finished the forced-password step (welcome). */
export async function requireSession({ context, location }: GuardArgs) {
  const me = await loadMe(context.queryClient);
  if (!me) throw toLogin(location);
  if (me.user.mustChangePassword) throw redirect({ to: "/welcome" });
  return { me };
}

/** Staff console: platform admin only. Everyone else goes to their own home. */
export async function requirePlatformAdmin({ context, location }: GuardArgs) {
  const me = await loadMe(context.queryClient);
  if (!me) throw toLogin(location);
  if (me.user.mustChangePassword) throw redirect({ to: "/welcome" });
  if (!me.isPlatformAdmin || !me.platformRole) throw redirect({ to: homeTarget(me) });
  return { me };
}
