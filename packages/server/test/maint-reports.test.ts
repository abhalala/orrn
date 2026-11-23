/**
 * XE parity lane MAINT, row 67: downtime minutes, MTBF and MTTR per asset per month, labour and spares,
 * and the labour rate setting. A downtime entry and the work order made from it count once; money shows
 * only for maint.manage holders.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { createTestEnv, type TestEnv } from "./harness";
import { DAY, H, errOf, maintPlant } from "./maint-fixture";

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
});
