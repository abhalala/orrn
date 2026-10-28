import { Hono } from "hono";
import type { Context as HonoContext } from "hono";

import { createDb } from "@orrn/db";
import {
  edgeCommandAckRequestSchema,
  edgeEnrollRequestSchema,
  edgeEventsBatchRequestSchema,
  edgePollRequestSchema,
} from "@orrn/edge-runtime";
import { env } from "@orrn/env/server";
import {
  acknowledgeEdgeCommand,
  authenticateEdgeV1Request,
  buildEdgeDesiredConfig,
  confirmEdgeCredentialRotation,
  exchangeEdgeEnrollmentToken,
  ingestEdgeEventBatch,
  pollEdgeCommands,
} from "@orrn/server/lib/edge-v1";
import {
  buildOrGetCompanySnapshotManifest,
  getSnapshotChunkForNode,
} from "@orrn/server/lib/edge-snapshots";

export const edgeV1Routes = new Hono();

function requestPathAndQuery(c: HonoContext): string {
  const url = new URL(c.req.url);
  return url.pathname + url.search;
}

edgeV1Routes.post("/api/edge/v1/enroll", async (c: HonoContext) => {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    return c.json({ code: "invalid_json", error: "Invalid JSON body" }, 400);
  }

  const parsed = edgeEnrollRequestSchema.safeParse(json);
  if (!parsed.success) {
    return c.json(
      { code: "invalid_enrollment_request", error: parsed.error.issues[0]?.message ?? "Invalid request" },
      400,
    );
  }

  const url = new URL(c.req.url);
  const apiOrigin = env.BETTER_AUTH_URL || `${url.protocol}//${url.host}`;
  const result = await exchangeEdgeEnrollmentToken(createDb(), {
    ...parsed.data,
    apiOrigin,
    masterKey: env.ORRN_MASTER_KEY,
  });

  if (!result.ok) {
    return c.json(result.body, result.status);
  }

  return c.json(result.value, 200);
});

edgeV1Routes.post("/api/edge/v1/commands/poll", async (c: HonoContext) => {
  const rawBody = new Uint8Array(await c.req.raw.arrayBuffer());
  const db = createDb();
  const auth = await authenticateEdgeV1Request(db, {
    method: "POST",
    path: requestPathAndQuery(c),
    rawBody,
    nodeIdHeader: c.req.header("X-ORRN-Node-ID"),
    authorization: c.req.header("Authorization"),
    masterKey: env.ORRN_MASTER_KEY,
    enforceReplayCache: true,
  });

  if (!auth.ok) {
    return c.json(auth.body, auth.status);
  }

  let json: unknown = {};
  if (rawBody.byteLength > 0) {
    try {
      json = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return c.json({ code: "invalid_json", error: "Invalid JSON body" }, 400);
    }
  }

  const parsed = edgePollRequestSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ code: "invalid_poll_request", error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  }

  const response = await pollEdgeCommands(db, {
    deploymentId: auth.node.id,
    companyId: auth.node.companyId,
    limit: parsed.data.limit,
    appliedConfigVersion: parsed.data.appliedConfigVersion,
    printers: parsed.data.printers,
  });

  return c.json(response, 200);
});

edgeV1Routes.post("/api/edge/v1/commands/ack", async (c: HonoContext) => {
  const rawBody = new Uint8Array(await c.req.raw.arrayBuffer());
  const db = createDb();
  const auth = await authenticateEdgeV1Request(db, {
    method: "POST",
    path: requestPathAndQuery(c),
    rawBody,
    nodeIdHeader: c.req.header("X-ORRN-Node-ID"),
    authorization: c.req.header("Authorization"),
    masterKey: env.ORRN_MASTER_KEY,
    enforceReplayCache: true,
  });

  if (!auth.ok) {
    return c.json(auth.body, auth.status);
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return c.json({ code: "invalid_json", error: "Invalid JSON body" }, 400);
  }

  const parsed = edgeCommandAckRequestSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ code: "invalid_ack_request", error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  }

  try {
    const res = await acknowledgeEdgeCommand(db, {
      ...parsed.data,
      deploymentId: auth.node.id,
      companyId: auth.node.companyId,
    });
    return c.json(res, 200);
  } catch (err) {
    return c.json(
      { code: "command_not_found", error: err instanceof Error ? err.message : "Command not found" },
      404,
    );
  }
});

