/**
 * FINAL-FIXES-5 foundry regressions (final explorer round 2):
 * - M1: spectro values stored with element SYMBOLS ("Si", "Fe": the seed, the spool watcher) read like lowercase keys;
 *   a new result is stored with canonical keys.
 * - M2: the cast list says which casts have a failed spectro (the press cast picker warns).
 * - M3: a cast waiting for its close approval keeps the tail it asked for on the cast row (the screens show it).
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { eq } from "drizzle-orm";

import { cast, spectroResult, stockLedger } from "@orrn/db/schema";

import { createTestEnv, type TestEnv } from "./harness";
import { fillWorkedExample, kg, pressHelpers, type PressPlant } from "./press-w2-fixture";

setDefaultTimeout(60_000);

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { pressPlant } = pressHelpers(() => env);
const H = 3_600_000;

type FoundryPlant = PressPlant & {
  lot(kgs: number): Promise<{ id: string }>;
  stream(code: string): string;
  fluxId: string;
  times(): { preheatStart: number; chargingStart: number; chargingEnd: number; castingStart: number; castingEnd: number };
};

async function foundryPlant(): Promise<FoundryPlant> {
  const p = await pressPlant({});
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
  async function lot(kgs: number) {
    const l = await store.purchase.lots.create({
      vendorId: v.id, date: "2026-10-01", origin: "LOCAL", itemId: items.find((i) => i.name === "IMP BELLING")!.id, grade: "A",
      partyKgG: kg(kgs), fcKgG: kg(kgs), ratePaise: 18_500, billBook: "main",
    });
    await store.purchase.lots.advance({ id: l.id, to: "ok" });
    return { id: l.id };
  }
  const t0 = Date.now() - 8 * H;
  const times = () => ({ preheatStart: t0, chargingStart: t0 + H, chargingEnd: t0 + 3 * H, castingStart: t0 + 4 * H, castingEnd: t0 + 6 * H });
  const stream = (code: string) => streams.find((s) => s.code === code)!.id;
  await env.db.insert(stockLedger).values({
    id: crypto.randomUUID(), companyId: p.companyId, serverSeq: 0, voucherType: "opening", voucherId: crypto.randomUUID(),
    line: 1, itemKind: "return_stream", itemRef: stream("PLANT-SCRAP"), locationId: p.plantScrapId, qtyG: kg(2_000), postedAt: new Date(),
  });
  return { ...p, lot, stream, fluxId, times };
}

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

const PASS = { si: 4_500, fe: 1_800, cu: 100, mn: 100, mg: 5_200, zn: 100, ti: 100, cr: 100 };
const FAIL_FE = { ...PASS, fe: 4_100 };

describe("M1: spectro values read the same whatever the case of their keys", () => {
  test("symbol-case keys stored by older writers (Si, Fe) come back as the canonical keys, and the verdict is unchanged", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id));
    const res = await p.as("foundry").foundry.spectro.enter({ meltId: d.id, valuesPpm: FAIL_FE, entryReason: "Printer down" });
    expect(res.verdict).toBe("fail");
    // The seed and the spool watcher wrote symbol-case keys; simulate that row.
    await env.db.update(spectroResult).set({ valuesPpm: { Si: 4_500, Fe: 4_100, Cu: 100, Mn: 100, Mg: 5_200, Zn: 100, Ti: 100, Cr: 100 } }).where(eq(spectroResult.id, res.id));
    const got = await p.as("viewer").foundry.casts.get({ id: c.id });
    const listed = got.melts[0]!.spectro[0]!;
    expect(listed.values).toEqual({ si: 0.45, fe: 0.41, cu: 0.01, mn: 0.01, mg: 0.52, zn: 0.01, ti: 0.01, cr: 0.01 });
    expect(listed.verdict).toBe("fail");
  });

  test("a result attached with symbol keys is stored and listed with canonical keys, and judged the same", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id));
    const s = await p.as("foundry").foundry.spectro.attach({
      meltId: d.id, fileName: "K.csv", mime: "text/csv", base64: "", entryReason: "Printer down",
      values: { Si: 0.45, Fe: 0.41, Cu: 0.01, Mn: 0.01, Mg: 0.52, Zn: 0.01, Ti: 0.01, Cr: 0.01 },
    });
    expect(s.verdict).toBe("fail");
    const [row] = await env.db.select().from(spectroResult).where(eq(spectroResult.id, s.id));
    expect(Object.keys(row!.valuesPpm!).sort()).toEqual(["cr", "cu", "fe", "mg", "mn", "si", "ti", "zn"]);
    expect(row).toMatchObject({ siPpm: 4_500, fePpm: 4_100 });
  });
});

describe("M2: the cast list says which casts have a failed spectro", () => {
  test("spectroFailedMelts counts locked melts whose deciding result failed; a pass, a draft and a later passing result do not", async () => {
    const p = await foundryPlant();
    const f = p.as("foundry");
    const lot = await p.lot(8_000);
    const lot2 = await p.lot(8_000);
    const lot3 = await p.lot(8_000);
    const failing = await f.foundry.casts.open({ alloy: "6063" });
    const d1 = await f.foundry.melts.save(draft(p, failing.id, lot.id, { spectroReason: "Lab" }));
    await f.foundry.spectro.enter({ meltId: d1.id, valuesPpm: FAIL_FE, entryReason: "Printer down" });
    const clean = await f.foundry.casts.open({ alloy: "6063" });
    const d2 = await f.foundry.melts.save(draft(p, clean.id, lot2.id, { spectroReason: "Lab" }));
    await f.foundry.spectro.enter({ meltId: d2.id, valuesPpm: PASS, entryReason: "Printer down" });
    const draftOnly = await f.foundry.casts.open({ alloy: "6063" });
    const d3 = await f.foundry.melts.save(draft(p, draftOnly.id, lot3.id));
    await f.foundry.spectro.enter({ meltId: d3.id, valuesPpm: FAIL_FE, entryReason: "Printer down" });
    const before = await p.as("viewer").foundry.casts.list({ limit: 50 });
    // Nothing is locked yet: a failed draft is not billets.
    expect(before.items.map((c) => c.spectroFailedMelts)).toEqual([0, 0, 0]);

    await f.foundry.melts.lock({ meltId: d1.id });
    await f.foundry.melts.lock({ meltId: d2.id });
    const after = await p.as("viewer").foundry.casts.list({ limit: 50 });
    const by = (id: string) => after.items.find((c) => c.id === id)!;
    expect(by(failing.id).spectroFailedMelts).toBe(1);
    expect(by(clean.id).spectroFailedMelts).toBe(0);
    expect(by(draftOnly.id).spectroFailedMelts).toBe(0);
  });
});

describe("M3: a cast waiting for its close approval keeps the tail it asked for", () => {
  test("closing: the cast row carries tailG / tailBp (the ledger tail is still 0 until the approval); after the approval the ledger tail agrees", async () => {
    const p = await foundryPlant();
    const lot = await p.lot(8_000);
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    const d = await p.as("foundry").foundry.melts.save(draft(p, c.id, lot.id, { spectroReason: "Lab" }));
    await p.as("foundry").foundry.melts.lock({ meltId: d.id });
    const r = await p.countingRun({ pcs: 100 });
    await fillWorkedExample(p, r.runId, c.id, { planLineId: r.planLineIds[0] });
    await p.as("supervisor").press.runs.close({ id: r.runId });
    const code = (await p.as("viewer").reasonCodes.list({ kind: "cast_tail" })).find((x) => x.code === "scrapped")!.id;
    const out = await p.as("manager").foundry.casts.close({ castId: c.id, billetsOnHand: { count: 116, kgG: kg(4_500) }, reasonCodeId: code, note: "Bent logs cut up" });
    expect(out.status).toBe("closing");
    const waiting = await p.as("viewer").foundry.casts.get({ id: c.id });
    expect(waiting.cast).toMatchObject({ status: "closing", tailG: kg(339.6), tailBp: 659 });
    expect(waiting.cast.closeSummary).toMatchObject({ tailG: kg(339.6), shortG: 0 });
    // The ledger's own tail has not moved yet: this is why the screen must read the cast row while it is closing.
    expect(waiting.closeout.tailG).toBe(0);
    await p.as("owner").approval.decide({ id: out.approvalId!, decision: "approved" });
    const done = await p.as("viewer").foundry.casts.get({ id: c.id });
    expect(done.cast.status).toBe("closed");
    expect(done.closeout.tailG).toBe(kg(339.6));
    expect((await env.db.select({ s: cast.status }).from(cast).where(eq(cast.id, c.id)))[0]!.s).toBe("closed");
  });
});
