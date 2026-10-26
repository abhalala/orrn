/**
 * W3-AG-S ageing server: masters, the trolley batch from load to close on a real logged press run,
 * the soak verdict with the 15 min reading hold (review I2), release / hold / unhold (I5) / override,
 * rework and void (I4), whole-bundle rows (I3), pack's draw guarded inside the batch (I6), the order
 * strip's agedG (I7), dispatch refusals, the feed (telemetry device id, simulator), replays, reports,
 * Today, the reopen blocker, tenancy and the permission matrix.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { wrapSecret } from "@orrn/crypto";
import * as ag from "@orrn/db/schema/ageing";
import { approval, auditLog, bundle, company, pressRunLine, reasonCode, stockLedger } from "@orrn/db/schema";
import { spoolDeployment } from "@orrn/db/schema/spool";
import { and, eq, sql } from "drizzle-orm";

import { can, type Action } from "../src/lib/permissions";
import { DEV_MASTER_KEY, workersEnv } from "./env-mock";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";
import { plantDay } from "./plant-day";
import { fillWorkedExample, kg, pressHelpers, type PressPlant } from "./press-w2-fixture";

setDefaultTimeout(120_000);

let env: TestEnv;
let pressPlant: ReturnType<typeof pressHelpers>["pressPlant"];

beforeAll(async () => {
  env = await createTestEnv();
  ({ pressPlant } = pressHelpers(() => env));
}, 60_000);

afterAll(async () => {
  await env.dispose();
});

afterEach(() => {
  delete (workersEnv as Record<string, unknown>).OVEN_SIMULATOR;
});

const MIN = 60_000;
const SHIFTS = [
  { id: "ag-day", name: "Day", seq: 1, startMin: 8 * 60, endMin: 20 * 60 },
  { id: "ag-night", name: "Night", seq: 2, startMin: 20 * 60, endMin: 8 * 60 },
];
const ROLES: CompanyRole[] = ["owner", "admin", "manager", "office", "accountant", "supervisor", "packer", "foundry", "press", "storekeeper", "die_room", "operator", "viewer"];
let codeSeq = 0;

type AgPlant = PressPlant & { ovenId: string; t1: string; t2: string; recipeId: string; topUpId: string };

async function agPlant(settings: Record<string, unknown> = {}): Promise<AgPlant> {
  const p = await pressPlant({ settings: { shifts: SHIFTS, ...settings } });
  const mgr = p.as("manager");
  codeSeq += 1;
  const oven = await mgr.ageing.ovens.save({ code: `ov-${codeSeq}`, status: "active", capacityG: 2_000_000, maxTempX10: 2500 });
  const t1 = await mgr.ageing.trolleys.save({ code: `T-${codeSeq}A`, status: "active" });
  const t2 = await mgr.ageing.trolleys.save({ code: `T-${codeSeq}B`, status: "active" });
  const recipe = await mgr.ageing.recipes.save({ alloy: "6063", temper: "T6", targetTempX10: 1850, soakMin: 240, hardnessMinX10: 80, status: "active" });
  const topUp = await mgr.ageing.recipes.save({ alloy: "6063", temper: "T6", kind: "top_up", targetTempX10: 1850, soakMin: 60, hardnessMinX10: 80, status: "active" });
  return { ...p, ovenId: oven.id, t1: t1.id, t2: t2.id, recipeId: recipe.id, topUpId: topUp.id };
}

/** A logged run of the worked example: one line, 80 pcs, 234.2 kg, cut 3658, on an order line. */
async function loggedLine(p: AgPlant) {
  const c = await p.castWith(kg(400));
  const r = await p.countingRun();
  await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
  await p.as("supervisor").press.runs.close({ id: r.runId });
  const [line] = await env.db.select().from(pressRunLine).where(eq(pressRunLine.pressRunId, r.runId));
  return { ...r, castId: c.id, lineId: line!.id, solId: line!.salesOrderLineId };
}

/** Readings every `step` min at `temp` from in_at + step to `toMin` (direct rows: the soak rule reads them). */
async function logReadings(p: AgPlant, batchId: string, inAt: number, toMin: number, temp = 1850, step = 15) {
  const rows = [];
  for (let m = step; m <= toMin; m += step) rows.push({ id: crypto.randomUUID(), companyId: p.companyId, batchId, at: new Date(inAt + m * MIN), tempCX10: temp, source: "typed" as const });
  for (let i = 0; i < rows.length; i += 10) await env.db.insert(ag.ageingTempLog).values(rows.slice(i, i + 10));
}

/** Load → start (in_at `minutes` ago) → readings → out. Returns the batch and its in_at. */
async function cycled(p: AgPlant, load: { trolleyId?: string; rows?: { pressRunLineId: string; pcs: number }[]; bundles?: { bundleId: string }[] }, minutes = 300, temp = 1850) {
  const press = p.as("press");
  const b = await press.ageing.batches.load({ trolleyId: load.trolleyId ?? p.t1, rows: load.rows ?? [], bundles: load.bundles ?? [] });
  const inAt = Date.now() - minutes * MIN;
  await press.ageing.batches.start({ batchId: b.id, ovenId: p.ovenId, recipeId: p.recipeId, shiftId: "ag-day", gasStartMilli: 1_000, inAt });
  await press.ageing.batches.temp({ batchId: b.id, tempCX10: temp, at: inAt + 5 * MIN });
  await logReadings(p, b.id, inAt, minutes - 5, temp);
  await press.ageing.batches.out({ batchId: b.id, gasEndMilli: 5_500 });
  return { batchId: b.id, number: b.number, inAt };
}

async function passHardness(p: AgPlant, batchId: string) {
  const d = await p.owner.ageing.batches.get({ id: batchId });
  for (const r of d.rows.filter((x) => x.status !== "void")) await p.as("press").ageing.batches.hardness({ rowId: r.id, method: "webster", readingsX10: [100, 105, 110] });
}

const reasonId = async (p: AgPlant, kind: string, code: string) =>
  (await env.db.select({ id: reasonCode.id }).from(reasonCode).where(and(eq(reasonCode.companyId, p.companyId), eq(reasonCode.kind, kind as never), eq(reasonCode.code, code))))[0]!.id;

const packRow = (pcs: number, g = 117_100) => ({ quantity: pcs, weightG: g, lengthMm: 3_658 });

/** The ageing audit actions on these subjects (rows, bundles), oldest first. */
async function auditActions(p: AgPlant, subjectIds: string[]): Promise<string[]> {
  const rows = await env.db.select({ action: auditLog.action, subjectId: auditLog.subjectId }).from(auditLog).where(eq(auditLog.companyId, p.companyId)).orderBy(sql`rowid`);
  return rows.filter((r) => r.action.startsWith("ageing.") && subjectIds.includes(r.subjectId ?? "")).map((r) => r.action);
}

/** Start (in_at `minutes` ago) → readings → out, for a batch loaded by the test. */
async function startToOut(p: AgPlant, batchId: string, minutes = 300, temp = 1850) {
  const press = p.as("press");
  const inAt = Date.now() - minutes * MIN;
  await press.ageing.batches.start({ batchId, ovenId: p.ovenId, recipeId: p.recipeId, shiftId: "ag-day", gasStartMilli: 1_000, inAt });
  await press.ageing.batches.temp({ batchId, tempCX10: temp, at: inAt + 5 * MIN });
  await logReadings(p, batchId, inAt, minutes - 5, temp);
  await press.ageing.batches.out({ batchId, gasEndMilli: 5_500 });
  return inAt;
}