edgeV1Routes.post("/api/edge/v1/events", async (c: HonoContext) => {
  const rawBody = new Uint8Array(await c.req.raw.arrayBuffer());
  const db = createDb();
  const auth = await authenticateEdgeV1Request(db, {
    method: "POST",
    path: requestPathAndQuery(c),
    rawBody,
    nodeIdHeader: c.req.header("X-ORRN-Node-ID"),
    authorization: c.req.header("Authorization"),
    masterKey: env.ORRN_MASTER_KEY,
    enforceReplayCache: true,
  });

  if (!auth.ok) {
    return c.json(auth.body, auth.status);
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return c.json({ code: "invalid_json", error: "Invalid JSON body" }, 400);
  }

  const parsed = edgeEventsBatchRequestSchema.safeParse(json);
  if (!parsed.success) {
    return c.json({ code: "invalid_events_batch", error: parsed.error.issues[0]?.message ?? "Invalid request" }, 400);
  }

  const res = await ingestEdgeEventBatch(db, {
    deploymentId: auth.node.id,
    companyId: auth.node.companyId,
    events: parsed.data.events,
  });

  return c.json(res, 200);
});

edgeV1Routes.get("/api/edge/v1/config", async (c: HonoContext) => {
  const db = createDb();
  const auth = await authenticateEdgeV1Request(db, {
    method: "GET",
    path: requestPathAndQuery(c),
    rawBody: null,
    nodeIdHeader: c.req.header("X-ORRN-Node-ID"),
    authorization: c.req.header("Authorization"),
    masterKey: env.ORRN_MASTER_KEY,
    enforceReplayCache: true,
  });

  if (!auth.ok) {
    return c.json(auth.body, auth.status);
  }

  const config = await buildEdgeDesiredConfig(db, {
    deploymentId: auth.node.id,
    companyId: auth.node.companyId,
    masterKey: env.ORRN_MASTER_KEY,
  });

  return c.json(config, 200);
});

edgeV1Routes.post("/api/edge/v1/credentials/confirm", async (c: HonoContext) => {
  const rawBody = new Uint8Array(await c.req.raw.arrayBuffer());
  const db = createDb();
  const res = await confirmEdgeCredentialRotation(db, {
    rawBody,
    path: requestPathAndQuery(c),
    nodeIdHeader: c.req.header("X-ORRN-Node-ID"),
    authorization: c.req.header("Authorization"),
    masterKey: env.ORRN_MASTER_KEY,
  });

  return c.json(res.body, res.status);
});

edgeV1Routes.get("/api/edge/v1/snapshots/manifest", async (c: HonoContext) => {
  const db = createDb();
  const auth = await authenticateEdgeV1Request(db, {
    method: "GET",
    path: requestPathAndQuery(c),
    rawBody: null,
    nodeIdHeader: c.req.header("X-ORRN-Node-ID"),
    authorization: c.req.header("Authorization"),
    masterKey: env.ORRN_MASTER_KEY,
    enforceReplayCache: true,
  });

  if (!auth.ok) {
    return c.json(auth.body, auth.status);
  }

  const manifest = await buildOrGetCompanySnapshotManifest(db, {
    companyId: auth.node.companyId,
  });

  return c.json(manifest, 200);
});

edgeV1Routes.get("/api/edge/v1/snapshots/:snapshotId/chunks/:sequence", async (c: HonoContext) => {
  const db = createDb();
  const auth = await authenticateEdgeV1Request(db, {
    method: "GET",
    path: requestPathAndQuery(c),
    rawBody: null,
    nodeIdHeader: c.req.header("X-ORRN-Node-ID"),
    authorization: c.req.header("Authorization"),
    masterKey: env.ORRN_MASTER_KEY,
    enforceReplayCache: true,
  });

  if (!auth.ok) {
    return c.json(auth.body, auth.status);
  }

  const snapshotId = c.req.param("snapshotId") ?? "";
  const sequence = Number(c.req.param("sequence"));
  if (!snapshotId || !Number.isInteger(sequence) || sequence < 0) {
    return c.json({ code: "invalid_chunk_params", error: "Invalid snapshotId or sequence" }, 400);
  }

  const res = await getSnapshotChunkForNode(db, {
    companyId: auth.node.companyId,
    snapshotId,
    sequence,
  });

  return c.json(res.body, res.status);
});
