/**
 * Reopen blockers for a logged press run (`press.runs.reopen`). Another module registers a check
 * that answers a reason (the sentence the station shows) when the run must not be reopened, or
 * null. The reopen request refuses with CONFLICT and the first reason found.
 *
 * Wave 3 ageing registers one here: a non-void `ageing_row` that points at the run (its pieces
 * went into a basket). The press lane registers nothing itself.
 */
import type { OrrnDb } from "../atomic";

export type ReopenBlocker = (db: OrrnDb, companyId: string, runId: string) => Promise<string | null>;

const blockers: ReopenBlocker[] = [];

/** Register a check; returns a function that removes it (tests). Registering the same function twice is a no-op. */
export function registerReopenBlocker(fn: ReopenBlocker): () => void {
  if (!blockers.includes(fn)) blockers.push(fn);
  return () => {
    const i = blockers.indexOf(fn);
    if (i >= 0) blockers.splice(i, 1);
  };
}

/** The first reason a registered blocker gives for not reopening `runId`, or null. */
export async function reopenBlockers(db: OrrnDb, companyId: string, runId: string): Promise<string | null> {
  for (const fn of blockers) {
    const reason = await fn(db, companyId, runId);
    if (reason) return reason;
  }
  return null;
}
