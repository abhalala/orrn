/**
 * W4-COLLECTORS press collector seam (FP-PR-21 / FP-PR-22): node-signed frames, idempotency on
 * (node, seq), run binding by time window, the Q-09 2 % variance annotation (the run is never
 * written), threshold alerts, heartbeat presence and permissions (node HMAC only).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { wrapSecret } from "@orrn/crypto";
import { pressAlert, pressCollectorFrame, pressRunCollector } from "@orrn/db/schema/collector";
import { pressBilletUse, pressLine, pressRun } from "@orrn/db/schema/press";
import { cast } from "@orrn/db/schema/foundry";
import { spoolDeployment } from "@orrn/db/schema/spool";
import { and, eq, isNull } from "drizzle-orm";

import { DEV_MASTER_KEY } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";
import { pressHelpers } from "./press-w2-fixture";

let env: TestEnv;
let lib: typeof import("../src/lib/pressCollector");
let node: typeof import("../src/lib/collectorNode");
let crypto_: typeof import("../src/lib/spool-crypto");
let hb: typeof import("../src/lib/edge-heartbeat");

beforeAll(async () => {
  env = await createTestEnv();
  lib = await import("../src/lib/pressCollector");
  node = await import("../src/lib/collectorNode");
  crypto_ = await import("../src/lib/spool-crypto");
  hb = await import("../src/lib/edge-heartbeat");
});

afterAll(async () => {
  await env.dispose();
});

// The late-entry case walks a whole W2 plant (orders, plans, copies) on Miniflare D1.
setDefaultTimeout(30_000);
const { pressPlant } = pressHelpers(() => env);

const T0 = Date.parse("2026-10-24T06:00:00.000Z");
const at = (sec: number) => new Date(T0 + sec * 1000);
const iso = (sec: number) => at(sec).toISOString();
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

/** A spool node (deployment) of `companyId` and a signed POST of frames from it. */
async function collectorNode(companyId: string, secret: string) {
  const nodeId = crypto.randomUUID();
  const instanceId = crypto.randomUUID();
  await env.db.insert(spoolDeployment).values({
    id: nodeId,
    companyId,
    instanceId,
    status: "active",
    subdomain: `pc-${nodeId.slice(0, 8)}`,
    nodeDomain: `pc-${nodeId.slice(0, 8)}.spool.orrn.in`,
    cfTunnelTokenWrapped: await wrapSecret("tunnel", DEV_MASTER_KEY),
    sharedSecretHash: "hash",
    sharedSecretWrapped: await wrapSecret(secret, DEV_MASTER_KEY),
  });
  const post = async (frames: unknown[], opts: { nowMs?: number } = {}) => {
    const rawBody = enc({ instance_id: instanceId, frames });
    const nowMs = opts.nowMs ?? Date.now();
    const token = await crypto_.signSpoolRequest("POST", lib.PRESS_FRAMES_PATH, rawBody, secret, nowMs);
    return node.handlePressFramesRequest(env.db, { rawBody, authorization: `Bearer ${token}`, masterKey: DEV_MASTER_KEY, nowMs });
  };
  return { nodeId, instanceId, post };
}

async function plant(secret = "press-secret") {
  const { companyId } = await env.seedCompany();
  const nodeId = crypto.randomUUID();
  const instanceId = crypto.randomUUID();
  await env.db.insert(spoolDeployment).values({
    id: nodeId,
    companyId,
    instanceId,
    status: "active",
    subdomain: `pc-${nodeId.slice(0, 8)}`,
    nodeDomain: `pc-${nodeId.slice(0, 8)}.spool.orrn.in`,
    cfTunnelTokenWrapped: await wrapSecret("tunnel", DEV_MASTER_KEY),
    sharedSecretHash: "hash",
    sharedSecretWrapped: await wrapSecret(secret, DEV_MASTER_KEY),
  });
  const lineId = crypto.randomUUID();
  await env.db.insert(pressLine).values({ id: lineId, companyId, code: "P1", name: "Press 1" });
  const sectionId = await env.seedDie(companyId);
  let n = 0;
  const run = async (o: { startSec: number; stopSec?: number | null; status?: "running" | "stopped" | "logged" | "queued" | "counting" | "voided"; inputG?: number | null; lineId?: string }) => {
    const id = crypto.randomUUID();
    n += 1;
    await env.db.insert(pressRun).values({
      id,
      companyId,
      number: `PR-${n}`,
      period: "2026-27",
      status: o.status ?? "running",
      sectionId,
      pressLineId: o.lineId ?? lineId,
      startedAt: at(o.startSec),
      stoppedAt: o.stopSec == null ? null : at(o.stopSec),
      inputG: o.inputG ?? null,
      productionDay: "2026-10-24",
      shiftSeq: 1,
    });
    return id;
  };
  const post = async (frames: unknown[], opts: { secret?: string; nowMs?: number; auth?: string | null } = {}) => {
    const rawBody = enc({ instance_id: instanceId, frames });
    const nowMs = opts.nowMs ?? T0 + 3600_000;
    const token = await crypto_.signSpoolRequest("POST", lib.PRESS_FRAMES_PATH, rawBody, opts.secret ?? secret, nowMs);
    return node.handlePressFramesRequest(env.db, {
      rawBody,
      authorization: opts.auth === undefined ? `Bearer ${token}` : opts.auth,
      masterKey: DEV_MASTER_KEY,
      nowMs,
    });
  };
  return { companyId, nodeId, instanceId, lineId, sectionId, run, post };
}

const frame = (seq: number, sec: number, over: Record<string, unknown> = {}) => ({
  seq,
  line: "P1",
  at: iso(sec),
  simulated: true,
  state: "extruding",
  ramSpeedMmS: 8.5,
  billetTempC: 480,
  exitTempC: 520,
  containerTempC: 430,
  pressureBar: 180,
  ...over,
});

