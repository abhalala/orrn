/**
 * W2-FD-S foundry server (spec E4, FP-FD-01..20): masters, the melt stepper (draft → lock), lock
 * gates, correction by approval, spectro verdicts, the cast close after a REAL logged press run
 * (BACKLOG 55: castPressReturnsSql returned 0), billet stock, trace, cost, yield, the furnace
 * readings seam and cast-on-label enforcement once a melt is locked.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { approval, auditLog, bundle, cast, melt, meltChemical, meltInput, meltReading, spectroResult, stockLedger, storeTxn } from "@orrn/db/schema";

import { can as canMe, type Action } from "../src/lib/permissions";
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
  return { ...p, lot, stream: (code: string) => streams.find((s) => s.code === code)!.id, fluxId, times };
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
    await expect(p.as("manager").foundry.casts.close({ castId: c.id })).rejects.toMatchObject({ message: expect.stringContaining("not locked") });
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
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { spectroReason: "Lab" }));
    await p.as("foundry").foundry.melts.lock({ meltId: d.id });
    await expect(p.as("foundry").foundry.melts.correct({ meltId: d.id })).rejects.toMatchObject({ message: expect.stringContaining("Ask for a correction first") });
    const code = (await p.as("viewer").reasonCodes.list({ kind: "melt_correct" })).find((r) => r.code === "wrong_weight")!.id;
    const { approvalId } = await p.as("foundry").foundry.melts.requestCorrection({ meltId: d.id, reasonCodeId: code, note: "Logs were 5,105 kg" });
    await expect(p.as("foundry").foundry.melts.requestCorrection({ meltId: d.id, reasonCodeId: code })).rejects.toMatchObject({ message: expect.stringContaining("waiting") });
    await expect(p.as("foundry").approval.decide({ id: approvalId, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.as("manager").approval.decide({ id: approvalId, decision: "approved" });
    const out = await p.as("foundry").foundry.melts.correct({ meltId: d.id, clientMutationId: "correct-0001" });
    const reversed = (await ledgerOf(p.companyId, d.id)).filter((r) => r.voucherType === "melt_cancel");
    expect(reversed.length).toBe((await ledgerOf(p.companyId, d.id)).filter((r) => r.voucherType === "melt").length);
    expect((await env.db.select().from(storeTxn).where(eq(storeTxn.companyId, p.companyId))).filter((t) => t.cancelledAt)).toHaveLength(1);
    const [copy] = await env.db.select().from(melt).where(eq(melt.id, out.draftId));
    expect(copy).toMatchObject({ status: "draft", seq: 2, correctsMeltId: d.id, inputG: kg(5_300) });
    expect(await env.db.select().from(meltInput).where(eq(meltInput.meltId, out.draftId))).toHaveLength(2);
    expect((await env.db.select({ meta: approval.meta }).from(approval).where(eq(approval.id, approvalId)))[0]!.meta).toMatchObject({ draftId: out.draftId });
    // The grant is used once; a retry answers the first correction.
    expect(await p.as("foundry").foundry.melts.correct({ meltId: d.id, clientMutationId: "correct-0001" })).toEqual(out);
    // Fix the weight and lock the copy.
    await p.as("foundry").foundry.melts.save({ ...draft(p, c.id, lot.id, { spectroReason: "Lab" }), meltId: out.draftId, logs: [{ pcs: 20, lengthMm: 6_000, kgG: kg(5_105) }] });
    expect(await p.as("foundry").foundry.melts.lock({ meltId: out.draftId })).toMatchObject({ logsG: kg(5_105) });
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
    const part = await f.attach({ meltId: d.id, fileName: "K.csv", mime: "text/csv", base64: "", values: { Si: 0.45, Mg: 0.52 } });
    expect(part.verdict).toBe("incomplete");
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
  test("billets − press used − on hand = 0: the cast closes with no reason; a reopen puts the billets back in the sum", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { spectroReason: "Lab" }));
    await p.as("foundry").foundry.melts.lock({ meltId: d.id });
    const r = await p.countingRun({ pcs: 100 });
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    await p.as("supervisor").press.runs.close({ id: r.runId });
    const co = (await p.as("viewer").foundry.casts.get({ id: c.id })).closeout;
    expect(co).toMatchObject({ producedG: kg(5_150), creditedG: kg(310.4), billetsOnHandG: kg(5_150) - kg(310.4), tailG: 0, needsReason: false, needsApproval: false });
    const stock = await p.as("viewer").foundry.stock.billets();
    expect(stock.casts.find((x) => x.castId === c.id)).toMatchObject({ onHandG: kg(5_150) - kg(310.4), alloy: "6063" });
    expect(stock.byAlloy.find((a) => a.alloy === "6063")!.onHandG).toBeGreaterThanOrEqual(kg(5_150) - kg(310.4));
    expect(await p.as("manager").foundry.casts.close({ castId: c.id })).toMatchObject({ status: "closed", tailG: 0, approvalId: null });
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
    await expect(p.as("manager").foundry.casts.close({ castId: c.id })).rejects.toMatchObject({ message: expect.stringContaining("more billets") });
    const out = await p.as("manager").foundry.casts.close({ castId: c.id, reasonCodeId: await tailCode(p, "billets_short"), note: "Billets from cast 2 mixed in" });
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

    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const byAlloy = await p.as("manager").analytics.foundryYield({ from, to: today, groupBy: "alloy" });
    expect(byAlloy.rows).toEqual([expect.objectContaining({ key: "6063", melts: 1, inputG: kg(5_300), logsG: kg(5_150), yieldBp: Math.round((5_150 * 10_000) / 5_300), ldoTenthIn: 25 })]);
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
    await p.as("foundry").foundry.readings.add({ meltId: d.id, valueX10: 7_355 });
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
