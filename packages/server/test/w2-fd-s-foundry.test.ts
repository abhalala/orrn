/**
 * W2-FD-S foundry server (spec E4, FP-FD-01..20): masters, the melt stepper (draft → lock), lock
 * gates, correction by approval, spectro verdicts, the cast close after a REAL logged press run
 * (BACKLOG 55: castPressReturnsSql returned 0), billet stock, trace, cost, yield, the furnace
 * readings seam and cast-on-label enforcement once a melt is locked.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { approval, auditLog, bundle, cast, company, location, melt, meltChemical, meltInput, meltReading, spectroResult, stockLedger, storeTxn } from "@orrn/db/schema";

import { can as canMe, type Action } from "../src/lib/permissions";
import { productionDayWindowFor } from "../src/lib/productionDay";
import { addDays } from "../src/lib/zonedBuckets";
import { workersEnv } from "./env-mock";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";
import { fillWorkedExample, kg, pressHelpers, type PressPlant } from "./press-w2-fixture";

setDefaultTimeout(60_000);

let env: TestEnv;
let setClock: (at: Date | null) => void;
beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
}, 60_000);
afterEach(() => {
  setClock(null);
  delete workersEnv.FOUNDRY_SIMULATOR;
});
afterAll(async () => {
  await env.dispose();
});

const { pressPlant } = pressHelpers(() => env);
const H = 3_600_000;
const ROLES: CompanyRole[] = ["owner", "admin", "manager", "office", "accountant", "supervisor", "packer", "foundry", "press", "storekeeper", "die_room", "operator", "viewer"];
const can = (role: CompanyRole, action: Action) => canMe({ company: { role }, isPlatformAdmin: false, platformRole: null }, action);

type FoundryPlant = PressPlant & {
  lot(kgs: number, ratePaise?: number): Promise<{ id: string; number: string }>;
  stream(code: string): string;
  fluxId: string;
  times(): { preheatStart: number; chargingStart: number; chargingEnd: number; castingStart: number; castingEnd: number };
};

async function foundryPlant(opts: { settings?: Record<string, unknown> } = {}): Promise<FoundryPlant> {
  const p = await pressPlant(opts);
  const manager = p.as("manager");
  await manager.purchase.seedScrapDefaults();
  await manager.foundry.returnStreams.seedDefaults();
  await manager.foundry.furnaces.seedDefaults();
  await manager.foundry.alloys.seedDefaults();
  const items = (await manager.purchase.scrapItems.list()).items;
  const v = await manager.vendor.create({ name: "Shree Ganesh Metals" });
  const streams = (await p.as("viewer").foundry.returnStreams.list()).items;
  const store = p.as("storekeeper");
  const fluxId = (await store.store.items.create({ name: "Cover flux", unit: "kg", category: "chemical" })).id;
  await store.store.receive({ itemId: fluxId, qtyMilli: 100_000 });
  async function lot(kgs: number, ratePaise = 18_500) {
    const l = await store.purchase.lots.create({
      vendorId: v.id, date: "2026-10-01", origin: "LOCAL", itemId: items.find((i) => i.name === "IMP BELLING")!.id, grade: "A",
      partyKgG: kg(kgs), fcKgG: kg(kgs), ratePaise, billBook: "main",
    });
    await store.purchase.lots.advance({ id: l.id, to: "ok" });
    return { id: l.id, number: l.number };
  }
  const t0 = Date.now() - 8 * H;
  const times = () => ({ preheatStart: t0, chargingStart: t0 + H, chargingEnd: t0 + 3 * H, castingStart: t0 + 4 * H, castingEnd: t0 + 6 * H });
  const stream = (code: string) => streams.find((s) => s.code === code)!.id;
  // r1 (I-3): a stream is never charged below its balance; the plant starts with plant scrap in stock.
  await openStream(p.companyId, stream("PLANT-SCRAP"), p.plantScrapId, 2_000);
  return { ...p, lot, stream, fluxId, times };
}

/** An `opening` row: the stream's stock at go-live (there is no opening screen for return streams yet). */
async function openStream(companyId: string, streamId: string, locationId: string, kgs: number) {
  await env.db.insert(stockLedger).values({
    id: crypto.randomUUID(), companyId, serverSeq: 0, voucherType: "opening", voucherId: crypto.randomUUID(),
    line: 1, itemKind: "return_stream", itemRef: streamId, locationId, qtyG: kg(kgs), postedAt: new Date(),
  });
}

/** The yard count at close (Q59-A): billets and their kg. 0 kg is an empty yard. */
const count = (kgs: number) => ({ count: kgs === 0 ? 0 : Math.max(1, Math.round(kgs / 38.8)), kgG: kg(kgs) });

/** A cast with one locked 5,150 kg melt (spectro reason) and the worked-example press run logged on it (310.4 kg). */
async function castPressed(p: FoundryPlant) {
  const lot = await p.lot(8_000);
  const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
  const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { spectroReason: "Lab" }));
  await p.as("foundry").foundry.melts.lock({ meltId: d.id });
  const r = await p.countingRun({ pcs: 100 });
  await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
  await p.as("supervisor").press.runs.close({ id: r.runId });
  return { lot, c, d, r };
}

async function billetLedger(companyId: string, castId: string) {
  return env.db.select().from(stockLedger).where(and(eq(stockLedger.companyId, companyId), eq(stockLedger.itemKind, "billet"), eq(stockLedger.itemRef, castId)));
}

/** A complete draft: 5,000 kg lot + 300 kg plant scrap in; 5,150 kg logs, 80 dross, 20 Fe out (burn 50 kg, 0.94 %). */
function draft(p: FoundryPlant, castId: string, lotId: string, over: Record<string, unknown> = {}) {
  return {
    castId,
    times: p.times(),
    ldoTenthIn: { start: 480, end: 455 },
    inputs: [
      { kind: "lot" as const, ref: lotId, kgG: kg(5_000) },
      { kind: "return_stream" as const, ref: p.stream("PLANT-SCRAP"), kgG: kg(300) },
    ],
    chemicals: [{ storeItemId: p.fluxId, openMilli: 20_000, usedMilli: 12_000, closeMilli: 8_000 }],
    logs: [{ pcs: 20, lengthMm: 6_000, billetLengthMm: 600, kgG: kg(5_150) }],
    drossG: kg(80),
    feG: kg(20),
    ...over,
  };
}

async function pass(p: FoundryPlant, meltId: string) {
  // 6063 seeded limits: all eight inside → pass.
  return p.as("foundry").foundry.spectro.enter({
    meltId,
    valuesPpm: { si: 4_500, fe: 1_800, cu: 100, mn: 100, mg: 5_200, zn: 100, ti: 100, cr: 100 },
    entryReason: "Printer down; read off the screen",
  });
}

async function ledgerOf(companyId: string, voucherId: string) {
  return env.db.select().from(stockLedger).where(and(eq(stockLedger.companyId, companyId), eq(stockLedger.voucherId, voucherId)));
}

async function audits(companyId: string) {
  return (await env.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.companyId, companyId))).map((a) => a.action);
}

async function tailCode(p: FoundryPlant, code: string) {
  return (await p.as("viewer").reasonCodes.list({ kind: "cast_tail" })).find((r) => r.code === code)!.id;
}

// ---------------------------------------------------------------------------
// FP-FD-01, 09: masters
// ---------------------------------------------------------------------------

