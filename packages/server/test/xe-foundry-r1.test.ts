/**
 * XE FOUNDRY fix round 1 (REVIEW-FOUNDRY.md): billets drawn from where they are (rack, floor, store),
 * replay keys on the new floor writes, the floor-short warning at press close, the homogenizing gate on
 * every way logs leave the store, the casting plan's "still to come" and running-plan need, and the nits.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { auditLog, cast, castPlanLine, company, logReceipt, stockLedger } from "@orrn/db/schema";

import { createTestEnv, type TestEnv } from "./harness";
import { fillWorkedExample, kg, pressHelpers, type PressPlant } from "./press-w2-fixture";

setDefaultTimeout(90_000);

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

async function errOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    return { code: (e as { code?: string }).code, message: (e as Error).message };
  }
  return { code: "OK", message: "" };
}

type Plant = PressPlant & {
  vendorId: string;
  receive(o?: { pcs?: number; kgs?: number; alloy?: string; key?: string }): Promise<{ id: string; number: string; castId: string; replayed: boolean }>;
};

async function plant(opts: { settings?: Record<string, unknown> } = {}): Promise<Plant> {
  const p = await pressPlant(opts);
  const manager = p.as("manager");
  await manager.foundry.returnStreams.seedDefaults();
  await manager.foundry.alloys.seedDefaults();
  const v = await manager.vendor.create({ name: "Balaji Billets" });
  async function receive(o: { pcs?: number; kgs?: number; alloy?: string; key?: string } = {}) {
    return p.as("storekeeper").foundry.logs.receive({
      vendorId: v.id,
      alloy: o.alloy ?? "6063",
      receivedOn: "2026-11-20",
      pcs: o.pcs ?? 10,
      kgG: kg(o.kgs ?? 2_000),
      ...(o.key ? { clientRequestId: o.key } : {}),
    });
  }
  return { ...p, vendorId: v.id, receive };
}

const key = () => crypto.randomUUID();

async function rack(p: Plant, code = "RACK") {
  return (await p.as("manager").stock.locations.create({ code, name: "Billet rack", kind: "billet_rack" })).id;
}

async function floor(p: Plant, pressLineId = p.pressLineId, code = "FLOOR-P1") {
  return (await p.as("manager").stock.locations.create({ code, name: "Press floor", kind: "press_floor", pressLineId })).id;
}

async function placeKg(p: Plant, locationId: string) {
  return ((await p.as("viewer").foundry.billets.stock()).places.find((x) => x.id === locationId)?.kgG ?? 0) as number;
}

async function pressRows(p: Plant, castId: string) {
  const rows = await env.db.select().from(stockLedger).where(and(eq(stockLedger.companyId, p.companyId), eq(stockLedger.itemKind, "billet"), eq(stockLedger.itemRef, castId)));
  return rows.filter((r) => r.voucherType === "press_run").map((r) => [r.locationId, r.qtyG]);
}

/** A released homogenizing batch of `pcs` logs (`kgs`) of the cast. */
async function homogenized(p: Plant, castId: string, pcs: number, kgs: number) {
  const furnaces = (await p.as("viewer").foundry.furnaces.list()).items.filter((f) => f.kind === "homogenizing");
  const f = furnaces[0]?.id ?? (await p.as("manager").foundry.furnaces.create({ code: "HF1", name: "Homogenizing furnace", capacityG: kg(20_000), kind: "homogenizing" })).id;
  const b = await p.as("foundry").foundry.homog.create({ furnaceId: f, alloy: "6063", soakMin: 60 });
  await p.as("foundry").foundry.homog.addLine({ batchId: b.id, castId, pcs, kgG: kg(kgs) });
  await p.as("foundry").foundry.homog.start({ id: b.id });
  await p.as("foundry").foundry.homog.out({ id: b.id });
  await p.as("manager").foundry.homog.release({ id: b.id, note: "Soak log on paper" });
}

const cutOf = (castId: string, logPcs: number, logKg: number, billetKg: number) => ({
  castId,
  machine: "saw" as const,
  logPcs,
  logG: kg(logKg),
  billetLengthMm: 600,
  billetPcs: logPcs * 9,
  billetG: kg(billetKg),
});

