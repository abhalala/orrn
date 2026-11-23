/**
 * XE parity lane DEVICES (module `devices`, opt-in). Row 95: device enrolment with a token per device,
 * revoke, rotate, heartbeat and health, replay idempotency (device + token version + epoch + seq), clock
 * skew, the edge buffer. Row 48: weighbridge tickets on a scrap lot and a dispatch, the typed fallback with
 * a reason and the kanta check. Rows 40 and 94: scanner and tensile readings become quality checks by the
 * sample code; simulated readings never do. Every procedure: another plant gets "Not found", the permission
 * refusal, the module gate, the happy path.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { wrapSecret } from "@orrn/crypto";
import { auditLog, company, deviceReading, deviceReadingUse, plantDevice, pressRun, purchaseLot, qaCheck, qaPlan, spoolDeployment } from "@orrn/db/schema";
import {
  DEVICE_CONFIG_PATH,
  DEVICE_HEARTBEAT_PATH,
  DEVICE_READINGS_PATH,
  EdgeDeviceBuffer,
  FakeModbusDevice,
  FakeOpcUaDevice,
  decodeModbusField,
  modbusTcpConfigSchema,
  opcUaConfigSchema,
  readModbus,
  readOpcUa,
  weighReadingFromFields,
  type DeviceReadingWire,
} from "@orrn/edge-runtime/devices";

import { clearEdgeV1ReplayCache } from "../src/lib/edge-v1";
import { can as canMe, type Action } from "../src/lib/permissions";
import { signSpoolRequest } from "../src/lib/spool-crypto";
import { DEV_MASTER_KEY } from "./env-mock";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";
import { pressHelpers } from "./press-w2-fixture";
import { salesHelpers } from "./sales-fixture";

setDefaultTimeout(60_000);

let env: TestEnv;
let edge: typeof import("../src/lib/deviceEdge");
beforeAll(async () => {
  env = await createTestEnv();
  edge = await import("../src/lib/deviceEdge");
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const ROLES: CompanyRole[] = ["owner", "admin", "manager", "office", "accountant", "supervisor", "packer", "foundry", "press", "storekeeper", "die_room", "operator", "viewer"];
const can = (role: CompanyRole, action: Action) => canMe({ company: { role }, isPlatformAdmin: false, platformRole: null }, action);
const MODULE_OFF = "That module is not on for this plant";
const KG = 1000;
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

const { plant: salesPlant } = salesHelpers(() => env);
const { pressPlant } = pressHelpers(() => env);

async function devicesOn(companyId: string, modules: string[] = ["devices"]) {
  await env.db.update(company).set({ modules }).where(eq(company.id, companyId));
}

/** An edge node (edge v1 deployment) of a plant, with its shared secret. */
async function edgeNode(companyId: string, secret = `node-secret-${crypto.randomUUID()}`) {
  const id = crypto.randomUUID();
  const instanceId = crypto.randomUUID();
  await env.db.insert(spoolDeployment).values({
    id,
    companyId,
    instanceId,
    status: "active",
    subdomain: `dv-${id.slice(0, 8)}`,
    nodeDomain: `dv-${id.slice(0, 8)}.spool.orrn.in`,
    cfTunnelTokenWrapped: await wrapSecret("tunnel", DEV_MASTER_KEY),
    sharedSecretHash: "hash",
    sharedSecretWrapped: await wrapSecret(secret, DEV_MASTER_KEY),
  });
  return { id, instanceId, secret };
}

type Node = Awaited<ReturnType<typeof edgeNode>>;
let tick = Date.now();

/** A signed device call, as the edge sends it. Every call gets a fresh timestamp (the replay cache is on). */
async function call(path: string, node: Node, body: unknown, device?: { id: string; token: string }, nowMs?: number) {
  tick += 7;
  const raw = body === null ? null : enc(body);
  const method = path === DEVICE_CONFIG_PATH ? "GET" : "POST";
  const at = nowMs ?? tick;
  const token = await signSpoolRequest(method, path, raw, node.secret, at);
  const input = { rawBody: raw, path, nodeIdHeader: node.instanceId, authorization: `Bearer ${token}`, deviceIdHeader: device?.id, deviceTokenHeader: device?.token, masterKey: DEV_MASTER_KEY, nowMs: at };
  if (path === DEVICE_READINGS_PATH) return edge.handleDeviceReadings(env.db, input);
  if (path === DEVICE_HEARTBEAT_PATH) return edge.handleDeviceHeartbeat(env.db, input);
  return edge.handleDeviceConfig(env.db, input);
}

const iso = (ms: number) => new Date(ms).toISOString();
const weighReading = (seq: number, o: Partial<{ ticketNo: string; vehicleNo: string; grossG: number; tareG: number; atMs: number }> = {}): DeviceReadingWire => ({
  kind: "weighbridge",
  seq,
  sampledAt: iso(o.atMs ?? Date.now() - 60_000),
  ticketNo: o.ticketNo ?? `T-${seq}`,
  vehicleNo: o.vehicleNo ?? "GJ05AB1234",
  grossG: o.grossG ?? 18_400 * KG,
  tareG: o.tareG ?? 7_200 * KG,
});

async function auditActions(companyId: string) {
  return (await env.db.select({ action: auditLog.action, meta: auditLog.meta }).from(auditLog).where(eq(auditLog.companyId, companyId))).map((r) => r.action);
}

