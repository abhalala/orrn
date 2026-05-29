import { env } from "@orrn/env/server";
import { drizzle } from "drizzle-orm/d1";

import * as schema from "./schema";

export { atomicBatch, pushChunkedInserts, type OrrnDb } from "./atomic";

/**
 * Cloudflare D1 binding used by the API worker.
 *
 * Do not use `db.transaction()` — Drizzle issues SQL `BEGIN`, which D1 rejects.
 * Use `atomicBatch()` from `@orrn/db/atomic` (re-exported by `@orrn/api/lib/atomic`).
 */
export function createDb() {
  const db = drizzle(env.DB, { schema });

  db.transaction = () => {
    throw new Error(
      "db.transaction() is not supported on Cloudflare D1. Perform reads first, then call atomicBatch().",
    );
  };

  return db;
}