async function closeWorked(p: Plant, castId: string) {
  const run = await p.countingRun({ pcs: 100 });
  await fillWorkedExample(p, run.runId, castId, { planLineId: run.planLineIds[0] });
  return run;
}

describe("blocker 1: a press with no floor draws from where the cast's billets are", () => {
  test("rack and no floor: the press takes cut billets from the rack, so the next cut of the logs is not refused", async () => {
    const p = await plant();
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    const rackId = await rack(p);
    await p.as("foundry").foundry.billets.cut(cutOf(r.castId, 5, 1_000, 950));
    const run = await closeWorked(p, r.castId);
    await p.as("supervisor").press.runs.close({ id: run.runId });
    expect(await pressRows(p, r.castId)).toEqual([[rackId, -kg(310.4)]]);
    // The logs still at the store are all there; cutting them is not refused.
    expect(await placeKg(p, p.billetStoreId)).toBe(kg(1_000));
    await p.as("foundry").foundry.billets.cut(cutOf(r.castId, 5, 1_000, 950));
    expect(await placeKg(p, p.billetStoreId)).toBe(0);
    expect(await placeKg(p, rackId)).toBe(kg(950 - 310.4 + 950));
    expect((await p.as("viewer").foundry.casts.get({ id: r.castId })).closeout.tailG).toBe(0);
  });

  test("rack short of the run: the rack gives what it holds, the billet store the rest", async () => {
    const p = await plant();
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    const rackId = await rack(p);
    await p.as("foundry").foundry.billets.cut(cutOf(r.castId, 2, 316, 300));
    const run = await closeWorked(p, r.castId);
    await p.as("supervisor").press.runs.close({ id: run.runId });
    expect((await pressRows(p, r.castId)).sort()).toEqual([[rackId, -kg(300)], [p.billetStoreId, -kg(10.4)]].sort());
    expect(await placeKg(p, rackId)).toBe(0);
  });

  test("a plant that never cut (no rack stock) still draws from the billet store", async () => {
    const p = await plant();
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    await rack(p);
    const run = await closeWorked(p, r.castId);
    await p.as("supervisor").press.runs.close({ id: run.runId });
    expect(await pressRows(p, r.castId)).toEqual([[p.billetStoreId, -kg(310.4)]]);
  });
});