describe("permissions and the module gate", () => {
  test("the matrix", () => {
    const holders = (a: Action) => ROLES.filter((r) => can(r, a));
    expect(holders("device.view")).toEqual(["owner", "admin", "manager", "office", "supervisor", "storekeeper"]);
    expect(holders("device.manage")).toEqual(["owner", "admin", "manager"]);
  });

  test("off by default: a plant on [] sees nothing and enrols nothing", async () => {
    const { companyId } = await env.seedCompany();
    const owner = env.caller({ role: "owner", companyId });
    await expect(owner.devices.list()).rejects.toMatchObject({ code: "FORBIDDEN", message: MODULE_OFF });
    await expect(owner.devices.health()).rejects.toMatchObject({ code: "FORBIDDEN", message: MODULE_OFF });
    await expect(owner.devices.enrol({ code: "WB-1", label: "Gate bridge", kind: "weighbridge", protocol: "file" })).rejects.toMatchObject({ code: "FORBIDDEN", message: MODULE_OFF });
    await expect(owner.devices.weigh.mismatches()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.devices.lab.inbox()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("row 95: enrolment, tokens, health", () => {
  test("enrol shows the token once; list never carries it; rotate and revoke; tenancy and permission", async () => {
    const { companyId } = await env.seedCompany({ modules: ["devices"] });
    const other = await env.seedCompany({ modules: ["devices"] });
    const admin = env.caller({ role: "admin", companyId });
    const node = await edgeNode(companyId);
    const e = await admin.devices.enrol({ code: "wb-1", label: "Gate bridge", kind: "weighbridge", protocol: "modbus_tcp", deploymentId: node.id, config: { host: "10.0.0.20", fields: [{ field: "grossG", address: 0, words: 2, scale: 10 }] } });
    expect(e.token).toMatch(/^odv_[0-9a-f]{64}$/);
    expect(e.tokenHint).toBe(e.token.slice(-4));
    const row = (await env.db.select().from(plantDevice).where(eq(plantDevice.id, e.id)))[0]!;
    expect(row.code).toBe("WB-1");
    expect(row.tokenHash).not.toBe(e.token);
    expect(JSON.stringify(await env.db.select().from(auditLog).where(eq(auditLog.companyId, companyId)))).not.toContain(e.token);

    const list = await env.caller({ role: "supervisor", companyId }).devices.list();
    expect(list.devices).toHaveLength(1);
    expect(list.devices[0]).toMatchObject({ code: "WB-1", health: "never", simulated: false, hasConfig: true, tokenHint: e.tokenHint });
    expect(JSON.stringify(list)).not.toContain("tokenHash");
    expect(list.sources.map((s) => s.kind)).toContain("edge_node");

    await expect(admin.devices.enrol({ code: "WB-1", label: "again", kind: "weighbridge", protocol: "file" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(admin.devices.enrol({ code: "X", label: "bad", kind: "weighbridge", protocol: "file" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(admin.devices.enrol({ code: "OPC-1", label: "bad map", kind: "plc", protocol: "opc_ua", config: { endpoint: "http://x", nodes: [] } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Another plant's edge box is "Not found".
    await expect(env.caller({ role: "admin", companyId: other.companyId }).devices.enrol({ code: "WB-9", label: "x", kind: "weighbridge", protocol: "file", deploymentId: node.id })).rejects.toMatchObject({ code: "NOT_FOUND" });

    for (const role of ROLES.filter((r) => !can(r, "device.manage"))) {
      await expect(env.caller({ role, companyId }).devices.revoke({ id: e.id, reason: "lost" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    for (const role of ROLES.filter((r) => !can(r, "device.view"))) {
      await expect(env.caller({ role, companyId }).devices.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const otherAdmin = env.caller({ role: "admin", companyId: other.companyId });
    await expect(otherAdmin.devices.revoke({ id: e.id, reason: "x x" })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Not found" });
    await expect(otherAdmin.devices.rotateToken({ id: e.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(otherAdmin.devices.update({ id: e.id, label: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await otherAdmin.devices.list()).devices).toEqual([]);

    const r = await admin.devices.rotateToken({ id: e.id });
    expect(r.tokenVersion).toBe(2);
    expect(r.token).not.toBe(e.token);
    await admin.devices.update({ id: e.id, label: "Gate bridge 60 t", heartbeatSec: 30 });
    await admin.devices.revoke({ id: e.id, reason: "Indicator replaced" });
    await expect(admin.devices.revoke({ id: e.id, reason: "again" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(admin.devices.rotateToken({ id: e.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await admin.devices.list()).devices[0]).toMatchObject({ health: "revoked", label: "Gate bridge 60 t" });
    expect(await auditActions(companyId)).toEqual(expect.arrayContaining(["device.enrol", "device.token", "device.update", "device.revoke"]));
  });

  test("the edge: node signature AND device token; revoked, wrong token, other node, module off", async () => {
    const { companyId } = await env.seedCompany({ modules: ["devices"] });
    const admin = env.caller({ role: "admin", companyId });
    const node = await edgeNode(companyId);
    const otherNode = await edgeNode(companyId);
    const e = await admin.devices.enrol({ code: "WB-1", label: "Gate bridge", kind: "weighbridge", protocol: "file", deploymentId: node.id });
    const dev = { id: e.id, token: e.token };
    const body = { sentAt: iso(Date.now()), epoch: "e1", readings: [weighReading(0)] };

    expect(await call(DEVICE_READINGS_PATH, node, body)).toMatchObject({ status: 401, body: { code: "missing_device" } });
    expect(await call(DEVICE_READINGS_PATH, node, body, { id: e.id, token: "odv_wrong" })).toMatchObject({ status: 403, body: { code: "invalid_device_token" } });
    expect(await call(DEVICE_READINGS_PATH, otherNode, body, dev)).toMatchObject({ status: 403, body: { code: "unknown_device" } });
    // A bad node signature never reaches the device check.
    const raw = enc(body);
    const bad = await edge.handleDeviceReadings(env.db, { rawBody: raw, path: DEVICE_READINGS_PATH, nodeIdHeader: node.instanceId, authorization: `Bearer ${await signSpoolRequest("POST", DEVICE_READINGS_PATH, raw, "wrong")}`, deviceIdHeader: e.id, deviceTokenHeader: e.token, masterKey: DEV_MASTER_KEY });
    expect(bad).toMatchObject({ status: 403, body: { code: "invalid_signature" } });

    const ok = await call(DEVICE_READINGS_PATH, node, body, dev);
    expect(ok).toMatchObject({ status: 200, body: { accepted: [0], duplicate: [], rejected: [] } });

    // Rotation: the old token stops, the new one works.
    const r = await admin.devices.rotateToken({ id: e.id });
    expect(await call(DEVICE_READINGS_PATH, node, body, dev)).toMatchObject({ status: 403, body: { code: "invalid_device_token" } });
    expect(await call(DEVICE_HEARTBEAT_PATH, node, { sentAt: iso(Date.now()), epoch: "e1", lastSeq: 0 }, { id: e.id, token: r.token })).toMatchObject({ status: 200 });

    await devicesOn(companyId, []);
    expect(await call(DEVICE_READINGS_PATH, node, body, { id: e.id, token: r.token })).toMatchObject({ status: 403, body: { code: "module_off" } });
    expect(await call(DEVICE_CONFIG_PATH, node, null)).toMatchObject({ status: 403, body: { code: "module_off" } });
    await devicesOn(companyId);

    await admin.devices.revoke({ id: e.id, reason: "Indicator replaced" });
    expect(await call(DEVICE_READINGS_PATH, node, body, { id: e.id, token: r.token })).toMatchObject({ status: 403, body: { code: "device_revoked" } });
  });

  test("replay idempotency, epochs, skew, heartbeat, config for the edge cache", async () => {
    const { companyId } = await env.seedCompany({ modules: ["devices"] });
    const admin = env.caller({ role: "admin", companyId });
    const node = await edgeNode(companyId);
    const e = await admin.devices.enrol({ code: "WB-1", label: "Gate bridge", kind: "weighbridge", protocol: "modbus_tcp", deploymentId: node.id, config: { host: "10.0.0.20", fields: [{ field: "grossG", address: 0 }] } });
    const dev = { id: e.id, token: e.token };
    const now = Date.now();
    const first = await call(DEVICE_READINGS_PATH, node, { sentAt: iso(now), epoch: "e1", readings: [weighReading(0), weighReading(1), weighReading(1)] }, dev, now);
    expect(first.body).toMatchObject({ accepted: [0, 1], duplicate: [], rejected: [] });
    // The edge replays after a lost answer: nothing new.
    const again = await call(DEVICE_READINGS_PATH, node, { sentAt: iso(now + 50), epoch: "e1", readings: [weighReading(0), weighReading(1), weighReading(2)] }, dev, now + 50);
    expect(again.body).toMatchObject({ accepted: [2], duplicate: [0, 1] });
    // A reinstalled edge starts again at seq 0 in a new epoch: real tickets, not replays.
    const reinstall = await call(DEVICE_READINGS_PATH, node, { sentAt: iso(now + 100), epoch: "e2", readings: [weighReading(0, { ticketNo: "T-NEW" })] }, dev, now + 100);
    expect(reinstall.body).toMatchObject({ accepted: [0], duplicate: [] });
    expect((await env.db.select().from(deviceReading).where(eq(deviceReading.deviceId, e.id))).length).toBe(4);

    // A device clock 10 minutes fast: corrected, marked unconfirmed, not refused. An old buffered reading is kept.
    const fast = await call(DEVICE_READINGS_PATH, node, { sentAt: iso(now + 600_000), epoch: "e2", readings: [weighReading(1, { atMs: now + 590_000 }), weighReading(2, { atMs: now - 6 * 3600_000 }), weighReading(3, { grossG: 10, tareG: 20 })] }, dev, now + 200);
    expect(fast.body).toMatchObject({ accepted: [1, 2], rejected: [{ seq: 3, code: "tare_above_gross" }] });
    const skewed = (await env.db.select().from(deviceReading).where(and(eq(deviceReading.deviceId, e.id), eq(deviceReading.epoch, "e2"), eq(deviceReading.seq, 1))))[0]!;
    expect(skewed.timeUnconfirmed).toBe(true);
    expect(skewed.sampledAt.getTime()).toBe(now + 590_000 - (600_000 - 200));
    // In the future even after correction: refused like a press frame.
    const future = await call(DEVICE_READINGS_PATH, node, { sentAt: iso(now + 300), epoch: "e2", readings: [weighReading(4, { atMs: now + 20 * 60_000 })] }, dev, now + 300);
    expect(future.body).toMatchObject({ accepted: [], rejected: [{ seq: 4, code: "in_future" }] });
    // A weighbridge cannot send a tensile test.
    const wrong = await call(DEVICE_READINGS_PATH, node, { sentAt: iso(now + 400), epoch: "e2", readings: [{ kind: "mechanical", seq: 5, sampledAt: iso(now), sampleCode: "PR-1", tensileMpa: 200 }] }, dev, now + 400);
    expect(wrong.body).toMatchObject({ rejected: [{ seq: 5, code: "wrong_kind" }] });

    const hb = await call(DEVICE_HEARTBEAT_PATH, node, { sentAt: iso(now + 500), epoch: "e2", lastSeq: 5, buffered: 3, linkState: "ok" }, dev, now + 500);
    expect(hb).toMatchObject({ status: 200, body: { ok: true, timeUnconfirmed: false } });
    const d = (await env.db.select().from(plantDevice).where(eq(plantDevice.id, e.id)))[0]!;
    expect(d).toMatchObject({ lastEpoch: "e2", lastSeq: 5, buffered: 3, linkState: "ok" });
    expect((await admin.devices.list()).devices[0]!.health).toBe("live");

    const cfg = await call(DEVICE_CONFIG_PATH, node, null);
    expect(cfg.status).toBe(200);
    expect(cfg.body.devices).toEqual([expect.objectContaining({ id: e.id, code: "WB-1", protocol: "modbus_tcp", tokenVersion: 1, config: expect.objectContaining({ protocol: "modbus_tcp", host: "10.0.0.20", port: 502 }) })]);
    expect(JSON.stringify(cfg.body)).not.toContain(e.token);
    expect(JSON.stringify(cfg.body)).not.toContain("tokenHash");
    clearEdgeV1ReplayCache();
  });

  test("health tile counts devices and the collectors on main, sim labelled", async () => {
    const { companyId } = await env.seedCompany({ modules: ["devices"] });
    const admin = env.caller({ role: "admin", companyId });
    const node = await edgeNode(companyId);
    await env.db.update(spoolDeployment).set({ scaleConfigured: true, scaleSimulated: true, scaleLastFrameAt: new Date() }).where(eq(spoolDeployment.id, node.id));
    await admin.devices.enrol({ code: "SIM-UTM", label: "Simulator", kind: "utm", protocol: "sim", deploymentId: node.id });
    const h = await env.caller({ role: "office", companyId }).devices.health();
    expect(h).toMatchObject({ live: 1, never: 1, simulated: 2, total: 2 });
    const list = await admin.devices.list();
    expect(list.sources.find((s) => s.kind === "scale")).toMatchObject({ simulated: true, health: "live" });
    expect(list.devices[0]).toMatchObject({ simulated: true });
  });
});

describe("protocol adapters and the edge buffer (fakes only)", () => {
  test("Modbus TCP map: 16 and 32 bit, signed, swapped, scaled", async () => {
    expect(decodeModbusField({ field: "x", address: 0, words: 1, signed: true, swap: false, scale: 1 }, [0xffff])).toBe(-1);
    expect(decodeModbusField({ field: "x", address: 0, words: 2, signed: false, swap: false, scale: 10 }, [0x0001, 0x0002])).toBe(655_380);
    expect(decodeModbusField({ field: "x", address: 0, words: 2, signed: false, swap: true, scale: 1 }, [0x0002, 0x0001])).toBe(65_538);
    const cfg = modbusTcpConfigSchema.parse({
      protocol: "modbus_tcp",
      host: "10.0.0.20",
      fields: [
        { field: "grossG", address: 0, words: 2, scale: 10 },
        { field: "tareG", address: 2, words: 2, scale: 10 },
        { field: "ticketNo", address: 4 },
      ],
    });
    const fake = new FakeModbusDevice().set(0, 0x001c, 0x1380).set(2, 0x000a, 0xfc80).set(4, 101);
    const fields = await readModbus(cfg, fake.read);
    expect(fields).toEqual({ grossG: 18_400_000, tareG: 7_200_000, ticketNo: 101 });
    expect(weighReadingFromFields(fields, { seq: 0, sampledAt: iso(0), vehicleNo: "GJ05AB1234" })).toMatchObject({ kind: "weighbridge", ticketNo: "101", grossG: 18_400_000, tareG: 7_200_000 });
    expect(weighReadingFromFields({ grossG: 1, tareG: 5, ticketNo: 1 }, { seq: 0, sampledAt: iso(0) })).toBeNull();
    fake.fail = true;
    await expect(readModbus(cfg, fake.read)).rejects.toThrow("timeout");
  });

  test("OPC UA map", async () => {
    const cfg = opcUaConfigSchema.parse({ protocol: "opc_ua", endpoint: "opc.tcp://10.0.0.30:4840", nodes: [{ field: "tensileMpa", nodeId: "ns=2;s=UTM.Rm" }, { field: "elongationX10", nodeId: "ns=2;s=UTM.A", scale: 10 }] });
    expect(cfg.securityMode).toBe("SignAndEncrypt");
    const fake = new FakeOpcUaDevice();
    fake.nodes.set("ns=2;s=UTM.Rm", 215);
    fake.nodes.set("ns=2;s=UTM.A", 10.5);
    expect(await readOpcUa(cfg, fake.read)).toEqual({ tensileMpa: 215, elongationX10: 105 });
    fake.nodes.delete("ns=2;s=UTM.A");
    await expect(readOpcUa(cfg, fake.read)).rejects.toThrow("BadNodeIdUnknown");
  });

  test("the edge buffer replays after a cut and ends with every ticket once", async () => {
    const { companyId } = await env.seedCompany({ modules: ["devices"] });
    const node = await edgeNode(companyId);
    const e = await env.caller({ role: "admin", companyId }).devices.enrol({ code: "WB-1", label: "Gate bridge", kind: "weighbridge", protocol: "modbus_tcp", deploymentId: node.id, config: { host: "h", fields: [{ field: "grossG", address: 0 }] } });
    const buf = new EdgeDeviceBuffer("boot-1");
    for (let i = 0; i < 5; i += 1) buf.push({ kind: "weighbridge", sampledAt: iso(Date.now() - 1000), ticketNo: `T${i}`, vehicleNo: null, grossG: 9000, tareG: 1000 } as Omit<DeviceReadingWire, "seq">);
    // The first send lands but its answer is lost: the buffer keeps everything.
    await call(DEVICE_READINGS_PATH, node, { sentAt: iso(Date.now()), epoch: buf.epoch, readings: buf.batch(3) }, { id: e.id, token: e.token });
    expect(buf.pending).toHaveLength(5);
    const res = await call(DEVICE_READINGS_PATH, node, { sentAt: iso(Date.now()), epoch: buf.epoch, readings: buf.batch() }, { id: e.id, token: e.token });
    buf.settle(res.body as never);
    expect(res.body).toMatchObject({ accepted: [3, 4], duplicate: [0, 1, 2] });
    expect(buf.pending).toHaveLength(0);
    expect((await env.db.select().from(deviceReading).where(eq(deviceReading.deviceId, e.id))).length).toBe(5);
  });

  test("the edge route paths are the contract's", () => {
    const routes = readFileSync(join(import.meta.dir, "../../../apps/server/src/edge-v1-routes.ts"), "utf8");
    for (const p of [DEVICE_READINGS_PATH, DEVICE_HEARTBEAT_PATH, DEVICE_CONFIG_PATH]) expect(routes).toContain(`"${p}"`);
  });
});

// ---------------------------------------------------------------------------
// Row 48: weighbridge on the scrap gate and the dispatch
// ---------------------------------------------------------------------------

async function purchasePlant() {
  const { companyId } = await env.seedCompany({ modules: ["devices"] });
  const owner = env.caller({ role: "owner", companyId });
  const manager = env.caller({ role: "manager", companyId });
  const storekeeper = env.caller({ role: "storekeeper", companyId });
  await owner.stock.locations.seedDefaults();
  await manager.purchase.seedScrapDefaults();
  const items = (await manager.purchase.scrapItems.list()).items;
  const v = await manager.vendor.create({ name: "Shree Ganesh Metals" });
  const itemId = items.find((i) => i.name === "IMP BELLING")!.id;
  const lot = (vehicleNo: string | null, over: Record<string, unknown> = {}) =>
    storekeeper.purchase.lots.create({ vendorId: v.id, itemId, grade: "A", partyKgG: 11_200 * KG, fcKgG: null, ratePaise: 18_500, billBook: "main", vehicleNo: vehicleNo ?? undefined, ...(over as object) } as never);
  return { companyId, owner, manager, storekeeper, lot };
}

const csvTickets = (rows: string[]) => `Ticket No,Vehicle No,Gross,Tare,Date Time\n${rows.join("\n")}\n`;
const nowPlant = () => {
  const d = new Date(Date.now() + 330 * 60_000 - 30 * 60_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

describe("row 48: weighbridge", () => {
  test("import a ticket file (tonnes), take a ticket as the FC kanta weight, one ticket per truck", async () => {
    const p = await purchasePlant();
    const t = nowPlant();
    const imp = await p.storekeeper.devices.import.weighbridge({ unit: "t", csv: csvTickets([`T-101,GJ 05 AB 1234,18.400,7.200,${t}`, `T-102,MH12XY0001,9.000,3.000,${t}`, `T-103,,1,2,${t}`]) });
    expect(imp).toMatchObject({ added: 2, duplicate: 0, errors: [{ line: 4, code: "tare_above_gross" }] });
    // The same file again adds nothing.
    expect(await p.storekeeper.devices.import.weighbridge({ unit: "t", csv: csvTickets([`T-101,GJ 05 AB 1234,18.400,7.200,${t}`]) })).toMatchObject({ added: 0, duplicate: 1 });

    const lot = await p.lot("GJ05AB1234");
    const view = await p.storekeeper.devices.weigh.forSubject({ subjectType: "purchase_lot", subjectId: lot.id });
    expect(view.use).toBeNull();
    expect(view.tickets.sameTruck.map((x) => x.ticketNo)).toEqual(["T-101"]);
    const ticket = view.tickets.sameTruck[0]!;

    // Another truck's ticket is refused by name.
    const other = view.tickets.others.find((x) => x.ticketNo === "T-102")!;
    await expect(p.storekeeper.devices.weigh.useTicket({ subjectType: "purchase_lot", subjectId: lot.id, readingId: other.id })).rejects.toMatchObject({ message: "Ticket T-102 is for truck MH12XY0001, not GJ05AB1234" });

    const used = await p.storekeeper.devices.weigh.useTicket({ subjectType: "purchase_lot", subjectId: lot.id, readingId: ticket.id });
    expect(used.netG).toBe(11_200 * KG);
    expect((await env.db.select().from(purchaseLot).where(eq(purchaseLot.id, lot.id)))[0]!.fcKgG).toBe(11_200 * KG);
    const after = await p.storekeeper.devices.weigh.forSubject({ subjectType: "purchase_lot", subjectId: lot.id });
    expect(after.ticket?.ticketNo).toBe("T-101");
    expect(after.kanta).toMatchObject({ diffG: 0, flagged: false });

    // The same ticket on a second lot of the same truck: refused.
    const lot2 = await p.lot("GJ05AB1234");
    await expect(p.storekeeper.devices.weigh.useTicket({ subjectType: "purchase_lot", subjectId: lot2.id, readingId: ticket.id })).rejects.toMatchObject({ code: "CONFLICT" });

    // A later typed edit of FC kg through the lot form is caught as a mismatch.
    await p.storekeeper.purchase.lots.update({ id: lot.id, fcKgG: 11_000 * KG });
    const mm = await p.manager.devices.weigh.mismatches();
    expect(mm.items).toEqual([expect.objectContaining({ subjectId: lot.id, bridgeG: 11_200 * KG, currentG: 11_000 * KG })]);
    expect(await auditActions(p.companyId)).toEqual(expect.arrayContaining(["device.import", "device.weigh", "purchase_lot.update"]));
  });

  test("typed fallback: a reason, compared with the truck's ticket, flagged beyond the tolerance", async () => {
    const p = await purchasePlant();
    const t = nowPlant();
    await p.storekeeper.devices.import.weighbridge({ unit: "kg", csv: csvTickets([`55,GJ06CD0001,18400,7200,${t}`]) });
    const lot = await p.lot("GJ06CD0001");
    await expect(p.storekeeper.devices.weigh.typeWeight({ subjectType: "purchase_lot", subjectId: lot.id, typedG: 11_000 * KG, reason: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const typed = await p.storekeeper.devices.weigh.typeWeight({ subjectType: "purchase_lot", subjectId: lot.id, typedG: 11_000 * KG, reason: "Bridge display blank" });
    expect(typed.ticketNo).toBe("55");
    expect(typed.check).toMatchObject({ diffG: -200 * KG, allowedG: 56 * KG, flagged: true });
    expect((await env.db.select().from(purchaseLot).where(eq(purchaseLot.id, lot.id)))[0]!.fcKgG).toBe(11_000 * KG);
    expect((await p.manager.devices.weigh.mismatches()).items.map((m) => m.reason)).toEqual(["Bridge display blank"]);
    expect(await auditActions(p.companyId)).toContain("device.weigh_flagged");

    // Within tolerance: recorded, not flagged. With no ticket for the truck: recorded with the reason only.
    const lot3 = await p.lot("GJ06CD0003");
    const plain = await p.storekeeper.devices.weigh.typeWeight({ subjectType: "purchase_lot", subjectId: lot3.id, typedG: 5_000 * KG, reason: "No bridge ticket for this truck" });
    expect(plain).toMatchObject({ check: null, ticketNo: null });
    const uses = await env.db.select().from(deviceReadingUse).where(and(eq(deviceReadingUse.companyId, p.companyId), eq(deviceReadingUse.subjectId, lot3.id)));
    expect(uses).toEqual([expect.objectContaining({ typedG: 5_000 * KG, readingId: null, flagged: false, reason: "No bridge ticket for this truck" })]);
  });

  test("an OK lot is locked; a simulated ticket is not a weight; tenancy, permission, purchase module", async () => {
    const p = await purchasePlant();
    const other = await purchasePlant();
    const t = nowPlant();
    await p.storekeeper.devices.import.weighbridge({ unit: "t", csv: csvTickets([`T-1,GJ01AA0001,18.400,7.200,${t}`]) });
    const lot = await p.lot("GJ01AA0001");
    const tk = (await p.storekeeper.devices.weigh.forSubject({ subjectType: "purchase_lot", subjectId: lot.id })).tickets.sameTruck[0]!;

    await expect(other.storekeeper.devices.weigh.useTicket({ subjectType: "purchase_lot", subjectId: lot.id, readingId: tk.id })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Not found" });
    await expect(other.storekeeper.devices.weigh.forSubject({ subjectType: "purchase_lot", subjectId: lot.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const role of ROLES.filter((r) => !can(r, "purchase.receipt") && !can(r, "dispatch.complete"))) {
      await expect(env.caller({ role, companyId: p.companyId }).devices.weigh.useTicket({ subjectType: "purchase_lot", subjectId: lot.id, readingId: tk.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // dispatch.complete alone does not weigh a scrap lot.
    await expect(env.caller({ role: "supervisor", companyId: p.companyId }).devices.weigh.useTicket({ subjectType: "purchase_lot", subjectId: lot.id, readingId: tk.id })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const sim = (await env.db.select({ id: deviceReading.id }).from(deviceReading).where(eq(deviceReading.id, tk.id)))[0]!;
    await env.db.update(deviceReading).set({ simulated: true }).where(eq(deviceReading.id, sim.id));
    await expect(p.storekeeper.devices.weigh.useTicket({ subjectType: "purchase_lot", subjectId: lot.id, readingId: tk.id })).rejects.toMatchObject({ message: "A simulated ticket is not a weight" });
    await env.db.update(deviceReading).set({ simulated: false }).where(eq(deviceReading.id, sim.id));

    await env.db.update(purchaseLot).set({ status: "ok" }).where(eq(purchaseLot.id, lot.id));
    await expect(p.storekeeper.devices.weigh.useTicket({ subjectType: "purchase_lot", subjectId: lot.id, readingId: tk.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await env.db.select().from(deviceReadingUse).where(eq(deviceReadingUse.companyId, p.companyId))).length).toBe(0);
    await env.db.update(purchaseLot).set({ status: "booking" }).where(eq(purchaseLot.id, lot.id));

    await devicesOn(p.companyId, ["devices", "customers", "dies", "bundles"]);
    await expect(p.storekeeper.devices.weigh.useTicket({ subjectType: "purchase_lot", subjectId: lot.id, readingId: tk.id })).rejects.toMatchObject({ code: "FORBIDDEN", message: MODULE_OFF });
  });

  test("dispatch: the truck's ticket against the bundles on it", async () => {
    const p = await salesPlant();
    await devicesOn(p.companyId);
    const [s1, s2] = await p.pack(p.dieA, [{ kg: 500 }, { kg: 500 }]);
    const ids = (await env.db.query.bundle.findMany({ where: (b, o) => o.and(o.eq(b.companyId, p.companyId), o.inArray(b.serial, [s1!, s2!])) })).map((b) => b.id);
    await env.plantStock(p.companyId, ids);
    const { id } = await p.owner.dispatch.create({ vehicleNo: "GJ05AB7777", customerId: p.customerId });
    await p.as("packer").dispatch.scan({ id, serials: [s1!, s2!] });
    await p.as("office").devices.import.weighbridge({ unit: "kg", csv: csvTickets([`900,GJ05AB7777,9100,8000,${nowPlant()}`]) });
    const office = p.as("office");
    const view = await office.devices.weigh.forSubject({ subjectType: "dispatch", subjectId: id });
    expect(view.subject.weightG).toBe(1000 * KG);
    const tk = view.tickets.sameTruck[0]!;
    await expect(p.as("packer").devices.weigh.useTicket({ subjectType: "dispatch", subjectId: id, readingId: tk.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const used = await office.devices.weigh.useTicket({ subjectType: "dispatch", subjectId: id, readingId: tk.id });
    expect(used.load).toMatchObject({ diffG: -100 * KG, flagged: true });
    const after = await office.devices.weigh.forSubject({ subjectType: "dispatch", subjectId: id });
    expect(after.load).toMatchObject({ diffG: -100 * KG, flagged: true });
    expect(after.ticket?.ticketNo).toBe("900");
  });
});

// ---------------------------------------------------------------------------
// Rows 40 and 94: scanner and tensile tester into QA records
// ---------------------------------------------------------------------------

describe("rows 40 and 94: lab auto-capture", () => {
  async function labPlant() {
    const p = await pressPlant();
    await devicesOn(p.companyId);
    const r = await p.countingRun();
    const run = (await env.db.select({ number: pressRun.number, dieInstanceId: pressRun.dieInstanceId }).from(pressRun).where(eq(pressRun.id, r.runId)))[0]!;
    const admin = p.as("admin");
    const node = await edgeNode(p.companyId);
    const scanner = await admin.devices.enrol({ code: "SCAN-1", label: "Profile scanner", kind: "profile_scanner", protocol: "file", deploymentId: node.id });
    const utm = await admin.devices.enrol({ code: "UTM-1", label: "Tensile tester", kind: "utm", protocol: "opc_ua", deploymentId: node.id, config: { endpoint: "opc.tcp://10.0.0.30:4840", nodes: [{ field: "tensileMpa", nodeId: "ns=2;s=Rm" }] } });
    return { p, r, run, node, scanner: { id: scanner.id, token: scanner.token }, utm: { id: utm.id, token: utm.token } };
  }

  test("a scan naming a run becomes a dimension check; out of tolerance shows on the run and the copy", async () => {
    const { p, r, run, node, scanner } = await labPlant();
    // The quality plan holds the drawing size the scanner did not send.
    await env.db.insert(qaPlan).values({ id: crypto.randomUUID(), companyId: p.companyId, dieId: r.sectionId, dimensionsJson: [{ name: "Wall", nominalUm: 1600, minusUm: 50, plusUm: 50 }] });
    const res = await call(DEVICE_READINGS_PATH, node, {
      sentAt: iso(Date.now()),
      epoch: "e1",
      readings: [
        { kind: "dimension", seq: 0, sampledAt: iso(Date.now() - 1000), sampleCode: run.number.toLowerCase(), points: [{ name: "Width", measuredUm: 40_300, nominalUm: 40_000, minusUm: 200, plusUm: 200 }, { name: "wall", measuredUm: 1610 }] },
        { kind: "dimension", seq: 1, sampledAt: iso(Date.now() - 1000), sampleCode: "NO-SUCH-RUN", points: [{ name: "Width", measuredUm: 40_000, nominalUm: 40_000, minusUm: 200, plusUm: 200 }] },
      ],
    }, scanner);
    expect(res.body).toMatchObject({ accepted: [0, 1], captured: 1 });
    const checks = await env.db.select().from(qaCheck).where(and(eq(qaCheck.companyId, p.companyId), eq(qaCheck.pressRunId, r.runId)));
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ kind: "dimension", result: "fail", checkedBy: null, subjectType: "press_run", flagsJson: { flagged: ["Width"] } });
    expect((checks[0]!.valuesJson as { source: string; deviceCode: string }).deviceCode).toBe("SCAN-1");

    const onRun = await p.as("press").devices.lab.forSubject({ pressRunId: r.runId });
    expect(onRun).toMatchObject({ outOfTolerance: 1, items: [expect.objectContaining({ kind: "dimension", result: "fail", flagged: ["Width"], deviceCode: "SCAN-1" })] });
    const onCopy = await p.as("die_room").devices.lab.forSubject({ dieInstanceId: run.dieInstanceId! });
    expect(onCopy.outOfTolerance).toBe(1);
    // The QA register lists it like any dimension check.
    expect((await p.owner.qa.checks.list({ kind: "dimension" })).items.map((c) => c.id)).toContain(checks[0]!.id);

    // The unmatched one waits in the lab inbox; a person attaches it by the run number.
    const inbox = await p.as("supervisor").devices.lab.inbox();
    expect(inbox.items.map((i) => i.sampleCode)).toEqual(["NO-SUCH-RUN"]);
    const attached = await p.as("supervisor").devices.lab.attach({ readingId: inbox.items[0]!.id, code: run.number });
    expect(attached).toMatchObject({ result: "pass", subjectType: "press_run" });
    await expect(p.as("supervisor").devices.lab.attach({ readingId: inbox.items[0]!.id, code: run.number })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await p.as("supervisor").devices.lab.inbox()).items).toEqual([]);
    expect(await auditActions(p.companyId)).toEqual(expect.arrayContaining(["device.capture"]));

    // Tenancy and permission on the lab.
    const other = await pressPlant();
    await devicesOn(other.companyId);
    await expect(other.as("supervisor").devices.lab.attach({ readingId: inbox.items[0]!.id, code: run.number })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await other.as("supervisor").devices.lab.forSubject({ pressRunId: r.runId })).items).toEqual([]);
    await expect(p.as("packer").devices.lab.attach({ readingId: inbox.items[0]!.id, code: run.number })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("a tensile test against the temper; simulated readings never become checks; qa off waits", async () => {
    const { p, r, run, node, utm } = await labPlant();
    const temper = await p.as("manager").qa.tempers.save({ code: "T5", tensileMinMpa: 160, yieldMinMpa: 110, elongationMinX10: 80 });
    await env.db.insert(qaPlan).values({ id: crypto.randomUUID(), companyId: p.companyId, dieId: r.sectionId, temperId: temper.id });
    const res = await call(DEVICE_READINGS_PATH, node, { sentAt: iso(Date.now()), epoch: "e1", readings: [{ kind: "mechanical", seq: 0, sampledAt: iso(Date.now() - 1000), sampleCode: run.number, tensileMpa: 150, yieldMpa: 120, elongationX10: 90 }] }, utm);
    expect(res.body).toMatchObject({ captured: 1 });
    const [check] = await env.db.select().from(qaCheck).where(and(eq(qaCheck.companyId, p.companyId), eq(qaCheck.kind, "mechanical")));
    expect(check).toMatchObject({ result: "fail", temperId: temper.id, flagsJson: { low: ["tensile"] } });

    const sim = await call(DEVICE_READINGS_PATH, node, { sentAt: iso(Date.now()), epoch: "e1", simulated: true, readings: [{ kind: "mechanical", seq: 1, sampledAt: iso(Date.now() - 1000), sampleCode: run.number, tensileMpa: 200 }] }, utm);
    expect(sim.body).toMatchObject({ accepted: [1], captured: 0 });
    const inbox = await p.as("supervisor").devices.lab.inbox();
    expect(inbox.items).toEqual([expect.objectContaining({ simulated: true })]);
    await expect(p.as("supervisor").devices.lab.attach({ readingId: inbox.items[0]!.id, code: run.number })).rejects.toMatchObject({ message: "A simulated reading is not a quality check" });
    await p.as("supervisor").devices.lab.setAside({ readingId: inbox.items[0]!.id, reason: "Simulator test piece" });
    expect((await p.as("supervisor").devices.lab.inbox()).items).toEqual([]);

    // QA off: the reading is held, nothing captured, attach refuses with the module words.
    await devicesOn(p.companyId, ["devices", "customers", "dies", "bundles", "dispatches", "orders", "press", "foundry", "ageing", "store", "purchase"]);
    const off = await call(DEVICE_READINGS_PATH, node, { sentAt: iso(Date.now()), epoch: "e1", readings: [{ kind: "mechanical", seq: 2, sampledAt: iso(Date.now() - 1000), sampleCode: run.number, tensileMpa: 200 }] }, utm);
    expect(off.body).toMatchObject({ accepted: [2], captured: 0 });
    const waiting = (await p.as("supervisor").devices.lab.inbox()).items[0]!;
    await expect(p.as("supervisor").devices.lab.attach({ readingId: waiting.id, code: run.number })).rejects.toMatchObject({ code: "FORBIDDEN", message: MODULE_OFF });
  });

  test("a scanner CSV import captures by sample code", async () => {
    const { p, run } = await labPlant();
    const out = await p.as("supervisor").devices.import.lab({ kind: "dimension", csv: `sample,dimension,measured_mm,nominal_mm,minus_mm,plus_mm,time\n${run.number},Width,40.05,40,0.2,0.2,2026-11-22 09:00\nZZ-1,Width,40.05,40,0.2,0.2,2026-11-22 09:00\n` });
    expect(out).toMatchObject({ added: 2, captured: 1, waiting: 1, errors: [] });
    const again = await p.as("supervisor").devices.import.lab({ kind: "dimension", csv: `sample,dimension,measured_mm,nominal_mm,minus_mm,plus_mm,time\n${run.number},Width,40.05,40,0.2,0.2,2026-11-22 09:00\n` });
    expect(again).toMatchObject({ added: 0, duplicate: 1, captured: 0 });
  });
});
