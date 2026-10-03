import type { BatchItem } from "drizzle-orm/batch";

import { chunk, rowsPerStatement } from "./chunk";
import type { createDb } from "./index";

export type OrrnDb = ReturnType<typeof createDb>;

type SqliteBatchItem = BatchItem<"sqlite">;
type NonEmptyBatch = readonly [SqliteBatchItem, ...SqliteBatchItem[]];

/**
 * Run multiple Drizzle statements atomically on Cloudflare D1.
 * D1 implements batching as a single SQL transaction (no SQL BEGIN/COMMIT).
 */
export async function atomicBatch(
  db: OrrnDb,
  statements: readonly SqliteBatchItem[],
): Promise<void> {
  if (statements.length === 0) {
    return;
  }
  if (statements.length === 1) {
    await db.batch([statements[0]] as NonEmptyBatch);
    return;
  }
  await db.batch(statements as NonEmptyBatch);
}

/**
 * Append insert builders for `rows`, split so every statement stays under the
 * D1 bound-parameter limit. The rows-per-statement count is derived from the
 * widest row's column count, so callers never hard-code a chunk size.
 *
 * Every row must set the same columns (include `null` explicitly rather than
 * omitting a key), otherwise the derived size can be wrong.
 */
export function pushChunkedInserts<T extends object>(
  out: SqliteBatchItem[],
  build: (rows: T[]) => SqliteBatchItem,
  rows: readonly T[],
): void {
  if (rows.length === 0) {
    return;
  }
  let columns = 1;
  for (const row of rows) {
    columns = Math.max(columns, Object.keys(row).length);
  }
  for (const part of chunk(rows, rowsPerStatement(columns))) {
    out.push(build(part));
  }
}
