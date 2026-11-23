/**
 * XE parity lane COST (rows 16, 17, 51, 52, 61, 92): `costing.*`. The opt-in module gate on every
 * procedure, permission refusals (rates and margins only with `order.price`), tenancy, and the happy
 * path of each row on a small plant built by direct inserts.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import {
  auditLog,
  cast,
  dieInstance,
  dieWeightReading,
  location,
  melt,
  meltInput,
  nitridingLog,
  pressBilletUse,
  pressLine,
  pressRun,
  pressRunLine,
  priceRate,
  purchaseLot,
  salesOrder,
  salesOrderLine,
  scrapGrade,
  scrapItem,
  vendor,
} from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { setClockForTests } from "../src/lib/clock";
import { loadRunInputs, runFilter } from "../src/lib/costing";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";
import { SLOW } from "./sales-fixture";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});
afterEach(() => setClockForTests(null));

/** 2026-11-15 12:00 IST (a Sunday; the week starts Monday 2026-11-09). */
const NOON = new Date("2026-11-15T06:30:00.000Z");
const MOD_OFF = "That module is not on for this plant";
const ON = ["customers", "dies", "bundles", "dispatches", "orders", "foundry", "press", "costing"];
const H = 3_600_000;
const uid = () => crypto.randomUUID();
let seq = 0;

async function plant(opts: { modules?: string[]; priceOnSalesOrder?: boolean; costing?: Record<string, unknown> } = {}) {
  setClockForTests(NOON);
  const { companyId } = await env.seedCompany({
    modules: opts.modules ?? ON,
    settings: { timezone: "Asia/Kolkata", priceOnSalesOrder: opts.priceOnSalesOrder ?? true, ...(opts.costing ? { costing: opts.costing } : {}) },
  });
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  const sectionId = await env.seedDie(companyId, { weightMinG: 1_000, weightMaxG: 1_100 });
  const customerId = await env.seedCustomer(companyId);
  const lineId = uid();
  await env.db.insert(pressLine).values({ id: lineId, companyId, code: `P${++seq}`, name: "Press 1" });
  const copyId = uid();
  await env.db.insert(dieInstance).values({ id: copyId, companyId, sectionId, seqNo: 1, code: `C${++seq}-1`, status: "available" });
  return { companyId, as, sectionId, customerId, lineId, copyId, owner: as("owner"), manager: as("manager"), accountant: as("accountant"), admin: as("admin") };
}
type Plant = Awaited<ReturnType<typeof plant>>;

/** A cast whose melts charged `lotKg` of bought scrap at `ratePaise` (+ `streamKg` of plant scrap) and made `billetKg`. */
async function castOf(p: Plant, o: { lotKg: number; ratePaise: number; streamKg?: number; billetKg: number }) {
  const [loc] = await env.db.select().from(location).where(eq(location.companyId, p.companyId)).limit(1);
  let locationId = loc?.id;
  if (!locationId) {
    locationId = uid();
    await env.db.insert(location).values({ id: locationId, companyId: p.companyId, code: `L${++seq}`, name: "Scrap", kind: "scrap" as never });
  }
  const vendorId = uid();
  await env.db.insert(vendor).values({ id: vendorId, companyId: p.companyId, name: `V${++seq}`, nameKey: `v${seq}` });
  const itemId = uid();
  await env.db.insert(scrapItem).values({ id: itemId, companyId: p.companyId, name: `I${++seq}`, nameKey: `i${seq}` });
  const gradeId = uid();
  await env.db.insert(scrapGrade).values({ id: gradeId, companyId: p.companyId, code: `G${++seq}` });
  const lotId = uid();
  await env.db.insert(purchaseLot).values({
    id: lotId, companyId: p.companyId, number: `LOT-${++seq}`, period: "2026-27", vendorId, lotDate: "2026-11-01",
    scrapItemId: itemId, scrapGradeId: gradeId, partyKgG: o.lotKg * 1000, ratePaise: o.ratePaise, status: "ok" as never,
  });
  const castId = uid();
  const number = `K${++seq}`;
  await env.db.insert(cast).values({ id: castId, companyId: p.companyId, number, period: "2026-11", year: 2026, month: 11, seq, alloy: "6063", openedAt: new Date(NOON.getTime() - 48 * H) });
  const meltId = uid();
  const inputG = (o.lotKg + (o.streamKg ?? 0)) * 1000;
  await env.db.insert(melt).values({ id: meltId, companyId: p.companyId, castId, seq: 1, alloy: "6063", status: "locked", inputG, logsG: o.billetKg * 1000, castingEndAt: new Date(NOON.getTime() - 40 * H) });
  await env.db.insert(meltInput).values({ id: uid(), companyId: p.companyId, meltId, line: 1, kind: "lot", lotId, itemRef: `${itemId}:${gradeId}`, locationId, kgG: o.lotKg * 1000 });
  if (o.streamKg) await env.db.insert(meltInput).values({ id: uid(), companyId: p.companyId, meltId, line: 2, kind: "return_stream", itemRef: "PLANT-SCRAP", locationId, kgG: o.streamKg * 1000 });
  return { castId, number };
}

