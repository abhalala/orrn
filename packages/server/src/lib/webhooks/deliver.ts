/**
 * XE PLATFORM row 83: deliver the webhook outbox. Run by the 5-minute cron (all plants, bounded per tick) and by
 * `waitUntil` right after an event (that plant only).
 *
 * - A row is claimed first (`claimed_until`, 2 minutes), so two drains never send it at once.
 * - Body: `{ id, event, createdAt, data }`; headers `x-orrn-event`, `x-orrn-delivery`, and `x-orrn-signature:
 *   t=<unix s>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`.
 * - 2xx = delivered. Anything else (a redirect too: never followed) is retried with backoff
 *   (`nextWebhookAttemptAt`) and marked failed once 24 h have passed since the event. A failed row is resent by hand.
 * - The URL is checked again before every send (`checkWebhookUrl`); a plant without the `api` module sends nothing.
 */
import { unwrapSecret } from "@orrn/crypto";
import { isModuleOn, nextWebhookAttemptAt, webhookSignatureHeader, webhookSigningInput } from "@orrn/domain";
import { company, webhookDelivery, webhookEndpoint } from "@orrn/db/schema";
import { and, asc, eq, isNull, lt, lte, or, sql } from "drizzle-orm";

import type { OrrnDb } from "../atomic";
import { checkWebhookUrl, type Resolver } from "./ssrf";

export const DRAIN_BATCH = 25;
const CLAIM_MS = 2 * 60_000;
const SEND_TIMEOUT_MS = 10_000;

export type DrainDeps = {
  nowMs: number;
  masterKey: string;
  resolve: Resolver;
  fetch: typeof fetch;
  /** One plant only (the `waitUntil` after an event); all plants when absent (the cron). */
  companyId?: string;
  limit?: number;
};

export type DrainResult = { delivered: number; retried: number; failed: number; skipped: number };

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

export async function drainWebhooks(db: OrrnDb, deps: DrainDeps): Promise<DrainResult> {
  const result: DrainResult = { delivered: 0, retried: 0, failed: 0, skipped: 0 };
  const at = new Date(deps.nowMs);
  const due = await db
    .select({
      id: webhookDelivery.id,
      companyId: webhookDelivery.companyId,
      endpointId: webhookDelivery.endpointId,
      event: webhookDelivery.event,
      payload: webhookDelivery.payload,
      attempts: webhookDelivery.attempts,
      createdAt: webhookDelivery.createdAt,
    })
    .from(webhookDelivery)
    .where(
      and(
        eq(webhookDelivery.status, "pending"),
        lte(webhookDelivery.nextAttemptAt, at),
        or(isNull(webhookDelivery.claimedUntil), lt(webhookDelivery.claimedUntil, at)),
        deps.companyId ? eq(webhookDelivery.companyId, deps.companyId) : undefined,
      ),
    )
    .orderBy(asc(webhookDelivery.nextAttemptAt))
    .limit(deps.limit ?? DRAIN_BATCH);

  const modulesOf = new Map<string, readonly string[]>();
  for (const row of due) {
    // Claim: only the drain whose UPDATE matched sends.
    const claimed = await db
      .update(webhookDelivery)
      .set({ claimedUntil: new Date(deps.nowMs + CLAIM_MS) })
      .where(
        and(
          eq(webhookDelivery.id, row.id),
          eq(webhookDelivery.status, "pending"),
          or(isNull(webhookDelivery.claimedUntil), lt(webhookDelivery.claimedUntil, at)),
        ),
      )
      .returning({ id: webhookDelivery.id });
    if (claimed.length === 0) {
      result.skipped += 1;
      continue;
    }

    if (!modulesOf.has(row.companyId)) {
      const c = await db.select({ modules: company.modules }).from(company).where(eq(company.id, row.companyId)).get();
      modulesOf.set(row.companyId, (c?.modules as string[] | null) ?? []);
    }
    if (!isModuleOn(modulesOf.get(row.companyId), "api")) {
      await settle(db, row.id, { status: "failed", lastError: "The plant API is off" });
      result.failed += 1;
      continue;
    }

    const endpoint = await db
      .select({ url: webhookEndpoint.url, secretWrapped: webhookEndpoint.secretWrapped, active: webhookEndpoint.active })
      .from(webhookEndpoint)
      .where(and(eq(webhookEndpoint.id, row.endpointId), eq(webhookEndpoint.companyId, row.companyId)))
      .get();
    if (!endpoint || !endpoint.active) {
      await settle(db, row.id, { status: "failed", lastError: "The webhook was removed or paused" });
      result.failed += 1;
      continue;
    }

    const attempt = row.attempts + 1;
    let outcome: { ok: boolean; status: number | null; error: string | null };
    const check = await checkWebhookUrl(endpoint.url, deps.resolve);
    if (!check.ok) {
      outcome = { ok: false, status: null, error: `URL refused: ${check.problem}` };
    } else {
      outcome = await send(endpoint.url, endpoint.secretWrapped, row, deps);
    }

    if (outcome.ok) {
      await settle(db, row.id, { status: "delivered", attempts: attempt, lastStatus: outcome.status, lastError: null, deliveredAt: at });
      result.delivered += 1;
      continue;
    }
    const next = nextWebhookAttemptAt(attempt, row.createdAt.getTime(), deps.nowMs);
    if (next === null) {
      await settle(db, row.id, { status: "failed", attempts: attempt, lastStatus: outcome.status, lastError: outcome.error });
      result.failed += 1;
    } else {
      await settle(db, row.id, { status: "pending", attempts: attempt, lastStatus: outcome.status, lastError: outcome.error, nextAttemptAt: new Date(next) });
      result.retried += 1;
    }
  }
  return result;
}

