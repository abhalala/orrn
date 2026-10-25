/**
 * W4-COLLECTORS press collector seam (FP-PR-21 / FP-PR-22): node-signed frames, idempotency on
 * (node, seq), run binding by time window, the Q-09 2 % variance annotation (the run is never
 * written), threshold alerts, heartbeat presence and permissions (node HMAC only).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { wrapSecret } from "@orrn/crypto";
import { pressAlert, pressCollectorFrame, pressRunCollector } from "@orrn/db/schema/collector";
import { pressBilletUse, pressLine, pressRun } from "@orrn/db/schema/press";
import { cast } from "@orrn/db/schema/foundry";
import { spoolDeployment } from "@orrn/db/schema/spool";
import { and, eq } from "drizzle-orm";

import { DEV_MASTER_KEY } from "./env-mock";
import { createTestEnv, type TestEnv } from "./harness";

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

const T0 = Date.parse("2026-10-24T06:00:00.000Z");
const at = (sec: number) => new Date(T0 + sec * 1000);
const iso = (sec: number) => at(sec).toISOString();
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

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
  const run = async (o: { startSec: number; stopSec?: number | null; status?: "running" | "stopped" | "logged" | "queued"; inputG?: number | null; lineId?: string }) => {
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
    const [a] = await env.caller({ role: "viewer", companyId: p.companyId }).press.collector.alerts({ openOnly: true, limit: 10 });
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

    // Today chip: one open, two today, simulated.
    const today = await lib.pressAlertsToday(env.db, p.companyId, T0);
    expect(today).toEqual({ open: 1, today: 2, simulated: true });
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
