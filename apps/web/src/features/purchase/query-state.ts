/**
 * Whether a screen should swap its content for the error panel. In React Query v5 a
 * failed refetch (window focus, a poll, an invalidation after a save) keeps `data` and
 * sets `isError`, so gating on `isError` alone throws away good numbers on one bad
 * request over plant Wi-Fi. Show the panel only when there is nothing to show.
 */
export function showsQueryError(q: { isError: boolean; data: unknown }): boolean {
  return q.isError && q.data === undefined;
}
