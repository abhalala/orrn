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
  const { isErpDomain, erpUrl, marketingUrl } = getDomainConfig();

  // 1. Force ERP routes to run on erp.orrn.in
  if (!isErpDomain) {
    window.location.href = `${erpUrl}${location.pathname}${window.location.search}`;
    throw redirect({ to: "/dashboard" as any });
  }

  const me = await loadMe(context.queryClient);
  if (!me) {
    const currentUrl = window.location.href;
    window.location.href = `${marketingUrl}/login?next=${encodeURIComponent(currentUrl)}`;
    throw redirect({ to: "/login" });
  }
  if (!me.company) {
    throw redirect({ to: "/no-access" });
  }
  return { me };
}

/**
 * Guard for `_platform` group: requires session + platform admin.
 *
 * - On marketing domain -> redirect https://erp.orrn.in/path
 * - No session          -> redirect https://orrn.in/login
 * - Authed but not admin -> redirect /
 */
export async function requirePlatformAdmin({
  context,
  location,
}: {
  context: GuardContext;
  location: { pathname: string };
}) {
  const { isErpDomain, erpUrl, marketingUrl } = getDomainConfig();

  // 1. Force platform routes to run on erp.orrn.in
  if (!isErpDomain) {
    window.location.href = `${erpUrl}${location.pathname}${window.location.search}`;
    throw redirect({ to: "/platform" as any });
  }

  const me = await loadMe(context.queryClient);
  if (!me) {
    const currentUrl = window.location.href;
    window.location.href = `${marketingUrl}/login?next=${encodeURIComponent(currentUrl)}`;
    throw redirect({ to: "/login" });
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
    const { marketingUrl } = getDomainConfig();
    const currentUrl = window.location.href;
    window.location.href = `${marketingUrl}/login?next=${encodeURIComponent(currentUrl)}`;
    throw redirect({ to: "/login" });
  }
  return { me };
}
