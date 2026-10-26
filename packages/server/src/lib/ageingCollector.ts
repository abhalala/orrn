/**
 * FP-AG-17 collector route (W3-AG-S): `POST /collector/ageing/readings`, node-signed like the press
 * frames (`Bearer v1:` over METHOD|path|ts|sha256(body), the node's shared secret). The body is
 * `{ instance_id, batch_id, device_id?, readings: [{ at, temp_c_x10 }] }`; readings are `telemetry`
 * rows of the node's own company only (a batch of another company is "not found"). Same insert as the
 * simulator (`ingestAgeingReadings`): gated per reading, a replay of (batch, source, device, at) adds
 * nothing. Typed readings stay valid beside them.
 */
import { z } from "zod";

import { AGEING_READINGS_MAX, AGEING_TEMP_MAX_X10, AGEING_TEMP_MIN_X10, isModuleOn } from "@orrn/domain";

import { ingestAgeingReadings } from "./ageingServer";
import type { OrrnDb } from "./atomic";
import { authenticateCollectorNode, type CollectorHttpResult } from "./collectorNode";
import { companyModules, MODULE_OFF_MESSAGE } from "./moduleGate";
import { nextCompanySeq } from "./sequence";

export const AGEING_READINGS_PATH = "/collector/ageing/readings";

export const ageingReadingsBodySchema = z.object({
  instance_id: z.string().min(1).max(128),
  batch_id: z.string().trim().min(1).max(64),
  device_id: z.string().trim().max(64).default(""),
  readings: z
    .array(z.object({ at: z.number().int().min(0), temp_c_x10: z.number().int().min(AGEING_TEMP_MIN_X10).max(AGEING_TEMP_MAX_X10) }))
    .min(1)
    .max(AGEING_READINGS_MAX),
});

export async function handleAgeingReadingsRequest(
  db: OrrnDb,
  input: { rawBody: Uint8Array; authorization: string | null | undefined; masterKey: string; nowMs?: number },
): Promise<CollectorHttpResult> {
  const auth = await authenticateCollectorNode(db, { method: "POST", path: AGEING_READINGS_PATH, ...input });
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const parsed = ageingReadingsBodySchema.safeParse(auth.json);
  if (!parsed.success) return { status: 400, body: { error: "Invalid readings", issues: parsed.error.issues.slice(0, 5) } };
  const nowMs = input.nowMs ?? Date.now();
  // Review m9: the ageing module off for the node's company refuses the feed, as the tRPC mutations do.
  if (!isModuleOn(await companyModules(db, auth.node.companyId), "ageing")) return { status: 403, body: { error: MODULE_OFF_MESSAGE } };
  try {
    const seq = await nextCompanySeq({ db }, auth.node.companyId);
    const result = await ingestAgeingReadings(
      db,
      auth.node.companyId,
      {
        batchId: parsed.data.batch_id,
        source: "telemetry",
        deviceId: parsed.data.device_id,
        readings: parsed.data.readings.map((r) => ({ at: r.at, tempCX10: r.temp_c_x10 })),
      },
      { userId: null, nowMs, seq },
    );
    return { status: 200, body: { ok: true, inserted: result.inserted, refused: result.refused } };
  } catch (e) {
    const cause = (e as { cause?: { ageingCode?: string } }).cause;
    if (cause?.ageingCode === "batch_not_found") return { status: 400, body: { error: "Unknown batch" } };
    throw e;
  }
}