describe("masters (FP-AG-01..03)", () => {
  test("office saves drafts; activating is masters.publish; codes are normalized and unique", async () => {
    const p = await agPlant();
    const office = p.as("office");
    const draft = await office.ageing.ovens.save({ code: " ov 9 ", status: "draft" });
    expect(draft.code).toBe("OV-9");
    await expect(office.ageing.ovens.save({ id: draft.id, code: "OV-9", status: "active" })).rejects.toThrow("You don't have permission to do that");
    await expect(office.ageing.trolleys.save({ code: "T*1", status: "draft" })).rejects.toThrow("Use letters, digits and dashes for the code, at most 16");
    await expect(p.as("manager").ageing.ovens.save({ code: "ov-9", status: "draft" })).rejects.toThrow("The code OV-9 is already used");
    expect((await p.as("press").ageing.ovens.list()).items.map((o) => o.code)).not.toContain("OV-9");
    expect((await office.ageing.recipes.suggest()).items).toHaveLength(6);
  });

  test("an active recipe's numbers are locked; publishing a new one archives the old", async () => {
    const p = await agPlant();
    const mgr = p.as("manager");
    await expect(mgr.ageing.recipes.save({ id: p.recipeId, alloy: "6063", temper: "T6", targetTempX10: 1900, soakMin: 240, hardnessMinX10: 80, status: "active" })).rejects.toThrow(
      "An active recipe's numbers cannot change; save a new recipe and archive this one",
    );
    const next = await mgr.ageing.recipes.save({ alloy: "6063", temper: "T6", targetTempX10: 1900, soakMin: 240, hardnessMinX10: 80, status: "active" });
    const [old] = await env.db.select().from(ag.ageingRecipe).where(eq(ag.ageingRecipe.id, p.recipeId));
    expect(old!.status).toBe("archived");
    expect((await mgr.ageing.recipes.list()).items.filter((r) => r.kind === "full").map((r) => r.id)).toEqual([next.id]);
    await expect(mgr.ageing.recipes.save({ alloy: "6063", temper: "T5", targetTempX10: 1850, soakMin: 240, maxSoakMin: 200, hardnessMinX10: 80, status: "draft" })).rejects.toThrow();
  });

  test("review m6: a status save and a load or start racing each other: the later write fails whole and says why", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const mgr = p.as("manager");
    const press = p.as("press");
    const t1 = (await p.owner.ageing.trolleys.get({ id: p.t1 })).code;
    // A load lands between the out-of-service save's read and its write.
    env.beforeNextBatch(() => press.ageing.batches.load({ trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 5 }] }));
    await expect(mgr.ageing.trolleys.save({ id: p.t1, code: t1, status: "out_of_service" })).rejects.toThrow(new RegExp(`^Trolley ${t1} carries AG-\\S+; it stays in service until that batch closes$`));
    expect((await p.owner.ageing.trolleys.get({ id: p.t1 })).status).toBe("active");
    // The other way round: the trolley goes out of service between the load's read and its write.
    const t2 = (await p.owner.ageing.trolleys.get({ id: p.t2 })).code;
    env.beforeNextBatch(() => mgr.ageing.trolleys.save({ id: p.t2, code: t2, status: "out_of_service" }));
    await expect(press.ageing.batches.load({ trolleyId: p.t2, rows: [{ pressRunLineId: l.lineId, pcs: 5 }] })).rejects.toThrow(`Trolley ${t2} is not in service`);
    expect((await p.owner.ageing.trolleys.list({ includeInactive: true })).items.find((t) => t.id === p.t2)).toMatchObject({ status: "out_of_service", openBatchId: null });
    // A start racing the oven's out-of-service save.
    const open = (await p.owner.ageing.batches.list({ trolleyId: p.t1, status: "loading" })).items[0]!;
    const oven = (await p.owner.ageing.ovens.get({ id: p.ovenId })).code;
    env.beforeNextBatch(() => mgr.ageing.ovens.save({ id: p.ovenId, code: oven, status: "out_of_service" }));
    await expect(press.ageing.batches.start({ batchId: open.id, ovenId: p.ovenId, recipeId: p.recipeId, shiftId: "ag-day", gasStartMilli: 1 })).rejects.toThrow(`Oven ${oven} is not in service`);
    expect((await p.owner.ageing.batches.get({ id: open.id })).status).toBe("loading");
  });

  test("review m6: a dispatch reserve racing a whole-bundle load fails whole and names the bundle in ageing", async () => {
    const p = await agPlant();
    const [serial] = await p.pack(p.dieA, [{ kg: 50, pcs: 10 }]);
    const [b] = await env.db.select().from(bundle).where(and(eq(bundle.companyId, p.companyId), eq(bundle.serial, serial!)));
    await env.plantStock(p.companyId, [b!.id]);
    const dispatch = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ id: dispatch.id, serials: [serial!], allowUnassigned: true });
    let batchNumber = "";
    env.beforeNextBatch(async () => {
      batchNumber = (await p.as("press").ageing.batches.load({ trolleyId: p.t1, bundles: [{ bundleId: b!.id }] })).number;
    });
    await expect(p.owner.dispatch.reserve({ id: dispatch.id })).rejects.toThrow(/^Bundle \S+ is in ageing on AG-/);
    expect(batchNumber).toMatch(/^AG-/);
    const [after] = await env.db.select().from(bundle).where(eq(bundle.id, b!.id));
    expect(after!.status).toBe("available");
  });

  test("an oven with a batch in it, or a trolley carrying one, stays in service", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const b = await p.as("press").ageing.batches.load({ trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 10 }] });
    const t = (await p.owner.ageing.trolleys.get({ id: p.t1 })).code;
    await expect(p.as("manager").ageing.trolleys.save({ id: p.t1, code: t, status: "out_of_service" })).rejects.toThrow(`Trolley ${t} carries ${b.number}; it stays in service until that batch closes`);
    await p.as("press").ageing.batches.start({ batchId: b.id, ovenId: p.ovenId, recipeId: p.recipeId, shiftId: "ag-day", gasStartMilli: 1 });
    const o = (await p.owner.ageing.ovens.get({ id: p.ovenId })).code;
    await expect(p.as("manager").ageing.ovens.save({ id: p.ovenId, code: o, status: "out_of_service" })).rejects.toThrow(`Oven ${o} has a batch in it; take it out before changing its status`);
  });
});

