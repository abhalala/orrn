/**
 * The worker's daily cron (`apps/server` `scheduled`, alchemy.run.ts `crons`): the per-company backup to
 * R2 (FP-PF-12), the orphan die-file purge (BACKLOG 18), the press collector frame retention purge
 * (W4-COLLECTORS m-6) and the removal of expired `verification` rows (passkey challenges and old auth
 * tokens, plan 2026-11-18) and the sweep of unfinished import uploads (`sweepUnfinishedUploads`, fix round
 * 2026-11-20). Each step runs on its own: one failing never stops the others.
 *
 * R2 is optional (LEDGER D10/D36): a stage deployed without R2 has no BACKUPS / DIE_FILES binding. Then
 * the backup step and the die-file purge are skipped with a log line ("not configured") and write
 * nothing; the collector purge and the verification purge (D1 only) still run.
 */
import { env } from "@orrn/env/server";

import type { OrrnDb } from "./atomic";
import { runScheduledBackups } from "./backup";
import { sweepUnfinishedUploads } from "./ingest/upload-parts";
import { purgeOrphanDieFiles } from "./dieFilesPurge";
import { purgeCollectorFrames } from "./pressCollector";
import { purgeExpiredVerifications } from "./verificationPurge";

type Step<T> = { ok: true; value: T } | { ok: false; skipped: "not configured" } | { ok: false; error: string };
type Log = { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

function bound(name: "BACKUPS" | "DIE_FILES" | "INGEST_VAULT"): boolean {
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
  const [backups, dieFiles, collectorFrames, verifications, unfinishedUploads] = await Promise.all([
    bound("BACKUPS") ? step("backups", log, () => runScheduledBackups(db, at)) : skipped("backups", "BACKUPS", log),
    bound("DIE_FILES")
      ? step("orphan die files purged", log, () => purgeOrphanDieFiles(db, { nowMs: at.getTime() }))
      : skipped("orphan die file purge", "DIE_FILES", log),
    step("collector frames purged", log, () => purgeCollectorFrames(db, at.getTime())),
    step("expired verifications purged", log, () => purgeExpiredVerifications(db, at)),
    bound("INGEST_VAULT")
      ? step("unfinished uploads swept", log, () => sweepUnfinishedUploads(db, env.INGEST_VAULT!, at))
      : skipped("unfinished upload sweep", "INGEST_VAULT", log),
  ]);
  return { backups, dieFiles, collectorFrames, verifications, unfinishedUploads };
}
