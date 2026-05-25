import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import { getDomainConfig } from "@/lib/domain";
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
 * - On marketing domain -> redirect https://erp.orrn.in/path
 * - No session          -> redirect https://orrn.in/login?next=https://erp.orrn.in/path
 * - Authed, no co.      -> redirect /no-access
 * - Otherwise           -> return { me } for route context
 */
export async function requireCompanyMe({
  context,
  location,
}: {
  context: GuardContext;
  location: { pathname: string };
}) {
  const { isErpDomain, isOrrnAppDomain, erpUrl, marketingUrl } = getDomainConfig();

  // 1. Force ERP routes to run on erp.orrn.in unless we are on the staff/app domain
  if (!isErpDomain && !isOrrnAppDomain) {
    window.location.href = `${erpUrl}${location.pathname}${window.location.search}`;
    throw redirect({ to: "/dashboard" as any });
  }

  const me = await loadMe(context.queryClient);
  if (!me) {
    if (isOrrnAppDomain) {
      throw redirect({ to: "/" as any });
    }
    const currentUrl = window.location.href;
    window.location.href = `${marketingUrl}/login?next=${encodeURIComponent(currentUrl)}`;
    throw redirect({ to: "/login" });
  }

  // If on the staff domain, the user must be a platform admin/staff
  if (isOrrnAppDomain && !me.isPlatformAdmin) {
    window.location.href = "https://erp.orrn.in/no-access";
    throw redirect({ to: "/no-access" });
  }

  if (!me.company) {
    throw redirect({ to: "/no-access" });
  }
  if (!me.user.onboardingCompleted) {
    throw redirect({ to: "/onboarding" });
  }
  return { me };
}

/**
 * Guard for `_platform` (now `/admin`) group: requires session + platform admin on orrn.app.
 *
 * - On other domains -> redirect to https://orrn.app/admin
 * - No session          -> redirect to / (login screen on orrn.app)
 * - Authed but not admin -> redirect to https://erp.orrn.in/no-access
 */
export async function requirePlatformAdmin({
  context,
  location,
}: {
  context: GuardContext;
  location: { pathname: string };
}) {
  const { isOrrnAppDomain, staffUrl } = getDomainConfig();

  // 1. Force platform/admin routes to run exclusively on the staff domain (orrn.app)
  if (!isOrrnAppDomain) {
    const targetPath = location.pathname.startsWith("/platform")
      ? location.pathname.replace(/^\/platform/, "/admin")
      : location.pathname;
    window.location.href = `${staffUrl}${targetPath}${window.location.search}`;
    throw redirect({ to: "/admin" as any });
  }

  const me = await loadMe(context.queryClient);
  if (!me) {
    throw redirect({ to: "/" as any });
  }
  if (!me.isPlatformAdmin) {
    window.location.href = "https://erp.orrn.in/no-access";
    throw redirect({ to: "/no-access" });
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
  const { isOrrnAppDomain, marketingUrl } = getDomainConfig();
  const me = await loadMe(context.queryClient);
  
  if (!me) {
    if (isOrrnAppDomain) {
      throw redirect({ to: "/" as any });
    }
    const currentUrl = window.location.href;
    window.location.href = `${marketingUrl}/login?next=${encodeURIComponent(currentUrl)}`;
    throw redirect({ to: "/login" });
  }

  // If on the staff domain, the user must be a platform admin/staff
  if (isOrrnAppDomain && !me.isPlatformAdmin) {
    window.location.href = "https://erp.orrn.in/no-access";
    throw redirect({ to: "/no-access" });
  }

  return { me };
}