describe("blocker 2: replay keys on the new floor writes", () => {
  test("a receipt sent twice with one key writes once and answers the first; another receipt under that key is a CONFLICT", async () => {
    const p = await plant();
    const k = key();
    const first = await p.receive({ key: k });
    const again = await p.receive({ key: k });
    expect(first.replayed).toBe(false);
    expect(again).toEqual({ ...first, replayed: true });
    expect(await env.db.select().from(logReceipt).where(eq(logReceipt.companyId, p.companyId))).toHaveLength(1);
    expect(await placeKg(p, p.billetStoreId)).toBe(kg(2_000));
    expect((await errOf(p.receive({ key: k, kgs: 2_100 }))).code).toBe("CONFLICT");
    // No OL number was burnt by the repeat.
    expect((await p.receive()).number).toBe("OL-2");
  });

  test("two identical receipts racing each other land once", async () => {
    const p = await plant();
    const k = key();
    const [a, b] = await Promise.all([p.receive({ key: k }), p.receive({ key: k })]);
    expect(a.id).toBe(b.id);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(await env.db.select().from(logReceipt).where(eq(logReceipt.companyId, p.companyId))).toHaveLength(1);
    expect(await placeKg(p, p.billetStoreId)).toBe(kg(2_000));
  });

  test("a cut, an issue and a reject sent twice post their kg once", async () => {
    const p = await plant();
    const r = await p.receive({ pcs: 10, kgs: 1_500 });
    const rackId = await rack(p);
    const floorId = await floor(p);
    const ck = key();
    // The store cannot cover the cut twice: the repeat must answer the first cut, not "only 500 kg".
    const cut = { ...cutOf(r.castId, 5, 1_000, 950), clientRequestId: ck };
    const c1 = await p.as("foundry").foundry.billets.cut(cut);
    const c2 = await p.as("foundry").foundry.billets.cut(cut);
    expect(c2).toEqual({ ...c1, replayed: true });
    expect(await placeKg(p, p.billetStoreId)).toBe(kg(500));
    const ik = key();
    const issue = { castId: r.castId, pressLineId: p.pressLineId, fromLocationId: rackId, pcs: 30, kgG: kg(600), clientRequestId: ik };
    const i1 = await p.as("foundry").foundry.billets.issue(issue);
    expect(await p.as("foundry").foundry.billets.issue(issue)).toEqual({ ...i1, replayed: true });
    expect(await placeKg(p, floorId)).toBe(kg(600));
    const crack = await p.code("billet_reject", "crack");
    const rej = { kind: "billet" as const, castId: r.castId, locationId: floorId, reasonCodeId: crack, pcs: 1, kgG: kg(20), clientRequestId: key() };
    const r1 = await p.as("foundry").foundry.rejects.create(rej);
    expect(await p.as("foundry").foundry.rejects.create(rej)).toEqual({ ...r1, replayed: true });
    expect(await placeKg(p, floorId)).toBe(kg(580));
    expect((await errOf(p.as("foundry").foundry.rejects.create({ ...rej, kgG: kg(21) }))).code).toBe("CONFLICT");
    const actions = (await env.db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.companyId, p.companyId))).map((a) => a.action);
    expect(actions.filter((a) => a === "foundry.billets.cut")).toHaveLength(1);
    expect(actions.filter((a) => a === "foundry.billets.issue")).toHaveLength(1);
    expect(actions.filter((a) => a === "foundry.reject.billet")).toHaveLength(1);
  });

  test("a plan line accepted twice with one key is one accepted line", async () => {
    const p = await plant();
    const alloyId = (await p.as("viewer").foundry.alloys.list()).items.find((a) => a.code === "6063")!.id;
    const body = { day: "2026-11-25", alloyId, kgG: kg(4_000), proposedG: kg(4_000), clientRequestId: key() };
    const a = await p.as("office").foundry.castPlan.accept(body);
    const b = await p.as("office").foundry.castPlan.accept(body);
    expect(b).toEqual({ ...a, replayed: true });
    const [c, d] = await Promise.all([p.as("office").foundry.castPlan.accept({ ...body, clientRequestId: key().replace(/./, "b") }), p.as("office").foundry.castPlan.accept({ ...body, clientRequestId: body.clientRequestId })]);
    expect(d).toEqual({ ...a, replayed: true });
    expect(c.replayed).toBe(false);
    expect(await env.db.select().from(castPlanLine).where(eq(castPlanLine.companyId, p.companyId))).toHaveLength(2);
  });
});

describe("should-fix 3: a short press floor and a melt cancel after cuts", () => {
  test("a floor set up mid-shift holds nothing: the close warns, still logs, and the floor goes negative", async () => {
    const p = await plant();
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    const run = await closeWorked(p, r.castId);
    const floorId = await floor(p);
    const preview = await p.as("supervisor").press.runs.preview({ id: run.runId });
    expect(preview.gates).toEqual([]);
    expect(preview.floorShort).toEqual([{ castId: r.castId, castNumber: "OL-1", floorCode: "FLOOR-P1", needG: kg(310.4), haveG: 0 }]);
    const out = await p.as("supervisor").press.runs.close({ id: run.runId });
    expect("floorShort" in out ? out.floorShort : null).toEqual(preview.floorShort);
    expect(await pressRows(p, r.castId)).toEqual([[floorId, -kg(310.4)]]);
    expect(await placeKg(p, floorId)).toBe(-kg(310.4));
  });

  test("a floor that holds enough gives no warning", async () => {
    const p = await plant();
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    await floor(p);
    await p.as("foundry").foundry.billets.issue({ castId: r.castId, pressLineId: p.pressLineId, fromLocationId: p.billetStoreId, pcs: 2, kgG: kg(400) });
    const run = await closeWorked(p, r.castId);
    expect((await p.as("supervisor").press.runs.preview({ id: run.runId })).floorShort).toEqual([]);
  });
});