describe("pure rules", () => {
  test("Q-09: within 2 % is accepted, beyond is flagged", () => {
    expect(lib.collectorVariance(102_000, 100_000)).toEqual({ varianceBp: 200, flagged: false });
    expect(lib.collectorVariance(98_000, 100_000)).toEqual({ varianceBp: 200, flagged: false });
    expect(lib.collectorVariance(102_001, 100_000)).toEqual({ varianceBp: 200, flagged: true });
    expect(lib.collectorVariance(97_500, 100_000)).toEqual({ varianceBp: 250, flagged: true });
    expect(lib.collectorVariance(null, 100_000)).toBeNull();
    expect(lib.collectorVariance(100_000, 0)).toBeNull();
  });

  test("band edges are inclusive", () => {
    expect(lib.outOfBand(50, { minX10: 50, maxX10: 120 })).toBeNull();
    expect(lib.outOfBand(120, { minX10: 50, maxX10: 120 })).toBeNull();
    expect(lib.outOfBand(49, { minX10: 50, maxX10: 120 })).toEqual({ direction: "low", limitX10: 50 });
    expect(lib.outOfBand(121, { minX10: null, maxX10: 120 })).toEqual({ direction: "high", limitX10: 120 });
  });

  test("bindRun picks the latest-started run whose window covers the sample", () => {
    const runs = [
      { id: "a", pressLineId: "L", startedAt: at(0), stoppedAt: at(100), status: "logged" },
      { id: "b", pressLineId: "L", startedAt: at(200), stoppedAt: null, status: "running" },
      { id: "c", pressLineId: "L", startedAt: at(150), stoppedAt: null, status: "stopped" },
    ];
    expect(lib.bindRun(runs, "L", T0 + 50_000)).toBe("a");
    expect(lib.bindRun(runs, "L", T0 + 100_000)).toBe("a");
    expect(lib.bindRun(runs, "L", T0 + 120_000)).toBeNull();
    expect(lib.bindRun(runs, "L", T0 + 160_000)).toBeNull(); // stopped with no stop time: no window
    expect(lib.bindRun(runs, "L", T0 + 900_000)).toBe("b");
    expect(lib.bindRun(runs, "M", T0 + 50_000)).toBeNull();
  });
});

