/**
 * XE parity lane MAINT, review round 3 (CodeRabbit on PR 20). Each test fails on the code before the fix:
 * - write-time guards (`batchAbortUnlessOn`) for the link vs run-hours plan race, the unit vs reading
 *   race, a reading against a kind changed meanwhile, and a spare against a work order cancelled meanwhile;
 * - relinking an asset with a run-hours plan is refused (no carry-over to define);
 * - calendar days, asset search, masters past the first 100, no cap on due plans;
 * - the report: open breakdown labour waits, the asset cap is disclosed;
 * - a status move keeps start before finish; planReset only when the plan moved; issues for this work
 *   order first in SQL; a work order number retry that wins.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { auditLog, docSeries, maintAsset, maintPlan, maintReading, maintReadingKind, maintWoSpare, maintWorkOrder, pressLine } from "@orrn/db/schema";
import { and, eq, sql } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { DAY, H, NOON, errOf, maintPlant, type MaintPlant } from "./maint-fixture";

setDefaultTimeout(60_000);

let env: TestEnv;
let setClock: (at: Date | null) => void;

beforeAll(async () => {
  env = await createTestEnv({ defaultModules: ["maintenance"] });
  setClock = (await import("../src/lib/clock")).setClockForTests;
}, 60_000);
afterEach(() => setClock(null));
afterAll(async () => {
  await env.dispose();
});

const plant = maintPlant(() => env);
const at = (ms: number) => new Date(NOON.getTime() + ms);

const HOURS_PLANS = "Plans on this asset run on run hours. Change them to days before you change or remove the link";
const NO_RUN_HOURS = "This asset has no run hours. Link it to a press, furnace or oven, or plan by days";

async function pressAsset(p: MaintPlant) {
  return p.manager.maint.assets.create({ code: "PRESS-1", name: "Press 1", kind: "press", linkKind: "press", linkId: p.lineId, criticality: "A", status: "running" });
}
async function compressor(p: MaintPlant, code = "CMP-1", name = "Compressor") {
  return p.manager.maint.assets.create({ code, name, kind: "compressor", criticality: "C", status: "running" });
}
async function audits(p: MaintPlant, action: string) {
  return env.db.select({ meta: auditLog.meta }).from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, action)));
}
const pressFields = { code: "PRESS-1", name: "Press 1", kind: "press" as const, criticality: "A" as const, status: "running" as const };

describe("asset link and run-hours plans", () => {
  test("relinking a press asset to another press while a run-hours plan is active is refused; without one it saves", async () => {
    setClock(NOON);
    const p = await plant();
    const p2 = crypto.randomUUID();
    await env.db.insert(pressLine).values({ id: p2, companyId: p.companyId, code: "P2", name: "Press 2" });
    const { id } = await pressAsset(p);
    const { id: planId } = await p.manager.maint.plans.create({ assetId: id, title: "Oil", intervalHours: 500 });
    let row = (await p.manager.maint.assets.get({ id })).asset;
    expect(await errOf(p.manager.maint.assets.update({ id, serverSeq: row.serverSeq, ...pressFields, linkKind: "press", linkId: p2 }))).toEqual({ code: "BAD_REQUEST", message: HOURS_PLANS });
    expect((await p.manager.maint.assets.get({ id })).asset.linkId).toBe(p.lineId);
    // Switch the plan to days: now the link may move.
    const plan = (await p.manager.maint.assets.get({ id })).plans.find((x) => x.id === planId)!;
    await p.manager.maint.plans.update({ id: planId, serverSeq: plan.serverSeq, title: "Oil", intervalDays: 30, intervalHours: null, active: true });
    row = (await p.manager.maint.assets.get({ id })).asset;
    await p.manager.maint.assets.update({ id, serverSeq: row.serverSeq, ...pressFields, linkKind: "press", linkId: p2 });
    expect((await p.manager.maint.assets.get({ id })).asset.linkId).toBe(p2);
  });

  test("an hours plan added after the unlink check: the unlink is refused at write time, with no audit row", async () => {
    setClock(NOON);
    const p = await plant();
    const { id } = await pressAsset(p);
    const row = (await p.manager.maint.assets.get({ id })).asset;
    env.beforeNextBatch(async () => {
      await env.db.insert(maintPlan).values({ id: crypto.randomUUID(), companyId: p.companyId, serverSeq: 1, assetId: id, title: "Oil", intervalHours: 500, baseAt: NOON });
    });
    expect(await errOf(p.manager.maint.assets.update({ id, serverSeq: row.serverSeq, ...pressFields }))).toEqual({ code: "BAD_REQUEST", message: HOURS_PLANS });
    expect((await p.manager.maint.assets.get({ id })).asset.linkId).toBe(p.lineId);
    expect(await audits(p, "maint.asset.update")).toHaveLength(0);
  });

  test("an unlink that lands after the plan check: the run-hours plan is refused at write time, with no plan or audit row", async () => {
    setClock(NOON);
    const p = await plant();
    const { id } = await pressAsset(p);
    env.beforeNextBatch(async () => {
      await env.db.update(maintAsset).set({ linkKind: null, linkId: null }).where(eq(maintAsset.id, id));
    });
    expect(await errOf(p.manager.maint.plans.create({ assetId: id, title: "Oil", intervalHours: 500 }))).toEqual({ code: "BAD_REQUEST", message: NO_RUN_HOURS });
    expect(await env.db.select().from(maintPlan).where(eq(maintPlan.assetId, id))).toHaveLength(0);
    expect(await audits(p, "maint.plan.create")).toHaveLength(0);
    // A days-only plan on the unlinked asset is still fine.
    await p.manager.maint.plans.create({ assetId: id, title: "Look over", intervalDays: 7 });
  });

  test("plan update to run hours after an unlink landed is refused too", async () => {
    setClock(NOON);
    const p = await plant();
    const { id } = await pressAsset(p);
    const { id: planId } = await p.manager.maint.plans.create({ assetId: id, title: "Look over", intervalDays: 7 });
    const plan = (await p.manager.maint.assets.get({ id })).plans[0]!;
    env.beforeNextBatch(async () => {
      await env.db.update(maintAsset).set({ linkKind: null, linkId: null }).where(eq(maintAsset.id, id));
    });
    expect(await errOf(p.manager.maint.plans.update({ id: planId, serverSeq: plan.serverSeq, title: "Look over", intervalDays: 7, intervalHours: 100, active: true }))).toEqual({
      code: "BAD_REQUEST",
      message: NO_RUN_HOURS,
    });
    expect(await audits(p, "maint.plan.update")).toHaveLength(0);
  });
});

describe("asset detail due figures", () => {
  test("an interval edited while the detail loads: the due figures belong to the plan row shown", async () => {
    setClock(NOON);
    const p = await plant();
    const { id } = await compressor(p);
    const { id: planId } = await p.manager.maint.plans.create({ assetId: id, title: "Drain", intervalDays: 1 });
    setClock(at(3 * DAY));
    // Right before the detail reads its plan rows, another manager sets the interval to 30 days.
    env.beforeStatement(/from "maint_plan" where \("maint_plan"\."company_id" = \? and "maint_plan"\."asset_id" = \?\) order by/, async () => {
      await env.db.update(maintPlan).set({ intervalDays: 30 }).where(eq(maintPlan.id, planId));
    });
    const got = await p.manager.maint.assets.get({ id });
    const plan = got.plans.find((x) => x.id === planId)!;
    expect(plan.intervalDays).toBe(30);
    expect(plan.due).toMatchObject({ state: "ok", daysLeft: 27 });
  });
});

describe("reading kinds and readings at write time", () => {
  async function kindOn(p: MaintPlant) {
    const { id: assetId } = await compressor(p);
    const k = await p.manager.maint.readings.createKind({ assetId, name: "Pressure", unit: "bar", minMilli: 0, maxMilli: 10_000 });
    return { assetId, kindId: k.id };
  }

  test("a reading recorded after the unit check: the unit change is refused, unit stays", async () => {
    setClock(NOON);
    const p = await plant();
    const { assetId, kindId } = await kindOn(p);
    env.beforeNextBatch(async () => {
      await env.db.insert(maintReading).values({ id: crypto.randomUUID(), companyId: p.companyId, assetId, kindId, valueMilli: 7_000, flag: "ok", readAt: NOON });
    });
    expect(await errOf(p.manager.maint.readings.updateKind({ id: kindId, name: "Pressure", unit: "psi", minMilli: 0, maxMilli: 10_000, active: true }))).toEqual({
      code: "BAD_REQUEST",
      message: "This reading already has readings in its unit. Add a new reading kind for another unit",
    });
    const [k] = await env.db.select({ unit: maintReadingKind.unit }).from(maintReadingKind).where(eq(maintReadingKind.id, kindId));
    expect(k!.unit).toBe("bar");
    expect(await audits(p, "maint.limit.update")).toHaveLength(0);
    // An edit that keeps the unit still saves.
    await p.manager.maint.readings.updateKind({ id: kindId, name: "Line pressure", unit: "bar", minMilli: 0, maxMilli: 10_000, active: true });
  });

  test("a kind switched off after the check: the reading is refused, no reading and no audit row", async () => {
    setClock(NOON);
    const p = await plant();
    const { kindId } = await kindOn(p);
    env.beforeNextBatch(async () => {
      await env.db.update(maintReadingKind).set({ active: false }).where(eq(maintReadingKind.id, kindId));
    });
    expect(await errOf(p.operator.maint.readings.record({ kindId, valueMilli: 12_000 }))).toEqual({ code: "BAD_REQUEST", message: "That reading is switched off" });
    expect(await env.db.select().from(maintReading).where(eq(maintReading.kindId, kindId))).toHaveLength(0);
    expect(await audits(p, "maint.reading.record")).toHaveLength(0);
  });

  test("limits raised (or the unit changed) after the check: the reading is refused, not stored as high", async () => {
    setClock(NOON);
    const p = await plant();
    const { kindId } = await kindOn(p);
    env.beforeNextBatch(async () => {
      await env.db.update(maintReadingKind).set({ maxMilli: 15_000 }).where(eq(maintReadingKind.id, kindId));
    });
    expect(await errOf(p.operator.maint.readings.record({ kindId, valueMilli: 12_000 }))).toEqual({
      code: "BAD_REQUEST",
      message: "This reading's unit or limits changed just now. Take the reading again",
    });
    expect(await env.db.select().from(maintReading).where(eq(maintReading.kindId, kindId))).toHaveLength(0);
    // Taken again against the new limits it is ok.
    expect(await p.operator.maint.readings.record({ kindId, valueMilli: 12_000 })).toMatchObject({ flag: "ok" });
  });
});

describe("register inputs", () => {
  test("dates must be real calendar days (assets and plan start)", async () => {
    setClock(NOON);
    const p = await plant();
    expect(await errOf(p.manager.maint.assets.create({ code: "A", name: "A", kind: "compressor", criticality: "C", status: "running", warrantyUntil: "2026-02-30" }))).toMatchObject({ code: "BAD_REQUEST" });
    const { id } = await p.manager.maint.assets.create({ code: "A", name: "A", kind: "compressor", criticality: "C", status: "running", warrantyUntil: "2028-02-29", purchasedOn: null });
    expect(await errOf(p.manager.maint.plans.create({ assetId: id, title: "Oil", intervalDays: 30, startOn: "2026-11-31" }))).toMatchObject({ code: "BAD_REQUEST" });
    await p.manager.maint.plans.create({ assetId: id, title: "Oil", intervalDays: 30, startOn: "2026-11-30" });
  });

  test("assets.list searches code or name on the server (any case, % is literal)", async () => {
    setClock(NOON);
    const p = await plant();
    await compressor(p, "CMP-1", "Air compressor");
    await compressor(p, "CMP-2", "Chiller 50%");
    await compressor(p, "FAN-9", "Roof fan");
    expect((await p.office.maint.assets.list({ includeRetired: false, q: "cmp" })).map((a) => a.code).sort()).toEqual(["CMP-1", "CMP-2"]);
    expect((await p.office.maint.assets.list({ includeRetired: false, q: "ROOF" })).map((a) => a.code)).toEqual(["FAN-9"]);
    expect((await p.office.maint.assets.list({ includeRetired: false, q: "50%" })).map((a) => a.code)).toEqual(["CMP-2"]);
    expect(await p.office.maint.assets.list({ includeRetired: false, q: "%" })).toHaveLength(1);
    expect(await p.office.maint.assets.list()).toHaveLength(3);
  });

  test("add from masters: a repeat reaches the masters past the first 100", async () => {
    setClock(NOON);
    const p = await plant();
    // The fixture's P1 plus 100 more active presses: 101.
    for (let chunk = 0; chunk < 10; chunk += 1) {
      await env.db.insert(pressLine).values(
        Array.from({ length: 10 }, (_, i) => ({ id: crypto.randomUUID(), companyId: p.companyId, code: `PX${chunk * 10 + i}`, name: `Press X${chunk * 10 + i}` })),
      );
    }
    expect(await p.manager.maint.assets.addFromMasters()).toEqual({ added: 100 });
    expect(await p.manager.maint.assets.addFromMasters()).toEqual({ added: 1 });
    expect(await p.manager.maint.assets.addFromMasters()).toEqual({ added: 0 });
  });

  test("plans.due has no row cap: 1,001 active plans all come back", async () => {
    setClock(NOON);
    const p = await plant();
    const { id } = await compressor(p);
    await env.db.run(sql`
      with recursive n(i) as (select 1 union all select i + 1 from n where i < 1001)
      insert into maint_plan (id, company_id, server_seq, asset_id, title, interval_days, base_at, active, created_at, updated_at)
      select 'plan-' || i, ${p.companyId}, 1, ${id}, 'Plan ' || i, 30, ${NOON.getTime()}, 1, ${NOON.getTime()}, ${NOON.getTime()} from n`);
    expect(await p.manager.maint.plans.due()).toHaveLength(1001);
  });
});

describe("report", () => {
  const NOV = Date.UTC(2026, 9, 31, 18, 30); // 1 Nov 2026 00:00 IST

  test("labour on an open breakdown waits for it to close; done breakdowns and other work orders count", async () => {
    setClock(new Date(NOV + 2 * DAY));
    const p = await plant();
    const { id: cmp } = await compressor(p);
    const open = await p.operator.maint.workOrders.create({ assetId: cmp, kind: "breakdown", title: "Noise" });
    let w = await p.operator.maint.workOrders.get({ id: open.id });
    await p.operator.maint.workOrders.update({ id: w.id, serverSeq: w.serverSeq, labourMin: 120 });
    const prev = await p.operator.maint.workOrders.create({ assetId: cmp, kind: "preventive", title: "Grease" });
    w = await p.operator.maint.workOrders.get({ id: prev.id });
    await p.operator.maint.workOrders.update({ id: w.id, serverSeq: w.serverSeq, labourMin: 30 });
    const done = await p.operator.maint.workOrders.create({ assetId: cmp, kind: "breakdown", title: "Trip" });
    w = await p.operator.maint.workOrders.get({ id: done.id });
    await p.operator.maint.workOrders.update({ id: w.id, serverSeq: w.serverSeq, labourMin: 45 });
    // One spare on the open breakdown, one on the done one: only the done one's entry counts.
    await p.owner.stock.locations.seedDefaults();
    const item = await p.storekeeper.store.items.create({ name: "Fuse", unit: "piece", category: "spare" });
    await p.storekeeper.store.receive({ itemId: item.id, qtyMilli: 10_000 });
    for (const woId of [open.id, done.id]) {
      const issue = await p.storekeeper.store.issue({ itemId: item.id, qtyMilli: 1_000, purpose: "maintenance", refId: woId });
      await p.operator.maint.spares.link({ workOrderId: woId, storeTxnId: issue.id });
    }
    w = await p.operator.maint.workOrders.get({ id: done.id });
    setClock(new Date(NOV + 2 * DAY + H));
    await p.operator.maint.workOrders.move({ id: w.id, serverSeq: w.serverSeq, to: "done", workDone: "Reset" });

    setClock(new Date(NOV + 30 * DAY + H));
    const report = await p.manager.maint.reports.summary({ from: "2026-11", to: "2026-11" });
    const row = report.rows.find((r) => r.asset.id === cmp)!;
    expect(row.stillOpen.map((o) => o.workOrderId)).toEqual([open.id]);
    expect(row.total.labourMin).toBe(30 + 45);
    expect(row.total.sparesEntries).toBe(1);
  });

  test("more than 5,000 assets: the report says it is cut short", async () => {
    setClock(new Date(NOV + 10 * DAY));
    const p = await plant();
    await env.db.run(sql`
      with recursive n(i) as (select 1 union all select i + 1 from n where i < 5001)
      insert into maint_asset (id, company_id, server_seq, code, name, kind, criticality, status, created_at, updated_at)
      select 'a-' || i, ${p.companyId}, 1, 'A' || i, 'Asset ' || i, 'other', 'C', 'running', ${NOV}, ${NOV} from n`);
    const report = await p.manager.maint.reports.summary({ from: "2026-11", to: "2026-11" });
    expect(report.truncated).toBe(true);
    expect(report.rows).toHaveLength(5000);
  });
});

describe("work orders", () => {
  test("a move to done or in progress whose times would run backwards is refused", async () => {
    setClock(NOON);
    const p = await plant();
    const { id: cmp } = await compressor(p);
    // Start at 12:02 (inside the skew allowed), then moved to done at 12:01: the default finish is before the start.
    const a = await p.operator.maint.workOrders.create({ assetId: cmp, kind: "breakdown", title: "A" });
    let w = await p.operator.maint.workOrders.get({ id: a.id });
    await p.operator.maint.workOrders.update({ id: w.id, serverSeq: w.serverSeq, startedAt: at(2 * 60_000).getTime(), workDone: "Fixed" });
    setClock(at(60_000));
    w = await p.operator.maint.workOrders.get({ id: a.id });
    expect(await errOf(p.operator.maint.workOrders.move({ id: w.id, serverSeq: w.serverSeq, to: "done" }))).toEqual({ code: "BAD_REQUEST", message: "The finish time is before the start time" });
    // Finish at 11:59 with no start, moved to in progress at 12:00: the default start is after the finish.
    setClock(at(-2 * 60_000));
    const b = await p.operator.maint.workOrders.create({ assetId: cmp, kind: "breakdown", title: "B" });
    w = await p.operator.maint.workOrders.get({ id: b.id });
    await p.operator.maint.workOrders.update({ id: w.id, serverSeq: w.serverSeq, finishedAt: at(-60_000).getTime() });
    setClock(NOON);
    w = await p.operator.maint.workOrders.get({ id: b.id });
    expect(await errOf(p.operator.maint.workOrders.move({ id: w.id, serverSeq: w.serverSeq, to: "in_progress" }))).toEqual({ code: "BAD_REQUEST", message: "The finish time is before the start time" });
    expect(await audits(p, "maint.workorder.move")).toHaveLength(0);
    // Ordered times still move.
    setClock(at(5 * 60_000));
    w = await p.operator.maint.workOrders.get({ id: a.id });
    expect(await p.operator.maint.workOrders.move({ id: w.id, serverSeq: w.serverSeq, to: "done" })).toMatchObject({ status: "done" });
  });

  test("editing an older done order's finish does not write planReset when a newer order is the plan's reset point", async () => {
    setClock(NOON);
    const p = await plant();
    const { id: cmp } = await compressor(p);
    const { id: planId } = await p.manager.maint.plans.create({ assetId: cmp, title: "Drain", intervalDays: 30 });
    const doneNow = async () => {
      const made = await p.operator.maint.plans.makeWorkOrder({ planId });
      const w = await p.operator.maint.workOrders.get({ id: made.id });
      await p.operator.maint.workOrders.move({ id: w.id, serverSeq: w.serverSeq, to: "done", workDone: "Drained" });
      return made.id;
    };
    const a = await doneNow();
    setClock(at(2 * H));
    const b = await doneNow();
    setClock(at(3 * H));
    const wa = await p.operator.maint.workOrders.get({ id: a });
    await p.operator.maint.workOrders.update({ id: a, serverSeq: wa.serverSeq, finishedAt: at(30 * 60_000).getTime() });
    const updates = (await audits(p, "maint.workorder.update")).map((r) => (typeof r.meta === "string" ? JSON.parse(r.meta) : r.meta) as Record<string, unknown>);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.planReset).toBeUndefined();
    const [plan] = await env.db.select({ last: maintPlan.lastWorkOrderId }).from(maintPlan).where(eq(maintPlan.id, planId));
    expect(plan!.last).toBe(b);
    // Editing B's finish (the reset point) still says so.
    const wb = await p.operator.maint.workOrders.get({ id: b });
    await p.operator.maint.workOrders.update({ id: b, serverSeq: wb.serverSeq, finishedAt: at(2 * H + 60_000).getTime() });
    const again = (await audits(p, "maint.workorder.update")).map((r) => (typeof r.meta === "string" ? JSON.parse(r.meta) : r.meta) as Record<string, unknown>);
    expect(again.filter((m) => m.planReset === true)).toHaveLength(1);
  });

  test("a number taken under it once: the create retries and wins the next number, with one audit row", async () => {
    setClock(NOON);
    const p = await plant();
    const { id: cmp } = await compressor(p);
    expect(await p.operator.maint.workOrders.create({ assetId: cmp, kind: "breakdown", title: "One" })).toMatchObject({ number: "MWO-1" });
    let bumped = 0;
    env.beforeNextBatch(async () => {
      bumped += 1;
      await env.db
        .update(docSeries)
        .set({ value: sql`${docSeries.value} + 1` })
        .where(and(eq(docSeries.companyId, p.companyId), eq(docSeries.docType, "maint_wo")));
    });
    const made = await p.operator.maint.workOrders.create({ assetId: cmp, kind: "breakdown", title: "Two" });
    expect(bumped).toBe(1);
    expect(made).toMatchObject({ number: "MWO-3", replayed: false });
    const rows = await env.db.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.subjectId, made.id), eq(auditLog.action, "maint.workorder.create")));
    expect(rows).toHaveLength(1);
  });
});

describe("spares", () => {
  async function storePlant() {
    const p = await plant();
    await p.owner.stock.locations.seedDefaults();
    const bearing = await p.storekeeper.store.items.create({ name: "Bearing 6205", unit: "piece", category: "spare" });
    await p.storekeeper.store.receive({ itemId: bearing.id, qtyMilli: 1_000_000 });
    return { p, bearingId: bearing.id };
  }

  test("issues made for this work order come first even behind 100 newer maintenance issues", async () => {
    setClock(NOON);
    const { p, bearingId } = await storePlant();
    const { id: cmp } = await compressor(p);
    const { id: woId } = await p.operator.maint.workOrders.create({ assetId: cmp, kind: "breakdown", title: "Bearing" });
    const mine = await p.storekeeper.store.issue({ itemId: bearingId, qtyMilli: 1_000, purpose: "maintenance", refId: woId, clientRequestId: `wo-${woId}-1` });
    const other = await p.storekeeper.store.issue({ itemId: bearingId, qtyMilli: 1_000, purpose: "maintenance" });
    // 100 newer copies of the other issue.
    const cols = (await env.db.all<{ name: string }>(sql`select name from pragma_table_info('store_txn')`)).map((c) => c.name);
    const list = cols.map((c) => `"${c}"`).join(", ");
    const select = cols
      .map((c) => (c === "id" ? `t.id || '-' || n.i` : c === "number" ? `t.number || '-' || n.i` : c === "created_at" ? `t.created_at + n.i * 1000` : c === "client_request_id" ? `null` : `t."${c}"`))
      .join(", ");
    await env.db.run(sql.raw(`with recursive n(i) as (select 1 union all select i + 1 from n where i < 100)
      insert into store_txn (${list}) select ${select} from n, store_txn t where t.id = '${other.id}'`));
    const cands = await p.operator.maint.spares.candidates({ workOrderId: woId });
    expect(cands).toHaveLength(100);
    expect(cands[0]).toMatchObject({ storeTxnId: mine.id, forThis: true });
  });

  test("a work order cancelled after the check: link and unlink are refused at write time, with no audit row", async () => {
    setClock(NOON);
    const { p, bearingId } = await storePlant();
    const { id: cmp } = await compressor(p);
    const { id: woId } = await p.operator.maint.workOrders.create({ assetId: cmp, kind: "breakdown", title: "Bearing" });
    const one = await p.storekeeper.store.issue({ itemId: bearingId, qtyMilli: 1_000, purpose: "maintenance" });
    const two = await p.storekeeper.store.issue({ itemId: bearingId, qtyMilli: 1_000, purpose: "maintenance" });
    await p.operator.maint.spares.link({ workOrderId: woId, storeTxnId: one.id });
    const cancel = async () => {
      await env.db.update(maintWorkOrder).set({ status: "cancelled", cancelReason: "Raised twice" }).where(eq(maintWorkOrder.id, woId));
    };
    env.beforeNextBatch(cancel);
    expect(await errOf(p.operator.maint.spares.link({ workOrderId: woId, storeTxnId: two.id }))).toEqual({ code: "BAD_REQUEST", message: "This work order is closed" });
    expect(await env.db.select().from(maintWoSpare).where(eq(maintWoSpare.storeTxnId, two.id))).toHaveLength(0);
    // Reopen behind the router's back, then cancel again just before the unlink batch.
    await env.db.update(maintWorkOrder).set({ status: "open", cancelReason: null }).where(eq(maintWorkOrder.id, woId));
    env.beforeNextBatch(cancel);
    expect(await errOf(p.operator.maint.spares.unlink({ workOrderId: woId, storeTxnId: one.id }))).toEqual({ code: "BAD_REQUEST", message: "This work order is closed" });
    expect(await env.db.select().from(maintWoSpare).where(eq(maintWoSpare.storeTxnId, one.id))).toHaveLength(1);
    expect(await audits(p, "maint.spare.unlink")).toHaveLength(0);
    expect(await audits(p, "maint.spare.link")).toHaveLength(1);
  });
});
