/**
 * The worker's daily cron (`apps/server` `scheduled`, alchemy.run.ts `crons`): the per-company backup to
 * R2 (FP-PF-12), the orphan die-file purge (BACKLOG 18) and the press collector frame retention purge
 * (W4-COLLECTORS m-6). Each step runs on its own: one failing never stops the others.
 *
 * R2 is optional (LEDGER D10/D36): a stage deployed without R2 has no BACKUPS / DIE_FILES binding. Then
 * the backup step and the die-file purge are skipped with a log line ("not configured") and write
 * nothing; the collector purge (D1 only) still runs.
 */
import { env } from "@orrn/env/server";

import type { OrrnDb } from "./atomic";
import { runScheduledBackups } from "./backup";
import { purgeOrphanDieFiles } from "./dieFilesPurge";
import { purgeCollectorFrames } from "./pressCollector";

type Step<T> = { ok: true; value: T } | { ok: false; skipped: "not configured" } | { ok: false; error: string };
type Log = { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

function bound(name: "BACKUPS" | "DIE_FILES"): boolean {
  return !!(env as unknown as Record<string, unknown>)[name];
}

async function step<T>(label: string, log: Log, run: () => Promise<T>): Promise<Step<T>> {
  try {
    const value = await run();
    log.log(label, JSON.stringify(value));
    return { ok: true, value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(`${label} failed`, message);
    return { ok: false, error: message };
  }
}

function skipped(label: string, binding: string, log: Log): { ok: false; skipped: "not configured" } {
  log.log(`${label} skipped: no ${binding} binding (R2 not configured on this stage)`);
  return { ok: false, skipped: "not configured" };
}

export async function runDailyCron(db: OrrnDb, at: Date, log: Log = console) {
  const [backups, dieFiles, collectorFrames] = await Promise.all([
    bound("BACKUPS") ? step("backups", log, () => runScheduledBackups(db, at)) : skipped("backups", "BACKUPS", log),
    bound("DIE_FILES")
      ? step("orphan die files purged", log, () => purgeOrphanDieFiles(db, { nowMs: at.getTime() }))
      : skipped("orphan die file purge", "DIE_FILES", log),
    step("collector frames purged", log, () => purgeCollectorFrames(db, at.getTime())),
  ]);
  return { backups, dieFiles, collectorFrames };
}
