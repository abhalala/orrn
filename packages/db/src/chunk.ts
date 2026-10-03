/** Cloudflare D1 rejects any statement with more than 100 bound parameters. */
export const D1_MAX_PARAMS = 100;

/**
 * Ids per `IN (...)` list. Leaves headroom under {@link D1_MAX_PARAMS} for the
 * other bound values in the same statement (companyId, status, dispatch id and
 * the `SET` values of an UPDATE, which add up to at most ~7).
 */
export const IN_LIST_CHUNK = 90;

/** How many rows of `columnsPerRow` bound columns fit in one statement. */
export function rowsPerStatement(columnsPerRow: number, limit = D1_MAX_PARAMS): number {
  return Math.max(1, Math.floor(limit / columnsPerRow));
}

/** Split `items` into consecutive slices of at most `size` (min 1). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) {
    out.push(items.slice(i, i + step));
  }
  return out;
}

/** Run `fn` once per {@link IN_LIST_CHUNK}-sized slice of `ids` and concatenate the results. */
export async function mapInChunks<T, R>(
  ids: readonly T[],
  fn: (ids: T[]) => Promise<R[]>,
  size = IN_LIST_CHUNK,
): Promise<R[]> {
  const parts = await Promise.all(chunk(ids, size).map(fn));
  return parts.flat();
}
