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

function fetchMe(queryClient: QueryClient) {
  return queryClient.fetchQuery({ ...trpc.auth.me.queryOptions(), staleTime: ME_STALE_MS });
}

/**
 * Current `auth.me`, revalidated at most every 30 s. Null means signed out.
 * A FORBIDDEN impersonation-grant error (expired or revoked grant) drops the
 * stored grant and retries once as the plain user instead of looping (W2).
 */
export async function loadMe(queryClient: QueryClient): Promise<Me | null> {
  try {
    return (await fetchMe(queryClient)) as Me;
  } catch (error) {
    if (!isImpersonationForbidden(error)) return null;
    clearImpersonation();
    try {
      return (await fetchMe(queryClient)) as Me;
    } catch {
      return null;
    }
  }
}

function toLogin(location: { href: string }) {
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
  if (me.user.mustChangePassword) throw redirect({ to: "/change-password" });
  if (!me.company) {
    // Staff have no company of their own; their home is the console.
    throw redirect({ to: me.isPlatformAdmin && me.platformRole ? "/admin" : "/no-access" });
  }
  if (!me.impersonation && !me.user.onboardingCompleted) throw redirect({ to: "/onboarding" });
  return { me };
}

/** Signed-in user who has finished the forced-password step (onboarding, setup-credentials). */
export async function requireSession({ context, location }: GuardArgs) {
  const me = await loadMe(context.queryClient);
  if (!me) throw toLogin(location);
  if (me.user.mustChangePassword) throw redirect({ to: "/change-password" });
  return { me };
}

/** Staff console: platform admin only. Everyone else goes to their own home. */
export async function requirePlatformAdmin({ context, location }: GuardArgs) {
  const me = await loadMe(context.queryClient);
  if (!me) throw toLogin(location);
  if (me.user.mustChangePassword) throw redirect({ to: "/change-password" });
  if (!me.isPlatformAdmin || !me.platformRole) throw redirect({ to: homeTarget(me) });
  return { me };
}
