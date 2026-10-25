/**
 * Node heartbeat: orrn-spool -> ORRN `POST /webhooks/spool/activate` (alias
 * `/webhooks/edge/heartbeat`). Kept out of the Hono file so it can be tested against a real D1.
 *
 * Body: `{ instance_id, version?, scale?: { configured, simulated?, connected?, lastFrameAt },
 * collectors?: [{ kind, line?, source, configured, simulated, connected, lastFrameAt, backlog?, lastError? }] }`
 * (collectors: W4-COLLECTORS, orrn-spool docs/press-collector.md §6; stored only when signed, like scale).
 * orrn-spool signs it with the node secret (`Authorization: Bearer v1:<ts>:<hmac>`, path
 * `/webhooks/spool/activate`, ±5 min). Scale presence is stored ONLY from a signed heartbeat, so
 * the Printing screen never shows a scale on the word of an unsigned caller. An unsigned heartbeat
 * keeps the old behaviour (mark the node active, record the version). A bad signature is refused.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { OrrnDb } from "@orrn/db";
import { type CollectorPresence, spoolDeployment } from "@orrn/db/schema/spool";
import { unwrapSecret } from "@orrn/crypto";

import { SPOOL_TOKEN_MAX_SKEW_MS, verifySpoolToken } from "./spool-crypto";

export const HEARTBEAT_PATHS = ["/webhooks/spool/activate", "/webhooks/edge/heartbeat"] as const;

const heartbeatSchema = z.object({
  instance_id: z.string().min(1).max(128),
  version: z.string().min(1).max(64).optional(),
  scale: z
    .object({
      configured: z.boolean(),
      simulated: z.boolean().optional(),
      connected: z.boolean().optional(),
      lastFrameAt: z.string().datetime({ offset: true }).nullable().optional(),
    })
    .optional(),
  // Optional telemetry: checked entry by entry below, never a reason to refuse the beat (I-2).
  collectors: z.unknown().optional(),
});

/** Collector entries kept per beat; longer text is cut, not refused (I-2). */
export const HEARTBEAT_MAX_COLLECTORS = 8;
export const COLLECTOR_LAST_ERROR_MAX = 200;
const cut = (n: number) => (s: string) => s.slice(0, n);

const collectorEntrySchema = z.object({
  kind: z.enum(["press", "spectro"]),
  line: z.string().max(32).nullable().optional(),
  source: z.string().min(1).transform(cut(32)),
  configured: z.boolean(),
  simulated: z.boolean(),
  connected: z.boolean().optional(),
  lastFrameAt: z.string().datetime({ offset: true }).nullable().optional(),
  backlog: z.number().int().min(0).max(10_000_000).optional(),
  lastError: z.string().transform(cut(COLLECTOR_LAST_ERROR_MAX)).nullable().optional(),
});

/**
 * The heartbeat's `collectors`, entry by entry: a malformed entry is dropped and long text is
 * truncated, so a node with a 5 KB Windows error still shows as present (I-2). Null when the beat
 * carried no list.
 */
export function parseCollectorPresence(raw: unknown): z.infer<typeof collectorEntrySchema>[] | null {
  if (!Array.isArray(raw)) return null;
  const out: z.infer<typeof collectorEntrySchema>[] = [];
  for (const entry of raw) {
    const p = collectorEntrySchema.safeParse(entry);
    if (p.success) out.push(p.data);
    if (out.length >= HEARTBEAT_MAX_COLLECTORS) break;
  }
  return out;
}

export type HeartbeatResult = { status: 200 | 400 | 403; body: Record<string, unknown> };

export async function handleNodeHeartbeat(
  db: OrrnDb,
  input: { rawBody: Uint8Array; authorization: string | null | undefined; masterKey: string; nowMs?: number },
): Promise<HeartbeatResult> {
  const nowMs = input.nowMs ?? Date.now();
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(input.rawBody));
  } catch {
    return { status: 400, body: { error: "Invalid JSON payload" } };
  }
  const parsed = heartbeatSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { error: "Missing instance_id" } };
  const body = parsed.data;

  const deployment = await db
    .select()
    .from(spoolDeployment)
    .where(eq(spoolDeployment.instanceId, body.instance_id))
    .get();
  if (!deployment) return { status: 403, body: { error: "Unknown instance" } };
  if (deployment.status === "revoked") return { status: 403, body: { error: "Deployment revoked" } };

  let signed = false;
  const auth = input.authorization ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    const secret = await unwrapSecret(deployment.sharedSecretWrapped, input.masterKey);
    for (const path of HEARTBEAT_PATHS) {
      if (await verifySpoolToken("POST", path, input.rawBody, token, secret, SPOOL_TOKEN_MAX_SKEW_MS, nowMs)) {
        signed = true;
        break;
      }
    }
    if (!signed) return { status: 403, body: { error: "Invalid signature" } };
  }

  const scale =
    signed && body.scale
      ? {
          scaleConfigured: body.scale.configured,
          scaleSimulated: body.scale.simulated ?? false,
          scaleLastFrameAt: body.scale.lastFrameAt ? new Date(body.scale.lastFrameAt) : null,
          scaleReportedAt: new Date(nowMs),
        }
      : {};

  const presence = signed ? parseCollectorPresence(body.collectors) : null;
  const collectors: { collectors?: CollectorPresence[]; collectorsReportedAt?: Date } =
    presence
      ? {
          collectors: presence.map((c) => ({
            kind: c.kind,
            line: c.line ?? null,
            source: c.source,
            configured: c.configured,
            simulated: c.simulated,
            connected: c.connected ?? false,
            lastFrameAt: c.lastFrameAt ? new Date(c.lastFrameAt).toISOString() : null,
            backlog: c.backlog ?? 0,
            lastError: c.lastError ?? null,
          })),
          collectorsReportedAt: new Date(nowMs),
        }
      : {};

  await db
    .update(spoolDeployment)
    .set({
      status: "active",
      lastHeartbeatAt: new Date(nowMs),
      ...(body.version ? { runtimeVersion: body.version } : {}),
      ...scale,
      ...collectors,
    })
    .where(eq(spoolDeployment.id, deployment.id));

  return { status: 200, body: { status: "active", spool_domain: deployment.nodeDomain } };
}
