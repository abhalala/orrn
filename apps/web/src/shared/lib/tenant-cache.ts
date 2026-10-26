import type { QueryClient } from "@tanstack/react-query";

/** tRPC's TanStack integration keys look like `[["auth","me"], { type: "query" }]`. */
export function isAuthMeQueryKey(queryKey: unknown): boolean {
  return (
    Array.isArray(queryKey) &&
    Array.isArray(queryKey[0]) &&
    queryKey[0][0] === "auth" &&
    queryKey[0][1] === "me"
  );
}

/** Drop every cached query except `auth.me` (AGENTS.md: no cross-tenant cache). */
export function dropTenantQueries(queryClient: QueryClient) {
  queryClient.removeQueries({ predicate: (q) => !isAuthMeQueryKey(q.queryKey) });
}
