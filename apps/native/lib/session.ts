import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { isRequestTimeout } from "./request-timeout";

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

/**
 * React Query `retry`: no retry on 4xx, none after a timeout, and other
 * transient failures retry up to 3 times. A request that got no answer in 10 s
 * is a dead uplink: three more tries kept a screen loading for about 47 s
 * before it showed its error and its own Try again.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isClientError(error)) return false;
  if (isRequestTimeout(error)) return false;
  return failureCount < 3;
}

/**
 * `retry` for the root gate's `auth.me`: one retry for a transient failure,
 * none for a 4xx, and none for a timeout (the offline screen has its own
 * Try again).
 */
export function gateQueryRetry(failureCount: number, error: unknown): boolean {
  return failureCount < 1 && shouldRetryQuery(failureCount, error);
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
 * The plant requires secure sign-in (council round 1, A4): the server refuses every tenant call made
 * with a session that was not made with a passkey, Google or the authenticator code, with
 * `data.meta.reason` `STRONG_SIGN_IN_NEEDED` (the person has one of them: sign out and ask for it) or
 * `STRONG_METHOD_NEEDED` (they have none: `auth.me` again, and the gate shows "finish on the web").
 * Decided on the code, never the server's sentence. Mirrors web `shared/lib/strong-sign-in.ts`.
 */
export type StrongSignInRefusal = { reason: "STRONG_SIGN_IN_NEEDED" | "STRONG_METHOD_NEEDED"; plant: string | null };

export function strongSignInRefusal(error: unknown): StrongSignInRefusal | null {
  const data = (error && typeof error === "object" ? (error as { data?: { code?: unknown; meta?: { reason?: unknown; plant?: unknown } | null } | null }) : null)
    ?.data;
  if (data?.code !== "FORBIDDEN") return null;
  const reason = data.meta?.reason;
  if (reason !== "STRONG_SIGN_IN_NEEDED" && reason !== "STRONG_METHOD_NEEDED") return null;
  const plant = typeof data.meta?.plant === "string" && data.meta.plant.trim() ? data.meta.plant.trim().slice(0, 120) : null;
  return { reason, plant };
}

let onStrongSignIn: ((refusal: StrongSignInRefusal) => void) | null = null;
/** The root layout signs out and leaves the sign-in screen a notice (`lib/sign-in-notice.ts`). */
export function registerStrongSignInHandler(handler: ((refusal: StrongSignInRefusal) => void) | null): void {
  onStrongSignIn = handler;
}

/**
 * Global query/mutation error hook. A 401 anywhere means the session ended
 * mid-use: re-check `auth.me` so the gate moves to sign-in. `auth.me`'s own
 * 401 is already what the gate reads, so it must not trigger another fetch.
 * A plant's secure sign-in refusal: see `strongSignInRefusal`.
 */
export async function handleSessionError(
  queryClient: QueryClient,
  error: unknown,
  queryKey?: QueryKey,
): Promise<void> {
  const strong = strongSignInRefusal(error);
  if (strong?.reason === "STRONG_SIGN_IN_NEEDED") {
    onStrongSignIn?.(strong);
    return;
  }
  if (strong?.reason === "STRONG_METHOD_NEEDED") {
    if (queryKey && isAuthMeQueryKey(queryKey)) return;
    await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY, exact: true });
    return;
  }
  if (!isUnauthorized(error)) return;
  if (queryKey && isAuthMeQueryKey(queryKey)) return;
  await queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY, exact: true });
}

/** The active company id in `auth.me` data, or null (signed in without a company). */
export function companyIdOf(data: unknown): string | null {
  return (data as { company?: { id?: string } | null } | undefined)?.company?.id ?? null;
}

/**
 * The tenant cache guard's decision: reset only when a company was already
 * known (`undefined` means no `auth.me` yet, e.g. a cold start) and the new
 * one differs, a move to "no company" included.
 */
export function shouldResetForCompany(previous: string | null | undefined, next: string | null): boolean {
  return previous !== undefined && previous !== next;
}

/**
 * Native twin of web's TenantCacheGuard (AGENTS.md: do not delete). Watches
 * the cache, never fetches: when a successful `auth.me` reports a different
 * company (another account signed in, an invite moved the person, or a plant
 * switch on another device moved this session, since native sends no
 * `x-orrn-company`), every other query is reset so the previous plant's rows
 * never show (audit N10). `auth.me` itself is kept so the gate doesn't bounce.
 * Returns the unsubscribe.
 */
export function watchCompanyChanges(queryClient: QueryClient): () => void {
  const cache = queryClient.getQueryCache();
  const existing = cache.getAll().find((q) => isAuthMeQueryKey(q.queryKey));
  let current: string | null | undefined = existing?.state.data ? companyIdOf(existing.state.data) : undefined;

  return cache.subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    if (!isAuthMeQueryKey(event.query.queryKey)) return;
    const next = companyIdOf(event.query.state.data);
    if (shouldResetForCompany(current, next)) void resetTenantQueries(queryClient);
    current = next;
  });
}
