/**
 * After an "unsure" save (writeFailureKind, lib/request-timeout.ts) the pack
 * screen re-reads the die's latest sessions before it offers Save again:
 * `bundle.createReceipt` takes no request id, so a blind retry would pack the
 * same bundles twice (ruling T29).
 */

/** How far the server clock may sit behind the phone's. */
const CLOCK_SKEW_MS = 60_000;

export type SessionRow = { id: string; dieId: string; bundleCount: number | string; createdAt: string | number | Date };

/** The session that landed: same die and bundle count, created since the save started. */
export function findLandedSession<T extends SessionRow>(
  rows: readonly T[],
  save: { dieId: string; bundleCount: number; startedAt: number },
): T | null {
  for (const row of rows) {
    const created = new Date(row.createdAt).getTime();
    if (row.dieId !== save.dieId) continue;
    if (Number(row.bundleCount) !== save.bundleCount) continue;
    if (!(created >= save.startedAt - CLOCK_SKEW_MS)) continue;
    return row;
  }
  return null;
}
