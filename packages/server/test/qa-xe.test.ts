/**
 * XE parity lane QA: the quality hold and the dispatch scan's refusal (row 29), the first-piece gate on
 * pack (24), in-process checks and plan flags on a run (39, 28), incoming inspection and the melt gate
 * (22), clearance by stage (23), dimensions (25), mechanical against the temper master (26, 35),
 * ultrasonic (27), inspection points (36), alloy substitutes on an order line (37), instruments with
 * calibration and the certificate purge rule (38). Every procedure: another plant gets "Not found",
 * the permission refusal, the module gate, the happy path.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";

import { auditLog, bundle, company, location, pressRunCollector, qaCheck, qaHold, qaInstrument, qaPlan, stockLedger } from "@orrn/db/schema";

import { readUploadTicket, ticketKey } from "../src/lib/dieFiles";
import { purgeOrphanDieFiles } from "../src/lib/dieFilesPurge";
import * as qaLib from "../src/lib/qa";
import { workersEnv } from "./env-mock";
import { can as canMe, type Action } from "../src/lib/permissions";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";
import { kg, pressHelpers, type PressPlant } from "./press-w2-fixture";
import { NOON, salesHelpers } from "./sales-fixture";

setDefaultTimeout(60_000);

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

const { plant } = salesHelpers(() => env);
const { pressPlant } = pressHelpers(() => env);
const ROLES: CompanyRole[] = ["owner", "admin", "manager", "office", "accountant", "supervisor", "packer", "foundry", "press", "storekeeper", "die_room", "operator", "viewer"];
const can = (role: CompanyRole, action: Action) => canMe({ company: { role }, isPlatformAdmin: false, platformRole: null }, action);
const MODULE_OFF = "That module is not on for this plant";

async function auditActions(companyId: string) {
  return (await env.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.companyId, companyId))).map((r) => r.action);
}

describe("permissions", () => {
  test("the matrix: check, hold, release, masters", () => {
    const holders = (a: Action) => ROLES.filter((r) => can(r, a));
    expect(holders("qa.check")).toEqual(["owner", "manager", "supervisor", "foundry", "press", "storekeeper"]);
    expect(holders("qa.hold")).toEqual(["owner", "manager", "supervisor"]);
    expect(holders("qa.release")).toEqual(["owner", "manager", "supervisor"]);
    expect(holders("qa.masters")).toEqual(["owner", "admin", "manager"]);
    // qc.enter stays the press station's reject entry.
    expect(holders("qc.enter")).toEqual(["owner", "supervisor", "press"]);
  });
});

describe("row 29: quality hold and the dispatch scan", () => {
  test("hold, scan refused by name, log, release with a note, scan adds", async () => {
    setClock(NOON);
    const p = await plant();
    const [s1, s2] = await p.pack(p.dieA, [{ kg: 10 }, { kg: 10 }]);
    const b1 = (await env.db.query.bundle.findFirst({ where: (b, o) => o.and(o.eq(b.companyId, p.companyId), o.eq(b.serial, s1!)) }))!;
    const sup = p.as("supervisor");

    const held = await sup.qa.holds.hold({ serial: s1!, reason: "Surface marks on two pieces" });
    expect(held.serial).toBe(s1!);
    await expect(sup.qa.holds.hold({ bundleId: b1.id, reason: "again" })).rejects.toMatchObject({ code: "CONFLICT", message: `Bundle ${s1} is already on quality hold` });
    expect(await p.owner.qa.holds.forBundle({ bundleId: b1.id })).toMatchObject({ reason: "Surface marks on two pieces" });

    // Plant stock may be scanned by the floor; the held one is refused with the quality words.
    await env.plantStock(p.companyId, [b1.id]);
    const { id } = await p.owner.dispatch.create({ vehicleNo: "GJ05AB1234", customerId: p.customerId });
    await expect(p.as("packer").dispatch.scan({ id, serials: [s1!] })).rejects.toMatchObject({ code: "BAD_REQUEST", message: `Bundle ${s1} is on quality hold` });
    // The office's add by serial goes through the same path.
    await expect(p.owner.dispatch.addBundlesBySerial({ id, serials: [s1!] })).rejects.toMatchObject({ message: `Bundle ${s1} is on quality hold` });

    const open = await p.as("viewer").qa.holds.list();
    expect(open.items.map((h) => h.serial)).toEqual([s1!]);
    expect(open.items[0]).toMatchObject({ reason: "Surface marks on two pieces", releasedAt: null });

    // Release needs qa.release and a note.
    await expect(p.as("packer").qa.holds.release({ bundleId: b1.id, note: "ok" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(sup.qa.holds.release({ bundleId: b1.id, note: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.as("manager").qa.holds.release({ bundleId: b1.id, note: "Marks polished out, rechecked" });
    await expect(sup.qa.holds.release({ bundleId: b1.id, note: "twice" })).rejects.toMatchObject({ code: "CONFLICT", message: `Bundle ${s1} is not on quality hold` });
    expect((await p.owner.qa.holds.list()).items).toEqual([]);
    const log = await p.owner.qa.holds.list({ open: false, limit: 50 });
    expect(log.items[0]).toMatchObject({ serial: s1, releaseNote: "Marks polished out, rechecked" });
    expect(log.items[0]!.releasedBy).toContain("manager");

    const report = await p.as("packer").dispatch.scan({ id, serials: [s1!] });
    expect(report.added).toEqual([s1!]);
    expect(s2).toBeDefined();
    expect(await auditActions(p.companyId)).toEqual(expect.arrayContaining(["qa.hold", "qa.release"]));
  });

  test("only a bundle in stock: on a held load, dispatched or void is refused", async () => {
    setClock(NOON);
    const p = await plant();
    const [onLoad, voided] = await p.pack(p.dieA, [{ kg: 10 }, { kg: 10 }]);
    await p.held([onLoad!]);
    await expect(p.as("supervisor").qa.holds.hold({ serial: onLoad!, reason: "x" })).rejects.toMatchObject({ message: `Bundle ${onLoad} is held on a load; take it off the load first` });
    const v = (await env.db.query.bundle.findFirst({ where: (b, o) => o.and(o.eq(b.companyId, p.companyId), o.eq(b.serial, voided!)) }))!;
    await p.owner.bundle.transitionStatus({ id: v.id, toStatus: "void", reason: "damaged" });
    await expect(p.as("supervisor").qa.holds.hold({ bundleId: v.id, reason: "x" })).rejects.toMatchObject({ message: `Bundle ${voided} is not in stock; only stock can go on quality hold` });
  });

  test("tenancy, permission and the module gate", async () => {
    setClock(NOON);
    const p = await plant();
    const other = await plant();
    const [s1] = await p.pack(p.dieA, [{ kg: 10 }]);
    const b1 = (await env.db.query.bundle.findFirst({ where: (b, o) => o.and(o.eq(b.companyId, p.companyId), o.eq(b.serial, s1!)) }))!;
    await expect(other.as("supervisor").qa.holds.hold({ bundleId: b1.id, reason: "x" })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Not found" });
    await expect(other.as("supervisor").qa.holds.release({ bundleId: b1.id, note: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await other.owner.qa.holds.forBundle({ bundleId: b1.id })).toBeNull();
    for (const role of ROLES.filter((r) => !can(r, "qa.hold"))) {
      await expect(p.as(role).qa.holds.hold({ bundleId: b1.id, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await p.as("supervisor").qa.holds.hold({ bundleId: b1.id, reason: "x" });

    // Module off: no new hold, and the scan no longer reads holds (a plant without quality sees no change).
    await env.db.update(company).set({ modules: ["dies", "bundles", "dispatches", "customers", "orders"] }).where(eq(company.id, p.companyId));
    const [s2] = await p.pack(p.dieA, [{ kg: 10 }]);
    await expect(p.as("supervisor").qa.holds.hold({ serial: s2!, reason: "x" })).rejects.toMatchObject({ message: MODULE_OFF });
    await env.plantStock(p.companyId, [b1.id]);
    const { id } = await p.owner.dispatch.create({ vehicleNo: "GJ05AB1234", customerId: p.customerId });
    expect((await p.as("packer").dispatch.scan({ id, serials: [s1!] })).added).toEqual([s1!]);
  });
});

describe("rows 24, 28, 39: first piece, plan flags, in-process checks", () => {
  async function runningRun(pp: PressPlant) {
    const r = await pp.queuedRun();
    await pp.issue(r.runId, r.copyId);
    await pp.as("press").press.runs.start({ id: r.runId });
    return r;
  }
  async function yardOf(pp: PressPlant) {
    const [y] = await env.db.select({ id: location.id }).from(location).where(and(eq(location.companyId, pp.companyId), eq(location.code, "Y1")));
    return y!.id;
  }
  const packOn = (pp: PressPlant, sectionId: string, copyId: string, yard: string) =>
    pp.owner.bundle.createReceipt({ dieId: sectionId, dieInstanceId: copyId, unit: "pcs", locationId: yard, rows: [{ quantity: 10, weightG: kg(12), lengthMm: 3_658, poNumber: null }] });

  test("pack waits for the first piece when the setting is on; a pass opens it; a fail keeps it shut", async () => {
    const pp = await pressPlant();
    const yard = await yardOf(pp);
    const r = await runningRun(pp);
    // Setting off (default): pack goes ahead.
    await packOn(pp, r.sectionId, r.copyId, yard);

    await expect(pp.as("supervisor").qa.settings.update({ firstPieceBlocksPack: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const s = await pp.as("manager").qa.settings.update({ firstPieceBlocksPack: true });
    expect(s.firstPieceBlocksPack).toBe(true);
    expect(s.firstPieceSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const runRow = await pp.owner.qa.run({ runId: r.runId });
    await expect(packOn(pp, r.sectionId, r.copyId, yard)).rejects.toMatchObject({ code: "BAD_REQUEST", message: `The first piece of ${runRow.run.number} is not checked yet` });
    expect(runRow).toMatchObject({ firstPieceState: "waiting", firstPieceBlocksPack: true });

    await pp.as("press").qa.checks.record({ kind: "first_piece", subjectType: "press_run", subjectId: r.runId, result: "fail", readings: [{ name: "Wall", value: "1.10" }] });
    await expect(packOn(pp, r.sectionId, r.copyId, yard)).rejects.toMatchObject({ message: `The first piece of ${runRow.run.number} failed; check a new piece first` });
    await pp.as("press").qa.checks.record({ kind: "first_piece", subjectType: "press_run", subjectId: r.runId, result: "pass" });
    await packOn(pp, r.sectionId, r.copyId, yard);
    expect((await pp.owner.qa.run({ runId: r.runId })).firstPieceState).toBe("passed");

    // The register lists the first pieces newest first.
    const reg = await pp.as("viewer").qa.checks.list({ kind: "first_piece", limit: 50 });
    expect(reg.items.map((c) => c.result)).toEqual(["pass", "fail"]);
    expect(reg.items[1]!.values).toEqual({ readings: [{ name: "Wall", value: "1.10" }] });
  });

  test("in-process checks are due every N bundles; the plan flags readings out of limits", async () => {
    const pp = await pressPlant();
    const yard = await yardOf(pp);
    const r = await runningRun(pp);
    await pp.as("manager").qa.settings.update({ inProcessEveryBundles: 2 });
    await pp.as("press").qa.checks.record({ kind: "first_piece", subjectType: "press_run", subjectId: r.runId, result: "pass" });
    await packOn(pp, r.sectionId, r.copyId, yard);
    expect((await pp.owner.qa.run({ runId: r.runId })).inProcessDue).toMatchObject({ due: false, bundlesSince: 1 });
    await packOn(pp, r.sectionId, r.copyId, yard);
    expect((await pp.owner.qa.run({ runId: r.runId })).inProcessDue).toMatchObject({ due: true, reason: "bundles", bundlesSince: 2 });
    await pp.as("supervisor").qa.checks.record({ kind: "in_process", subjectType: "press_run", subjectId: r.runId, result: "pass" });
    const after = await pp.owner.qa.run({ runId: r.runId });
    expect(after.inProcess).toHaveLength(1);
    expect(after.inProcessDue).toMatchObject({ due: false, bundlesSince: 0 });

    // Row 28: a plan on the section; the collector's readings break two limits.
    await pp.as("manager").qa.plans.save({ dieId: r.sectionId, billetTempMinX10: 4600, billetTempMaxX10: 5000, exitTempMaxX10: 5400, everyBundles: 5 });
    await env.db.insert(pressRunCollector).values({ pressRunId: r.runId, companyId: pp.companyId, pressLineId: pp.pressLineId, billetTempAvgX10: 4500, exitTempMaxX10: 5500, ramSpeedAvgX10: 80, ramSpeedMaxX10: 90, evaluatedAt: new Date() });
    const flagged = await pp.owner.qa.run({ runId: r.runId });
    expect(flagged.breaches.map((b) => `${b.metric}:${b.direction}`)).toEqual(["billet_temp:low", "exit_temp:high"]);
    // The plan's own frequency wins over the plant's.
    expect(flagged.inProcessDue.everyBundles).toBe(5);
    await expect(pp.as("manager").qa.plans.save({ dieId: r.sectionId, exitTempMinX10: 6000, exitTempMaxX10: 5000 })).rejects.toMatchObject({ message: "A lower limit is above its upper limit" });
  });

  test("tenancy and permission on checks and the run view", async () => {
    const pp = await pressPlant();
    const other = await pressPlant();
    const r = await pp.queuedRun();
    await expect(other.as("press").qa.checks.record({ kind: "first_piece", subjectType: "press_run", subjectId: r.runId, result: "pass" })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Not found" });
    await expect(other.owner.qa.run({ runId: r.runId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const role of ROLES.filter((x) => !can(x, "qa.check"))) {
      await expect(pp.as(role).qa.checks.record({ kind: "first_piece", subjectType: "press_run", subjectId: r.runId, result: "pass" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(pp.as("press").qa.checks.record({ kind: "first_piece", subjectType: "bundle", subjectId: r.runId, result: "pass" })).rejects.toMatchObject({ message: "This check cannot be recorded on that" });
    await expect(pp.as("press").qa.checks.record({ kind: "first_piece", subjectType: "press_run", subjectId: r.runId })).rejects.toMatchObject({ message: "Pick pass or fail" });
    expect((await other.owner.qa.checks.list({ limit: 50 })).items).toEqual([]);
  });
});

describe("rows 25, 26, 27, 35: dimensions, mechanical, ultrasonic, temper", () => {
  test("dimensions are judged by the server and flagged; mechanical reads the temper master", async () => {
    const pp = await pressPlant();
    const r = await pp.queuedRun();
    const press = pp.as("press");
    const dim = await press.qa.checks.record({
      kind: "dimension",
      subjectType: "press_run",
      subjectId: r.runId,
      // A result sent for dimensions is ignored: the server computes it.
      result: "pass",
      dimensions: [
        { name: "Wall", nominalUm: 1200, minusUm: 50, plusUm: 100, measuredUm: 1140 },
        { name: "Width", nominalUm: 40_000, minusUm: 200, plusUm: 200, measuredUm: 40_150 },
      ],
    });
    expect(dim).toMatchObject({ result: "fail", flags: { flagged: ["Wall"] } });
    const [row] = await env.db.select().from(qaCheck).where(eq(qaCheck.id, dim.id));
    expect(row).toMatchObject({ pressRunId: r.runId, dieId: r.sectionId, kind: "dimension" });
    await expect(press.qa.checks.record({ kind: "dimension", subjectType: "press_run", subjectId: r.runId, dimensions: [] })).rejects.toMatchObject({ message: "Enter at least one dimension" });

    // Temper master: T6 for 6063 with its minimums, linked to the ageing recipe by code.
    const mgr = pp.as("manager");
    await expect(press.qa.tempers.save({ code: "T6" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(mgr.qa.tempers.save({ code: "6T" })).rejects.toMatchObject({ message: "Use a temper code such as T6, T5 or O, at most 8 letters and digits" });
    await expect(mgr.qa.tempers.save({ code: "T6", tensileMinMpa: 200, yieldMinMpa: 250 })).rejects.toMatchObject({ message: "The yield minimum cannot be above the tensile minimum" });
    const t6 = await mgr.qa.tempers.save({ code: "t6", alloy: "6063", hardnessMinX10: 800, tensileMinMpa: 205, yieldMinMpa: 170, elongationMinX10: 80 });
    await expect(mgr.qa.tempers.save({ code: "T6", alloy: "6063" })).rejects.toMatchObject({ code: "CONFLICT", message: "Temper 6063 T6 is already in the list" });
    await mgr.ageing.recipes.save({ alloy: "6063", temper: "T6", targetTempX10: 1850, soakMin: 240, hardnessMinX10: 80, status: "active" });
    const list = await pp.as("viewer").qa.tempers.list();
    expect(list.items[0]).toMatchObject({ code: "T6", alloy: "6063", tensileMinMpa: 205 });
    expect(list.items[0]!.recipes.map((x) => x.temper)).toEqual(["T6"]);

    const low = await press.qa.checks.record({ kind: "mechanical", subjectType: "press_run", subjectId: r.runId, temperId: t6.id, mechanical: { tensileMpa: 200, yieldMpa: 180, elongationX10: 95, hardnessX10: 820 } });
    expect(low).toMatchObject({ result: "fail", flags: { low: ["tensile"], missing: [] } });
    // With the plan's temper on the section, the check needs no temper picked.
    await mgr.qa.plans.save({ dieId: r.sectionId, temperId: t6.id });
    const ok = await press.qa.checks.record({ kind: "mechanical", subjectType: "press_run", subjectId: r.runId, mechanical: { tensileMpa: 215, yieldMpa: 180, elongationX10: 95, hardnessX10: 820 } });
    expect(ok.result).toBe("pass");
    await expect(press.qa.checks.record({ kind: "mechanical", subjectType: "press_run", subjectId: r.runId, mechanical: {} })).rejects.toMatchObject({ message: "Enter at least one test value" });
    const other = await pressPlant();
    await expect(other.as("press").qa.checks.record({ kind: "mechanical", subjectType: "press_run", subjectId: (await other.queuedRun()).runId, temperId: t6.id, mechanical: { tensileMpa: 1 } })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Ultrasonic on a cast, with operator and standard.
    const c = await pp.castWith(kg(100));
    const us = await pp.as("supervisor").qa.checks.record({ kind: "ultrasonic", subjectType: "cast", subjectId: c.id, result: "pass", standard: "ASTM B594", operatorName: "Ramesh" });
    const usList = await pp.owner.qa.checks.list({ kind: "ultrasonic", limit: 50 });
    expect(usList.items).toEqual([expect.objectContaining({ id: us.id, subjectNumber: c.number, standard: "ASTM B594", operatorName: "Ramesh", result: "pass" })]);
  });
});

describe("rows 22, 23, 36: incoming inspection, clearance, inspection points", () => {
  async function foundryPlant(settings: Record<string, unknown>) {
    const p = await pressPlant({ settings });
    const manager = p.as("manager");
    await manager.purchase.seedScrapDefaults();
    await manager.foundry.returnStreams.seedDefaults();
    await manager.foundry.furnaces.seedDefaults();
    await manager.foundry.alloys.seedDefaults();
    const items = (await manager.purchase.scrapItems.list()).items;
    const v = await manager.vendor.create({ name: "Shree Ganesh Metals" });
    const store = p.as("storekeeper");
    async function lot(kgs: number) {
      const l = await store.purchase.lots.create({
        vendorId: v.id, date: "2026-10-01", origin: "LOCAL", itemId: items.find((i) => i.name === "IMP BELLING")!.id, grade: "A",
        partyKgG: kg(kgs), fcKgG: kg(kgs), ratePaise: 18_500, billBook: "main",
      });
      await store.purchase.lots.advance({ id: l.id, to: "ok" });
      return { id: l.id, number: l.number };
    }
    return { ...p, lot };
  }
  const H = 3_600_000;
  const draft = (castId: string, lotId: string) => {
    const t0 = Date.now() - 8 * H;
    return {
      castId,
      times: { preheatStart: t0, chargingStart: t0 + H, chargingEnd: t0 + 3 * H, castingStart: t0 + 4 * H, castingEnd: t0 + 6 * H },
      ldoTenthIn: { start: 480, end: 455 },
      inputs: [{ kind: "lot" as const, ref: lotId, kgG: kg(5_000) }],
      logs: [{ pcs: 20, lengthMm: 6_000, billetLengthMm: 600, kgG: kg(4_900) }],
      drossG: kg(80),
      feG: kg(20),
      spectroReason: "Lab",
    };
  };

  test("a lot waits for inspection; the melt lock refuses it until it passes", async () => {
    const p = await foundryPlant({ qa: { requireLotInspection: true, lotInspectionSince: "2026-09-01" } });
    const lot = await p.lot(8_000);
    const foundry = p.as("foundry");
    const c = await foundry.foundry.casts.open({ alloy: "6063" });
    const d = await foundry.foundry.melts.save(draft(c.id, lot.id));
    await expect(foundry.foundry.melts.lock({ meltId: d.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: `${lot.number} is waiting for inspection` });

    const waiting = await p.as("viewer").qa.waiting.list({ stage: "incoming" });
    expect(waiting.items).toEqual([expect.objectContaining({ subjectType: "purchase_lot", subjectId: lot.id, number: lot.number, state: "waiting", station: null })]);
    // The record sheet finds the lot by the number people say; another plant's number finds nothing.
    expect(await p.as("viewer").qa.findSubject({ subjectType: "purchase_lot", number: lot.number.toLowerCase() })).toEqual({ id: lot.id, number: lot.number });
    expect(await p.as("viewer").qa.findSubject({ subjectType: "purchase_lot", number: "LOT-99999" })).toBeNull();
    const other = await plant();
    expect(await other.owner.qa.findSubject({ subjectType: "purchase_lot", number: lot.number })).toBeNull();

    // Row 36: an inspection point for incoming lots; the lot is put there.
    const mgr = p.as("manager");
    const st = await mgr.qa.stations.save({ code: "mir-1", name: "Scrap yard bay 1", stage: "incoming" });
    await expect(mgr.qa.stations.save({ code: "MIR-1", name: "dup", stage: "incoming" })).rejects.toMatchObject({ code: "CONFLICT", message: "The code MIR-1 is already used" });
    await foundry.qa.waiting.place({ subjectType: "purchase_lot", subjectId: lot.id, stationId: st.id });
    expect((await p.owner.qa.waiting.list({ stage: "incoming", stationId: st.id })).items[0]!.station).toMatchObject({ code: "MIR-1" });

    await foundry.qa.checks.record({ kind: "incoming", subjectType: "purchase_lot", subjectId: lot.id, result: "fail", stationId: st.id, note: "Iron pieces in the load" });
    await expect(foundry.foundry.melts.lock({ meltId: d.id })).rejects.toMatchObject({ message: `${lot.number} failed inspection` });
    expect((await p.owner.qa.waiting.list({ stage: "incoming" })).items[0]!.state).toBe("failed");
    await foundry.qa.checks.record({ kind: "incoming", subjectType: "purchase_lot", subjectId: lot.id, result: "pass", note: "Sorted and rechecked" });
    await foundry.foundry.melts.lock({ meltId: d.id });
    expect((await p.owner.qa.waiting.list({ stage: "incoming" })).items).toEqual([]);
    const register = await p.owner.qa.checks.list({ kind: "incoming", limit: 50 });
    expect(register.items.map((x) => [x.subjectNumber, x.result])).toEqual([
      [lot.number, "pass"],
      [lot.number, "fail"],
    ]);
    expect(register.items[1]!.station).toBe("MIR-1");
  });

  test("review N4: a fail recorded between the lock's read and its write stops the lock", async () => {
    const p = await foundryPlant({ qa: { requireLotInspection: true, lotInspectionSince: "2026-09-01" } });
    const lot = await p.lot(8_000);
    const foundry = p.as("foundry");
    await foundry.qa.checks.record({ kind: "incoming", subjectType: "purchase_lot", subjectId: lot.id, result: "pass" });
    const c = await foundry.foundry.casts.open({ alloy: "6063" });
    const d = await foundry.foundry.melts.save(draft(c.id, lot.id));
    const real = qaLib.assertLotsInspected;
    const spy = spyOn(qaLib, "assertLotsInspected").mockImplementationOnce(async (...args) => {
      await real(...args);
      // Someone fails the lot right after the lock read it as passed.
      await env.db.insert(qaCheck).values({ id: crypto.randomUUID(), companyId: p.companyId, kind: "incoming", subjectType: "purchase_lot", subjectId: lot.id, lotId: lot.id, subjectNumber: lot.number, result: "fail", checkedAt: new Date(Date.now() + 1_000) });
    });
    try {
      await expect(foundry.foundry.melts.lock({ meltId: d.id })).rejects.toMatchObject({ message: `${lot.number} failed inspection` });
    } finally {
      spy.mockRestore();
    }
  });

  test("off for a plant that existed before (no qa key), and lots received before the switch day are exempt", async () => {
    const before = await foundryPlant({});
    const lot = await before.lot(8_000);
    const c = await before.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await before.as("foundry").foundry.melts.save(draft(c.id, lot.id));
    await before.as("foundry").foundry.melts.lock({ meltId: d.id });

    const late = await foundryPlant({ qa: { requireLotInspection: true, lotInspectionSince: "2026-10-02" } });
    const old = await late.lot(8_000);
    const c2 = await late.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d2 = await late.as("foundry").foundry.melts.save(draft(c2.id, old.id));
    await late.as("foundry").foundry.melts.lock({ meltId: d2.id });
  });

  test("a new plant from the waiting list starts with lot inspection on", async () => {
    const out = await env.caller(null).waitlist.submit({ companyName: "New Extrusions", requesterName: "Asha", requesterEmail: `asha.${Date.now()}@example.test` });
    expect(out.success).toBe(true);
    const rows = await env.db.select({ settings: company.settings }).from(company).where(eq(company.name, "New Extrusions"));
    expect((rows[0]!.settings as { qa?: { requireLotInspection?: boolean } }).qa?.requireLotInspection).toBe(true);
  });

  test("row 23: clearance by stage lists in the register by stage; logged runs wait at pack", async () => {
    const pp = await pressPlant();
    const r = await pp.queuedRun();
    const sup = pp.as("supervisor");
    await sup.qa.checks.record({ kind: "clearance", subjectType: "press_run", subjectId: r.runId, result: "pass", stage: "pack" });
    const c = await pp.castWith(kg(100));
    await sup.qa.checks.record({ kind: "clearance", subjectType: "cast", subjectId: c.id, result: "pass", stage: "press" });
    expect((await pp.owner.qa.checks.list({ kind: "clearance", stage: "pack", limit: 50 })).items.map((x) => x.subjectId)).toEqual([r.runId]);
    expect((await pp.owner.qa.checks.list({ kind: "clearance", stage: "press", limit: 50 })).items.map((x) => x.subjectId)).toEqual([c.id]);
    await expect(sup.qa.checks.record({ kind: "clearance", subjectType: "bundle", subjectId: r.runId, result: "pass" })).rejects.toMatchObject({ message: "This check cannot be recorded on that" });
  });
});

describe("row 37: alloy substitutes on the order line", () => {
  test("short when billets of the line's alloy are fewer than the kg left; the customer's own list wins", async () => {
    setClock(NOON);
    const p = await plant();
    const mgr = p.as("manager");
    await env.db.update((await import("@orrn/db/schema")).die).set({ alloy: "6063" }).where(eq((await import("@orrn/db/schema")).die.id, p.dieA));
    const ord = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    await expect(mgr.qa.substitutes.save({ alloy: "6063", substitute: "6063" })).rejects.toMatchObject({ message: "An alloy cannot be its own substitute" });
    await mgr.qa.substitutes.save({ alloy: "6063", substitute: "6060" });
    await expect(mgr.qa.substitutes.save({ alloy: "6063", substitute: "6060" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p.as("office").qa.substitutes.save({ alloy: "6063", substitute: "6463" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // 200 kg of 6060 billets on hand, none of 6063.
    const castId = crypto.randomUUID();
    const { cast } = await import("@orrn/db/schema");
    await env.db.insert(cast).values({ id: castId, companyId: p.companyId, number: "K90", period: "2026-10", year: 2026, month: 10, seq: 90, alloy: "6060", openedAt: new Date() });
    await env.db.insert(stockLedger).values({ id: crypto.randomUUID(), companyId: p.companyId, voucherType: "melt", voucherId: crypto.randomUUID(), line: 1, itemKind: "billet", itemRef: castId, locationId: p.yard, qtyG: kg(200), postedAt: new Date() });

    const line = await p.as("packer").qa.substitutes.forLine({ lineId: ord.lineIds[0]! });
    expect(line).toMatchObject({ alloy: "6063", needG: kg(1000), onHandG: 0, short: true, substitutes: [{ alloy: "6060", onHandG: kg(200), note: null }] });

    await mgr.qa.substitutes.save({ alloy: "6063", substitute: "6463", customerId: p.customerId });
    expect((await p.owner.qa.substitutes.forLine({ lineId: ord.lineIds[0]! })).substitutes.map((s) => s.alloy)).toEqual(["6463"]);
    const other = await plant();
    await expect(other.owner.qa.substitutes.forLine({ lineId: ord.lineIds[0]! })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.as("manager").qa.substitutes.save({ alloy: "6063", substitute: "6463", customerId: p.customerId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const subs = (await mgr.qa.substitutes.list()).items;
    await mgr.qa.substitutes.remove({ id: subs[0]!.id });
    await expect(other.as("manager").qa.substitutes.remove({ id: subs[1]!.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("row 38: instruments and calibration", () => {
  test("register, calibrate, overdue on Today, tenancy and permission", async () => {
    setClock(new Date("2026-11-22T06:30:00.000Z"));
    const p = await plant();
    const mgr = p.as("manager");
    await expect(p.as("supervisor").qa.instruments.save({ code: "VC-01", name: "Vernier" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(mgr.qa.instruments.save({ code: "VC 01", name: "Vernier" })).rejects.toMatchObject({ message: "Use letters, digits and dashes for the instrument code, at most 24" });
    const vc = await mgr.qa.instruments.save({ code: "vc-01", name: "Vernier caliper 150 mm", rangeText: "0-150 mm", intervalDays: 180 });
    await expect(mgr.qa.instruments.save({ code: "VC-01", name: "Again" })).rejects.toMatchObject({ code: "CONFLICT", message: "Instrument VC-01 is already in the list" });
    const hw = await mgr.qa.instruments.save({ code: "HW-02", name: "Webster hardness tester", intervalDays: 365 });

    await expect(p.as("supervisor").qa.instruments.calibrate({ id: vc.id, calibratedOn: "2026-11-23" })).rejects.toMatchObject({ message: "The calibration date cannot be in the future" });
    expect(await p.as("supervisor").qa.instruments.calibrate({ id: vc.id, calibratedOn: "2026-05-01" })).toEqual({ lastCalibratedOn: "2026-05-01", nextDueOn: "2026-10-28" });
    await p.as("supervisor").qa.instruments.calibrate({ id: hw.id, calibratedOn: "2026-11-20" });
    const list = await p.as("viewer").qa.instruments.list();
    expect(list.items.map((i) => [i.code, i.state])).toEqual([
      ["HW-02", "ok"],
      ["VC-01", "overdue"],
    ]);
    const today = await p.as("viewer").qa.today();
    expect(today.overdue.map((o) => o.code)).toEqual(["VC-01"]);

    const other = await plant();
    await expect(other.as("supervisor").qa.instruments.calibrate({ id: vc.id, calibratedOn: "2026-11-01" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.as("manager").qa.instruments.save({ id: vc.id, code: "VC-01", name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.owner.qa.instruments.certificateUrl({ id: vc.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await other.owner.qa.today()).overdue).toEqual([]);
    expect(await auditActions(p.companyId)).toEqual(expect.arrayContaining(["qa.instrument.save", "qa.instrument.calibrate"]));
  });

  test("a certificate key in the die-files bucket is kept by the orphan purge", async () => {
    const p = await plant();
    const id = (await p.as("manager").qa.instruments.save({ code: "GA-1", name: "Gauge" })).id;
    const key = `${p.companyId}/dies/qa-${id}/${crypto.randomUUID()}`;
    const orphan = `${p.companyId}/dies/qa-${id}/${crypto.randomUUID()}`;
    await env.db.update(qaInstrument).set({ certificateKey: key, certificateName: "cert.pdf" }).where(eq(qaInstrument.id, id));
    const deleted: string[] = [];
    const old = new Date(Date.now() - 3 * 86_400_000);
    const bucket = {
      list: async () => ({ objects: [{ key, uploaded: old }, { key: orphan, uploaded: old }], truncated: false }),
      delete: async (keys: string | string[]) => {
        deleted.push(...(Array.isArray(keys) ? keys : [keys]));
      },
    };
    const out = await purgeOrphanDieFiles(env.db, { bucket });
    expect(out.deleted).toBe(1);
    expect(deleted).toEqual([orphan]);
  });
});

describe("settings and the module gate", () => {
  test("turning a gate on stamps today, off clears it; module off refuses every quality write", async () => {
    setClock(new Date("2026-11-22T06:30:00.000Z"));
    const p = await plant();
    const s = await p.as("admin").qa.settings.update({ requireLotInspection: true, inProcessEveryMinutes: 60 });
    expect(s).toMatchObject({ requireLotInspection: true, lotInspectionSince: "2026-11-22", inProcessEveryMinutes: 60 });
    expect(await p.as("viewer").qa.settings.get()).toMatchObject({ requireLotInspection: true, moduleOn: true });
    expect((await p.as("admin").qa.settings.update({ requireLotInspection: false })).lotInspectionSince).toBeNull();
    expect(await auditActions(p.companyId)).toContain("qa.settings.update");

    await env.db.update(company).set({ modules: ["dies"] }).where(eq(company.id, p.companyId));
    await expect(p.as("admin").qa.settings.update({ requireLotInspection: true })).rejects.toMatchObject({ message: MODULE_OFF });
    await expect(p.as("manager").qa.tempers.save({ code: "T5" })).rejects.toMatchObject({ message: MODULE_OFF });
    // Reads stay open, like every module.
    expect((await p.as("viewer").qa.settings.get()).moduleOn).toBe(false);
    expect(bundle).toBeDefined();
  });
});

describe("review fix round 1", () => {
  const bundleOf = async (companyId: string, serial: string) => (await env.db.query.bundle.findFirst({ where: (b, o) => o.and(o.eq(b.companyId, companyId), o.eq(b.serial, serial)) }))!;
  const statusOf = async (id: string) => (await env.db.query.bundle.findFirst({ where: (b, o) => o.eq(b.id, id) }))!.status;
  const holdNow = (companyId: string, bundleId: string) => env.db.insert(qaHold).values({ id: crypto.randomUUID(), companyId, bundleId, reason: "cracks" });

  test("B1: a bundle on a draft dispatch is refused a hold, like the sales hold", async () => {
    setClock(NOON);
    const p = await plant();
    const [s1] = await p.pack(p.dieA, [{ kg: 10 }]);
    const b1 = await bundleOf(p.companyId, s1!);
    await env.plantStock(p.companyId, [b1.id]);
    const { id } = await p.owner.dispatch.create({ vehicleNo: "GJ05AB1234", customerId: p.customerId });
    expect((await p.as("packer").dispatch.scan({ id, serials: [s1!] })).added).toEqual([s1!]);
    expect(await statusOf(b1.id)).toBe("available");
    await expect(p.as("supervisor").qa.holds.hold({ bundleId: b1.id, reason: "cracks" })).rejects.toMatchObject({ message: `Bundle ${s1} is held on a load; take it off the load first` });
  });

  test("B1: a hold that reaches a draft anyway stops reserve; one placed after reserve stops complete", async () => {
    setClock(NOON);
    const p = await plant();
    const [s1] = await p.pack(p.dieA, [{ kg: 10 }]);
    const b1 = await bundleOf(p.companyId, s1!);
    await env.plantStock(p.companyId, [b1.id]);
    const { id } = await p.owner.dispatch.create({ vehicleNo: "GJ05AB1234", customerId: p.customerId });
    await p.as("packer").dispatch.scan({ id, serials: [s1!] });
    await holdNow(p.companyId, b1.id);
    await expect(p.owner.dispatch.reserve({ id })).rejects.toMatchObject({ message: `Bundle ${s1} is on quality hold` });
    await expect(p.owner.dispatch.complete({ id })).rejects.toThrow();
    expect(await statusOf(b1.id)).toBe("available");

    await env.db.update(qaHold).set({ releasedAt: new Date(), releaseNote: "ok" }).where(eq(qaHold.bundleId, b1.id));
    await p.owner.dispatch.reserve({ id });
    await holdNow(p.companyId, b1.id);
    await expect(p.owner.dispatch.complete({ id })).rejects.toMatchObject({ message: `Bundle ${s1} is on quality hold` });
    expect(await statusOf(b1.id)).toBe("reserved");
  });

  test("B1: the office add by id refuses a held bundle", async () => {
    setClock(NOON);
    const p = await plant();
    const [s1] = await p.pack(p.dieA, [{ kg: 10 }]);
    const b1 = await bundleOf(p.companyId, s1!);
    await env.plantStock(p.companyId, [b1.id]);
    await p.as("supervisor").qa.holds.hold({ bundleId: b1.id, reason: "cracks" });
    const { id } = await p.owner.dispatch.create({ vehicleNo: "GJ05AB1234", customerId: p.customerId });
    await expect(p.owner.dispatch.addBundle({ id, bundleId: b1.id })).rejects.toMatchObject({ message: `Bundle ${s1} is on quality hold` });
  });

  test("B1: a hold placed between the read and the write stops reserve and complete (write-time guard)", async () => {
    setClock(NOON);
    const p = await plant();
    const [s1] = await p.pack(p.dieA, [{ kg: 10 }]);
    const b1 = await bundleOf(p.companyId, s1!);
    await env.plantStock(p.companyId, [b1.id]);
    const { id } = await p.owner.dispatch.create({ vehicleNo: "GJ05AB1234", customerId: p.customerId });
    await p.as("packer").dispatch.scan({ id, serials: [s1!] });
    const real = qaLib.assertNoQaHold;
    const holdAfterRead = () =>
      spyOn(qaLib, "assertNoQaHold").mockImplementationOnce(async (...args) => {
        await real(...args);
        await holdNow(p.companyId, b1.id);
      });

    let spy = holdAfterRead();
    try {
      await expect(p.owner.dispatch.reserve({ id })).rejects.toMatchObject({ message: `Bundle ${s1} is on quality hold` });
    } finally {
      spy.mockRestore();
    }
    expect(await statusOf(b1.id)).toBe("available");
    await env.db.update(qaHold).set({ releasedAt: new Date(), releaseNote: "ok" }).where(eq(qaHold.bundleId, b1.id));

    await p.owner.dispatch.reserve({ id });
    spy = holdAfterRead();
    try {
      await expect(p.owner.dispatch.complete({ id })).rejects.toMatchObject({ message: `Bundle ${s1} is on quality hold` });
    } finally {
      spy.mockRestore();
    }
    expect(await statusOf(b1.id)).toBe("reserved");
    expect((await env.db.query.dispatch.findFirst({ where: (d, o) => o.eq(d.id, id) }))!.status).toBe("reserved");
  });

  test("B1: with the module off, holds left behind do not stop a dispatch", async () => {
    setClock(NOON);
    const p = await plant();
    const [s1] = await p.pack(p.dieA, [{ kg: 10 }]);
    const b1 = await bundleOf(p.companyId, s1!);
    await env.plantStock(p.companyId, [b1.id]);
    const { id } = await p.owner.dispatch.create({ vehicleNo: "GJ05AB1234", customerId: p.customerId });
    await p.as("packer").dispatch.scan({ id, serials: [s1!] });
    await holdNow(p.companyId, b1.id);
    await env.db.update(company).set({ modules: ["dies", "bundles", "dispatches", "customers", "orders"] }).where(eq(company.id, p.companyId));
    await p.owner.dispatch.reserve({ id });
    expect(await statusOf(b1.id)).toBe("reserved");
  });

  test("B2: a pack that names no die copy is gated on the section's running run", async () => {
    const pp = await pressPlant();
    const [y] = await env.db.select({ id: location.id }).from(location).where(and(eq(location.companyId, pp.companyId), eq(location.code, "Y1")));
    const r = await pp.queuedRun();
    await pp.issue(r.runId, r.copyId);
    await pp.as("press").press.runs.start({ id: r.runId });
    await pp.as("manager").qa.settings.update({ firstPieceBlocksPack: true });
    const runNo = (await pp.owner.qa.run({ runId: r.runId })).run.number;
    const rows = [{ quantity: 10, weightG: kg(12), lengthMm: 3_658, poNumber: null }];
    await expect(pp.owner.bundle.createReceipt({ dieId: r.sectionId, unit: "pcs", locationId: y!.id, rows })).rejects.toMatchObject({ message: `The first piece of ${runNo} is not checked yet` });
    await pp.as("press").qa.checks.record({ kind: "first_piece", subjectType: "press_run", subjectId: r.runId, result: "pass" });
    await pp.owner.bundle.createReceipt({ dieId: r.sectionId, unit: "pcs", locationId: y!.id, rows });
  });

  test("S1: the quality save writes only its own key; a key saved meanwhile stays", async () => {
    const p = await plant();
    const real = qaLib.readQaPlant;
    const spy = spyOn(qaLib, "readQaPlant").mockImplementationOnce(async (...args) => {
      const plantNow = await real(...args);
      // An admin turns on secure sign-in right after the quality save read the settings.
      await env.db.update(company).set({ settings: sql`json_set(coalesce(${company.settings}, '{}'), '$.requireStrongSignIn', json('true'))` }).where(eq(company.id, p.companyId));
      return plantNow;
    });
    try {
      await p.as("manager").qa.settings.update({ firstPieceBlocksPack: true });
    } finally {
      spy.mockRestore();
    }
    const [row] = await env.db.select({ settings: company.settings }).from(company).where(eq(company.id, p.companyId));
    const settings = row!.settings as { requireStrongSignIn?: boolean; qa?: { firstPieceBlocksPack?: boolean } };
    expect(settings.requireStrongSignIn).toBe(true);
    expect(settings.qa?.firstPieceBlocksPack).toBe(true);
  });

  test("S2 and S3: hardness on another scale is not compared; no temper records not checked, never pass", async () => {
    const pp = await pressPlant();
    const r = await pp.queuedRun();
    const press = pp.as("press");
    const hb = await pp.as("manager").qa.tempers.save({ code: "T6", alloy: "6063", hardnessMethod: "hb", hardnessMinX10: 600 });
    const other = await press.qa.checks.record({ kind: "mechanical", subjectType: "press_run", subjectId: r.runId, temperId: hb.id, mechanical: { hardnessX10: 120, hardnessMethod: "webster" } });
    expect(other).toMatchObject({ result: "unchecked", flags: { low: [], missing: [], unchecked: ["hardness"] } });
    const same = await press.qa.checks.record({ kind: "mechanical", subjectType: "press_run", subjectId: r.runId, temperId: hb.id, mechanical: { hardnessX10: 120, hardnessMethod: "hb" } });
    expect(same).toMatchObject({ result: "fail", flags: { low: ["hardness"] } });
    // No method typed: read on the temper's own scale.
    expect((await press.qa.checks.record({ kind: "mechanical", subjectType: "press_run", subjectId: r.runId, temperId: hb.id, mechanical: { hardnessX10: 700 } })).result).toBe("pass");

    // S3: no temper picked and no plan on the section.
    const none = await press.qa.checks.record({ kind: "mechanical", subjectType: "press_run", subjectId: r.runId, mechanical: { tensileMpa: 90 } });
    expect(none.result).toBe("unchecked");
    expect((await pp.owner.qa.checks.list({ kind: "mechanical", result: "unchecked", limit: 50 })).items.map((x) => x.id).sort()).toEqual([other.id, none.id].sort());
  });

  test("N1: two first saves of one section's plan at once: one lands, the other is a clear CONFLICT", async () => {
    const pp = await pressPlant();
    const r = await pp.queuedRun();
    const mgr = pp.as("manager");
    const out = await Promise.allSettled([mgr.qa.plans.save({ dieId: r.sectionId, everyBundles: 5 }), mgr.qa.plans.save({ dieId: r.sectionId, everyBundles: 6 })]);
    const rejected = out.filter((o): o is PromiseRejectedResult => o.status === "rejected");
    expect(out.filter((o) => o.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    for (const f of rejected) expect(f.reason).toMatchObject({ code: "CONFLICT", message: "Someone saved this quality plan just now; open it again and save" });
    expect(await env.db.select({ id: qaPlan.id }).from(qaPlan).where(eq(qaPlan.dieId, r.sectionId))).toHaveLength(1);
  });

  test("N5: a certificate upload sent to the die-file commit is refused and its object kept", async () => {
    const p = await plant();
    const objects = new Map<string, number>();
    const fake = {
      head: async (key: string) => (objects.has(key) ? { key, size: objects.get(key)! } : null),
      delete: async (key: string) => void objects.delete(key),
    };
    workersEnv.DIE_FILES = fake;
    try {
      const inst = await p.as("manager").qa.instruments.save({ code: "HW-9", name: "Hardness tester" });
      const begun = await p.owner.qa.instruments.beginCertificate({ id: inst.id, name: "cert.pdf", size: 4, mime: "application/pdf" });
      const key = ticketKey((await readUploadTicket(begun.uploadId))!);
      objects.set(key, 4);
      await p.owner.qa.instruments.commitCertificate({ id: inst.id, uploadId: begun.uploadId });
      await expect(p.owner.dieInstance.files.commit({ uploadId: begun.uploadId })).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(objects.has(key)).toBe(true);
    } finally {
      delete workersEnv.DIE_FILES;
    }
  });
});
