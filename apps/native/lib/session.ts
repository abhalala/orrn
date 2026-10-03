import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Session and cache rules shared by the root layout, the tRPC client and
 * sign-out. Kept free of React Native imports so bun tests can load it.
 * Mirrors `apps/web/src/shared/lib/{session-errors,tenant-cache}.ts`.
 */

/** tRPC's TanStack key for `auth.me` (input-less query). */
export const ME_QUERY_KEY = [["auth", "me"], { type: "query" }] as const;

type TrpcLike = { message?: unknown; data?: { code?: unknown; httpStatus?: unknown } | null };

function asTrpcLike(error: unknown): TrpcLike | null {
  return error && typeof error === "object" ? (error as TrpcLike) : null;
}

/** tRPC's TanStack integration keys look like `[["auth","me"], { type: "query" }]`. */
export function isAuthMeQueryKey(queryKey: unknown): boolean {
  return (
    Array.isArray(queryKey) &&
    Array.isArray(queryKey[0]) &&
    queryKey[0][0] === "auth" &&
    queryKey[0][1] === "me"
  );
}

export function isUnauthorized(error: unknown): boolean {
  return asTrpcLike(error)?.data?.code === "UNAUTHORIZED";
}

/** tRPC 4xx: the request itself is wrong or not allowed, so repeating it cannot help. */
export function isClientError(error: unknown): boolean {
  const status = asTrpcLike(error)?.data?.httpStatus;
  return typeof status === "number" && status >= 400 && status < 500;
}

/** React Query `retry`: no retry on 4xx; transient failures retry up to 3 times. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isClientError(error)) return false;
  return failureCount < 3;
}

/**
 * Company switch (another account signs in, an invite moves the person to a
 * new plant): reset every query except `auth.me` (audit N10). `resetQueries`
 * rather than `removeQueries`, so screens that are still mounted refetch for
 * the new company instead of holding the previous company's rows.
 */
export function resetTenantQueries(queryClient: QueryClient): Promise<void> {
  return queryClient.resetQueries({ predicate: (q) => !isAuthMeQueryKey(q.queryKey) });
}

/**
 * After sign-out nothing may survive, `auth.me` included. Resetting (not
 * `clear()`) also tells mounted observers, so the gate sees the signed-out
 * state at once instead of rendering stale data (audit N10).
 */
export async function resetAfterSignOut(queryClient: QueryClient): Promise<void> {
  queryClient.removeQueries({ type: "inactive" });
  await queryClient.resetQueries().catch(() => {});
}

/**
 * Global query/mutation error hook. A 401 anywhere means the session ended
 * mid-use: re-check `auth.me` so the gate moves to sign-in. `auth.me`'s own
 * 401 is already what the gate reads, so it must not trigger another fetch.
 */
export async function handleSessionError(
  queryClient: QueryClient,
  error: unknown,
  queryKey?: QueryKey,
): Promise<void> {
  if (!isUnauthorized(error)) return;
  if (queryKey && isAuthMeQueryKey(queryKey)) return;
  await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY, exact: true });
}
