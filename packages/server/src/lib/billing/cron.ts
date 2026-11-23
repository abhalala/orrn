/**
 * XE-BILL: the 5-minute cron entry. Loads the IRN flow lazily so the Worker's cold start for ordinary
 * requests carries none of it.
 */
import type { OrrnDb } from "../atomic";

export async function runIrnCronJob(db: OrrnDb, at: number): Promise<void> {
  const [{ currentIrpAdapter }, { runIrnCron }] = await Promise.all([import("./irp"), import("./einvoiceFlow")]);
  // Runs with no relay too: an approved cancel still waiting must reach its 24 h revert (review S1).
  const adapter = currentIrpAdapter();
  try {
    const out = await runIrnCron(db, adapter, at);
    if (out.tried || out.cancelled) console.log(`irn cron: tried ${out.tried}, cancelled ${out.cancelled}`);
  } catch (e) {
    console.error("irn cron failed", e instanceof Error ? e.message : String(e));
  }
}
