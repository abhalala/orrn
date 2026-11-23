/**
 * XE PLATFORM row 83: start a delivery of one plant's due webhooks after an event (`waitUntil`, once the answer has
 * gone). The cron drains every plant as a backstop. The resolver is swappable so tests never touch the network.
 */
import { env } from "@orrn/env/server";

import { dohResolver, type Resolver } from "./ssrf";

let override: Resolver | null = null;
export function setWebhookResolverForTests(r: Resolver | null): void {
  override = r;
}
export const currentResolver = (): Resolver => override ?? dohResolver();

export function masterKeyOrNull(): string | null {
  return (env as unknown as { ORRN_MASTER_KEY?: string }).ORRN_MASTER_KEY || null;
}

export function scheduleDrain(ctx: { db: unknown; companyId: string | null; waitUntil?: (job: Promise<unknown>) => void }): void {
  const masterKey = masterKeyOrNull();
  if (!ctx.waitUntil || !masterKey || !ctx.companyId) return;
  const companyId = ctx.companyId;
  ctx.waitUntil(
    import("./deliver")
      .then(({ drainWebhooks }) => drainWebhooks(ctx.db as never, { nowMs: Date.now(), masterKey, resolve: currentResolver(), fetch, companyId, limit: 10 }))
      .catch((e) => console.error("webhook drain failed", e instanceof Error ? e.name : "unknown")),
  );
}
