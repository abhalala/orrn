import { useEffect } from "react";

import { dropTenantQueries, isAuthMeQueryKey } from "../lib/tenant-cache";
import { queryClient } from "../utils/trpc";

type MeData = { company?: { id?: string } | null } | undefined;

function companyIdOf(data: unknown): string | null {
  return (data as MeData)?.company?.id ?? null;
}

/**
 * Mounted once in `__root.tsx`. Watches `auth.me` in the query cache and, when
 * the active company changes (different user signs in, invite switches company,
 * impersonation starts or stops), drops every other cached query so the
 * previous tenant's lists never flash on the new tenant's screens.
 *
 * It subscribes to the cache instead of calling `useMe()`, so public pages do
 * not fire an `auth.me` request just to mount this guard.
 */
export function TenantCacheGuard() {
  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const existing = cache.getAll().find((q) => isAuthMeQueryKey(q.queryKey));
    let current: string | null | undefined = existing?.state.data ? companyIdOf(existing.state.data) : undefined;

    return cache.subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      if (!isAuthMeQueryKey(event.query.queryKey)) return;
      const next = companyIdOf(event.query.state.data);
      // First observation just records the company; it may have been prefetched by a guard.
      if (current !== undefined && current !== next) dropTenantQueries(queryClient);
      current = next;
    });
  }, []);

  return null;
}