describe("should-fix 4: the homogenizing gate on every way logs leave the billet store", () => {
  const ON = { settings: { foundry: { requireHomogenizing: true } } };

  test("an issue of whole logs from the store is gated; issues and cuts share one allowance", async () => {
    const p = await plant(ON);
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    await rack(p);
    await floor(p);
    const issue = (pcs: number) => p.as("foundry").foundry.billets.issue({ castId: r.castId, pressLineId: p.pressLineId, fromLocationId: p.billetStoreId, pcs, kgG: kg(pcs * 200) });
    expect((await errOf(issue(1))).message).toBe("Homogenize the logs of OL-1 before issuing them");
    await homogenized(p, r.castId, 5, 1_000);
    expect((await errOf(issue(6))).message).toBe("Only 5 logs of OL-1 have been homogenized and not cut or issued");
    await issue(3);
    await p.as("foundry").foundry.billets.cut(cutOf(r.castId, 2, 400, 390));
    expect((await errOf(p.as("foundry").foundry.billets.cut(cutOf(r.castId, 1, 200, 190)))).message).toBe("Homogenize the logs of OL-1 before cutting them");
    expect((await errOf(issue(1))).message).toBe("Homogenize the logs of OL-1 before issuing them");
  });

  test("a press with no floor taking unhomogenized logs from the store is a close gate; homogenized kg lets it log", async () => {
    const p = await plant(ON);
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    const run = await closeWorked(p, r.castId);
    expect((await p.as("supervisor").press.runs.preview({ id: run.runId })).gates).toContain("billets_not_homogenized");
    const refused = await errOf(p.as("supervisor").press.runs.close({ id: run.runId }));
    expect(refused.code).toBe("BAD_REQUEST");
    await homogenized(p, r.castId, 2, 400);
    expect((await p.as("supervisor").press.runs.preview({ id: run.runId })).gates).toEqual([]);
    await p.as("supervisor").press.runs.close({ id: run.runId });
    expect(await pressRows(p, r.castId)).toEqual([[p.billetStoreId, -kg(310.4)]]);
  });

  test("with the setting off nothing is gated", async () => {
    const p = await plant();
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    await floor(p);
    await p.as("foundry").foundry.billets.issue({ castId: r.castId, pressLineId: p.pressLineId, fromLocationId: p.billetStoreId, pcs: 1, kgG: kg(200) });
    const p2 = await plant();
    const r2 = await p2.receive({ pcs: 10, kgs: 2_000 });
    const run = await closeWorked(p2, r2.castId);
    expect((await p2.as("supervisor").press.runs.preview({ id: run.runId })).gates).toEqual([]);
  });
});

