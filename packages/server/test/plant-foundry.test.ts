/**
 * PL-5: foundry — return streams, casts, melts, spectro, cast close-out (spec P3, P15, §5;
 * digest Stages 3-5).
 *
 * Review Focus 4: closing a cast whose logs / billets / bundles / returns don't explain its input
 * kg needs a reason and a second person; a melt balance outside 3 % warns and is stored, never
 * silently passes.
 * Ruling RP17: melt consumables are drawn from the central store inside the melt's own batch; a
 * refused draw aborts the whole melt. Ruling RP9: the foundry picks lots from a rate-free list.
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
  returnStream,
  spectroResult,
  stockLedger,
  storeTxn,
} from "@orrn/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

import { lotDrawnSql, lotPostedSql, OUTER_LOT_ID } from "../src/lib/foundry";
import { can as canMe, type Action } from "../src/lib/permissions";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;
let setClock: (at: Date | null) => void;

// Each test seeds a whole plant (locations, masters, lots, store stock) through the API; on a
// loaded machine that alone can pass bun's 5 s default and cascade into the next tests.
setDefaultTimeout(30_000);

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
/** One unit of a store item in milli-units. */
const U = 1000;
const H = 3_600_000;
/** 3 Oct 2026, 07:30 IST: preheat start of the standard melt. */
const T0 = Date.UTC(2026, 9, 3, 2, 0, 0);
/** "Now" for most tests: the same evening. */
const NOW = new Date(T0 + 10 * H);

function times(t0 = T0) {
  return { preheatStart: t0, chargingStart: t0 + H, chargingEnd: t0 + 3 * H, castingStart: t0 + 4 * H, castingEnd: t0 + 6 * H };
}

