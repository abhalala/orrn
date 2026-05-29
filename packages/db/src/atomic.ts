import type { BatchItem } from "drizzle-orm/batch";

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

/** Append chunked insert builders (e.g. large bundle receipt rows). */
export function pushChunkedInserts<T>(
  out: SqliteBatchItem[],
  build: (chunk: T[]) => SqliteBatchItem,
  values: T[],
  chunkSize: number,
): void {
  for (let i = 0; i < values.length; i += chunkSize) {
    out.push(build(values.slice(i, i + chunkSize)));
  }
}