describe("the trolley from press to pack (FP-AG-04..10, 15)", () => {
  test("load, start, soak, hardness, release, pack every piece: row and batch close, the trolley is free, agedG follows", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const press = p.as("press");
    expect((await press.ageing.batches.availableLines({})).items.find((x) => x.pressRunLineId === l.lineId)).toMatchObject({ pcsLeft: 80, kgLeftG: 234_200 });
    const first = await press.ageing.batches.load({ trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 50 }] });
    expect(first.number).toMatch(/^AG-/);
    await expect(press.ageing.batches.load({ trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 31 }] })).rejects.toThrow("Only 30 pieces of this press line are left to load");
    const again = await press.ageing.batches.load({ trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 30 }] });
    expect(again.id).toBe(first.id);
    // Largest remainder: the two loads sum back to the line's grams exactly.
    expect(again.totals).toMatchObject({ loadedPcs: 80, loadedKgG: 234_200, pendingPcs: 80 });
    expect((await press.ageing.batches.availableLines({})).items.find((x) => x.pressRunLineId === l.lineId)).toBeUndefined();

    const { lineStrips } = await import("../src/lib/orderStrip");
    if (l.solId) {
      const strip = (await lineStrips(env.db as never, p.companyId, [l.solId])).get(l.solId)!;
      expect(strip.agedG).toBe(234_200);
      expect(strip.pressedG).toBe(0);
    }

    // Start: no reading yet → take-out refused; readings every 15 min → soak met.
    const inAt = Date.now() - 300 * MIN;
    const started = await press.ageing.batches.start({ batchId: first.id, ovenId: p.ovenId, recipeId: p.recipeId, shiftId: "ag-day", gasStartMilli: 1_000, inAt });
    expect(started.batch).toMatchObject({ status: "in_oven", phase: "heating", productionDay: expect.any(String) });
    await expect(press.ageing.batches.out({ batchId: first.id, gasEndMilli: 2_000 })).rejects.toThrow("Record a temperature before taking the batch out");
    const t = await press.ageing.batches.temp({ batchId: first.id, tempCX10: 1850, at: inAt + 10 * MIN });
    expect(t.soakStartedAt).toBe(inAt + 10 * MIN);
    await logReadings(p, first.id, inAt, 295);
    await expect(press.ageing.batches.out({ batchId: first.id, gasEndMilli: 500 })).rejects.toThrow("Gas end is below gas start");
    const out = await press.ageing.batches.out({ batchId: first.id, gasEndMilli: 5_500 });
    expect(out).toMatchObject({ status: "out", gasUsedMilli: 4_500, soak: { verdict: "ok", met: true } });

    // Hardness: two samples are too few (held as too_few_samples); the third releases on retest.
    const rowId = out.rows[0]!.id;
    const row2 = out.rows[1]!.id;
    await press.ageing.batches.hardness({ rowId, method: "webster", readingsX10: [100, 105] });
    await press.ageing.batches.hardness({ rowId: row2, method: "webster", readingsX10: [100, 100, 100] });
    await expect(press.ageing.batches.release({ batchId: first.id })).rejects.toThrow("You don't have permission to do that");
    const held = await p.as("supervisor").ageing.batches.release({ batchId: first.id });
    // One line passes, one has too few samples: the batch releases what passed and holds the rest.
    expect(held).toMatchObject({ status: "released", qcVerdict: "fail", overrideWouldHelp: true, rows: [{ status: "held" }, { status: "released" }] });
    const retest = await press.ageing.batches.hardness({ rowId, method: "webster", readingsX10: [110] });
    expect(retest).toMatchObject({ status: "released", rows: [{ status: "released", hardnessPass: true, hardnessReadingX10: 105 }, { status: "released" }] });

    const source = await p.as("packer").ageing.packSource({ dieId: l.sectionId });
    expect(source.items).toEqual([
      expect.objectContaining({ ageingRowId: rowId, remainingPcs: 50, cutLengthMm: 3_658 }),
      expect.objectContaining({ ageingRowId: row2, remainingPcs: 30 }),
    ]);

    // Pack every piece of the first row: the row closes; the batch stays released (row 2 has pieces).
    await p.owner.bundle.createReceipt({ dieId: l.sectionId, unit: "pcs", locationId: p.yard, ageingRowId: rowId, rows: [packRow(25), packRow(25)] });
    expect(await p.owner.ageing.batches.get({ id: first.id })).toMatchObject({ status: "released", rows: [{ status: "closed", packedPcs: 50 }, { status: "released" }] });
    const bundles = await env.db.select().from(bundle).where(eq(bundle.ageingRowId, rowId));
    expect(bundles).toHaveLength(2);

    // Q60-A: while the batch is open, a bundle void gives its pieces back (the row reopens); restore draws them again.
    await p.owner.bundle.transitionStatus({ id: bundles[0]!.id, toStatus: "void", reason: "Wrong label" });
    expect(await p.owner.ageing.batches.get({ id: first.id })).toMatchObject({ status: "released", rows: [{ status: "released", remainingPcs: 25 }, { status: "released" }] });
    await p.owner.bundle.transitionStatus({ id: bundles[0]!.id, toStatus: "available" });
    expect(await p.owner.ageing.batches.get({ id: first.id })).toMatchObject({ status: "released", rows: [{ status: "closed", remainingPcs: 0 }, { status: "released" }] });
    // Review m3: the draw, the give-back and the draw again are audited.
    expect(await auditActions(p, [rowId, bundles[0]!.id])).toEqual(["ageing.draw", "ageing.restore", "ageing.draw"]);

    // The rest of the trolley: row and batch close (Q58), the trolley takes a new load.
    await p.owner.bundle.createReceipt({ dieId: l.sectionId, unit: "pcs", locationId: p.yard, ageingRowId: row2, rows: [packRow(30)] });
    const closed = await p.owner.ageing.batches.get({ id: first.id });
    expect(closed).toMatchObject({ status: "closed", rows: [{ status: "closed", packedPcs: 50, remainingPcs: 0 }, { status: "closed", packedPcs: 30 }] });
    if (l.solId) expect((await lineStrips(env.db as never, p.companyId, [l.solId])).get(l.solId)!.agedG).toBe(0);
    const trace = await p.owner.ageing.bundleTrace({ bundleId: bundles[0]!.id });
    expect(trace).toMatchObject({ state: "aged", batchNumber: first.number, pressRunId: l.runId, castId: l.castId, qcVerdict: "pass" });

    const next = await press.ageing.batches.load({ trolleyId: p.t1, manual: [{ dieId: l.sectionId, lengthMm: 3_658, pcs: 5, kgG: 14_000 }] });
    expect(next.id).not.toBe(first.id);
    if (l.orderId) {
      const fo = await p.as("office").ageing.forOrder({ salesOrderId: l.orderId });
      expect(fo.lines.find((x) => x.salesOrderLineId === l.solId)).toMatchObject({ loadedPcs: 80, packedPcs: 80, remainingPcs: 0, agedG: 0 });
    }
  });

  test("review C1 / Q60-A: a bundle voided after its batch closed and its trolley took a new load is written off as loose aged stock", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const { batchId } = await cycled(p, { rows: [{ pressRunLineId: l.lineId, pcs: 10 }] });
    await passHardness(p, batchId);
    await p.as("supervisor").ageing.batches.release({ batchId });
    const rowId = (await p.owner.ageing.batches.get({ id: batchId })).rows[0]!.id;
    // Pack all 10 → the row and the batch close; the trolley is free and takes a new load at once.
    await p.owner.bundle.createReceipt({ dieId: l.sectionId, unit: "pcs", locationId: p.yard, ageingRowId: rowId, rows: [packRow(6, 17_000), packRow(4, 11_000)] });
    expect(await p.owner.ageing.batches.get({ id: batchId })).toMatchObject({ status: "closed", rows: [{ status: "closed", packedPcs: 10, remainingPcs: 0 }] });
    const reload = await p.as("press").ageing.batches.load({ trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 5 }] });
    const [six] = await env.db.select().from(bundle).where(and(eq(bundle.ageingRowId, rowId), eq(bundle.quantity, 6)));

    // The void lands (no reopen, so no trolley clash); the old batch, its row and the new load are untouched.
    await p.owner.bundle.transitionStatus({ id: six!.id, toStatus: "void", reason: "Bent in the yard" });
    expect(await p.owner.ageing.batches.get({ id: batchId })).toMatchObject({ status: "closed", rows: [{ status: "closed", packedPcs: 10, remainingPcs: 0 }] });
    expect(await p.owner.ageing.batches.get({ id: reload.id })).toMatchObject({ status: "loading", trolleyId: p.t1, totals: { loadedPcs: 5 } });
    expect((await p.as("packer").ageing.packSource({ dieId: l.sectionId })).items).toHaveLength(0);
    // The write-off: the bundle's ledger void (its kg out, with the reason) and an ageing.writeOff audit row.
    const ledger = await env.db.select().from(stockLedger).where(and(eq(stockLedger.companyId, p.companyId), eq(stockLedger.itemRef, six!.id)));
    expect(ledger.map((r) => [r.voucherType, Math.sign(Number(r.qtyG))])).toEqual([["pack", 1], ["void", -1]]);
    const [writeOff] = await env.db.select().from(auditLog).where(and(eq(auditLog.subjectId, six!.id), eq(auditLog.action, "ageing.writeOff")));
    expect(writeOff!.meta).toMatchObject({ rowId, reason: "Bent in the yard", kind: "loose_aged" });

    // Restore undoes the write-off: the row is not drawn again; a second void writes off again.
    await p.owner.bundle.transitionStatus({ id: six!.id, toStatus: "available" });
    expect(await p.owner.ageing.batches.get({ id: batchId })).toMatchObject({ status: "closed", rows: [{ packedPcs: 10 }] });
    await p.owner.bundle.transitionStatus({ id: six!.id, toStatus: "void", reason: "Bent in the yard" });
    expect(await auditActions(p, [six!.id])).toEqual(["ageing.writeOff", "ageing.writeOffUndo", "ageing.writeOff"]);
    expect(await p.owner.ageing.batches.get({ id: batchId })).toMatchObject({ status: "closed", rows: [{ packedPcs: 10 }] });
  });

  test("Q60-A: pieces given back while open are drawn again on restore; once another pack took them and the batch closed, the restore is refused", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const { batchId } = await cycled(p, { rows: [{ pressRunLineId: l.lineId, pcs: 10 }] });
    await passHardness(p, batchId);
    await p.as("supervisor").ageing.batches.release({ batchId });
    const rowId = (await p.owner.ageing.batches.get({ id: batchId })).rows[0]!.id;
    await p.owner.bundle.createReceipt({ dieId: l.sectionId, unit: "pcs", locationId: p.yard, ageingRowId: rowId, rows: [packRow(4, 11_000)] });
    const [four] = await env.db.select().from(bundle).where(eq(bundle.ageingRowId, rowId));
    await p.owner.bundle.transitionStatus({ id: four!.id, toStatus: "void", reason: "Wrong label" });
    expect(await p.owner.ageing.batches.get({ id: batchId })).toMatchObject({ status: "released", rows: [{ remainingPcs: 10 }] });
    // The 10 pieces are packed again on new bundles: the row and the batch close.
    await p.owner.bundle.createReceipt({ dieId: l.sectionId, unit: "pcs", locationId: p.yard, ageingRowId: rowId, rows: [packRow(10, 27_000)] });
    expect((await p.owner.ageing.batches.get({ id: batchId })).status).toBe("closed");
    await expect(p.owner.bundle.transitionStatus({ id: four!.id, toStatus: "available" })).rejects.toThrow("This trolley line is not released; it is not on the pack list");
    expect(await p.owner.ageing.batches.get({ id: batchId })).toMatchObject({ status: "closed", rows: [{ packedPcs: 10, remainingPcs: 0 }] });
  });

  test("review r2 n1: restoring a bundle whose void was no give-back (no ageing audit, as a phantom-count void) never draws the trolley line again", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const { batchId } = await cycled(p, { rows: [{ pressRunLineId: l.lineId, pcs: 10 }] });
    await passHardness(p, batchId);
    await p.as("supervisor").ageing.batches.release({ batchId });
    const rowId = (await p.owner.ageing.batches.get({ id: batchId })).rows[0]!.id;
    await p.owner.bundle.createReceipt({ dieId: l.sectionId, unit: "pcs", locationId: p.yard, ageingRowId: rowId, rows: [packRow(4, 11_000), packRow(4, 11_000)] });
    const [a] = await env.db.select().from(bundle).where(eq(bundle.ageingRowId, rowId));
    // A void with no ageing audit on the bundle: the row keeps counting its 4 pieces (what a phantom void leaves behind).
    await p.owner.bundle.transitionStatus({ id: a!.id, toStatus: "void", reason: "Wrong label" });
    await env.db.delete(auditLog).where(and(eq(auditLog.subjectId, a!.id), sql`${auditLog.action} like 'ageing.%'`));
    await env.db.update(ag.ageingRow).set({ packedPcs: 8 }).where(eq(ag.ageingRow.id, rowId));
    await p.owner.bundle.transitionStatus({ id: a!.id, toStatus: "available" });
    expect(await p.owner.ageing.batches.get({ id: batchId })).toMatchObject({ status: "released", rows: [{ packedPcs: 8, remainingPcs: 2 }] });
    expect(await auditActions(p, [a!.id])).not.toContain("ageing.draw");
  });

  test("review r2 n2: a give-back restore is refused when QC has held the refilled line since", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const { batchId } = await cycled(p, { rows: [{ pressRunLineId: l.lineId, pcs: 10 }] });
    await passHardness(p, batchId);
    const sup = p.as("supervisor");
    await sup.ageing.batches.release({ batchId });
    const rowId = (await p.owner.ageing.batches.get({ id: batchId })).rows[0]!.id;
    await p.owner.bundle.createReceipt({ dieId: l.sectionId, unit: "pcs", locationId: p.yard, ageingRowId: rowId, rows: [packRow(4, 11_000)] });
    const [four] = await env.db.select().from(bundle).where(eq(bundle.ageingRowId, rowId));
    await p.owner.bundle.transitionStatus({ id: four!.id, toStatus: "void", reason: "Wrong label" });
    await sup.ageing.batches.hold({ rowId, reasonCodeId: await reasonId(p, "ageing_hold", "customer") });
    await expect(p.owner.bundle.transitionStatus({ id: four!.id, toStatus: "available" })).rejects.toThrow("This trolley line is not released; it is not on the pack list");
    expect((await p.owner.ageing.batches.get({ id: batchId })).rows[0]).toMatchObject({ status: "held", packedPcs: 0, remainingPcs: 10 });
    expect((await env.db.select().from(bundle).where(eq(bundle.id, four!.id)))[0]!.status).toBe("void");
  });

  test("start refuses a plant with no shifts, a busy oven, a recipe of another alloy; gas going backwards warns", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const press = p.as("press");
    const a = await press.ageing.batches.load({ trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 40 }] });
    const b = await press.ageing.batches.load({ trolleyId: p.t2, rows: [{ pressRunLineId: l.lineId, pcs: 40 }] });
    const r6061 = await p.as("manager").ageing.recipes.save({ alloy: "6061", temper: "T6", targetTempX10: 1750, soakMin: 480, hardnessMinX10: 150, status: "active" });
    const castNo = (await env.db.select().from(ag.ageingRow).where(eq(ag.ageingRow.batchId, a.id)))[0]!.castId;
    expect(castNo).toBe(l.castId);
    await expect(press.ageing.batches.start({ batchId: a.id, ovenId: p.ovenId, recipeId: r6061.id, shiftId: "ag-day", gasStartMilli: 1 })).rejects.toThrow(/is alloy 6063; this recipe is for 6061$/);
    await expect(press.ageing.batches.start({ batchId: a.id, ovenId: p.ovenId, recipeId: p.recipeId, shiftId: "nope", gasStartMilli: 1 })).rejects.toThrow("Pick a shift of this plant");
    await expect(press.ageing.batches.start({ batchId: a.id, ovenId: p.ovenId, recipeId: p.recipeId, shiftId: "ag-day", gasStartMilli: 1, inAt: Date.now() + 10 * MIN })).rejects.toThrow("That time is in the future");
    await press.ageing.batches.start({ batchId: a.id, ovenId: p.ovenId, recipeId: p.recipeId, shiftId: "ag-day", gasStartMilli: 1_000, inAt: Date.now() - 60 * MIN });
    const ovenCode = (await p.owner.ageing.ovens.get({ id: p.ovenId })).code;
    await expect(press.ageing.batches.start({ batchId: b.id, ovenId: p.ovenId, recipeId: p.recipeId, shiftId: "ag-day", gasStartMilli: 1 })).rejects.toThrow(`Oven ${ovenCode} already has a batch in it`);
    await press.ageing.batches.temp({ batchId: a.id, tempCX10: 1850, at: Date.now() - 30 * MIN });
    await press.ageing.batches.out({ batchId: a.id, gasEndMilli: 3_000 });
    const warned = await press.ageing.batches.start({ batchId: b.id, ovenId: p.ovenId, recipeId: p.recipeId, shiftId: "ag-day", gasStartMilli: 2_000 });
    expect(warned.warning).toBe("gas_backwards");

    const none = await agPlant({ shifts: [] });
    const l2 = await loggedLine(none);
    const c = await none.as("press").ageing.batches.load({ trolleyId: none.t1, rows: [{ pressRunLineId: l2.lineId, pcs: 1 }] });
    await expect(none.as("press").ageing.batches.start({ batchId: c.id, ovenId: none.ovenId, recipeId: none.recipeId, shiftId: "ag-day", gasStartMilli: 1 })).rejects.toThrow(
      "Add shifts in Settings before starting a batch",
    );
  });

  test("review I2: an hour between typed readings leaves the soak short (each reading holds 15 min)", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const press = p.as("press");
    const b = await press.ageing.batches.load({ trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 10 }] });
    const inAt = Date.now() - 300 * MIN;
    await press.ageing.batches.start({ batchId: b.id, ovenId: p.ovenId, recipeId: p.recipeId, shiftId: "ag-day", gasStartMilli: 1, inAt });
    await logReadings(p, b.id, inAt, 295, 1850, 60);
    const out = await press.ageing.batches.out({ batchId: b.id, gasEndMilli: 2 });
    expect(out.soak).toMatchObject({ verdict: "under_aged", inBandMin: 4 * 15 });
    expect(out.soak!.unknownMin).toBeGreaterThan(200);
  });
});

