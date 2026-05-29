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
