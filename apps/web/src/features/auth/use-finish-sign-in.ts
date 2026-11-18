import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { clearImpersonation } from "@/shared/lib/impersonation";
import { clearPlantChosen } from "@/shared/lib/plant-chosen";
import type { Me } from "@/shared/lib/me";
import { queryClient, trpc } from "@/shared/utils/trpc";

import { destinationAfterSignIn } from "./after-sign-in";

/**
 * After a successful sign-in: forget the previous visitor's cached data, any
 * impersonation grant and any plant picked earlier in this tab (a session that
 * expired reaches /login without a sign-out; a person in several plants picks
 * again after every sign-in), read the fresh `auth.me`, then go to the right
 * place without a full page reload.
 */
export function useFinishSignIn(next?: string) {
  const navigate = useNavigate();
  return useCallback(async () => {
    clearImpersonation();
    clearPlantChosen();
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
