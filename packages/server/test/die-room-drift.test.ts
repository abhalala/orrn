/**
 * FP-DR-04/05/06/08/15: current weight from the latest reading, percent drift against the band
 * start, green / amber / red from the plant's settings, band position, kg/m (3 dp), the
 * "run the lightest in-band copy first" pick (C36) and the run-history contract. Every figure is
 * server-computed from stored grams; nothing here is stored. Worked examples from spec §E1.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { dieBand, dieInstance, dieWeightReading, nitridingLog, pressRun } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

async function plant(band: { min: number; max: number }, settings: Record<string, unknown> = {}) {
  const { companyId, users } = await env.seedCompany({ settings });
  const sectionId = await env.seedDie(companyId, { series: "Domal", sectionCode: "12170", weightMinG: band.min, weightMaxG: band.max, wallTenthMm: 12 });
  return {
    companyId,
    users,
    sectionId,
    owner: env.caller({ role: "owner", companyId }),
    dieRoom: env.caller({ role: "die_room", companyId }),
    press: env.caller({ role: "press", companyId }),
    viewer: env.caller({ role: "viewer", companyId }),
  };
}
type Plant = Awaited<ReturnType<typeof plant>>;

async function copyWith(p: Plant, readings: number[], over: Record<string, unknown> = {}) {
  const c = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId, ...over });
  for (const v of readings) await p.press.dieInstance.addReading({ dieInstanceId: c.id, kgPer12ftMilli: v });
  return c;
}

describe("worked examples (spec §E1)", () => {
  test("10.333 over a 10.000 start is +3.3 %, green, in band", async () => {
    const p = await plant({ min: 10_000, max: 11_000 });
    const c = await copyWith(p, [10_333]);
    expect(await p.viewer.dieInstance.get({ id: c.id })).toMatchObject({ currentMilli: 10_333, pctTenth: 33, tone: "green", position: "in" });
  });

  test("12.502 over 12.000 is +4.2 %, green and inside 12-14", async () => {
    const p = await plant({ min: 12_000, max: 14_000 });
    const c = await copyWith(p, [12_502]);
    expect(await p.viewer.dieInstance.get({ id: c.id })).toMatchObject({ pctTenth: 42, tone: "green", position: "in" });
  });

  test("5.967 on 5.900-6.200 is +1.1 % green in band, 1.631 kg/m; 6.480 is +9.8 % amber ABOVE", async () => {
    const p = await plant({ min: 5_900, max: 6_200 });
    const a = await copyWith(p, [5_940, 5_967]);
    const b = await copyWith(p, [6_480]);
    const cardA = await p.viewer.dieInstance.get({ id: a.id });
    expect(cardA).toMatchObject({ currentMilli: 5_967, pctTenth: 11, tone: "green", position: "in", kgPerMetre: 1.631 });
    expect(cardA.band).toMatchObject({ id: null, weightMinG: 5_900, weightMaxG: 6_200, wallTenthMm: 12, kgPerMetreMin: 1.613, kgPerMetreMax: 1.695 });
    expect(await p.viewer.dieInstance.get({ id: b.id })).toMatchObject({ pctTenth: 98, tone: "amber", position: "above", kgPerMetre: 1.772 });

    const drift = await p.viewer.dieInstance.drift({ sectionId: p.sectionId });
    const byCode = new Map(drift.items.map((i) => [i.code, i]));
    expect(byCode.get(a.code)).toMatchObject({ pctTenth: 11, tone: "green", band: "in", kgPerMetre: 1.631 });
    expect(byCode.get(b.code)).toMatchObject({ pctTenth: 98, tone: "amber", band: "above", offBandMilli: 280 });

    const section = await p.viewer.die.get({ id: p.sectionId });
    expect(section.copies.map((c) => [c.code, c.pctTenth, c.tone, c.position])).toEqual([
      [a.code, 11, "green", "in"],
      [b.code, 98, "amber", "above"],
    ]);
  });

  test("edges: 8.00 % is green, one gram more is amber; above 10 % red; lighter than the start is under; no reading has no chip", async () => {
    const p = await plant({ min: 5_900, max: 6_600 });
    const green = await copyWith(p, [6_372]); // exactly +8.00 %
    const amber = await copyWith(p, [6_373]);
    const amberTop = await copyWith(p, [6_490]); // exactly +10.00 %
    const red = await copyWith(p, [6_491]);
    const under = await copyWith(p, [5_850]);
    const none = await copyWith(p, []);
    const tone = async (id: string) => (await p.viewer.dieInstance.get({ id })).tone;
    expect(await tone(green.id)).toBe("green");
    expect(await tone(amber.id)).toBe("amber");
    expect(await tone(amberTop.id)).toBe("amber");
    expect(await tone(red.id)).toBe("red");
    const u = await p.viewer.dieInstance.get({ id: under.id });
    expect(u).toMatchObject({ tone: "under", pctTenth: -8, position: "below" });
    expect(await p.viewer.dieInstance.get({ id: none.id })).toMatchObject({ currentMilli: null, pctTenth: null, tone: "none", position: null, kgPerMetre: null });
  });

  test("the colours follow the plant's drift settings", async () => {
    const p = await plant({ min: 5_900, max: 6_600 }, { driftGreenMaxBp: 300, driftAmberMaxBp: 500 });
    const a = await copyWith(p, [5_967]); // +1.1 %
    const b = await copyWith(p, [6_150]); // +4.2 %
    const c = await copyWith(p, [6_200]); // +5.1 %
    const t = async (id: string) => (await p.viewer.dieInstance.get({ id })).tone;
    expect([await t(a.id), await t(b.id), await t(c.id)]).toEqual(["green", "amber", "red"]);
  });

  test("percent uses the copy's own band: 6.480 on the heavy 6.200-6.600 band is +4.5 % green in band", async () => {
    const p = await plant({ min: 5_900, max: 6_200 });
    const { id: heavy } = await p.owner.die.bands.create({ sectionId: p.sectionId, wallTenthMm: 14, weightMinG: 6_200, weightMaxG: 6_600, label: "6.2-6.6" });
    const c = await copyWith(p, [6_480], { bandId: heavy });
    const card = await p.viewer.dieInstance.get({ id: c.id });
    expect(card).toMatchObject({ pctTenth: 45, tone: "green", position: "in" });
    expect(card.band).toMatchObject({ id: heavy, weightMinG: 6_200, text: "6.2-6.6" });
  });
});

describe("the board", () => {
  test("die.list: copy count, owner name and the worst tone among AVAILABLE copies; search finds a copy code", async () => {
    const p = await plant({ min: 5_900, max: 6_200 });
    const owner = await env.seedCustomer(p.companyId);
    await p.owner.die.update({ id: p.sectionId, series: "Domal", sectionCode: "12170", weightMinG: 5_900, weightMaxG: 6_200, dimensions: {}, ownerCustomerId: owner });
    await copyWith(p, [5_967]);
    const amber = await copyWith(p, [6_480]);
    const redInUse = await copyWith(p, [6_700]);
    await env.db.update(dieInstance).set({ status: "in_use" }).where(eq(dieInstance.id, redInUse.id));
    const other = await env.seedDie(p.companyId, { sectionCode: "4521" });

    const list = await p.viewer.die.list({});
    const row = list.items.find((d) => d.id === p.sectionId)!;
    expect(row).toMatchObject({ copyCount: 3, ownerCustomerId: owner, worstTone: "amber" });
    expect(row.ownerName).toBeString();
    expect(list.items.find((d) => d.id === other)).toMatchObject({ copyCount: 0, ownerName: null, worstTone: "none" });

    const found = await p.viewer.die.list({ search: amber.code.replace("-", "/") });
    expect(found.items.map((d) => d.id)).toEqual([p.sectionId]);
  });
});

describe("suggestFirst (FP-DR-15, C36)", () => {
  test("available copies only, lightest in band, then best tier; never issues; band-scoped", async () => {
    const p = await plant({ min: 5_900, max: 6_200 });
    const inUseLightest = await copyWith(p, [5_905]);
    await env.db.update(dieInstance).set({ status: "in_use" }).where(eq(dieInstance.id, inUseLightest.id));
    const atMaker = await copyWith(p, [5_910]);
    await env.db.update(dieInstance).set({ status: "at_maker" }).where(eq(dieInstance.id, atMaker.id));
    const pick = await copyWith(p, [5_967], { tierRank: 2 });
    const tieBetterTier = await copyWith(p, [5_967], { tierRank: 1 });
    await copyWith(p, [6_480]); // above band
    const out = await p.viewer.dieInstance.suggestFirst({ sectionId: p.sectionId });
    expect(out).toMatchObject({ dieInstanceId: tieBetterTier.id, code: tieBetterTier.code, kgPer12ftMilli: 5_967 });
    expect((await p.viewer.dieInstance.drift({ sectionId: p.sectionId })).suggestFirst!.dieInstanceId).toBe(tieBetterTier.id);
    expect((await env.db.select().from(dieInstance).where(eq(dieInstance.id, pick.id)))[0]!.status).toBe("available");

    // Band-scoped: only copies on the heavy band count.
    const { id: heavy } = await p.owner.die.bands.create({ sectionId: p.sectionId, wallTenthMm: 14, weightMinG: 6_200, weightMaxG: 6_600 });
    expect(await p.viewer.dieInstance.suggestFirst({ sectionId: p.sectionId, bandId: heavy })).toBeNull();
    const heavyCopy = await copyWith(p, [6_480], { bandId: heavy });
    expect(await p.viewer.dieInstance.suggestFirst({ sectionId: p.sectionId, bandId: heavy })).toMatchObject({ dieInstanceId: heavyCopy.id });
    expect(await p.viewer.dieInstance.suggestFirst({ sectionId: p.sectionId, bandId: null })).toMatchObject({ dieInstanceId: tieBetterTier.id });
  });

  test("another company's section or band is NOT_FOUND", async () => {
    const p = await plant({ min: 5_900, max: 6_200 });
    const x = await plant({ min: 5_900, max: 6_200 });
    const { id: xBand } = await x.owner.die.bands.create({ sectionId: x.sectionId, wallTenthMm: 14, weightMinG: 6_200, weightMaxG: 6_600 });
    await expect(p.viewer.dieInstance.suggestFirst({ sectionId: x.sectionId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.viewer.dieInstance.drift({ sectionId: p.sectionId, bandId: xBand })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("runs contract (FP-DR-08)", () => {
  test("no logged runs: []", async () => {
    const p = await plant({ min: 5_900, max: 6_200 });
    const c = await copyWith(p, [5_967]);
    expect(await p.viewer.dieInstance.runs({ dieInstanceId: c.id })).toEqual([]);
  });

  test("newest first; recoveryBp = round(output x 10000 / input); accumulatedG runs up; reading and nitriding attached", async () => {
    const p = await plant({ min: 5_900, max: 6_200 });
    const c = await copyWith(p, []);
    const day = (d: number, h = 0) => new Date(Date.UTC(2026, 9, d, h));
    const run = async (n: string, d: number, inputG: number, goodG: number, status: "logged" | "voided" = "logged") => {
      const id = crypto.randomUUID();
      await env.db.insert(pressRun).values({
        id, companyId: p.companyId, number: n, period: "2026-27", status, sectionId: p.sectionId, dieInstanceId: c.id,
        startedAt: day(d, 8), dieInAt: day(d, 8), dieOutAt: day(d, 10), loggedAt: day(d, 11), inputG, goodG,
        productionDay: `2026-10-${String(d).padStart(2, "0")}`, shiftSeq: 1, pressRemark: `press ${n}`, dieRemark: `die ${n}`,
      });
      return id;
    };
    const r18 = await run("PR-18", 12, 410_400, 310_000);
    await run("PR-30", 15, 100_000, 90_000, "voided");
    const r41 = await run("PR-41", 22, 200_000, 151_000);
    await env.db.insert(dieWeightReading).values({ id: crypto.randomUUID(), companyId: p.companyId, dieInstanceId: c.id, pressRunId: r41, kgPer12ftMilli: 5_967, readAt: day(22, 10) });
    await env.db.insert(nitridingLog).values({ id: crypto.randomUUID(), companyId: p.companyId, dieInstanceId: c.id, nitridedAt: day(14) });

    const rows = await p.viewer.dieInstance.runs({ dieInstanceId: c.id });
    expect(rows.map((r) => r.number)).toEqual(["PR-41", "PR-18"]);
    expect(rows[0]).toMatchObject({
      pressRunId: r41, inputG: 200_000, outputG: 151_000, accumulatedG: 461_000, recoveryBp: 7_550,
      readingMilli: 5_967, pctTenth: 11, speedMilliPerSec: null, pressRemark: "press PR-41", dieRemark: "die PR-41",
      shift: { productionDay: "2026-10-22", seq: 1 },
    });
    expect(rows[0]!.nitridedAt).toEqual(day(14));
    expect(rows[1]).toMatchObject({ pressRunId: r18, accumulatedG: 310_000, recoveryBp: 7_554, readingMilli: null, pctTenth: null, nitridedAt: null });
    expect(rows[1]!.finishedAt).toEqual(day(12, 10));
    // The card's produced grams are the same sum.
    expect(await p.viewer.dieInstance.get({ id: c.id })).toMatchObject({ producedG: 461_000 });
  });
});

describe("tenancy", () => {
  test("another company's copy is NOT_FOUND for get, runs and drift", async () => {
    const p = await plant({ min: 5_900, max: 6_200 });
    const x = await plant({ min: 5_900, max: 6_200 });
    const xc = await copyWith(x, [5_967]);
    await expect(p.viewer.dieInstance.get({ id: xc.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.viewer.dieInstance.runs({ dieInstanceId: xc.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.viewer.dieInstance.drift({ sectionId: x.sectionId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Bands of another company never show.
    await env.db.insert(dieBand).values({ id: crypto.randomUUID(), companyId: x.companyId, sectionId: x.sectionId, wallTenthMm: 1, weightMinG: 1, weightMaxG: 2 });
    expect((await p.viewer.die.bands.list({ sectionId: p.sectionId })).bands).toEqual([]);
  });
});
