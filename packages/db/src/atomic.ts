import { sql, type SQL } from "drizzle-orm";
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
 * Like {@link atomicBatch}, and returns the rows of the LAST statement, which must be a SELECT.
 * It runs inside the batch, after every other statement, so it reports what this batch itself
 * wrote and cannot be skewed by a request that lands after the batch (D1 runs a batch serially).
 */
export async function atomicBatchLast<Row>(
  db: OrrnDb,
  statements: readonly SqliteBatchItem[],
): Promise<Row[]> {
  if (statements.length === 0) {
    return [];
  }
  const results = (await db.batch(statements as NonEmptyBatch)) as unknown as unknown[];
  return (results[results.length - 1] ?? []) as Row[];
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

/** The tag a refused batch fails with; see {@link abortBatchUnless}. */
export const BATCH_ABORT_TAG = "orrn_batch_abort";

/**
 * A statement that fails the whole batch (D1 runs a batch as one transaction, so every earlier write
 * is rolled back) unless `landed` is true when it runs. It needs no table: a JSON path that is not a
 * path is an SQL error naming the tag ("bad JSON path: 'orrn_batch_abort'"). Catch with
 * {@link isBatchAbort}. Council round 1 (A1, A2): a claim that lost a race must undo the batch.
 */
export function abortBatchUnless(db: OrrnDb, landed: SQL): SqliteBatchItem {
  return db.run(
    sql`select json_extract('{}', case when ${landed} then '$' else ${sql.raw(`'${BATCH_ABORT_TAG}'`)} end)`,
  ) as unknown as SqliteBatchItem;
}

/** Fails the batch unless the statement right before it changed at least one row. */
export function abortBatchUnlessChanged(db: OrrnDb): SqliteBatchItem {
  return abortBatchUnless(db, sql`changes() > 0`);
}

/** True when `e` (or its cause chain) is a batch refused by {@link abortBatchUnless}. */
export function isBatchAbort(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    if ((cur instanceof Error ? cur.message : String(cur)).includes(BATCH_ABORT_TAG)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}
