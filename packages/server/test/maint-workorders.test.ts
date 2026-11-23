/**
 * XE parity lane MAINT, rows 65, 66 and 68: work orders (by hand, from a breakdown downtime entry, from a
 * plan, from an out-of-limit reading), their status flow and stale saves, the plan reset on a preventive
 * work order done, store issues linked as spares, and condition readings against limits.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { auditLog, maintAsset, maintPlan, maintWorkOrder } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { DAY, H, NOON, errOf, maintPlant, type MaintPlant } from "./maint-fixture";

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

async function pressAsset(p: MaintPlant, criticality: "A" | "B" | "C" = "A") {
  return p.manager.maint.assets.create({ code: "PRESS-1", name: "Press 1", kind: "press", linkKind: "press", linkId: p.lineId, criticality, status: "running" });
}

async function compressor(p: MaintPlant) {
  return p.manager.maint.assets.create({ code: "CMP-1", name: "Compressor", kind: "compressor", criticality: "C", status: "running" });
}

describe("work orders (#65)", () => {
  test("by hand: WO-1, priority from criticality, assign, flow to done with the work written", async () => {
    setClock(NOON);
    const p = await plant();
    const { id: assetId } = await compressor(p);
    const made = await p.operator.maint.workOrders.create({ assetId, kind: "breakdown", title: "Belt slipping", assignedTo: p.users.operator.id });
    expect(made).toMatchObject({ number: "WO-1", replayed: false });
    let wo = await p.operator.maint.workOrders.get({ id: made.id });
    expect(wo).toMatchObject({ status: "open", priority: "low", kind: "breakdown", source: "manual", assignedName: expect.any(String) });
    expect(wo.moves).toEqual(["in_progress", "waiting_spares", "done", "cancelled"]);

    setClock(at(H));
    await p.operator.maint.workOrders.move({ id: wo.id, serverSeq: wo.serverSeq, to: "in_progress" });
    wo = await p.operator.maint.workOrders.get({ id: made.id });
    expect(wo.startedAt).toBe(at(H).getTime());
    // A stale save is refused with no audit row.
    expect(await errOf(p.operator.maint.workOrders.update({ id: wo.id, serverSeq: wo.serverSeq - 1, cause: "x" }))).toEqual({
      code: "CONFLICT",
      message: "This work order changed since you opened it. Open it again.",
    });
    await p.operator.maint.workOrders.update({ id: wo.id, serverSeq: wo.serverSeq, cause: "Worn belt", labourMin: 90 });
    wo = await p.operator.maint.workOrders.get({ id: made.id });
    expect(await errOf(p.operator.maint.workOrders.move({ id: wo.id, serverSeq: wo.serverSeq, to: "done" }))).toEqual({
      code: "BAD_REQUEST",
      message: "Write what was done before marking the work order done",
    });
    setClock(at(3 * H));
    await p.operator.maint.workOrders.move({ id: wo.id, serverSeq: wo.serverSeq, to: "done", workDone: "Changed the belt" });
    wo = await p.operator.maint.workOrders.get({ id: made.id });
    expect(wo).toMatchObject({ status: "done", workDone: "Changed the belt", cause: "Worn belt", labourMin: 90, finishedAt: at(3 * H).getTime(), moves: [] });
    expect(await errOf(p.operator.maint.workOrders.move({ id: wo.id, serverSeq: wo.serverSeq, to: "in_progress" }))).toEqual({ code: "BAD_REQUEST", message: "This work order is closed" });
    const audits = await env.db.select({ action: auditLog.action }).from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.subjectType, "maint_work_order")));
    expect(audits.map((a) => a.action).sort()).toEqual(["maint.workorder.create", "maint.workorder.move", "maint.workorder.move", "maint.workorder.update"]);
    expect((await p.manager.maint.workOrders.list({ status: "live" })).items).toHaveLength(0);
    expect((await p.manager.maint.workOrders.list({ status: "all", assetId })).items.map((i) => i.number)).toEqual(["WO-1"]);
  });

  test("cancel needs a reason; finish before start is refused; the assignee must be a member", async () => {
    setClock(NOON);
    const p = await plant();
    const q = await plant();
    const { id: assetId } = await compressor(p);
    expect(await errOf(p.supervisor.maint.workOrders.create({ assetId, kind: "breakdown", title: "x", assignedTo: q.users.operator.id }))).toEqual({
      code: "BAD_REQUEST",
      message: "The person is not a member of this plant",
    });
    const { id } = await p.supervisor.maint.workOrders.create({ assetId, kind: "breakdown", title: "Leak" });
    let wo = await p.supervisor.maint.workOrders.get({ id });
    expect(await errOf(p.supervisor.maint.workOrders.update({ id, serverSeq: wo.serverSeq, startedAt: at(-H).getTime(), finishedAt: at(-2 * H).getTime() }))).toEqual({
      code: "BAD_REQUEST",
      message: "The finish time is before the start time",
    });
    expect(await errOf(p.supervisor.maint.workOrders.move({ id, serverSeq: wo.serverSeq, to: "cancelled" }))).toEqual({ code: "BAD_REQUEST", message: "Say why the work order is cancelled" });
    await p.supervisor.maint.workOrders.move({ id, serverSeq: wo.serverSeq, to: "cancelled", reason: "Raised twice" });
    wo = await p.supervisor.maint.workOrders.get({ id });
    expect(wo).toMatchObject({ status: "cancelled", cancelReason: "Raised twice" });
  });

  test("tenancy and roles: another plant gets Not found; viewer, packer and storekeeper cannot raise", async () => {
    setClock(NOON);
    const p = await plant();
    const q = await plant();
    const { id: assetId } = await compressor(p);
    const { id } = await p.operator.maint.workOrders.create({ assetId, kind: "breakdown", title: "Noise" });
    expect(await errOf(q.owner.maint.workOrders.get({ id }))).toEqual({ code: "NOT_FOUND", message: "Not found" });
    expect(await errOf(q.owner.maint.workOrders.move({ id, serverSeq: 0, to: "done" }))).toMatchObject({ code: "NOT_FOUND" });
    expect(await errOf(q.owner.maint.workOrders.create({ assetId, kind: "breakdown", title: "x" }))).toMatchObject({ code: "NOT_FOUND" });
    expect((await q.owner.maint.workOrders.list()).items).toHaveLength(0);
    for (const role of ["viewer", "packer", "storekeeper", "office"] as const) {
      expect(await errOf(p.as(role).maint.workOrders.create({ assetId, kind: "breakdown", title: "x" }))).toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await p.storekeeper.maint.workOrders.list()).items).toHaveLength(1);
  });

  test("one tap from a breakdown downtime entry; a second tap returns the same work order", async () => {
    setClock(NOON);
    const p = await plant();
    const q = await plant();
    const downtimeId = await p.downtime(at(-H), null, "breakdown", null, "Main ram seal leaking");
    expect(await errOf(p.press.maint.workOrders.fromDowntime({ downtimeId }))).toEqual({
      code: "BAD_REQUEST",
      message: "No asset points at this press yet. Add it to the asset register first",
    });
    const { id: assetId } = await pressAsset(p);
    const first = await p.press.maint.workOrders.fromDowntime({ downtimeId });
    const again = await p.supervisor.maint.workOrders.fromDowntime({ downtimeId });
    expect(again).toEqual({ id: first.id, number: first.number, replayed: true });
    const [a, b] = await Promise.all([p.press.maint.workOrders.fromDowntime({ downtimeId }), p.operator.maint.workOrders.fromDowntime({ downtimeId })]);
    expect(a.id).toBe(first.id);
    expect(b.id).toBe(first.id);
    const wo = await p.press.maint.workOrders.get({ id: first.id });
    expect(wo).toMatchObject({ assetId, kind: "breakdown", source: "downtime", priority: "high", title: "Main ram seal leaking", downtime: { lineCode: "P1", stoppedAt: null } });
    const rows = await env.db.select().from(maintWorkOrder).where(eq(maintWorkOrder.companyId, p.companyId));
    expect(rows).toHaveLength(1);
    const dieChange = await p.downtime(at(-2 * H), at(-H), "die_change");
    expect(await errOf(p.press.maint.workOrders.fromDowntime({ downtimeId: dieChange }))).toEqual({
      code: "BAD_REQUEST",
      message: "Only a downtime entry with the breakdown reason makes a work order",
    });
    expect(await errOf(q.owner.maint.workOrders.fromDowntime({ downtimeId }))).toMatchObject({ code: "NOT_FOUND" });
    const breakdowns = await p.supervisor.maint.workOrders.breakdowns();
    expect(breakdowns.hasAssets).toBe(true);
    expect(breakdowns.items.map((d) => [d.id, d.workOrderNumber])).toEqual([[downtimeId, first.number]]);
  });

  test("a plant with no assets: breakdowns say so and list nothing", async () => {
    setClock(NOON);
    const p = await plant();
    await p.downtime(at(-H), null, "breakdown");
    expect(await p.press.maint.workOrders.breakdowns()).toEqual({ hasAssets: false, items: [] });
    await compressor(p);
    const after = await p.press.maint.workOrders.breakdowns();
    expect(after.hasAssets).toBe(true);
    expect(after.items).toHaveLength(1);
  });

  test("a cancelled work order does not block a new one from the same downtime entry or reading", async () => {
    setClock(NOON);
    const p = await plant();
    await pressAsset(p);
    const downtimeId = await p.downtime(at(-H), null, "breakdown");
    const first = await p.press.maint.workOrders.fromDowntime({ downtimeId });
    let wo = await p.press.maint.workOrders.get({ id: first.id });
    await p.supervisor.maint.workOrders.move({ id: wo.id, serverSeq: wo.serverSeq, to: "cancelled", reason: "Wrong press" });
    expect((await p.press.maint.workOrders.breakdowns()).items[0]).toMatchObject({ id: downtimeId, workOrderId: null });
    const second = await p.press.maint.workOrders.fromDowntime({ downtimeId });
    expect(second).toMatchObject({ replayed: false, number: "WO-2" });
    expect(second.id).not.toBe(first.id);
    expect((await p.press.maint.workOrders.breakdowns()).items[0]).toMatchObject({ workOrderId: second.id });

    const { id: assetId } = await compressor(p);
    const { id: kindId } = await p.manager.maint.readings.createKind({ assetId, name: "Pressure", unit: "bar", maxMilli: 8_000 });
    const reading = await p.operator.maint.readings.record({ kindId, valueMilli: 9_500 });
    const r1 = await p.operator.maint.readings.makeWorkOrder({ readingId: reading.id });
    wo = await p.operator.maint.workOrders.get({ id: r1.id });
    await p.operator.maint.workOrders.move({ id: wo.id, serverSeq: wo.serverSeq, to: "cancelled", reason: "Gauge was faulty" });
    // The reading shows as not handled again, then makes a new work order.
    expect((await p.supervisor.maint.readings.flagged())[0]!.workOrderId).toBeNull();
    expect((await p.supervisor.maint.today())!.flaggedReadings).toBe(1);
    const r2 = await p.operator.maint.readings.makeWorkOrder({ readingId: reading.id });
    expect(r2.replayed).toBe(false);
    expect((await p.supervisor.maint.readings.flagged())[0]!.workOrderId).toBe(r2.id);
  });

  test("a lost race for a work order takes no WO number", async () => {
    setClock(NOON);
    const p = await plant();
    await pressAsset(p);
    const downtimeId = await p.downtime(at(-H), null, "breakdown");
    const { insertWorkOrder } = await import("../src/routers/maintenanceWork");
    const [asset] = await env.db.select().from(maintAsset).where(eq(maintAsset.companyId, p.companyId));
    const ctx = { db: env.db, companyId: p.companyId, session: { user: { id: p.users.press.id } } } as never;
    const input = { assetId: asset!.id, kind: "breakdown" as const, source: "downtime" as const, downtimeId, title: "Seal", priority: "high" as const };
    const read = async () => {
      const [w] = await env.db.select().from(maintWorkOrder).where(and(eq(maintWorkOrder.companyId, p.companyId), eq(maintWorkOrder.downtimeId, downtimeId)));
      return w ?? null;
    };
    let calls = 0;
    // The other tap wins between our first look and our write.
    const lost = await insertWorkOrder(ctx, input, async () => {
      calls += 1;
      if (calls === 1) {
        await insertWorkOrder(ctx, input, async () => null);
        return null;
      }
      return read();
    });
    expect(lost).toMatchObject({ number: "WO-1", replayed: true });
    const { id: cmp } = await compressor(p);
    expect(await p.operator.maint.workOrders.create({ assetId: cmp, kind: "breakdown", title: "Trip" })).toMatchObject({ number: "WO-2" });
  });

  test("times: none in the future; a done work order keeps them; a new finish moves its plan's reset point", async () => {
    setClock(NOON);
    const p = await plant();
    const { id: assetId } = await compressor(p);
    const { id: planId } = await p.manager.maint.plans.create({ assetId, title: "Drain the tank", intervalDays: 30 });
    const made = await p.operator.maint.plans.makeWorkOrder({ planId });
    let wo = await p.operator.maint.workOrders.get({ id: made.id });
    expect(await errOf(p.operator.maint.workOrders.update({ id: wo.id, serverSeq: wo.serverSeq, finishedAt: at(DAY).getTime() }))).toEqual({
      code: "BAD_REQUEST",
      message: "A start or finish time cannot be in the future",
    });
    expect(await errOf(p.operator.maint.workOrders.update({ id: wo.id, serverSeq: wo.serverSeq, startedAt: at(H).getTime() }))).toMatchObject({ code: "BAD_REQUEST" });
    // A few minutes ahead (a fast phone clock) is fine.
    await p.operator.maint.workOrders.update({ id: wo.id, serverSeq: wo.serverSeq, startedAt: at(2 * 60_000).getTime() });
    setClock(at(2 * H));
    wo = await p.operator.maint.workOrders.get({ id: made.id });
    await p.operator.maint.workOrders.move({ id: wo.id, serverSeq: wo.serverSeq, to: "done", workDone: "Drained" });
    expect((await env.db.select().from(maintPlan).where(eq(maintPlan.id, planId)))[0]!.baseAt.getTime()).toBe(at(2 * H).getTime());
    wo = await p.operator.maint.workOrders.get({ id: made.id });
    expect(await errOf(p.operator.maint.workOrders.update({ id: wo.id, serverSeq: wo.serverSeq, finishedAt: null }))).toEqual({
      code: "BAD_REQUEST",
      message: "A done work order keeps its start and finish times",
    });
    // The real finish was at 1 h: the plan now counts from 1 h.
    await p.operator.maint.workOrders.update({ id: wo.id, serverSeq: wo.serverSeq, finishedAt: at(H).getTime() });
    expect((await env.db.select().from(maintPlan).where(eq(maintPlan.id, planId)))[0]!.baseAt.getTime()).toBe(at(H).getTime());
    // A later work order on the plan is now its reset point: editing the older one moves nothing.
    const next = await p.operator.maint.plans.makeWorkOrder({ planId });
    let nwo = await p.operator.maint.workOrders.get({ id: next.id });
    setClock(at(3 * H));
    await p.operator.maint.workOrders.move({ id: nwo.id, serverSeq: nwo.serverSeq, to: "done", workDone: "Drained again" });
    wo = await p.operator.maint.workOrders.get({ id: made.id });
    await p.operator.maint.workOrders.update({ id: wo.id, serverSeq: wo.serverSeq, finishedAt: at(90 * 60_000).getTime() });
    expect((await env.db.select().from(maintPlan).where(eq(maintPlan.id, planId)))[0]!.baseAt.getTime()).toBe(at(3 * H).getTime());
    nwo = await p.operator.maint.workOrders.get({ id: next.id });
    expect(nwo.status).toBe("done");
  });

  test("a preventive work order done resets its plan; one live work order per plan", async () => {
    setClock(NOON);
    const p = await plant();
    const { id: assetId } = await compressor(p);
    const { id: planId } = await p.manager.maint.plans.create({ assetId, title: "Drain the tank", intervalDays: 30 });
    setClock(at(31 * DAY));
    expect((await p.manager.maint.plans.due())[0]!.due.state).toBe("overdue");
    const made = await p.operator.maint.plans.makeWorkOrder({ planId });
    expect(await p.operator.maint.plans.makeWorkOrder({ planId })).toEqual({ id: made.id, number: made.number, replayed: true });
    const due = (await p.manager.maint.plans.due())[0]!;
    expect(due.openWorkOrderNumber).toBe(made.number);
    const wo = await p.operator.maint.workOrders.get({ id: made.id });
    expect(wo).toMatchObject({ kind: "preventive", source: "plan", title: "Drain the tank", plan: { id: planId } });
    setClock(at(32 * DAY));
    await p.operator.maint.workOrders.move({ id: wo.id, serverSeq: wo.serverSeq, to: "done", workDone: "Drained" });
    const [plan] = await env.db.select().from(maintPlan).where(eq(maintPlan.id, planId));
    expect(plan!.baseAt.getTime()).toBe(at(32 * DAY).getTime());
    expect(plan!.lastWorkOrderId).toBe(wo.id);
    expect((await p.manager.maint.plans.due())[0]!.due).toMatchObject({ state: "ok", daysLeft: 30 });
    // The next work order on the plan is a new one.
    const next = await p.operator.maint.plans.makeWorkOrder({ planId });
    expect(next.replayed).toBe(false);
    expect(next.number).toBe("WO-2");
  });
});

describe("spares (#66)", () => {
  async function storePlant() {
    const p = await plant();
    await p.owner.stock.locations.seedDefaults();
    const bearing = await p.storekeeper.store.items.create({ name: "Bearing 6205", unit: "piece", category: "spare" });
    await p.storekeeper.store.receive({ itemId: bearing.id, qtyMilli: 10_000 });
    return { p, bearingId: bearing.id };
  }

  test("issue from the store for the work order, link it, see it per work order and per asset", async () => {
    setClock(NOON);
    const { p, bearingId } = await storePlant();
    const { id: assetId } = await compressor(p);
    const { id: woId } = await p.operator.maint.workOrders.create({ assetId, kind: "breakdown", title: "Bearing noise" });
    const issue = await p.storekeeper.store.issue({ itemId: bearingId, qtyMilli: 2_000, purpose: "maintenance", refId: woId, clientRequestId: `wo-${woId}-1` });
    const melt = await p.storekeeper.store.issue({ itemId: bearingId, qtyMilli: 1_000, purpose: "other" });
    const candidates = await p.operator.maint.spares.candidates({ workOrderId: woId });
    expect(candidates.map((c) => [c.storeTxnId, c.forThis])).toEqual([[issue.id, true]]);
    expect(await errOf(p.storekeeper.maint.spares.link({ workOrderId: woId, storeTxnId: issue.id }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await p.operator.maint.spares.link({ workOrderId: woId, storeTxnId: issue.id })).toEqual({ linked: true, replayed: false });
    expect(await p.operator.maint.spares.link({ workOrderId: woId, storeTxnId: issue.id })).toEqual({ linked: true, replayed: true });
    expect(await errOf(p.operator.maint.spares.link({ workOrderId: woId, storeTxnId: melt.id }))).toEqual({ code: "BAD_REQUEST", message: "Only a store issue for maintenance can be linked" });
    const { id: other } = await p.operator.maint.workOrders.create({ assetId, kind: "breakdown", title: "Other" });
    expect(await errOf(p.operator.maint.spares.link({ workOrderId: other, storeTxnId: issue.id }))).toEqual({ code: "CONFLICT", message: "That store issue is already on a work order" });
    const wo = await p.operator.maint.workOrders.get({ id: woId });
    expect(wo.spares).toEqual([
      expect.objectContaining({ storeTxnId: issue.id, number: issue.number, itemName: "Bearing 6205", unit: "piece", qtyMilli: 2_000, cancelledAt: null, valuePaise: null }),
    ]);
    expect((await p.operator.maint.assets.get({ id: assetId })).spares.map((s) => s.workOrderNumber)).toEqual([wo.number]);
    // A cancelled store entry shows as cancelled, and a cancelled one cannot be linked.
    await p.storekeeper.store.cancel({ txnId: issue.id, reason: "Wrong bearing" });
    expect((await p.operator.maint.workOrders.get({ id: woId })).spares[0]!.cancelledAt).not.toBeNull();
    await p.operator.maint.spares.unlink({ workOrderId: woId, storeTxnId: issue.id });
    expect(await errOf(p.operator.maint.spares.link({ workOrderId: woId, storeTxnId: issue.id }))).toEqual({ code: "BAD_REQUEST", message: "That store issue was cancelled" });
    expect(await errOf(p.operator.maint.spares.unlink({ workOrderId: woId, storeTxnId: issue.id }))).toEqual({ code: "BAD_REQUEST", message: "That store issue is not on this work order" });
  });

  test("another plant's store entry or work order is Not found", async () => {
    setClock(NOON);
    const { p, bearingId } = await storePlant();
    const q = await plant();
    const { id: assetId } = await compressor(p);
    const { id: woId } = await p.operator.maint.workOrders.create({ assetId, kind: "breakdown", title: "x" });
    const issue = await p.storekeeper.store.issue({ itemId: bearingId, qtyMilli: 1_000, purpose: "maintenance" });
    const qa = await compressor(q);
    const { id: qWo } = await q.operator.maint.workOrders.create({ assetId: qa.id, kind: "breakdown", title: "x" });
    expect(await errOf(q.operator.maint.spares.link({ workOrderId: qWo, storeTxnId: issue.id }))).toEqual({ code: "NOT_FOUND", message: "Not found" });
    expect(await errOf(q.operator.maint.spares.link({ workOrderId: woId, storeTxnId: issue.id }))).toMatchObject({ code: "NOT_FOUND" });
    expect(await errOf(q.operator.maint.spares.candidates({ workOrderId: woId }))).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("condition readings (#68)", () => {
  test("limits per reading kind; out of limit is flagged and makes one work order", async () => {
    setClock(NOON);
    const p = await plant();
    const q = await plant();
    const { id: assetId } = await pressAsset(p);
    const { id: kindId } = await p.manager.maint.readings.createKind({ assetId, name: "Oil temperature", unit: "°C", minMilli: 20_000, maxMilli: 60_000 });
    expect(await errOf(p.manager.maint.readings.createKind({ assetId, name: "oil temperature ", unit: "°C", maxMilli: 1 }))).toEqual({
      code: "CONFLICT",
      message: "This asset already reads something by that name",
    });
    expect(await errOf(p.manager.maint.readings.createKind({ assetId, name: "Vibration", unit: "mm/s" }))).toEqual({
      code: "BAD_REQUEST",
      message: "Give a low limit, a high limit or both, with the low below the high",
    });
    expect(await p.operator.maint.readings.record({ kindId, valueMilli: 45_500 })).toMatchObject({ flag: "ok" });
    const hot = await p.press.maint.readings.record({ kindId, valueMilli: 72_000, note: "Cooler fan off" });
    expect(hot.flag).toBe("high");
    const flagged = await p.supervisor.maint.readings.flagged();
    expect(flagged.map((f) => [f.id, f.flag, f.unit])).toEqual([[hot.id, "high", "°C"]]);
    expect((await p.supervisor.maint.today())!.flaggedReadings).toBe(1);
    const okReading = (await p.operator.maint.readings.list({ assetId })).items.find((r) => r.flag === "ok")!;
    expect(await errOf(p.operator.maint.readings.makeWorkOrder({ readingId: okReading.id }))).toEqual({ code: "BAD_REQUEST", message: "That reading is inside its limits" });
    const wo = await p.operator.maint.readings.makeWorkOrder({ readingId: hot.id });
    expect(await p.operator.maint.readings.makeWorkOrder({ readingId: hot.id })).toEqual({ id: wo.id, number: wo.number, replayed: true });
    expect(await p.operator.maint.workOrders.get({ id: wo.id })).toMatchObject({ source: "reading", kind: "condition", title: "Oil temperature 72 °C", priority: "high" });
    expect((await p.supervisor.maint.readings.flagged())[0]!.workOrderId).toBe(wo.id);
    expect((await p.supervisor.maint.today())!.flaggedReadings).toBe(0);
    // Tenancy and roles.
    expect(await errOf(q.owner.maint.readings.record({ kindId, valueMilli: 1 }))).toEqual({ code: "NOT_FOUND", message: "Not found" });
    expect(await errOf(q.owner.maint.readings.list({ assetId }))).toMatchObject({ code: "NOT_FOUND" });
    expect(await errOf(p.viewer.maint.readings.record({ kindId, valueMilli: 1 }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await errOf(p.operator.maint.readings.createKind({ assetId, name: "x", unit: "bar", maxMilli: 1 }))).toMatchObject({ code: "FORBIDDEN" });
    // The unit is fixed once the kind has readings; a kind with none may change it.
    expect(await errOf(p.manager.maint.readings.updateKind({ id: kindId, name: "Oil temperature", unit: "°F", minMilli: 68_000, maxMilli: 140_000, active: true }))).toEqual({
      code: "BAD_REQUEST",
      message: "This reading already has readings in its unit. Add a new reading kind for another unit",
    });
    const fresh = await p.manager.maint.readings.createKind({ assetId, name: "Pressure", unit: "bar", maxMilli: 200_000 });
    await p.manager.maint.readings.updateKind({ id: fresh.id, name: "Pressure", unit: "kg/cm²", maxMilli: 200_000, active: true });
    // A switched-off kind takes no reading.
    await p.manager.maint.readings.updateKind({ id: kindId, name: "Oil temperature", unit: "°C", minMilli: 20_000, maxMilli: 60_000, active: false });
    expect(await errOf(p.operator.maint.readings.record({ kindId, valueMilli: 1 }))).toEqual({ code: "BAD_REQUEST", message: "That reading is switched off" });
  });
});
