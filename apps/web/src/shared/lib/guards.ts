import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";

import type { Me } from "./me";
import { trpc } from "../utils/trpc";

type GuardContext = {
  queryClient: QueryClient;
};

async function loadMe(queryClient: QueryClient): Promise<Me | null> {
  try {
    const me = await queryClient.ensureQueryData(trpc.auth.me.queryOptions());
    return me as Me;
  } catch {
    return null;
  }
}

/** Tenant app: session + company membership; unauthenticated → login. */
export async function requireCompanyMe({
  context,
}: {
  context: GuardContext;
}) {
  const me = await loadMe(context.queryClient);
  if (!me) {
    throw redirect({ to: "/login" });
  }
  if (me.user.mustChangePassword) {
    throw redirect({ to: "/change-password" });
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
}: {
  context: GuardContext;
}) {
  const me = await loadMe(context.queryClient);
  if (!me) {
    throw redirect({ to: "/login" });
  }
  if (me.user.mustChangePassword) {
    throw redirect({ to: "/change-password" });
  }
  return { me };
}

/** Tenant root: send authed users to dashboard, others to login. */
export async function requireErpEntry({
  context,
}: {
  context: GuardContext;
}) {
  const me = await loadMe(context.queryClient);
  if (!me) {
    throw redirect({ to: "/login" });
  }
  throw redirect({ to: "/dashboard" });
}

/** Staff console: platform admin only. */
export async function requirePlatformAdmin({ context }: { context: GuardContext }) {
  const me = await loadMe(context.queryClient);
  if (!me) {
    throw redirect({ to: "/" });
  }
  if (!me.isPlatformAdmin || !me.platformRole) {
    throw redirect({ to: "/" });
  }
  if (me.user.mustChangePassword) {
    throw redirect({ to: "/change-password" });
  }
  return { me };
}