describe("release, hold, override, unhold (FP-AG-08, 11, 14)", () => {
  test("a short soak holds every line; the requester cannot approve; an approved override releases on the next release", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const { batchId } = await cycled(p, { rows: [{ pressRunLineId: l.lineId, pcs: 20 }] }, 120);
    await passHardness(p, batchId);
    const sup = p.as("supervisor");
    const held = await sup.ageing.batches.release({ batchId });
    expect(held).toMatchObject({ status: "held", qcVerdict: "fail", soak: { verdict: "under_aged" } });
    const [row] = await env.db.select().from(ag.ageingRow).where(eq(ag.ageingRow.batchId, batchId));
    expect(row!.holdReasonCodeId).toBe(await reasonId(p, "ageing_reject", "under_aged"));
    const { approvalId } = await sup.ageing.batches.requestOverride({ batchId, reason: "Customer accepts a short soak" });
    await expect(sup.ageing.batches.requestOverride({ batchId, reason: "again" })).rejects.toThrow(/already has an override waiting for approval$/);
    await expect(p.as("manager").approval.decide({ id: approvalId, decision: "approved" })).resolves.toBeDefined();
    const [stamped] = await env.db.select().from(ag.ageingBatch).where(eq(ag.ageingBatch.id, batchId));
    expect(stamped!.overrideApprovalId).toBe(approvalId);
    expect(stamped!.status).toBe("held");
    const released = await sup.ageing.batches.release({ batchId });
    expect(released).toMatchObject({ status: "released", qcVerdict: "override", rows: [{ status: "released", holdReasonCodeId: null }] });
    await expect(sup.ageing.batches.requestOverride({ batchId, reason: "x" })).rejects.toThrow(/passed; it needs no override$/);
  });

  test("review I5: a hand hold clears with unhold; a QC reject does not; a whole-trolley hold after pack is refused", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const { batchId } = await cycled(p, { rows: [{ pressRunLineId: l.lineId, pcs: 20 }, { pressRunLineId: l.lineId, pcs: 10 }] });
    await passHardness(p, batchId);
    const sup = p.as("supervisor");
    const d = await sup.ageing.batches.release({ batchId });
    expect(d.status).toBe("released");
    const [a, b] = d.rows;
    const customer = await reasonId(p, "ageing_hold", "customer");
    await expect(p.as("press").ageing.batches.hold({ rowId: a!.id, reasonCodeId: customer })).rejects.toThrow("You don't have permission to do that");
    await expect(sup.ageing.batches.hold({ rowId: a!.id, reasonCodeId: await reasonId(p, "ageing_abort", "power_cut") })).rejects.toThrow("Pick a reason from this list");
    const h = await sup.ageing.batches.hold({ rowId: a!.id, reasonCodeId: customer, note: "Customer asked to wait" });
    expect(h.status).toBe("released");
    await expect(sup.ageing.batches.hold({ rowId: a!.id, reasonCodeId: customer })).rejects.toThrow("This trolley line is already held");
    expect((await p.as("packer").ageing.packSource({})).items.map((x) => x.ageingRowId)).toEqual([b!.id]);
    // A later passing hardness never clears a hand hold.
    await p.as("press").ageing.batches.hardness({ rowId: a!.id, method: "webster", readingsX10: [120] });
    expect((await p.owner.ageing.batches.get({ id: batchId })).rows.find((r) => r.id === a!.id)!.status).toBe("held");
    const un = await sup.ageing.batches.unhold({ rowId: a!.id, note: "Customer cleared it" });
    expect(un.rows.find((r) => r.id === a!.id)).toMatchObject({ status: "released", holdReasonCodeId: null });
    await expect(sup.ageing.batches.unhold({ rowId: a!.id })).rejects.toThrow("This trolley line has no hold to clear; a failed test clears with a retest or an approval");

    await p.owner.bundle.createReceipt({ dieId: l.sectionId, unit: "pcs", locationId: p.yard, ageingRowId: b!.id, rows: [packRow(5, 14_000)] });
    await expect(sup.ageing.batches.hold({ batchId, reasonCodeId: customer })).rejects.toThrow("Pieces were packed from this trolley; hold the lines that are still full");
    // Review I6 / m1: the row is held between pack's read and its write (the in-batch guard, not the
    // pre-read, refuses): the receipt fails whole, no bundle lands and the row keeps its pieces.
    const bundlesBefore = (await env.db.select({ id: bundle.id }).from(bundle).where(eq(bundle.ageingRowId, b!.id))).length;
    env.beforeNextBatch(() => sup.ageing.batches.hold({ rowId: b!.id, reasonCodeId: customer }));
    await expect(p.owner.bundle.createReceipt({ dieId: l.sectionId, unit: "pcs", locationId: p.yard, ageingRowId: b!.id, rows: [packRow(1, 3_000)] })).rejects.toThrow(
      "This trolley line is not released; it is not on the pack list",
    );
    expect((await env.db.select({ id: bundle.id }).from(bundle).where(eq(bundle.ageingRowId, b!.id))).length).toBe(bundlesBefore);
    expect((await p.owner.ageing.batches.get({ id: batchId })).rows.find((r) => r.id === b!.id)).toMatchObject({ status: "held", packedPcs: 5, remainingPcs: 5 });
  });

  test("review m2: a manager who requested an override cannot approve it; another approver can", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const { batchId } = await cycled(p, { rows: [{ pressRunLineId: l.lineId, pcs: 5 }] }, 120);
    await passHardness(p, batchId);
    const mgr = p.as("manager");
    expect(await mgr.ageing.batches.release({ batchId })).toMatchObject({ status: "held", soak: { verdict: "under_aged" } });
    const { approvalId } = await mgr.ageing.batches.requestOverride({ batchId, reason: "Customer accepts a short soak" });
    await expect(mgr.approval.decide({ id: approvalId, decision: "approved" })).rejects.toThrow("Someone else has to approve your request");
    await expect(p.as("supervisor").approval.decide({ id: approvalId, decision: "approved" })).rejects.toThrow();
    const [still] = await env.db.select().from(ag.ageingBatch).where(eq(ag.ageingBatch.id, batchId));
    expect(still!.overrideApprovalId).toBeNull();
    await p.as("admin").approval.decide({ id: approvalId, decision: "approved" });
    expect(await mgr.ageing.batches.release({ batchId })).toMatchObject({ status: "released", qcVerdict: "override" });
  });

  test("review m7: an unhold whose batch moved meanwhile names the batch's status; review m8: a re-hold keeps the note", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const sup = p.as("supervisor");
    const customer = await reasonId(p, "ageing_hold", "customer");
    const one = await cycled(p, { rows: [{ pressRunLineId: l.lineId, pcs: 10 }] });
    await passHardness(p, one.batchId);
    const rowId = (await p.owner.ageing.batches.get({ id: one.batchId })).rows[0]!.id;
    await sup.ageing.batches.hold({ rowId, reasonCodeId: customer, note: "Customer asked to wait" });
    env.beforeNextBatch(() => sup.ageing.batches.release({ batchId: one.batchId }));
    await expect(sup.ageing.batches.unhold({ rowId })).rejects.toThrow(new RegExp(`^${one.number} is (held|released); that step is not open now$`));
    const [kept] = await env.db.select().from(ag.ageingRow).where(eq(ag.ageingRow.id, rowId));
    expect(kept).toMatchObject({ status: "held", holdReasonCodeId: customer });

    // m8: released, hand-held with a note, then a soft retest: the unhold holds it again for hardness and keeps the note.
    const two = await cycled(p, { trolleyId: p.t2, rows: [{ pressRunLineId: l.lineId, pcs: 10 }] });
    await passHardness(p, two.batchId);
    expect((await sup.ageing.batches.release({ batchId: two.batchId })).status).toBe("released");
    const row2 = (await p.owner.ageing.batches.get({ id: two.batchId })).rows[0]!.id;
    await sup.ageing.batches.hold({ rowId: row2, reasonCodeId: customer, note: "Customer asked to wait" });
    await p.as("press").ageing.batches.hardness({ rowId: row2, method: "webster", readingsX10: [50] });
    await sup.ageing.batches.unhold({ rowId: row2 });
    const [again] = await env.db.select().from(ag.ageingRow).where(eq(ag.ageingRow.id, row2));
    expect(again).toMatchObject({ status: "held", holdReasonCodeId: await reasonId(p, "ageing_reject", "hardness_low"), holdNote: "Customer asked to wait" });
  });

  test("review m4: a sample of the other method is stored as not deciding (null), never as a fail", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const { batchId } = await cycled(p, { rows: [{ pressRunLineId: l.lineId, pcs: 5 }] });
    const rowId = (await p.owner.ageing.batches.get({ id: batchId })).rows[0]!.id;
    await p.as("press").ageing.batches.hardness({ rowId, method: "hb", readingsX10: [600] });
    const d = await p.as("press").ageing.batches.hardness({ rowId, method: "webster", readingsX10: [100, 105, 110] });
    expect(d.hardness.map((h) => [h.method, h.pass])).toEqual([["hb", null], ["webster", true], ["webster", true], ["webster", true]]);
    expect(d.rows[0]).toMatchObject({ hardnessPass: true, hardnessReadingX10: 105 });
    const stored = await env.db.select({ method: ag.ageingHardness.method, pass: ag.ageingHardness.pass }).from(ag.ageingHardness).where(eq(ag.ageingHardness.rowId, rowId));
    expect(stored.filter((x) => x.method === "hb")).toEqual([{ method: "hb", pass: null }]);
  });

  test("a QC-held line is not cleared by unhold", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const { batchId } = await cycled(p, { rows: [{ pressRunLineId: l.lineId, pcs: 5 }] });
    await p.as("press").ageing.batches.hardness({ rowId: (await p.owner.ageing.batches.get({ id: batchId })).rows[0]!.id, method: "webster", readingsX10: [50, 60, 70] });
    const d = await p.as("supervisor").ageing.batches.release({ batchId });
    expect(d).toMatchObject({ status: "held", rows: [{ status: "held" }] });
    await expect(p.as("supervisor").ageing.batches.unhold({ rowId: d.rows[0]!.id })).rejects.toThrow(/^This trolley line has no hold to clear/);
  });
});

