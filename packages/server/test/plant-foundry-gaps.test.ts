/**
 * PL5 tests review (mutation lens), round 0: tests for the guards whose removal left
 * test/plant-foundry.test.ts green (coord/reviews/PL5-tests-r0.md), adopted as-is in PL-5 fix
 * round 1. Behaviour fixes of that round are tested in plant-foundry-fixes.test.ts.
 *
 * Each test name starts with the mutant ids it kills, in square brackets (the mutants are in
 * PL5-tests-r0-mutants.py). 83 tests, all pass on c3918d7; each id was checked to FAIL when its
 * mutant is applied to a scratch copy (130 of the 135 ids tagged here; the other five, R38, R79,
 * R92, R158, R213, are equivalent mutants that the review lists as redundant guards).
 *
 * Note for authors: bun's `toMatchObject` treats two different Dates as a match. Compare
 * `date.getTime()` (as the stored-times test below does) or use `toEqual`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import {
  approval,
  auditLog,
  bundle,
  cast,
  melt,
  meltChemical,
  meltInput,
  meltOutput,
  purchaseLot,
  scrapGrade,
  scrapItem,
  spectroResult,
  stockLedger,
  storeTxn,
} from "@orrn/db/schema";
import { and, eq, inArray } from "drizzle-orm";

import { can as canMe, type Action } from "../src/lib/permissions";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;
let setClock: (at: Date | null) => void;

setDefaultTimeout(60_000);

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
});
afterEach(() => setClock(null));
afterAll(async () => {
  await env.dispose();
});

const can = (role: CompanyRole, action: Action) =>
  canMe({ company: { role }, isPlatformAdmin: false, platformRole: null }, action);

const ROLES: CompanyRole[] = [
  "owner", "admin", "manager", "office", "accountant", "supervisor", "packer",
  "foundry", "press", "storekeeper", "die_room", "operator", "viewer",
];

const KG = 1000;
const U = 1000;
const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 3, 2, 0, 0);
const NOW = new Date(T0 + 10 * H);

function times(t0 = T0) {
  return { preheatStart: t0, chargingStart: t0 + H, chargingEnd: t0 + 3 * H, castingStart: t0 + 4 * H, castingEnd: t0 + 6 * H };
}

async function plant() {
  setClock(NOW);
  const { companyId, users } = await env.seedCompany();
  const callers = Object.fromEntries(ROLES.map((role) => [role, env.caller({ role, companyId })])) as Record<
    CompanyRole,
    ReturnType<typeof env.caller>
  >;
  await callers.owner.stock.locations.seedDefaults();
  await callers.manager.purchase.seedScrapDefaults();
  await callers.manager.foundry.returnStreams.seedDefaults();
  const items = (await callers.manager.purchase.scrapItems.list()).items;
  const v = await callers.manager.vendor.create({ name: "Shree Ganesh Metals" });
  const streams = (await callers.viewer.foundry.returnStreams.list()).items;
  const stream = (code: string) => streams.find((s) => s.code === code)!.id;
  const fluxId = (await callers.storekeeper.store.items.create({ name: "Cover flux", unit: "kg", category: "chemical" })).id;
  const ldoId = (await callers.storekeeper.store.items.create({ name: "LDO", unit: "litre", category: "fuel" })).id;
  await callers.storekeeper.store.receive({ itemId: fluxId, qtyMilli: 100 * U });
  await callers.storekeeper.store.receive({ itemId: ldoId, qtyMilli: 1_000 * U });
  const locs = (await callers.owner.stock.locations.list()).items;
  const loc = (code: string) => locs.find((l) => l.code === code)!.id;
  return {
    companyId,
    users,
    ...callers,
    vendorId: v.id,
    itemId: items.find((i) => i.name === "IMP BELLING")!.id,
    cableId: items.find((i) => i.name === "SOFT CABLE")!.id,
    stream,
    fluxId,
    ldoId,
    loc,
  };
}
type Plant = Awaited<ReturnType<typeof plant>>;

async function okLot(p: Plant, kg: number, over: { itemId?: string; grade?: string; date?: string } = {}) {
  const lot = await p.storekeeper.purchase.lots.create({
    vendorId: p.vendorId,
    date: over.date ?? "2026-10-01",
    origin: "LOCAL",
    itemId: over.itemId ?? p.itemId,
    grade: over.grade ?? "A",
    partyKgG: kg * KG,
    fcKgG: kg * KG,
    ratePaise: 18_500,
    billBook: "main",
  });
  await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" });
  return lot;
}

async function openCast(p: Plant, alloy: "6063" | "6061" = "6063") {
  return p.foundry.foundry.casts.open({ alloy });
}

type MeltInput = Parameters<Plant["foundry"]["foundry"]["melts"]["create"]>[0];

/** 10,000 kg of lot + 1,000 kg plant scrap in; 10,450 logs, 200 dross, 20 Fe, 50 returned out (loss 2.55 %). */
function meltPayload(castId: string, lotId: string, p: Plant, over: Partial<MeltInput> = {}): MeltInput {
  return {
    castId,
    timestamps: times(),
    ldoTenthIn: { start: 480, end: 455 },
    inputs: [
      { kind: "lot", ref: lotId, kgG: 10_000 * KG },
      { kind: "return_stream", ref: p.stream("PLANT-SCRAP"), kgG: 1_000 * KG },
    ],
    chemicals: [
      { storeItemId: p.fluxId, openMilli: 20 * U, usedMilli: 12 * U, closeMilli: 8 * U },
      { name: "Grain refiner", unit: "kg", openMilli: 5 * U, usedMilli: 2 * U, closeMilli: 3 * U },
    ],
    outputs: {
      logs: { pcs: 38, lengthMm: 6_000, kgG: 10_450 * KG },
      drossG: 200 * KG,
      feG: 20 * KG,
      returns: [{ streamId: p.stream("PLANT-SCRAP"), kgG: 50 * KG }],
    },
    ...over,
  };
}

/** One lot line in, logs only out: no streams, no chemicals, no dross. */
function simpleMelt(castId: string, lotId: string, p: Plant, inKg: number, logsKg: number, over: Partial<MeltInput> = {}): MeltInput {
  return meltPayload(castId, lotId, p, {
    inputs: [{ kind: "lot", ref: lotId, kgG: inKg * KG }],
    chemicals: [],
    outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: logsKg * KG }, drossG: 0, feG: 0, returns: [] },
    ...over,
  });
}

async function ledger(companyId: string, filter: { voucherType?: string; voucherId?: string; itemKind?: string } = {}) {
  const rows = await env.db.select().from(stockLedger).where(eq(stockLedger.companyId, companyId));
  return rows.filter(
    (r) =>
      (!filter.voucherType || r.voucherType === filter.voucherType) &&
      (!filter.voucherId || r.voucherId === filter.voucherId) &&
      (!filter.itemKind || r.itemKind === filter.itemKind),
  );
}
const sum = (rows: { qtyG: number }[]) => rows.reduce((s, r) => s + r.qtyG, 0);
async function castRow(id: string) {
  return (await env.db.select().from(cast).where(eq(cast.id, id)))[0]!;
}
async function meltsOf(companyId: string) {
  return env.db.select().from(melt).where(eq(melt.companyId, companyId));
}
async function remainingOf(p: Plant, lotId: string) {
  const { lots } = await p.foundry.foundry.lots.available();
  return lots.find((l) => l.id === lotId)?.remainingG ?? 0;
}
/**
 * Billets of the cast leaving (negative) or entering the billet store outside the melts. `move` is
 * not the press: under the W2-FD-S rule it is the tail; `press_run` is billets the press used.
 */
async function moveBillets(p: Plant, castId: string, qtyG: number, voucherType: "move" | "press_run" = "move") {
  await env.db.insert(stockLedger).values({
    id: crypto.randomUUID(), companyId: p.companyId, serverSeq: 0, voucherType, voucherId: crypto.randomUUID(),
    line: 1, itemKind: "billet", itemRef: castId, locationId: p.loc("BILLET"), qtyG, postedAt: new Date(),
  });
}

/** The company's `cast_tail` reason code by its stable key. */
async function tailCode(p: Plant, code: string) {
  return (await p.viewer.reasonCodes.list({ kind: "cast_tail" })).find((r) => r.code === code)!.id;
}

// ---------------------------------------------------------------------------
// Domain edges
// ---------------------------------------------------------------------------