async function send(
  url: string,
  secretWrapped: string,
  row: { id: string; event: string; payload: string; createdAt: Date },
  deps: DrainDeps,
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  let secret: string;
  try {
    secret = await unwrapSecret(secretWrapped, deps.masterKey);
  } catch {
    return { ok: false, status: null, error: "The signing secret could not be read" };
  }
  const inner = JSON.parse(row.payload) as { event: string; data: unknown };
  const body = JSON.stringify({ id: row.id, event: row.event, createdAt: row.createdAt.toISOString(), data: inner.data });
  const t = Math.floor(deps.nowMs / 1000);
  const signature = await hmacHex(secret, webhookSigningInput(t, body));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await deps.fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "user-agent": "orrn-webhooks/1",
        "x-orrn-event": row.event,
        "x-orrn-delivery": row.id,
        "x-orrn-signature": webhookSignatureHeader(t, signature),
      },
      body,
    });
    // Never read a large body: drop it.
    void res.body?.cancel().catch(() => undefined);
    const ok = res.status >= 200 && res.status < 300;
    return { ok, status: res.status, error: ok ? null : res.status >= 300 && res.status < 400 ? "Redirects are not followed" : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error && e.name === "AbortError" ? "Timed out" : "Could not connect" };
  } finally {
    clearTimeout(timer);
  }
}

async function settle(
  db: OrrnDb,
  id: string,
  set: {
    status: "pending" | "delivered" | "failed";
    attempts?: number;
    lastStatus?: number | null;
    lastError?: string | null;
    deliveredAt?: Date;
    nextAttemptAt?: Date;
  },
) {
  await db
    .update(webhookDelivery)
    .set({ ...set, claimedUntil: null, lastError: set.lastError === undefined ? undefined : set.lastError?.slice(0, 300) ?? null })
    .where(eq(webhookDelivery.id, id));
}

/** Rows older than this many days that are settled are dropped by the daily cron. */
export const WEBHOOK_KEEP_DAYS = 30;
export async function purgeOldDeliveries(db: OrrnDb, nowMs: number): Promise<void> {
  await db
    .delete(webhookDelivery)
    .where(and(sql`${webhookDelivery.status} <> 'pending'`, lt(webhookDelivery.createdAt, new Date(nowMs - WEBHOOK_KEEP_DAYS * 86_400_000))));
}