describe("POST /collector/press/frames", () => {
  test("idempotent on (node, seq): a replay is a duplicate and adds nothing", async () => {
    const p = await plant();
    const frames = [frame(1, 10), frame(2, 12), frame(3, 14)];
    const first = await p.post(frames);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ accepted: 3, duplicates: 0, rejected: [] });
    const again = await p.post([...frames, frame(4, 16)]);
    expect(again.body).toMatchObject({ accepted: 1, duplicates: 3 });
    const rows = await env.db.select().from(pressCollectorFrame).where(eq(pressCollectorFrame.nodeId, p.nodeId));
    expect(rows.map((r) => r.seq).sort()).toEqual([1, 2, 3, 4]);
    expect(rows.every((r) => r.simulated)).toBe(true);
    expect(rows[0]).toMatchObject({ ramSpeedX10: 85, billetTempX10: 4800, pressureX10: 1800, state: "extruding" });
  });

  test("100 frames in one post stay under the D1 parameter limit", async () => {
    const p = await plant();
    const frames = Array.from({ length: 100 }, (_, i) => frame(1000 + i, i * 2, { billetsTotal: Math.floor(i / 10) }));
    const r = await p.post(frames);
    expect(r.body).toMatchObject({ accepted: 100 });
  });

  test("unknown line, clock ahead and repeated seq in one batch are refused per frame", async () => {
    const p = await plant();
    const nowMs = T0 + 60_000;
    const r = await p.post([frame(1, 0), frame(1, 1), frame(2, 2, { line: "P9" }), frame(3, 60 + 301)], { nowMs });
    expect(r.body).toMatchObject({
      accepted: 1,
      rejected: [
        { seq: 1, reason: "duplicate_in_batch" },
        { seq: 2, reason: "unknown_line" },
        { seq: 3, reason: "clock_ahead" },
      ],
    });
  });

  test("frames bind to the run on that line by time window", async () => {
    const p = await plant();
    const r1 = await p.run({ startSec: 0, stopSec: 100, status: "stopped" });
    const r2 = await p.run({ startSec: 200 });
    const queued = await p.run({ startSec: 50, status: "queued" });
    const res = await p.post([frame(1, 10), frame(2, 100), frame(3, 150), frame(4, 250)]);
    expect(res.body).toMatchObject({ bound: 3, unbound: 1 });
    const rows = await env.db.select().from(pressCollectorFrame).where(eq(pressCollectorFrame.nodeId, p.nodeId));
    const bySeq = new Map(rows.map((r) => [r.seq, r.pressRunId]));
    expect(bySeq.get(1)).toBe(r1);
    expect(bySeq.get(2)).toBe(r1);
    expect(bySeq.get(3)).toBeNull();
    expect(bySeq.get(4)).toBe(r2);
    expect([...bySeq.values()]).not.toContain(queued);
  });

  test("Q-09: billet kg off by more than 2 % flags collector_variance; the run is untouched", async () => {
    const p = await plant();
    // Typed: 10 billets, 410.4 kg in.
    const runId = await p.run({ startSec: 0, stopSec: 600, status: "logged", inputG: 410_400 });
    const castId = crypto.randomUUID();
    await env.db.insert(cast).values({ id: castId, companyId: p.companyId, number: "K31", period: "2026-10", year: 2026, month: 10, seq: 31, alloy: "6063", openedAt: at(0) });
    await env.db.insert(pressBilletUse).values({ id: crypto.randomUUID(), companyId: p.companyId, pressRunId: runId, line: 1, castId, count: 10, kgG: 410_400 });
    const before = await env.db.select().from(pressRun).where(eq(pressRun.id, runId)).get();
    // Baseline frame before the run (counter 40), then 11 billets counted during it (51).
    await p.post([frame(1, -5, { billetsTotal: 40 }), frame(2, 30, { billetsTotal: 41 }), frame(3, 300, { billetsTotal: 46 }), frame(4, 590, { billetsTotal: 51 })]);
    const s = await env.db.select().from(pressRunCollector).where(eq(pressRunCollector.pressRunId, runId)).get();
    expect(s).toMatchObject({ frames: 3, billetsCounted: 11, varianceBasis: "count", typedInputG: 410_400, collectorInputG: 451_440, varianceBp: 1000, collectorVariance: true, simulated: true });
    const after = await env.db.select().from(pressRun).where(eq(pressRun.id, runId)).get();
    expect(after).toEqual(before!);
  });

  test("Q-09 on weight: within 2 % is accepted; a counter reset still counts", async () => {
    const p = await plant();
    const runId = await p.run({ startSec: 0, stopSec: 600, status: "logged", inputG: 400_000 });
    // 0 -> 200 kg, reset, -> 205 kg: 405 kg collected vs 400 kg typed = 1.25 %.
    await p.post([
      frame(1, 10, { billetGTotal: 0 }),
      frame(2, 100, { billetGTotal: 200_000 }),
      frame(3, 200, { billetGTotal: 5_000 }),
      frame(4, 300, { billetGTotal: 205_000 }),
    ]);
    const s = await env.db.select().from(pressRunCollector).where(eq(pressRunCollector.pressRunId, runId)).get();
    expect(s).toMatchObject({ varianceBasis: "weight", collectorInputG: 405_000, varianceBp: 125, collectorVariance: false });
  });

  test("a run logged after its last frame is evaluated on the next frame for the line and by runSummary", async () => {
    const p = await plant();
    const runId = await p.run({ startSec: 0 });
    await p.post([frame(1, 10, { billetGTotal: 0 }), frame(2, 100, { billetGTotal: 300_000 })]);
    let s = await env.db.select().from(pressRunCollector).where(eq(pressRunCollector.pressRunId, runId)).get();
    expect(s).toMatchObject({ typedInputG: null, varianceBp: null, collectorVariance: false });
    await new Promise((r) => setTimeout(r, 5));
    await env.db.update(pressRun).set({ status: "logged", stoppedAt: at(120), inputG: 280_000 }).where(eq(pressRun.id, runId));
    // An idle frame after the stop binds to nothing but re-evaluates the stale logged run.
    const res = await p.post([frame(3, 200, { state: "idle" })]);
    expect(res.body).toMatchObject({ unbound: 1 });
    expect((res.body as { runsEvaluated: string[] }).runsEvaluated).toContain(runId);
    s = await env.db.select().from(pressRunCollector).where(eq(pressRunCollector.pressRunId, runId)).get();
    expect(s).toMatchObject({ typedInputG: 280_000, collectorInputG: 300_000, varianceBp: 714, collectorVariance: true });

    // Edit after that: runSummary re-evaluates on read.
    await new Promise((r) => setTimeout(r, 5));
    await env.db.update(pressRun).set({ inputG: 299_000 }).where(eq(pressRun.id, runId));
    const viewer = env.caller({ role: "viewer", companyId: p.companyId });
    const sum = await viewer.press.collector.runSummary({ runId });
    expect(sum).toMatchObject({ frames: 2, simulated: true, typedInputG: 299_000, varianceBp: 33, collectorVariance: false, ramSpeedAvgMmS: 8.5 });
  });

  test("permissions: unsigned, wrong secret, other node's token and unknown node are refused; nothing stored", async () => {
    const p = await plant();
    const frames = [frame(1, 10)];
    expect((await p.post(frames, { auth: null })).status).toBe(401);
    expect((await p.post(frames, { auth: "Bearer session-cookie-is-not-a-token" })).status).toBe(401);
    expect((await p.post(frames, { secret: "someone-else" })).status).toBe(403);
    // Old token (outside ±5 min).
    const rawBody = enc({ instance_id: p.instanceId, frames });
    const old = await crypto_.signSpoolRequest("POST", lib.PRESS_FRAMES_PATH, rawBody, "press-secret", T0);
    expect((await node.handlePressFramesRequest(env.db, { rawBody, authorization: `Bearer ${old}`, masterKey: DEV_MASTER_KEY, nowMs: T0 + 6 * 60_000 })).status).toBe(403);
    // Signed for another path.
    const other = await crypto_.signSpoolRequest("POST", "/webhooks/spool/activate", rawBody, "press-secret", T0);
    expect((await node.handlePressFramesRequest(env.db, { rawBody, authorization: `Bearer ${other}`, masterKey: DEV_MASTER_KEY, nowMs: T0 })).status).toBe(403);
    const unknown = enc({ instance_id: "nope", frames });
    const tok = await crypto_.signSpoolRequest("POST", lib.PRESS_FRAMES_PATH, unknown, "press-secret", T0);
    expect((await node.handlePressFramesRequest(env.db, { rawBody: unknown, authorization: `Bearer ${tok}`, masterKey: DEV_MASTER_KEY, nowMs: T0 })).status).toBe(403);
    // Revoked node.
    await env.db.update(spoolDeployment).set({ status: "revoked" }).where(eq(spoolDeployment.id, p.nodeId));
    expect((await p.post(frames)).status).toBe(403);
    expect(await env.db.select().from(pressCollectorFrame).where(eq(pressCollectorFrame.nodeId, p.nodeId))).toHaveLength(0);
  });

  test("permissions: no tRPC procedure takes frames; thresholds need masters.publish, ack needs press.close", async () => {
    const p = await plant();
    const { appRouter } = await import("../src/routers/index");
    const paths = Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);
    expect(paths).toContain("press.collector.setThreshold");
    expect(paths.filter((k) => /collector|spectroInbox/.test(k) && /ingest|frame|upload/i.test(k))).toEqual([]);
    for (const role of ["viewer", "press", "supervisor", "office", "foundry"] as const) {
      await expect(
        env.caller({ role, companyId: p.companyId }).press.collector.setThreshold({ pressLineId: null, metric: "ram_speed", min: 2, max: 12 }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await env.caller({ role: "manager", companyId: p.companyId }).press.collector.setThreshold({ pressLineId: null, metric: "ram_speed", min: 2, max: 12 });
    await p.post([frame(1, 10, { ramSpeedMmS: 15 })]);
    // The frame is hours older than the real clock, so the alert reads as ended (I-3); it is still listed.
    const [a] = await env.caller({ role: "viewer", companyId: p.companyId }).press.collector.alerts({ openOnly: false, limit: 10 });
    expect(a).toBeDefined();
    await expect(env.caller({ role: "press", companyId: p.companyId }).press.collector.acknowledgeAlert({ id: a!.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await env.caller({ role: "supervisor", companyId: p.companyId }).press.collector.acknowledgeAlert({ id: a!.id })).toMatchObject({ already: false });
  });
});

describe("cross-repo: a frame signed by orrn-spool's Go collector", () => {
  // Pinned in orrn-spool internal/collector/vector_test.go (TestFramesVectorMatchesORRNFixture).
  const secret = "test-node-secret-7f3a9c2e5b1d";
  const body =
    '{"instance_id":"go-vector-node","frames":[{"seq":1792821600000,"line":"P1","at":"2026-10-24T06:00:00Z","simulated":true,"state":"extruding","ramSpeedMmS":8.1,"billetTempC":479.5,"exitTempC":512.3,"containerTempC":430.2,"pressureBar":196.4,"extrusionMs":14000,"billetsTotal":12}]}';
  const token = "v1:mvlzowdw:2e67b073ff2a0f46ee25515061f252dcee447adca34b315079b18437320ac149";

  test("verifies here and its JSON parses into a stored frame", async () => {
    const { companyId } = await env.seedCompany();
    const nodeId = crypto.randomUUID();
    await env.db.insert(spoolDeployment).values({
      id: nodeId,
      companyId,
      instanceId: "go-vector-node",
      status: "active",
      subdomain: "go-vector",
      nodeDomain: "go-vector.spool.orrn.in",
      cfTunnelTokenWrapped: await wrapSecret("tunnel", DEV_MASTER_KEY),
      sharedSecretHash: "hash",
      sharedSecretWrapped: await wrapSecret(secret, DEV_MASTER_KEY),
    });
    await env.db.insert(pressLine).values({ id: crypto.randomUUID(), companyId, code: "P1", name: "Press 1" });
    const res = await node.handlePressFramesRequest(env.db, {
      rawBody: new TextEncoder().encode(body),
      authorization: `Bearer ${token}`,
      masterKey: DEV_MASTER_KEY,
      nowMs: 1792821600500 + 1500,
    });
    expect(res).toMatchObject({ status: 200, body: { accepted: 1 } });
    const [f] = await env.db.select().from(pressCollectorFrame).where(eq(pressCollectorFrame.nodeId, nodeId));
    expect(f).toMatchObject({ seq: 1792821600000, simulated: true, ramSpeedX10: 81, billetTempX10: 4795, exitTempX10: 5123, pressureX10: 1964, extrusionMs: 14000, billetsTotal: 12, billetGTotal: null });
  });
});

describe("press_alert evaluation", () => {
  test("out of band opens, consecutive frames extend, back in band ends; idle frames are not judged", async () => {
    const p = await plant();
    const manager = env.caller({ role: "manager", companyId: p.companyId });
    await manager.press.collector.setThreshold({ pressLineId: null, metric: "ram_speed", min: 2, max: 12 });
    await manager.press.collector.setThreshold({ pressLineId: null, metric: "billet_temp", min: 460, max: 510 });
    // Line band overrides the all-lines band.
    await manager.press.collector.setThreshold({ pressLineId: p.lineId, metric: "billet_temp", min: 470, max: 500 });
    const runId = await p.run({ startSec: 0 });

    let r = await p.post([frame(1, 10), frame(2, 12, { ramSpeedMmS: 13.5 }), frame(3, 14, { ramSpeedMmS: 14.2 })]);
    expect(r.body).toMatchObject({ alertsOpened: 1, alertsEnded: 0 });
    r = await p.post([frame(4, 16, { ramSpeedMmS: 9 }), frame(5, 18, { billetTempC: 505, state: "extruding" }), frame(6, 20, { billetTempC: 520, state: "idle" })]);
    expect(r.body).toMatchObject({ alertsOpened: 1, alertsEnded: 1 });

    const rows = await env.db.select().from(pressAlert).where(eq(pressAlert.companyId, p.companyId));
    const ram = rows.find((a) => a.metric === "ram_speed")!;
    expect(ram).toMatchObject({ direction: "high", limitX10: 120, peakX10: 142, frames: 2, simulated: true, pressRunId: runId });
    expect(ram.startedAt).toEqual(at(12));
    expect(ram.endedAt).toEqual(at(16));
    const temp = rows.find((a) => a.metric === "billet_temp")!;
    expect(temp).toMatchObject({ direction: "high", limitX10: 5000, peakX10: 5050, frames: 1, endedAt: null });

    // Replaying the same frames changes nothing.
    await p.post([frame(4, 16, { ramSpeedMmS: 9 }), frame(5, 18, { billetTempC: 505 })]);
    expect(await env.db.select().from(pressAlert).where(eq(pressAlert.companyId, p.companyId))).toHaveLength(2);

    // Today chip: open = not acknowledged yet (BACKLOG 81), so both are open; two started today, simulated.
    const today = await lib.pressAlertsToday(env.db, p.companyId, T0);
    expect(today).toEqual({ open: 2, today: 2, simulated: true });
  });

  test("a gap longer than 5 minutes ends the old alert at its last frame and opens a new one", async () => {
    const p = await plant();
    await env.caller({ role: "owner", companyId: p.companyId }).press.collector.setThreshold({ pressLineId: p.lineId, metric: "pressure", min: null, max: 200 });
    await p.post([frame(1, 0, { pressureBar: 210 }), frame(2, 2, { pressureBar: 230 })]);
    await p.post([frame(3, 2 + 301, { pressureBar: 215 })]);
    const rows = await env.db
      .select()
      .from(pressAlert)
      .where(and(eq(pressAlert.companyId, p.companyId), eq(pressAlert.metric, "pressure")));
    expect(rows).toHaveLength(2);
    const old = rows.find((a) => a.endedAt != null)!;
    expect(old).toMatchObject({ frames: 2, peakX10: 2300 });
    expect(old.endedAt).toEqual(at(2));
    expect(rows.find((a) => a.endedAt == null)).toMatchObject({ frames: 1, peakX10: 2150 });
  });

  test("no thresholds, no alerts; setThreshold refuses an empty or inverted band", async () => {
    const p = await plant();
    await p.post([frame(1, 0, { ramSpeedMmS: 999 })]);
    expect(await env.db.select().from(pressAlert).where(eq(pressAlert.companyId, p.companyId))).toHaveLength(0);
    expect(await lib.pressAlertsToday(env.db, p.companyId, T0)).toBeNull();
    const owner = env.caller({ role: "owner", companyId: p.companyId });
    await expect(owner.press.collector.setThreshold({ pressLineId: null, metric: "ram_speed", min: null, max: null })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(owner.press.collector.setThreshold({ pressLineId: null, metric: "ram_speed", min: 9, max: 3 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Upsert keeps one row per (line, metric).
    await owner.press.collector.setThreshold({ pressLineId: null, metric: "ram_speed", min: 1, max: 9 });
    await owner.press.collector.setThreshold({ pressLineId: null, metric: "ram_speed", min: 2, max: 10 });
    const list = await owner.press.collector.thresholds();
    expect(list.filter((t) => t.metric === "ram_speed")).toEqual([expect.objectContaining({ min: 2, max: 10, pressLineId: null })]);
  });
});

describe("heartbeat carries collector presence", () => {
  test("signed: stored as reported (simulated stays simulated); unsigned: ignored", async () => {
    const p = await plant("hb-collector");
    const collectors = [
      { kind: "press", line: "P1", source: "sim", configured: true, simulated: true, connected: true, lastFrameAt: "2026-10-24T06:29:58.5Z", backlog: 3 },
      { kind: "spectro", source: "watch_dir", configured: true, simulated: false, connected: false, lastFrameAt: null, lastError: "folder missing" },
    ];
    const body = enc({ instance_id: p.instanceId, collectors });
    const now = Date.parse("2026-10-24T06:30:00Z");
    expect((await hb.handleNodeHeartbeat(env.db, { rawBody: body, authorization: null, masterKey: DEV_MASTER_KEY, nowMs: now })).status).toBe(200);
    let row = await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.id, p.nodeId)).get();
    expect(row!.collectors).toBeNull();
    const token = await crypto_.signSpoolRequest("POST", "/webhooks/spool/activate", body, "hb-collector", now);
    expect((await hb.handleNodeHeartbeat(env.db, { rawBody: body, authorization: `Bearer ${token}`, masterKey: DEV_MASTER_KEY, nowMs: now })).status).toBe(200);
    row = await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.id, p.nodeId)).get();
    expect(row!.collectors).toEqual([
      { kind: "press", line: "P1", source: "sim", configured: true, simulated: true, connected: true, lastFrameAt: "2026-10-24T06:29:58.500Z", backlog: 3, lastError: null },
      { kind: "spectro", line: null, source: "watch_dir", configured: true, simulated: false, connected: false, lastFrameAt: null, backlog: 0, lastError: "folder missing" },
    ]);
    expect(row!.collectorsReportedAt?.getTime()).toBe(now);
    const o = await env.caller({ role: "viewer", companyId: p.companyId }).edge.overview();
    expect(o.current).toMatchObject({ collectors: row!.collectors });
  });
});

describe("run binding is computed by line + time window, the frame link is only a cache (I-1)", () => {
  const summary = (companyId: string, runId: string) => env.caller({ role: "viewer", companyId }).press.collector.runSummary({ runId });
  const cached = async (nodeId: string) =>
    new Map((await env.db.select().from(pressCollectorFrame).where(eq(pressCollectorFrame.nodeId, nodeId))).map((r) => [r.seq, r.pressRunId]));

  test("frames first, then press.runs.open late over them: the late run gets its frames", async () => {
    const p = await pressPlant();
    const n = await collectorNode(p.companyId, "late-secret");
    const now = Date.now();
    const startedAt = now - 5 * 3_600_000;
    const stoppedAt = now - 3 * 3_600_000;
    const real = (seq: number, ms: number, over: Record<string, unknown> = {}) => ({ ...frame(seq, 0, over), at: new Date(ms).toISOString() });
    const first = await n.post([real(1, startedAt + 60_000, { billetGTotal: 0 }), real(2, startedAt + 3_600_000, { billetGTotal: 150_000 }), real(3, stoppedAt - 60_000, { billetGTotal: 300_000 })]);
    expect(first.body).toMatchObject({ accepted: 3, bound: 0, unbound: 3 });

    const sectionId = await p.section();
    const copyId = await p.copy(sectionId, { milli: 12_000 });
    const late = await p.as("supervisor").press.runs.open({ pressLineId: p.pressLineId, dieInstanceId: copyId, startedAt, stoppedAt, reason: "Tablet was down on the night shift" });

    // The next post for the line (an idle frame, bound to nothing) sweeps the late run and
    // refreshes the cached links.
    const res = await n.post([real(4, now - 30_000, { state: "idle" })]);
    expect((res.body as { runsEvaluated: string[] }).runsEvaluated).toContain(late.id);
    const links = await cached(n.nodeId);
    expect([links.get(1), links.get(2), links.get(3), links.get(4)]).toEqual([late.id, late.id, late.id, null]);
    expect(await summary(p.companyId, late.id)).toMatchObject({ frames: 3, collectorInputG: 300_000, typedInputG: null, simulated: true });

    // Read time alone is enough too: a second late run with no post after it.
    const copy2 = await p.copy(sectionId, { milli: 12_000 });
    await n.post([real(5, now - 2 * 3_600_000 + 60_000), real(6, now - 2 * 3_600_000 + 120_000)]);
    const late2 = await p.as("supervisor").press.runs.open({ pressLineId: p.pressLineId, dieInstanceId: copy2, startedAt: now - 2 * 3_600_000, stoppedAt: now - 3_600_000, reason: "Tablet was down again" });
    expect(await summary(p.companyId, late2.id)).toMatchObject({ frames: 2 });
  });

  test("a run whose times are edited re-binds; a voided run has none", async () => {
    const p = await plant("edit-secret");
    const runId = await p.run({ startSec: 0, stopSec: 600, status: "logged", inputG: 300_000 });
    await p.post([frame(1, 10, { billetGTotal: 0 }), frame(2, 200, { billetGTotal: 150_000 }), frame(3, 400, { billetGTotal: 300_000 }), frame(4, 590, { billetGTotal: 300_000 })]);
    expect(await summary(p.companyId, runId)).toMatchObject({ frames: 4, collectorInputG: 300_000, varianceBp: 0 });

    // The supervisor corrects the stop: the frames after it are no longer this run's.
    await env.db.update(pressRun).set({ stoppedAt: at(250) }).where(eq(pressRun.id, runId));
    expect(await summary(p.companyId, runId)).toMatchObject({ frames: 2, collectorInputG: 150_000, varianceBp: 5000, collectorVariance: true });
    let links = await cached(p.nodeId);
    expect([links.get(1), links.get(2), links.get(3), links.get(4)]).toEqual([runId, runId, null, null]);

    // And the start moves later: the first frame drops out too.
    await env.db.update(pressRun).set({ startedAt: at(100), stoppedAt: at(600) }).where(eq(pressRun.id, runId));
    expect(await summary(p.companyId, runId)).toMatchObject({ frames: 3 });
    links = await cached(p.nodeId);
    expect([links.get(1), links.get(2), links.get(3), links.get(4)]).toEqual([null, runId, runId, runId]);

    await env.db.update(pressRun).set({ status: "voided" }).where(eq(pressRun.id, runId));
    expect(await summary(p.companyId, runId)).toBeNull();
    links = await cached(p.nodeId);
    expect([...links.values()].every((v) => v == null)).toBe(true);
  });

  test("two runs on one line split the frames; the later-started run wins where they overlap", async () => {
    const p = await plant("split-secret");
    const a = await p.run({ startSec: 0, stopSec: 500, status: "logged" });
    await p.post([frame(1, 10), frame(2, 150), frame(3, 250), frame(4, 350), frame(5, 450)]);
    expect(await summary(p.companyId, a)).toMatchObject({ frames: 5 });
    // A second run is entered late inside A's window (A's stop was typed wrong).
    const b = await p.run({ startSec: 200, stopSec: 400, status: "counting" });
    expect(await summary(p.companyId, a)).toMatchObject({ frames: 3 });
    expect(await summary(p.companyId, b)).toMatchObject({ frames: 2 });
    const links = await cached(p.nodeId);
    expect([links.get(1), links.get(2), links.get(3), links.get(4), links.get(5)]).toEqual([a, a, b, b, a]);
    // Back to back: a frame on the boundary belongs to the run that starts there.
    const c = await p.run({ startSec: 1000, stopSec: 1100, status: "stopped" });
    const d = await p.run({ startSec: 1100, status: "running" });
    await p.post([frame(6, 1050), frame(7, 1100), frame(8, 1150)]);
    expect(await summary(p.companyId, c)).toMatchObject({ frames: 1 });
    expect(await summary(p.companyId, d)).toMatchObject({ frames: 2 });
  });

  test("bindRun breaks a start-time tie the same way the window query does", () => {
    const runs = [
      { id: "b", pressLineId: "L", startedAt: at(0), stoppedAt: at(100), status: "logged" },
      { id: "a", pressLineId: "L", startedAt: at(0), stoppedAt: at(100), status: "logged" },
    ];
    expect(lib.bindRun(runs, "L", T0 + 50_000)).toBe("b");
    expect(lib.bindRun([...runs].reverse(), "L", T0 + 50_000)).toBe("b");
  });
});

describe("alerts end after a 5-minute gap, on ingest and on read (I-3)", () => {
  test("an out-of-band frame followed only by idle frames for 6 minutes is ended", async () => {
    const p = await plant("idle-secret");
    await env.caller({ role: "owner", companyId: p.companyId }).press.collector.setThreshold({ pressLineId: null, metric: "ram_speed", min: 2, max: 12 });
    await p.post([frame(1, 0, { ramSpeedMmS: 15 })]);
    const idle = Array.from({ length: 12 }, (_, i) => frame(2 + i, 30 * (i + 1), { state: "idle", ramSpeedMmS: 0 }));
    const r = await p.post(idle);
    expect(r.body).toMatchObject({ alertsEnded: 1 });
    const [a] = await env.db.select().from(pressAlert).where(eq(pressAlert.companyId, p.companyId));
    expect(a!.endedAt).toEqual(at(0));
    // Ended, but nobody has acknowledged it: still open (BACKLOG 81).
    expect(await lib.pressAlertsToday(env.db, p.companyId, T0)).toEqual({ open: 1, today: 1, simulated: true });
  });

  test("a collector that stops sending shows its alert as ended at the last frame, still open until somebody acknowledges it", async () => {
    const p = await plant("quiet-secret");
    await env.caller({ role: "owner", companyId: p.companyId }).press.collector.setThreshold({ pressLineId: null, metric: "pressure", min: null, max: 200 });
    const now = Date.now();
    const real = (seq: number, ms: number, over: Record<string, unknown>) => ({ ...frame(seq, 0, over), at: new Date(ms).toISOString() });
    // Line P1 went quiet 6 minutes ago with the alert still open in the table.
    await p.post([real(1, now - 6 * 60_000, { pressureBar: 230 })], { nowMs: now });
    const stored = await env.db.select().from(pressAlert).where(and(eq(pressAlert.companyId, p.companyId), isNull(pressAlert.endedAt)));
    expect(stored).toHaveLength(1);
    const viewer = env.caller({ role: "viewer", companyId: p.companyId });
    // BACKLOG 81: open = not acknowledged. The quiet line reads as ended at its last frame but is still open.
    const [quiet] = await viewer.press.collector.alerts({ openOnly: true, limit: 10 });
    expect(quiet!.endedAt).toEqual(new Date(now - 6 * 60_000));
    expect(await viewer.press.collector.openAlertCount()).toEqual({ open: 1, all: 1, simulated: true });
    const [listed] = await viewer.press.collector.alerts({ openOnly: false, limit: 10 });
    expect(listed!.endedAt).toEqual(new Date(now - 6 * 60_000));
    expect(await lib.pressAlertsToday(env.db, p.companyId, now - 3_600_000)).toEqual({ open: 1, today: 1, simulated: true });
    // A fresh one (a minute old) is open too, and not ended.
    const line2 = crypto.randomUUID();
    await env.db.insert(pressLine).values({ id: line2, companyId: p.companyId, code: "P2", name: "Press 2" });
    await p.post([real(2, now - 60_000, { line: "P2", pressureBar: 240 })], { nowMs: now });
    expect(await viewer.press.collector.openAlertCount()).toEqual({ open: 2, all: 2, simulated: true });
    const openNow = await viewer.press.collector.alerts({ openOnly: true, limit: 10 });
    expect(openNow.map((x) => x.lineCode).sort()).toEqual(["P1", "P2"]);
    expect(openNow.find((x) => x.lineCode === "P2")!.endedAt).toBeNull();
    // Acknowledging the quiet one closes it: it leaves the open list and the count.
    await env.caller({ role: "owner", companyId: p.companyId }).press.collector.acknowledgeAlert({ id: quiet!.id });
    expect((await viewer.press.collector.alerts({ openOnly: true, limit: 10 })).map((x) => x.lineCode)).toEqual(["P2"]);
    expect(await viewer.press.collector.openAlertCount()).toEqual({ open: 1, all: 2, simulated: true });
  });

  test("changing a band ends the alerts opened under the old one (m-10)", async () => {
    const p = await plant("band-secret");
    const owner = env.caller({ role: "owner", companyId: p.companyId });
    await owner.press.collector.setThreshold({ pressLineId: p.lineId, metric: "billet_temp", min: 470, max: 500 });
    await p.post([frame(1, 0, { billetTempC: 505 }), frame(2, 2, { billetTempC: 507 })]);
    await owner.press.collector.setThreshold({ pressLineId: p.lineId, metric: "billet_temp", min: 470, max: 510 });
    const [a] = await env.db.select().from(pressAlert).where(eq(pressAlert.companyId, p.companyId));
    expect(a!.endedAt).toEqual(at(2));
    // The next out-of-band frame opens a new alert under the new band.
    await p.post([frame(3, 4, { billetTempC: 515 })]);
    const rows = await env.db.select().from(pressAlert).where(eq(pressAlert.companyId, p.companyId));
    expect(rows.filter((r) => r.endedAt == null)).toEqual([expect.objectContaining({ limitX10: 5100, peakX10: 5150 })]);
  });
});

describe("review round 1: D1 limits, per-frame refusal, retention, Q-09 both bases", () => {
  test("150 line codes in one ingest stay under 100 bound parameters per statement (m-1)", async () => {
    const { companyId } = await env.seedCompany();
    const n = await collectorNode(companyId, "many-lines");
    const lineIds: string[] = [];
    for (let i = 0; i < 150; i += 1) {
      const id = crypto.randomUUID();
      lineIds.push(id);
      await env.db.insert(pressLine).values({ id, companyId, code: `L${i}`, name: `Line ${i}` });
    }
    const sectionId = await env.seedDie(companyId);
    for (let i = 0; i < 150; i += 1) {
      await env.db.insert(pressRun).values({ id: crypto.randomUUID(), companyId, number: `PR-M${i}`, period: "2026-27", status: "running", sectionId, pressLineId: lineIds[i]!, startedAt: at(0), productionDay: "2026-10-24", shiftSeq: 1 });
    }
    await env.caller({ role: "owner", companyId }).press.collector.setThreshold({ pressLineId: null, metric: "ram_speed", min: 2, max: 12 });
    const frames = lineIds.map((_, i) => lib.pressFrameSchema.parse(frame(i + 1, 10, { line: `L${i}`, ramSpeedMmS: i % 2 ? 15 : 8 })));
    const nodeRow = { id: n.nodeId, companyId, instanceId: n.instanceId };
    const r = await lib.ingestPressFrames(env.db, nodeRow, frames, T0 + 60_000);
    expect(r).toMatchObject({ accepted: 150, bound: 150, rejected: [], alertsOpened: 75 });
    // The next page (all 150 lines again) reads the open alerts and stale runs in chunks too.
    const again = await lib.ingestPressFrames(env.db, nodeRow, frames.map((f) => ({ ...f, seq: f.seq + 1000, at: iso(12) })), T0 + 60_000);
    expect(again).toMatchObject({ accepted: 150, alertsOpened: 0 });
  });

  test("one out-of-range reading refuses that frame, not the page (m-2)", async () => {
    const p = await plant("range-secret");
    const r = await p.post([frame(1, 0), frame(2, 2, { ramSpeedMmS: 5000 }), frame(3, 4), { seq: "x" }]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ accepted: 2, rejected: [{ seq: 2, reason: "invalid" }, { seq: -1, reason: "invalid" }] });
  });

  test("a tampered body under a valid token is refused (m-12)", async () => {
    const p = await plant("tamper-secret");
    const rawBody = enc({ instance_id: p.instanceId, frames: [frame(1, 10)] });
    const nowMs = T0 + 3600_000;
    const token = await crypto_.signSpoolRequest("POST", lib.PRESS_FRAMES_PATH, rawBody, "tamper-secret", nowMs);
    const tampered = enc({ instance_id: p.instanceId, frames: [frame(1, 10, { ramSpeedMmS: 99 })] });
    const res = await node.handlePressFramesRequest(env.db, { rawBody: tampered, authorization: `Bearer ${token}`, masterKey: DEV_MASTER_KEY, nowMs });
    expect(res.status).toBe(403);
    expect(await env.db.select().from(pressCollectorFrame).where(eq(pressCollectorFrame.nodeId, p.nodeId))).toHaveLength(0);
  });

  test("the daily job purges simulated frames after 24 h and real frames after 90 days; summaries stay (m-6)", async () => {
    const p = await plant("purge-secret");
    const runId = await p.run({ startSec: 0, stopSec: 600, status: "logged" });
    const day = 86_400_000;
    await p.post([frame(1, 10), frame(2, 20), frame(3, 30, { simulated: false }), frame(4, 40, { simulated: false })]);
    expect(await lib.refreshRunCollector(env.db, p.companyId, runId)).toMatchObject({ frames: 4 });
    // A day and a bit later: the simulated frames go, the real ones stay. (The purge is for every
    // company, so other tests' frames in this database count too.)
    let out = await lib.purgeCollectorFrames(env.db, T0 + day + 60_000);
    expect(out.simulated).toBeGreaterThanOrEqual(2);
    let left = await env.db.select().from(pressCollectorFrame).where(eq(pressCollectorFrame.nodeId, p.nodeId));
    expect(left.map((f) => f.seq).sort()).toEqual([3, 4]);
    // 91 days later the real frames go too; the run's summary is kept as the record.
    out = await lib.purgeCollectorFrames(env.db, T0 + 91 * day);
    expect(out.real).toBeGreaterThanOrEqual(2);
    left = await env.db.select().from(pressCollectorFrame).where(eq(pressCollectorFrame.nodeId, p.nodeId));
    expect(left).toHaveLength(0);
    expect(await env.caller({ role: "viewer", companyId: p.companyId }).press.collector.runSummary({ runId })).toMatchObject({ frames: 4 });
    expect(lib.COLLECTOR_FRAME_RETENTION).toEqual({ simulatedMs: day, realMs: 90 * day });
  });

  test("Q-09 checks weight and count: either beyond 2 % flags the run (m-9)", async () => {
    const p = await plant("both-secret");
    const runId = await p.run({ startSec: 0, stopSec: 600, status: "logged", inputG: 400_000 });
    const castId = crypto.randomUUID();
    await env.db.insert(cast).values({ id: castId, companyId: p.companyId, number: "K77", period: "2026-10", year: 2026, month: 10, seq: 77, alloy: "6063", openedAt: at(0) });
    await env.db.insert(pressBilletUse).values({ id: crypto.randomUUID(), companyId: p.companyId, pressRunId: runId, line: 1, castId, count: 10, kgG: 400_000 });
    // Weight agrees (401 kg, 0.25 %), but the counter saw 11 billets for 10 typed (10 %).
    await p.post([frame(1, 10, { billetGTotal: 0, billetsTotal: 0 }), frame(2, 300, { billetGTotal: 200_000, billetsTotal: 6 }), frame(3, 590, { billetGTotal: 401_000, billetsTotal: 11 })]);
    const s = await env.db.select().from(pressRunCollector).where(eq(pressRunCollector.pressRunId, runId)).get();
    expect(s).toMatchObject({ varianceBasis: "count", varianceBp: 1000, collectorVariance: true, billetsCounted: 11 });
  });
});

describe("heartbeat: optional collector telemetry never breaks presence (I-2)", () => {
  test("a 5 KB lastError is truncated; a malformed entry is dropped; the beat is accepted", async () => {
    const p = await plant("hb-long");
    const collectors = [
      { kind: "press", line: "P1", source: "sim", configured: true, simulated: true, connected: false, lastFrameAt: null, lastError: "x".repeat(5 * 1024) },
      { kind: "laser", source: "?", configured: true, simulated: false },
      { kind: "spectro", source: "watch_dir_with_a_very_long_name_indeed", configured: true, simulated: false, connected: true, lastFrameAt: null },
    ];
    const body = enc({ instance_id: p.instanceId, version: "1.2.3", collectors });
    const now = Date.parse("2026-10-24T06:30:00Z");
    const token = await crypto_.signSpoolRequest("POST", "/webhooks/spool/activate", body, "hb-long", now);
    const res = await hb.handleNodeHeartbeat(env.db, { rawBody: body, authorization: `Bearer ${token}`, masterKey: DEV_MASTER_KEY, nowMs: now });
    expect(res.status).toBe(200);
    const row = await env.db.select().from(spoolDeployment).where(eq(spoolDeployment.id, p.nodeId)).get();
    expect(row!.lastHeartbeatAt?.getTime()).toBe(now);
    expect(row!.runtimeVersion).toBe("1.2.3");
    expect(row!.collectors).toHaveLength(2);
    expect(row!.collectors![0]!.lastError).toBe("x".repeat(200));
    expect(row!.collectors![1]).toMatchObject({ kind: "spectro", source: "watch_dir_with_a_very_long_name_" });
  });
});