describe("FD-01/09 furnace and alloy masters (masters.publish)", () => {
  test("seeded F1 (6 t, 127 mm) and 6063 / 6061 with limits; create, edit, retire; codes unique; audit", async () => {
    const p = await foundryPlant();
    const m = p.as("manager");
    expect((await p.as("foundry").foundry.furnaces.list()).items).toEqual([expect.objectContaining({ code: "F1", capacityG: 6_000_000, billetDiaMm: 127, status: "active" })]);
    const alloys = (await p.as("viewer").foundry.alloys.list()).items;
    expect(alloys.map((a) => a.code)).toEqual(["6063", "6061"]);
    expect(alloys[0]!.limits.find((l) => l.element === "mg")).toEqual({ element: "mg", minPpm: 4_500, maxPpm: 9_000 });
    expect(await m.foundry.alloys.seedDefaults()).toEqual({ added: 0 });

    const f2 = await m.foundry.furnaces.create({ code: "f2", name: "Furnace 2", capacityG: 4_000_000, billetDiaMm: 152 });
    expect(f2.code).toBe("F2");
    await expect(m.foundry.furnaces.create({ code: "F2", name: "Again", capacityG: 1_000_000 })).rejects.toMatchObject({ code: "CONFLICT" });
    await m.foundry.furnaces.update({ id: f2.id, status: "retired" });
    const a = await m.foundry.alloys.create({ code: "6082", name: "Alloy 6082", limits: [{ element: "si", minPpm: 7_000, maxPpm: 13_000 }] });
    await expect(m.foundry.alloys.setLimits({ alloyId: a.id, limits: [{ element: "mg", minPpm: 12_000, maxPpm: 6_000 }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const set = await m.foundry.alloys.setLimits({ alloyId: a.id, limits: [{ element: "mg", minPpm: 6_000, maxPpm: 12_000 }, { element: "si", minPpm: null, maxPpm: null }] });
    expect(set.limits).toEqual([{ element: "mg", minPpm: 6_000, maxPpm: 12_000 }]);
    expect(await audits(p.companyId)).toEqual(expect.arrayContaining(["foundry.furnace.create", "foundry.furnace.update", "foundry.alloy.create", "foundry.alloy.limits"]));
  });

  test("only masters.publish holders (manager, admin, owner) write masters; another company's rows are NOT_FOUND", async () => {
    const p = await foundryPlant();
    const q = await foundryPlant();
    for (const role of ROLES.filter((r) => !can(r, "masters.publish"))) {
      await expect(p.as(role).foundry.furnaces.create({ code: "X1", name: "X", capacityG: 1_000_000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(p.as(role).foundry.alloys.create({ code: "X1", name: "X" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const f = (await p.as("viewer").foundry.furnaces.list()).items[0]!;
    await expect(q.as("manager").foundry.furnaces.update({ id: f.id, name: "Mine" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("casts.open takes the alloy master row (or finds it by code); a retired alloy cannot open a cast", async () => {
    const p = await foundryPlant();
    const [a6063, a6061] = (await p.as("viewer").foundry.alloys.list()).items;
    const byId = await p.as("foundry").foundry.casts.open({ alloyId: a6061!.id });
    expect(await env.db.select({ alloy: cast.alloy, alloyId: cast.alloyId }).from(cast).where(eq(cast.id, byId.id))).toEqual([{ alloy: "6061", alloyId: a6061!.id }]);
    const byCode = await p.as("supervisor").foundry.casts.open({ alloy: "6063" });
    expect((await env.db.select({ alloyId: cast.alloyId }).from(cast).where(eq(cast.id, byCode.id)))[0]!.alloyId).toBe(a6063!.id);
    await p.as("manager").foundry.alloys.update({ id: a6061!.id, status: "retired" });
    await expect(p.as("foundry").foundry.casts.open({ alloyId: a6061!.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// FP-FD-03..08: the stepper
// ---------------------------------------------------------------------------

describe("FD-03..08 melt stepper: a draft posts nothing; the lock posts everything in one batch", () => {
  test("save → lock: ledger, MRS, lot remaining, figures, diameter from the furnace; replay answers the first lock", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id));
    expect(d).toMatchObject({ status: "draft", seq: 1, inputG: kg(5_300), logsG: kg(5_150), burnG: kg(50), gates: ["spectro_reason_missing"] });
    // Nothing posted: no ledger rows, no MRS, the lot keeps its kg.
    expect(await ledgerOf(p.companyId, d.id)).toEqual([]);
    expect(await env.db.select().from(storeTxn).where(and(eq(storeTxn.companyId, p.companyId), eq(storeTxn.purpose, "melt")))).toEqual([]);
    expect((await p.as("foundry").foundry.lots.available()).lots.find((l) => l.id === lot.id)!.remainingG).toBe(kg(8_000));
    // Spectro gate: a passing typed result clears it.
    await expect(p.as("foundry").foundry.melts.lock({ meltId: d.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Spectro") });
    expect((await pass(p, d.id)).verdict).toBe("pass");
    const locked = await p.as("foundry").foundry.melts.lock({ meltId: d.id, clientMutationId: "lock-melt-0001" });
    expect(locked).toMatchObject({ status: "locked", castNumber: c.number, inputG: kg(5_300), logsG: kg(5_150), burnG: kg(50), spectroVerdict: "pass", mrsNumbers: ["MRS-1"] });
    const rows = await ledgerOf(p.companyId, d.id);
    const by = (k: string) => rows.filter((r) => r.itemKind === k).map((r) => r.qtyG).sort((a, b) => a - b);
    expect(by("scrap_grade")).toEqual([-kg(5_000)]);
    expect(by("billet")).toEqual([kg(5_150)]);
    expect(by("return_stream")).toEqual([-kg(300), kg(20), kg(80)]);
    expect((await p.as("foundry").foundry.lots.available()).lots.find((l) => l.id === lot.id)!.remainingG).toBe(kg(3_000));
    const [chem] = await env.db.select().from(meltChemical).where(eq(meltChemical.meltId, d.id));
    expect(chem!.storeTxnId).toBeTruthy();
    const got = await p.as("viewer").foundry.casts.get({ id: c.id });
    expect(got.melts[0]!.outputs[0]).toMatchObject({ kind: "logs", billetLengthMm: 600, diameterMm: 127 });
    // Replay: same answer, nothing written twice; a locked melt does not lock again.
    expect(await p.as("foundry").foundry.melts.lock({ meltId: d.id, clientMutationId: "lock-melt-0001" })).toEqual(locked);
    expect(await ledgerOf(p.companyId, d.id)).toHaveLength(rows.length);
    await expect(p.as("foundry").foundry.melts.lock({ meltId: d.id })).rejects.toMatchObject({ message: "This melt is already locked" });
    await expect(p.as("foundry").foundry.melts.save({ ...draft(p, c.id, lot.id), meltId: d.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await audits(p.companyId)).filter((a) => a === "foundry.melt.lock")).toHaveLength(1);
  });

  test("lock gates: times out of order, more out than in without a reason, over capacity, alloy other than the cast's", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(20_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const t = p.times();
    const s = (over: Record<string, unknown>) => p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, over));
    expect((await s({ times: { ...t, chargingEnd: t.castingStart + 1 } })).gates).toContain("times_out_of_order");
    expect((await s({ logs: [{ pcs: 20, lengthMm: 6_000, kgG: kg(5_300) }] })).gates).toContain("balance_reason_missing");
    expect((await s({ logs: [{ pcs: 20, lengthMm: 6_000, kgG: kg(5_300) }], balanceNote: "Weighbridge read low" })).gates).not.toContain("balance_reason_missing");
    expect((await s({ inputs: [{ kind: "lot", ref: lot.id, kgG: kg(6_500) }] })).gates).toContain("over_capacity");
    const a6061 = (await p.as("viewer").foundry.alloys.list()).items.find((a) => a.code === "6061")!;
    const wrong = await s({ alloyId: a6061.id });
    expect(wrong.gates).toContain("alloy_reason_missing");
    await expect(p.as("foundry").foundry.melts.lock({ meltId: wrong.id })).rejects.toMatchObject({ code: "BAD_REQUEST", meta: { gates: expect.arrayContaining(["alloy_reason_missing"]) } });
    // A blank sheet: no input, no logs, no charging start.
    const blank = await p.as("foundry").foundry.melts.save({ castId: c.id });
    expect(blank.gates).toEqual(expect.arrayContaining(["no_input", "no_logs", "no_charging_start"]));
  });

  test("RACE: another melt locks the lot's last kg first — the second lock writes nothing and says how much is left", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(6_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const a = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { spectroReason: "Sample at the lab" }));
    const b = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { spectroReason: "Sample at the lab" }));
    env.beforeNextBatch(() => p.as("supervisor").foundry.melts.lock({ meltId: a.id }));
    await expect(p.as("foundry").foundry.melts.lock({ meltId: b.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("left in") });
    expect(await ledgerOf(p.companyId, b.id)).toEqual([]);
    expect((await env.db.select({ status: melt.status }).from(melt).where(eq(melt.id, b.id)))[0]!.status).toBe("draft");
  });

  test("a 60-line lock stays within 100 bound parameters", async () => {
    const p = await foundryPlant();
    const lots = [];
    for (let i = 0; i < 59; i++) lots.push(await p.lot(100));
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const inputs = [...lots.map((l) => ({ kind: "lot" as const, ref: l.id, kgG: kg(80) })), { kind: "return_stream" as const, ref: p.stream("PLANT-SCRAP"), kgG: kg(100) }];
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lots[0]!.id, { inputs, logs: [{ pcs: 15, lengthMm: 6_000, kgG: kg(4_700) }], drossG: kg(100), feG: kg(20), spectroReason: "Lab" }));
    env.resetPeakParams();
    await p.as("foundry").foundry.melts.lock({ meltId: d.id });
    expect(env.peakParams()).toBeLessThanOrEqual(100);
    expect((await ledgerOf(p.companyId, d.id)).filter((r) => r.itemKind === "scrap_grade")).toHaveLength(59);
  });

  test("r1 (I-3): the lock never charges a return stream below its balance (read time and inside the batch)", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(20_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const ingot = (kgs: number) => ({
      spectroReason: "Lab",
      inputs: [{ kind: "lot" as const, ref: lot.id, kgG: kg(3_000) }, { kind: "return_stream" as const, ref: p.stream("INGOT"), kgG: kg(kgs) }],
      logs: [{ pcs: 20, lengthMm: 6_000, kgG: kg(2_900 + kgs) }],
    });
    const empty = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, ingot(300)));
    await expect(p.as("foundry").foundry.melts.lock({ meltId: empty.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Only 0 kg of Ingot is in stock" });
    expect(await ledgerOf(p.companyId, empty.id)).toEqual([]);
    // 1,500 kg in stock; two drafts each take 1,000: the one that locks second loses inside its batch.
    await openStream(p.companyId, p.stream("INGOT"), p.plantScrapId, 1_500);
    const a = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, ingot(1_000)));
    const b = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, ingot(1_000)));
    env.beforeNextBatch(() => p.as("supervisor").foundry.melts.lock({ meltId: a.id }));
    await expect(p.as("foundry").foundry.melts.lock({ meltId: b.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Only 500 kg of Ingot is in stock" });
    expect(await ledgerOf(p.companyId, b.id)).toEqual([]);
    expect((await env.db.select({ status: melt.status }).from(melt).where(eq(melt.id, b.id)))[0]!.status).toBe("draft");
    const bal = (await p.as("viewer").foundry.returnStreams.list()).items.find((s) => s.code === "INGOT")!.balanceG;
    expect(bal).toBe(kg(500));
  });

  test("r1 (I-2): the legacy melts.create runs the lock gates (spectro reason, furnace capacity) and records the furnace", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(20_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const t = p.times();
    const legacy = (inKg: number, over: Record<string, unknown> = {}) => ({
      castId: c.id,
      timestamps: { preheatStart: t.preheatStart, chargingStart: t.chargingStart, chargingEnd: t.chargingEnd, castingStart: t.castingStart, castingEnd: t.castingEnd },
      ldoTenthIn: { start: 480, end: 455 },
      inputs: [{ kind: "lot" as const, ref: lot.id, kgG: kg(inKg) }],
      chemicals: [],
      outputs: { logs: { pcs: 20, lengthMm: 6_000, kgG: kg(inKg * 0.98) }, drossG: 0, feG: 0, returns: [] },
      ...over,
    });
    await expect(p.as("foundry").foundry.melts.create(legacy(5_000))).rejects.toMatchObject({ code: "BAD_REQUEST", meta: { gates: ["spectro_reason_missing"] } });
    await expect(p.as("foundry").foundry.melts.create(legacy(6_500, { spectroReason: "Lab" }))).rejects.toMatchObject({ code: "BAD_REQUEST", meta: { gates: ["over_capacity"] } });
    expect(await env.db.select().from(melt).where(eq(melt.castId, c.id))).toEqual([]);
    const m = await p.as("foundry").foundry.melts.create(legacy(5_000, { spectroReason: "Lab" }));
    const furnaceId = (await p.as("viewer").foundry.furnaces.list()).items[0]!.id;
    expect((await env.db.select().from(melt).where(eq(melt.id, m.id)))[0]).toMatchObject({ status: "locked", furnaceId, spectroReason: "Lab" });
  });

  test("discard drops a draft (it keeps its number); a locked melt cannot be discarded; the next melt is number 2", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id));
    await p.as("foundry").foundry.melts.discard({ meltId: d.id });
    await expect(p.as("foundry").foundry.melts.discard({ meltId: d.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id))).seq).toBe(2);
    expect(await audits(p.companyId)).toContain("foundry.melt.discard");
  });

  test("a draft blocks the cast close; melt.enter is foundry and supervisor (owner); others are FORBIDDEN", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id));
    await expect(p.as("manager").foundry.casts.close({ castId: c.id, billetsOnHand: count(0) })).rejects.toMatchObject({ message: expect.stringContaining("not locked") });
    expect((await p.as("viewer").foundry.casts.list({})).items.find((x) => x.id === c.id)).toMatchObject({ draftMelts: 1, meltCount: 0 });
    for (const role of ROLES.filter((r) => !can(r, "melt.enter"))) {
      await expect(p.as(role).foundry.melts.save(draft(p, c.id, lot.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(ROLES.filter((r) => can(r, "melt.enter"))).toEqual(["owner", "supervisor", "foundry"]);
  });
});

// ---------------------------------------------------------------------------
// FP-FD-13: correction by approval
// ---------------------------------------------------------------------------

describe("FD-13 no edit after lock: a reason-coded correction through approval melt_correct", () => {
  test("request → approve (never the requester) → correct: reversal rows, store draw back, a draft copy to fix and lock", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id));
    await pass(p, d.id);
    await p.as("foundry").foundry.melts.lock({ meltId: d.id });
    await expect(p.as("foundry").foundry.melts.correct({ meltId: d.id })).rejects.toMatchObject({ message: expect.stringContaining("Ask for a correction first") });
    const code = (await p.as("viewer").reasonCodes.list({ kind: "melt_correct" })).find((r) => r.code === "wrong_weight")!.id;
    const { approvalId } = await p.as("foundry").foundry.melts.requestCorrection({ meltId: d.id, reasonCodeId: code, note: "Logs were 5,105 kg" });
    await expect(p.as("foundry").foundry.melts.requestCorrection({ meltId: d.id, reasonCodeId: code })).rejects.toMatchObject({ message: expect.stringContaining("waiting") });
    // The melt page asks for this melt's requests alone (W2-FD-W review m4), however many others the plant has.
    expect((await p.as("foundry").approval.list({ kind: "melt_correct", subjectId: d.id })).items.map((r) => r.id)).toEqual([approvalId]);
    expect((await p.as("foundry").approval.list({ kind: "melt_correct", subjectId: "no-such-melt" })).items).toEqual([]);
    await expect(p.as("foundry").approval.decide({ id: approvalId, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("manager").approval.decide({ id: approvalId, decision: "approved" });
    const out = await p.as("foundry").foundry.melts.correct({ meltId: d.id, clientMutationId: "correct-0001" });
    const reversed = (await ledgerOf(p.companyId, d.id)).filter((r) => r.voucherType === "melt_cancel");
    expect(reversed.length).toBe((await ledgerOf(p.companyId, d.id)).filter((r) => r.voucherType === "melt").length);
    expect((await env.db.select().from(storeTxn).where(eq(storeTxn.companyId, p.companyId))).filter((t) => t.cancelledAt)).toHaveLength(1);
    const [copy] = await env.db.select().from(melt).where(eq(melt.id, out.draftId));
    expect(copy).toMatchObject({ status: "draft", seq: 2, correctsMeltId: d.id, inputG: kg(5_300) });
    // r1 (m-2): the corrected original says so; (m-3) the copy keeps the spectro it was judged by.
    expect((await env.db.select({ status: melt.status, cancelledAt: melt.cancelledAt }).from(melt).where(eq(melt.id, d.id)))[0]).toMatchObject({ status: "corrected", cancelledAt: expect.any(Date) });
    const copied = await env.db.select().from(spectroResult).where(eq(spectroResult.meltId, out.draftId));
    expect(copied).toEqual([expect.objectContaining({ verdict: "pass", source: "typed", siPpm: 4_500, mgPpm: 5_200 })]);
    expect((await p.as("foundry").foundry.melts.preview({ meltId: out.draftId })).spectroVerdict).toBe("pass");
    expect(await env.db.select().from(meltInput).where(eq(meltInput.meltId, out.draftId))).toHaveLength(2);
    expect((await env.db.select({ meta: approval.meta }).from(approval).where(eq(approval.id, approvalId)))[0]!.meta).toMatchObject({ draftId: out.draftId });
    // The grant is used once; a retry answers the first correction.
    expect(await p.as("foundry").foundry.melts.correct({ meltId: d.id, clientMutationId: "correct-0001" })).toEqual(out);
    // Fix the weight and lock the copy: the copied pass clears the spectro gate, no reason asked.
    await p.as("foundry").foundry.melts.save({ ...draft(p, c.id, lot.id), meltId: out.draftId, logs: [{ pcs: 20, lengthMm: 6_000, kgG: kg(5_105) }] });
    expect(await p.as("foundry").foundry.melts.lock({ meltId: out.draftId })).toMatchObject({ logsG: kg(5_105), spectroVerdict: "pass" });
    expect((await p.as("viewer").foundry.casts.get({ id: c.id })).closeout).toMatchObject({ producedG: kg(5_105), billetsOnHandG: kg(5_105), tailG: 0 });
  });

  test("a locked melt is cancelled only by cast.close holders; the floor's cancel is FORBIDDEN", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { spectroReason: "Lab" }));
    await expect(p.as("supervisor").foundry.melts.cancel({ meltId: d.id, reason: "x" })).rejects.toMatchObject({ message: expect.stringContaining("discard") });
    await p.as("foundry").foundry.melts.lock({ meltId: d.id });
    await expect(p.as("foundry").foundry.melts.cancel({ meltId: d.id, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("admin").foundry.melts.cancel({ meltId: d.id, reason: "Wrong cast" })).resolves.toMatchObject({ cancelled: true });
    // r1 (m-2): a cancelled locked melt is `cancelled`, everywhere (row, cast sheet, trace).
    expect((await env.db.select({ status: melt.status }).from(melt).where(eq(melt.id, d.id)))[0]!.status).toBe("cancelled");
    expect((await p.as("viewer").foundry.casts.trace({ castId: c.id })).melts[0]).toMatchObject({ id: d.id, status: "cancelled", cancelledAt: expect.any(Date) });
  });

  test("r1 (m-6): the owner asks for a correction and cannot approve it; another approver can", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("owner").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("owner").foundry.melts.save(draft(p, c.id, lot.id, { spectroReason: "Lab" }));
    await p.as("owner").foundry.melts.lock({ meltId: d.id });
    const code = (await p.as("viewer").reasonCodes.list({ kind: "melt_correct" })).find((r) => r.code === "wrong_weight")!.id;
    const { approvalId } = await p.as("owner").foundry.melts.requestCorrection({ meltId: d.id, reasonCodeId: code, note: "Logs 5,105 kg" });
    // The owner IS a melt_correct approver: only the requester rule stops this.
    await expect(p.as("owner").approval.decide({ id: approvalId, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await env.db.select({ status: approval.status }).from(approval).where(eq(approval.id, approvalId)))[0]!.status).toBe("pending");
    await p.as("admin").approval.decide({ id: approvalId, decision: "approved" });
    expect((await env.db.select({ status: approval.status }).from(approval).where(eq(approval.id, approvalId)))[0]!.status).toBe("approved");
  });

  test("r1 (m-7): melts.save and spectro.enter with a clientRequestId answer a retry with the first row", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const first = await p.as("foundry").foundry.melts.save({ ...draft(p, c.id, lot.id), clientRequestId: "save-0001" });
    const again = await p.as("foundry").foundry.melts.save({ ...draft(p, c.id, lot.id), clientRequestId: "save-0001" });
    expect(again.id).toBe(first.id);
    expect(await env.db.select({ id: melt.id }).from(melt).where(eq(melt.castId, c.id))).toHaveLength(1);
    const valuesPpm = { si: 4_500, fe: 1_800, cu: 100, mn: 100, mg: 5_200, zn: 100, ti: 100, cr: 100 };
    const s1 = await p.as("foundry").foundry.spectro.enter({ meltId: first.id, valuesPpm, entryReason: "Printer down", clientRequestId: "spec-0001" });
    const s2 = await p.as("foundry").foundry.spectro.enter({ meltId: first.id, valuesPpm, entryReason: "Printer down", clientRequestId: "spec-0001" });
    expect(s2.id).toBe(s1.id);
    expect(await env.db.select({ id: spectroResult.id }).from(spectroResult).where(eq(spectroResult.meltId, first.id))).toHaveLength(1);
    expect((await audits(p.companyId)).filter((a) => a === "spectro.attach")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// FP-FD-10/11/12: spectro
// ---------------------------------------------------------------------------

describe("FD-10..12 spectro: verdict against the alloy limits, typed entry with a reason, void on a draft", () => {
  test("a value outside the limits fails; missing elements are incomplete; the verdict keeps the limits it was judged by", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id));
    const f = p.as("foundry").foundry.spectro;
    const fail = await f.enter({ meltId: d.id, valuesPpm: { si: 4_500, fe: 1_800, cu: 100, mn: 100, mg: 9_500, zn: 100, ti: 100, cr: 100 }, entryReason: "typed" });
    expect(fail.verdict).toBe("fail");
    // r1 (I-4): no file means typed numbers, and typed numbers need the reason.
    await expect(f.attach({ meltId: d.id, fileName: "K.csv", mime: "text/csv", base64: "", values: { Si: 0.45, Mg: 0.52 } })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "No file is attached; say why the numbers are typed",
    });
    await expect(f.attach({ meltId: d.id, fileName: "K.csv", mime: "text/csv", base64: "", values: { Si: 0.45 }, entryReason: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await env.db.select().from(spectroResult).where(eq(spectroResult.meltId, d.id))).toHaveLength(1);
    const part = await f.attach({ meltId: d.id, fileName: "K.csv", mime: "text/csv", base64: "", values: { Si: 0.45, Mg: 0.52 }, entryReason: "Spectro PC offline" });
    expect(part.verdict).toBe("incomplete");
    expect((await env.db.select().from(spectroResult).where(eq(spectroResult.id, part.id)))[0]).toMatchObject({ source: "typed", entryReason: "Spectro PC offline" });
    const [row] = await env.db.select().from(spectroResult).where(eq(spectroResult.id, fail.id));
    expect(row).toMatchObject({ source: "typed", entryReason: "typed", mgPpm: 9_500, alSource: "balance", verdict: "fail" });
    expect(row!.limitsSnapshot!.alloyCode).toBe("6063");
    await expect(f.enter({ meltId: d.id, valuesPpm: { si: 600_000, fe: 500_000 }, entryReason: "x" })).rejects.toMatchObject({ message: expect.stringContaining("100 %") });
    await expect(f.enter({ meltId: d.id, valuesPpm: {}, entryReason: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Void the bad typed result on the draft; the latest live one gates the lock.
    await f.void({ id: part.id, reason: "Wrong sample" });
    await f.void({ id: fail.id, reason: "Typo in Mg" });
    expect((await p.as("foundry").foundry.melts.preview({ meltId: d.id })).spectroVerdict).toBeNull();
    await pass(p, d.id);
    await p.as("foundry").foundry.melts.lock({ meltId: d.id });
    const latest = (await env.db.select().from(spectroResult).where(and(eq(spectroResult.meltId, d.id)))).find((r) => !r.voidedAt)!;
    await expect(f.void({ id: latest.id, reason: "x" })).rejects.toMatchObject({ message: expect.stringContaining("locked") });
    expect(await audits(p.companyId)).toContain("foundry.spectro.void");
  });
});

// ---------------------------------------------------------------------------
// FP-FD-14/15: close after a real press run (BACKLOG 55 fix), billet stock
// ---------------------------------------------------------------------------

describe("FD-14/15 cast close after a REAL logged press run (castPressReturnsSql fixed)", () => {
  test("billets − press used − on hand = 0: the count matches, the cast closes with no reason and no adjustment", async () => {
    const p = await foundryPlant();
    const { c } = await castPressed(p);
    const co = (await p.as("viewer").foundry.casts.get({ id: c.id })).closeout;
    expect(co).toMatchObject({ producedG: kg(5_150), creditedG: kg(310.4), billetsOnHandG: kg(5_150) - kg(310.4), tailG: 0, needsReason: false, needsApproval: false });
    const stock = await p.as("viewer").foundry.stock.billets();
    expect(stock.casts.find((x) => x.castId === c.id)).toMatchObject({ onHandG: kg(5_150) - kg(310.4), adjustedG: 0, alloy: "6063" });
    expect(stock.byAlloy.find((a) => a.alloy === "6063")!.onHandG).toBeGreaterThanOrEqual(kg(5_150) - kg(310.4));
    expect(await p.as("manager").foundry.casts.close({ castId: c.id, billetsOnHand: count(4_839.6) })).toMatchObject({ status: "closed", tailG: 0, adjustG: 0, approvalId: null });
    expect((await billetLedger(p.companyId, c.id)).filter((x) => x.voucherType === "cast_tail")).toEqual([]);
  });

  test("r1 (m-1): a REOPENED press run puts its billets back: credited 0, on hand back to the melt's logs", async () => {
    const p = await foundryPlant();
    const { c, r } = await castPressed(p);
    expect((await p.as("viewer").foundry.casts.get({ id: c.id })).closeout).toMatchObject({ creditedG: kg(310.4), billetsOnHandG: kg(4_839.6) });
    const { approvalId } = await p.as("manager").press.runs.reopen({ id: r.runId, reason: "Wrong cast on the sheet" });
    await p.as("admin").approval.decide({ id: approvalId, decision: "approved" });
    const back = (await p.as("viewer").foundry.casts.get({ id: c.id })).closeout;
    expect(back).toMatchObject({ producedG: kg(5_150), creditedG: 0, billetsOnHandG: kg(5_150), tailG: 0 });
    expect((await billetLedger(p.companyId, c.id)).filter((x) => x.voucherType === "press_run_reopen").map((x) => x.qtyG)).toEqual([kg(310.4)]);
    // The run is counting again; with its billets back the yard count of 5,150 kg closes clean.
    expect(await p.as("manager").foundry.casts.close({ castId: c.id, billetsOnHand: count(5_150) })).toMatchObject({ status: "closed", tailG: 0, adjustG: 0 });
  });

  test("r1 (I-1, Q59-A) a REAL tail: the yard count finds 39.6 kg less than the ledger — reason, cast_tail row, stock, trace and yield show it", async () => {
    const p = await foundryPlant();
    const { c } = await castPressed(p);
    // Ledger on hand = 5,150 − 310.4 = 4,839.6 kg; the yard count finds 4,800 kg.
    const preview = await p.as("supervisor").foundry.casts.closePreview({ castId: c.id, billetsOnHand: count(4_800) });
    expect(preview).toMatchObject({ ledgerOnHandG: kg(4_839.6), countedG: kg(4_800), tailG: kg(39.6), adjustG: -kg(39.6), needsReason: true, needsApproval: false });
    await expect(p.as("manager").foundry.casts.close({ castId: c.id, billetsOnHand: count(4_800) })).rejects.toMatchObject({ message: "39.6 kg of " + c.number + " billets is not explained; pick a reason" });
    const out = await p.as("manager").foundry.casts.close({ castId: c.id, billetsOnHand: count(4_800), reasonCodeId: await tailCode(p, "scrapped") });
    expect(out).toMatchObject({ status: "closed", tailG: kg(39.6), countedG: kg(4_800), adjustG: -kg(39.6), approvalId: null });
    const tail = (await billetLedger(p.companyId, c.id)).filter((x) => x.voucherType === "cast_tail");
    expect(tail).toEqual([expect.objectContaining({ voucherId: c.id, line: 1, qtyG: -kg(39.6), locationId: p.billetStoreId })]);
    // Ledger, stock, trace and yield agree with the count.
    expect((await p.as("viewer").foundry.casts.get({ id: c.id })).closeout).toMatchObject({ billetsOnHandG: kg(4_800), adjustedG: -kg(39.6), tailG: kg(39.6) });
    expect((await p.as("viewer").foundry.stock.billets()).casts.find((x) => x.castId === c.id)).toMatchObject({ onHandG: kg(4_800), adjustedG: -kg(39.6), status: "closed" });
    expect((await p.as("viewer").foundry.casts.trace({ castId: c.id })).billets).toMatchObject({ onHandG: kg(4_800), adjustedG: -kg(39.6), tailG: kg(39.6), countedG: kg(4_800) });
    // Report bounds are production days on the company's clock (including the hours before shift 1).
    const today = (await productionDayWindowFor(env.db, p.companyId)).productionDay;
    const from = addDays(today, -3);
    const y = await p.as("manager").analytics.foundryYield({ from, to: today, groupBy: "alloy" });
    expect(y.total).toMatchObject({ logsG: kg(5_150), tailAdjustG: -kg(39.6), netYieldBp: Math.round(((kg(5_150) - kg(39.6)) * 10_000) / kg(5_300)) });
    expect(y.rows.find((x) => x.key === "6063")).toMatchObject({ tailAdjustG: -kg(39.6) });
  });

  test("r1 (I-1) beyond 3 %: closing + cast_close approval; the applier posts the count adjustment; a later press run on the CLOSED cast is allowed and tracked", async () => {
    const p = await foundryPlant();
    const { c } = await castPressed(p);
    // The count finds 4,500 kg: 339.6 kg short of the ledger = 6.59 % of 5,150 kg produced.
    const out = await p.as("manager").foundry.casts.close({ castId: c.id, billetsOnHand: count(4_500), reasonCodeId: await tailCode(p, "scrapped"), note: "Bent logs cut up" });
    expect(out).toMatchObject({ status: "closing", tailG: kg(339.6), tailBp: 659, adjustG: -kg(339.6) });
    expect((await billetLedger(p.companyId, c.id)).filter((x) => x.voucherType === "cast_tail")).toEqual([]);
    const [req] = await env.db.select().from(approval).where(eq(approval.id, out.approvalId!));
    expect(req!.meta).toMatchObject({ ledgerOnHandG: kg(4_839.6), countedG: kg(4_500), adjustG: -kg(339.6) });
    await expect(p.as("manager").approval.decide({ id: out.approvalId!, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("owner").approval.decide({ id: out.approvalId!, decision: "approved" });
    expect((await env.db.select({ status: cast.status }).from(cast).where(eq(cast.id, c.id)))[0]!.status).toBe("closed");
    expect((await billetLedger(p.companyId, c.id)).filter((x) => x.voucherType === "cast_tail").map((x) => x.qtyG)).toEqual([-kg(339.6)]);
    expect((await p.as("viewer").foundry.casts.get({ id: c.id })).closeout).toMatchObject({ billetsOnHandG: kg(4_500), tailG: kg(339.6) });
    // The counted billets stay in stock under the cast; the press can still use them.
    const r2 = await p.countingRun({ pcs: 100 });
    await fillWorkedExample(p, r2.runId, c.id, { planLineId: r2.planLineIds[0] });
    await p.as("supervisor").press.runs.close({ id: r2.runId });
    const after = (await p.as("viewer").foundry.casts.get({ id: c.id })).closeout;
    expect(after).toMatchObject({ creditedG: kg(620.8), billetsOnHandG: kg(4_500) - kg(310.4), tailG: kg(339.6), adjustedG: -kg(339.6) });
    expect((await p.as("viewer").foundry.stock.billets()).casts.find((x) => x.castId === c.id)).toMatchObject({ onHandG: kg(4_500) - kg(310.4), status: "closed" });
  });

  test("r1 (I-1c) a run that used billets of TWO casts charges each cast its own billets (one ledger row per cast)", async () => {
    const p = await foundryPlant();
    const a = await castPressed(p);
    const lotB = await p.lot(8_000);
    const b = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const db = await p.as("foundry").foundry.melts.save(draft(p, b.id, lotB.id, { spectroReason: "Lab" }));
    await p.as("foundry").foundry.melts.lock({ meltId: db.id });
    const r = await p.countingRun({ pcs: 100 });
    await fillWorkedExample(p, r.runId, a.c.id, { planLineId: r.planLineIds[0] });
    await p.as("press").press.runs.billets({
      id: r.runId,
      castId: a.c.id,
      rows: [{ castId: a.c.id, count: 4, kgG: kg(155.2), lengthMm: 600 }, { castId: b.id, count: 4, kgG: kg(120), lengthMm: 600 }],
    });
    await p.as("supervisor").press.runs.close({ id: r.runId });
    const rows = (await ledgerOf(p.companyId, r.runId)).filter((x) => x.itemKind === "billet");
    expect(rows.map((x) => [x.itemRef, x.qtyG]).sort()).toEqual([[a.c.id, -kg(155.2)], [b.id, -kg(120)]].sort());
    expect((await p.as("viewer").foundry.casts.get({ id: a.c.id })).closeout).toMatchObject({ creditedG: kg(310.4) + kg(155.2), billetsOnHandG: kg(5_150) - kg(465.6) });
    expect((await p.as("viewer").foundry.casts.get({ id: b.id })).closeout).toMatchObject({ creditedG: kg(120), billetsOnHandG: kg(5_150) - kg(120), tailG: 0 });
    // Each closes on its own honest count: neither carries the other's billets.
    expect(await p.as("manager").foundry.casts.close({ castId: b.id, billetsOnHand: count(5_030) })).toMatchObject({ status: "closed", tailG: 0 });
  });

  test("r1 (I-1) the count finds MORE than the ledger: a reason, and a positive cast_tail row (sign follows counted − ledger)", async () => {
    const p = await foundryPlant();
    const { c } = await castPressed(p);
    await expect(p.as("manager").foundry.casts.close({ castId: c.id, billetsOnHand: count(4_850) })).rejects.toMatchObject({ message: `The count finds 10.4 kg more billets of ${c.number} than the ledger; pick a reason` });
    const out = await p.as("manager").foundry.casts.close({ castId: c.id, billetsOnHand: count(4_850), reasonCodeId: await tailCode(p, "other"), note: "Press over-weighed the run" });
    expect(out).toMatchObject({ status: "closed", tailG: -kg(10.4), adjustG: kg(10.4) });
    expect((await billetLedger(p.companyId, c.id)).filter((x) => x.voucherType === "cast_tail").map((x) => x.qtyG)).toEqual([kg(10.4)]);
    expect((await p.as("viewer").foundry.casts.get({ id: c.id })).closeout).toMatchObject({ billetsOnHandG: kg(4_850), tailG: -kg(10.4) });
  });

  test("D22 with a real run: the press logs more billets than the cast made → billets short, reason and approval", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(1_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const small = { inputs: [{ kind: "lot" as const, ref: lot.id, kgG: kg(305) }], logs: [{ pcs: 2, lengthMm: 6_000, kgG: kg(300) }], drossG: kg(4), feG: kg(1), chemicals: [], spectroReason: "Lab" };
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, small));
    await p.as("foundry").foundry.melts.lock({ meltId: d.id });
    const r = await p.countingRun({ pcs: 100 });
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    await p.as("supervisor").press.runs.close({ id: r.runId, clientMutationId: "close-short-01", billetShortReason: "Billets of cast 2 were mixed in" });
    expect((await p.as("viewer").foundry.casts.get({ id: c.id })).closeout).toMatchObject({ producedG: kg(300), creditedG: kg(310.4), billetsOnHandG: -kg(10.4), shortG: kg(10.4), tailG: 0, needsReason: true, needsApproval: true });
    await expect(p.as("manager").foundry.casts.close({ castId: c.id, billetsOnHand: count(0) })).rejects.toMatchObject({ message: expect.stringContaining("more billets") });
    const out = await p.as("manager").foundry.casts.close({ castId: c.id, billetsOnHand: count(0), reasonCodeId: await tailCode(p, "billets_short"), note: "Billets from cast 2 mixed in" });
    expect(out).toMatchObject({ status: "closing", shortG: kg(10.4) });
    expect(out.approvalId).toBeTruthy();
  });

  test("casts.cancel: an empty cast opened by mistake; refused once it has a melt", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const empty = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    await expect(p.as("foundry").foundry.casts.cancel({ castId: empty.id, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await p.as("manager").foundry.casts.cancel({ castId: empty.id, reason: "Opened twice" })).toMatchObject({ status: "cancelled" });
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id));
    await expect(p.as("manager").foundry.casts.cancel({ castId: c.id, reason: "x" })).rejects.toMatchObject({ message: expect.stringContaining("has melts") });
  });
});

// ---------------------------------------------------------------------------
// FP-FD-16/17/19/20: trace, cast on the label, yield, cost
// ---------------------------------------------------------------------------

describe("FD-16/17 trace and cast-on-label; FD-19 yield; FD-20 cost", () => {
  test("cast → lots in → spectro → billets → runs → bundles → customers, and the same chain from a bundle", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id));
    await pass(p, d.id);
    await p.as("foundry").foundry.melts.lock({ meltId: d.id });
    const r = await p.countingRun({ pcs: 100 });
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    await p.as("supervisor").press.runs.close({ id: r.runId });
    const rec = await p.owner.bundle.createReceipt({ dieId: r.sectionId, unit: "pcs", locationId: p.yard, castId: c.id, salesOrderLineId: r.salesOrderLineIds[0], rows: [{ quantity: 10, weightG: kg(30), lengthMm: 3_658 }] });
    const chain = await p.as("foundry").foundry.casts.trace({ castId: c.id });
    expect(chain.lotsIn).toEqual([expect.objectContaining({ lotId: lot.id, kgG: kg(5_000), gradeCode: "A" })]);
    expect(chain.melts[0]).toMatchObject({ id: d.id, spectroVerdict: "pass", furnaceCode: "F1" });
    expect(chain.billets).toMatchObject({ producedG: kg(5_150), creditedG: kg(310.4) });
    expect(chain.runs.map((x) => x.id)).toEqual([r.runId]);
    expect(chain.bundles).toHaveLength(1);
    expect(chain.customers).toEqual([expect.objectContaining({ customerId: p.customerId, bundles: 1, weightG: kg(30) })]);
    const fromBundle = await p.as("viewer").foundry.casts.traceBundle({ serial: rec.bundles[0]!.serial });
    expect(fromBundle.chain!.cast.id).toBe(c.id);
  });

  test("r1 (m-4): the trace shows the verdict the melt was LOCKED with beside the latest one", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { spectroReason: "Mg high; customer agreed" }));
    await p.as("foundry").foundry.spectro.enter({ meltId: d.id, valuesPpm: { si: 4_500, fe: 1_800, cu: 100, mn: 100, mg: 9_500, zn: 100, ti: 100, cr: 100 }, entryReason: "typed" });
    await p.as("foundry").foundry.melts.lock({ meltId: d.id });
    setClock(new Date(Date.now() + 60_000));
    await pass(p, d.id); // a later re-test passes
    const m = (await p.as("viewer").foundry.casts.trace({ castId: c.id })).melts[0]!;
    expect(m).toMatchObject({ spectroVerdict: "pass", lockSpectroVerdict: "fail" });
  });

  test("FD-16 automatic rule: once a melt is LOCKED (a draft is not enough) a receipt must name its cast", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const row = { quantity: 10, weightG: kg(30), lengthMm: 3_658 };
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { spectroReason: "Lab" }));
    // A draft posts nothing and does not switch the rule on.
    await expect(p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, rows: [row] })).resolves.toBeTruthy();
    await expect(p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, castId: c.id, rows: [row] })).rejects.toThrow("has no melt yet");
    await p.as("foundry").foundry.melts.lock({ meltId: d.id });
    await expect(p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, rows: [row] })).rejects.toThrow("Pick the cast these bundles came from");
    const ok = await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, castId: c.id, rows: [row] });
    expect((await env.db.select({ castId: bundle.castId }).from(bundle).where(eq(bundle.groupId, ok.groupId)))[0]!.castId).toBe(c.id);
  });

  test("FD-20 cost = Σ lot kg × rate (purchase readers only); FD-19 yield by day, alloy and furnace (reports.read)", async () => {
    const p = await foundryPlant();
    const lotA = await p.lot(4_000, 18_500);
    const lotB = await p.lot(4_000, 12_050);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const inputs = [
      { kind: "lot" as const, ref: lotA.id, kgG: kg(3_000) },
      { kind: "lot" as const, ref: lotB.id, kgG: kg(2_000) },
      { kind: "return_stream" as const, ref: p.stream("PLANT-SCRAP"), kgG: kg(300) },
    ];
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lotA.id, { inputs, spectroReason: "Lab" }));
    await p.as("foundry").foundry.melts.lock({ meltId: d.id });
    const cost = await p.as("office").foundry.casts.cost({ castId: c.id });
    expect(cost).toMatchObject({ lotsG: kg(5_000), streamsG: kg(300), producedG: kg(5_150), costPaise: 3_000 * 18_500 + 2_000 * 12_050 });
    expect(cost.perKgBilletPaise).toBe(Math.round(((3_000 * 18_500 + 2_000 * 12_050) * 1000) / kg(5_150)));
    await expect(p.as("foundry").foundry.casts.cost({ castId: c.id })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Use the same company production-day window as the report, not a UTC or calendar date.
    const today = (await productionDayWindowFor(env.db, p.companyId)).productionDay;
    const from = addDays(today, -3);
    const byAlloy = await p.as("manager").analytics.foundryYield({ from, to: today, groupBy: "alloy" });
    expect(byAlloy.rows).toEqual([expect.objectContaining({ key: "6063", melts: 1, inputG: kg(5_300), logsG: kg(5_150), yieldBp: Math.round((5_150 * 10_000) / 5_300), ldoTenthIn: 25 })]);
    // r1 (m-9): FP-FD-19 reads LDO per tonne OF LOGS: 25 tenths over 5.15 t = 4.85 → 5.
    expect(byAlloy.rows[0]!.ldoPerTonneTenthIn).toBe(Math.round((25 * 1_000_000) / kg(5_150)));
    expect((await p.as("manager").analytics.foundryYield({ from, to: today, groupBy: "furnace" })).rows[0]!.key).toBe("F1");
    expect((await p.as("manager").analytics.foundryYield({ from, to: today })).total.melts).toBe(1);
    await expect(p.as("foundry").analytics.foundryYield({ from, to: today })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------
// Furnace readings (FOUNDRY_SIMULATOR seam)
// ---------------------------------------------------------------------------

describe("furnace readings: typed always; simulate only behind FOUNDRY_SIMULATOR", () => {
  test("typed reading lands; simulate is FORBIDDEN while the seam is off and idempotent when on", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id));
    const at = Date.now() - 60_000;
    expect(await p.as("foundry").foundry.readings.add({ meltId: d.id, valueX10: 7_355, readAt: at })).toMatchObject({ added: true });
    // r1 (m-12): the same reading again (same melt, instant, source) is dropped, and so is its audit row.
    expect(await p.as("foundry").foundry.readings.add({ meltId: d.id, valueX10: 7_355, readAt: at })).toMatchObject({ added: false });
    expect((await audits(p.companyId)).filter((a) => a === "foundry.reading.add")).toHaveLength(1);
    await expect(p.as("foundry").foundry.readings.simulate({ meltId: d.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    workersEnv.FOUNDRY_SIMULATOR = "1";
    const first = await p.as("foundry").foundry.readings.simulate({ meltId: d.id });
    expect(first.readings).toBeGreaterThan(10);
    await p.as("foundry").foundry.readings.simulate({ meltId: d.id });
    const rows = await env.db.select().from(meltReading).where(eq(meltReading.meltId, d.id));
    expect(rows.filter((r) => r.source === "simulated")).toHaveLength(first.readings);
    expect(rows.filter((r) => r.source === "typed")).toHaveLength(1);
    const list = await p.as("viewer").foundry.readings.list({ meltId: d.id });
    expect(list.simulator).toBe(true);
    expect(Math.max(...list.items.map((i) => i.valueX10))).toBeLessThanOrEqual(7_700);
    await expect(p.as("press").foundry.readings.add({ meltId: d.id, valueX10: 7_000 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------
// Review round 2 (I-5, m-a..m-d) and test cases ported from the satellite's reference branch
// ---------------------------------------------------------------------------

/** A cast of `alloy` with one locked melt of `logsKg` kg of billets (spectro reason; 5 kg in to dross and Fe). */
async function smallCast(p: FoundryPlant, alloy: "6063" | "6061", logsKg: number) {
  const lot = await p.lot(logsKg + 1_000);
  const c = await p.as("foundry").foundry.casts.open({ alloy });
  const small = {
    inputs: [{ kind: "lot" as const, ref: lot.id, kgG: kg(logsKg + 5) }],
    logs: [{ pcs: 2, lengthMm: 6_000, kgG: kg(logsKg) }],
    drossG: kg(4),
    feG: kg(1),
    chemicals: [],
    spectroReason: "Lab",
  };
  const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, small));
  await p.as("foundry").foundry.melts.lock({ meltId: d.id });
  return c;
}

describe("r2 (I-5) a run's billets of another cast: same alloy only, and that cast's trace shows the run", () => {
  test("6061 billets on a 6063 run are refused (nothing saved); 6063 billets of another cast are taken", async () => {
    const p = await foundryPlant();
    const a = await castPressed(p);
    const b61 = await smallCast(p, "6061", 1_000);
    const b63 = await smallCast(p, "6063", 1_000);
    const r = await p.countingRun({ pcs: 100 });
    await fillWorkedExample(p, r.runId, a.c.id, { planLineId: r.planLineIds[0] });
    const before = await p.as("viewer").press.runs.get({ id: r.runId });
    await expect(
      p.as("press").press.runs.billets({ id: r.runId, castId: a.c.id, rows: [{ castId: a.c.id, count: 4, kgG: kg(155.2) }, { castId: b61.id, count: 4, kgG: kg(120) }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: `Billets of ${b61.number} are 6061; this run is 6063` });
    // The run's cast decides the alloy: naming the 6061 cast as the run's cast with 6063 rows is refused too.
    await expect(
      p.as("press").press.runs.billets({ id: r.runId, castId: b61.id, rows: [{ castId: b61.id, count: 4, kgG: kg(120) }, { castId: a.c.id, count: 4, kgG: kg(155.2) }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: `Billets of ${a.c.number} are 6063; this run is 6061` });
    const after = await p.as("viewer").press.runs.get({ id: r.runId });
    expect(after.billets.map((x) => [x.castId, x.kgG])).toEqual(before.billets.map((x) => [x.castId, x.kgG]));
    await expect(
      p.as("press").press.runs.billets({ id: r.runId, castId: a.c.id, rows: [{ castId: a.c.id, count: 4, kgG: kg(155.2) }, { castId: b63.id, count: 4, kgG: kg(120) }] }),
    ).resolves.toMatchObject({ success: true, rows: 2 });
  });

  test("casts.trace of the OTHER cast lists the run with the kg it took (mixed); the run's own cast shows its share", async () => {
    const p = await foundryPlant();
    const a = await castPressed(p);
    const b = await smallCast(p, "6063", 1_000);
    const r = await p.countingRun({ pcs: 100 });
    await fillWorkedExample(p, r.runId, a.c.id, { planLineId: r.planLineIds[0] });
    await p.as("press").press.runs.billets({ id: r.runId, castId: a.c.id, rows: [{ castId: a.c.id, count: 4, kgG: kg(155.2) }, { castId: b.id, count: 4, kgG: kg(120) }] });
    await p.as("supervisor").press.runs.close({ id: r.runId });
    const tb = await p.as("viewer").foundry.casts.trace({ castId: b.id });
    expect(tb.runs).toEqual([expect.objectContaining({ id: r.runId, billetG: kg(120), mixed: true, mainCast: false })]);
    expect(tb.billets).toMatchObject({ creditedG: kg(120) });
    const ta = await p.as("viewer").foundry.casts.trace({ castId: a.c.id });
    expect(ta.runs.map((x) => [x.id, x.billetG, x.mixed, x.mainCast])).toEqual([
      [a.r.runId, kg(310.4), false, true],
      [r.runId, kg(155.2), true, true],
    ]);
  });

  test("(m-b) a short on the other cast is that cast's billetsShortG, not the run's cast's", async () => {
    const p = await foundryPlant();
    const a = await castPressed(p);
    const b = await smallCast(p, "6063", 300);
    const r = await p.countingRun({ pcs: 100 });
    await fillWorkedExample(p, r.runId, a.c.id, { planLineId: r.planLineIds[0] });
    // B holds 300 kg; the run takes 400 kg of it: 100 kg short, all on B.
    await p.as("press").press.runs.billets({ id: r.runId, castId: a.c.id, rows: [{ castId: a.c.id, count: 4, kgG: kg(155.2) }, { castId: b.id, count: 10, kgG: kg(400) }] });
    await p.as("supervisor").press.runs.close({ id: r.runId, billetShortReason: "Billets of the next cast were mixed in" });
    expect((await p.as("viewer").foundry.casts.get({ id: b.id })).closeout).toMatchObject({ billetsShortG: kg(100), creditedG: kg(400), billetsOnHandG: -kg(100) });
    expect((await p.as("viewer").foundry.casts.get({ id: a.c.id })).closeout).toMatchObject({ billetsShortG: 0 });
  });
});

describe("r2 (m-c, m-d) a cast waiting for its close approval", () => {
  test("(m-c) the press is judged against the COUNT, not the uncorrected ledger: fewer counted → short recorded", async () => {
    const p = await foundryPlant();
    const c = await smallCast(p, "6063", 400);
    // Ledger 400 kg; the yard count finds 300 kg (25 %): closing, adjust −100 kg frozen.
    const out = await p.as("manager").foundry.casts.close({ castId: c.id, billetsOnHand: count(300), reasonCodeId: await tailCode(p, "scrapped") });
    expect(out).toMatchObject({ status: "closing", adjustG: -kg(100) });
    const r = await p.countingRun({ pcs: 100 });
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    // 310.4 kg used of the 300 kg counted: 10.4 kg short, so the close needs the reason.
    await expect(p.as("supervisor").press.runs.close({ id: r.runId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await p.as("supervisor").press.runs.close({ id: r.runId, billetShortReason: "Count was low" })).toMatchObject({ status: "logged" });
    expect((await p.as("viewer").foundry.casts.get({ id: c.id })).closeout).toMatchObject({ billetsShortG: kg(10.4) });
    await p.as("owner").approval.decide({ id: out.approvalId!, decision: "approved" });
    // After the approval the ledger agrees: counted 300 − pressed 310.4 = −10.4 kg = the recorded short.
    expect((await p.as("viewer").foundry.casts.get({ id: c.id })).closeout).toMatchObject({ billetsOnHandG: -kg(10.4), billetsShortG: kg(10.4) });
  });

  test("(m-c) more counted than the ledger: the press may use them, with no false short and no write-time refusal", async () => {
    const p = await foundryPlant();
    const c = await smallCast(p, "6063", 300);
    // Ledger 300 kg; the count finds 320 kg (+6.7 %): closing, adjust +20 kg frozen.
    const out = await p.as("manager").foundry.casts.close({ castId: c.id, billetsOnHand: count(320), reasonCodeId: await tailCode(p, "other"), note: "Two logs were on the rack" });
    expect(out).toMatchObject({ status: "closing", adjustG: kg(20) });
    const r = await p.countingRun({ pcs: 100 });
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    expect(await p.as("supervisor").press.runs.close({ id: r.runId })).toMatchObject({ status: "logged" });
    expect((await p.as("viewer").foundry.casts.get({ id: c.id })).closeout).toMatchObject({ billetsShortG: 0 });
    await p.as("owner").approval.decide({ id: out.approvalId!, decision: "approved" });
    expect((await p.as("viewer").foundry.casts.get({ id: c.id })).closeout).toMatchObject({ billetsOnHandG: kg(320) - kg(310.4) });
  });

  test("(m-d) the approval never posts the count at a retired billet store: refused with a reason; the cast keeps waiting", async () => {
    const p = await foundryPlant();
    const { c } = await castPressed(p);
    const out = await p.as("manager").foundry.casts.close({ castId: c.id, billetsOnHand: count(4_500), reasonCodeId: await tailCode(p, "scrapped") });
    expect(out.status).toBe("closing");
    await env.db.update(location).set({ active: false }).where(eq(location.id, p.billetStoreId));
    await expect(p.as("owner").approval.decide({ id: out.approvalId!, decision: "approved" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "The billet store BILLET is retired; reactivate it to post the count, or reject the close",
    });
    expect((await env.db.select({ status: cast.status }).from(cast).where(eq(cast.id, c.id)))[0]!.status).toBe("closing");
    expect((await env.db.select({ status: approval.status }).from(approval).where(eq(approval.id, out.approvalId!)))[0]!.status).toBe("pending");
    expect((await billetLedger(p.companyId, c.id)).filter((x) => x.voucherType === "cast_tail")).toEqual([]);
    await env.db.update(location).set({ active: true }).where(eq(location.id, p.billetStoreId));
    await p.as("owner").approval.decide({ id: out.approvalId!, decision: "approved" });
    expect((await billetLedger(p.companyId, c.id)).filter((x) => x.voucherType === "cast_tail").map((x) => x.qtyG)).toEqual([-kg(339.6)]);
  });
});

/** 6061 seeded limits (spec E4): every element inside. */
const PASS_6061 = { si: 6_000, fe: 3_000, cu: 2_500, mn: 500, mg: 10_000, zn: 500, ti: 500, cr: 2_000 };

describe("r2 (m-a) a spectro result judged for another alloy does not count", () => {
  // Also ported: wt/W2-FD-S-omafranky @ddf3bd9c, fd-w2-lock.test.ts "a pass judged for 6063 does not
  // stand once the draft is retargeted to 6061" (this branch drops the verdict and asks for a new sample).
  test("a correction copy keeps its pass until its alloy changes; then the pass is dropped: a new sample or a reason", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id));
    await pass(p, d.id);
    await p.as("foundry").foundry.melts.lock({ meltId: d.id });
    const code = (await p.as("viewer").reasonCodes.list({ kind: "melt_correct" })).find((r) => r.code === "wrong_weight")!.id;
    const { approvalId } = await p.as("foundry").foundry.melts.requestCorrection({ meltId: d.id, reasonCodeId: code });
    await p.as("manager").approval.decide({ id: approvalId, decision: "approved" });
    const out = await p.as("foundry").foundry.melts.correct({ meltId: d.id });
    expect(await p.as("foundry").foundry.melts.preview({ meltId: out.draftId })).toMatchObject({ spectroVerdict: "pass", spectroNeedsNewSample: false });
    const a6061 = (await p.as("viewer").foundry.alloys.list()).items.find((x) => x.code === "6061")!.id;
    const re = await p.as("foundry").foundry.melts.save({ ...draft(p, c.id, lot.id), meltId: out.draftId, alloyId: a6061, alloyReason: "Customer wants 6061" });
    expect(re).toMatchObject({ spectroVerdict: null, spectroNeedsNewSample: true });
    expect(re.gates).toContain("spectro_reason_missing");
    await expect(p.as("foundry").foundry.melts.lock({ meltId: out.draftId })).rejects.toMatchObject({ message: "Spectro has not passed; say why the melt is locked anyway" });
    // The stored result keeps the verdict it was judged by (6063).
    expect((await env.db.select().from(spectroResult).where(eq(spectroResult.meltId, out.draftId)))[0]).toMatchObject({ verdict: "pass" });
    // A new sample judged for 6061 clears it.
    await p.as("foundry").foundry.spectro.enter({ meltId: out.draftId, valuesPpm: PASS_6061, entryReason: "Spectro PC offline" });
    expect(await p.as("foundry").foundry.melts.preview({ meltId: out.draftId })).toMatchObject({ spectroVerdict: "pass", spectroNeedsNewSample: false });
    expect(await p.as("foundry").foundry.melts.lock({ meltId: out.draftId })).toMatchObject({ status: "locked", spectroVerdict: "pass" });
  });
});

describe("W2-FD-N review m-4: a photo of the printout never replaces the numbers that decide", () => {
  const jpeg = Buffer.from("fake-jpeg-bytes").toString("base64");
  const photo = (p: FoundryPlant, meltId: string) => p.as("foundry").foundry.spectro.attach({ meltId, fileName: "spectro-1.jpg", mime: "image/jpeg", base64: jpeg, values: {} });

  test("typed pass, then a photo-only result: the photo is stored as incomplete, the pass still decides, Lock needs no reason", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { chemicals: [] }));
    await pass(p, d.id);
    const photoRow = await photo(p, d.id);
    expect(photoRow.verdict).toBe("incomplete");
    const stored = await env.db.select().from(spectroResult).where(eq(spectroResult.meltId, d.id));
    expect(stored.map((r) => r.verdict).sort()).toEqual(["incomplete", "pass"]);
    // The photo is the newest row, yet the preview and the gates read the typed pass.
    const view = await p.as("foundry").foundry.melts.preview({ meltId: d.id });
    expect(view).toMatchObject({ spectroVerdict: "pass", spectroNeedsNewSample: false });
    expect(view.gates).not.toContain("spectro_reason_missing");
    expect(await p.as("foundry").foundry.melts.lock({ meltId: d.id })).toMatchObject({ status: "locked", spectroVerdict: "pass" });
  });

  test("a photo alone still never passes: with no numbers on the melt the photo is the result and Lock asks for a reason", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { chemicals: [] }));
    await photo(p, d.id);
    const view = await p.as("foundry").foundry.melts.preview({ meltId: d.id });
    expect(view.spectroVerdict).toBe("incomplete");
    expect(view.gates).toContain("spectro_reason_missing");
  });

  test("numbers typed after the photo are newer and decide; a typed fail is not hidden by a later photo", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { chemicals: [] }));
    await photo(p, d.id);
    await p.as("foundry").foundry.spectro.enter({ meltId: d.id, valuesPpm: { si: 4_500, fe: 4_100, cu: 100, mn: 100, mg: 5_200, zn: 100, ti: 100, cr: 100 }, entryReason: "Printer down" });
    await photo(p, d.id);
    expect(await p.as("foundry").foundry.melts.preview({ meltId: d.id })).toMatchObject({ spectroVerdict: "fail" });
  });

  test("the lock race guard reads the same deciding result: a photo attached after the lock read it does not stop the lock", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { chemicals: [] }));
    await pass(p, d.id);
    env.beforeNextBatch(() => photo(p, d.id));
    expect(await p.as("foundry").foundry.melts.lock({ meltId: d.id })).toMatchObject({ status: "locked", spectroVerdict: "pass" });
  });
});

describe("ported from the satellite's reference branch (wt/W2-FD-S-omafranky @ddf3bd9c, fd-w2-lock.test.ts)", () => {
  // Port of "RACE: the passing result is voided after the lock read it — the lock refuses and the draft stays a draft".
  test("RACE: the passing result is voided after the lock read it — the lock refuses, nothing posts", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { chemicals: [] }));
    const s = await pass(p, d.id);
    env.beforeNextBatch(() => p.as("supervisor").foundry.spectro.void({ id: s.id, reason: "Wrong sample" }));
    await expect(p.as("foundry").foundry.melts.lock({ meltId: d.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "The spectro result changed; check it and lock again" });
    expect((await env.db.select({ status: melt.status }).from(melt).where(eq(melt.id, d.id)))[0]!.status).toBe("draft");
    expect((await ledgerOf(p.companyId, d.id)).filter((x) => x.voucherType === "melt")).toEqual([]);
  });

  // Port of "RACE: a failing result is attached after the lock read a pass — the lock refuses".
  test("RACE: a failing result is attached after the lock read a pass — the lock refuses", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { chemicals: [] }));
    await pass(p, d.id);
    env.beforeNextBatch(() =>
      p.as("supervisor").foundry.spectro.enter({ meltId: d.id, valuesPpm: { si: 4_500, fe: 4_100, cu: 100, mn: 100, mg: 5_200, zn: 100, ti: 100, cr: 100 }, entryReason: "Re-test" }),
    );
    await expect(p.as("foundry").foundry.melts.lock({ meltId: d.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await env.db.select({ status: melt.status }).from(melt).where(eq(melt.id, d.id)))[0]!.status).toBe("draft");
  });

  // Port of "RACE: two locks of one draft — one posts, the other is a CONFLICT and posts nothing" (this branch refuses with not_draft).
  test("RACE: two locks of one draft — one posts once, the other is refused and posts nothing", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { spectroReason: "Lab", chemicals: [] }));
    env.beforeNextBatch(() => p.as("supervisor").foundry.melts.lock({ meltId: d.id }));
    await expect(p.as("foundry").foundry.melts.lock({ meltId: d.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "This melt is already locked" });
    const rows = (await ledgerOf(p.companyId, d.id)).filter((x) => x.voucherType === "melt");
    expect(rows).toHaveLength(5); // 2 inputs, logs, dross, Fe: once
    expect((await env.db.select({ status: melt.status, lockedBy: melt.lockedBy }).from(melt).where(eq(melt.id, d.id)))[0]).toMatchObject({ status: "locked", lockedBy: p.users.supervisor.id });
  });

  // Port of "stock.billets totals by alloy cover every cast, not just the page".
  test("stock.billets totals by alloy (and the total) cover every cast, not just the page", async () => {
    const p = await foundryPlant();
    await smallCast(p, "6063", 1_000);
    await smallCast(p, "6061", 700);
    const page = await p.as("viewer").foundry.stock.billets({ limit: 1 });
    expect(page.casts).toHaveLength(1);
    expect(page.byAlloy).toEqual([
      { alloy: "6061", casts: 1, onHandG: kg(700) },
      { alloy: "6063", casts: 1, onHandG: kg(1_000) },
    ]);
    expect(page.totalG).toBe(kg(1_700));
  });

  // Port of "a plant that turned requireCastOnBundle off keeps it off after the first lock".
  test("a plant that turned requireCastOnBundle off keeps it off after the first lock", async () => {
    const p = await foundryPlant();
    await p.owner.company.updateSettings({ requireCastOnBundle: false });
    await smallCast(p, "6063", 500);
    expect((await p.owner.company.getSettings()).requireCastOnBundle).toBe(false);
    await expect(p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, rows: [{ quantity: 10, weightG: kg(30), lengthMm: 3_658 }] })).resolves.toBeTruthy();
  });

  // Port of "FD-16: the public QR of a bundle with a cast still says only { number, section }".
  test("FD-16: the public QR of a bundle with a cast still says only { number, section }", async () => {
    const p = await foundryPlant();
    const c = await smallCast(p, "6063", 500);
    await p.owner.company.updateSettings({ bundleNumbering: "plant" });
    const dieId = await env.seedDie(p.companyId, { series: "DOMAL", sectionCode: "12170" });
    const [b] = await env.seedBundles(p.companyId, dieId, 1);
    await env.db.update(bundle).set({ castId: c.id, serial: "26J4086" }).where(and(eq(bundle.id, b!.id), eq(bundle.companyId, p.companyId)));
    const [co] = await env.db.select({ slug: company.slug }).from(company).where(eq(company.id, p.companyId));
    const res = await env.caller(null).resolve.publicBundle({ code: "26J4086", companyHost: co!.slug });
    expect(Object.keys(res).sort()).toEqual(["number", "section"]);
    expect(JSON.stringify(res)).not.toContain(c.number);
  });

  // Port of "a lot cancel is refused once a LOCKED melt cites the lot, never because of a draft".
  test("a lot cancel is refused once a LOCKED melt cites the lot, never because of a draft", async () => {
    const p = await foundryPlant();
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const drafted = await p.lot(8_000);
    await p.as("foundry").foundry.melts.save(draft(p, c.id, drafted.id));
    await expect(p.as("manager").purchase.lots.cancel({ id: drafted.id, reason: "Wrong party" })).resolves.toMatchObject({ status: "cancelled" });
    const locked = await p.lot(8_000);
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, locked.id, { spectroReason: "Lab", chemicals: [] }));
    await p.as("foundry").foundry.melts.lock({ meltId: d.id });
    await expect(p.as("manager").purchase.lots.cancel({ id: locked.id, reason: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// FINAL-FIXES-4: FD-02 (book number + legacy code), FD-19 (kg in by stream)
// ---------------------------------------------------------------------------

describe("FINAL-FIXES-4 FD-02: a legacy code on an imported cast, and the cast book's start number", () => {
  test("open takes an optional legacy code: stored upper-case, unique per plant, shown by list/get/trace, found by the trace search", async () => {
    const p = await foundryPlant();
    const a = await p.as("foundry").foundry.casts.open({ alloy: "6063", legacyCode: " old-17/b " });
    const plain = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const listed = await p.as("viewer").foundry.casts.list({});
    expect(listed.items.find((x) => x.id === a.id)).toMatchObject({ legacyCode: "OLD-17/B" });
    expect(listed.items.find((x) => x.id === plain.id)).toMatchObject({ legacyCode: null });
    expect((await p.as("viewer").foundry.casts.get({ id: a.id })).cast.legacyCode).toBe("OLD-17/B");
    expect((await p.as("viewer").foundry.casts.trace({ castId: a.id })).cast.legacyCode).toBe("OLD-17/B");
    // The same box that finds K31 finds the paper code, any case.
    const found = await p.as("viewer").foundry.casts.list({ number: "old-17/b" });
    expect(found.items.map((x) => x.id)).toEqual([a.id]);
    expect((await p.as("viewer").foundry.casts.list({ number: a.number })).items.map((x) => x.id)).toContain(a.id);
    // A second cast cannot take the same paper code; the refusal names it.
    await expect(p.as("foundry").foundry.casts.open({ alloy: "6063", legacyCode: "OLD-17/B" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("OLD-17/B") });
    // Characters outside letters, digits, space and - / . _ are refused.
    await expect(p.as("foundry").foundry.casts.open({ alloy: "6063", legacyCode: "<b>" })).rejects.toThrow();
    // A double tap with the same request id returns the first cast (the code is not a second cast).
    const r1 = await p.as("foundry").foundry.casts.open({ alloy: "6063", legacyCode: "OLD-18", clientRequestId: "fd02-0001" });
    const r2 = await p.as("foundry").foundry.casts.open({ alloy: "6063", legacyCode: "OLD-18", clientRequestId: "fd02-0001" });
    expect(r2.id).toBe(r1.id);
    // The code is the plant's own: another plant may use the same paper code.
    const q = await foundryPlant();
    await expect(q.as("foundry").foundry.casts.open({ alloy: "6063", legacyCode: "OLD-17/B" })).resolves.toBeTruthy();
    // Opening wrote the code into the audit meta.
    const rows = await env.db.select({ meta: auditLog.meta }).from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "cast.open")));
    expect(JSON.stringify(rows.map((r) => r.meta))).toContain("OLD-17/B");
  });

  test("setSeriesStart (masters.publish) continues the book in a month with no cast yet, audited, and refuses a month that has one", async () => {
    const p = await foundryPlant();
    const next = new Date(Date.now() + 70 * 86_400_000);
    const period = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
    await expect(p.as("foundry").foundry.casts.setSeriesStart({ start: { period, start: 120 } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("manager").foundry.casts.setSeriesStart({ start: { period, start: 120 } })).resolves.toMatchObject({ start: { period, start: 120 } });
    expect((await p.owner.company.getSettings()).castSeriesStart).toEqual({ period, start: 120 });
    expect(await audits(p.companyId)).toContain("foundry.castSeries.set");
    // A cast opened in that month takes the book's number.
    setClock(new Date(`${period}-10T06:00:00Z`));
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    expect(c.number).toMatch(/^[A-L]120$/);
    // That month now has a cast: the book can no longer be moved there.
    await expect(p.as("manager").foundry.casts.setSeriesStart({ start: { period, start: 5 } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Clear it again for a month with no cast.
    await expect(p.as("manager").foundry.casts.setSeriesStart({ start: null })).resolves.toMatchObject({ start: null });
    expect((await p.owner.company.getSettings()).castSeriesStart).toBeNull();
    await expect(p.as("manager").foundry.casts.setSeriesStart({ start: { period: "2026-13", start: 1 } })).rejects.toThrow();
  });
});

describe("FINAL-FIXES-4 FD-11: an attached spectro file can be found again from the trace", () => {
  test("casts.trace melts name the newest live file (id, name); spectro.file returns it to any member; a voided or file-less result names none", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { chemicals: [] }));
    expect((await p.as("viewer").foundry.casts.trace({ castId: c.id })).melts[0]!.spectroFile).toBeNull();
    await pass(p, d.id);
    expect((await p.as("viewer").foundry.casts.trace({ castId: c.id })).melts[0]!.spectroFile).toBeNull();
    const jpeg = Buffer.from("not-really-a-jpeg").toString("base64");
    const file = await p.as("foundry").foundry.spectro.attach({ meltId: d.id, fileName: "K-1.jpg", mime: "image/jpeg", base64: jpeg, values: {} });
    const m = (await p.as("viewer").foundry.casts.trace({ castId: c.id })).melts[0]!;
    expect(m.spectroFile).toEqual({ id: file.id, fileName: "K-1.jpg" });
    const listed = (await p.as("viewer").foundry.casts.get({ id: c.id })).melts[0]!.spectro;
    expect(listed.map((r) => [r.id === file.id, r.hasFile]).sort()).toEqual([[false, false], [true, true]]);
    expect(await p.as("viewer").foundry.spectro.file({ id: file.id })).toMatchObject({ id: file.id, fileName: "K-1.jpg", mime: "image/jpeg", base64: jpeg });
    await p.as("supervisor").foundry.spectro.void({ id: file.id, reason: "Wrong sample" });
    expect((await p.as("viewer").foundry.casts.trace({ castId: c.id })).melts[0]!.spectroFile).toBeNull();
  });
});

describe("FINAL-FIXES-4 FD-19: yield report kg in by return stream", () => {
  test("foundryYield returns byStream (kg charged from each return stream) and per-group lots / streams kg in", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { spectroReason: "Lab" }));
    await p.as("foundry").foundry.melts.lock({ meltId: d.id });
    const today = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const from = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const y = await p.as("manager").analytics.foundryYield({ from, to: today, groupBy: "alloy" });
    expect(y.byStream).toEqual([expect.objectContaining({ returnStreamId: p.stream("PLANT-SCRAP"), code: "PLANT-SCRAP", kgG: kg(300) })]);
    expect(y.rows[0]).toMatchObject({ key: "6063", lotsG: kg(5_000), streamsG: kg(300) });
    expect(y.total).toMatchObject({ lotsG: kg(5_000), streamsG: kg(300), inputG: kg(5_300) });
    // A day with no melts has none.
    const none = await p.as("manager").analytics.foundryYield({ from: "2020-01-01", to: "2020-01-02" });
    expect(none.byStream).toEqual([]);
    expect(none.total).toMatchObject({ lotsG: 0, streamsG: 0 });
  });
});