describe("should-fix 5 and nit 9: the casting plan", () => {
  const today = async () => {
    const { zonedYmd } = await import("../src/lib/dayWindow");
    const d = zonedYmd("Asia/Kolkata", Date.now());
    return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  };

  test("an opened line's metal still to come counts only what its cast made, not cuts or issues", async () => {
    const p = await plant();
    const day = await today();
    const alloyId = (await p.as("viewer").foundry.alloys.list()).items.find((a) => a.code === "6063")!.id;
    const line = await p.as("office").foundry.castPlan.accept({ day, alloyId, kgG: kg(12_000), proposedG: kg(12_000) });
    const opened = await p.as("foundry").foundry.castPlan.open({ id: line.id });
    const rackId = await rack(p);
    const floorId = await floor(p);
    const row = (voucherType: "melt" | "billet_cut" | "billet_issue", locationId: string, qtyKg: number, line = 1, voucherId = crypto.randomUUID()) =>
      env.db.insert(stockLedger).values({ id: crypto.randomUUID(), companyId: p.companyId, voucherType, voucherId, line, itemKind: "billet", itemRef: opened.castId, locationId, qtyG: kg(qtyKg), postedAt: new Date() });
    // One melt of 6 t; 3 t of its logs cut (2,850 kg of billets) and those billets issued to the floor.
    await row("melt", p.billetStoreId, 6_000);
    const cutV = crypto.randomUUID();
    await row("billet_cut", p.billetStoreId, -3_000, 1, cutV);
    await row("billet_cut", rackId, 2_850, 2, cutV);
    const issueV = crypto.randomUUID();
    await row("billet_issue", rackId, -2_850, 1, issueV);
    await row("billet_issue", floorId, 2_850, 2, issueV);
    // A press plan of 1,000 pcs of 12 kg: stock 5,850 kg, and the opened line's cast still has
    // 12,000 − 6,000 made = 6,000 kg to come (the moves' + rows at the rack and floor are not made metal).
    const sec = await p.section({ alloy: "6063" });
    const o = await p.confirmedOrder([{ sectionId: sec, pcs: 1_000 }]);
    const t = Date.now();
    await p.as("office").plans.create({ windowStart: t, windowEnd: t + 3_600_000, pressLineId: p.pressLineId, dies: [{ sectionId: sec, lines: [{ salesOrderLineId: o.lineIds[0]!, pcs: 1_000 }] }] });
    const got = await p.as("viewer").foundry.castPlan.propose({ from: day, to: day });
    expect(got.lines[0]).toMatchObject({ status: "opened", castId: opened.castId });
    const need = got.rows.find((x) => x.alloy === "6063")!;
    expect(need.needG).toBeGreaterThan(kg(12_000));
    expect(need.castG).toBe(need.needG - kg(5_850) - kg(6_000));
  });

  test("a running press plan counts only what is still to press", async () => {
    const p = await plant();
    const day = await today();
    const r = await p.receive({ pcs: 2, kgs: 400 });
    const s = await p.section({ alloy: "6063" });
    const run = await p.queuedRun({ sectionId: s, pcs: 100 });
    await p.issue(run.runId, run.copyId);
    const press = p.as("press");
    await press.press.runs.start({ id: run.runId });
    await press.press.runs.stop({ id: run.runId });
    await press.press.runs.count({ id: run.runId });
    await fillWorkedExample(p, run.runId, r.castId, { planLineId: run.planLineIds[0] });
    const before = (await p.as("viewer").foundry.castPlan.propose({ from: day, to: day })).rows.find((x) => x.alloy === "6063")!;
    expect(before.castG).toBeGreaterThan(0);
    await p.as("supervisor").press.runs.close({ id: run.runId });
    const after = (await p.as("viewer").foundry.castPlan.propose({ from: day, to: day })).rows.find((x) => x.alloy === "6063")!;
    // REG's need is the whole plan (its recovery now learns from the logged run). The billets the run
    // used left the stock, so they leave the need too: need = REG's need − 310.4, cast = need − stock left.
    const { planBilletNeed } = await import("../src/lib/regReports");
    const reg = await planBilletNeed(env.db as never, p.companyId, run.planId);
    const whole = reg.rows.filter((x) => x.alloy === "6063").reduce((t, x) => t + x.billetKgG, 0);
    expect(after.needG).toBe(whole - kg(310.4));
    expect(after.castG).toBe(after.needG - kg(400 - 310.4));
  });
});