describe("rework, discard, split, void (FP-AG-09, 12, 13; review I4)", () => {
  test("rework moves held pieces once; the original closes and frees its trolley; the original cannot be voided", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const { batchId, number } = await cycled(p, { rows: [{ pressRunLineId: l.lineId, pcs: 30 }] });
    const rowId = (await p.owner.ageing.batches.get({ id: batchId })).rows[0]!.id;
    await p.as("press").ageing.batches.hardness({ rowId, method: "webster", readingsX10: [60, 60, 60] });
    const sup = p.as("supervisor");
    await sup.ageing.batches.release({ batchId });
    const { original, successor } = await sup.ageing.batches.rework({ batchId });
    expect(original).toMatchObject({ status: "closed", disposition: "rework", successorBatchId: successor.id, totals: { reworkPcs: 30, remainingPcs: 0 } });
    expect(successor).toMatchObject({ status: "loading", reworkOfBatchId: batchId, trolleyId: p.t1, totals: { loadedPcs: 30, loadedKgG: 87_825 } });
    expect(successor.recipeLabel).toBe("6063 T6 top-up");
    // The press line counts the 30 pieces once: 50 left, not 20 or 80.
    expect((await p.as("press").ageing.batches.availableLines({})).items.find((x) => x.pressRunLineId === l.lineId)).toMatchObject({ pcsLeft: 50, kgLeftG: 146_375 });
    await expect(sup.ageing.batches.void({ batchId, reasonCodeId: await reasonId(p, "ageing_abort", "wrong_load") })).rejects.toThrow(`Pieces of ${number} were aged again or discarded; it cannot be voided`);

    // Review m5: a successor still loading can be voided (by the release role: it undoes a QC decision).
    // Its pieces go back on the original line, held again with their reason; the original is held again.
    await expect(p.as("press").ageing.batches.void({ batchId: successor.id })).rejects.toThrow("You don't have permission to do that");
    const undone = await sup.ageing.batches.void({ batchId: successor.id });
    expect(undone).toMatchObject({ status: "void" });
    expect(await p.owner.ageing.batches.get({ id: batchId })).toMatchObject({
      status: "held",
      disposition: null,
      successorBatchId: null,
      rows: [{ status: "held", reworkPcs: 0, remainingPcs: 30, holdReasonCodeId: await reasonId(p, "ageing_reject", "hardness_low") }],
    });
    expect((await p.as("press").ageing.batches.availableLines({})).items.find((x) => x.pressRunLineId === l.lineId)).toMatchObject({ pcsLeft: 50, kgLeftG: 146_375 });
    // The rework can be done again; once the successor has gone into the oven its void stays refused.
    const redo = await sup.ageing.batches.rework({ batchId });
    await p.as("press").ageing.batches.start({ batchId: redo.successor.id, ovenId: p.ovenId, recipeId: p.topUpId, shiftId: "ag-day", gasStartMilli: 1, inAt: Date.now() - 90 * MIN });
    await p.as("press").ageing.batches.temp({ batchId: redo.successor.id, tempCX10: 1850, at: Date.now() - 80 * MIN });
    await p.as("press").ageing.batches.out({ batchId: redo.successor.id, gasEndMilli: 2 });
    await expect(sup.ageing.batches.void({ batchId: redo.successor.id, reasonCodeId: await reasonId(p, "ageing_abort", "wrong_load") })).rejects.toThrow(
      `Pieces of ${redo.successor.number} were aged again or discarded; it cannot be voided`,
    );
  });

  test("review r2 n3: undoing a rework whose successor took an extra load or a split says so, and changes nothing", async () => {
    const p = await agPlant({ ageing: { split: true } });
    const l = await loggedLine(p);
    const { batchId } = await cycled(p, { rows: [{ pressRunLineId: l.lineId, pcs: 30 }] });
    const rowId = (await p.owner.ageing.batches.get({ id: batchId })).rows[0]!.id;
    await p.as("press").ageing.batches.hardness({ rowId, method: "webster", readingsX10: [60, 60, 60] });
    const sup = p.as("supervisor");
    await sup.ageing.batches.release({ batchId });
    const { successor } = await sup.ageing.batches.rework({ batchId });
    const said = (n: string) => `${n} took more pieces or was split after the rework; it cannot be voided`;
    // An extra load on the successor's trolley.
    await p.as("press").ageing.batches.load({ trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 5 }] });
    await expect(sup.ageing.batches.void({ batchId: successor.id })).rejects.toThrow(said(successor.number));
    expect(await p.owner.ageing.batches.get({ id: successor.id })).toMatchObject({ status: "loading", totals: { loadedPcs: 35 } });
    expect(await p.owner.ageing.batches.get({ id: batchId })).toMatchObject({ status: "closed", disposition: "rework" });
    // A split of its line says the same.
    const again = await p.owner.ageing.batches.get({ id: successor.id });
    const cut = await sup.ageing.batches.split({ rowId: again.rows[0]!.id, cuts: [{ lengthMm: 1_829, pcs: 30 }, { lengthMm: 3_658, pcs: 15 }] });
    expect(cut.rows.length).toBeGreaterThan(2);
    await expect(sup.ageing.batches.void({ batchId: successor.id })).rejects.toThrow(said(successor.number));
  });

  test("void: free while loading (load role); never in the oven; after take-out a supervisor with an ageing_abort reason; pieces go back once", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const press = p.as("press");
    const a = await press.ageing.batches.load({ trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 30 }] });
    await press.ageing.batches.void({ batchId: a.id });
    expect((await press.ageing.batches.availableLines({})).items.find((x) => x.pressRunLineId === l.lineId)!.pcsLeft).toBe(80);
    const b = await press.ageing.batches.load({ trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 30 }] });
    await press.ageing.batches.start({ batchId: b.id, ovenId: p.ovenId, recipeId: p.recipeId, shiftId: "ag-day", gasStartMilli: 1, inAt: Date.now() - 30 * MIN });
    await expect(p.as("supervisor").ageing.batches.void({ batchId: b.id })).rejects.toThrow(`${b.number} is in the oven; take it out first`);
    await press.ageing.batches.temp({ batchId: b.id, tempCX10: 1700 });
    await press.ageing.batches.out({ batchId: b.id, gasEndMilli: 2 });
    await expect(press.ageing.batches.void({ batchId: b.id })).rejects.toThrow("You don't have permission to do that");
    await expect(p.as("supervisor").ageing.batches.void({ batchId: b.id })).rejects.toThrow("Say why this batch is voided");
    await p.as("supervisor").ageing.batches.void({ batchId: b.id, reasonCodeId: await reasonId(p, "ageing_abort", "burner_fault") });
    expect((await press.ageing.batches.availableLines({})).items.find((x) => x.pressRunLineId === l.lineId)!.pcsLeft).toBe(80);
  });

  test("discard writes scrap pieces only; split (setting on) keeps length × pieces and grams", async () => {
    const p = await agPlant({ ageing: { split: true } });
    const l = await loggedLine(p);
    const { batchId } = await cycled(p, { rows: [{ pressRunLineId: l.lineId, pcs: 20 }] });
    const rowId = (await p.owner.ageing.batches.get({ id: batchId })).rows[0]!.id;
    const sup = p.as("supervisor");
    const split = await sup.ageing.batches.split({ rowId, cuts: [{ lengthMm: 1_829, pcs: 20 }, { lengthMm: 3_658, pcs: 10 }] });
    expect(split.rows.map((r) => [r.lengthMm, r.pcs, r.kgG])).toEqual([
      [1_829, 20, 29_275],
      [3_658, 10, 29_275],
    ]);
    // Review I1: the press line still counts 20 of its own 3658 mm pieces on the trolley, so 60 are left.
    const press = p.as("press");
    expect((await press.ageing.batches.availableLines({})).items.find((x) => x.pressRunLineId === l.lineId)).toMatchObject({ pcsLeft: 60, kgLeftG: 234_200 - 58_550 });
    const bend = await reasonId(p, "ageing_scrap", "bend");
    await expect(sup.ageing.batches.discardRemaining({ rowId, pcs: 21, reasonCodeId: bend })).rejects.toThrow("Only 20 pieces are left on this trolley line");
    const d = await sup.ageing.batches.discardRemaining({ rowId, pcs: 2, reasonCodeId: bend });
    expect(d.rows[0]).toMatchObject({ scrapPcs: 2, remainingPcs: 18 });
    await expect(sup.ageing.batches.split({ rowId, cuts: [{ lengthMm: 1_829, pcs: 2 }, { lengthMm: 1_829, pcs: 2 }] })).rejects.toThrow(
      "Pieces were packed from this trolley line; it cannot be split",
    );
  });

  test("review I1: a split keeps the press line's piece count in its cut length (40 → 40 @1829 + 20 @3658 is still 40)", async () => {
    const p = await agPlant({ ageing: { split: true } });
    const l = await loggedLine(p);
    const { batchId } = await cycled(p, { trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 40 }] });
    const rowId = (await p.owner.ageing.batches.get({ id: batchId })).rows[0]!.id;
    await p.as("supervisor").ageing.batches.split({ rowId, cuts: [{ lengthMm: 1_829, pcs: 40 }, { lengthMm: 3_658, pcs: 20 }] });
    const press = p.as("press");
    // 40 of the line's 80 pieces are on the trolley: 40 left with the grams of 40 pieces.
    expect((await press.ageing.batches.availableLines({})).items.find((x) => x.pressRunLineId === l.lineId)).toMatchObject({ pcsLeft: 40, kgLeftG: 117_100 });
    // The load and its write-time guard count the same way: 41 is over, 40 fits and empties the line.
    await expect(press.ageing.batches.load({ trolleyId: p.t2, rows: [{ pressRunLineId: l.lineId, pcs: 41 }] })).rejects.toThrow("Only 40 pieces of this press line are left to load");
    const rest = await press.ageing.batches.load({ trolleyId: p.t2, rows: [{ pressRunLineId: l.lineId, pcs: 40 }] });
    expect(rest.totals).toMatchObject({ loadedPcs: 40, loadedKgG: 117_100 });
    expect((await press.ageing.batches.availableLines({})).items.find((x) => x.pressRunLineId === l.lineId)).toBeUndefined();
  });
});

