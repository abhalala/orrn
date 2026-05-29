import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import type { Me } from "./me";
import { trpc } from "../utils/trpc";
import { appUrls, marketingLoginUrl } from "./urls";

type GuardContext = {
  queryClient: QueryClient;
};

type GuardLocation = {
  pathname: string;
  search?: unknown;
  href?: string;
};

function locationReturnTo(location: GuardLocation, origin: string): string {
  if (typeof window !== "undefined") {
    return window.location.href;
  }
  const search =
    typeof location.search === "string"
      ? location.search
      : typeof location.href === "string"
        ? new URL(location.href, origin).search
        : "";
  return `${origin}${location.pathname}${search}`;
}

async function loadMe(queryClient: QueryClient): Promise<Me | null> {
  try {
    const me = await queryClient.ensureQueryData(trpc.auth.me.queryOptions());
    return me as Me;
  } catch {
    return null;
  }
}

/** ERP app: session + company membership; unauthenticated → marketing login with `next`. */
export async function requireCompanyMe({
  context,
  location,
}: {
  context: GuardContext;
  location: GuardLocation;
}) {
  const me = await loadMe(context.queryClient);
  if (!me) {
    const returnTo = locationReturnTo(location, appUrls.erp);
    window.location.href = marketingLoginUrl(returnTo);
    throw redirect({ to: "/" });
  }

  if (!me.company) {
    throw redirect({ to: "/no-access" });
  }
  if (!me.user.onboardingCompleted) {
    throw redirect({ to: "/onboarding" });
  }
  return { me };
}

/** Signed-in user without requiring company (no-access, invite, setup-credentials). */
export async function requireSession({
  context,
  location,
}: {
  context: GuardContext;
  location: GuardLocation;
}) {
  const me = await loadMe(context.queryClient);
  if (!me) {
    const returnTo = locationReturnTo(location, appUrls.erp);
    window.location.href = marketingLoginUrl(returnTo);
    throw redirect({ to: "/" });
  }
  return { me };
}

/** ERP root: send authed users to dashboard, others to marketing login. */
export async function requireErpEntry({
  context,
  location,
}: {
  context: GuardContext;
  location: GuardLocation;
}) {
  const me = await loadMe(context.queryClient);
  if (!me) {
    const returnTo = locationReturnTo(location, appUrls.erp);
    window.location.href = marketingLoginUrl(returnTo);
    throw redirect({ to: "/" });
  }
  throw redirect({ to: "/dashboard" });
}