describe("nits", () => {
  test("6: two cuts at once never cut more logs than were homogenized", async () => {
    const p = await plant({ settings: { foundry: { requireHomogenizing: true } } });
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    await rack(p);
    await homogenized(p, r.castId, 5, 1_000);
    const results = await Promise.all([errOf(p.as("foundry").foundry.billets.cut(cutOf(r.castId, 3, 600, 580))), errOf(p.as("foundry").foundry.billets.cut(cutOf(r.castId, 3, 600, 580)))]);
    expect(results.map((x) => x.code).sort()).toEqual(["BAD_REQUEST", "OK"]);
    expect(results.find((x) => x.code !== "OK")!.message).toBe("Only 2 logs of OL-1 have been homogenized and not cut");
  });

  test("6: two loads at once never put more pieces on batches than the cast has logs", async () => {
    const p = await plant();
    const r = await p.receive({ pcs: 4, kgs: 800 });
    const f = (await p.as("manager").foundry.furnaces.create({ code: "HF1", name: "Homogenizing furnace", capacityG: kg(20_000), kind: "homogenizing" })).id;
    const a = await p.as("foundry").foundry.homog.create({ furnaceId: f, alloy: "6063" });
    const b = await p.as("foundry").foundry.homog.create({ furnaceId: f, alloy: "6063" });
    const results = await Promise.all([
      errOf(p.as("foundry").foundry.homog.addLine({ batchId: a.id, castId: r.castId, pcs: 3, kgG: kg(600) })),
      errOf(p.as("foundry").foundry.homog.addLine({ batchId: b.id, castId: r.castId, pcs: 3, kgG: kg(600) })),
    ]);
    expect(results.map((x) => x.code).sort()).toEqual(["BAD_REQUEST", "OK"]);
    expect(results.find((x) => x.code !== "OK")!.message).toBe("OL-1 has 1 logs left to homogenize");
  });

  test("8: a press floor that holds stock cannot move to another press; an empty one can", async () => {
    const p = await plant();
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    const floorId = await floor(p);
    const p2 = (await p.as("manager").press.lines.create({ code: "P2", name: "Press 2" })).id;
    await p.as("foundry").foundry.billets.issue({ castId: r.castId, pressLineId: p.pressLineId, fromLocationId: p.billetStoreId, pcs: 1, kgG: kg(200) });
    expect(await errOf(p.as("manager").stock.locations.update({ id: floorId, pressLineId: p2 }))).toEqual({
      code: "BAD_REQUEST",
      message: "Location FLOOR-P1 still holds stock; move it out before moving the floor to another press",
    });
    const empty = await floor(p, p.pressLineId, "FLOOR-X");
    await p.as("manager").stock.locations.update({ id: empty, pressLineId: p2 });
    const places = (await p.as("viewer").foundry.billets.places()).places;
    expect(places.find((x) => x.id === empty)!.pressLineId).toBe(p2);
    expect(places.find((x) => x.id === floorId)!.pressLineId).toBe(p.pressLineId);
  });

  test("10: a bought-in log receipt does not block the cast book's start for its month", async () => {
    const p = await plant();
    await p.receive();
    const [c] = await env.db.select().from(cast).where(and(eq(cast.companyId, p.companyId), eq(cast.source, "bought_in")));
    expect(c).toMatchObject({ year: 2026, month: 11 });
    await p.owner.foundry.casts.setSeriesStart({ start: { period: "2026-11", start: 120 } });
    await p.owner.company.updateSettings({ castSeriesStart: { period: "2026-11", start: 121 } });
  });
});

