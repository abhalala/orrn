/**
 * Ageing server helpers (W3-AG-C contracts; the router and the pack draw/restore land with W3-AG-S).
 *
 * - `ageingReopenBlocker`: `press.runs.reopen` is refused while a non-void ageing row points at the run
 *   (spec §6 "Pieces"). Not registered here: `routers/ageing.ts` calls
 *   `registerReopenBlocker(ageingReopenBlocker)` at module load so every worker has it.
 * - `openBundleRows`: the bundle rows on unfinished batches, for the derived bundle ageing state that
 *   dispatch reads (`bundleAgeingState` / `dispatchAgeingRefusal` in `@orrn/domain`).
 */
import { and, eq, inArray, ne } from "drizzle-orm";

import { chunk, IN_LIST_CHUNK } from "@orrn/db/chunk";
import { AGEING_OPEN_BATCH_STATUSES, ageingBatch, ageingRow, type AgeingRowStatus } from "@orrn/db/schema/ageing";

import type { OrrnDb } from "./atomic";
import type { ReopenBlocker } from "./press/reopenBlockers";

/** The press-console sentence when a run's pieces are on an ageing batch. */
export const ageingReopenSentence = (batchNumber: string) => `Pieces of this run are on ageing batch ${batchNumber}; void that batch first`;

export const ageingReopenBlocker: ReopenBlocker = async (db, companyId, runId) => {
  const [hit] = await db
    .select({ number: ageingBatch.number })
    .from(ageingRow)
    .innerJoin(ageingBatch, and(eq(ageingBatch.id, ageingRow.batchId), eq(ageingBatch.companyId, ageingRow.companyId)))
    .where(and(eq(ageingRow.companyId, companyId), eq(ageingRow.pressRunId, runId), ne(ageingRow.status, "void"), ne(ageingBatch.status, "void")))
    .limit(1);
  return hit ? ageingReopenSentence(hit.number) : null;
};

export type OpenBundleRow = { bundleId: string; rowId: string; status: AgeingRowStatus; batchId: string; batchNumber: string };

/** Bundle rows on unfinished batches for these bundles (chunked IN lists, ≤ 100 params). */
export async function openBundleRows(db: OrrnDb, companyId: string, bundleIds: readonly string[]): Promise<Map<string, OpenBundleRow>> {
  const out = new Map<string, OpenBundleRow>();
  for (const ids of chunk([...new Set(bundleIds)], IN_LIST_CHUNK)) {
    const rows = await db
      .select({ bundleId: ageingRow.bundleId, rowId: ageingRow.id, status: ageingRow.status, batchId: ageingBatch.id, batchNumber: ageingBatch.number })
      .from(ageingRow)
      .innerJoin(ageingBatch, and(eq(ageingBatch.id, ageingRow.batchId), eq(ageingBatch.companyId, ageingRow.companyId)))
      .where(
        and(
          eq(ageingRow.companyId, companyId),
          eq(ageingRow.source, "bundle"),
          inArray(ageingRow.bundleId, ids),
          ne(ageingRow.status, "void"),
          inArray(ageingBatch.status, [...AGEING_OPEN_BATCH_STATUSES]),
        ),
      );
    for (const r of rows) if (r.bundleId) out.set(r.bundleId, { ...r, bundleId: r.bundleId });
  }
  return out;
}