describe("[D06,D08] melt balance edges through the API", () => {
  test("out == in: no warning and no burn; a melt with nothing out at all lands (loss_high + no_logs)", async () => {
    const p = await plant();
    const lot = await okLot(p, 30_000);
    const c = await openCast(p);
    const even = await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 1_000));
    expect(even).toMatchObject({ lossG: 0, balanceBp: 0, allowedBurnG: 0, warnings: [] });
    const empty = await p.foundry.foundry.melts.create({
      ...simpleMelt(c.id, lot.id, p, 1_000, 0),
      outputs: { logs: { pcs: 0, lengthMm: 0, kgG: 0 }, drossG: 0, feG: 0, returns: [] },
    });
    expect(empty.warnings.map((w) => w.code)).toEqual(["loss_high", "no_logs"]);
    expect(empty).toMatchObject({ outputG: 0, lossG: 1_000 * KG, allowedBurnG: 30 * KG });
  });
});

// ---------------------------------------------------------------------------
// Close-out SQL twin (write-time guard) and the numbers the owner reads
// ---------------------------------------------------------------------------

describe("[L30,L33,L34,L32] the write-time tail guard agrees with the read-time tail", () => {
  test("[L30] a no-reason close of a cast whose billets were pressed into bundles lands", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    await moveBillets(p, c.id, -4_000 * KG, "press_run");
    const dieId = await env.seedDie(p.companyId);
    const [b] = await env.seedBundles(p.companyId, dieId, 1);
    await env.db.update(bundle).set({ castId: c.id, weightG: 4_000 * KG }).where(eq(bundle.id, b!.id));
    expect((await p.viewer.foundry.casts.get({ id: c.id })).closeout).toMatchObject({ bundlesG: 4_000 * KG, billetsOnHandG: 6_450 * KG, tailG: 0, needsReason: false });
    expect(await p.supervisor.foundry.casts.close({ castId: c.id })).toMatchObject({ status: "closed", tailG: 0 });
  });

  test("[L33] a tail of exactly 3 % needs a reason code but no second person (read side and write side agree at the band)", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    // 10,000 kg of billets produced; 300 kg = exactly 3.00 % leave outside the press
    await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 10_300, 10_000));
    await moveBillets(p, c.id, -300 * KG);
    expect((await p.viewer.foundry.casts.get({ id: c.id })).closeout).toMatchObject({ tailG: 300 * KG, tailBp: 300, needsReason: true, needsApproval: false });
    expect(await p.supervisor.foundry.casts.close({ castId: c.id, reasonCodeId: await tailCode(p, "remelted") })).toMatchObject({ status: "closed", tailG: 300 * KG, tailBp: 300 });
  });

  test("[L34] RACE: 1.5 % of the billets leave after the close read a zero tail — the no-reason close does not land", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    env.beforeNextBatch(() => moveBillets(p, c.id, -165 * KG)); // 165 / 11,000 = 1.5 %
    await expect(p.supervisor.foundry.casts.close({ castId: c.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await castRow(c.id)).status).toBe("open");
  });

  test("[L32] RACE: billets are added after the read, tail now negative beyond 1 % — the no-reason close does not land", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    env.beforeNextBatch(() => moveBillets(p, c.id, 2_000 * KG));
    await expect(p.supervisor.foundry.casts.close({ castId: c.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await castRow(c.id)).status).toBe("open");
  });

  test("[L24,L35] furnace burn is shown beside the tail, never in it (the melt's own balance reason covers it)", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 10_000, 9_400)); // 6 % loss
    expect((await p.viewer.foundry.casts.get({ id: c.id })).closeout).toMatchObject({ inputG: 10_000 * KG, burnG: 600 * KG, producedG: 9_400 * KG, tailG: 0, needsReason: false });
  });

  test("[L26,L28] billets and bundles are counted per cast, never plant-wide", async () => {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const a = await openCast(p);
    const b = await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(a.id, lot.id, p));
    const dieId = await env.seedDie(p.companyId);
    const [bun] = await env.seedBundles(p.companyId, dieId, 1);
    await env.db.update(bundle).set({ castId: a.id, weightG: 1_000 * KG }).where(eq(bundle.id, bun!.id));
    expect((await p.viewer.foundry.casts.get({ id: b.id })).closeout).toMatchObject({ billetsOnHandG: 0, bundlesG: 0, inputG: 0 });
    const list = await p.viewer.foundry.casts.list({});
    expect(list.items.find((x) => x.id === b.id)).toMatchObject({ billetsOnHandG: 0, logsG: 0, inputG: 0, meltCount: 0 });
    expect(list.items.find((x) => x.id === a.id)).toMatchObject({ billetsOnHandG: 10_450 * KG, meltCount: 1 });
  });
});

// ---------------------------------------------------------------------------
// RP9 lot list
// ---------------------------------------------------------------------------

describe("RP9 lots.available: aggregation, order, remaining kg", () => {
  test("[R24,R25,R26,R27,R28,R29] byGrade sums the lots of an item+grade, orders grades within an item, totals and shows drawn kg", async () => {
    const p = await plant();
    const a1 = await okLot(p, 10_000);
    await okLot(p, 3_000); // same item + grade A
    await okLot(p, 2_000, { grade: "B" }); // same item, grade B
    await okLot(p, 4_000, { itemId: p.cableId });
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(simpleMelt(c.id, a1.id, p, 4_000, 3_900));
    const res = await p.foundry.foundry.lots.available();
    expect(res.byGrade.map((g) => [g.itemName, g.gradeCode, g.remainingG, g.lots])).toEqual([
      ["IMP BELLING", "A", 9_000 * KG, 2],
      ["IMP BELLING", "B", 2_000 * KG, 1],
      ["SOFT CABLE", "A", 4_000 * KG, 1],
    ]);
    expect(res.totalG).toBe(15_000 * KG);
    expect(res.truncated).toBe(false);
    const first = res.lots.find((l) => l.id === a1.id)!;
    expect(first).toMatchObject({ stockG: 10_000 * KG, drawnG: 4_000 * KG, remainingG: 6_000 * KG });
  });

  test("[R20] lots come in book order: LOT-2 before LOT-10", async () => {
    const p = await plant();
    for (let i = 0; i < 11; i += 1) await okLot(p, 1_000);
    const nums = (await p.foundry.foundry.lots.available()).lots.map((l) => Number(l.number.split("-").pop()));
    expect(nums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  test("[L15,L16] a debit note approved after OK takes its bori off the lot's remaining kg (and only that lot's)", async () => {
    const p = await plant();
    const lot = await p.storekeeper.purchase.lots.create({
      vendorId: p.vendorId, date: "2026-10-01", origin: "LOCAL", itemId: p.itemId, grade: "A",
      partyKgG: 10_000 * KG, fcKgG: 9_900 * KG, ratePaise: 18_500, billBook: "main",
    });
    const note = await p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 100 * KG, boriDeductionG: 30 * KG, note: "20 bori" });
    await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" });
    const other = await okLot(p, 5_000);
    await p.manager.approval.decide({ id: note.approvalId, decision: "approved" });
    expect(await remainingOf(p, lot.id)).toBe(9_870 * KG);
    expect(await remainingOf(p, other.id)).toBe(5_000 * KG);
    const c = await openCast(p);
    await expect(p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 9_880, 9_700))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("9,870"),
    });
    expect(await meltsOf(p.companyId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// casts.list / casts.get
// ---------------------------------------------------------------------------

describe("casts.list and casts.get contracts the foundry screens will rely on", () => {
  test("[R32,R34,R35,R36,R37] newest first by open time, paged with limit / offset / nextOffset", async () => {
    const p = await plant();
    const nums: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      setClock(new Date(NOW.getTime() + i * H));
      nums.push((await openCast(p)).number);
    }
    expect(nums).toEqual(["J1", "J2", "J3"]);
    const first = await p.viewer.foundry.casts.list({ limit: 2 });
    expect(first.items.map((x) => x.number)).toEqual(["J3", "J2"]);
    expect(first).toMatchObject({ total: 3, limit: 2, offset: 0, nextOffset: 2 });
    const second = await p.viewer.foundry.casts.list({ limit: 2, offset: 2 });
    expect(second.items.map((x) => x.number)).toEqual(["J1"]);
    expect(second).toMatchObject({ total: 3, nextOffset: null });
  });

  test("[L25] a cancelled melt no longer counts in the list's melt count", async () => {
    const p = await plant();
    const lot = await okLot(p, 30_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970));
    await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970));
    await p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "typo" });
    const row = (await p.viewer.foundry.casts.list({})).items[0]!;
    expect(row).toMatchObject({ meltCount: 1, inputG: 1_000 * KG, billetsOnHandG: 970 * KG });
  });

  test("[R38,R39,R40,R41,R42,R43,R44,R45] casts.get returns each melt's inputs, outputs, chemicals (with MRS) and its own cast's approval", async () => {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const a = await openCast(p);
    const b = await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(a.id, lot.id, p));
    // 1,000 kg of cast b's billets left outside the press: its close needs a reason and opens an approval
    await p.foundry.foundry.melts.create(simpleMelt(b.id, lot.id, p, 10_000, 9_700));
    await moveBillets(p, b.id, -1_000 * KG);
    await p.supervisor.foundry.casts.close({ castId: b.id, reasonCodeId: await tailCode(p, "other"), note: "pit" });
    const got = await p.viewer.foundry.casts.get({ id: a.id });
    const m = got.melts[0]!;
    expect(m.inputs.map((i) => [i.line, i.kind, i.lotNumber ?? i.streamCode, i.itemName ?? null, i.gradeCode ?? null, i.kgG])).toEqual([
      [1, "lot", expect.stringMatching(/^LOT-/), "IMP BELLING", "A", 10_000 * KG],
      [2, "return_stream", "PLANT-SCRAP", null, null, 1_000 * KG],
    ]);
    expect(m.outputs.map((o) => [o.kind, o.streamCode ?? null, o.kgG])).toEqual([
      ["logs", null, 10_450 * KG],
      ["dross", "DROSS", 200 * KG],
      ["fe", "FE", 20 * KG],
      ["return_stream", "PLANT-SCRAP", 50 * KG],
    ]);
    const flux = m.chemicals.find((x) => x.name === "Cover flux")!;
    expect(flux).toMatchObject({ unit: "kg", openMilli: 20 * U, usedMilli: 12 * U, closeMilli: 8 * U, mrsNumber: "MRS-1" });
    expect(m.chemicals.find((x) => x.name === "Grain refiner")).toMatchObject({ mrsNumber: null, storeTxnId: null });
    expect(got.approval).toBeNull(); // cast a never asked for a close-out
    const gotB = await p.viewer.foundry.casts.get({ id: b.id });
    expect(gotB.approval).toMatchObject({ status: "pending", requestNote: "Other: pit" });
  });
});

