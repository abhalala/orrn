/**
 * The edge face of plant devices (XE DEVICES, row 95): `POST /api/edge/v1/devices/readings`,
 * `POST /api/edge/v1/devices/heartbeat`, `GET /api/edge/v1/devices/config`. The Hono routes in
 * apps/server/src/edge-v1-routes.ts read the body bounded (`readCollectorBody`, before any auth) and load
 * this module with `await import()`, so none of it evaluates at Worker start.
 *
 * Each call is signed by the edge node (edge v1: `X-ORRN-Node-ID` + `Bearer v1:`, replay cache on) and,
 * for readings and heartbeats, also names the device with its own token. The `devices` module must be on.
 */
import type { OrrnDb } from "@orrn/db";
import { DEVICE_CONFIG_PATH, DEVICE_HEARTBEAT_PATH, DEVICE_READINGS_PATH, deviceHeartbeatRequestSchema, deviceReadingsRequestSchema } from "@orrn/edge-runtime/devices";

import { authenticateDevice, deviceConfigForNode, devicesOn, ingestDeviceReadings, recordDeviceHeartbeat } from "./devices";
import { authenticateEdgeV1Request } from "./edge-v1";

export type DeviceEdgeInput = {
  rawBody: Uint8Array | null;
  /** Path and query as signed (`/api/edge/v1/devices/readings`). */
  path: string;
  nodeIdHeader: string | null | undefined;
  authorization: string | null | undefined;
  deviceIdHeader?: string | null;
  deviceTokenHeader?: string | null;
  masterKey: string;
  nowMs?: number;
};

export type DeviceEdgeResult = { status: 200 | 400 | 401 | 403; body: Record<string, unknown> };

function parseJson(raw: Uint8Array | null): { ok: true; json: unknown } | { ok: false } {
  try {
    return { ok: true, json: JSON.parse(new TextDecoder().decode(raw ?? new Uint8Array())) };
  } catch {
    return { ok: false };
  }
}

async function nodeAndDevice(db: OrrnDb, method: "POST", input: DeviceEdgeInput) {
  const auth = await authenticateEdgeV1Request(db, {
    method,
    path: input.path,
    rawBody: input.rawBody,
    nodeIdHeader: input.nodeIdHeader,
    authorization: input.authorization,
    masterKey: input.masterKey,
    nowMs: input.nowMs,
    enforceReplayCache: true,
  });
  if (!auth.ok) return { fail: { status: auth.status, body: auth.body } as DeviceEdgeResult };
  const dev = await authenticateDevice(db, auth.node, { deviceId: input.deviceIdHeader, token: input.deviceTokenHeader });
  if (!dev.ok) return { fail: { status: dev.status, body: dev.body } as DeviceEdgeResult };
  return { device: dev.device };
}

export async function handleDeviceReadings(db: OrrnDb, input: DeviceEdgeInput): Promise<DeviceEdgeResult> {
  const got = await nodeAndDevice(db, "POST", { ...input, path: input.path || DEVICE_READINGS_PATH });
  if ("fail" in got) return got.fail!;
  const json = parseJson(input.rawBody);
  if (!json.ok) return { status: 400, body: { code: "invalid_json", error: "Invalid JSON body" } };
  const parsed = deviceReadingsRequestSchema.safeParse(json.json);
  if (!parsed.success) return { status: 400, body: { code: "invalid_readings", error: parsed.error.issues[0]?.message ?? "Invalid request" } };
  return { status: 200, body: await ingestDeviceReadings(db, got.device, parsed.data, input.nowMs) };
}

export async function handleDeviceHeartbeat(db: OrrnDb, input: DeviceEdgeInput): Promise<DeviceEdgeResult> {
  const got = await nodeAndDevice(db, "POST", { ...input, path: input.path || DEVICE_HEARTBEAT_PATH });
  if ("fail" in got) return got.fail!;
  const json = parseJson(input.rawBody);
  if (!json.ok) return { status: 400, body: { code: "invalid_json", error: "Invalid JSON body" } };
  const parsed = deviceHeartbeatRequestSchema.safeParse(json.json);
  if (!parsed.success) return { status: 400, body: { code: "invalid_heartbeat", error: parsed.error.issues[0]?.message ?? "Invalid request" } };
  return { status: 200, body: await recordDeviceHeartbeat(db, got.device, parsed.data, input.nowMs) };
}

/** The node's enrolled devices for its local cache (on-prem read-cache sync, row 84). Node signature only. */
export async function handleDeviceConfig(db: OrrnDb, input: DeviceEdgeInput): Promise<DeviceEdgeResult> {
  const auth = await authenticateEdgeV1Request(db, {
    method: "GET",
    path: input.path || DEVICE_CONFIG_PATH,
    rawBody: null,
    nodeIdHeader: input.nodeIdHeader,
    authorization: input.authorization,
    masterKey: input.masterKey,
    nowMs: input.nowMs,
    enforceReplayCache: true,
  });
  if (!auth.ok) return { status: auth.status, body: auth.body };
  if (!(await devicesOn(db, auth.node.companyId)).devices) return { status: 403, body: { code: "module_off", error: "That module is not on for this plant" } };
  return { status: 200, body: await deviceConfigForNode(db, auth.node, input.nowMs) };
}
