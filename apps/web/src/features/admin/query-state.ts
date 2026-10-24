/**
 * Show the error panel only when there is nothing else to show. In React
 * Query v5 a failed refetch (window focus, retry) keeps the last good `data`
 * and sets `isError`, so gating on `isError` alone would swap a full page for
 * an error over one network blip (bulletin T19-quality gotcha).
 */
export function showsLoadError(q: { isError: boolean; data: unknown }): boolean {
  return q.isError && q.data === undefined;
}
