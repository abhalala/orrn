import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import type { Me } from "@/lib/me";
import { trpc } from "@/utils/trpc";

type GuardContext = {
  queryClient: QueryClient;
};

/**
 * Fetch (or read from cache) the current `auth.me` payload. If the request
 * fails (network or UNAUTHORIZED), returns `null` so callers can decide what to
 * do.
 */
async function loadMe(queryClient: QueryClient): Promise<Me | null> {
  try {
    const me = await queryClient.ensureQueryData(trpc.auth.me.queryOptions());
    return me as Me;
  } catch {
    return null;
  }
}

/**
 * Guard for `_app` group: requires a session AND active company membership.
 *
 * - No session       -> redirect /login?next=<location.pathname>
 * - Authed, no co.   -> redirect /no-access
 * - Otherwise        -> return { me } for route context
 */
export async function requireCompanyMe({
  context,
  location,
}: {
  context: GuardContext;
  location: { pathname: string };
}) {
  const me = await loadMe(context.queryClient);
  if (!me) {
    throw redirect({
      to: "/login",
      search: { next: location.pathname } as any,
    });
  }
  if (!me.company) {
    throw redirect({ to: "/no-access" });
  }
  return { me };
}

/**
 * Guard for `_platform` group: requires session + platform admin.
 *
 * - No session                        -> redirect /login
 * - Authed but not platform admin     -> redirect /
 */
export async function requirePlatformAdmin({
  context,
  location,
}: {
  context: GuardContext;
  location: { pathname: string };
}) {
  const me = await loadMe(context.queryClient);
  if (!me) {
    throw redirect({
      to: "/login",
      search: { next: location.pathname } as any,
    });
  }
  if (!me.isPlatformAdmin) {
    throw redirect({ to: "/" });
  }
  return { me };
}

/**
 * Lighter guard for routes that should be reachable by any signed-in user
 * (including users with no active company membership, e.g. `/no-access`,
 * `/invite/$token`).
 */
export async function requireSession({
  context,
  location,
}: {
  context: GuardContext;
  location: { pathname: string };
}) {
  const me = await loadMe(context.queryClient);
  if (!me) {
    throw redirect({
      to: "/login",
      search: { next: location.pathname } as any,
    });
  }
  return { me };
}
