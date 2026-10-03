import { useEffect } from "react";

import { isAuthMeQueryKey, resetTenantQueries } from "@/lib/session";
import { queryClient } from "@/utils/trpc";

type MeData = { company?: { id?: string } | null } | undefined;

function companyIdOf(data: unknown): string | null {
  return (data as MeData)?.company?.id ?? null;
}

/**
 * Mounted once in the root layout (native twin of web's TenantCacheGuard).
 * When `auth.me` reports a different company (another account signed in, an
 * invite moved this person to a new plant), every other query is reset so
 * the previous company's rows never show (AGENTS.md tenant rules, audit N10:
 * `resetQueries`, and `auth.me` itself is kept so the gate doesn't bounce).
 * It watches the cache instead of calling `useMe()`, so it never fires a request.
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
      if (current !== undefined && current !== next) void resetTenantQueries(queryClient);
      current = next;
    });
  }, []);

  return null;
}
