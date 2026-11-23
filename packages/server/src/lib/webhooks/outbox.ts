/**
 * XE PLATFORM row 83: the webhook outbox write. One INSERT ... SELECT that goes into the SAME batch as the event, so
 * the delivery row exists exactly when the event's rows do. It writes one row per active endpoint of the plant that
 * subscribed to the event, and only while the plant has the opt-in `api` module; for every other plant it matches no
 * row (a single extra statement in an existing batch, no extra round trip).
 *
 * Keep payloads thin: ids, numbers, status and dates. Never a rate or an amount (rates leave orrn only through the
 * API with `prices.read`).
 */
import { webhookDelivery, webhookEndpoint } from "@orrn/db/schema";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import type { WebhookEventKey } from "@orrn/domain";

import type { OrrnDb } from "../atomic";

export type WebhookPayload = Record<string, string | number | boolean | null>;

/**
 * `onlyIf`: an extra condition, for a batch whose main write has no abort (the row is written only if it landed).
 */
export function webhookOutboxStatement(
  db: OrrnDb,
  companyId: string,
  event: WebhookEventKey,
  data: WebhookPayload,
  onlyIf?: SQL,
): BatchItem<"sqlite"> {
  const body = JSON.stringify({ event, data });
  const nowMs = sql`cast(unixepoch('subsecond') * 1000 as integer)`;
  // Every column named, in table order (insert-select rule).
  const rows = db
    .select({
      id: sql<string>`lower(hex(randomblob(16)))`.as("id"),
      companyId: webhookEndpoint.companyId,
      endpointId: sql<string>`${webhookEndpoint.id}`.as("endpoint_id"),
      event: sql<string>`${event}`.as("event"),
      payload: sql<string>`${body}`.as("payload"),
      status: sql<string>`'pending'`.as("status"),
      attempts: sql<number>`0`.as("attempts"),
      nextAttemptAt: sql<number>`${nowMs}`.as("next_attempt_at"),
      claimedUntil: sql<null>`null`.as("claimed_until"),
      lastStatus: sql<null>`null`.as("last_status"),
      lastError: sql<null>`null`.as("last_error"),
      deliveredAt: sql<null>`null`.as("delivered_at"),
      createdAt: sql<number>`${nowMs}`.as("created_at"),
    })
    .from(webhookEndpoint)
    .where(
      and(
        eq(webhookEndpoint.companyId, companyId),
        eq(webhookEndpoint.active, true),
        sql`exists (select 1 from json_each(${webhookEndpoint.events}) ev where ev.value = ${event})`,
        sql`exists (select 1 from "company" c, json_each(coalesce(c."modules", '[]')) m where c."id" = ${companyId} and lower(trim(m.value)) = 'api')`,
        onlyIf,
      ),
    );
  return db.insert(webhookDelivery).select(rows as never) as unknown as BatchItem<"sqlite">;
}
