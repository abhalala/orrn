import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { clearImpersonation } from "@/shared/lib/impersonation";
import type { Me } from "@/shared/lib/me";
import { queryClient, trpc } from "@/shared/utils/trpc";

import { destinationAfterSignIn } from "./after-sign-in";

/**
 * After a successful sign-in: forget the previous visitor's cached data and
 * any impersonation grant left in this tab, read the fresh `auth.me`, then go
 * to the right place without a full page reload.
 */
export function useFinishSignIn(next?: string) {
  const navigate = useNavigate();
  return useCallback(async () => {
    clearImpersonation();
    queryClient.removeQueries();
    let me: Me | null = null;
    try {
      me = (await queryClient.fetchQuery(trpc.auth.me.queryOptions())) as Me;
    } catch {
      me = null;
    }
    await navigate({ href: destinationAfterSignIn(me, next), replace: true });
  }, [navigate, next]);
}
