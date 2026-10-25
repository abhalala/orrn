/**
 * Queries whose screen shows its own error state (an inline "didn't load"
 * with Try again, a ChartCard error) pass `meta: INLINE_ERROR_META`, so the
 * global error toast in shared/utils/trpc.ts stays quiet and the person sees
 * one message, in the screen's words, not two.
 */
export const INLINE_ERROR_META = { inlineError: true } as const;

export function hasInlineError(query: { meta?: Record<string, unknown> }): boolean {
  return query.meta?.inlineError === true;
}

type QueryState = { isError: boolean; data: unknown };

/**
 * Whether to show a query's error panel: only when it failed and has nothing
 * to show. React Query v5 keeps `data` and sets `isError` when a REFETCH
 * fails (a poll, a focus refresh), so `if (q.isError)` alone throws good
 * numbers away on one network blip. Same rule as PLW2 `showsQueryError`,
 * T22 `failedFirstLoad`, T27 `showsLoadError`.
 */
export function showsQueryError(query: QueryState): boolean {
  return query.isError && query.data === undefined;
}

/** A background refresh failed while the last good data is still on screen. */
export function refreshFailed(query: QueryState): boolean {
  return query.isError && query.data !== undefined;
}

/**
 * The server said this role may not read it (403), so "check the connection and try again" would be
 * wrong: final explore L14 (press role opening /press/report by URL).
 */
export function isForbiddenError(error: unknown): boolean {
  const data = (error as { data?: { code?: string; httpStatus?: number } } | null | undefined)?.data;
  return data?.code === "FORBIDDEN" || data?.httpStatus === 403;
}