// ---------------------------------------------------------------------------
// melts.create: what is stored, what warns, what is refused
// ---------------------------------------------------------------------------

describe("melts.create stores what the foundry sheet recorded", () => {
  test("[R109,R110,R111,R112,R113,R114,R115,R116,R123,R124,R126] times, log length, optional LDO dips, chemical open/close and output pcs/length are stored as given", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const t = times();
    const r = await p.foundry.foundry.melts.create(
      meltPayload(c.id, lot.id, p, {
        ldoTenthIn: { start: 480, chargingStart: 470, chargingEnd: 465, castingStart: 460, end: 455 },
        notes: "Second shift",
      }),
    );
    const [m] = await env.db.select().from(melt).where(eq(melt.id, r.id));
    // bun's toMatchObject treats two different Dates as a match, so compare the instants themselves
    expect([m!.preheatStartAt, m!.chargingStartAt, m!.chargingEndAt, m!.castingStartAt, m!.castingEndAt].map((d) => d!.getTime())).toEqual([
      t.preheatStart, t.chargingStart, t.chargingEnd, t.castingStart, t.castingEnd,
    ]);
    expect(m).toMatchObject({
      logsLengthMm: 6_000, outputG: 10_720 * KG, notes: "Second shift", createdBy: p.users.foundry.id,
      ldoStartTenthIn: 480, ldoChargingStartTenthIn: 470, ldoChargingEndTenthIn: 465, ldoCastingStartTenthIn: 460, ldoEndTenthIn: 455,
    });
    const chem = await env.db.select().from(meltChemical).where(eq(meltChemical.meltId, r.id));
    expect(chem.map((x) => [x.name, x.openMilli, x.usedMilli, x.closeMilli])).toEqual(
      expect.arrayContaining([["Cover flux", 20 * U, 12 * U, 8 * U], ["Grain refiner", 5 * U, 2 * U, 3 * U]]),
    );
    const logs = (await env.db.select().from(meltOutput).where(eq(meltOutput.meltId, r.id))).find((o) => o.kind === "logs")!;
    expect(logs).toMatchObject({ pcs: 38, lengthMm: 6_000, kgG: 10_450 * KG });
  });

  test("[R99,R100,R95,R87] no_logs and ldo_rise warn; a melt with no logs needs no billet store", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.manager.stock.locations.update({ id: p.loc("BILLET"), active: false });
    const r = await p.foundry.foundry.melts.create({
      ...meltPayload(c.id, lot.id, p),
      ldoTenthIn: { start: 400, end: 450 },
      outputs: { logs: { pcs: 0, lengthMm: 0, kgG: 0 }, drossG: 500 * KG, feG: 0, returns: [{ streamId: p.stream("PLANT-SCRAP"), kgG: 10_000 * KG }] },
    });
    expect(r.warnings).toEqual(
      expect.arrayContaining([{ code: "no_logs" }, { code: "ldo_rise", startTenthIn: 400, endTenthIn: 450 }]),
    );
    expect((await ledger(p.companyId, { voucherType: "melt", voucherId: r.id })).filter((x) => x.itemKind === "billet")).toEqual([]);
  });

  test("[R102] a balance outside 3 % is stored on the melt as a warning (also for a melt with no logs)", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const r = await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 10_000, 9_000));
    expect(r.warnings).toEqual([{ code: "loss_high", lossBp: 1_000, limitBp: 300 }]);
  });

  test("[R88,R89] zero-kg dross / Fe lines post nothing", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const r = await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 10_000, 9_800));
    expect((await env.db.select().from(meltOutput).where(eq(meltOutput.meltId, r.id))).map((o) => o.kind)).toEqual(["logs"]);
    expect((await ledger(p.companyId, { voucherType: "melt", voucherId: r.id })).map((x) => x.itemKind).sort()).toEqual(["billet", "scrap_grade"]);
  });

  test("[R90] a retired DROSS stream refuses dross; the melt without dross still lands", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.manager.foundry.returnStreams.update({ id: p.stream("DROSS"), active: false });
    await expect(p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Dross"),
    });
    expect((await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970))).seq).toBe(1);
  });

  test("[R96,R97,R98] with no plant-scrap location, anything that touches plant scrap is a BAD_REQUEST, not a crash", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.manager.stock.locations.update({ id: p.loc("PLANT-SCRAP"), active: false });
    const base = simpleMelt(c.id, lot.id, p, 1_000, 970);
    const cases: Partial<MeltInput>[] = [
      { outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: 950 * KG }, drossG: 0, feG: 20 * KG, returns: [] } },
      { outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: 950 * KG }, drossG: 0, feG: 0, returns: [{ streamId: p.stream("INGOT"), kgG: 20 * KG }] } },
      { inputs: [{ kind: "return_stream", ref: p.stream("INGOT"), kgG: 1_000 * KG }] },
    ];
    for (const over of cases) {
      await expect(p.foundry.foundry.melts.create({ ...base, ...over })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("plant scrap"),
      });
    }
    expect(await meltsOf(p.companyId)).toEqual([]);
  });
});

