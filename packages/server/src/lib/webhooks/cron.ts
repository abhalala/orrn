/**
 * XE PLATFORM row 83: the 5-minute cron step. Delivers due webhook rows of every plant (at most `DRAIN_BATCH` a
 * tick) and drops old rate counter rows. No master key on the stage: nothing is sent (logged).
 */
import { apiRate } from "@orrn/db/schema";
import { lt } from "drizzle-orm";

import type { OrrnDb } from "../atomic";
import { drainWebhooks, purgeOldDeliveries } from "./deliver";
import { currentResolver, masterKeyOrNull } from "./schedule";

export async function runWebhookCron(db: OrrnDb, nowMs: number): Promise<void> {
  try {
    await db.delete(apiRate).where(lt(apiRate.minute, Math.floor(nowMs / 60_000) - 10));
    await purgeOldDeliveries(db, nowMs);
    const masterKey = masterKeyOrNull();
    if (!masterKey) {
      console.log("webhooks: skipped, no ORRN_MASTER_KEY");
      return;
    }
    const r = await drainWebhooks(db, { nowMs, masterKey, resolve: currentResolver(), fetch });
    if (r.delivered + r.retried + r.failed > 0) console.log("webhooks", JSON.stringify(r));
  } catch (e) {
    console.error("webhook cron failed", e instanceof Error ? e.name : "unknown");
  }
}
