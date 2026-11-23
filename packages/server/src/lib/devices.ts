/**
 * Plant connections (XE parity lane DEVICES, module `devices`, opt-in). Rows 48, 40, 94, 95.
 *
 * - Device tokens: `odv_` + 32 random bytes, shown once at enrolment or rotation; only the SHA-256 and the
 *   last 4 characters are stored. A device request is signed by its edge node (edge v1) AND carries the
 *   device's token, so revoking one device stops it without touching the node or its other devices.
 * - Ingest: up to 100 readings of one device. `device_reading` is append-only and unique per plant on
 *   `dedupe_key` = push:{device}:{token version}:{epoch}:{seq}; a repeat answers `duplicate` and writes
 *   nothing. Skew is measured from the request's sent time (`deviceClock`).
 * - Auto-capture (row 94): a scanner or tensile reading whose sample code names a press run, a bundle or an
 *   ageing batch becomes a `qa_check` through the QA module's own subject and temper code
 *   (`lib/qaSubject.ts`), with `checked_by` null and the device in the values. Nothing simulated is ever
 *   captured, and nothing is captured while the `qa` module is off; such readings wait in the lab inbox.
 *
 * Loaded only from the device edge routes and the `devices` router (both lazy): nothing here runs at
 * Worker start.
 */
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import type { OrrnDb } from "@orrn/db";
import { ageingBatch, ageingTempLog } from "@orrn/db/schema/ageing";
import { pressCollectorFrame, spectroInbox } from "@orrn/db/schema/collector";
import { deviceReading, deviceReadingUse, plantDevice, type DeviceReadingRow, type PlantDeviceRow } from "@orrn/db/schema/devices";
import { bundle } from "@orrn/db/schema/inventory";
import { pressRun } from "@orrn/db/schema/press";
import { qaCheck, qaPlan, type QaCheckFlags, type QaPlanDimension } from "@orrn/db/schema/qa";
import { spoolDeployment } from "@orrn/db/schema/spool";
import { company } from "@orrn/db/schema/tenant";
import {
  deviceClock,
  deviceHealth,
  deviceMaySend,
  dimensionVerdict,
  isModuleOn,
  mechanicalVerdict,
  normaliseSampleCode,
  readDeviceSettings,
  weighbridgeNet,
  withPlanNominals,
  type DeviceHealth,
  type DeviceKind,
  type QaResult,
} from "@orrn/domain";
import type { DeviceHeartbeatRequest, DeviceReadingsRequest, DeviceReadingsResponse, DeviceReadingWire } from "@orrn/edge-runtime/devices";

import { atomicBatch, mapInChunks, type SqliteBatchItem } from "./atomic";
import { auditInsert } from "./audit";
import { isQaUnique } from "./qa";
import { ageingHardnessX10, loadSubject, temperFor } from "./qaSubject";

export const DEVICE_TOKEN_PREFIX = "odv_";
export const DEVICE_ID_HEADER = "X-ORRN-Device";
export const DEVICE_TOKEN_HEADER = "X-ORRN-Device-Token";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashDeviceToken(token: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
}