describe("whole bundles on a trolley (review I3) and dispatch", () => {
  test("review I2: a trolley of 60 or 120 whole bundles (repeat loads) releases within D1's 100 bound parameters", async () => {
    for (const n of [60, 120]) {
      const p = await agPlant();
      const seeded = await env.seedBundles(p.companyId, p.dieA, n);
      const press = p.as("press");
      let batchId = "";
      for (let i = 0; i < n; i += 40) batchId = (await press.ageing.batches.load({ trolleyId: p.t1, bundles: seeded.slice(i, i + 40).map((b) => ({ bundleId: b.id })) })).id;
      await startToOut(p, batchId);
      // Three passing Webster samples per line, written directly (120 hardness calls would only slow the test).
      const rows = await env.db.select({ id: ag.ageingRow.id }).from(ag.ageingRow).where(eq(ag.ageingRow.batchId, batchId));
      expect(rows).toHaveLength(n);
      const samples = rows.flatMap((r) => [100, 105, 110].map((readingX10) => ({ id: crypto.randomUUID(), companyId: p.companyId, batchId, rowId: r.id, method: "webster" as const, readingX10, pass: true })));
      for (let i = 0; i < samples.length; i += 10) await env.db.insert(ag.ageingHardness).values(samples.slice(i, i + 10));
      env.resetPeakParams();
      const rel = await p.as("supervisor").ageing.batches.release({ batchId });
      expect(env.peakParams()).toBeLessThanOrEqual(100);
      expect({ n, status: rel.status, closed: rel.rows.filter((r) => r.status === "closed" && r.packedPcs === 10).length }).toEqual({ n, status: "closed", closed: n });
      const aged = await env.db.select({ id: bundle.id }).from(bundle).where(and(eq(bundle.companyId, p.companyId), sql`${bundle.ageingRowId} is not null`));
      expect(aged).toHaveLength(n);
    }
  });


  test("a bundle in the oven cannot dispatch or be voided; release marks it aged and closes its row with packed = pcs", async () => {
    const p = await agPlant();
    const [serial] = await p.pack(p.dieA, [{ kg: 50, pcs: 10 }]);
    const [b] = await env.db.select().from(bundle).where(and(eq(bundle.companyId, p.companyId), eq(bundle.serial, serial!)));
    const loaded = await p.as("press").ageing.batches.load({ trolleyId: p.t1, bundles: [{ bundleId: b!.id }] });
    expect(loaded.rows[0]).toMatchObject({ source: "bundle", packedPcs: 0, remainingPcs: 10 });
    await expect(p.owner.bundle.transitionStatus({ id: b!.id, toStatus: "void", reason: "x" })).rejects.toThrow(`Bundle ${serial} is in ageing on ${loaded.number}`);
    const dispatch = await p.owner.dispatch.create({ customerId: p.customerId });
    await expect(p.owner.dispatch.addBundlesBySerial({ id: dispatch.id, serials: [serial!], allowUnassigned: true })).rejects.toThrow(`Bundle ${serial} is in ageing on ${loaded.number}`);
    await expect(p.as("press").ageing.batches.load({ trolleyId: p.t2, bundles: [{ bundleId: b!.id }] })).rejects.toThrow(`Bundle ${serial} is already on ${loaded.number}`);

    const inAt = Date.now() - 300 * MIN;
    await p.as("press").ageing.batches.start({ batchId: loaded.id, ovenId: p.ovenId, recipeId: p.recipeId, shiftId: "ag-day", gasStartMilli: 1, inAt });
    await logReadings(p, loaded.id, inAt, 295);
    await p.as("press").ageing.batches.out({ batchId: loaded.id, gasEndMilli: 2 });
    await passHardness(p, loaded.id);
    const rel = await p.as("supervisor").ageing.batches.release({ batchId: loaded.id });
    expect(rel).toMatchObject({ status: "closed", rows: [{ status: "closed", packedPcs: 10, remainingPcs: 0 }], totals: { packablePcs: 0 } });
    const [after] = await env.db.select().from(bundle).where(eq(bundle.id, b!.id));
    expect(after!.ageingRowId).toBe(rel.rows[0]!.id);
    expect((await p.owner.ageing.bundleTrace({ bundleId: b!.id })).state).toBe("aged");
    expect((await p.as("packer").ageing.packSource({})).items).toHaveLength(0);
    // Its own row never moves on a bundle void (no phantom pieces).
    await p.owner.bundle.transitionStatus({ id: b!.id, toStatus: "void", reason: "x" });
    const [row] = await env.db.select().from(ag.ageingRow).where(eq(ag.ageingRow.id, rel.rows[0]!.id));
    expect([row!.packedPcs, row!.status]).toEqual([10, "closed"]);
  });

  test("requireAgeing on with no day starts today (review m4): a bundle packed today and never aged does not dispatch", async () => {
    const p = await agPlant();
    const [serial] = await p.pack(p.dieA, [{ kg: 50, pcs: 10 }]);
    const res = await p.owner.company.updateSettings({ ageing: { requireAgeing: true } });
    expect((res.settings.ageing as { requireAgeingSince: string }).requireAgeingSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const dispatch = await p.owner.dispatch.create({ customerId: p.customerId });
    await expect(p.owner.dispatch.addBundlesBySerial({ id: dispatch.id, serials: [serial!], allowUnassigned: true })).rejects.toThrow(
      `Bundle ${serial} is not aged; this plant dispatches aged metal only`,
    );
  });

  test("requireForPack: a section with released pieces on a trolley packs from the trolley row", async () => {
    const p = await agPlant({ ageing: { requireForPack: true } });
    const l = await loggedLine(p);
    await p.owner.bundle.createReceipt({ dieId: l.sectionId, unit: "pcs", locationId: p.yard, rows: [packRow(5, 14_000)] });
    const { batchId } = await cycled(p, { rows: [{ pressRunLineId: l.lineId, pcs: 10 }] });
    await passHardness(p, batchId);
    await p.as("supervisor").ageing.batches.release({ batchId });
    await expect(p.owner.bundle.createReceipt({ dieId: l.sectionId, unit: "pcs", locationId: p.yard, rows: [packRow(5, 14_000)] })).rejects.toThrow(
      "This plant packs aged metal from a trolley; pick the trolley line",
    );
  });
});

describe("readings feed (FP-AG-06, 17) and replays", () => {
  test("collector readings are signed, per device, replay-safe, 2 min of clock slack; the simulator is off unless set", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const b = await p.as("press").ageing.batches.load({ trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 5 }] });
    const inAt = Date.now() - 60 * MIN;
    await p.as("press").ageing.batches.start({ batchId: b.id, ovenId: p.ovenId, recipeId: p.recipeId, shiftId: "ag-day", gasStartMilli: 1, inAt });
    const secret = "oven-secret";
    const instanceId = crypto.randomUUID();
    await env.db.insert(spoolDeployment).values({
      id: crypto.randomUUID(),
      companyId: p.companyId,
      instanceId,
      status: "active",
      subdomain: `ov-${instanceId.slice(0, 8)}`,
      nodeDomain: `ov-${instanceId.slice(0, 8)}.spool.orrn.in`,
      cfTunnelTokenWrapped: await wrapSecret("tunnel", DEV_MASTER_KEY),
      sharedSecretHash: "hash",
      sharedSecretWrapped: await wrapSecret(secret, DEV_MASTER_KEY),
    });
    const { handleAgeingReadingsRequest, AGEING_READINGS_PATH } = await import("../src/lib/ageingCollector");
    const { signSpoolRequest } = await import("../src/lib/spool-crypto");
    const post = async (body: Record<string, unknown>) => {
      const rawBody = new TextEncoder().encode(JSON.stringify({ instance_id: instanceId, batch_id: b.id, ...body }));
      const nowMs = Date.now();
      const token = await signSpoolRequest("POST", AGEING_READINGS_PATH, rawBody, secret, nowMs);
      return handleAgeingReadingsRequest(env.db as never, { rawBody, authorization: `Bearer ${token}`, masterKey: DEV_MASTER_KEY, nowMs });
    };
    const at = Date.now() - 20 * MIN;
    const readings = [{ at, temp_c_x10: 1850 }, { at: Date.now() + 60_000, temp_c_x10: 1851 }];
    expect(await post({ device_id: "probe-1", readings })).toMatchObject({ status: 200, body: { inserted: 2, refused: [] } });
    expect(await post({ device_id: "probe-1", readings })).toMatchObject({ status: 200, body: { inserted: 0 } });
    expect(await post({ device_id: "probe-2", readings: [{ at, temp_c_x10: 1849 }, { at: Date.now() + 5 * MIN, temp_c_x10: 1849 }] })).toMatchObject({
      status: 200,
      body: { inserted: 1, refused: [{ code: "time_future" }] },
    });
    expect((await post({ batch_id: "nope", readings })).status).toBe(400);
    const d = await p.owner.ageing.batches.get({ id: b.id });
    expect(d.readings.map((r) => r.source)).toEqual(["telemetry", "telemetry", "telemetry"]);
    expect(d.soakStartedAt).toBe(at);

    await expect(p.as("press").ageing.batches.simulate({ batchId: b.id })).rejects.toThrow("The oven simulator is off on this server");
    (workersEnv as Record<string, unknown>).OVEN_SIMULATOR = "1";
    const sim = await p.as("press").ageing.batches.simulate({ batchId: b.id });
    expect(sim.inserted).toBeGreaterThan(0);
    expect((await p.as("press").ageing.batches.simulate({ batchId: b.id })).inserted).toBe(0);
    // Review m3: one audit row per feed call (3 POSTs that reached the batch, 2 simulator runs) and per typed reading.
    await p.as("press").ageing.batches.temp({ batchId: b.id, tempCX10: 1850, at: inAt + 30 * MIN });
    expect((await auditActions(p, [b.id])).filter((a): a is string => a === "ageing.readings" || a === "ageing.temp")).toEqual<string[]>([
      ...Array<string>(5).fill("ageing.readings"),
      "ageing.temp",
    ]);
    // Review m9: the ageing module off for the node's company refuses the feed.
    await env.db.update(company).set({ modules: ["press"] }).where(eq(company.id, p.companyId));
    expect(await post({ device_id: "probe-3", readings: [{ at, temp_c_x10: 1850 }] })).toMatchObject({ status: 403 });
    await env.db.update(company).set({ modules: [] }).where(eq(company.id, p.companyId));
  });

  test("clientMutationId: a load, a reading and a release sent twice land once", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const press = p.as("press");
    const one = await press.ageing.batches.load({ trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 10 }], clientMutationId: "load-1" });
    const two = await press.ageing.batches.load({ trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 10 }], clientMutationId: "load-1" });
    expect(two).toMatchObject({ id: one.id, replayed: true, totals: { loadedPcs: 10 } });
    await expect(press.ageing.batches.load({ trolleyId: p.t1, rows: [{ pressRunLineId: l.lineId, pcs: 11 }], clientMutationId: "load-1" })).rejects.toThrow(
      "This request id was already used for a different request.",
    );
    await press.ageing.batches.start({ batchId: one.id, ovenId: p.ovenId, recipeId: p.recipeId, shiftId: "ag-day", gasStartMilli: 1, inAt: Date.now() - 60 * MIN, clientMutationId: "start-1" });
    const r1 = await press.ageing.batches.temp({ batchId: one.id, tempCX10: 1850, clientMutationId: "temp-1" });
    const r2 = await press.ageing.batches.temp({ batchId: one.id, tempCX10: 1850, clientMutationId: "temp-1" });
    expect(r2).toMatchObject({ id: r1.id, replayed: true });
    await press.ageing.batches.out({ batchId: one.id, gasEndMilli: 2, clientMutationId: "out-1" });
    expect(await press.ageing.batches.out({ batchId: one.id, gasEndMilli: 2, clientMutationId: "out-1" })).toMatchObject({ replayed: true, status: "out" });
    const sup = p.as("supervisor");
    await sup.ageing.batches.release({ batchId: one.id, clientMutationId: "rel-1" });
    expect(await sup.ageing.batches.release({ batchId: one.id, clientMutationId: "rel-1" })).toMatchObject({ replayed: true });
  });
});

