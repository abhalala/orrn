import { useEffect, useRef } from "react";

import { useMe } from "@/lib/me";
import { queryClient } from "@/utils/trpc";

/**
 * Clears all cached React Query data whenever the active company changes
 * (sign-in as different user, invite-accept switching companies, or
 * impersonation start/stop). This prevents the previous tenant's lists from
 * flashing on the new tenant's screens.
 */
export function TenantCacheGuard() {
  const { data: me } = useMe();
  const lastCompanyIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const next = me?.company?.id ?? null;
    const prev = lastCompanyIdRef.current;

    // First load — just record the company id, don't drop the cache (we may
    // have just prefetched it during a route guard).
    if (prev === undefined) {
      lastCompanyIdRef.current = next;
      return;
    }

    if (prev !== next) {
      queryClient.removeQueries({
        predicate: (q) => {
          // Keep the auth.me query itself so re-fetch is fast.
          const head = Array.isArray(q.queryKey) ? q.queryKey[0] : null;
          if (typeof head === "string" && head.startsWith("auth")) return false;
          return true;
        },
      });
      lastCompanyIdRef.current = next;
    }
  }, [me?.company?.id]);

  return null;
}