/** A logged production run. */
async function runOf(p: Plant, o: { day: string; inputKg: number; goodKg: number; buttKg?: number; endsKg?: number; rejectKg?: number; hours?: number; castId?: string | null; orderLineId?: string; copyId?: string | null; lineId?: string | null }) {
  const id = uid();
  const start = new Date(`${o.day}T03:30:00.000Z`);
  await env.db.insert(pressRun).values({
    id, companyId: p.companyId, number: `PR-${++seq}`, period: "2026-27", status: "logged", sectionId: p.sectionId,
    dieInstanceId: o.copyId === undefined ? p.copyId : o.copyId, pressLineId: o.lineId === undefined ? p.lineId : o.lineId, castId: o.castId ?? null, productionDay: o.day,
    inputG: o.inputKg * 1000, goodG: o.goodKg * 1000, discardG: (o.buttKg ?? 0) * 1000, endsG: (o.endsKg ?? 0) * 1000, rejectG: (o.rejectKg ?? 0) * 1000,
    startedAt: start, stoppedAt: o.hours ? new Date(start.getTime() + o.hours * H) : null, loggedAt: new Date(start.getTime() + (o.hours ?? 1) * H),
  });
  if (o.orderLineId) await env.db.insert(pressRunLine).values({ id: uid(), companyId: p.companyId, pressRunId: id, line: 1, salesOrderLineId: o.orderLineId, cutLengthMm: 3_658, pcs: 10, goodG: o.goodKg * 1000 });
  return id;
}

async function orderOf(p: Plant, o: { kg: number; ratePaise?: number; expectedDate?: string }) {
  const res = await p.owner.orders.create({
    customerId: p.customerId,
    poNumber: `PO-${uid().slice(0, 6)}`,
    ...(o.expectedDate ? { expectedDate: o.expectedDate } : {}),
    lines: [{ sectionId: p.sectionId, cutLengthMm: 3_658, kgG: o.kg * 1000, pcs: 100, tierRank: 1 }],
  } as never);
  const [line] = await env.db.select().from(salesOrderLine).where(eq(salesOrderLine.salesOrderId, res.id));
  if (o.ratePaise != null) await env.db.update(salesOrderLine).set({ ratePaise: o.ratePaise }).where(eq(salesOrderLine.id, line!.id));
  return { orderId: res.id, lineId: line!.id };
}

const RATES = { from: "2026-11-01", stages: { casting: { basis: "kg", paise: 800 }, extrusion: { basis: "hour", paise: 120_000 }, ageing: { basis: "kg", paise: 300 }, finishing: { basis: "kg", paise: 0 }, packing: { basis: "kg", paise: 200 } } };

describe("opt-in module gate", () => {
  test(
    "an empty module list and a list without costing refuse every procedure; naming it opens them",
    async () => {
      for (const modules of [[], ["orders", "press", "pricing"]]) {
        const p = await plant({ modules });
        const o = await p.owner.orders.create({ customerId: p.customerId, poNumber: "PO-1", lines: [{ sectionId: p.sectionId, cutLengthMm: 3_658, kgG: 1000, pcs: 1, tierRank: 1 }] } as never).catch(() => null);
        const calls = [
          () => p.manager.costing.settings.get(),
          () => p.manager.costing.settings.update({ lowMarginBp: 500 }),
          () => p.manager.costing.sections({}),
          () => p.manager.costing.runs({}),
          () => p.manager.costing.orderLines({ orderId: o?.id ?? "x" }),
          () => p.manager.costing.profitability({}),
          () => p.manager.costing.capacity({}),
          () => p.manager.costing.forecast({}),
          () => p.manager.costing.dies({}),
        ];
        for (const call of calls) await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN", message: MOD_OFF });
      }
      const p = await plant();
      await expect(p.manager.costing.settings.get()).resolves.toMatchObject({ lowMarginBp: 800, ratesAllowed: true });
    },
    SLOW,
  );
});