describe("melts.create validation the first suite does not pin", () => {
  test("[R71,R72,R73,R76] times: every adjacent pair is ordered, 10 minutes of clock slack, up to 3 days", async () => {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const c = await openCast(p);
    const t = times();
    const refuse: Partial<MeltInput>[] = [
      { timestamps: { ...t, chargingEnd: t.chargingStart - 1 } },
      { timestamps: { ...t, castingStart: t.chargingEnd - 1 } },
      { timestamps: { ...t, castingEnd: NOW.getTime() + 11 * 60_000, castingStart: t.castingStart } },
    ];
    for (const over of refuse) {
      await expect(p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970, over))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    const accept: Partial<MeltInput>[] = [
      { timestamps: { ...t, castingEnd: NOW.getTime() + 5 * 60_000 } },
      { timestamps: { ...t, preheatStart: t.castingEnd - 60 * H } },
      { timestamps: { ...t, preheatStart: t.castingEnd - 72 * H } },
    ];
    for (const over of accept) {
      await expect(p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970, over))).resolves.toMatchObject({ warnings: [] });
    }
  });

  test("[R81,R91,R79,R84,R87] duplicates, a booked lot's own message, logs with pieces but no kg", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const booked = await p.storekeeper.purchase.lots.create({
      vendorId: p.vendorId, date: "2026-10-01", itemId: p.itemId, grade: "A",
      partyKgG: 5_000 * KG, fcKgG: 5_000 * KG, ratePaise: 18_500, billBook: "main",
    });
    const c = await openCast(p);
    const logs = { pcs: 30, lengthMm: 6_000, kgG: 950 * KG };
    const twice = [{ streamId: p.stream("INGOT"), kgG: 10 * KG }, { streamId: p.stream("INGOT"), kgG: 10 * KG }];
    await expect(
      p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 950, { outputs: { logs, drossG: 0, feG: 0, returns: twice } })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("twice") });
    await expect(
      p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970, {
        chemicals: [
          { storeItemId: p.fluxId, openMilli: 20 * U, usedMilli: 1 * U, closeMilli: 19 * U },
          { storeItemId: p.fluxId, openMilli: 19 * U, usedMilli: 1 * U, closeMilli: 18 * U },
        ],
      })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("twice") });
    await expect(
      p.foundry.foundry.melts.create(simpleMelt(c.id, booked.id, p, 1_000, 970)),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("not in scrap stock") });
    await expect(
      p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 0, { outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: 0 }, drossG: 0, feG: 0, returns: [] } })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Logs need") });
    expect(await meltsOf(p.companyId)).toEqual([]);
  });

  test("[L08,L09] no billet store says so exactly; two uncoded billet stores are ambiguous; the one coded BILLET wins", async () => {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const c = await openCast(p);
    await p.manager.stock.locations.update({ id: p.loc("BILLET"), active: false });
    await expect(p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Add the billet store location first (Stock → Locations)",
    });
    await p.manager.stock.locations.update({ id: p.loc("BILLET"), active: true });
    await p.owner.stock.locations.create({ code: "BILLET-2", name: "Second billet store", kind: "billet_store" });
    const r = await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970));
    expect((await ledger(p.companyId, { voucherType: "melt", voucherId: r.id })).find((x) => x.itemKind === "billet")!.locationId).toBe(p.loc("BILLET"));
    await p.manager.stock.locations.update({ id: p.loc("BILLET"), code: "BILLET-1" }).catch(() => undefined);
    const rows = (await p.owner.stock.locations.list()).items.filter((l) => l.kind === "billet_store");
    if (!rows.some((l) => l.code === "BILLET")) {
      await expect(p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970))).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("More than one billet store"),
      });
    }
  });
});

describe("melts.create races: every guard in the batch has a loser", () => {
  async function racePlant() {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const c = await openCast(p);
    return { p, lot, c };
  }

  test("[R105,R108,L13] the billet store is retired after the melt read it — the melt does not land, nothing posts", async () => {
    const { p, lot, c } = await racePlant();
    env.beforeNextBatch(() => p.manager.stock.locations.update({ id: p.loc("BILLET"), active: false }));
    await expect(p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("billet store"),
    });
    expect(await meltsOf(p.companyId)).toEqual([]);
    expect(await ledger(p.companyId, { voucherType: "melt" })).toEqual([]);
    expect((await castRow(c.id)).meltCount).toBe(0);
  });

  test("[L12] the billet store is re-typed after the melt read it — the melt does not land", async () => {
    const { p, lot, c } = await racePlant();
    env.beforeNextBatch(() => p.manager.stock.locations.update({ id: p.loc("BILLET"), kind: "yard" }));
    await expect(p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await meltsOf(p.companyId)).toEqual([]);
    expect(await ledger(p.companyId, { voucherType: "melt" })).toEqual([]);
  });

  test("[R106] plant scrap is retired after the melt read it — the melt does not land", async () => {
    const { p, lot, c } = await racePlant();
    env.beforeNextBatch(() => p.manager.stock.locations.update({ id: p.loc("PLANT-SCRAP"), active: false }));
    await expect(p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p, { chemicals: [] }))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("plant scrap"),
    });
    expect(await meltsOf(p.companyId)).toEqual([]);
    expect(await ledger(p.companyId, { voucherType: "melt" })).toEqual([]);
  });

  test("[R118,R132] a charge stream is retired after the melt read it — the melt does not land and says which", async () => {
    const { p, lot, c } = await racePlant();
    env.beforeNextBatch(() => p.manager.foundry.returnStreams.update({ id: p.stream("PIT-METAL"), active: false }));
    await expect(
      p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p, {
        chemicals: [],
        inputs: [{ kind: "lot", ref: lot.id, kgG: 10_000 * KG }, { kind: "return_stream", ref: p.stream("PIT-METAL"), kgG: 1_000 * KG }],
      })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("retired") });
    expect(await meltsOf(p.companyId)).toEqual([]);
    expect(await ledger(p.companyId, { voucherType: "melt" })).toEqual([]);
  });

  test("[R131] the lot is cancelled after the melt read it — the melt does not land and says the lot left scrap stock", async () => {
    const { p, lot, c } = await racePlant();
    env.beforeNextBatch(() => p.manager.purchase.lots.cancel({ id: lot.id, reason: "wrong vendor" }));
    await expect(p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("no longer in scrap stock"),
    });
    expect(await meltsOf(p.companyId)).toEqual([]);
  });

  test("[R127,L38,S01] RACE: the same clientRequestId lands first — this call returns that melt, one melt, one posting", async () => {
    const { p, lot, c } = await racePlant();
    let first: { id: string } | null = null;
    env.beforeNextBatch(async () => {
      first = await p.supervisor.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970, { clientRequestId: "dup-1" }));
    });
    const second = await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970, { clientRequestId: "dup-1" }));
    expect(second.id).toBe(first!.id);
    expect(await meltsOf(p.companyId)).toHaveLength(1);
    expect(sum(await ledger(p.companyId, { voucherType: "melt" }))).toBe(-30 * KG);
    expect((await castRow(c.id)).meltCount).toBe(1);
  });

  test("[R47,S02] RACE: casts.open with the same clientRequestId — the loser returns the winner's cast", async () => {
    const p = await plant();
    let first: { id: string } | null = null;
    env.beforeNextBatch(async () => {
      first = await p.supervisor.foundry.casts.open({ alloy: "6063", clientRequestId: "o-1" });
    });
    const second = await p.foundry.foundry.casts.open({ alloy: "6063", clientRequestId: "o-1" });
    expect(second.id).toBe(first!.id);
    expect((await env.db.select().from(cast).where(eq(cast.companyId, p.companyId)))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// melts.cancel
// ---------------------------------------------------------------------------

describe("melts.cancel", () => {
  test("[R148,R149,R150,R151,R152,R153] reversal rows mirror the originals (line, item, location, reason) and touch only their melt", async () => {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const c = await openCast(p);
    const m1 = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    const m2 = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    await p.supervisor.foundry.melts.cancel({ meltId: m1.id, reason: "Entered twice" });
    const orig = await ledger(p.companyId, { voucherType: "melt", voucherId: m1.id });
    const rev = await ledger(p.companyId, { voucherType: "melt_cancel" });
    expect(rev).toHaveLength(orig.length);
    expect(new Set(rev.map((r) => r.voucherId))).toEqual(new Set([m1.id]));
    for (const o of orig) {
      const r = rev.find((x) => x.reversalOf === o.id)!;
      expect(r).toMatchObject({ line: o.line, itemKind: o.itemKind, itemRef: o.itemRef, locationId: o.locationId, qtyG: -o.qtyG, reason: "Entered twice" });
      expect(r.postedAt.getTime()).toBeGreaterThan(o.postedAt.getTime());
    }
    // per item and location, the plant's balance is now exactly the second melt's postings
    const net = new Map<string, number>();
    for (const r of await ledger(p.companyId)) {
      if (r.itemKind === "store_item" || r.itemKind === "bundle") continue;
      const k = `${r.itemKind}|${r.itemRef}|${r.locationId}`;
      net.set(k, (net.get(k) ?? 0) + r.qtyG);
    }
    const second = new Map<string, number>();
    for (const r of await ledger(p.companyId, { voucherType: "melt", voucherId: m2.id })) {
      const k = `${r.itemKind}|${r.itemRef}|${r.locationId}`;
      second.set(k, (second.get(k) ?? 0) + r.qtyG);
    }
    for (const [k, v] of net) {
      if (k.startsWith("scrap_grade")) continue; // the lot's own OK posting is on the same key
      expect({ k, v }).toEqual({ k, v: second.get(k) ?? 0 });
    }
  });

  test("[R143] RACE: two cancels of one melt (a melt with no store draws) — the loser fails and the first reason stays", async () => {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const c = await openCast(p);
    // No logs and no chemicals drawn from the store: the billets-on-hand guard and the store abort
    // of a normal melt would hide the missing "not cancelled yet" guard.
    const m = await p.foundry.foundry.melts.create(
      simpleMelt(c.id, lot.id, p, 1_000, 0, { outputs: { logs: { pcs: 0, lengthMm: 0, kgG: 0 }, drossG: 500 * KG, feG: 0, returns: [] } }),
    );
    env.beforeNextBatch(() => p.manager.foundry.melts.cancel({ meltId: m.id, reason: "first" }));
    await expect(p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "second" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await meltsOf(p.companyId))[0]).toMatchObject({ cancelReason: "first", cancelledBy: p.users.manager.id });
    expect(await ledger(p.companyId, { voucherType: "melt_cancel" })).toHaveLength((await ledger(p.companyId, { voucherType: "melt" })).length);
  });

  test("[R144,R146] RACE: the cast is closed after the cancel read it open — nothing is reversed", async () => {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    env.beforeNextBatch(() => p.supervisor.foundry.casts.close({ castId: c.id }));
    await expect(p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "late" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await meltsOf(p.companyId))[0]!.cancelledAt).toBeNull();
    expect(await ledger(p.companyId, { voucherType: "melt_cancel" })).toEqual([]);
    expect((await castRow(c.id)).status).toBe("closed");
  });

  test("[R145] RACE: the press takes the billets after the cancel read them — nothing is reversed", async () => {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    env.beforeNextBatch(() => moveBillets(p, c.id, -1_000 * KG));
    await expect(p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "late" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("billets"),
    });
    expect((await meltsOf(p.companyId))[0]!.cancelledAt).toBeNull();
    expect(await ledger(p.companyId, { voucherType: "melt_cancel" })).toEqual([]);
  });

  test("[R158] never returns a draw into a store location that is no longer a store", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(
      meltPayload(c.id, lot.id, p, { chemicals: [{ storeItemId: p.fluxId, openMilli: 100 * U, usedMilli: 100 * U, closeMilli: 0 }] }),
    );
    await p.storekeeper.store.issue({ itemId: p.ldoId, qtyMilli: 1_000 * U, purpose: "other" });
    await p.owner.stock.locations.update({ id: p.loc("STORE"), kind: "yard" });
    await expect(p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "x" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("reactivate"),
    });
    expect(await ledger(p.companyId, { voucherType: "melt_cancel" })).toEqual([]);
  });

  test("[R159,R160] W2-FD-S (spec E4): cast.close holders cancel a locked melt; the foundry floor asks for a correction instead", async () => {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const c = await openCast(p);
    const m1 = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    const m2 = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    await expect(p.manager.foundry.melts.cancel({ meltId: m1.id, reason: "x" })).resolves.toMatchObject({ cancelled: true });
    await expect(p.foundry.foundry.melts.cancel({ meltId: m2.id, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.supervisor.foundry.melts.cancel({ meltId: m2.id, reason: "x" })).resolves.toMatchObject({ cancelled: true });
  });
});

