/**
 * Node-signed collector requests (W4-COLLECTORS). Every collector endpoint is called by an
 * orrn-spool node, never by a person: the body carries `instance_id`, the request carries
 * `Authorization: Bearer v1:<ts>:<hmac>` signed with that node's shared secret over
 * `METHOD|path|ts|sha256(body)` (the same token the heartbeat and ORRN's SpoolClient use; vectors
 * in test/fixtures/spool-hmac-vectors.json). There is no unsigned fallback and no session path:
 * a member of the company, whatever the role, cannot post frames or files.
 */
import { eq } from "drizzle-orm";

import type { OrrnDb } from "@orrn/db";
import { spoolDeployment } from "@orrn/db/schema/spool";
import { unwrapSecret } from "@orrn/crypto";

import { ingestPressFrames, PRESS_FRAMES_PATH, pressFramesBodySchema } from "./pressCollector";
import { ingestSpectroFile, SPECTRO_INGEST_PATH, spectroIngestSchema } from "./spectroInbox";
import { SPOOL_TOKEN_MAX_SKEW_MS, verifySpoolToken } from "./spool-crypto";

export type CollectorNode = { id: string; companyId: string; instanceId: string };

export type NodeAuthResult =
  | { ok: true; node: CollectorNode; json: Record<string, unknown> }
  | { ok: false; status: 400 | 401 | 403; body: { error: string } };

/** Largest JSON body a collector may post (100 frames is ~40 KB; a spectro begin is < 4 KB). */
export const COLLECTOR_MAX_BODY_BYTES = 256 * 1024;

export async function authenticateCollectorNode(
  db: OrrnDb,
  input: { method: string; path: string; rawBody: Uint8Array; authorization: string | null | undefined; masterKey: string; nowMs?: number },
): Promise<NodeAuthResult> {
  const nowMs = input.nowMs ?? Date.now();
  if (input.rawBody.byteLength > COLLECTOR_MAX_BODY_BYTES) return { ok: false, status: 400, body: { error: "Body too large" } };
  const auth = input.authorization ?? "";
  if (!auth.startsWith("Bearer v1:")) return { ok: false, status: 401, body: { error: "Node signature required" } };
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(input.rawBody));
  } catch {
    return { ok: false, status: 400, body: { error: "Invalid JSON payload" } };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, status: 400, body: { error: "Invalid JSON payload" } };
  const instanceId = (json as { instance_id?: unknown }).instance_id;
  if (typeof instanceId !== "string" || instanceId.length === 0 || instanceId.length > 128) {
    return { ok: false, status: 400, body: { error: "Missing instance_id" } };
  }
  const deployment = await db
    .select({
      id: spoolDeployment.id,
      companyId: spoolDeployment.companyId,
      instanceId: spoolDeployment.instanceId,
      status: spoolDeployment.status,
      sharedSecretWrapped: spoolDeployment.sharedSecretWrapped,
    })
    .from(spoolDeployment)
    .where(eq(spoolDeployment.instanceId, instanceId))
    .get();
  if (!deployment) return { ok: false, status: 403, body: { error: "Unknown instance" } };
  if (deployment.status === "revoked") return { ok: false, status: 403, body: { error: "Deployment revoked" } };
  const secret = await unwrapSecret(deployment.sharedSecretWrapped, input.masterKey);
  const token = auth.slice("Bearer ".length);
  const valid = await verifySpoolToken(input.method, input.path, input.rawBody, token, secret, SPOOL_TOKEN_MAX_SKEW_MS, nowMs);
  if (!valid) return { ok: false, status: 403, body: { error: "Invalid signature" } };
  return {
    ok: true,
    node: { id: deployment.id, companyId: deployment.companyId, instanceId: deployment.instanceId },
    json: json as Record<string, unknown>,
  };
}

export type CollectorHttpResult = { status: 200 | 400 | 401 | 403 | 503; body: Record<string, unknown> };

/** `POST /collector/press/frames`: node auth, body check, ingest. The Hono route is a thin shell. */
export async function handlePressFramesRequest(
  db: OrrnDb,
  input: { rawBody: Uint8Array; authorization: string | null | undefined; masterKey: string; nowMs?: number },
): Promise<CollectorHttpResult> {
  const auth = await authenticateCollectorNode(db, { method: "POST", path: PRESS_FRAMES_PATH, ...input });
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const parsed = pressFramesBodySchema.safeParse(auth.json);
  if (!parsed.success) return { status: 400, body: { error: "Invalid frames", issues: parsed.error.issues.slice(0, 5) } };
  return { status: 200, body: await ingestPressFrames(db, auth.node, parsed.data.frames, input.nowMs) };
}

/** `POST /collector/spectro/ingest` (`foundry.spectro.ingest`): node auth, body check, record + upload link. */
export async function handleSpectroIngestRequest(
  db: OrrnDb,
  input: { rawBody: Uint8Array; authorization: string | null | undefined; masterKey: string; origin: string; storageReady: boolean; nowMs?: number },
): Promise<CollectorHttpResult> {
  const { origin, storageReady, ...rest } = input;
  const auth = await authenticateCollectorNode(db, { method: "POST", path: SPECTRO_INGEST_PATH, ...rest });
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const parsed = spectroIngestSchema.safeParse(auth.json);
  if (!parsed.success) return { status: 400, body: { error: "Invalid spectro file", issues: parsed.error.issues.slice(0, 5) } };
  if (!storageReady || !input.masterKey) return { status: 503, body: { error: "File storage is not set up" } };
  return { status: 200, body: await ingestSpectroFile(db, auth.node, parsed.data, { origin, masterKey: input.masterKey, nowMs: input.nowMs }) };
}
