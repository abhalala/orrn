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
    expect(await errOf(p.manager.maint.assets.create(asset({ code: "X", kind: "press", linkKind: "press", linkId: p.lineId })))).toEqual({
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

  test("an asset points only at a master of its own kind", async () => {
    setClock(NOON);
    const p = await plant();
    const f = await p.furnace();
    const refusal = { code: "BAD_REQUEST", message: "A press asset points at a press, a furnace asset at a furnace and an oven asset at an oven" };
    expect(await errOf(p.manager.maint.assets.create(asset({ linkKind: "press", linkId: p.lineId })))).toEqual(refusal);
    expect(await errOf(p.manager.maint.assets.create(asset({ code: "P", kind: "press", linkKind: "furnace", linkId: f })))).toEqual(refusal);
    const { id } = await p.manager.maint.assets.create(asset({ code: "PRESS-1", kind: "press", linkKind: "press", linkId: p.lineId }));
    const { asset: row } = await p.manager.maint.assets.get({ id });
    expect(await errOf(p.manager.maint.assets.update({ id, serverSeq: row.serverSeq, ...asset({ code: "PRESS-1", linkKind: "press", linkId: p.lineId }) }))).toEqual(refusal);
    // With no link, any kind is fine.
    await p.manager.maint.assets.update({ id, serverSeq: row.serverSeq, ...asset({ code: "PRESS-1", kind: "press" }) });
  });

  test("a plant that never set maintenance up: no Today tile figures (module on by default, no assets)", async () => {
    setClock(NOON);
    const p = await plant();
    expect(await p.supervisor.maint.today()).toBeNull();
    await p.manager.maint.assets.create(asset());
    expect(await p.supervisor.maint.today()).toMatchObject({ overdue: 0, soon: 0, liveWorkOrders: 0, top: [] });
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
    expect(today!.top.map((t) => t.title)).toEqual(["Drain the tank"]);
  });

  test("plan edits carry serverSeq; switching a plan back on counts from now", async () => {
    setClock(NOON);
    const p = await plant();
    const { id: assetId } = await p.manager.maint.assets.create(asset());
    const { id: planId } = await p.manager.maint.plans.create({ assetId, title: "Drain the tank", intervalDays: 30 });
    const read = async () => (await p.manager.maint.assets.get({ id: assetId })).plans.find((x) => x.id === planId)!;
    const v1 = await read();
    await p.manager.maint.plans.update({ id: planId, serverSeq: v1.serverSeq, title: "Drain the tank", intervalDays: 30, active: false });
    // A second manager's save from the old copy is refused, with no audit row.
    expect(await errOf(p.supervisor.maint.plans.update({ id: planId, serverSeq: v1.serverSeq, title: "Drain weekly", intervalDays: 7, active: true }))).toEqual({
      code: "CONFLICT",
      message: "This plan changed since you opened it. Open it again.",
    });
    const audits = await env.db.select({ action: auditLog.action }).from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "maint.plan.update")));
    expect(audits).toHaveLength(1);
    // Eight months off, then on again: due in 30 days from now, not overdue.
    setClock(at(240 * DAY));
    const v2 = await read();
    expect(v2.active).toBe(false);
    await p.manager.maint.plans.update({ id: planId, serverSeq: v2.serverSeq, title: "Drain the tank", intervalDays: 30, active: true });
    const v3 = await read();
    expect(v3.baseAt).toBe(at(240 * DAY).getTime());
    expect(v3.due).toMatchObject({ state: "ok", daysLeft: 30 });
    // An edit of an active plan keeps its count.
    setClock(at(250 * DAY));
    await p.manager.maint.plans.update({ id: planId, serverSeq: v3.serverSeq, title: "Drain the tank well", intervalDays: 30, active: true });
    expect((await read()).baseAt).toBe(at(240 * DAY).getTime());
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

  test("press run hours: downtime logged after the run stopped subtracts nothing from other runs", async () => {
    setClock(NOON);
    const p = await plant();
    const { id: assetId } = await p.manager.maint.assets.create(asset({ code: "PRESS-1", kind: "press", linkKind: "press", linkId: p.lineId }));
    await p.manager.maint.plans.create({ assetId, title: "Hydraulic oil", intervalHours: 2000 });
    // Run A 1 h to 13 h (12 h). Run B 14 h to 18 h, then stopped (not yet counted).
    await p.run(at(H), at(13 * H));
    const b = await p.run(at(14 * H), at(18 * H), "running");
    // A breakdown at 19 h attaches to stopped run B and lasts 10 h: after B stopped, so it takes nothing off.
    await p.downtime(at(19 * H), at(29 * H), "breakdown", b);
    // A downtime entry that starts inside run B and runs past its stop takes off only the part inside B.
    await p.downtime(at(17 * H), at(20 * H), "die_change", b);
    setClock(at(30 * H));
    const [row] = await p.manager.maint.plans.due();
    // 12 h + (4 h - 1 h) = 15 h.
    expect(row!.due).toMatchObject({ hoursRun: 15 });
  });

  test("press run hours: the gap between a stop and its resume is not run time; a downtime inside it counts once", async () => {
    setClock(NOON);
    const p = await plant();
    const { id: assetId } = await p.manager.maint.assets.create(asset({ code: "PRESS-1", kind: "press", linkKind: "press", linkId: p.lineId }));
    await p.manager.maint.plans.create({ assetId, title: "Hydraulic oil", intervalHours: 2000 });
    // One run 1 h to 21 h, stopped at 5 h and resumed at 15 h (a night pause), with a breakdown 6 h to 8 h inside the pause
    // and another 18 h to 19 h while running.
    const r = await p.run(at(H), at(21 * H));
    const audit = (action: string, ms: number) =>
      env.db.insert(auditLog).values({ id: crypto.randomUUID(), companyId: p.companyId, action, subjectType: "press_run", subjectId: r, at: at(ms) });
    await audit("press_run.start", H);
    await audit("press_run.stop", 5 * H);
    await audit("press_run.resume", 15 * H);
    await audit("press_run.stop", 21 * H);
    await p.downtime(at(6 * H), at(8 * H), "breakdown", r);
    await p.downtime(at(18 * H), at(19 * H), "breakdown", r);
    // A resume with no stop before it (another run) takes nothing off.
    const r2 = await p.run(at(22 * H), at(24 * H));
    await env.db.insert(auditLog).values({ id: crypto.randomUUID(), companyId: p.companyId, action: "press_run.resume", subjectType: "press_run", subjectId: r2, at: at(23 * H) });
    // Another plant's audit rows on the same run id never count.
    const q = await plant();
    await env.db.insert(auditLog).values({ id: crypto.randomUUID(), companyId: q.companyId, action: "press_run.stop", subjectType: "press_run", subjectId: r, at: at(16 * H) });
    await env.db.insert(auditLog).values({ id: crypto.randomUUID(), companyId: q.companyId, action: "press_run.resume", subjectType: "press_run", subjectId: r, at: at(20 * H) });
    setClock(at(30 * H));
    const [row] = await p.manager.maint.plans.due();
    // 20 h span - 10 h pause - 1 h breakdown while running = 9 h; plus run 2: 2 h.
    expect(row!.due).toMatchObject({ hoursRun: 11 });
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
