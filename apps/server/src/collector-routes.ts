/**
 * Hardware collector routes (W4-COLLECTORS). Called by orrn-spool nodes only, never by a browser:
 * every POST is node-signed (`Bearer v1:` over METHOD|path|ts|sha256(body), the node's shared
 * secret); the spectro PUT carries a signed ticket instead. Logic lives in @orrn/server/lib so the
 * Miniflare tests drive the same code. Contracts: orrn-spool docs/press-collector.md and
 * docs/spectro-watcher.md.
 */
import { createDb } from "@orrn/db";
import { env } from "@orrn/env/server";
import { Hono } from "hono";

import { AGEING_READINGS_PATH, handleAgeingReadingsRequest } from "@orrn/server/lib/ageingCollector";
import { handlePressFramesRequest, handleSpectroIngestRequest, readCollectorBody } from "@orrn/server/lib/collectorNode";
import { PRESS_FRAMES_PATH } from "@orrn/server/lib/pressCollector";
import { handleSpectroUpload, SPECTRO_INGEST_PATH, SPECTRO_UPLOAD_PATH } from "@orrn/server/lib/spectroInbox";

const collectorRoutes = new Hono();
// Spectro files share the die-files bucket (prefix `{companyId}/spectro/`); no new binding.
const bucket = () => (env as unknown as { DIE_FILES?: R2Bucket }).DIE_FILES;

// m-8: bodies are read bounded (COLLECTOR_MAX_BODY_BYTES), never whole before the size check.
collectorRoutes.post(PRESS_FRAMES_PATH, async (c) => {
  const read = await readCollectorBody(c.req.raw);
  if (!read.ok) return c.json({ error: "Body too large" }, read.status);
  const result = await handlePressFramesRequest(createDb(), {
    rawBody: read.body,
    authorization: c.req.header("Authorization"),
    masterKey: env.ORRN_MASTER_KEY,
  });
  return c.json(result.body, result.status);
});

collectorRoutes.post(SPECTRO_INGEST_PATH, async (c) => {
  const read = await readCollectorBody(c.req.raw);
  if (!read.ok) return c.json({ error: "Body too large" }, read.status);
  const result = await handleSpectroIngestRequest(createDb(), {
    rawBody: read.body,
    authorization: c.req.header("Authorization"),
    masterKey: env.ORRN_MASTER_KEY,
    origin: new URL(c.req.url).origin,
    storageReady: !!bucket(),
  });
  return c.json(result.body, result.status);
});

// FP-AG-17 (W3-AG-S): oven temperature readings from a node, marked `telemetry`.
collectorRoutes.post(AGEING_READINGS_PATH, async (c) => {
  const read = await readCollectorBody(c.req.raw);
  if (!read.ok) return c.json({ error: "Body too large" }, read.status);
  const result = await handleAgeingReadingsRequest(createDb(), {
    rawBody: read.body,
    authorization: c.req.header("Authorization"),
    masterKey: env.ORRN_MASTER_KEY,
  });
  return c.json(result.body, result.status);
});

collectorRoutes.put(SPECTRO_UPLOAD_PATH, (c) => handleSpectroUpload(createDb(), c.req.raw, { bucket: bucket(), masterKey: env.ORRN_MASTER_KEY }));

export { collectorRoutes };