describe("permissions and tenancy", () => {
  test(
    "floor roles are refused; admin reads cost but never a rate or margin; accountant reads margins; only managers set rates",
    async () => {
      const p = await plant();
      const { castId } = await castOf(p, { lotKg: 1000, ratePaise: 20_000, billetKg: 950 });
      const { orderId, lineId } = await orderOf(p, { kg: 500, ratePaise: 30_000 });
      await runOf(p, { day: "2026-11-12", inputKg: 600, goodKg: 500, buttKg: 80, endsKg: 20, hours: 2, castId, orderLineId: lineId });
      for (const role of ["packer", "press", "operator", "viewer", "office", "supervisor"] as CompanyRole[]) {
        await expect(p.as(role).costing.sections({})).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(p.as(role).costing.orderLines({ orderId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
      const admin = await p.admin.costing.orderLines({ orderId });
      expect(admin.ratesAllowed).toBe(false);
      expect(admin.lines[0]).not.toHaveProperty("ratePaise");
      expect(admin.lines[0]).not.toHaveProperty("margin");
      expect(admin.lines[0]!.costPaisePerKg).not.toBeNull();
      expect(JSON.stringify(admin)).not.toContain("30000");
      await expect(p.admin.costing.profitability({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await p.admin.costing.settings.get()).ratesAllowed).toBe(false);

      const acc = await p.accountant.costing.orderLines({ orderId });
      expect(acc.lines[0]).toMatchObject({ ratePaise: 30_000, margin: expect.objectContaining({ low: false }) });
      await expect(p.accountant.costing.profitability({})).resolves.toMatchObject({ groupBy: "month" });
      await expect(p.accountant.costing.settings.update({ lowMarginBp: 500 })).rejects.toMatchObject({ code: "FORBIDDEN" });

      await p.manager.costing.settings.update({ lowMarginBp: 1_500, rateVersion: RATES as never });
      const audits = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "cost.settings.update")));
      expect(audits).toHaveLength(1);
    },
    SLOW,
  );

  test(
    "with rates off on orders, nobody gets a margin; another plant's order, runs and press lines are invisible",
    async () => {
      const p = await plant({ priceOnSalesOrder: false });
      const { orderId, lineId } = await orderOf(p, { kg: 500, ratePaise: 30_000 });
      await runOf(p, { day: "2026-11-12", inputKg: 600, goodKg: 500, hours: 2, orderLineId: lineId });
      const acc = await p.accountant.costing.orderLines({ orderId });
      expect(acc.ratesAllowed).toBe(false);
      expect(acc.lines[0]).not.toHaveProperty("margin");
      await expect(p.owner.costing.profitability({})).rejects.toMatchObject({ code: "FORBIDDEN" });

      const q = await plant();
      await expect(q.manager.costing.orderLines({ orderId })).rejects.toMatchObject({ code: "NOT_FOUND", message: "Not found" });
      const qs = await q.manager.costing.sections({ from: "2026-11-01", to: "2026-11-15" });
      expect(qs.rows).toEqual([]);
      await expect(q.manager.costing.settings.update({ lineDowntimeHours: { [p.lineId]: 4 } })).rejects.toMatchObject({ code: "NOT_FOUND" });
      const qd = await q.manager.costing.dies({ state: "all" });
      expect(qd.items.map((d) => d.copyId)).toEqual([q.copyId]);
    },
    SLOW,
  );
});

describe("row 16: cost per kg by stage", () => {
  test(
    "metal from the cast cost, press losses and dated stage rates, per run and per section",
    async () => {
      const p = await plant({ costing: { rates: [RATES, { from: "2026-11-10", stages: { ...RATES.stages, packing: { basis: "kg", paise: 500 } } }] } });
      // 1000 kg bought at Rs 200 + 500 kg plant scrap at no cost -> 1425 kg billets: Rs 140.35 per billet kg.
      const { castId, number } = await castOf(p, { lotKg: 1000, ratePaise: 20_000, streamKg: 500, billetKg: 1425 });
      await runOf(p, { day: "2026-11-05", inputKg: 1000, goodKg: 850, buttKg: 100, endsKg: 40, rejectKg: 10, hours: 4, castId });
      await runOf(p, { day: "2026-11-12", inputKg: 1000, goodKg: 900, buttKg: 80, endsKg: 20, hours: 4, castId });
      const runs = await p.manager.costing.runs({ from: "2026-11-01", to: "2026-11-15" });
      expect(runs.items).toHaveLength(2);
      const [late, early] = runs.items;
      const B = Math.round((1000 * 20_000 * 1000) / 1_425_000); // 14 035
      expect(early!.metal).toMatchObject({ basis: "cast", paisePerBilletKg: B, casts: [expect.objectContaining({ castId, number })] });
      expect(early!.metalPaisePerKg).toBe(Math.round((B * 1000) / 850));
      expect(early!.losses.map((l) => l.kind)).toEqual(["butt", "ends", "rejects"]);
      expect(early!.ratesFrom).toBe("2026-11-01");
      expect(late!.ratesFrom).toBe("2026-11-10");
      expect(early!.stages.find((s) => s.stage === "packing")!.paisePerKg).toBe(200);
      expect(late!.stages.find((s) => s.stage === "packing")!.paisePerKg).toBe(500);
      // extrusion Rs 1200/h × 4 h ÷ 900 kg = Rs 5.33
      expect(late!.stages.find((s) => s.stage === "extrusion")).toMatchObject({ paisePerKg: 533, note: "run_time" });
      expect(late!.totalPaisePerKg).toBe(late!.metalPaisePerKg! + Math.round((800 * 1000) / 900) + 533 + 300 + 0 + 500);

      const sec = await p.manager.costing.sections({ from: "2026-11-01", to: "2026-11-15" });
      expect(sec.rows).toHaveLength(1);
      expect(sec.rows[0]).toMatchObject({ sectionId: p.sectionId, runs: 2, goodG: 1_750_000, recoveryBp: 8750 });
      expect(sec.total.totalPaisePerKg).toBe(Math.round((early!.totalPaisePerKg! * 850_000 + late!.totalPaisePerKg! * 900_000) / 1_750_000));
      expect(sec.missing).toEqual([]);
    },
    SLOW,
  );

  test(
    "a run with no cast cost takes the price master's metal rate of its day; without either it has no total",
    async () => {
      const p = await plant();
      await env.db.insert(priceRate).values([
        { id: uid(), companyId: p.companyId, kind: "metal", key: "nalco", paise: 25_000, effectiveFrom: "2026-11-01", status: "active" },
        { id: uid(), companyId: p.companyId, kind: "metal", key: "nalco", paise: 27_000, effectiveFrom: "2026-11-10", status: "active" },
      ] as never);
      await runOf(p, { day: "2026-11-05", inputKg: 1000, goodKg: 800, hours: 4 });
      await runOf(p, { day: "2026-11-12", inputKg: 1000, goodKg: 800, hours: 4 });
      const runs = await p.manager.costing.runs({ from: "2026-11-01", to: "2026-11-15" });
      const [late, early] = runs.items;
      // No foundry data: bought share and melt yield are taken as 100 %.
      expect(early!.metal).toMatchObject({ basis: "master", listPaisePerKg: 25_000, rateDate: "2026-11-01", paisePerBilletKg: 25_000 });
      expect(late!.metal).toMatchObject({ basis: "master", listPaisePerKg: 27_000, rateDate: "2026-11-10" });
      expect(early!.metalPaisePerKg).toBe(31_250);
      // No stage rates set: listed as missing, counted as zero.
      expect(early!.missing).toEqual(["casting", "extrusion", "ageing", "finishing", "packing"]);
      expect(early!.totalPaisePerKg).toBe(31_250);

      const q = await plant();
      await runOf(q, { day: "2026-11-05", inputKg: 1000, goodKg: 800 });
      const r = await q.manager.costing.runs({});
      expect(r.items[0]).toMatchObject({ metalPaisePerKg: null, totalPaisePerKg: null, metal: { basis: "none" } });
    },
    SLOW,
  );
});

describe("row 17: margin and profitability", () => {
  test(
    "an order line's cost comes from its own runs, its margin is flagged low under the plant line; the month report adds up",
    async () => {
      const p = await plant({ costing: { lowMarginBp: 1_000 } });
      const { castId } = await castOf(p, { lotKg: 1000, ratePaise: 20_000, billetKg: 1000 });
      const a = await orderOf(p, { kg: 800, ratePaise: 30_000 });
      const b = await orderOf(p, { kg: 400, ratePaise: 26_000 });
      // Metal Rs 200 × 1000/800 = Rs 250 per good kg.
      await runOf(p, { day: "2026-11-12", inputKg: 1000, goodKg: 800, buttKg: 200, castId, orderLineId: a.lineId });
      const la = await p.accountant.costing.orderLines({ orderId: a.orderId });
      expect(la.lines[0]).toMatchObject({ costPaisePerKg: 25_000, costBasis: "actual", pressedG: 800_000, ratePaise: 30_000, margin: { marginPaisePerKg: 5_000, marginBp: 1_667, low: false } });
      // Not pressed yet: the section's last 90 days.
      const lb = await p.accountant.costing.orderLines({ orderId: b.orderId });
      expect(lb.lines[0]).toMatchObject({ costPaisePerKg: 25_000, costBasis: "section", pressedG: 0, margin: { marginPaisePerKg: 1_000, marginBp: 385, low: true } });

      const prof = await p.accountant.costing.profitability({ from: "2026-11-01", to: "2026-11-30", groupBy: "month" });
      expect(prof.rows).toHaveLength(1);
      expect(prof.rows[0]).toMatchObject({ key: "2026-11", kgG: 1_200_000, revenuePaise: 800 * 30_000 + 400 * 26_000, costPaise: 1_200 * 25_000, lowKgG: 400_000, lines: 2 });
      expect(prof.total.marginPaise).toBe(800 * 30_000 + 400 * 26_000 - 1_200 * 25_000);
      expect(prof.costBasisKgG).toEqual({ section_month: 1_200_000 });
      const bySection = await p.accountant.costing.profitability({ from: "2026-11-01", to: "2026-11-30", groupBy: "section" });
      expect(bySection.rows[0]!.key).toBe(p.sectionId);
    },
    SLOW,
  );
});

describe("row 51: capacity", () => {
  test(
    "booked kg turns into press hours at the section's own speed; an over-booked week names the orders; a what-if scales a customer",
    async () => {
      // One press day of 10 h a week = 600 min.
      const p = await plant({ costing: { workDaysPerWeek: 1, hoursPerDay: 10, downtimeHoursPerWeek: 0 } });
      // Speed history: 1000 kg in 4 h = 250 kg/h.
      await runOf(p, { day: "2026-11-02", inputKg: 1200, goodKg: 1000, hours: 4 });
      const due = await orderOf(p, { kg: 2_000, expectedDate: "2026-11-14" }); // this week (late work lands here too): 480 min
      await orderOf(p, { kg: 1_000, expectedDate: "2026-11-20" }); // next week: 240 min
      const cap = await p.manager.costing.capacity({ weeks: 4 });
      expect(cap.firstWeek).toBe("2026-11-09");
      expect(cap.plantKgPerHour).toBe(250);
      const w = cap.lines.find((l) => l.id === p.lineId)!.weeks;
      expect(w[0]).toMatchObject({ availableMin: 600, bookedMin: 480, over: false });
      expect(w[1]).toMatchObject({ bookedMin: 240, over: false });
      expect(cap.overWeeks).toBe(0);

      const more = await p.manager.costing.capacity({ weeks: 4, scenario: [{ customerId: p.customerId, pct: 50 }] });
      const mw = more.lines.find((l) => l.id === p.lineId)!.weeks;
      expect(mw[0]).toMatchObject({ bookedMin: 720, over: true });
      const [so] = await env.db.select({ number: salesOrder.number }).from(salesOrder).where(eq(salesOrder.id, due.orderId));
      expect(mw[0]!.refs).toEqual([expect.objectContaining({ ref: expect.stringContaining(`${so!.number}/1`), minutes: 720, g: 3_000_000 })]);
      expect(more.overWeeks).toBe(1);
    },
    SLOW,
  );
});

describe("rows 51 and 52 together: forecast and what-if feed the press load", () => {
  test(
    "expected orders above what is booked add load in later weeks; a what-if percent scales them",
    async () => {
      const p = await plant({ costing: { workDaysPerWeek: 6, hoursPerDay: 20 } });
      await runOf(p, { day: "2026-11-02", inputKg: 1200, goodKg: 1000, hours: 4 }); // 250 kg/h
      // 3 months of 4300 kg each, nothing open: about 1000 kg a week expected.
      for (const day of ["2026-08-10", "2026-09-10", "2026-10-10"]) {
        const o = await orderOf(p, { kg: 4_300 });
        await env.db.run(`update sales_order set order_date = '${day}', status = 'closed' where id = '${o.orderId}'` as never);
      }
      const plain = await p.manager.costing.capacity({ weeks: 4 });
      expect(plain.lines[0]!.weeks.every((w) => w.bookedMin === 0)).toBe(true);
      const fc = await p.manager.costing.capacity({ weeks: 4, withForecast: true });
      expect(fc.forecast).toMatchObject({ pairs: 1 });
      const w1 = fc.lines[0]!.weeks[1]!;
      expect(w1.refs[0]!.ref).toMatch(/^forecast /);
      const weekG = Math.round((4_300_000 * 7) / 30.4);
      expect(w1.bookedMin).toBe(Math.round((weekG * 60) / 250_000));
      expect(fc.lines[0]!.weeks[0]!.bookedMin).toBe(0); // this week is what is booked
      const up = await p.manager.costing.capacity({ weeks: 4, withForecast: true, scenario: [{ customerId: p.customerId, pct: 100 }] });
      expect(up.lines[0]!.weeks[1]!.bookedMin).toBe(Math.round((Math.round(weekG * 2) * 60) / 250_000));
    },
    SLOW,
  );
});

describe("row 16: runs page", () => {
  test(
    "a section with more runs than the page says there is a next page",
    async () => {
      const p = await plant();
      for (const d of ["2026-11-10", "2026-11-11", "2026-11-12"]) await runOf(p, { day: d, inputKg: 1000, goodKg: 800 });
      const first = await p.manager.costing.runs({ limit: 2, offset: 0 });
      expect(first.items).toHaveLength(2);
      expect(first.nextOffset).toBe(2);
      const second = await p.manager.costing.runs({ limit: 2, offset: 2 });
      expect(second.items).toHaveLength(1);
      expect(second.nextOffset).toBeNull();
    },
    SLOW,
  );
});

describe("row 52: forecast", () => {
  test(
    "a moving average of the last three full months with its method named, per plant and per customer",
    async () => {
      const p = await plant();
      for (const [day, kg] of [["2026-08-10", 100], ["2026-09-10", 200], ["2026-10-10", 300], ["2026-11-10", 999]] as const) {
        const o = await orderOf(p, { kg });
        await env.db.run(`update sales_order set order_date = '${day}' where id = '${o.orderId}'` as never);
      }
      const f = await p.manager.costing.forecast({ groupBy: "plant", horizon: 2 });
      expect(f.currentMonth).toBe("2026-11");
      expect(f.rows[0]).toMatchObject({ method: "ma3", baseG: 200_000, forecast: [{ month: "2026-11", g: 200_000 }, { month: "2026-12", g: Math.round((200_000 + 300_000 + 200_000) / 3) }] });
      const byCustomer = await p.manager.costing.forecast({ groupBy: "customer" });
      expect(byCustomer.rows[0]!.key).toBe(p.customerId);
      expect(byCustomer.rows[0]!.label).not.toBe(p.customerId);
    },
    SLOW,
  );
});

describe("row 61: die maintenance due", () => {
  test(
    "the copy's own nitriding history sets its interval; a reading line projects the kg left in the band",
    async () => {
      const p = await plant({ costing: { dieSoonBp: 1_500, dieSoonDays: 0 } });
      // Nitrided after 0, 2 t and 4 t; 1.8 t pressed since: interval 2 t, 200 kg left -> soon (10 % left < 15 %).
      const day = (d: number) => `2026-10-${String(d).padStart(2, "0")}`;
      await env.db.insert(nitridingLog).values({ id: uid(), companyId: p.companyId, dieInstanceId: p.copyId, nitridedAt: new Date("2026-09-30T00:00:00Z") });
      await runOf(p, { day: day(2), inputKg: 2500, goodKg: 2000, hours: 8 });
      await env.db.insert(nitridingLog).values({ id: uid(), companyId: p.companyId, dieInstanceId: p.copyId, nitridedAt: new Date("2026-10-03T00:00:00Z") });
      await runOf(p, { day: day(5), inputKg: 2500, goodKg: 2000, hours: 8 });
      await env.db.insert(nitridingLog).values({ id: uid(), companyId: p.companyId, dieInstanceId: p.copyId, nitridedAt: new Date("2026-10-06T00:00:00Z") });
      // Readings since: +10 g per 12 ft per tonne from 1000; band top 1100.
      for (let t = 0; t <= 3; t++) {
        await runOf(p, { day: day(10 + t), inputKg: 700, goodKg: t === 0 ? 0.001 : 600, hours: 2 });
        await env.db.insert(dieWeightReading).values({ id: uid(), companyId: p.companyId, dieInstanceId: p.copyId, kgPer12ftMilli: 1000 + Math.round(t * 6), readAt: new Date(`${day(10 + t)}T12:00:00Z`) });
      }
      const d = await p.manager.costing.dies({ state: "all" });
      expect(d.copies).toBe(1);
      const c = d.items[0]!;
      expect(c.nitride).toMatchObject({ basis: "copy", intervalG: 2_000_000, samples: 2, treatments: 3, state: "soon" });
      expect(c.nitride.sinceG).toBe(1_800_001);
      expect(c.correct).toMatchObject({ basis: "none", state: "unknown" });
      expect(c.drift.state).toBe("too_few"); // 1.8 t of pressing between the readings, under the 2 t minimum
      expect(d.soon).toBe(1);
      const attention = await p.manager.costing.dies({});
      expect(attention.items.map((x) => x.copyId)).toEqual([p.copyId]);
    },
    SLOW,
  );
});

describe("settings", () => {
  test(
    "a dated rate version is added and removed; an hourly rate off the press needs kg per hour; bad values are refused",
    async () => {
      const p = await plant();
      await expect(
        p.manager.costing.settings.update({ rateVersion: { from: "2026-11-01", stages: { ageing: { basis: "hour", paise: 50_000, kgPerHour: null } } } }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await p.manager.costing.settings.update({ rateVersion: RATES as never, workDaysPerWeek: 6, lineDowntimeHours: { [p.lineId]: 8 } });
      let s = await p.manager.costing.settings.get();
      expect(s.rates.map((r) => r.from)).toEqual(["2026-11-01"]);
      expect(s.ratesToday!.from).toBe("2026-11-01");
      expect(s.lineDowntimeHours).toEqual({ [p.lineId]: 8 });
      await p.manager.costing.settings.update({ removeRateFrom: "2026-11-01" });
      s = await p.manager.costing.settings.get();
      expect(s.rates).toEqual([]);
      await expect(p.manager.costing.settings.update({ lowMarginBp: 20_000 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    },
    SLOW,
  );
});

describe("fix round 1", () => {
  test(
    "work on a section last pressed on a press that is now off goes to the unassigned list, never lost",
    async () => {
      const p = await plant({ costing: { workDaysPerWeek: 1, hoursPerDay: 10, downtimeHoursPerWeek: 0 } });
      const old = uid();
      await env.db.insert(pressLine).values({ id: old, companyId: p.companyId, code: `P${++seq}`, name: "Press 2" });
      await runOf(p, { day: "2026-11-02", inputKg: 1200, goodKg: 1000, hours: 4, lineId: old }); // 250 kg/h on press 2
      await env.db.update(pressLine).set({ status: "retired" }).where(eq(pressLine.id, old));
      await orderOf(p, { kg: 2_000, expectedDate: "2026-11-14" });
      const cap = await p.manager.costing.capacity({ weeks: 4 });
      expect(cap.lines.map((l) => l.id)).toEqual([p.lineId]);
      expect(cap.lines[0]!.weeks[0]!.bookedMin).toBe(0);
      expect(cap.unassigned).toEqual([expect.objectContaining({ g: 2_000_000, minutes: 480, reason: "press_inactive" })]);
      expect(cap).toMatchObject({ unassignedCount: 1, unassignedG: 2_000_000, pressInactiveCount: 1, noSpeedCount: 0, noSpeedG: 0 });
    },
    SLOW,
  );

  test(
    "press-run rows with 0 kg are left out of a line's cost; with nothing else the cost is unknown and there is no margin",
    async () => {
      const p = await plant();
      const { castId } = await castOf(p, { lotKg: 1000, ratePaise: 20_000, billetKg: 1000 });
      const a = await orderOf(p, { kg: 800, ratePaise: 30_000 });
      // A costed run (Rs 250 per good kg) that pressed for another line; this line got a 0 pcs, 0 kg row.
      const run = await runOf(p, { day: "2026-11-12", inputKg: 1000, goodKg: 800, castId });
      await env.db.insert(pressRunLine).values({ id: uid(), companyId: p.companyId, pressRunId: run, line: 1, salesOrderLineId: a.lineId, cutLengthMm: 3_658, pcs: 0, goodG: 0 });
      const zero = await p.accountant.costing.orderLines({ orderId: a.orderId });
      expect(zero.lines[0]).toMatchObject({ costPaisePerKg: null, costBasis: "none", pressedG: 0, margin: null });
      expect(zero.truncated).toBe(false);
      // A real row on another run: the cost is that run's, the zero row does not dilute it.
      const run2 = await runOf(p, { day: "2026-11-13", inputKg: 1000, goodKg: 500, castId, orderLineId: a.lineId });
      expect(run2).toBeTruthy();
      const mixed = await p.accountant.costing.orderLines({ orderId: a.orderId });
      expect(mixed.lines[0]).toMatchObject({ costPaisePerKg: 40_000, costBasis: "actual", pressedG: 500_000 });
    },
    SLOW,
  );

  test(
    "a run's billets from two casts take their kg-weighted cost; one uncosted cast sends the run to the price master",
    async () => {
      const p = await plant();
      await env.db.insert(priceRate).values({ id: uid(), companyId: p.companyId, kind: "metal", key: "nalco", paise: 25_000, effectiveFrom: "2026-11-01", status: "active" } as never);
      const a = await castOf(p, { lotKg: 1000, ratePaise: 20_000, billetKg: 1000 }); // Rs 200 per billet kg
      const b = await castOf(p, { lotKg: 1000, ratePaise: 30_000, billetKg: 1000 }); // Rs 300 per billet kg
      const run = await runOf(p, { day: "2026-11-12", inputKg: 1000, goodKg: 800, castId: a.castId });
      await env.db.insert(pressBilletUse).values([
        { id: uid(), companyId: p.companyId, pressRunId: run, line: 1, castId: a.castId, count: 15, kgG: 600_000 },
        { id: uid(), companyId: p.companyId, pressRunId: run, line: 2, castId: b.castId, count: 10, kgG: 400_000 },
      ]);
      // A cast with no locked melt has no cost.
      const bare = uid();
      await env.db.insert(cast).values({ id: bare, companyId: p.companyId, number: `K${++seq}`, period: "2026-11", year: 2026, month: 11, seq, alloy: "6063", openedAt: NOON });
      const run2 = await runOf(p, { day: "2026-11-13", inputKg: 1000, goodKg: 800 });
      await env.db.insert(pressBilletUse).values([
        { id: uid(), companyId: p.companyId, pressRunId: run2, line: 1, castId: a.castId, count: 15, kgG: 600_000 },
        { id: uid(), companyId: p.companyId, pressRunId: run2, line: 2, castId: bare, count: 10, kgG: 400_000 },
      ]);
      const res = await p.manager.costing.runs({ from: "2026-11-01", to: "2026-11-15" });
      const mixed = res.items.find((r) => r.id === run)!;
      // (600 × 20 000 + 400 × 30 000) ÷ 1000 = 24 000 per billet kg; × 1000 ÷ 800 = 30 000 per good kg.
      expect(mixed.metal).toMatchObject({ basis: "cast", paisePerBilletKg: 24_000 });
      expect(mixed.metal.casts.map((c) => [c.castId, c.kgG, c.perBilletKgPaise])).toEqual(
        expect.arrayContaining([[a.castId, 600_000, 20_000], [b.castId, 400_000, 30_000]]),
      );
      expect(mixed.metalPaisePerKg).toBe(30_000);
      const fallback = res.items.find((r) => r.id === run2)!;
      expect(fallback.metal).toMatchObject({ basis: "master", listPaisePerKg: 25_000 });
      expect(fallback.metal.casts).toHaveLength(2);
      expect(fallback.metal.casts.find((c) => c.castId === bare)!.perBilletKgPaise).toBeNull();
    },
    SLOW,
  );

  test(
    "the cast and billet reads cover only the runs a read takes, not the whole date range",
    async () => {
      const p = await plant();
      const oldCast = await castOf(p, { lotKg: 1000, ratePaise: 20_000, billetKg: 1000 });
      const newCast = await castOf(p, { lotKg: 1000, ratePaise: 30_000, billetKg: 1000 });
      const early = await runOf(p, { day: "2026-11-05", inputKg: 1000, goodKg: 800 });
      const late = await runOf(p, { day: "2026-11-12", inputKg: 1000, goodKg: 800 });
      await env.db.insert(pressBilletUse).values([
        { id: uid(), companyId: p.companyId, pressRunId: early, line: 1, castId: oldCast.castId, count: 10, kgG: 1_000_000 },
        { id: uid(), companyId: p.companyId, pressRunId: late, line: 1, castId: newCast.castId, count: 10, kgG: 1_000_000 },
      ]);
      const where = runFilter(p.companyId, { from: "2026-11-01", to: "2026-11-15" });
      const one = await loadRunInputs(env.db as never, p.companyId, where, 1);
      expect(one.runs.map((r) => r.id)).toEqual([late]);
      expect(one.truncated).toBe(true);
      expect([...one.casts.keys()]).toEqual([newCast.castId]);
      expect([...one.uses.keys()]).toEqual([late]);
      const both = await loadRunInputs(env.db as never, p.companyId, where, 10);
      expect(both.casts.size).toBe(2);
      expect(both.uses.size).toBe(2);
      // The page read takes offset + limit runs, so a first page of one costs only the newest run.
      const page = await p.manager.costing.runs({ from: "2026-11-01", to: "2026-11-15", limit: 1 });
      expect(page.items.map((r) => r.id)).toEqual([late]);
      expect(page.items[0]!.metal).toMatchObject({ basis: "cast", paisePerBilletKg: 30_000 });
      expect(page.nextOffset).toBe(1);
    },
    SLOW,
  );
});
