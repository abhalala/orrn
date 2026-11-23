/**
 * XE parity lane FOUNDRY (rows 41-47, 50): homogenizing batches, bought-in logs, reject registers,
 * billet cutting and issue to a press floor (the press then draws from that floor), the cast data
 * sheet facts, the charge-mix suggestion and its chemistry master. Each: the happy path, the role
 * refusal, and another plant's ids are Not found.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { auditLog, cast, stockLedger } from "@orrn/db/schema";

import { createTestEnv, type TestEnv } from "./harness";
import { fillWorkedExample, kg, pressHelpers, type PressPlant } from "./press-w2-fixture";

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

const { pressPlant } = pressHelpers(() => env);
const MIN = 60_000;

async function errOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    return { code: (e as { code?: string }).code, message: (e as Error).message };
  }
  return { code: "OK", message: "" };
}

type Plant = PressPlant & { vendorId: string; receive(o?: { pcs?: number; kgs?: number; alloy?: string }): Promise<{ id: string; number: string; castId: string }> };

async function plant(opts: { settings?: Record<string, unknown> } = {}): Promise<Plant> {
  const p = await pressPlant(opts);
  const manager = p.as("manager");
  await manager.foundry.returnStreams.seedDefaults();
  await manager.foundry.alloys.seedDefaults();
  const v = await manager.vendor.create({ name: "Balaji Billets" });
  async function receive(o: { pcs?: number; kgs?: number; alloy?: string } = {}) {
    return p.as("storekeeper").foundry.logs.receive({ vendorId: v.id, alloy: o.alloy ?? "6063", receivedOn: "2026-11-20", diameterMm: 127, lengthMm: 6_000, pcs: o.pcs ?? 10, kgG: kg(o.kgs ?? 2_000), vendorCastNo: "BB-778" });
  }
  return { ...p, vendorId: v.id, receive };
}

async function billetRows(companyId: string, castId: string) {
  return env.db.select().from(stockLedger).where(and(eq(stockLedger.companyId, companyId), eq(stockLedger.itemKind, "billet"), eq(stockLedger.itemRef, castId)));
}

async function audits(companyId: string) {
  return (await env.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.companyId, companyId))).map((a) => a.action);
}

async function rack(p: Plant, code = "RACK") {
  return (await p.as("manager").stock.locations.create({ code, name: "Billet rack", kind: "billet_rack" })).id;
}

async function floor(p: Plant) {
  return (await p.as("manager").stock.locations.create({ code: "FLOOR-P1", name: "Press 1 floor", kind: "press_floor", pressLineId: p.pressLineId })).id;
}

describe("#42 bought-in logs", () => {
  test("a receipt opens a closed bought-in cast, posts its logs at the billet store and traces to the vendor", async () => {
    const p = await plant();
    const r = await p.receive();
    expect(r.number).toBe("OL-1");
    const [c] = await env.db.select().from(cast).where(eq(cast.id, r.castId));
    expect(c).toMatchObject({ number: "OL-1", status: "closed", source: "bought_in", alloy: "6063" });
    const rows = await billetRows(p.companyId, r.castId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ voucherType: "log_receipt", locationId: p.billetStoreId, qtyG: kg(2_000) });
    const list = await p.as("viewer").foundry.logs.receipts();
    expect(list.items[0]).toMatchObject({ number: "OL-1", vendorName: "Balaji Billets", vendorCastNo: "BB-778", pcs: 10, hasMtc: false });
    // A bought-in cast takes no melts and never closes.
    expect((await errOf(p.as("foundry").foundry.casts.close({ id: r.castId, billetsOnHand: { count: 0, kgG: 0 } } as never))).code).not.toBe("OK");
    // The data sheet names the vendor lot.
    const sheet = await p.as("viewer").foundry.casts.dataSheet({ id: r.castId });
    expect(sheet.receipt).toMatchObject({ number: "OL-1", vendorName: "Balaji Billets", vendorCastNo: "BB-778" });
    expect(sheet.source).toBe("bought_in");
    expect(Object.values(sheet.people).length).toBeGreaterThan(0);
    expect(await audits(p.companyId)).toContain("foundry.logs.receive");
  });

  test("a packer is refused; another plant's receipt and vendor are Not found; a future date is refused", async () => {
    const p = await plant();
    const q = await plant();
    expect((await errOf(p.as("packer").foundry.logs.receive({ vendorId: p.vendorId, alloy: "6063", receivedOn: "2026-11-20", pcs: 1, kgG: kg(10) }))).code).toBe("FORBIDDEN");
    expect(await errOf(q.as("storekeeper").foundry.logs.receive({ vendorId: p.vendorId, alloy: "6063", receivedOn: "2026-11-20", pcs: 1, kgG: kg(10) }))).toEqual({ code: "NOT_FOUND", message: "Vendor not found" });
    const r = await p.receive();
    expect((await errOf(q.owner.foundry.logs.mtcUrl({ id: r.id }))).code).toBe("NOT_FOUND");
    expect((await errOf(q.owner.foundry.casts.dataSheet({ id: r.castId }))).code).toBe("NOT_FOUND");
    expect((await errOf(p.as("storekeeper").foundry.logs.receive({ vendorId: p.vendorId, alloy: "6063", receivedOn: "2999-01-01", pcs: 1, kgG: kg(10) }))).message).toBe("The receipt date cannot be in the future");
  });
});

describe("#41 homogenizing", () => {
  async function homogFurnace(p: Plant) {
    return (await p.as("manager").foundry.furnaces.create({ code: "HF1", name: "Homogenizing furnace", capacityG: kg(20_000), kind: "homogenizing" })).id;
  }

  test("load, in, readings, out, release; a short soak holds the batch until a reason releases it", async () => {
    const p = await plant();
    const r = await p.receive({ pcs: 10 });
    const f = await homogFurnace(p);
    const foundry = p.as("foundry");
    const b = await foundry.foundry.homog.create({ furnaceId: f, alloy: "6063", soakMin: 120 });
    expect(b.number).toBe("HB-1");
    expect(await errOf(foundry.foundry.homog.addLine({ batchId: b.id, castId: r.castId, pcs: 11, kgG: kg(100) }))).toEqual({ code: "BAD_REQUEST", message: "OL-1 has 10 logs left to homogenize" });
    await foundry.foundry.homog.addLine({ batchId: b.id, castId: r.castId, pcs: 6, kgG: kg(1_200) });
    const t0 = Date.now();
    setClock(new Date(t0));
    await foundry.foundry.homog.start({ id: b.id });
    for (let m = 0; m <= 180; m += 30) {
      setClock(new Date(t0 + m * MIN));
      await foundry.foundry.homog.reading({ batchId: b.id, tempX10: 5_800 });
    }
    const out = await foundry.foundry.homog.out({ id: b.id });
    expect(out.verdict).toBe("ok");
    expect((await errOf(foundry.foundry.homog.release({ id: b.id }))).code).toBe("FORBIDDEN");
    expect(await p.as("supervisor").foundry.homog.release({ id: b.id })).toMatchObject({ status: "released" });
    const got = await p.as("viewer").foundry.homog.get({ id: b.id });
    expect(got.batch.status).toBe("released");
    expect(got.lines[0]).toMatchObject({ castNumber: "OL-1", pcs: 6 });
    expect(got.soak?.verdict).toBe("ok");

    // A second batch with one reading: short soak → held; release with a reason.
    const b2 = await foundry.foundry.homog.create({ furnaceId: f, alloy: "6063" });
    await foundry.foundry.homog.addLine({ batchId: b2.id, castId: r.castId, pcs: 4, kgG: kg(800) });
    setClock(new Date(t0 + 300 * MIN));
    await foundry.foundry.homog.start({ id: b2.id });
    await foundry.foundry.homog.reading({ batchId: b2.id, tempX10: 5_800 });
    setClock(new Date(t0 + 330 * MIN));
    expect((await foundry.foundry.homog.out({ id: b2.id })).verdict).toBe("short");
    expect(await p.as("supervisor").foundry.homog.release({ id: b2.id })).toMatchObject({ status: "held" });
    expect((await errOf(p.as("supervisor").foundry.homog.release({ id: b2.id }))).message).toBe("Say why a held batch is released");
    expect(await p.as("manager").foundry.homog.release({ id: b2.id, note: "Lab checked the structure" })).toMatchObject({ status: "released" });
    expect(await audits(p.companyId)).toEqual(expect.arrayContaining(["foundry.homog.create", "foundry.homog.start", "foundry.homog.out", "foundry.homog.hold", "foundry.homog.release"]));
  });

  test("a melt refuses a homogenizing furnace; a batch refuses a melting furnace; one batch per furnace", async () => {
    const p = await plant();
    const f = await homogFurnace(p);
    await p.as("manager").foundry.furnaces.seedDefaults();
    const melting = (await p.as("viewer").foundry.furnaces.list()).items.find((x) => x.kind === "melting")!;
    expect((await errOf(p.as("foundry").foundry.homog.create({ furnaceId: melting.id, alloy: "6063" }))).message).toContain("is a melting furnace");
    const c = await p.as("foundry").foundry.casts.open({ alloy: "6063" });
    expect((await errOf(p.as("foundry").foundry.melts.save({ castId: c.id, furnaceId: f } as never))).message).toContain("is a homogenizing furnace");
    const r = await p.receive({ pcs: 4 });
    const a = await p.as("foundry").foundry.homog.create({ furnaceId: f, alloy: "6063" });
    const b = await p.as("foundry").foundry.homog.create({ furnaceId: f, alloy: "6063" });
    await p.as("foundry").foundry.homog.addLine({ batchId: a.id, castId: r.castId, pcs: 2, kgG: kg(400) });
    await p.as("foundry").foundry.homog.addLine({ batchId: b.id, castId: r.castId, pcs: 2, kgG: kg(400) });
    await p.as("foundry").foundry.homog.start({ id: a.id });
    expect((await errOf(p.as("foundry").foundry.homog.start({ id: b.id }))).message).toBe("Another batch is in this furnace; take it out first");
  });

  test("another plant's batch is Not found; a packer cannot load", async () => {
    const p = await plant();
    const q = await plant();
    const f = await homogFurnace(p);
    const b = await p.as("foundry").foundry.homog.create({ furnaceId: f, alloy: "6063" });
    expect((await errOf(q.owner.foundry.homog.get({ id: b.id }))).code).toBe("NOT_FOUND");
    expect((await errOf(q.owner.foundry.homog.start({ id: b.id }))).code).toBe("NOT_FOUND");
    expect((await errOf(p.as("packer").foundry.homog.create({ furnaceId: f, alloy: "6063" }))).code).toBe("FORBIDDEN");
  });
});

describe("#44 cutting, #50 floor stock", () => {
  test("a cut moves logs to the rack and end cuts to plant scrap; yield is shown; the cast tail stays closed", async () => {
    const p = await plant();
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    const rackId = await rack(p);
    const out = await p.as("foundry").foundry.billets.cut({ castId: r.castId, machine: "saw", logPcs: 4, logG: kg(800), billetLengthMm: 600, billetPcs: 36, billetG: kg(776) });
    expect(out).toMatchObject({ endG: kg(24), yieldBp: 9_700 });
    const rows = await env.db.select().from(stockLedger).where(and(eq(stockLedger.companyId, p.companyId), eq(stockLedger.voucherId, out.id)));
    expect(rows.map((x) => [x.itemKind, x.locationId, x.qtyG]).sort()).toEqual(
      [
        ["billet", p.billetStoreId, -kg(800)],
        ["billet", rackId, kg(776)],
        ["return_stream", p.plantScrapId, kg(24)],
      ].sort(),
    );
    const stock = await p.as("viewer").foundry.billets.stock();
    expect(stock.places.find((x) => x.id === rackId)).toMatchObject({ kind: "billet_rack", kgG: kg(776) });
    expect(stock.places.find((x) => x.id === p.billetStoreId)!.kgG).toBe(kg(1_200));
    const cuts = await p.as("viewer").foundry.billets.cuts();
    expect(cuts.totals).toMatchObject({ logG: kg(800), billetG: kg(776), endG: kg(24), yieldBp: 9_700 });
    // Ends are counted beside the press's use: produced 2,000 − on hand 1,976 − ends 24 = no tail.
    const cast = await p.as("viewer").foundry.casts.get({ id: r.castId });
    expect(cast.closeout).toMatchObject({ producedG: kg(2_000), billetsOnHandG: kg(1_976), foundryOutG: kg(24), tailG: 0 });
    // More logs than the store holds is refused.
    expect((await errOf(p.as("foundry").foundry.billets.cut({ castId: r.castId, machine: "hot_shear", logPcs: 6, logG: kg(1_300), billetLengthMm: 600, billetPcs: 50, billetG: kg(1_250) }))).message).toBe("Only 1,200 kg of OL-1 is at BILLET");
    expect((await errOf(p.as("foundry").foundry.billets.cut({ castId: r.castId, machine: "saw", logPcs: 1, logG: kg(100), billetLengthMm: 600, billetPcs: 9, billetG: kg(101) }))).message).toBe("Billets cannot weigh more than the logs they were cut from");
    expect((await errOf(p.as("packer").foundry.billets.cut({ castId: r.castId, machine: "saw", logPcs: 1, logG: kg(100), billetLengthMm: 600, billetPcs: 9, billetG: kg(97) }))).code).toBe("FORBIDDEN");
  });

  test("with homogenizing required, 6xxx logs are cut only up to the pieces of released batches", async () => {
    const p = await plant({ settings: { foundry: { requireHomogenizing: true } } });
    const r = await p.receive({ pcs: 10 });
    await rack(p);
    const cutOne = () => p.as("foundry").foundry.billets.cut({ castId: r.castId, machine: "saw", logPcs: 2, logG: kg(400), billetLengthMm: 600, billetPcs: 18, billetG: kg(390) });
    expect((await errOf(cutOne())).message).toBe("Homogenize the logs of OL-1 before cutting them");
    const f = (await p.as("manager").foundry.furnaces.create({ code: "HF1", name: "Homogenizing furnace", capacityG: kg(20_000), kind: "homogenizing" })).id;
    const b = await p.as("foundry").foundry.homog.create({ furnaceId: f, alloy: "6063", soakMin: 60 });
    await p.as("foundry").foundry.homog.addLine({ batchId: b.id, castId: r.castId, pcs: 3, kgG: kg(600) });
    await p.as("foundry").foundry.homog.start({ id: b.id });
    await p.as("foundry").foundry.homog.out({ id: b.id });
    await p.as("manager").foundry.homog.release({ id: b.id, note: "Soak log on paper" });
    await cutOne();
    expect((await errOf(cutOne())).message).toBe("Only 1 logs of OL-1 have been homogenized and not cut");
    // 1xxx logs need no homogenizing.
    const r2 = await p.receive({ pcs: 2, alloy: "1100" });
    await p.as("foundry").foundry.billets.cut({ castId: r2.castId, machine: "saw", logPcs: 1, logG: kg(100), billetLengthMm: 600, billetPcs: 9, billetG: kg(97) });
  });

  test("an issue moves billets to the press floor; the press run then draws from that floor", async () => {
    const p = await plant();
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    const floorId = await floor(p);
    await p.as("foundry").foundry.billets.issue({ castId: r.castId, pressLineId: p.pressLineId, fromLocationId: p.billetStoreId, pcs: 3, kgG: kg(600) });
    const stock = await p.as("viewer").foundry.billets.stock();
    expect(stock.places.find((x) => x.id === floorId)).toMatchObject({ kind: "press_floor", pressLineId: p.pressLineId, kgG: kg(600) });
    const run = await p.countingRun({ pcs: 100 });
    await fillWorkedExample(p, run.runId, r.castId, { planLineId: run.planLineIds[0] });
    await p.as("supervisor").press.runs.close({ id: run.runId });
    const pressRows = (await billetRows(p.companyId, r.castId)).filter((x) => x.voucherType === "press_run");
    expect(pressRows).toHaveLength(1);
    expect(pressRows[0]).toMatchObject({ locationId: floorId, qtyG: -kg(310.4) });
    const issues = await p.as("viewer").foundry.billets.issues();
    expect(issues.items[0]).toMatchObject({ castNumber: "OL-1", pcs: 3, kgG: kg(600) });
  });

  test("an issue needs a press floor; another plant's cast is Not found; a floor needs its press", async () => {
    const p = await plant();
    const q = await plant();
    const r = await p.receive();
    expect((await errOf(p.as("foundry").foundry.billets.issue({ castId: r.castId, pressLineId: p.pressLineId, fromLocationId: p.billetStoreId, pcs: 1, kgG: kg(10) }))).message).toContain("Add a press floor location for");
    expect((await errOf(q.as("foundry").foundry.billets.issue({ castId: r.castId, pressLineId: q.pressLineId, fromLocationId: q.billetStoreId, pcs: 1, kgG: kg(10) }))).code).toBe("NOT_FOUND");
    expect((await errOf(q.as("foundry").foundry.billets.cut({ castId: r.castId, machine: "saw", logPcs: 1, logG: kg(100), billetLengthMm: 600, billetPcs: 9, billetG: kg(97) }))).code).toBe("NOT_FOUND");
    expect((await errOf(p.as("manager").stock.locations.create({ code: "F2", name: "Floor", kind: "press_floor" }))).message).toBe("Pick the press this floor serves");
    expect((await errOf(p.as("manager").stock.locations.create({ code: "F2", name: "Floor", kind: "press_floor", pressLineId: q.pressLineId }))).code).toBe("NOT_FOUND");
  });
});

describe("#43 reject registers", () => {
  test("a log reject takes kg out to plant scrap with a reason; the register lists and totals it", async () => {
    const p = await plant();
    const r = await p.receive({ kgs: 2_000 });
    const crack = await p.code("log_reject", "crack");
    const out = await p.as("foundry").foundry.rejects.create({ kind: "log", castId: r.castId, locationId: p.billetStoreId, reasonCodeId: crack, pcs: 1, kgG: kg(200) });
    const rows = await env.db.select().from(stockLedger).where(and(eq(stockLedger.companyId, p.companyId), eq(stockLedger.voucherId, out.id)));
    expect(rows.map((x) => [x.itemKind, x.qtyG]).sort()).toEqual([
      ["billet", -kg(200)],
      ["return_stream", kg(200)],
    ]);
    const reg = await p.as("viewer").foundry.rejects.list({ kind: "log" });
    expect(reg.items[0]).toMatchObject({ castNumber: "OL-1", reasonCode: "crack", pcs: 1, kgG: kg(200), streamCode: "PLANT-SCRAP" });
    expect(reg.totals).toMatchObject({ entries: 1, pcs: 1, kgG: kg(200) });
    expect((await p.as("viewer").foundry.rejects.list({ kind: "billet" })).items).toHaveLength(0);
    expect((await p.as("viewer").foundry.casts.get({ id: r.castId })).closeout.tailG).toBe(0);
    expect(await audits(p.companyId)).toContain("foundry.reject.log");
  });

  test("a billet reason on a log, other with no note, more than on hand, a packer and another plant are refused", async () => {
    const p = await plant();
    const q = await plant();
    const r = await p.receive({ kgs: 100 });
    const billetCrack = await p.code("billet_reject", "crack");
    const other = await p.code("log_reject", "other");
    const crack = await p.code("log_reject", "crack");
    const base = { kind: "log" as const, castId: r.castId, locationId: p.billetStoreId, pcs: 1, kgG: kg(10) };
    expect(await errOf(p.as("foundry").foundry.rejects.create({ ...base, reasonCodeId: billetCrack }))).toEqual({ code: "NOT_FOUND", message: "Reason not found" });
    expect((await errOf(p.as("foundry").foundry.rejects.create({ ...base, reasonCodeId: other }))).message).toBe("Add a note for this reason");
    expect((await errOf(p.as("foundry").foundry.rejects.create({ ...base, reasonCodeId: crack, kgG: kg(101) }))).message).toBe("Only 100 kg of OL-1 is at BILLET");
    expect((await errOf(p.as("packer").foundry.rejects.create({ ...base, reasonCodeId: crack }))).code).toBe("FORBIDDEN");
    expect((await errOf(q.as("foundry").foundry.rejects.create({ ...base, reasonCodeId: crack, locationId: q.billetStoreId }))).code).toBe("NOT_FOUND");
  });
});

describe("#47 charge-mix suggestion", () => {
  test("typical chemistry per scrap item and stream feeds a cheapest mix inside the alloy limits; cost only for purchase readers", async () => {
    const p = await plant();
    const manager = p.as("manager");
    await manager.purchase.seedScrapDefaults();
    const items = (await manager.purchase.scrapItems.list()).items;
    const belling = items.find((i) => i.name === "IMP BELLING")!;
    const store = p.as("storekeeper");
    const l = await store.purchase.lots.create({ vendorId: p.vendorId, date: "2026-10-01", origin: "LOCAL", itemId: belling.id, grade: "A", partyKgG: kg(3_000), fcKgG: kg(3_000), ratePaise: 18_500, billBook: "main" });
    await store.purchase.lots.advance({ id: l.id, to: "ok" });
    await manager.foundry.chargeMix.setChemistry({ subjectKind: "item", subjectId: belling.id, ppm: { si: 4_500, fe: 1_800, mg: 5_200, cu: 100 } });
    const chem = await p.as("viewer").foundry.chargeMix.chemistry();
    expect(chem.items.find((i) => i.id === belling.id)!.ppm).toEqual({ si: 4_500, fe: 1_800, mg: 5_200, cu: 100 });
    const alloyId = (await p.as("viewer").foundry.alloys.list()).items.find((a) => a.code === "6063")!.id;
    const asFoundry = await p.as("foundry").foundry.chargeMix.suggest({ alloyId, targetKgG: kg(1_000) });
    expect(asFoundry.status).toBe("ok");
    expect(asFoundry.lines).toEqual([expect.objectContaining({ kind: "lot", ref: l.id, kgG: kg(1_000) })]);
    expect(asFoundry.costPaise).toBeNull();
    const asManager = await manager.foundry.chargeMix.suggest({ alloyId, targetKgG: kg(1_000) });
    expect(asManager.costPaise).toBe(1_000 * 18_500);
    expect(await audits(p.companyId)).toContain("foundry.chemistry.set");
  });

  test("a packer cannot ask; a foundry hand cannot set chemistry; another plant's item and alloy are Not found", async () => {
    const p = await plant();
    const q = await plant();
    const alloyId = (await p.as("viewer").foundry.alloys.list()).items.find((a) => a.code === "6063")!.id;
    expect((await errOf(p.as("packer").foundry.chargeMix.suggest({ alloyId, targetKgG: kg(100) }))).code).toBe("FORBIDDEN");
    await p.as("manager").purchase.seedScrapDefaults();
    const item = (await p.as("manager").purchase.scrapItems.list()).items[0]!;
    expect((await errOf(p.as("foundry").foundry.chargeMix.setChemistry({ subjectKind: "item", subjectId: item.id, ppm: { si: 1 } }))).code).toBe("FORBIDDEN");
    expect((await errOf(q.as("manager").foundry.chargeMix.setChemistry({ subjectKind: "item", subjectId: item.id, ppm: { si: 1 } }))).code).toBe("NOT_FOUND");
    expect((await errOf(q.as("foundry").foundry.chargeMix.suggest({ alloyId, targetKgG: kg(100) }))).code).toBe("NOT_FOUND");
  });
});