// ---------------------------------------------------------------------------
// casts.close and the cast_close approval
// ---------------------------------------------------------------------------

describe("casts.close", () => {
  test("[R59,R60,R61] a direct close stamps closed_at, keeps the reason and the frozen summary", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    await p.supervisor.foundry.casts.close({ castId: c.id, reasonCodeId: await tailCode(p, "scale_difference"), note: "Nothing missing" });
    const row = await castRow(c.id);
    expect(row.closedAt).toBeInstanceOf(Date);
    expect(row).toMatchObject({ tailReason: "Scale difference: Nothing missing" });
    expect(row.tailReasonCodeId).toBeTruthy();
    expect(row.closeSummary).toMatchObject({ producedG: 10_450 * KG, creditedG: 0, billetsOnHandG: 10_450 * KG, shortG: 0, inputG: 11_000 * KG, logsG: 10_450 * KG, bundlesG: 0, tailG: 0, tailBp: 0, reasonCode: "scale_difference" });
  });

  test("[R54] RACE: two closes — the loser fails and the first closer stays", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    env.beforeNextBatch(() => p.manager.foundry.casts.close({ castId: c.id }));
    await expect(p.supervisor.foundry.casts.close({ castId: c.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await castRow(c.id)).toMatchObject({ status: "closed", closedBy: p.users.manager.id });
  });

  test("[R56] RACE: a melt lands after a close WITH a reason read the tail — no orphan approval, cast stays open", async () => {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 10_000, 9_400));
    env.beforeNextBatch(() => p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970)));
    await expect(p.supervisor.foundry.casts.close({ castId: c.id, tailReason: "pit" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await castRow(c.id)).status).toBe("open");
    expect(await env.db.select().from(approval).where(and(eq(approval.companyId, p.companyId), eq(approval.kind, "cast_close")))).toEqual([]);
    expect((await env.db.select().from(auditLog).where(eq(auditLog.companyId, p.companyId))).map((a) => a.action)).not.toContain("cast.close_request");
  });

  test("[A06,A07,A08,R62] a rejected close-out clears every close-out figure on the re-opened cast", async () => {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 10_000, 9_700));
    await moveBillets(p, c.id, -400 * KG); // 4.12 %: beyond 3 %
    const r = await p.manager.foundry.casts.close({ castId: c.id, reasonCodeId: await tailCode(p, "other"), note: "Unknown" });
    expect(await castRow(c.id)).toMatchObject({ status: "closing", tailG: 400 * KG, tailBp: 412, tailReason: "Other: Unknown" });
    const audits = (await env.db.select().from(auditLog).where(eq(auditLog.companyId, p.companyId))).map((a) => a.action);
    expect(audits).toContain("cast.close_request");
    expect(audits).not.toContain("cast.close");
    await p.foundry.approval.decide({ id: r.approvalId!, decision: "rejected", note: "Find it" });
    const row = await castRow(c.id);
    expect(row).toMatchObject({ status: "open", tailG: null, tailBp: null, tailReason: null, tailReasonCodeId: null, closeSummary: null, closeRequestedAt: null, closeRequestedBy: null, closedAt: null, closedBy: null });
    const open = (await p.viewer.foundry.casts.list({})).items[0]!;
    expect(open).toMatchObject({ status: "open", tailG: null, tailBp: null });
  });
});

// ---------------------------------------------------------------------------
// spectro
// ---------------------------------------------------------------------------

