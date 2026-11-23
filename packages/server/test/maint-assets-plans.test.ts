/**
 * XE parity lane MAINT, rows 63 and 64: the asset register (optionally pointing at a press, furnace or
 * oven, one asset per master) and preventive plans by days, run hours or both. Run hours come from press
 * runs (minus downtime on them), locked melts and oven batches; voided runs, cancelled melts and void
 * batches never count. Another plant gets "Not found".
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { auditLog, maintAsset } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { DAY, H, NOON, errOf, maintPlant } from "./maint-fixture";

setDefaultTimeout(30_000);

let env: TestEnv;
let setClock: (at: Date | null) => void;

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
}, 60_000);
afterEach(() => setClock(null));
afterAll(async () => {
  await env.dispose();
});

const plant = maintPlant(() => env);
const at = (ms: number) => new Date(NOON.getTime() + ms);

const asset = (over: Record<string, unknown> = {}) => ({
  code: "CMP-1",
  name: "Air compressor",
  kind: "compressor" as const,
  criticality: "B" as const,
  status: "running" as const,
  ...over,
});

describe("asset register (#63)", () => {
  test("create, read, update; codes and masters are unique; audit rows", async () => {
    setClock(NOON);
    const p = await plant();
    const { id } = await p.manager.maint.assets.create(asset({ make: "Elgi", serialNo: "E-99", purchasedOn: "2024-04-01", warrantyUntil: "2027-03-31", location: "Back yard" }));
    const press = await p.manager.maint.assets.create(asset({ code: "PRESS-1", name: "Press 1", kind: "press", linkKind: "press", linkId: p.lineId, criticality: "A" }));
    const got = await p.operator.maint.assets.get({ id: press.id });
    expect(got.asset).toMatchObject({ code: "PRESS-1", kind: "press", linkKind: "press", criticality: "A" });
    expect(got.link).toMatchObject({ kind: "press", code: "P1" });
    expect(await errOf(p.manager.maint.assets.create(asset({ code: "cmp-1" })))).toEqual({ code: "CONFLICT", message: "Another asset already has that code" });
    expect(await errOf(p.manager.maint.assets.create(asset({ code: "X", linkKind: "press", linkId: p.lineId })))).toEqual({
      code: "CONFLICT",
      message: "Another asset already points at that press, furnace or oven",
    });
    const before = (await p.manager.maint.assets.get({ id })).asset;
    await p.supervisor.maint.assets.update({ id, serverSeq: before.serverSeq, ...asset({ status: "standby", criticality: "A", make: "Elgi" }) });
    expect((await p.manager.maint.assets.get({ id })).asset).toMatchObject({ status: "standby", criticality: "A", make: "Elgi", serialNo: null });
    expect(await errOf(p.supervisor.maint.assets.update({ id, serverSeq: before.serverSeq, ...asset() }))).toMatchObject({ code: "CONFLICT" });
    const list = await p.office.maint.assets.list();
    expect(list.map((a) => a.code)).toEqual(["CMP-1", "PRESS-1"]);
    const audits = await env.db.select({ action: auditLog.action }).from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.subjectType, "maint_asset")));
    expect(audits.map((a) => a.action).sort()).toEqual(["maint.asset.create", "maint.asset.create", "maint.asset.update"]);
  });

  test("another plant's ids are Not found; a master of another plant is refused", async () => {
    setClock(NOON);
    const p = await plant();
    const q = await plant();
    const { id } = await p.manager.maint.assets.create(asset());
    expect(await errOf(q.manager.maint.assets.get({ id }))).toEqual({ code: "NOT_FOUND", message: "Not found" });
    expect(await errOf(q.manager.maint.assets.update({ id, serverSeq: 0, ...asset() }))).toMatchObject({ code: "NOT_FOUND" });
    expect(await errOf(q.manager.maint.plans.create({ assetId: id, title: "Oil", intervalDays: 30 }))).toMatchObject({ code: "NOT_FOUND" });
    expect(await errOf(q.manager.maint.assets.create(asset({ linkKind: "press", linkId: p.lineId })))).toEqual({ code: "BAD_REQUEST", message: "That press, furnace or oven is not in this plant" });
    expect(await q.manager.maint.assets.list()).toHaveLength(0);
  });

  test("permissions: viewer and packer see nothing; operator reads but cannot set up", async () => {
    setClock(NOON);
    const p = await plant();
    expect(await errOf(p.viewer.maint.assets.list())).toMatchObject({ code: "FORBIDDEN" });
    expect(await errOf(p.packer.maint.assets.list())).toMatchObject({ code: "FORBIDDEN" });
    expect(await errOf(p.operator.maint.assets.create(asset()))).toMatchObject({ code: "FORBIDDEN" });
    expect(await errOf(p.storekeeper.maint.assets.create(asset()))).toMatchObject({ code: "FORBIDDEN" });
    expect(await p.operator.maint.assets.list()).toEqual([]);
  });

  test("the module gate covers reads and writes", async () => {
    setClock(NOON);
    const p = await plant({ modules: ["press", "store"] });
    expect(await errOf(p.owner.maint.assets.list())).toEqual({ code: "FORBIDDEN", message: "That module is not on for this plant" });
    expect(await errOf(p.owner.maint.assets.create(asset()))).toMatchObject({ code: "FORBIDDEN" });
    expect(await errOf(p.owner.maint.today())).toMatchObject({ code: "FORBIDDEN" });
  });

  test("add from masters makes one asset per press, furnace and oven, once", async () => {
    setClock(NOON);
    const p = await plant();
    await p.furnace();
    await p.oven();
    await p.manager.maint.assets.create(asset({ code: "P1" }));
    expect(await p.admin.maint.assets.addFromMasters()).toEqual({ added: 3 });
    expect(await p.admin.maint.assets.addFromMasters()).toEqual({ added: 0 });
    const rows = await env.db.select({ code: maintAsset.code, linkKind: maintAsset.linkKind, criticality: maintAsset.criticality }).from(maintAsset).where(eq(maintAsset.companyId, p.companyId));
    expect(rows.map((r) => `${r.code}:${r.linkKind}:${r.criticality}`).sort()).toEqual(["F1:furnace:A", "OV-1:oven:B", "P1-2:press:A", "P1:null:B"]);
    const options = await p.manager.maint.assets.linkOptions();
    expect(options.every((o) => o.asset !== null)).toBe(true);
  });
});

describe("preventive plans (#64)", () => {
  test("calendar plan: due in 30 days, overdue after, listed on Today", async () => {
    setClock(NOON);
    const p = await plant();
    const { id: assetId } = await p.manager.maint.assets.create(asset());
    await p.manager.maint.plans.create({ assetId, title: "Drain the tank", intervalDays: 30 });
    setClock(at(23 * DAY));
    let due = await p.operator.maint.plans.due();
    expect(due[0]!.due).toMatchObject({ state: "soon", daysLeft: 7, basis: "days" });
    setClock(at(31 * DAY));
    due = await p.operator.maint.plans.due();
    expect(due[0]!.due).toMatchObject({ state: "overdue", daysLeft: -1 });
    const today = await p.supervisor.maint.today();
    expect(today).toMatchObject({ overdue: 1, soon: 0, liveWorkOrders: 0 });
    expect(today.top.map((t) => t.title)).toEqual(["Drain the tank"]);
  });

  test("run hours on an unlinked asset are refused; a plan needs an interval", async () => {
    setClock(NOON);
    const p = await plant();
    const { id: assetId } = await p.manager.maint.assets.create(asset());
    expect(await errOf(p.manager.maint.plans.create({ assetId, title: "Oil", intervalHours: 2000 }))).toEqual({
      code: "BAD_REQUEST",
      message: "This asset has no run hours. Link it to a press, furnace or oven, or plan by days",
    });
    expect(await errOf(p.manager.maint.plans.create({ assetId, title: "Oil" }))).toEqual({ code: "BAD_REQUEST", message: "A plan needs days, run hours or both" });
    expect(await errOf(p.operator.maint.plans.create({ assetId, title: "Oil", intervalDays: 3 }))).toMatchObject({ code: "FORBIDDEN" });
  });

  test("press run hours: runs minus their downtime, voided runs left out, a running run counts to now", async () => {
    setClock(NOON);
    const p = await plant();
    const { id: assetId } = await p.manager.maint.assets.create(asset({ code: "PRESS-1", kind: "press", linkKind: "press", linkId: p.lineId }));
    await p.manager.maint.plans.create({ assetId, title: "Hydraulic oil", intervalHours: 10 });
    // 4 h run with 1 h downtime on it = 3 h; a voided 5 h run = 0; a run that began before the plan counts from the plan.
    const r1 = await p.run(at(H), at(5 * H));
    await p.downtime(at(2 * H), at(3 * H), "breakdown", r1);
    await p.run(at(6 * H), at(11 * H), "voided");
    await p.run(at(-2 * H), at(H)); // 1 h after the plan began
    // Running since 12 h; it is now 14 h: 2 h.
    await p.run(at(12 * H), null, "running");
    setClock(at(14 * H));
    const [row] = await p.manager.maint.plans.due();
    expect(row!.due).toMatchObject({ hoursRun: 6, hoursLeft: 4, state: "ok", basis: "hours" });
    setClock(at(17 * H));
    const [later] = await p.manager.maint.plans.due();
    // 3 more running hours: 9 h run, 1 h left (soon: the last hour of a 10 h plan).
    expect(later!.due).toMatchObject({ hoursRun: 9, hoursLeft: 1, state: "soon" });
  });

  test("furnace and oven hours: locked melts and batches only", async () => {
    setClock(NOON);
    const p = await plant();
    const f = await p.furnace();
    const o = await p.oven();
    const fa = await p.manager.maint.assets.create(asset({ code: "F1", kind: "furnace", linkKind: "furnace", linkId: f }));
    const oa = await p.manager.maint.assets.create(asset({ code: "OV1", kind: "oven", linkKind: "oven", linkId: o }));
    await p.manager.maint.plans.create({ assetId: fa.id, title: "Refractory check", intervalHours: 100 });
    await p.manager.maint.plans.create({ assetId: oa.id, title: "Fan belt", intervalHours: 100, intervalDays: 365 });
    await p.melt(f, at(H), at(4 * H));
    await p.melt(f, at(5 * H), at(9 * H), "cancelled");
    await p.batch(o, at(H), at(3 * H));
    await p.batch(o, at(4 * H), at(9 * H), "void");
    await p.batch(o, at(10 * H), null, "in_oven");
    setClock(at(12 * H));
    const due = await p.manager.maint.plans.due();
    const byTitle = Object.fromEntries(due.map((d) => [d.title, d.due]));
    expect(byTitle["Refractory check"]).toMatchObject({ hoursRun: 3 });
    expect(byTitle["Fan belt"]).toMatchObject({ hoursRun: 4 });
  });

  test("removing the link of an asset with an hours plan is refused", async () => {
    setClock(NOON);
    const p = await plant();
    const { id } = await p.manager.maint.assets.create(asset({ code: "PRESS-1", kind: "press", linkKind: "press", linkId: p.lineId }));
    await p.manager.maint.plans.create({ assetId: id, title: "Oil", intervalHours: 500 });
    const { asset: row } = await p.manager.maint.assets.get({ id });
    expect(await errOf(p.manager.maint.assets.update({ id, serverSeq: row.serverSeq, ...asset({ code: "PRESS-1", kind: "press" }) }))).toEqual({
      code: "BAD_REQUEST",
      message: "Plans on this asset run on run hours. Change them to days before you remove the link",
    });
  });
});