/** A fresh device token. The caller stores `hash` and `hint` and shows `token` once. */
export async function newDeviceToken(): Promise<{ token: string; hash: string; hint: string }> {
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const token = `${DEVICE_TOKEN_PREFIX}${hex(raw)}`;
  return { token, hash: await hashDeviceToken(token), hint: token.slice(-4) };
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function devicesOn(db: OrrnDb, companyId: string): Promise<{ devices: boolean; qa: boolean; settings: Record<string, unknown> }> {
  const row = await db.select({ modules: company.modules, settings: company.settings }).from(company).where(eq(company.id, companyId)).get();
  const modules = Array.isArray(row?.modules) ? row.modules : [];
  return { devices: isModuleOn(modules, "devices"), qa: isModuleOn(modules, "qa"), settings: (row?.settings as Record<string, unknown> | null) ?? {} };
}

export type DeviceAuthFail = { ok: false; status: 401 | 403; body: { code: string; error: string } };

/**
 * The device named by the headers, on this node, in this plant, not revoked, with a matching token.
 * Another node's or another plant's device is "Unknown device" (no hint that it exists).
 */
export async function authenticateDevice(
  db: OrrnDb,
  node: { id: string; companyId: string },
  headers: { deviceId: string | null | undefined; token: string | null | undefined },
): Promise<{ ok: true; device: PlantDeviceRow } | DeviceAuthFail> {
  const deviceId = (headers.deviceId ?? "").trim();
  const token = (headers.token ?? "").trim();
  if (!deviceId || !token) return { ok: false, status: 401, body: { code: "missing_device", error: "Device id and token required" } };
  const device = await db
    .select()
    .from(plantDevice)
    .where(and(eq(plantDevice.id, deviceId), eq(plantDevice.companyId, node.companyId), eq(plantDevice.deploymentId, node.id)))
    .get();
  if (!device) return { ok: false, status: 403, body: { code: "unknown_device", error: "Unknown device" } };
  if (device.revokedAt) return { ok: false, status: 403, body: { code: "device_revoked", error: "Device revoked" } };
  if (!device.tokenHash || !sameHex(await hashDeviceToken(token), device.tokenHash)) {
    return { ok: false, status: 403, body: { code: "invalid_device_token", error: "Invalid device token" } };
  }
  const on = await devicesOn(db, node.companyId);
  if (!on.devices) return { ok: false, status: 403, body: { code: "module_off", error: "That module is not on for this plant" } };
  return { ok: true, device };
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

export function pushDedupeKey(device: Pick<PlantDeviceRow, "id" | "tokenVersion">, epoch: string, seq: number): string {
  return `push:${device.id}:${device.tokenVersion}:${epoch}:${seq}`;
}

type NewReading = typeof deviceReading.$inferInsert;

/** The stored row of one wire reading (no ids, no device). Null with a code when the reading is refused. */
export function readingRow(r: DeviceReadingWire): { row: Omit<NewReading, "id" | "companyId" | "deviceId" | "source" | "dedupeKey" | "sampledAt" | "simulated"> } | { refused: string } {
  if (r.kind === "weighbridge") {
    const net = weighbridgeNet(r.grossG, r.tareG);
    if (net == null) return { refused: "tare_above_gross" };
    const vehicle = (r.vehicleNo ?? "").replace(/[\s-]+/g, "").toUpperCase();
    return { row: { kind: "weighbridge", ticketNo: r.ticketNo, vehicleNo: vehicle || null, grossG: r.grossG, tareG: r.tareG, netG: net, valuesJson: {} } };
  }
  const sampleCode = normaliseSampleCode(r.sampleCode);
  if (!sampleCode) return { refused: "no_sample_code" };
  if (r.kind === "dimension") {
    return { row: { kind: "dimension", sampleCode, valuesJson: { points: r.points.map((p) => ({ name: p.name, measuredUm: p.measuredUm, nominalUm: p.nominalUm ?? null, minusUm: p.minusUm ?? null, plusUm: p.plusUm ?? null })) } } };
  }
  const values = { tensileMpa: r.tensileMpa ?? null, yieldMpa: r.yieldMpa ?? null, elongationX10: r.elongationX10 ?? null };
  if (values.tensileMpa == null && values.yieldMpa == null && values.elongationX10 == null) return { refused: "no_values" };
  return { row: { kind: "mechanical", sampleCode, valuesJson: values } };
}

/**
 * Store a device's readings (push). Answers which seqs were accepted, already held (duplicate) or refused,
 * stamps the device's last seen, seq and skew, then captures the lab readings that name a subject.
 */
export async function ingestDeviceReadings(db: OrrnDb, device: PlantDeviceRow, req: DeviceReadingsRequest, nowMs: number = Date.now()): Promise<DeviceReadingsResponse> {
  const sentAtMs = Date.parse(req.sentAt);
  const simulated = device.simulated || req.simulated === true;
  const rejected: DeviceReadingsResponse["rejected"] = [];
  const rows: NewReading[] = [];
  const seen = new Set<number>();
  let skewMs = 0;
  for (const r of req.readings) {
    if (seen.has(r.seq)) continue;
    seen.add(r.seq);
    if (!deviceMaySend(device.kind as DeviceKind, r.kind)) {
      rejected.push({ seq: r.seq, code: "wrong_kind" });
      continue;
    }
    const clock = deviceClock({ sentAtMs, receivedAtMs: nowMs, sampledAtMs: Date.parse(r.sampledAt) });
    skewMs = clock.skewMs;
    if (clock.refused) {
      rejected.push({ seq: r.seq, code: "in_future" });
      continue;
    }
    const built = readingRow(r);
    if ("refused" in built) {
      rejected.push({ seq: r.seq, code: built.refused });
      continue;
    }
    rows.push({
      ...built.row,
      id: crypto.randomUUID(),
      companyId: device.companyId,
      deviceId: device.id,
      source: "push",
      dedupeKey: pushDedupeKey(device, req.epoch, r.seq),
      seq: r.seq,
      epoch: req.epoch,
      simulated,
      sampledAt: new Date(clock.sampledAtMs),
      receivedAt: new Date(nowMs),
      skewMs: clock.skewMs,
      timeUnconfirmed: clock.unconfirmed,
    });
  }
  const seqById = new Map(rows.map((r) => [r.id, r.seq!]));
  const maxSeq = req.readings.reduce((m, r) => Math.max(m, r.seq), -1);
  const statements: SqliteBatchItem[] = rows.map((r) => db.insert(deviceReading).values(r).onConflictDoNothing({ target: [deviceReading.companyId, deviceReading.dedupeKey] }));
  statements.push(deviceSeenUpdate(db, device, { nowMs, epoch: req.epoch, seq: maxSeq >= 0 ? maxSeq : null, skewMs: Number.isFinite(sentAtMs) ? nowMs - sentAtMs : skewMs }));
  await atomicBatch(db, statements);
  const landed = rows.length
    ? new Set(
        (await mapInChunks(rows.map((r) => r.id), (part) => db.select({ id: deviceReading.id }).from(deviceReading).where(and(eq(deviceReading.companyId, device.companyId), inArray(deviceReading.id, part))))).map(
          (r) => r.id,
        ),
      )
    : new Set<string>();
  const accepted: number[] = [];
  const duplicate: number[] = [];
  for (const r of rows) (landed.has(r.id) ? accepted : duplicate).push(seqById.get(r.id)!);

  let captured = 0;
  const lab = rows.filter((r) => landed.has(r.id) && r.kind !== "weighbridge" && !r.simulated);
  if (lab.length > 0 && (await devicesOn(db, device.companyId)).qa) {
    for (const r of lab) {
      const out = await captureLabReading(db, { companyId: device.companyId, readingId: r.id, actorId: null });
      if ("checkId" in out) captured += 1;
    }
  }
  return { accepted, duplicate, rejected, captured };
}

function deviceSeenUpdate(db: OrrnDb, device: PlantDeviceRow, o: { nowMs: number; epoch: string; seq: number | null; skewMs: number; buffered?: number; linkState?: string }): SqliteBatchItem {
  const sameEpoch = device.lastEpoch === o.epoch;
  const lastSeq = o.seq == null ? (sameEpoch ? device.lastSeq : null) : sameEpoch ? Math.max(device.lastSeq ?? -1, o.seq) : o.seq;
  return db
    .update(plantDevice)
    .set({
      lastSeenAt: new Date(o.nowMs),
      lastEpoch: o.epoch,
      lastSeq,
      lastSkewMs: o.skewMs,
      ...(o.buffered !== undefined ? { buffered: o.buffered } : {}),
      ...(o.linkState !== undefined ? { linkState: o.linkState } : {}),
    })
    .where(and(eq(plantDevice.id, device.id), eq(plantDevice.companyId, device.companyId), isNull(plantDevice.revokedAt)));
}

export async function recordDeviceHeartbeat(db: OrrnDb, device: PlantDeviceRow, req: DeviceHeartbeatRequest, nowMs: number = Date.now()): Promise<{ ok: true; skewMs: number; timeUnconfirmed: boolean }> {
  const skewMs = nowMs - Date.parse(req.sentAt);
  await atomicBatch(db, [deviceSeenUpdate(db, device, { nowMs, epoch: req.epoch, seq: req.lastSeq ?? null, skewMs, buffered: req.buffered ?? 0, linkState: req.linkState ?? "" })]);
  return { ok: true, skewMs, timeUnconfirmed: deviceClock({ sentAtMs: nowMs - skewMs, receivedAtMs: nowMs, sampledAtMs: nowMs }).unconfirmed };
}

/** The devices enrolled on an edge node, for its local cache. Never a token or its hash. */
export async function deviceConfigForNode(db: OrrnDb, node: { id: string; companyId: string }, nowMs: number = Date.now()) {
  const rows = await db
    .select()
    .from(plantDevice)
    .where(and(eq(plantDevice.companyId, node.companyId), eq(plantDevice.deploymentId, node.id), isNull(plantDevice.revokedAt)))
    .orderBy(plantDevice.code)
    .limit(200);
  return {
    devices: rows.map((d) => ({
      id: d.id,
      code: d.code,
      kind: d.kind,
      protocol: d.protocol,
      simulated: d.simulated,
      heartbeatSec: d.heartbeatSec,
      tokenVersion: d.tokenVersion,
      config: (d.configJson as never) ?? null,
    })),
    generatedAt: new Date(nowMs).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Auto-capture into QA records (rows 40, 94)
// ---------------------------------------------------------------------------

export type LabSubjectType = "press_run" | "bundle" | "ageing_batch";

/** The subject a sample code names: a press run number, a bundle serial, an ageing batch number (in that order). */
export async function subjectForSampleCode(db: OrrnDb, companyId: string, code: string): Promise<{ type: LabSubjectType; id: string } | null> {
  const c = normaliseSampleCode(code);
  if (!c) return null;
  const [run] = await db.select({ id: pressRun.id }).from(pressRun).where(and(eq(pressRun.companyId, companyId), eq(pressRun.number, c))).orderBy(desc(pressRun.createdAt)).limit(1);
  if (run) return { type: "press_run", id: run.id };
  const [b] = await db.select({ id: bundle.id }).from(bundle).where(and(eq(bundle.companyId, companyId), eq(bundle.serial, c))).limit(1);
  if (b) return { type: "bundle", id: b.id };
  const [a] = await db.select({ id: ageingBatch.id }).from(ageingBatch).where(and(eq(ageingBatch.companyId, companyId), eq(ageingBatch.number, c))).limit(1);
  if (a) return { type: "ageing_batch", id: a.id };
  return null;
}

export type CaptureOutcome =
  | { checkId: string; result: QaResult; subjectType: LabSubjectType; subjectId: string; number: string }
  | { code: "not_found" | "not_lab" | "simulated" | "no_match" | "no_nominal" | "already_used" };

async function planDimensions(db: OrrnDb, companyId: string, dieId: string | null, dieInstanceId: string | null): Promise<QaPlanDimension[]> {
  if (!dieId) return [];
  const plans = await db.select({ dims: qaPlan.dimensionsJson, copy: qaPlan.dieInstanceId }).from(qaPlan).where(and(eq(qaPlan.companyId, companyId), eq(qaPlan.dieId, dieId)));
  const own = plans.find((p) => p.copy && p.copy === dieInstanceId) ?? plans.find((p) => p.copy == null);
  return own?.dims ?? [];
}

/**
 * Turn one stored lab reading into a quality check. `subject` overrides the sample code (a person attaching
 * from the lab inbox). The check, the use row and the audit row land together; a reading already used (live)
 * answers `already_used` (the partial unique index decides a race).
 */
export async function captureLabReading(
  db: OrrnDb,
  o: { companyId: string; readingId: string; actorId: string | null; subject?: { type: LabSubjectType; id: string }; auditCtx?: Parameters<typeof auditInsert>[0] },
): Promise<CaptureOutcome> {
  const reading = await db.select().from(deviceReading).where(and(eq(deviceReading.companyId, o.companyId), eq(deviceReading.id, o.readingId))).get();
  if (!reading) return { code: "not_found" };
  if (reading.kind === "weighbridge") return { code: "not_lab" };
  if (reading.simulated) return { code: "simulated" };
  const target = o.subject ?? (await subjectForSampleCode(db, o.companyId, reading.sampleCode ?? ""));
  if (!target) return { code: "no_match" };
  const subject = await loadSubject(db, o.companyId, target.type, target.id);
  const device = reading.deviceId ? await db.select({ code: plantDevice.code, label: plantDevice.label }).from(plantDevice).where(eq(plantDevice.id, reading.deviceId)).get() : undefined;
  const source = { source: "device", readingId: reading.id, deviceId: reading.deviceId, deviceCode: device?.code ?? null, sampleCode: reading.sampleCode, sampledAt: reading.sampledAt.getTime() };

  let kind: "dimension" | "mechanical";
  let result: QaResult;
  let values: Record<string, unknown>;
  let flags: QaCheckFlags;
  let temperId: string | null = null;
  if (reading.kind === "dimension") {
    kind = "dimension";
    const points = ((reading.valuesJson as { points?: unknown }).points ?? []) as Parameters<typeof withPlanNominals>[0];
    const { complete, unknown } = withPlanNominals(points, await planDimensions(db, o.companyId, subject.dieId, subject.dieInstanceId));
    if (complete.length === 0) return { code: "no_nominal" };
    const v = dimensionVerdict(complete);
    result = v.result;
    values = { dimensions: v.rows, ...source, ...(unknown.length ? { notCompared: unknown } : {}) };
    flags = { flagged: v.flagged, ...(unknown.length ? { unchecked: unknown } : {}) };
  } else {
    kind = "mechanical";
    const m = reading.valuesJson as { tensileMpa?: number | null; yieldMpa?: number | null; elongationX10?: number | null };
    const temper = await temperFor(db, o.companyId, undefined, subject);
    temperId = temper?.id ?? null;
    // A tensile tester reads no hardness: the ageing batch's lowest deciding sample on the temper's scale is
    // used, as the quality sheet does. With none, a temper hardness minimum is left uncompared, and by QA's
    // own rule (review S2) the result is then "Not checked", never a pass.
    const fromAgeing = await ageingHardnessX10(db, o.companyId, subject.ageingBatchId, temper?.hardnessMethod ?? null);
    const mech = { tensileMpa: m.tensileMpa ?? null, yieldMpa: m.yieldMpa ?? null, elongationX10: m.elongationX10 ?? null, hardnessX10: fromAgeing?.x10 ?? null };
    const otherScale = Boolean(temper && fromAgeing && fromAgeing.method !== temper.hardnessMethod);
    const skipHardness = mech.hardnessX10 == null && temper?.limits.hardnessMinX10 != null;
    const limits = temper ? (skipHardness ? { ...temper.limits, hardnessMinX10: null } : temper.limits) : null;
    const v = mechanicalVerdict(mech, limits, { hardnessOtherScale: otherScale });
    const unchecked = skipHardness ? [...v.unchecked, "hardness" as const] : v.unchecked;
    result = skipHardness && v.result === "pass" ? "unchecked" : v.result;
    values = { ...mech, hardnessMethod: fromAgeing?.method ?? null, hardnessFromAgeing: fromAgeing != null, limits: temper?.limits ?? null, limitsMethod: temper?.hardnessMethod ?? null, ...source };
    flags = { low: v.low, missing: v.missing, unchecked };
  }

  const checkId = crypto.randomUUID();
  const useId = crypto.randomUUID();
  const at = new Date();
  const audit = o.auditCtx ?? { db, companyId: o.companyId, session: null as never };
  try {
    await atomicBatch(db, [
      // The use row first: a reading already used fails the batch on its partial unique index.
      db.insert(deviceReadingUse).values({ id: useId, companyId: o.companyId, readingId: reading.id, subjectType: target.type, subjectId: target.id, qaCheckId: null, createdBy: o.actorId, createdAt: at }),
      db.insert(qaCheck).values({
        id: checkId,
        companyId: o.companyId,
        kind,
        subjectType: target.type,
        subjectId: target.id,
        pressRunId: subject.pressRunId,
        bundleId: subject.bundleId,
        dieId: subject.dieId,
        dieInstanceId: subject.dieInstanceId,
        lotId: subject.lotId,
        castId: subject.castId,
        ageingBatchId: subject.ageingBatchId,
        subjectNumber: subject.number,
        temperId,
        result,
        valuesJson: values,
        flagsJson: flags,
        note: device ? `${device.code} ${device.label}`.slice(0, 500) : null,
        checkedBy: o.actorId,
        checkedAt: reading.sampledAt,
      }),
      db.update(deviceReadingUse).set({ qaCheckId: checkId }).where(and(eq(deviceReadingUse.id, useId), eq(deviceReadingUse.companyId, o.companyId))),
      auditInsert(audit, {
        action: "plant_device.capture",
        subjectType: "qa_check",
        subjectId: checkId,
        meta: { readingId: reading.id, deviceId: reading.deviceId, kind, subjectType: target.type, subjectId: target.id, number: subject.number, result, auto: o.actorId == null },
      }),
    ]);
  } catch (e) {
    if (isQaUnique(e, "device_reading_use")) return { code: "already_used" };
    throw e;
  }
  return { checkId, result, subjectType: target.type, subjectId: target.id, number: subject.number };
}

// ---------------------------------------------------------------------------
// Health of enrolled devices and of the existing collectors (row 95)
// ---------------------------------------------------------------------------

export type DeviceListRow = Omit<PlantDeviceRow, "tokenHash" | "configJson"> & { health: DeviceHealth; hasConfig: boolean; nodeName: string | null };

export async function listDevices(db: OrrnDb, companyId: string, nowMs: number = Date.now()): Promise<DeviceListRow[]> {
  const rows = await db
    .select({ d: plantDevice, nodeName: spoolDeployment.nodeName })
    .from(plantDevice)
    .leftJoin(spoolDeployment, and(eq(spoolDeployment.id, plantDevice.deploymentId), eq(spoolDeployment.companyId, plantDevice.companyId)))
    .where(eq(plantDevice.companyId, companyId))
    .orderBy(plantDevice.code)
    .limit(200);
  return rows.map(({ d, nodeName }) => {
    const { tokenHash: _t, configJson, ...rest } = d;
    return {
      ...rest,
      hasConfig: configJson != null,
      nodeName: nodeName ?? null,
      health: deviceHealth({ revoked: d.revokedAt != null, lastSeenAtMs: d.lastSeenAt?.getTime() ?? null, nowMs, heartbeatSec: d.heartbeatSec }),
    };
  });
}

export type CollectorSource = {
  key: string;
  kind: "edge_node" | "scale" | "press_frames" | "spectro" | "oven";
  label: string;
  nodeId: string | null;
  lastSeenAt: Date | null;
  simulated: boolean;
  health: DeviceHealth;
};

const DAY_MS = 24 * 3600_000;

/**
 * The collectors that were already on main before this lane (edge nodes and their scale, press frames,
 * spectro files, oven telemetry), with last seen and the sim label. Read-only: their own auth, gates and
 * screens are unchanged. Bounded to the last day of frames and oven readings.
 */
export async function collectorSources(db: OrrnDb, companyId: string, heartbeatSec: number, nowMs: number = Date.now()): Promise<CollectorSource[]> {
  const since = new Date(nowMs - DAY_MS);
  const health = (at: Date | null) => deviceHealth({ revoked: false, lastSeenAtMs: at?.getTime() ?? null, nowMs, heartbeatSec });
  const nodes = await db
    .select({
      id: spoolDeployment.id,
      name: spoolDeployment.nodeName,
      status: spoolDeployment.status,
      lastSeen: spoolDeployment.lastHeartbeatAt,
      scaleConfigured: spoolDeployment.scaleConfigured,
      scaleSimulated: spoolDeployment.scaleSimulated,
      scaleFrame: spoolDeployment.scaleLastFrameAt,
    })
    .from(spoolDeployment)
    .where(eq(spoolDeployment.companyId, companyId))
    .limit(50);
  const out: CollectorSource[] = [];
  const nodeName = new Map(nodes.map((n) => [n.id, n.name]));
  for (const n of nodes) {
    out.push({ key: `node:${n.id}`, kind: "edge_node", label: n.name, nodeId: n.id, lastSeenAt: n.lastSeen ?? null, simulated: false, health: n.status === "revoked" ? "revoked" : health(n.lastSeen ?? null) });
    if (n.scaleConfigured) out.push({ key: `scale:${n.id}`, kind: "scale", label: n.name, nodeId: n.id, lastSeenAt: n.scaleFrame ?? null, simulated: Boolean(n.scaleSimulated), health: health(n.scaleFrame ?? null) });
  }
  const frames = await db
    .select({ nodeId: pressCollectorFrame.nodeId, last: sql<number>`max(${pressCollectorFrame.receivedAt})`, real: sql<number>`max(case when ${pressCollectorFrame.simulated} = 0 then 1 else 0 end)` })
    .from(pressCollectorFrame)
    .where(and(eq(pressCollectorFrame.companyId, companyId), gte(pressCollectorFrame.sampledAt, since)))
    .groupBy(pressCollectorFrame.nodeId);
  for (const f of frames) {
    const at = f.last ? new Date(Number(f.last)) : null;
    out.push({ key: `press:${f.nodeId}`, kind: "press_frames", label: nodeName.get(f.nodeId) ?? "", nodeId: f.nodeId, lastSeenAt: at, simulated: Number(f.real) === 0, health: health(at) });
  }
  const spectro = await db
    .select({ nodeId: spectroInbox.nodeId, last: sql<number>`max(${spectroInbox.createdAt})`, real: sql<number>`max(case when ${spectroInbox.simulated} = 0 then 1 else 0 end)` })
    .from(spectroInbox)
    .where(eq(spectroInbox.companyId, companyId))
    .groupBy(spectroInbox.nodeId);
  for (const s of spectro) {
    const at = s.last ? new Date(Number(s.last)) : null;
    // A spectrometer sends a file per test, not a heartbeat: its health is "late" at worst, never "silent".
    const h = health(at);
    out.push({ key: `spectro:${s.nodeId ?? "none"}`, kind: "spectro", label: s.nodeId ? (nodeName.get(s.nodeId) ?? "") : "", nodeId: s.nodeId, lastSeenAt: at, simulated: Number(s.real) === 0, health: h === "silent" ? "late" : h });
  }
  const ovens = await db
    .select({ device: ageingTempLog.deviceId, last: sql<number>`max(${ageingTempLog.at})`, real: sql<number>`max(case when ${ageingTempLog.source} = 'telemetry' then 1 else 0 end)` })
    .from(ageingTempLog)
    .where(and(eq(ageingTempLog.companyId, companyId), inArray(ageingTempLog.source, ["telemetry", "simulator"]), gte(ageingTempLog.at, since)))
    .groupBy(ageingTempLog.deviceId);
  for (const ov of ovens) {
    const at = ov.last ? new Date(Number(ov.last)) : null;
    out.push({ key: `oven:${ov.device}`, kind: "oven", label: ov.device, nodeId: null, lastSeenAt: at, simulated: Number(ov.real) === 0, health: health(at) });
  }
  return out;
}

export function readingSummary(r: DeviceReadingRow) {
  return {
    id: r.id,
    deviceId: r.deviceId,
    kind: r.kind,
    source: r.source,
    seq: r.seq,
    simulated: r.simulated,
    sampledAt: r.sampledAt,
    receivedAt: r.receivedAt,
    skewMs: r.skewMs,
    timeUnconfirmed: r.timeUnconfirmed,
    ticketNo: r.ticketNo,
    vehicleNo: r.vehicleNo,
    grossG: r.grossG,
    tareG: r.tareG,
    netG: r.netG,
    sampleCode: r.sampleCode,
    values: r.valuesJson,
  };
}

export { readDeviceSettings };