describe("reads around the plant", () => {
  test("reports.ageing (from ≤ to, csv), Today's ageing figures, the reopen blocker, another company's batch", async () => {
    const p = await agPlant();
    const l = await loggedLine(p);
    const { batchId } = await cycled(p, { rows: [{ pressRunLineId: l.lineId, pcs: 10 }] });
    const day = (await p.owner.ageing.batches.get({ id: batchId })).productionDay!;
    const today = plantDay();
    const from = day < today ? day : today;
    const rep = await p.as("office").reports.ageing({ from: "2026-01-01", to: "2099-12-31" });
    expect(rep.rows).toEqual([expect.objectContaining({ loadedPcs: 10, remainingPcs: 10, source: "press", pressRunNumber: expect.any(String) })]);
    const csv = await p.as("office").reports.ageing({ from, to: "2099-12-31", format: "csv" });
    expect(csv.csv!.split("\r\n")[0]).toContain("Batch,Oven,Trolley");
    await expect(p.as("office").reports.ageing({ from: "2026-02-01", to: "2026-01-01" })).rejects.toThrow();
    expect((await p.as("supervisor").dashboard.today()).ageing).toEqual({ inOven: 0, held: 0, out: 1 });
    expect((await p.as("viewer").dashboard.today()).ageing).toBeNull();
    await expect(p.as("supervisor").press.runs.reopen({ id: l.runId, reason: "typo" })).rejects.toThrow(/void that batch first$/);
    const other = await agPlant();
    await expect(other.owner.ageing.batches.get({ id: batchId })).rejects.toThrow("Ageing batch not found");
    const approvals = await env.db.select().from(approval).where(eq(approval.companyId, p.companyId));
    expect(approvals.filter((a) => a.kind === "ageing_override")).toHaveLength(0);
  });
});