describe("fix round 2: the homogenizing press gate never gets stuck", () => {
  const ON = { settings: { foundry: { requireHomogenizing: true } } };
  const switchOn = async (p: Plant) => {
    await Bun.sleep(5);
    await p.owner.company.updateSettings({ foundry: { requireHomogenizing: true } });
    await Bun.sleep(5);
  };

  test("the press may weigh past the homogenized kg by the plant's tolerance (2 % by default)", async () => {
    const p = await plant(ON);
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    // The batch line was typed as 305 kg; the press weighs 310.4 kg of the same logs (1.8 % over).
    await homogenized(p, r.castId, 2, 305);
    const run = await closeWorked(p, r.castId);
    await p.owner.company.updateSettings({ foundry: { homogToleranceBp: 0 } });
    expect((await p.as("supervisor").press.runs.preview({ id: run.runId })).gates).toContain("billets_not_homogenized");
    await p.owner.company.updateSettings({ foundry: { homogToleranceBp: 200 } });
    expect((await p.as("supervisor").press.runs.preview({ id: run.runId })).gates).toEqual([]);
    await p.as("supervisor").press.runs.close({ id: run.runId });
    expect(await pressRows(p, r.castId)).toEqual([[p.billetStoreId, -kg(310.4)]]);
  });

  test("switching on mid-cast: logs cut before the switch do not use up the logs homogenized after it", async () => {
    const p = await plant();
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    await rack(p);
    await p.as("foundry").foundry.billets.cut(cutOf(r.castId, 5, 1_000, 950));
    await switchOn(p);
    const [row] = await env.db.select({ settings: company.settings }).from(company).where(eq(company.id, p.companyId));
    expect(typeof (row!.settings as { foundry?: { requireHomogenizingSince?: unknown } }).foundry?.requireHomogenizingSince).toBe("number");
    expect((await errOf(p.as("foundry").foundry.billets.cut(cutOf(r.castId, 1, 200, 190)))).message).toBe("Homogenize the logs of OL-1 before cutting them");
    await homogenized(p, r.castId, 5, 1_000);
    await p.as("foundry").foundry.billets.cut(cutOf(r.castId, 5, 1_000, 950));
    expect(await placeKg(p, p.billetStoreId)).toBe(0);
  });

  test("switching on mid-cast: a floor-less press that drew before the switch can press the rest once it is homogenized", async () => {
    const p = await plant();
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    const first = await closeWorked(p, r.castId);
    await p.as("supervisor").press.runs.close({ id: first.runId });
    await switchOn(p);
    const second = await closeWorked(p, r.castId);
    expect((await p.as("supervisor").press.runs.preview({ id: second.runId })).gates).toContain("billets_not_homogenized");
    await homogenized(p, r.castId, 2, 400);
    expect((await p.as("supervisor").press.runs.preview({ id: second.runId })).gates).toEqual([]);
    await p.as("supervisor").press.runs.close({ id: second.runId });
    expect(await pressRows(p, r.castId)).toEqual([
      [p.billetStoreId, -kg(310.4)],
      [p.billetStoreId, -kg(310.4)],
    ]);
  });
});

describe("fix round 2 nits", () => {
  test("2: a floor-less close racing an issue from the rack never takes the rack below zero", async () => {
    const p = await plant();
    const r = await p.receive({ pcs: 10, kgs: 2_000 });
    const rackId = await rack(p);
    await p.as("foundry").foundry.billets.cut(cutOf(r.castId, 2, 316, 300));
    const p2 = (await p.as("manager").press.lines.create({ code: "P2", name: "Press 2" })).id;
    const floor2 = await floor(p, p2, "FLOOR-P2");
    const run = await closeWorked(p, r.castId);
    const [closed, issued] = await Promise.all([
      errOf(p.as("supervisor").press.runs.close({ id: run.runId })),
      errOf(p.as("foundry").foundry.billets.issue({ castId: r.castId, pressLineId: p2, fromLocationId: rackId, pcs: 18, kgG: kg(300) })),
    ]);
    expect([closed.code, issued.code]).toContain("OK");
    const rackKg = await placeKg(p, rackId);
    expect(rackKg).toBeGreaterThanOrEqual(0);
    const fromRack = (await pressRows(p, r.castId)).filter(([loc]) => loc === rackId).reduce((t, [, q]) => t - Number(q), 0);
    const toFloor = await placeKg(p, floor2);
    expect(rackKg).toBe(kg(300) - toFloor - fromRack);
    expect(toFloor === 0 || fromRack === 0).toBe(true);
  });

  test("3: a press floor holding +A of one cast and -A of another cannot be retired or retyped", async () => {
    const p = await plant();
    const a = await p.receive({ pcs: 10, kgs: 2_000 });
    const b = await p.receive({ pcs: 10, kgs: 2_000 });
    const floorId = await floor(p);
    await p.as("foundry").foundry.billets.issue({ castId: a.castId, pressLineId: p.pressLineId, fromLocationId: p.billetStoreId, pcs: 2, kgG: kg(310.4) });
    const run = await closeWorked(p, b.castId);
    await p.as("supervisor").press.runs.close({ id: run.runId });
    expect(await placeKg(p, floorId)).toBe(0);
    expect(await errOf(p.as("manager").stock.locations.update({ id: floorId, active: false }))).toEqual({
      code: "BAD_REQUEST",
      message: "Location FLOOR-P1 still holds stock; move it out before retiring the location",
    });
    expect((await errOf(p.as("manager").stock.locations.update({ id: floorId, kind: "billet_rack" }))).code).toBe("BAD_REQUEST");
  });
});