describe("spectro.attach edges", () => {
  async function meltOf(p: Plant) {
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    return p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970));
  }
  const png = Buffer.from("fake-png-bytes").toString("base64");

  test("[R170] at most 40 values", async () => {
    const p = await plant();
    const m = await meltOf(p);
    const mk = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`E${i}`, 0.01]));
    await expect(p.foundry.foundry.spectro.attach({ meltId: m.id, fileName: "a.csv", mime: "text/csv", base64: "", values: mk(41) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.foundry.foundry.spectro.attach({ meltId: m.id, fileName: "a.csv", mime: "text/csv", base64: "", values: mk(40) })).resolves.toBeTruthy();
  });

  test("[R171] an empty result (no file, no values) is refused", async () => {
    const p = await plant();
    const m = await meltOf(p);
    await expect(p.foundry.foundry.spectro.attach({ meltId: m.id, fileName: "a.csv", mime: "text/csv", base64: "", values: {} })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await env.db.select().from(spectroResult).where(eq(spectroResult.companyId, p.companyId))).toEqual([]);
  });

  test("[R172] a cancelled melt takes no spectro result", async () => {
    const p = await plant();
    const m = await meltOf(p);
    await p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "x" });
    await expect(p.foundry.foundry.spectro.attach({ meltId: m.id, fileName: "a.png", mime: "image/png", base64: png, values: {} })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("[R173] base64 whose length is not a multiple of 4 is refused", async () => {
    const p = await plant();
    const m = await meltOf(p);
    await expect(p.foundry.foundry.spectro.attach({ meltId: m.id, fileName: "a.png", mime: "image/png", base64: "abc", values: {} })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// Return streams and permissions
// ---------------------------------------------------------------------------

describe("return streams: permission rows and edits", () => {
  test("[R06,R07] returnStreams.update needs masters.publish; sortOrder is applied", async () => {
    const p = await plant();
    const id = p.stream("TENDIS");
    for (const role of ROLES.filter((r) => !can(r, "masters.publish"))) {
      await expect(p[role].foundry.returnStreams.update({ id, name: "X" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await p.manager.foundry.returnStreams.update({ id, sortOrder: 0 });
    expect((await p.viewer.foundry.returnStreams.list()).items[0]!.code).toBe("TENDIS");
  });

  test("[R11,L38] RACE: two creates of one code — the loser is a CONFLICT, not a raw error", async () => {
    const p = await plant();
    env.beforeNextBatch(() => p.admin.foundry.returnStreams.create({ code: "CHIPS", name: "Chips", kind: "charge" }));
    await expect(p.manager.foundry.returnStreams.create({ code: "CHIPS", name: "Saw chips", kind: "charge" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});


// ---------------------------------------------------------------------------
// Second pass (this review): RP9 allow-list, financial-year order, tenant isolation of every
// referenced master, equal LDO dips, tail rounding
// ---------------------------------------------------------------------------

describe("[R201,R202] RP9: the rate-free lot list is pinned by an ALLOW-list of keys, not a deny-list", () => {
  test("[R201,R202] a lot row and a byGrade row carry exactly the foundry's fields — nothing else a purchase_lot column could leak", async () => {
    const p = await plant();
    const a = await okLot(p, 10_000);
    const res = await p.foundry.foundry.lots.available();
    expect(Object.keys(res.lots.find((l) => l.id === a.id)!).sort()).toEqual(
      [
        "drawnG", "gradeCode", "id", "itemName", "lotDate", "locationCode", "locationId", "number", "okAt", "origin",
        "remainingG", "scrapGradeId", "scrapItemId", "stockG",
      ].sort(),
    );
    expect(Object.keys(res.byGrade[0]!).sort()).toEqual(
      ["gradeCode", "itemName", "itemRef", "lots", "remainingG", "scrapGradeId", "scrapItemId"].sort(),
    );
    expect(Object.keys(res).sort()).toEqual(["byGrade", "lots", "totalG", "truncated"]);
  });
});

describe("[R21] lots.available: book order is financial year first, then the lot number", () => {
  test("[R21] LOT-2 of last year comes before LOT-1 of this year", async () => {
    const p = await plant();
    const thisYear = await okLot(p, 1_000, { date: "2026-04-02" }); // FY 2026-27, LOT-1
    const lastA = await okLot(p, 1_000, { date: "2026-03-30" }); // FY 2025-26, LOT-1
    const lastB = await okLot(p, 1_000, { date: "2026-03-31" }); // FY 2025-26, LOT-2
    const ids = (await p.foundry.foundry.lots.available()).lots.map((l) => l.id);
    expect(ids).toEqual([lastA.id, lastB.id, thisYear.id]);
  });
});

describe("[R92,R213,R212] tenant isolation: every master a melt names is the plant's own", () => {
  test("[R92,R213] another company's store item in a melt's chemicals is NOT_FOUND and nothing posts", async () => {
    const p = await plant();
    const q = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await expect(
      p.foundry.foundry.melts.create(
        simpleMelt(c.id, lot.id, p, 1_000, 970, { chemicals: [{ storeItemId: q.fluxId, openMilli: 20 * U, usedMilli: 1 * U, closeMilli: 19 * U }] }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await meltsOf(p.companyId)).toEqual([]);
    expect(sum((await ledger(q.companyId, { itemKind: "store_item" })).filter((r) => r.itemRef === q.fluxId))).toBe(100 * U);
  });

  test("[R212] another company's return stream as a returned by-product is NOT_FOUND", async () => {
    const p = await plant();
    const q = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await expect(
      p.foundry.foundry.melts.create(
        simpleMelt(c.id, lot.id, p, 1_000, 950, {
          outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: 950 * KG }, drossG: 0, feG: 0, returns: [{ streamId: q.stream("INGOT"), kgG: 20 * KG }] },
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await meltsOf(p.companyId)).toEqual([]);
  });
});

describe("[R101,D16] melt and close-out figures at their edges", () => {
  test("[R101] LDO dips that did not move are not a rise", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const r = await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970, { ldoTenthIn: { start: 455, end: 455 } }));
    expect(r.warnings).toEqual([]);
  });

  test("[D16] a 4.545 bp tail is stored and shown as 5 bp (rounded), not 4", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 11_300, 11_000)); // 11,000 kg of billets produced
    await moveBillets(p, c.id, -5 * KG); // 5 kg nobody can account for
    const co = (await p.viewer.foundry.casts.get({ id: c.id })).closeout;
    expect(co).toMatchObject({ tailG: 5 * KG, tailBp: 5, needsReason: true, needsApproval: false });
    expect(await p.supervisor.foundry.casts.close({ castId: c.id, reasonCodeId: await tailCode(p, "scale_difference") })).toMatchObject({ status: "closed", tailG: 5 * KG, tailBp: 5 });
    expect(await castRow(c.id)).toMatchObject({ tailBp: 5 });
  });
});

describe("[R82,R83] retired and by-product streams: refused up front, with the right words", () => {
  test("[R82,R83] RETURNED metal into a by-product (DROSS) or a retired stream is refused — outputs have no write-time guard", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const logs = { pcs: 30, lengthMm: 6_000, kgG: 950 * KG };
    const withReturn = (streamId: string) =>
      simpleMelt(c.id, lot.id, p, 1_000, 950, { outputs: { logs, drossG: 0, feG: 0, returns: [{ streamId, kgG: 20 * KG }] } });
    await expect(p.foundry.foundry.melts.create(withReturn(p.stream("DROSS")))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("by-product"),
    });
    await p.manager.foundry.returnStreams.update({ id: p.stream("PIT-METAL"), active: false });
    await expect(p.foundry.foundry.melts.create(withReturn(p.stream("PIT-METAL")))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("retired"),
    });
    expect(await meltsOf(p.companyId)).toEqual([]);
    expect(await ledger(p.companyId, { voucherType: "melt" })).toEqual([]);
  });

  test("[R83] charging a by-product stream says it is a by-product (not 'the foundry data changed')", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await expect(
      p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970, { inputs: [{ kind: "return_stream", ref: p.stream("DROSS"), kgG: KG }] })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("by-product") });
  });
});


describe("[L29,R53,R46] close-out: by-products in the write-time twin, a melt that keeps the tail inside 1 %, cast notes", () => {
  test("[L29] a no-reason close of a cast whose by-products are large (dross) lands: dross is furnace side, never the tail", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    // 10,000 in: 9,400 logs + 600 dross, no burn. Tail 0 only if by-products count.
    await p.foundry.foundry.melts.create(
      simpleMelt(c.id, lot.id, p, 10_000, 9_400, { outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: 9_400 * KG }, drossG: 600 * KG, feG: 0, returns: [] } }),
    );
    expect((await p.viewer.foundry.casts.get({ id: c.id })).closeout).toMatchObject({ byproductG: 600 * KG, burnG: 0, tailG: 0, needsReason: false });
    expect(await p.supervisor.foundry.casts.close({ castId: c.id })).toMatchObject({ status: "closed", tailG: 0 });
  });

  test("[R53] RACE: a second melt that keeps the tail inside 1 % lands after the close read the figures — the close must not freeze stale figures", async () => {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    env.beforeNextBatch(() => p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p)));
    await expect(p.supervisor.foundry.casts.close({ castId: c.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("changed"),
    });
    expect((await castRow(c.id)).status).toBe("open");
    // closing again freezes both melts
    await p.supervisor.foundry.casts.close({ castId: c.id });
    expect((await castRow(c.id)).closeSummary).toMatchObject({ inputG: 22_000 * KG });
  });

  test("[R46] the notes typed when opening a cast are kept (trimmed)", async () => {
    const p = await plant();
    const c = await p.foundry.foundry.casts.open({ alloy: "6063", notes: "  night shift, new furnace lining " });
    expect((await castRow(c.id)).notes).toBe("night shift, new furnace lining");
  });
});

// ---------------------------------------------------------------------------
// Third pass: write-time guards the read-side checks hide, schema constraints, zod caps
// ---------------------------------------------------------------------------