/** A plant with locations, scrap masters, a vendor, return streams and stocked store items. */
async function plant(opts: { locations?: boolean } = {}) {
  setClock(NOW);
  const { companyId, users } = await env.seedCompany();
  const callers = Object.fromEntries(ROLES.map((role) => [role, env.caller({ role, companyId })])) as Record<
    CompanyRole,
    ReturnType<typeof env.caller>
  >;
  if (opts.locations !== false) await callers.owner.stock.locations.seedDefaults();
  await callers.manager.purchase.seedScrapDefaults();
  await callers.manager.foundry.returnStreams.seedDefaults();
  const items = (await callers.manager.purchase.scrapItems.list()).items;
  const v = await callers.manager.vendor.create({ name: "Shree Ganesh Metals" });
  const streams = (await callers.viewer.foundry.returnStreams.list()).items;
  const stream = (code: string) => streams.find((s) => s.code === code)!.id;
  let fluxId = "";
  let ldoId = "";
  if (opts.locations !== false) {
    fluxId = (await callers.storekeeper.store.items.create({ name: "Cover flux", unit: "kg", category: "chemical" })).id;
    ldoId = (await callers.storekeeper.store.items.create({ name: "LDO", unit: "litre", category: "fuel" })).id;
    await callers.storekeeper.store.receive({ itemId: fluxId, qtyMilli: 100 * U });
    await callers.storekeeper.store.receive({ itemId: ldoId, qtyMilli: 1_000 * U });
  }
  const locs = opts.locations === false ? [] : (await callers.owner.stock.locations.list()).items;
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

/** An OK lot in the scrap store (FC = party, no D/C note). */
async function okLot(p: Plant, kg: number, over: { itemId?: string; grade?: string } = {}) {
  const lot = await p.storekeeper.purchase.lots.create({
    vendorId: p.vendorId,
    date: "2026-10-01",
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

/**
 * The standard melt: 10,000 kg of lot + 1,000 kg of plant scrap in; 10,450 kg of logs, 200 kg dross,
 * 20 kg Fe, 50 kg reusable metal to plant scrap out. Loss 280 kg = 2.55 % (inside 3 %).
 */
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

async function storeBalance(companyId: string, itemId: string) {
  return sum((await ledger(companyId, { itemKind: "store_item" })).filter((r) => r.itemRef === itemId));
}

async function auditActions(companyId: string) {
  return (await env.db.select().from(auditLog).where(eq(auditLog.companyId, companyId))).map((r) => r.action);
}

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

// ---------------------------------------------------------------------------
// Return streams
// ---------------------------------------------------------------------------

describe("return streams", () => {
  test("the 9 charge streams of the foundry sheet are seeded, plus dross and Fe as by-products", async () => {
    const p = await plant();
    const { items } = await p.viewer.foundry.returnStreams.list();
    const charge = items.filter((s) => s.kind === "charge");
    expect(charge.map((s) => s.name)).toEqual([
      "Ingot", "Plant scrap", "Plant discard", "Dross ingot", "Bend log", "Hill metal", "Pit metal", "Tendis metal", "Dross metal",
    ]);
    expect(charge).toHaveLength(9);
    expect(items.filter((s) => s.kind === "byproduct").map((s) => s.code)).toEqual(["DROSS", "FE"]);
    expect(items.every((s) => s.balanceG === 0)).toBe(true);
  });

  test("seedDefaults is idempotent and opening the first cast seeds a company that never ran it", async () => {
    const p = await plant();
    const again = await p.manager.foundry.returnStreams.seedDefaults();
    expect(again.added).toBe(0);
    const { companyId } = await env.seedCompany();
    const foundry = env.caller({ role: "foundry", companyId });
    expect((await foundry.foundry.returnStreams.list()).items).toEqual([]);
    await foundry.foundry.casts.open({ alloy: "6063" });
    expect((await foundry.foundry.returnStreams.list()).items).toHaveLength(11);
  });

  test("masters.publish creates and edits streams; codes are unique; others are FORBIDDEN", async () => {
    const p = await plant();
    const s = await p.manager.foundry.returnStreams.create({ code: "chips", name: "Saw chips", kind: "charge" });
    await p.admin.foundry.returnStreams.update({ id: s.id, name: "Saw chips (press)", active: false });
    const row = (await env.db.select().from(returnStream).where(eq(returnStream.id, s.id)))[0]!;
    expect(row).toMatchObject({ code: "CHIPS", name: "Saw chips (press)", active: false });
    await expect(p.manager.foundry.returnStreams.create({ code: "CHIPS", name: "Other", kind: "charge" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    for (const role of ROLES.filter((r) => !can(r, "masters.publish"))) {
      await expect(p[role].foundry.returnStreams.create({ code: `X${role}`, name: `X ${role}`, kind: "charge" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    expect(await auditActions(p.companyId)).toContain("return_stream.create");
    // another company's stream is NOT_FOUND; seeding needs masters.publish or cast.enter
    const q = await plant();
    await expect(q.manager.foundry.returnStreams.update({ id: s.id, name: "Hijack" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    for (const role of ROLES) {
      const allowed = can(role, "masters.publish") || can(role, "cast.enter");
      const call = p[role].foundry.returnStreams.seedDefaults();
      if (allowed) await expect(call).resolves.toMatchObject({ added: 0 });
      else await expect(call).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});

// ---------------------------------------------------------------------------
// Casts: numbers, open, list
// ---------------------------------------------------------------------------

describe("casts.open: the cast gets its letter code from the series (never typed)", () => {
  test("numbers run per month on the plant clock: J1, J2 in October, K1 in November, A1 next January", async () => {
    const p = await plant();
    const a = await openCast(p);
    const b = await openCast(p, "6061");
    expect([a.number, b.number]).toEqual(["J1", "J2"]);
    setClock(new Date(Date.UTC(2026, 10, 1, 0, 0))); // 1 Nov 05:30 IST
    const c = await openCast(p);
    expect(c.number).toBe("K1");
    setClock(new Date(Date.UTC(2026, 11, 31, 19, 0))); // 1 Jan 2027 00:30 IST
    const d = await openCast(p);
    expect(d.number).toBe("A1");
    const rows = await env.db.select().from(cast).where(eq(cast.companyId, p.companyId));
    const byNo = Object.fromEntries(rows.map((r) => [r.number, r]));
    expect(byNo.J2).toMatchObject({ year: 2026, month: 10, seq: 2, period: "2026-10", alloy: "6061", status: "open" });
    expect(byNo.A1).toMatchObject({ year: 2027, month: 1, seq: 1, period: "2027-01" });
    expect(await auditActions(p.companyId)).toContain("cast.open");
  });

  test("another company's series is its own", async () => {
    const p = await plant();
    const q = await plant();
    await openCast(p);
    expect((await openCast(q)).number).toBe("J1");
  });

  test("alloy must be a known grade; grade text is trimmed and short", async () => {
    const p = await plant();
    await expect(p.foundry.foundry.casts.open({ alloy: "7075" as never })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const c = await p.foundry.foundry.casts.open({ alloy: "6063", grade: "  A  " });
    expect((await castRow(c.id)).grade).toBe("A");
    await expect(p.foundry.foundry.casts.open({ alloy: "6063", grade: "x".repeat(21) })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("a double tap with the same clientRequestId returns the first cast and takes no second number", async () => {
    const p = await plant();
    const a = await p.foundry.foundry.casts.open({ alloy: "6063", clientRequestId: "tap-1" });
    const b = await p.foundry.foundry.casts.open({ alloy: "6063", clientRequestId: "tap-1" });
    expect(b.id).toBe(a.id);
    expect((await openCast(p)).number).toBe("J2");
  });

  test("list filters by status and number (latest first) and shows melt totals; get is NOT_FOUND across companies", async () => {
    const p = await plant();
    const q = await plant();
    const lot = await okLot(p, 20_000);
    const a = await openCast(p);
    await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(a.id, lot.id, p));
    const all = await p.viewer.foundry.casts.list({});
    expect(all.items.map((c) => c.number)).toEqual(["J2", "J1"]);
    const j1 = all.items.find((c) => c.number === "J1")!;
    expect(j1).toMatchObject({ meltCount: 1, inputG: 11_000 * KG, logsG: 10_450 * KG, billetsOnHandG: 10_450 * KG });
    expect((await p.viewer.foundry.casts.list({ number: "j1" })).items.map((c) => c.id)).toEqual([a.id]);
    expect((await p.viewer.foundry.casts.list({ status: "closed" })).items).toEqual([]);
    expect((await q.viewer.foundry.casts.list({})).items).toEqual([]);
    await expect(q.viewer.foundry.casts.get({ id: a.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// Melts: ledger postings
// ---------------------------------------------------------------------------

describe("melts.create posts the melt's stock effect in one batch", () => {
  test("− lot at the scrap store by item+grade, − return stream, + billets of the cast, + dross / Fe / returns", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const r = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    expect(r).toMatchObject({
      castNumber: "J1",
      seq: 1,
      inputG: 11_000 * KG,
      outputG: 10_720 * KG,
      lossG: 280 * KG,
      balanceBp: 255,
      balancePct: 2.55,
      warnings: [],
      mrsNumbers: ["MRS-1"],
    });
    const rows = await ledger(p.companyId, { voucherType: "melt", voucherId: r.id });
    const lotRow = (await env.db.select().from(purchaseLot).where(eq(purchaseLot.id, lot.id)))[0]!;
    const simplified = rows
      .map((x) => ({ line: x.line, itemKind: x.itemKind, itemRef: x.itemRef, locationId: x.locationId, qtyG: x.qtyG }))
      .sort((x, y) => x.line - y.line);
    expect(simplified).toEqual([
      { line: 1, itemKind: "scrap_grade", itemRef: `${lotRow.scrapItemId}:${lotRow.scrapGradeId}`, locationId: p.loc("SCRAP"), qtyG: -10_000 * KG },
      { line: 2, itemKind: "return_stream", itemRef: p.stream("PLANT-SCRAP"), locationId: p.loc("PLANT-SCRAP"), qtyG: -1_000 * KG },
      { line: 3, itemKind: "billet", itemRef: c.id, locationId: p.loc("BILLET"), qtyG: 10_450 * KG },
      { line: 4, itemKind: "return_stream", itemRef: p.stream("DROSS"), locationId: p.loc("PLANT-SCRAP"), qtyG: 200 * KG },
      { line: 5, itemKind: "return_stream", itemRef: p.stream("FE"), locationId: p.loc("PLANT-SCRAP"), qtyG: 20 * KG },
      { line: 6, itemKind: "return_stream", itemRef: p.stream("PLANT-SCRAP"), locationId: p.loc("PLANT-SCRAP"), qtyG: 50 * KG },
    ]);
    // The voucher's rows net to −loss: what came out minus what went in.
    expect(sum(rows)).toBe(-280 * KG);
    // Scrap stock of the grade is down by the draw; the lot has 10 t left.
    expect(sum((await ledger(p.companyId, { itemKind: "scrap_grade" })))).toBe(10_000 * KG);
    expect(await remainingOf(p, lot.id)).toBe(10_000 * KG);
    // Document rows
    const [m] = await meltsOf(p.companyId);
    expect(m).toMatchObject({ castId: c.id, seq: 1, alloy: "6063", inputG: 11_000 * KG, logsG: 10_450 * KG, logsPcs: 38, drossG: 200 * KG, feG: 20 * KG, returnsG: 50 * KG, lossG: 280 * KG, lossBp: 255, allowedBurnG: 280 * KG, ldoStartTenthIn: 480, ldoEndTenthIn: 455 });
    expect((await env.db.select().from(meltInput).where(eq(meltInput.meltId, r.id))).map((i) => [i.line, i.kind, i.kgG])).toEqual(
      expect.arrayContaining([[1, "lot", 10_000 * KG], [2, "return_stream", 1_000 * KG]]),
    );
    expect((await env.db.select().from(meltOutput).where(eq(meltOutput.meltId, r.id))).map((o) => o.kind).sort()).toEqual(
      ["dross", "fe", "logs", "return_stream"],
    );
    expect((await castRow(c.id)).meltCount).toBe(1);
    expect(await auditActions(p.companyId)).toEqual(expect.arrayContaining(["melt.create", "store.issue"]));
  });

  test("RP17: store chemicals draw an MRS (purpose melt, ref = the cast); free-text chemicals are recorded only", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const r = await p.foundry.foundry.melts.create(
      meltPayload(c.id, lot.id, p, {
        chemicals: [
          { storeItemId: p.fluxId, openMilli: 20 * U, usedMilli: 12 * U, closeMilli: 8 * U },
          { storeItemId: p.ldoId, openMilli: 300 * U, usedMilli: 180 * U, closeMilli: 120 * U },
          { name: "Grain refiner", unit: "kg", openMilli: 5 * U, usedMilli: 2 * U, closeMilli: 3 * U },
        ],
      }),
    );
    expect(r.mrsNumbers).toEqual(["MRS-1", "MRS-2"]);
    const txns = await env.db.select().from(storeTxn).where(and(eq(storeTxn.companyId, p.companyId), eq(storeTxn.kind, "mrs")));
    expect(txns.map((t) => [t.purpose, t.refId, t.qtyMilli]).sort()).toEqual([["melt", c.id, 12 * U], ["melt", c.id, 180 * U]]);
    expect(await storeBalance(p.companyId, p.fluxId)).toBe(88 * U);
    expect(await storeBalance(p.companyId, p.ldoId)).toBe(820 * U);
    const chem = await env.db.select().from(meltChemical).where(eq(meltChemical.meltId, r.id));
    const flux = chem.find((x) => x.storeItemId === p.fluxId)!;
    expect(flux).toMatchObject({ name: "Cover flux", unit: "kg", usedMilli: 12 * U });
    expect(txns.map((t) => t.id)).toContain(flux.storeTxnId!);
    expect(chem.find((x) => x.name === "Grain refiner")).toMatchObject({ storeItemId: null, storeTxnId: null, unit: "kg" });
  });

  test("RP17: each draw names its melt, so the store register cannot cancel it on its own (PL7RR)", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const r = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    const [txn] = await env.db.select().from(storeTxn).where(and(eq(storeTxn.companyId, p.companyId), eq(storeTxn.kind, "mrs")));
    expect(txn).toMatchObject({ sourceType: "melt", sourceId: r.id, refId: c.id });
    await expect(p.storekeeper.store.cancel({ txnId: txn!.id, reason: "x" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("cancel the melt instead"),
    });
    expect(await storeBalance(p.companyId, p.fluxId)).toBe(88 * U);
    // the melt's own cancel returns it
    await p.supervisor.foundry.melts.cancel({ meltId: r.id, reason: "x" });
    expect(await storeBalance(p.companyId, p.fluxId)).toBe(100 * U);
  });

  test("RP17: a chemical the store cannot cover refuses the WHOLE melt — no melt, no ledger, no MRS, no lot draw", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await expect(
      p.foundry.foundry.melts.create(
        meltPayload(c.id, lot.id, p, { chemicals: [{ storeItemId: p.fluxId, openMilli: 200 * U, usedMilli: 150 * U, closeMilli: 50 * U }] }),
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Cover flux") });
    expect(await meltsOf(p.companyId)).toEqual([]);
    expect(await ledger(p.companyId, { voucherType: "melt" })).toEqual([]);
    expect((await env.db.select().from(storeTxn).where(and(eq(storeTxn.companyId, p.companyId), eq(storeTxn.kind, "mrs"))))).toEqual([]);
    expect(await remainingOf(p, lot.id)).toBe(20_000 * KG);
    expect((await castRow(c.id)).meltCount).toBe(0);
  });

  test("RP17 RACE: the store is drained after the melt read it — the melt batch fails whole and says why", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    env.beforeNextBatch(() => p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 95 * U, purpose: "other" }));
    await expect(p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Cover flux"),
    });
    expect(await meltsOf(p.companyId)).toEqual([]);
    expect(await ledger(p.companyId, { voucherType: "melt" })).toEqual([]);
    expect(await storeBalance(p.companyId, p.fluxId)).toBe(5 * U);
  });

  test("chemicals: close must equal open − used; store lines need a positive draw; free text needs a name", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const bad: MeltInput["chemicals"][] = [
      [{ storeItemId: p.fluxId, openMilli: 20 * U, usedMilli: 12 * U, closeMilli: 9 * U }],
      [{ storeItemId: p.fluxId, openMilli: 20 * U, usedMilli: 0, closeMilli: 20 * U }],
      [{ openMilli: 1, usedMilli: 1, closeMilli: 0 }],
      [{ storeItemId: p.fluxId, openMilli: 20 * U, usedMilli: 1.5 as never, closeMilli: 0 }],
    ];
    for (const chemicals of bad) {
      await expect(p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p, { chemicals }))).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
    expect(await meltsOf(p.companyId)).toEqual([]);
  });

  test("a melt with no chemicals at all is fine", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const r = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p, { chemicals: [] }));
    expect(r.mrsNumbers).toEqual([]);
  });

  test("melts within a cast are numbered 1, 2, 3", async () => {
    const p = await plant();
    const lot = await okLot(p, 40_000);
    const c = await openCast(p);
    const seqs: number[] = [];
    for (let i = 0; i < 3; i += 1) seqs.push((await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p))).seq);
    expect(seqs).toEqual([1, 2, 3]);
  });
});

// ---------------------------------------------------------------------------
// Melts: validation and lot rules
// ---------------------------------------------------------------------------

describe("melts.create validation", () => {
  test("a lot can be drawn only up to its remaining kg; nothing is written when it is short", async () => {
    const p = await plant();
    const lot = await okLot(p, 15_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    await expect(p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("5,000"),
    });
    expect(await meltsOf(p.companyId)).toHaveLength(1);
    expect(await remainingOf(p, lot.id)).toBe(5_000 * KG);
  });

  test("RACE: two melts draw the same lot — the second batch loses and writes nothing", async () => {
    const p = await plant();
    const lot = await okLot(p, 15_000);
    const c = await openCast(p);
    env.beforeNextBatch(() => p.supervisor.foundry.melts.create(meltPayload(c.id, lot.id, p)));
    await expect(p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("left"),
    });
    expect(await meltsOf(p.companyId)).toHaveLength(1);
    expect(sum(await ledger(p.companyId, { voucherType: "melt" }))).toBe(-280 * KG);
    expect(await storeBalance(p.companyId, p.fluxId)).toBe(88 * U);
  });

  test("lots must be OK; a lot listed twice, another company's lot, or an unknown stream is refused", async () => {
    const p = await plant();
    const q = await plant();
    const c = await openCast(p);
    const booked = await p.storekeeper.purchase.lots.create({
      vendorId: p.vendorId, date: "2026-10-01", itemId: p.itemId, grade: "A",
      partyKgG: 5_000 * KG, fcKgG: 5_000 * KG, ratePaise: 18_500, billBook: "main",
    });
    const ok = await okLot(p, 20_000);
    const theirs = await okLot(q, 20_000);
    const inputs = (ins: MeltInput["inputs"]) => meltPayload(c.id, ok.id, p, { inputs: ins });
    await expect(p.foundry.foundry.melts.create(inputs([{ kind: "lot", ref: booked.id, kgG: 1_000 * KG }]))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      p.foundry.foundry.melts.create(inputs([{ kind: "lot", ref: ok.id, kgG: 1_000 * KG }, { kind: "lot", ref: ok.id, kgG: 1_000 * KG }])),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.foundry.foundry.melts.create(inputs([{ kind: "lot", ref: theirs.id, kgG: 1_000 * KG }]))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.foundry.foundry.melts.create(inputs([{ kind: "return_stream", ref: q.stream("INGOT"), kgG: KG }]))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.foundry.foundry.melts.create(inputs([]))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await meltsOf(p.companyId)).toEqual([]);
  });

  test("by-product streams (dross, Fe) cannot be charged; a retired stream cannot be used", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await expect(
      p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p, { inputs: [{ kind: "return_stream", ref: p.stream("DROSS"), kgG: KG }] })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.manager.foundry.returnStreams.update({ id: p.stream("PIT-METAL"), active: false });
    await expect(
      p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p, { inputs: [{ kind: "return_stream", ref: p.stream("PIT-METAL"), kgG: KG }] })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("the five times must run in order, not in the future, within 3 days; LDO dips are tenths of an inch", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const t = times();
    const cases: Partial<MeltInput>[] = [
      { timestamps: { ...t, chargingStart: t.preheatStart - 1 } },
      { timestamps: { ...t, castingEnd: t.castingStart - 1 } },
      { timestamps: times(NOW.getTime() + H) },
      { timestamps: { ...t, preheatStart: t.castingEnd - 73 * H } },
      { ldoTenthIn: { start: -1, end: 10 } },
      { ldoTenthIn: { start: 10.5 as never, end: 10 } },
    ];
    for (const over of cases) {
      await expect(p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p, over))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(await meltsOf(p.companyId)).toEqual([]);
  });

  test("logs need pcs, length and kg together; the melt's alloy must be the cast's", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const out = meltPayload(c.id, lot.id, p).outputs;
    await expect(
      p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p, { outputs: { ...out, logs: { pcs: 10, lengthMm: 0, kgG: 100 * KG } } })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p, { outputs: { ...out, logs: { pcs: 0, lengthMm: 6_000, kgG: 100 * KG } } })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p, { alloy: "6061" }))).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p, { alloy: "6063" }))).seq).toBe(1);
  });

  test("no melts on a closed or closing cast, or on another company's cast", async () => {
    const p = await plant();
    const q = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.supervisor.foundry.casts.close({ castId: c.id });
    await expect(p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const qc = await openCast(q);
    await expect(p.foundry.foundry.melts.create(meltPayload(qc.id, lot.id, p))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("RACE: the cast is closed after the melt read it open — the melt does not land", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    env.beforeNextBatch(() => p.supervisor.foundry.casts.close({ castId: c.id }));
    await expect(p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("closed"),
    });
    expect(await meltsOf(p.companyId)).toEqual([]);
    expect(await ledger(p.companyId, { voucherType: "melt" })).toEqual([]);
    expect(await storeBalance(p.companyId, p.fluxId)).toBe(100 * U);
  });

  test("a double tap with the same clientRequestId returns the first melt and posts once", async () => {
    const p = await plant();
    const lot = await okLot(p, 30_000);
    const c = await openCast(p);
    const a = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p, { clientRequestId: "m-1" }));
    const b = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p, { clientRequestId: "m-1" }));
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ seq: 1, balanceBp: 255 });
    expect(await meltsOf(p.companyId)).toHaveLength(1);
    expect(sum(await ledger(p.companyId, { voucherType: "melt" }))).toBe(-280 * KG);
  });

  test("the same clientRequestId for a different cast is a CONFLICT, not a silent replay", async () => {
    const p = await plant();
    const lot = await okLot(p, 30_000);
    const c1 = await openCast(p);
    const c2 = await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(c1.id, lot.id, p, { clientRequestId: "m-9" }));
    await expect(p.foundry.foundry.melts.create(meltPayload(c2.id, lot.id, p, { clientRequestId: "m-9" }))).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(p.foundry.foundry.casts.open({ alloy: "6061", clientRequestId: "x-1" })).resolves.toBeTruthy();
    await expect(p.foundry.foundry.casts.open({ alloy: "6063", clientRequestId: "x-1" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("no billet store or plant-scrap location: BAD_REQUEST before anything is written", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.manager.stock.locations.update({ id: p.loc("BILLET"), active: false });
    await expect(p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p))).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("billet store"),
    });
    expect(await meltsOf(p.companyId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Melt balance (spec P15)
// ---------------------------------------------------------------------------

describe("melt balance: outside 3 % warns and is stored, never silently passes", () => {
  test("4 % loss: the melt lands with a loss_high warning stored on it", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const base = meltPayload(c.id, lot.id, p);
    const r = await p.foundry.foundry.melts.create({
      ...base,
      inputs: [{ kind: "lot", ref: lot.id, kgG: 10_000 * KG }],
      outputs: { logs: { pcs: 35, lengthMm: 6_000, kgG: 9_400 * KG }, drossG: 200 * KG, feG: 0, returns: [] },
      balanceNote: "Wet scrap",
    });
    expect(r.balanceBp).toBe(400);
    expect(r.warnings).toEqual([{ code: "loss_high", lossBp: 400, limitBp: 300 }]);
    const [m] = await meltsOf(p.companyId);
    expect(m!.warnings).toEqual([{ code: "loss_high", lossBp: 400, limitBp: 300 }]);
    expect(m!).toMatchObject({ allowedBurnG: 300 * KG, balanceNote: "Wet scrap" });
  });

  test("more out than in warns out_exceeds_in", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const r = await p.foundry.foundry.melts.create({
      ...meltPayload(c.id, lot.id, p),
      inputs: [{ kind: "lot", ref: lot.id, kgG: 10_000 * KG }],
      outputs: { logs: { pcs: 38, lengthMm: 6_000, kgG: 10_100 * KG }, drossG: 0, feG: 0, returns: [] },
    });
    expect(r.warnings.map((w) => w.code)).toEqual(["out_exceeds_in"]);
    expect(r.balanceBp).toBe(-100);
  });

  test("streams have no opening yet: charging one with no stock lands, and its balance shows negative on the list", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const r = await p.foundry.foundry.melts.create(
      meltPayload(c.id, lot.id, p, {
        inputs: [
          { kind: "lot", ref: lot.id, kgG: 10_000 * KG },
          { kind: "return_stream", ref: p.stream("INGOT"), kgG: 1_000 * KG },
        ],
      }),
    );
    expect(r.warnings).toEqual([]);
    const { items } = await p.viewer.foundry.returnStreams.list();
    const by = Object.fromEntries(items.map((s) => [s.code, s.balanceG]));
    expect(by).toMatchObject({ INGOT: -1_000 * KG, DROSS: 200 * KG, FE: 20 * KG, "PLANT-SCRAP": 50 * KG });
  });
});

// ---------------------------------------------------------------------------
// Melt cancel
// ---------------------------------------------------------------------------

describe("melts.cancel: reversal rows, never edits", () => {
  test("reverses every posting, returns the store draw and the lot kg; the melt keeps its number", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    await p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "Entered twice" });
    const orig = await ledger(p.companyId, { voucherType: "melt", voucherId: m.id });
    const rev = await ledger(p.companyId, { voucherType: "melt_cancel", voucherId: m.id });
    expect(rev).toHaveLength(orig.length);
    expect(rev.map((r) => r.reversalOf).sort()).toEqual(orig.map((o) => o.id).sort());
    expect(sum(orig) + sum(rev)).toBe(0);
    expect(await storeBalance(p.companyId, p.fluxId)).toBe(100 * U);
    expect(await remainingOf(p, lot.id)).toBe(20_000 * KG);
    const [row] = await meltsOf(p.companyId);
    expect(row).toMatchObject({ seq: 1, cancelReason: "Entered twice" });
    expect(row!.cancelledAt).toBeInstanceOf(Date);
    const mrs = await env.db.select().from(storeTxn).where(and(eq(storeTxn.companyId, p.companyId), eq(storeTxn.kind, "mrs")));
    expect(mrs.every((t) => t.cancelledAt !== null)).toBe(true);
    // the next melt is number 2, and the cancelled one no longer counts in the cast
    const m2 = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    expect(m2.seq).toBe(2);
    const got = await p.viewer.foundry.casts.get({ id: c.id });
    expect(got.closeout.inputG).toBe(11_000 * KG);
    await expect(p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "again" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await auditActions(p.companyId)).toContain("melt.cancel");
  });

  test("refused once the cast's billets have been pressed below what the melt made", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    // a press run (PL-9) consumed 1 t of this cast's billets
    await env.db.insert(stockLedger).values({
      id: crypto.randomUUID(), companyId: p.companyId, serverSeq: 0, voucherType: "move", voucherId: crypto.randomUUID(),
      line: 1, itemKind: "billet", itemRef: c.id, locationId: p.loc("BILLET"), qtyG: -1_000 * KG, postedAt: new Date(),
    });
    await expect(p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "x" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("billets"),
    });
    expect(await ledger(p.companyId, { voucherType: "melt_cancel" })).toEqual([]);
    expect((await meltsOf(p.companyId))[0]!.cancelledAt).toBeNull();
  });

  test("never returns a draw onto a retired store item: reactivate it first (ruling PL7RR)", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const tabs = await p.storekeeper.store.items.create({ name: "Degasser tablets", unit: "kg", category: "chemical" });
    await p.storekeeper.store.receive({ itemId: tabs.id, qtyMilli: 3 * U });
    const m = await p.foundry.foundry.melts.create(
      meltPayload(c.id, lot.id, p, { chemicals: [{ storeItemId: tabs.id, openMilli: 3 * U, usedMilli: 3 * U, closeMilli: 0 }] }),
    );
    // used up by the melt, so the storekeeper may retire it
    await p.storekeeper.store.items.update({ id: tabs.id, active: false });
    await expect(p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "x" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Degasser tablets"),
    });
    expect(await ledger(p.companyId, { voucherType: "melt_cancel" })).toEqual([]);
    expect(await storeBalance(p.companyId, tabs.id)).toBe(0);
    expect((await meltsOf(p.companyId))[0]!.cancelledAt).toBeNull();
    await p.storekeeper.store.items.update({ id: tabs.id, active: true });
    await p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "x" });
    expect(await storeBalance(p.companyId, tabs.id)).toBe(3 * U);
  });

  test("RACE: the store item is retired after the cancel read it — the cancel does not land", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const tabs = await p.storekeeper.store.items.create({ name: "Degasser tablets", unit: "kg", category: "chemical" });
    await p.storekeeper.store.receive({ itemId: tabs.id, qtyMilli: 3 * U });
    const m = await p.foundry.foundry.melts.create(
      meltPayload(c.id, lot.id, p, { chemicals: [{ storeItemId: tabs.id, openMilli: 3 * U, usedMilli: 3 * U, closeMilli: 0 }] }),
    );
    env.beforeNextBatch(() => p.storekeeper.store.items.update({ id: tabs.id, active: false }));
    await expect(p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "x" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Degasser tablets"),
    });
    expect(await ledger(p.companyId, { voucherType: "melt_cancel" })).toEqual([]);
    expect(await storeBalance(p.companyId, tabs.id)).toBe(0);
    expect((await meltsOf(p.companyId))[0]!.cancelledAt).toBeNull();
  });

  test("never returns a draw into a retired store location: reactivate it first", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(
      meltPayload(c.id, lot.id, p, { chemicals: [{ storeItemId: p.fluxId, openMilli: 100 * U, usedMilli: 100 * U, closeMilli: 0 }] }),
    );
    await p.storekeeper.store.issue({ itemId: p.ldoId, qtyMilli: 1_000 * U, purpose: "other" });
    // the store is empty now, so it can be retired
    await p.owner.stock.locations.update({ id: p.loc("STORE"), active: false });
    await expect(p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "x" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("STORE"),
    });
    expect(await ledger(p.companyId, { voucherType: "melt_cancel" })).toEqual([]);
    expect(await storeBalance(p.companyId, p.fluxId)).toBe(0);
    await p.owner.stock.locations.update({ id: p.loc("STORE"), active: true });
    await p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "x" });
    expect(await storeBalance(p.companyId, p.fluxId)).toBe(100 * U);
  });

  test("only cast.enter / cast.close holders cancel; never on a closed cast; NOT_FOUND across companies", async () => {
    const p = await plant();
    const q = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    for (const role of ROLES.filter((r) => !can(r, "cast.enter") && !can(r, "cast.close"))) {
      await expect(p[role].foundry.melts.cancel({ meltId: m.id, reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(q.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await p.supervisor.foundry.casts.close({ castId: c.id });
    await expect(p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ---------------------------------------------------------------------------
// Review Focus 4: cast close-out
// ---------------------------------------------------------------------------

describe("Review Focus 4: cast close-out explains the tail", () => {
  test("a cast whose melts stayed inside 3 % closes directly: billets on hand + by-products + burn explain it", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    const preview = (await p.viewer.foundry.casts.get({ id: c.id })).closeout;
    expect(preview).toMatchObject({
      inputG: 11_000 * KG, logsG: 10_450 * KG, byproductG: 270 * KG, allowedBurnG: 280 * KG, excessBurnG: 0,
      bundlesG: 0, pressReturnsG: 0, billetsOnHandG: 10_450 * KG, tailG: 0, tailBp: 0, needsReason: false,
    });
    const r = await p.supervisor.foundry.casts.close({ castId: c.id });
    expect(r).toMatchObject({ status: "closed", tailG: 0, tailBp: 0, approvalId: null });
    const row = await castRow(c.id);
    expect(row).toMatchObject({ status: "closed", tailG: 0, closedBy: p.users.supervisor.id, closeRequestedBy: p.users.supervisor.id });
    expect(row.closeSummary).toMatchObject({ inputG: 11_000 * KG, billetsOnHandG: 10_450 * KG, tailG: 0 });
    expect(await auditActions(p.companyId)).toContain("cast.close");
    await expect(p.supervisor.foundry.casts.close({ castId: c.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("bundles packed from the cast and billets pressed away keep the tail explained", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    // PL-9 stand-in: 4,000 kg of billets pressed into four bundles (one dispatched, one void)
    await env.db.insert(stockLedger).values({
      id: crypto.randomUUID(), companyId: p.companyId, serverSeq: 0, voucherType: "move", voucherId: crypto.randomUUID(),
      line: 1, itemKind: "billet", itemRef: c.id, locationId: p.loc("BILLET"), qtyG: -4_000 * KG, postedAt: new Date(),
    });
    const dieId = await env.seedDie(p.companyId);
    const bs = await env.seedBundles(p.companyId, dieId, 4);
    await env.db.update(bundle).set({ castId: c.id, weightG: 1_000 * KG }).where(inArray(bundle.id, bs.slice(0, 3).map((b) => b.id)));
    await env.db.update(bundle).set({ status: "dispatched" }).where(eq(bundle.id, bs[0]!.id));
    await env.db.update(bundle).set({ castId: c.id, weightG: 9_999 * KG, status: "void" }).where(eq(bundle.id, bs[3]!.id));
    const close = (await p.viewer.foundry.casts.get({ id: c.id })).closeout;
    // 3 t in live bundles, 1 t unaccounted: 1,000 / 11,000 = 9.09 %
    expect(close).toMatchObject({ bundlesG: 3_000 * KG, billetsOnHandG: 6_450 * KG, tailG: 1_000 * KG, tailBp: 909, needsReason: true });
  });

  test("a tail above 1 % without a reason is refused; with one the cast waits for a second person", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    // 6 % loss: 3 % is burn, the other 3 % (300 kg) is the tail
    await p.foundry.foundry.melts.create({
      ...meltPayload(c.id, lot.id, p),
      inputs: [{ kind: "lot", ref: lot.id, kgG: 10_000 * KG }],
      outputs: { logs: { pcs: 35, lengthMm: 6_000, kgG: 9_400 * KG }, drossG: 0, feG: 0, returns: [] },
    });
    await expect(p.supervisor.foundry.casts.close({ castId: c.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("reason"),
    });
    expect((await castRow(c.id)).status).toBe("open");
    const r = await p.supervisor.foundry.casts.close({ castId: c.id, tailReason: "Furnace lining repair, metal in the pit" });
    expect(r).toMatchObject({ status: "closing", tailG: 300 * KG, tailBp: 300 });
    expect(r.approvalId).toBeTruthy();
    const [ap] = await env.db.select().from(approval).where(eq(approval.subjectId, c.id));
    expect(ap).toMatchObject({ kind: "cast_close", status: "pending", requestNote: "Furnace lining repair, metal in the pit" });
    expect(ap!.meta).toMatchObject({ number: "J1", tailG: 300 * KG, tailBp: 300 });
    // no melts while closing
    await expect(p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // the requester cannot approve; foundry (approver for cast_close) can
    await expect(p.supervisor.approval.decide({ id: ap!.id, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.foundry.approval.decide({ id: ap!.id, decision: "approved" });
    const row = await castRow(c.id);
    expect(row).toMatchObject({ status: "closed", tailG: 300 * KG, tailBp: 300, closedBy: p.users.foundry.id, closeApprovalId: ap!.id });
    expect(row.closedAt).toBeInstanceOf(Date);
  });

  test("a rejected close-out puts the cast back to open; melts can be added again", async () => {
    const p = await plant();
    const lot = await okLot(p, 30_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create({
      ...meltPayload(c.id, lot.id, p),
      inputs: [{ kind: "lot", ref: lot.id, kgG: 10_000 * KG }],
      outputs: { logs: { pcs: 35, lengthMm: 6_000, kgG: 9_400 * KG }, drossG: 0, feG: 0, returns: [] },
    });
    const r = await p.manager.foundry.casts.close({ castId: c.id, tailReason: "Unknown" });
    await p.foundry.approval.decide({ id: r.approvalId!, decision: "rejected", note: "Find the metal first" });
    const row = await castRow(c.id);
    expect(row).toMatchObject({ status: "open", closedAt: null, closedBy: null });
    expect((await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p))).seq).toBe(2);
  });

  test("RACE: a melt lands after the close read the tail — the close does not land", async () => {
    const p = await plant();
    const lot = await okLot(p, 30_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    // the racing melt loses 6 %: the tail the close read (0) is no longer true
    env.beforeNextBatch(() =>
      p.foundry.foundry.melts.create({
        ...meltPayload(c.id, lot.id, p),
        inputs: [{ kind: "lot", ref: lot.id, kgG: 10_000 * KG }],
        outputs: { logs: { pcs: 35, lengthMm: 6_000, kgG: 9_400 * KG }, drossG: 0, feG: 0, returns: [] },
      }),
    );
    await expect(p.supervisor.foundry.casts.close({ castId: c.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("changed"),
    });
    expect((await castRow(c.id)).status).toBe("open");
    expect((await auditActions(p.companyId)).filter((a) => a === "cast.close")).toEqual([]);
  });

  test("RACE: billets disappear after the close read the tail — a no-reason close does not land", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    env.beforeNextBatch(async () => {
      await env.db.insert(stockLedger).values({
        id: crypto.randomUUID(), companyId: p.companyId, serverSeq: 0, voucherType: "move", voucherId: crypto.randomUUID(),
        line: 1, itemKind: "billet", itemRef: c.id, locationId: p.loc("BILLET"), qtyG: -2_000 * KG, postedAt: new Date(),
      });
    });
    await expect(p.supervisor.foundry.casts.close({ castId: c.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await castRow(c.id)).status).toBe("open");
  });

  test("an empty cast (opened by mistake) closes with a zero tail", async () => {
    const p = await plant();
    const c = await openCast(p);
    expect(await p.manager.foundry.casts.close({ castId: c.id })).toMatchObject({ status: "closed", tailG: 0, tailBp: null });
  });

  test("tenant isolation: an approval in another company that names this cast changes nothing", async () => {
    const p = await plant();
    const q = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create({
      ...meltPayload(c.id, lot.id, p),
      inputs: [{ kind: "lot", ref: lot.id, kgG: 10_000 * KG }],
      outputs: { logs: { pcs: 35, lengthMm: 6_000, kgG: 9_400 * KG }, drossG: 0, feG: 0, returns: [] },
    });
    const r = await p.supervisor.foundry.casts.close({ castId: c.id, tailReason: "pit" });
    // a forged request in company q pointing at p's cast (and even at p's approval id)
    const forged = crypto.randomUUID();
    await env.db.insert(approval).values({ id: forged, companyId: q.companyId, kind: "cast_close", subjectId: c.id, requestedBy: q.users.supervisor.id });
    await q.foundry.approval.decide({ id: forged, decision: "approved" });
    expect(await castRow(c.id)).toMatchObject({ status: "closing", closedAt: null, closeApprovalId: r.approvalId });
  });

  test("only cast.close holders close (supervisor, manager, owner); NOT_FOUND across companies", async () => {
    const p = await plant();
    const q = await plant();
    const c = await openCast(p);
    for (const role of ROLES.filter((r) => !can(r, "cast.close"))) {
      await expect(p[role].foundry.casts.close({ castId: c.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(q.supervisor.foundry.casts.close({ castId: c.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await castRow(c.id)).status).toBe("open");
    expect(can("foundry", "cast.close")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RP9: rate-free lot list for the foundry
// ---------------------------------------------------------------------------

describe("RP9: lots.available — remaining kg by lot and grade, no commercial figures", () => {
  test("cast.enter holders read it; it carries no rate, party kg, vendor or notes; fully used lots drop out", async () => {
    const p = await plant();
    const a = await okLot(p, 10_000);
    const b = await okLot(p, 7_000, { itemId: p.cableId, grade: "B" });
    await okLot(p, 3_000);
    const c = await openCast(p);
    await p.foundry.foundry.melts.create(meltPayload(c.id, a.id, p));
    const res = await p.foundry.foundry.lots.available();
    expect(res.lots.map((l) => l.number)).toEqual([b.number, expect.any(String)]);
    const lotB = res.lots.find((l) => l.id === b.id)!;
    expect(lotB).toMatchObject({ itemName: "SOFT CABLE", gradeCode: "B", locationCode: "SCRAP", stockG: 7_000 * KG, drawnG: 0, remainingG: 7_000 * KG });
    for (const key of ["ratePaise", "partyKgG", "vendorId", "vendorName", "amountPaise", "notes", "partyBillNo"]) {
      expect(Object.keys(lotB)).not.toContain(key);
    }
    expect(res.byGrade).toEqual([
      expect.objectContaining({ itemName: "IMP BELLING", gradeCode: "A", remainingG: 3_000 * KG, lots: 1 }),
      expect.objectContaining({ itemName: "SOFT CABLE", gradeCode: "B", remainingG: 7_000 * KG, lots: 1 }),
    ]);
    for (const role of ROLES) {
      const allowed = ["cast.enter", "cast.close", "purchase.receipt", "purchase.dcnote", "reports.read", "masters.publish"].some((x) =>
        can(role, x as Action),
      );
      const call = p[role].foundry.lots.available();
      if (allowed) await expect(call).resolves.toBeTruthy();
      else await expect(call).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("tenant isolation: another company's lots never show", async () => {
    const p = await plant();
    const q = await plant();
    await okLot(p, 10_000);
    expect((await q.foundry.foundry.lots.available()).lots).toEqual([]);
  });

  test("a lot a live melt has drawn from cannot be cancelled, even if the grade still has stock; after the melt is cancelled it can", async () => {
    const p = await plant();
    const a = await okLot(p, 20_000);
    await okLot(p, 20_000); // same item + grade: the grade's stock alone would still cover a's 20 t
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(meltPayload(c.id, a.id, p));
    await expect(p.manager.purchase.lots.cancel({ id: a.id, reason: "wrong vendor" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.supervisor.foundry.melts.cancel({ meltId: m.id, reason: "wrong lot" });
    await expect(p.manager.purchase.lots.cancel({ id: a.id, reason: "wrong vendor" })).resolves.toMatchObject({ status: "cancelled" });
  });
});

// ---------------------------------------------------------------------------
// Spectro
// ---------------------------------------------------------------------------

describe("spectro.attach (Stage 4): file ≤ 1 MB as base64 + parsed values in ppm", () => {
  const png = Buffer.from("fake-png-bytes").toString("base64");

  test("stores the file and values; casts.get lists it without the file; file returns it", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    const s = await p.foundry.foundry.spectro.attach({
      meltId: m.id, fileName: "K31-1.png", mime: "image/png", base64: png, values: { Si: 0.45, Fe: 0.18, Mg: 0.52, Cu: 0.0012 },
    });
    const [row] = await env.db.select().from(spectroResult).where(eq(spectroResult.id, s.id));
    expect(row).toMatchObject({ castId: c.id, meltId: m.id, sizeBytes: 14, valuesPpm: { Si: 4500, Fe: 1800, Mg: 5200, Cu: 12 } });
    const got = await p.viewer.foundry.casts.get({ id: c.id });
    const listed = got.melts[0]!.spectro[0]!;
    expect(listed).toMatchObject({ id: s.id, fileName: "K31-1.png", values: { Si: 0.45, Fe: 0.18, Mg: 0.52, Cu: 0.0012 } });
    expect(Object.keys(listed)).not.toContain("dataBase64");
    expect(await p.viewer.foundry.spectro.file({ id: s.id })).toMatchObject({ mime: "image/png", base64: png });
    expect(await auditActions(p.companyId)).toContain("spectro.attach");
  });

  test("rejects files over 1 MB, unknown types, broken base64 and bad values; NOT_FOUND across companies", async () => {
    const p = await plant();
    const q = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    const big = Buffer.alloc(1_048_577, 1).toString("base64");
    const bad = [
      { base64: big },
      { mime: "application/x-msdownload" },
      { base64: "not base64!!" },
      { values: { Si: -1 } },
      { values: { "Si; drop": 1 } },
      { fileName: "" },
    ];
    for (const over of bad) {
      await expect(
        p.foundry.foundry.spectro.attach({ meltId: m.id, fileName: "a.png", mime: "image/png", base64: png, values: {}, ...over } as never),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(
      q.foundry.foundry.spectro.attach({ meltId: m.id, fileName: "a.png", mime: "image/png", base64: png, values: {} }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const ok = await p.foundry.foundry.spectro.attach({ meltId: m.id, fileName: "a.png", mime: "image/png", base64: png, values: {} });
    await expect(q.viewer.foundry.spectro.file({ id: ok.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("exactly 1 MB is accepted", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    const mb = Buffer.alloc(1_048_576, 7).toString("base64");
    const s = await p.supervisor.foundry.spectro.attach({ meltId: m.id, fileName: "scan.pdf", mime: "application/pdf", base64: mb, values: {} });
    expect((await env.db.select().from(spectroResult).where(eq(spectroResult.id, s.id)))[0]!.sizeBytes).toBe(1_048_576);
  });
});

// ---------------------------------------------------------------------------
// Permission matrix, params, tenant isolation
// ---------------------------------------------------------------------------

describe("permission matrix for foundry actions (digest §4.2)", () => {
  test("casts.open, melts.create and spectro.attach need cast.enter (foundry, supervisor, owner)", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const m = await p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p));
    for (const role of ROLES) {
      const allowed = can(role, "cast.enter");
      expect({ role, allowed }).toEqual({ role, allowed: ["foundry", "supervisor", "owner"].includes(role) });
      const open = p[role].foundry.casts.open({ alloy: "6063" });
      if (allowed) await expect(open).resolves.toMatchObject({ number: expect.any(String) });
      else await expect(open).rejects.toMatchObject({ code: "FORBIDDEN" });
      const create = p[role].foundry.melts.create(meltPayload("no-such-cast", lot.id, p));
      await expect(create).rejects.toMatchObject({ code: allowed ? "NOT_FOUND" : "FORBIDDEN" });
      const attach = p[role].foundry.spectro.attach({ meltId: m.id, fileName: "a.csv", mime: "text/csv", base64: "", values: { Si: 0.4 } });
      if (allowed) await expect(attach).resolves.toMatchObject({ id: expect.any(String) });
      else await expect(attach).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("reads (casts, streams) are open to every member", async () => {
    const p = await plant();
    await openCast(p);
    for (const role of ROLES) {
      expect((await p[role].foundry.casts.list({})).items).toHaveLength(1);
      expect((await p[role].foundry.returnStreams.list()).items).toHaveLength(11);
    }
  });
});

describe("D1 limits and invariants", () => {
  test("a melt with 60 input lines and 40 store chemicals stays within 100 bound parameters", async () => {
    const p = await plant();
    const c = await openCast(p);
    const lots = [];
    for (let i = 0; i < 50; i += 1) lots.push(await okLot(p, 1_000));
    const chems = [];
    for (let i = 0; i < 40; i += 1) {
      const it = await p.storekeeper.store.items.create({ name: `Chem ${i}`, unit: "kg", category: "chemical" });
      await p.storekeeper.store.receive({ itemId: it.id, qtyMilli: 10 * U });
      chems.push({ storeItemId: it.id, openMilli: 5 * U, usedMilli: 2 * U, closeMilli: 3 * U });
    }
    const streamCodes = ["INGOT", "PLANT-SCRAP", "DISCARD", "DROSS-INGOT", "BEND-LOG", "HILL-METAL", "PIT-METAL", "TENDIS", "DROSS-METAL"];
    const inputs: MeltInput["inputs"] = [
      ...lots.map((l) => ({ kind: "lot" as const, ref: l.id, kgG: 900 * KG })),
      ...streamCodes.map((code) => ({ kind: "return_stream" as const, ref: p.stream(code), kgG: 100 * KG })),
      { kind: "return_stream" as const, ref: (await p.manager.foundry.returnStreams.create({ code: "CHIPS", name: "Chips", kind: "charge" })).id, kgG: 100 * KG },
    ];
    expect(inputs).toHaveLength(60);
    env.resetPeakParams();
    const r = await p.foundry.foundry.melts.create({
      ...meltPayload(c.id, lots[0]!.id, p),
      inputs,
      chemicals: chems,
      outputs: {
        logs: { pcs: 160, lengthMm: 6_000, kgG: 44_000 * KG },
        drossG: 900 * KG,
        feG: 50 * KG,
        returns: streamCodes.map((code) => ({ streamId: p.stream(code), kgG: 10 * KG })),
      },
    });
    expect(env.peakParams()).toBeLessThanOrEqual(100);
    expect(r.mrsNumbers).toHaveLength(40);
    expect(await ledger(p.companyId, { voucherType: "melt", voucherId: r.id })).toHaveLength(60 + 3 + 9);
    // and its cancel too
    env.resetPeakParams();
    await p.supervisor.foundry.melts.cancel({ meltId: r.id, reason: "test" });
    expect(env.peakParams()).toBeLessThanOrEqual(100);
    expect(sum(await ledger(p.companyId, { voucherId: r.id }))).toBe(0);
  }, 120_000);

  test("more than 60 inputs or 40 chemicals is BAD_REQUEST", async () => {
    const p = await plant();
    const lot = await okLot(p, 20_000);
    const c = await openCast(p);
    const many = Array.from({ length: 61 }, () => ({ kind: "return_stream" as const, ref: p.stream("INGOT"), kgG: KG }));
    await expect(p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p, { inputs: many }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const chems = Array.from({ length: 41 }, (_, i) => ({ name: `C${i}`, openMilli: 1, usedMilli: 1, closeMilli: 0 }));
    await expect(p.foundry.foundry.melts.create(meltPayload(c.id, lot.id, p, { chemicals: chems }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("scrap ledger stays = OK postings − live melt draws, per lot, after melts and a cancel", async () => {
    const p = await plant();
    const a = await okLot(p, 30_000);
    const c = await openCast(p);
    const m1 = await p.foundry.foundry.melts.create(meltPayload(c.id, a.id, p));
    await p.foundry.foundry.melts.create(meltPayload(c.id, a.id, p));
    await p.supervisor.foundry.melts.cancel({ meltId: m1.id, reason: "x" });
    const scrap = sum(await ledger(p.companyId, { itemKind: "scrap_grade" }));
    const inputs = await env.db
      .select({ kgG: meltInput.kgG, cancelledAt: melt.cancelledAt })
      .from(meltInput)
      .innerJoin(melt, eq(melt.id, meltInput.meltId))
      .where(and(eq(meltInput.companyId, p.companyId), eq(meltInput.lotId, a.id)));
    const drawn = inputs.filter((i) => i.cancelledAt === null).reduce((s, i) => s + i.kgG, 0);
    expect(scrap).toBe(30_000 * KG - drawn);
    expect(await remainingOf(p, a.id)).toBe(20_000 * KG);
    // billets on hand of the cast = Σ live melts' logs
    expect(sum((await ledger(p.companyId, { itemKind: "billet" })).filter((r) => r.itemRef === c.id))).toBe(10_450 * KG);
  });

  test("a lot's remaining kg reads its own postings by voucher, never every scrap row of the plant", async () => {
    // lots.available and every melt input line compute posted − drawn per lot. Through the item
    // index that is a scan of all scrap rows (every OK, D/C note and melt line ever) per lot.
    const { companyId } = await env.seedCompany();
    const query = env.db
      .select({ id: purchaseLot.id, left: sql`${lotPostedSql(companyId, OUTER_LOT_ID)} - ${lotDrawnSql(companyId, OUTER_LOT_ID)}` })
      .from(purchaseLot)
      .where(and(eq(purchaseLot.companyId, companyId), eq(purchaseLot.status, "ok")))
      .toSQL();
    const plan = await env.d1
      .prepare(`explain query plan ${query.sql}`)
      .bind(...query.params)
      .all<{ detail: string }>();
    const ledgerSearches = plan.results.map((r) => r.detail).filter((d) => /stock_ledger|\blp\b|\blq\b/.test(d));
    expect(ledgerSearches.length).toBeGreaterThanOrEqual(2);
    // (company, voucher type, voucher id) is the prefix of the voucher-line unique index.
    for (const d of ledgerSearches) expect(d).toContain("stock_ledger_voucher_line_unique");
  });
});