describe("permission matrix", () => {
  const cases: { name: string; action: Action | Action[]; call: (p: AgPlant, role: CompanyRole) => Promise<unknown> }[] = [
    { name: "batches.list", action: "ageing.view", call: (p, r) => p.as(r).ageing.batches.list({}) },
    { name: "batches.load", action: "ageing.load", call: (p, r) => p.as(r).ageing.batches.load({ trolleyId: "nope", manual: [{ dieId: p.dieA, lengthMm: 1, pcs: 1, kgG: 1 }] }) },
    { name: "batches.start", action: "ageing.load", call: (p, r) => p.as(r).ageing.batches.start({ batchId: "nope", ovenId: "x", recipeId: "x", shiftId: "x", gasStartMilli: 1 }) },
    { name: "batches.out", action: "ageing.load", call: (p, r) => p.as(r).ageing.batches.out({ batchId: "nope", gasEndMilli: 1 }) },
    { name: "batches.temp", action: "ageing.record", call: (p, r) => p.as(r).ageing.batches.temp({ batchId: "nope", tempCX10: 1850 }) },
    { name: "batches.hardness", action: "ageing.record", call: (p, r) => p.as(r).ageing.batches.hardness({ rowId: "nope", method: "webster", readingsX10: [100] }) },
    { name: "batches.release", action: "ageing.release", call: (p, r) => p.as(r).ageing.batches.release({ batchId: "nope" }) },
    { name: "batches.hold", action: "ageing.release", call: (p, r) => p.as(r).ageing.batches.hold({ batchId: "nope", reasonCodeId: "x" }) },
    { name: "batches.unhold", action: "ageing.release", call: (p, r) => p.as(r).ageing.batches.unhold({ rowId: "nope" }) },
    { name: "batches.rework", action: "ageing.release", call: (p, r) => p.as(r).ageing.batches.rework({ batchId: "nope" }) },
    { name: "packSource", action: ["bundle.pack", "ageing.view"], call: (p, r) => p.as(r).ageing.packSource({}) },
    { name: "forOrder", action: ["order.manage", "ageing.view", "reports.read"], call: (p, r) => p.as(r).ageing.forOrder({ salesOrderId: "nope" }) },
    { name: "ovens.list", action: ["ageing.view", "masters.draft"], call: (p, r) => p.as(r).ageing.ovens.list() },
    { name: "reports.ageing", action: "reports.read", call: (p, r) => p.as(r).reports.ageing({ from: "2026-01-01", to: "2026-01-02" }) },
  ];

  test("every procedure answers FORBIDDEN exactly to the roles the matrix leaves out", async () => {
    const p = await agPlant();
    for (const c of cases) {
      for (const role of ROLES) {
        const actions = Array.isArray(c.action) ? c.action : [c.action];
        const allowed = actions.some((a) => can({ company: { role }, isPlatformAdmin: false, platformRole: null } as never, a));
        let forbidden = false;
        try {
          await c.call(p, role);
        } catch (e) {
          forbidden = (e as { code?: string }).code === "FORBIDDEN" && (e as Error).message === "You don't have permission to do that";
        }
        expect({ proc: c.name, role, forbidden }).toEqual({ proc: c.name, role, forbidden: !allowed });
      }
    }
  });
});

void sql;