describe("[X05] a melt whose only input is a return stream: the stream line needs the melt to have landed", () => {
  test("[X05] RACE: the cast is closed after a stream-only melt read it open — no melt, no ledger rows, a clear message", async () => {
    const p = await plant();
    const c = await openCast(p);
    const lot = await okLot(p, 1_000);
    env.beforeNextBatch(() => p.supervisor.foundry.casts.close({ castId: c.id }));
    await expect(
      p.foundry.foundry.melts.create(
        meltPayload(c.id, lot.id, p, {
          inputs: [{ kind: "return_stream", ref: p.stream("INGOT"), kgG: 1_000 * KG }],
          chemicals: [],
          outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: 970 * KG }, drossG: 0, feG: 0, returns: [] },
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("closed") });
    expect(await meltsOf(p.companyId)).toEqual([]);
    expect(await ledger(p.companyId, { voucherType: "melt" })).toEqual([]);
    expect((await ledger(p.companyId, { itemKind: "billet" }))).toEqual([]);
  });
});

describe("[S03,S04] the numbering indexes are in the migration: a duplicate (period, seq) or (cast, seq) is refused by the database", () => {
  test("[S04] two casts of one company cannot share a period and sequence", async () => {
    const p = await plant();
    const c = await openCast(p);
    const row = await castRow(c.id);
    await expect((async () => { await env.db.insert(cast).values({ ...row, id: crypto.randomUUID(), number: "Z9", clientRequestId: null }); })()).rejects.toThrow();
    expect((await env.db.select().from(cast).where(eq(cast.companyId, p.companyId))).length).toBe(1);
  });

  test("[S03] two melts of one cast cannot share a sequence number", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970));
    const [row] = await env.db.select().from(melt).where(eq(melt.id, m.id));
    await expect((async () => { await env.db.insert(melt).values({ ...row!, id: crypto.randomUUID(), clientRequestId: null }); })()).rejects.toThrow();
    expect((await meltsOf(p.companyId)).length).toBe(1);
  });
});

describe("[X60] casts.get shows its own company's approval, never another company's request that names the cast", () => {
  test("[X60] a newer forged cast_close approval in another company does not replace this cast's approval", async () => {
    const p = await plant();
    const q = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 10_000, 9_700));
    await moveBillets(p, c.id, -1_000 * KG);
    const r = await p.supervisor.foundry.casts.close({ castId: c.id, reasonCodeId: await tailCode(p, "other"), note: "pit" });
    await env.db.insert(approval).values({
      id: crypto.randomUUID(), companyId: q.companyId, kind: "cast_close", subjectId: c.id, requestedBy: q.users.supervisor.id,
      requestNote: "forged", createdAt: new Date(Date.now() + 60_000),
    });
    const got = await p.viewer.foundry.casts.get({ id: c.id });
    expect(got.approval).toMatchObject({ id: r.approvalId, status: "pending", requestNote: "Other: pit" });
  });
});

describe("[R50,X61] casts.close says why a cast that is no longer open cannot be closed", () => {
  test("[R50,X61] a closed cast is 'already closed'; a cast waiting for its approval says so", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const a = await openCast(p);
    await p.supervisor.foundry.casts.close({ castId: a.id });
    await expect(p.supervisor.foundry.casts.close({ castId: a.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("already closed"),
    });
    const b = await openCast(p);
    await p.foundry.foundry.melts.create(simpleMelt(b.id, lot.id, p, 10_000, 9_700));
    await moveBillets(p, b.id, -1_000 * KG);
    const other = await tailCode(p, "other");
    await p.supervisor.foundry.casts.close({ castId: b.id, reasonCodeId: other, note: "pit" });
    await expect(p.supervisor.foundry.casts.close({ castId: b.id, reasonCodeId: other, note: "again" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("waiting for its close-out approval"),
    });
  });
});

describe("[R94,X28,X30,X32,X34] input limits are the ones the sheet promises, each refused on its own", () => {
  test("[R94] a store chemical with nothing used is refused with that message", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await expect(
      p.foundry.foundry.melts.create(
        simpleMelt(c.id, lot.id, p, 1_000, 970, { chemicals: [{ storeItemId: p.fluxId, openMilli: 20 * U, usedMilli: 0, closeMilli: 20 * U }] }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("quantity used") });
  });

  test("[X28] a charge line of 0 kg is refused (inputs and returned metal)", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await expect(
      p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970, { inputs: [{ kind: "lot", ref: lot.id, kgG: 1_000 * KG }, { kind: "return_stream", ref: p.stream("INGOT"), kgG: 0 }] })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      p.foundry.foundry.melts.create(
        simpleMelt(c.id, lot.id, p, 1_000, 970, {
          outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: 970 * KG }, drossG: 0, feG: 0, returns: [{ streamId: p.stream("INGOT"), kgG: 0 }] },
        }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await meltsOf(p.companyId)).toEqual([]);
  });

  test("[X30] 61 different input lines are refused by the cap itself (not by a duplicate or missing-lot check)", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const inputs = Array.from({ length: 61 }, () => ({ kind: "lot" as const, ref: crypto.randomUUID(), kgG: KG }));
    await expect(p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970, { inputs }))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("[X32] 11 different returned-metal lines are refused by the cap itself", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const returns = Array.from({ length: 11 }, () => ({ streamId: crypto.randomUUID(), kgG: KG }));
    await expect(
      p.foundry.foundry.melts.create(
        simpleMelt(c.id, lot.id, p, 1_000, 970, { outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: 900 * KG }, drossG: 0, feG: 0, returns } }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("[X34] a spectro value above 100 % is refused, 100 % itself is accepted", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970));
    await expect(p.foundry.foundry.spectro.attach({ meltId: m.id, fileName: "a.csv", mime: "text/csv", base64: "", values: { Si: 100.5 } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.foundry.foundry.spectro.attach({ meltId: m.id, fileName: "a.csv", mime: "text/csv", base64: "", values: { Al: 100 } })).resolves.toBeTruthy();
  });
});

describe("[X43,L09] a second billet store: the one coded BILLET is chosen even when another sorts first", () => {
  test("[X43] BILLET wins over an earlier-sorting second billet store; two uncoded ones are ambiguous", async () => {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const c = await openCast(p);
    await p.owner.stock.locations.create({ code: "A-BILLET", name: "Old billet store", kind: "billet_store", sortOrder: 0 });
    const r = await p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970));
    const billetRow = (await ledger(p.companyId, { voucherType: "melt", voucherId: r.id })).find((x) => x.itemKind === "billet")!;
    expect(billetRow.locationId).toBe(p.loc("BILLET"));
  });

  test("[L09] two active billet stores and none coded BILLET: the melt asks the plant to retire the extra one", async () => {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const c = await openCast(p);
    await p.owner.stock.locations.create({ code: "B-1", name: "Billet one", kind: "billet_store" });
    await p.owner.stock.locations.create({ code: "B-2", name: "Billet two", kind: "billet_store" });
    await p.manager.stock.locations.update({ id: p.loc("BILLET"), active: false });
    await expect(p.foundry.foundry.melts.create(simpleMelt(c.id, lot.id, p, 1_000, 970))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("More than one billet store"),
    });
  });
});

describe("[R155] a melt's cancel gives the store its own reason", () => {
  test("[R155] the cancelled MRS carries 'Melt cancelled: <reason>' and so does its reversal row", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    await p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "Entered twice" });
    const [txn] = await env.db.select().from(storeTxn).where(and(eq(storeTxn.companyId, p.companyId), eq(storeTxn.kind, "mrs")));
    expect(txn!.cancelReason).toBe("Melt cancelled: Entered twice");
    const rev = await ledger(p.companyId, { voucherType: "store_mrs_cancel", voucherId: txn!.id });
    expect(rev.map((r) => r.reason)).toEqual(["Melt cancelled: Entered twice"]);
  });
});

// ---------------------------------------------------------------------------
// Fourth pass: tenant isolation of request-id replays, DROSS / FE lookups and every join the
// foundry screens read through (a foreign key does not check the company, so the joins must)
// ---------------------------------------------------------------------------

describe("[T01,T02] clientRequestId replays are per company", () => {
  test("[T01] another plant sending the same request id to casts.open gets its own cast, not the first plant's", async () => {
    const p = await plant();
    const q = await plant();
    const a = await p.foundry.foundry.casts.open({ alloy: "6063", clientRequestId: "same-id" });
    const b = await q.foundry.foundry.casts.open({ alloy: "6063", clientRequestId: "same-id" });
    expect(b.id).not.toBe(a.id);
    expect((await castRow(b.id)).companyId).toBe(q.companyId);
    expect((await castRow(a.id)).companyId).toBe(p.companyId);
  });

  test("[T02] another plant sending the same request id to melts.create gets its own melt, not the first plant's", async () => {
    const p = await plant();
    const q = await plant();
    const lotP = await okLot(p, 20_000);
    const lotQ = await okLot(q, 20_000);
    const cp = await openCast(p);
    const cq = await openCast(q);
    const a = await p.foundry.foundry.melts.create(simpleMelt(cp.id, lotP.id, p, 1_000, 970, { clientRequestId: "same-m" }));
    const b = await q.foundry.foundry.melts.create(simpleMelt(cq.id, lotQ.id, q, 1_000, 970, { clientRequestId: "same-m" }));
    expect(b.id).not.toBe(a.id);
    expect(b.castId).toBe(cq.id);
    expect((await meltsOf(q.companyId)).length).toBe(1);
  });
});

