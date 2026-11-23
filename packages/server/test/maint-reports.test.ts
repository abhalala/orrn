/**
 * XE parity lane MAINT, row 67: downtime minutes, MTBF and MTTR per asset per month, labour and spares,
 * and the labour rate setting. A downtime entry and the work order made from it count once; money shows
 * only for maint.manage holders.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { sql } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { DAY, H, errOf, maintPlant } from "./maint-fixture";

setDefaultTimeout(30_000);

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
/** 1 Nov 2026 00:00 IST. */
const NOV = Date.UTC(2026, 9, 31, 18, 30);

describe("maintenance report (#67)", () => {
  test("worked example: November on press 1 and a compressor", async () => {
    setClock(new Date(NOV + 10 * DAY));
    const p = await plant();
    const press = await p.manager.maint.assets.create({ code: "PRESS-1", name: "Press 1", kind: "press", linkKind: "press", linkId: p.lineId, criticality: "A", status: "running" });
    const cmp = await p.manager.maint.assets.create({ code: "CMP-1", name: "Compressor", kind: "compressor", criticality: "C", status: "running" });
    // Press: two breakdown downtime entries (2 h and 4 h); a work order made from the first counts once; a die change is not a breakdown.
    const d1 = await p.downtime(new Date(NOV + DAY), new Date(NOV + DAY + 2 * H));
    await p.downtime(new Date(NOV + 3 * DAY), new Date(NOV + 3 * DAY + 4 * H));
    await p.downtime(new Date(NOV + 4 * DAY), new Date(NOV + 4 * DAY + 5 * H), "die_change");
    const fromD1 = await p.press.maint.workOrders.fromDowntime({ downtimeId: d1 });
    let wo = await p.press.maint.workOrders.get({ id: fromD1.id });
    await p.press.maint.workOrders.update({ id: wo.id, serverSeq: wo.serverSeq, labourMin: 120 });
    wo = await p.press.maint.workOrders.get({ id: fromD1.id });
    await p.press.maint.workOrders.move({ id: wo.id, serverSeq: wo.serverSeq, to: "done", workDone: "Seal changed" });
    // Compressor: a breakdown work order by hand, started day 5 at 00:00, finished 1 h later.
    setClock(new Date(NOV + 5 * DAY));
    const c = await p.operator.maint.workOrders.create({ assetId: cmp.id, kind: "breakdown", title: "Trip" });
    let cw = await p.operator.maint.workOrders.get({ id: c.id });
    await p.operator.maint.workOrders.move({ id: cw.id, serverSeq: cw.serverSeq, to: "in_progress" });
    setClock(new Date(NOV + 5 * DAY + H));
    cw = await p.operator.maint.workOrders.get({ id: c.id });
    await p.operator.maint.workOrders.move({ id: cw.id, serverSeq: cw.serverSeq, to: "done", workDone: "Reset" });
    await p.manager.maint.settings.set({ labourRatePaisePerHour: 30_000 });

    setClock(new Date(NOV + 30 * DAY + H)); // 1 Dec, so November is whole
    const report = await p.manager.maint.reports.summary({ from: "2026-11", to: "2026-11" });
    expect(report).toMatchObject({ months: ["2026-11"], showMoney: true, labourRatePaisePerHour: 30_000, sparesValueKnown: false });
    const byCode = Object.fromEntries(report.rows.map((r) => [r.asset.code, r]));
    // 43,200 min in November; press down 360 min over 2 breakdowns: MTTR 180, MTBF 21,420.
    expect(byCode["PRESS-1"]!.months[0]).toMatchObject({ month: "2026-11", failures: 2, downtimeMin: 360, mttrMin: 180, mtbfMin: 21_420, labourMin: 120, labourPaise: 60_000, sparesValuePaise: null });
    expect(byCode["CMP-1"]!.months[0]).toMatchObject({ failures: 1, downtimeMin: 60, mttrMin: 60, mtbfMin: 43_140, labourMin: 0, labourPaise: 0 });

    // No money for a supervisor's... a supervisor holds maint.manage; an operator does not.
    const floor = await p.operator.maint.reports.summary({ from: "2026-11", to: "2026-11" });
    expect(floor.showMoney).toBe(false);
    expect(floor.labourRatePaisePerHour).toBeNull();
    expect(floor.rows.find((r) => r.asset.code === "PRESS-1")!.months[0]!.labourPaise).toBeNull();
    expect(await errOf(p.operator.maint.settings.get())).toMatchObject({ code: "FORBIDDEN" });
    expect(await errOf(p.operator.maint.settings.set({ labourRatePaisePerHour: 1 }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await errOf(p.manager.maint.reports.summary({ from: "2025-01", to: "2026-11" }))).toMatchObject({ code: "BAD_REQUEST" });
    expect(await p.manager.maint.settings.get()).toEqual({ labourRatePaisePerHour: 30_000 });

    // Another plant sees its own (empty) report and its own rate.
    const q = await plant();
    expect((await q.manager.maint.reports.summary({ from: "2026-11", to: "2026-11" })).rows).toEqual([]);
    expect(await q.manager.maint.settings.get()).toEqual({ labourRatePaisePerHour: null });
    expect(press.id).toBeTruthy();
  });

  test("a breakdown across months counts in the month it started; open breakdowns and condition work orders stay out", async () => {
    const OCT = Date.UTC(2026, 8, 30, 18, 30); // 1 Oct 2026 00:00 IST
    setClock(new Date(OCT));
    const p = await plant();
    await p.manager.maint.assets.create({ code: "PRESS-1", name: "Press 1", kind: "press", linkKind: "press", linkId: p.lineId, criticality: "A", status: "running" });
    const cmp = await p.manager.maint.assets.create({ code: "CMP-1", name: "Compressor", kind: "compressor", criticality: "C", status: "running" });
    // 25 Oct 00:00 to 5 Nov 00:00 (11 days), then 30 minutes on 12 Nov.
    await p.downtime(new Date(NOV - 7 * DAY), new Date(NOV + 4 * DAY));
    await p.downtime(new Date(NOV + 11 * DAY), new Date(NOV + 11 * DAY + H / 2));
    // A breakdown downtime still running since 20 Nov: listed as still open, not counted.
    await p.downtime(new Date(NOV + 19 * DAY), null);
    // Compressor: a breakdown work order left open since 3 Nov, and a condition work order from a high reading, done.
    setClock(new Date(NOV + 2 * DAY));
    const left = await p.operator.maint.workOrders.create({ assetId: cmp.id, kind: "breakdown", title: "Noise" });
    const kind = await p.manager.maint.readings.createKind({ assetId: cmp.id, name: "Vibration", unit: "mm/s", maxMilli: 7_000 });
    const reading = await p.operator.maint.readings.record({ kindId: kind.id, valueMilli: 9_000 });
    const cond = await p.operator.maint.readings.makeWorkOrder({ readingId: reading.id });
    const cw = await p.operator.maint.workOrders.get({ id: cond.id });
    expect(cw.kind).toBe("condition");
    await p.operator.maint.workOrders.move({ id: cw.id, serverSeq: cw.serverSeq, to: "in_progress" });
    setClock(new Date(NOV + 2 * DAY + 3 * H));
    const cw2 = await p.operator.maint.workOrders.get({ id: cond.id });
    await p.operator.maint.workOrders.move({ id: cw2.id, serverSeq: cw2.serverSeq, to: "done", workDone: "Bearing greased" });
    // Today counts only breakdowns as open breakdowns.
    expect((await p.supervisor.maint.today())).toMatchObject({ openBreakdowns: 1 });

    setClock(new Date(NOV + 30 * DAY + H));
    const report = await p.manager.maint.reports.summary({ from: "2026-10", to: "2026-11" });
    expect(report.truncated).toBe(false);
    const byCode = Object.fromEntries(report.rows.map((r) => [r.asset.code, r]));
    const press = byCode["PRESS-1"]!;
    // October: the 11-day breakdown counts here with its full length; downtime only the 7 days inside October.
    expect(press.months[0]).toMatchObject({ month: "2026-10", failures: 1, downtimeMin: 7 * 24 * 60, mttrMin: 11 * 24 * 60 });
    // November: only the 30-minute breakdown is a failure; downtime adds the 4 days carried over.
    expect(press.months[1]).toMatchObject({ month: "2026-11", failures: 1, downtimeMin: 4 * 24 * 60 + 30, mttrMin: 30 });
    expect(press.total).toMatchObject({ failures: 2, downtimeMin: 11 * 24 * 60 + 30 });
    expect(press.stillOpen).toHaveLength(1);
    expect(press.stillOpen[0]).toMatchObject({ startMs: NOV + 19 * DAY, ageMin: (11 * 24 + 1) * 60 });
    // Compressor: no failures at all (the open breakdown waits, the condition work order is not a breakdown).
    const c = byCode["CMP-1"]!;
    expect(c.total).toMatchObject({ failures: 0, downtimeMin: 0, mttrMin: null, mtbfMin: null });
    expect(c.stillOpen.map((o) => o.workOrderId)).toEqual([left.id]);
  });

  test("more than 5,000 rows in range: the report says it is cut short", async () => {
    setClock(new Date(NOV + 10 * DAY));
    const p = await plant();
    await p.manager.maint.assets.create({ code: "PRESS-1", name: "Press 1", kind: "press", linkKind: "press", linkId: p.lineId, criticality: "A", status: "running" });
    const one = await p.downtime(new Date(NOV + DAY), new Date(NOV + DAY + 60_000));
    await env.db.run(sql`
      with recursive n(i) as (select 1 union all select i + 1 from n where i < 5000)
      insert into press_downtime (id, company_id, press_line_id, reason_code_id, started_at, stopped_at)
      select ${one} || '-' || i, company_id, press_line_id, reason_code_id, started_at + i * 1000, started_at + i * 1000 + 500
      from n, press_downtime where press_downtime.id = ${one}`);
    const report = await p.manager.maint.reports.summary({ from: "2026-11", to: "2026-11" });
    expect(report.truncated).toBe(true);
    const fewer = await (await plant()).manager.maint.reports.summary({ from: "2026-11", to: "2026-11" });
    expect(fewer.truncated).toBe(false);
  });
});
