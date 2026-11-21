/**
 * Expired `verification` rows (passkey challenges, password-reset and magic-link tokens), removed by
 * the daily cron (`dailyCron.ts`). The public `/passkey/generate-authenticate-options` writes one row
 * per anonymous call and nothing else removes them once they expire (plan 2026-11-18, Task 3).
 *
 * Bounded per run: batches of `VERIFICATION_PURGE_BATCH` through a LIMIT subquery (no bound id
 * list, AGENTS.md D1 limits), at most `maxBatches` per run; whatever is left goes the next night.
 * Only rows whose `expires_at` is before `at` are touched, so a live link or challenge stays.
 */
import { verification } from "@orrn/db/schema/auth";
import { inArray, lt } from "drizzle-orm";

import type { OrrnDb } from "./atomic";

export const VERIFICATION_PURGE_BATCH = 500;
export const VERIFICATION_PURGE_MAX_BATCHES = 20;

export async function purgeExpiredVerifications(
  db: OrrnDb,
  at: Date,
  opts: { maxBatches?: number } = {},
): Promise<{ removed: number; capped: boolean }> {
  const maxBatches = opts.maxBatches ?? VERIFICATION_PURGE_MAX_BATCHES;
  let removed = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const victims = db.select({ id: verification.id }).from(verification).where(lt(verification.expiresAt, at)).limit(VERIFICATION_PURGE_BATCH);
    const gone = await db.delete(verification).where(inArray(verification.id, victims)).returning({ id: verification.id });
    removed += gone.length;
    if (gone.length < VERIFICATION_PURGE_BATCH) return { removed, capped: false };
  }
  return { removed, capped: true };
}