describe("[T04] dross and Fe go to the plant's own streams", () => {
  test("[T04] a melt with dross posts to this plant's DROSS stream even when an older plant has one too", async () => {
    const p = await plant();
    const q = await plant();
    const lot = await okLot(q, 20_000);
    const c = await openCast(q);
    const r = await q.foundry.foundry.melts.create(
      simpleMelt(c.id, lot.id, q, 10_000, 9_700, { outputs: { logs: { pcs: 30, lengthMm: 6_000, kgG: 9_700 * KG }, drossG: 200 * KG, feG: 20 * KG, returns: [] } }),
    );
    const rows = await ledger(q.companyId, { voucherType: "melt", voucherId: r.id });
    expect(rows.find((x) => x.itemRef === q.stream("DROSS"))).toMatchObject({ qtyG: 200 * KG });
    expect(rows.find((x) => x.itemRef === q.stream("FE"))).toMatchObject({ qtyG: 20 * KG });
    expect(sum(await ledger(p.companyId, { itemKind: "return_stream" }))).toBe(0);
    expect((await p.viewer.foundry.returnStreams.list()).items.every((s) => s.balanceG === 0)).toBe(true);
  });
});

describe("[J01,J02,J03] lots.available reads each lot's item, grade and location only inside its own company", () => {
  test("[J01] a lot whose item belongs to another plant is not listed", async () => {
    const p = await plant();
    const q = await plant();
    const lot = await okLot(p, 5_000);
    const qItem = (await env.db.select().from(scrapItem).where(eq(scrapItem.companyId, q.companyId)))[0]!;
    await env.db.update(purchaseLot).set({ scrapItemId: qItem.id }).where(eq(purchaseLot.id, lot.id));
    expect((await p.foundry.foundry.lots.available()).lots.find((l) => l.id === lot.id)).toBeUndefined();
  });

  test("[J02] a lot whose grade belongs to another plant is not listed", async () => {
    const p = await plant();
    const q = await plant();
    const lot = await okLot(p, 5_000);
    const qGrade = (await env.db.select().from(scrapGrade).where(eq(scrapGrade.companyId, q.companyId)))[0]!;
    await env.db.update(purchaseLot).set({ scrapGradeId: qGrade.id }).where(eq(purchaseLot.id, lot.id));
    expect((await p.foundry.foundry.lots.available()).lots.find((l) => l.id === lot.id)).toBeUndefined();
  });

  test("[J03] another plant's location code never shows on a lot", async () => {
    const p = await plant();
    const q = await plant();
    const lot = await okLot(p, 5_000);
    await env.db.update(purchaseLot).set({ locationId: q.loc("SCRAP") }).where(eq(purchaseLot.id, lot.id));
    const row = (await p.foundry.foundry.lots.available()).lots.find((l) => l.id === lot.id);
    expect(row).toBeDefined();
    expect(row!.locationCode).toBeNull();
  });
});

describe("[J05,J06,J07,J08,J10,J12,J15] casts.get never reads another plant's row through a cross-wired foreign key", () => {
  async function wired() {
    const p = await plant();
    const q = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    return { p, q, lot, c, m };
  }

  test("[J05] a melt line pointing at another plant's lot shows no lot number", async () => {
    const { p, q, c, m } = await wired();
    const theirs = await okLot(q, 1_000);
    await env.db.update(meltInput).set({ lotId: theirs.id }).where(and(eq(meltInput.meltId, m.id), eq(meltInput.line, 1)));
    const line = (await p.viewer.foundry.casts.get({ id: c.id })).melts[0]!.inputs.find((i) => i.line === 1)!;
    expect(line.lotNumber ?? null).toBeNull();
  });

  test("[J06,J07] a lot whose item or grade points into another plant shows neither name", async () => {
    const { p, q, lot, c } = await wired();
    const qItem = (await env.db.select().from(scrapItem).where(eq(scrapItem.companyId, q.companyId)))[0]!;
    const qGrade = (await env.db.select().from(scrapGrade).where(eq(scrapGrade.companyId, q.companyId)))[0]!;
    await env.db.update(purchaseLot).set({ scrapItemId: qItem.id, scrapGradeId: qGrade.id }).where(eq(purchaseLot.id, lot.id));
    const line = (await p.viewer.foundry.casts.get({ id: c.id })).melts[0]!.inputs.find((i) => i.line === 1)!;
    expect(line.itemName ?? null).toBeNull();
    expect(line.gradeCode ?? null).toBeNull();
  });

  test("[J06] item alone", async () => {
    const { p, q, lot, c } = await wired();
    const qItem = (await env.db.select().from(scrapItem).where(eq(scrapItem.companyId, q.companyId)))[0]!;
    await env.db.update(purchaseLot).set({ scrapItemId: qItem.id }).where(eq(purchaseLot.id, lot.id));
    const line = (await p.viewer.foundry.casts.get({ id: c.id })).melts[0]!.inputs.find((i) => i.line === 1)!;
    expect(line.itemName ?? null).toBeNull();
  });

  test("[J07] grade alone", async () => {
    const { p, q, lot, c } = await wired();
    const qGrade = (await env.db.select().from(scrapGrade).where(eq(scrapGrade.companyId, q.companyId)))[0]!;
    await env.db.update(purchaseLot).set({ scrapGradeId: qGrade.id }).where(eq(purchaseLot.id, lot.id));
    const line = (await p.viewer.foundry.casts.get({ id: c.id })).melts[0]!.inputs.find((i) => i.line === 1)!;
    expect(line.gradeCode ?? null).toBeNull();
  });

  test("[J08] a stream input pointing at another plant's stream shows no stream code", async () => {
    const { p, q, c, m } = await wired();
    await env.db.update(meltInput).set({ returnStreamId: q.stream("INGOT") }).where(and(eq(meltInput.meltId, m.id), eq(meltInput.line, 2)));
    const line = (await p.viewer.foundry.casts.get({ id: c.id })).melts[0]!.inputs.find((i) => i.line === 2)!;
    expect(line.streamCode ?? null).toBeNull();
  });

  test("[J10] a by-product line pointing at another plant's stream shows no stream code", async () => {
    const { p, q, c, m } = await wired();
    await env.db.update(meltOutput).set({ returnStreamId: q.stream("DROSS") }).where(and(eq(meltOutput.meltId, m.id), eq(meltOutput.kind, "dross")));
    const out = (await p.viewer.foundry.casts.get({ id: c.id })).melts[0]!.outputs.find((o) => o.kind === "dross")!;
    expect(out.streamCode ?? null).toBeNull();
  });

  test("[J12] a chemical line pointing at another plant's store entry shows no MRS number", async () => {
    const { p, q, c, m } = await wired();
    await q.storekeeper.store.issue({ itemId: q.fluxId, qtyMilli: 1 * U, purpose: "other" });
    const theirs = (await env.db.select().from(storeTxn).where(and(eq(storeTxn.companyId, q.companyId), eq(storeTxn.kind, "mrs"))))[0]!;
    await env.db.update(meltChemical).set({ storeTxnId: theirs.id }).where(and(eq(meltChemical.meltId, m.id), eq(meltChemical.name, "Cover flux")));
    const chem = (await p.viewer.foundry.casts.get({ id: c.id })).melts[0]!.chemicals.find((x) => x.name === "Cover flux")!;
    expect(chem.mrsNumber ?? null).toBeNull();
  });

  test("[J15] a spectro row of another plant that names this melt and cast is not listed", async () => {
    const { p, q, c, m } = await wired();
    await env.db.insert(spectroResult).values({
      id: crypto.randomUUID(), companyId: q.companyId, meltId: m.id, castId: c.id, fileName: "forged.csv", mime: "text/csv",
      sizeBytes: 0, dataBase64: "", valuesPpm: { Si: 1 },
    });
    expect((await p.viewer.foundry.casts.get({ id: c.id })).melts[0]!.spectro).toEqual([]);
  });
});

// keep imports used
void storeTxn;
void inArray;
