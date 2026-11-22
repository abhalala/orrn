/**
 * XE parity lane REG: the registers and views (#30 rejections, #31 recuts, #32 where an order sits,
 * #53 plan against actual, #96 unpacked stock, #74 material reconciliation, #49 billet need, #81 the
 * owner's page) and the morning mail (#82). Each: the happy path, the role refusal, and another plant's
 * ids are Not found (or simply absent from a plant-scoped answer).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, bundle } from "@orrn/db/schema";
import { and, eq, sql } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { opHelpers } from "./orders-w1-fixture";
import { fillWorkedExample, pressHelpers } from "./press-w2-fixture";
import { ist, kg, NOON, salesHelpers, SLOW } from "./sales-fixture";

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

const sales = salesHelpers(() => env);
const { opPlant } = opHelpers(() => env);
const HOUR = 3_600_000;

async function errOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (e) {
    return { code: (e as { code?: string }).code, message: (e as Error).message };
  }
  return { code: "OK", message: "" };
}

const RANGE = { from: "2026-10-01", to: "2026-10-31" };

describe("registers", () => {
  test("every register answers for a reports reader; a packer is refused; a range past a year or backwards is refused", async () => {
    setClock(NOON);
    const p = await sales.plant();
    const viewer = p.as("viewer");
    const rej = await viewer.reports.rejections(RANGE);
    expect(rej).toMatchObject({ rows: [], totals: { entries: 0, pcs: 0, kgG: 0 } });
    const rec = await viewer.reports.recuts(RANGE);
    expect(rec).toMatchObject({ rows: [], totals: { bundles: 0 } });
    const pa = await viewer.reports.planActual({ ...RANGE, groupBy: "die" });
    expect(pa).toMatchObject({ groupBy: "die", rows: [], totals: { plannedG: 0, actualG: 0 } });
    expect((await viewer.reports.unpacked()).rows).toEqual([]);
    const packer = p.as("packer");
    expect(await errOf(packer.reports.rejections(RANGE))).toMatchObject({ code: "FORBIDDEN" });
    expect(await errOf(packer.reports.recuts(RANGE))).toMatchObject({ code: "FORBIDDEN" });
    expect(await errOf(packer.reports.planActual(RANGE))).toMatchObject({ code: "FORBIDDEN" });
    expect(await errOf(packer.reports.materials(RANGE))).toMatchObject({ code: "FORBIDDEN" });
    // The packer's own view of unpacked stock (bundle.pack) is allowed.
    expect((await packer.reports.unpacked()).totals).toMatchObject({ pcs: 0, kgG: 0 });
    expect(await errOf(viewer.reports.rejections({ from: "2026-10-31", to: "2026-10-01" }))).toMatchObject({ code: "BAD_REQUEST" });
    expect(await errOf(viewer.reports.materials({ from: "2025-01-01", to: "2026-10-01" }))).toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("material reconciliation: packed bundles come in, a dispatch goes out, and the class balances", async () => {
    setClock(NOON);
    const p = await sales.plant();
    const q = await sales.plant();
    const serials = await p.pack(p.dieA, [{ kg: 10 }, { kg: 6 }]);
    const d = await p.held([serials[0]!]);
    await p.owner.dispatch.complete({ id: d });
    const m = await p.as("accountant").reports.materials(RANGE);
    const bundles = m.classes.find((c) => c.class === "bundle")!;
    expect(bundles.closingG).toBe(kg(6));
    expect(bundles.balanced).toBe(true);
    expect(bundles.openingG + bundles.inG - bundles.outG + bundles.gapG).toBe(bundles.closingG);
    expect(bundles.inG).toBeGreaterThanOrEqual(kg(16));
    expect(bundles.outG).toBeGreaterThanOrEqual(kg(10));
    // Another plant's ledger is its own.
    const other = (await q.owner.reports.materials(RANGE)).classes.find((c) => c.class === "bundle")!;
    expect(other.closingG).toBe(0);
  }, SLOW);
});

describe("where an order sits (#32)", () => {
  test("each open line's kg by stage; another plant's order id lists nothing; office reads it through order.manage", async () => {
    setClock(NOON);
    const p = await sales.plant();
    const q = await sales.plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const lineId = o.lineIds[0]!;
    const serials = await p.pack(p.dieA, [{ kg: 10 }, { kg: 15 }], lineId);
    const d = await p.held([serials[0]!]);
    await p.owner.dispatch.complete({ id: d });
    const w = await p.as("office").reports.wip({ orderId: o.id });
    expect(w.rows).toHaveLength(1);
    const row = w.rows[0]!;
    expect(row.lineId).toBe(lineId);
    expect(row.wip.dispatched).toBe(kg(10));
    expect(row.wip.packed).toBe(kg(15));
    const stages = row.wip.notPlanned + row.wip.planned + row.wip.onPress + row.wip.ageing + row.wip.unpacked + row.wip.packed + row.wip.dispatched;
    expect(stages).toBe(row.wip.orderedG + row.wip.overG);
    expect((await q.owner.reports.wip({ orderId: o.id })).rows).toHaveLength(0);
    expect(await errOf(p.as("packer").reports.wip())).toMatchObject({ code: "FORBIDDEN" });
  }, SLOW);
});

describe("billet need (#49)", () => {
  test("a plan's lines with the billet kg and a ready dot; another plant's plan is Not found", async () => {
    const p = await opPlant();
    const q = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    const t = Date.now();
    const plan = await p.owner.plans.create({ windowStart: t, windowEnd: t + HOUR, dies: [{ sectionId: s, lines: [{ salesOrderLineId: o.lineIds[0]!, pcs: 10 }] }] });
    const need = await p.as("office").reports.billetNeed({ planId: plan.id });
    expect(need.rows).toHaveLength(1);
    const r = need.rows[0]!;
    expect(r.kgG).toBe(kg(120));
    expect(r.dieReady).toBe(true);
    // No billets in stock: the billet kg is more than the finished kg (recovery under 100 %) and not ready.
    expect(r.billetKgG).toBeGreaterThan(kg(120));
    expect(r.ready).toBe(false);
    expect(await errOf(q.owner.reports.billetNeed({ planId: plan.id }))).toEqual({ code: "NOT_FOUND", message: "Plan not found" });
    expect(await errOf(p.as("packer").reports.billetNeed({ planId: plan.id }))).toMatchObject({ code: "FORBIDDEN" });
  }, SLOW);
});

describe("the owner's page (#81) and the morning mail (#82)", () => {
  test("reports.morning: yesterday's dispatches; admin only", async () => {
    setClock(NOON);
    const p = await sales.plant();
    const serials = await p.pack(p.dieA, [{ kg: 12 }]);
    const d = await p.held(serials);
    await p.owner.dispatch.complete({ id: d });
    setClock(ist("2026-10-04T09:00:00"));
    const f = await p.as("admin").reports.morning();
    expect(f).toMatchObject({ day: "2026-10-03", dispatches: 1, dispatchedG: kg(12) });
    expect(await errOf(p.as("manager").reports.morning())).toMatchObject({ code: "FORBIDDEN" });
  }, SLOW);

  test("the setting is off by default, partial saves keep the other field, and the hourly run sends once in the chosen hour", async () => {
    setClock(NOON);
    const p = await sales.plant();
    const off = await sales.plant();
    expect((await p.owner.company.getSettings()).morningSummary).toEqual({ enabled: false, hour: 7 });
    await p.owner.company.updateSettings({ morningSummary: { hour: 8 } });
    await p.owner.company.updateSettings({ morningSummary: { enabled: true } });
    expect((await p.owner.company.getSettings()).morningSummary).toEqual({ enabled: true, hour: 8 });
    expect(await errOf(p.owner.company.updateSettings({ morningSummary: { hour: 24 } }))).toMatchObject({ code: "BAD_REQUEST" });
    expect(await errOf(p.as("office").company.updateSettings({ morningSummary: { enabled: false } }))).toMatchObject({ code: "FORBIDDEN" });

    const { runMorningSummaries, morningClaimId } = await import("../src/lib/morningSummary");
    const sent: { to: string; subject: string; text?: string }[] = [];
    const send = async (m: { to: string; subject: string; text?: string }) => {
      sent.push(m);
    };
    const quiet = { log: () => {}, error: () => {} };
    const mine = <T extends { companyId: string }>(rs: T[]) => rs.filter((r) => r.companyId === p.companyId || r.companyId === off.companyId);

    // 07:05 plant time: not this plant's hour.
    expect(mine(await runMorningSummaries(env.db, ist("2026-10-04T07:05:00"), send, quiet))).toEqual([]);
    // 08:05: owner and admin get it, once.
    const first = mine(await runMorningSummaries(env.db, ist("2026-10-04T08:05:00"), send, quiet));
    expect(first).toEqual([{ companyId: p.companyId, outcome: "sent", recipients: 2 }]);
    const mails = sent.filter((m) => [p.users.owner.email, p.users.admin.email].includes(m.to));
    expect(mails.map((m) => m.to).sort()).toEqual([p.users.admin.email, p.users.owner.email].sort());
    expect(mails[0]!.text).toContain("2026-10-03");
    expect(mails[0]!.text).not.toContain("₹");
    expect(sent.some((m) => m.to === off.users.owner.email)).toBe(false);
    // A second tick in the same hour finds the claim and sends nothing.
    const again = mine(await runMorningSummaries(env.db, ist("2026-10-04T08:35:00"), send, quiet));
    expect(again).toEqual([{ companyId: p.companyId, outcome: "already", recipients: 0 }]);
    expect(sent.filter((m) => m.to === p.users.owner.email)).toHaveLength(1);
    const [claim] = await env.db.select().from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.id, morningClaimId(p.companyId, "2026-10-04"))));
    expect(claim).toMatchObject({ action: "mis.morning.sent", meta: { state: "sent", recipients: 2, failed: 0 } });

    // A sender that throws for one plant never stops the run, and is recorded.
    await p.owner.company.updateSettings({ morningSummary: { hour: 9 } });
    const failing = async () => {
      throw new Error("mail down");
    };
    const next = mine(await runMorningSummaries(env.db, ist("2026-10-05T09:05:00"), failing, quiet));
    expect(next).toMatchObject([{ companyId: p.companyId, outcome: "failed", recipients: 2 }]);
  }, SLOW);
});

async function trolleyRow(companyId: string, dieId: string, pcs: number, lengthMm: number) {
  const id = crypto.randomUUID();
  const trolleyId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  await env.db.run(sql`insert into trolley (id, company_id, code, status) values (${trolleyId}, ${companyId}, ${`T-${trolleyId.slice(0, 6)}`}, 'active')`);
  await env.db.run(sql`insert into ageing_batch (id, company_id, number, status, trolley_id) values (${batchId}, ${companyId}, ${`AG-${batchId.slice(0, 6)}`}, 'released', ${trolleyId})`);
  await env.db.run(sql`insert into ageing_row (id, company_id, batch_id, die_id, length_mm, pcs, status) values (${id}, ${companyId}, ${batchId}, ${dieId}, ${lengthMm}, ${pcs}, 'released')`);
  return id;
}

describe("recut register (#31)", () => {
  test("a bundle cut shorter than its trolley line keeps its reason and shows in the register with the weight lost", async () => {
    setClock(NOON);
    const p = await sales.plant();
    const q = await sales.plant();
    const rowId = await trolleyRow(p.companyId, p.dieA, 30, 5_000);
    await p.owner.bundle.createReceipt({
      dieId: p.dieA,
      unit: "pcs",
      locationId: p.yard,
      ageingRowId: rowId,
      rows: [
        { quantity: 10, weightG: kg(40), lengthMm: 4_000, recutReason: "Bend at one end" },
        { quantity: 10, weightG: kg(50), lengthMm: 5_000, recutReason: "Not a recut" },
      ],
    });
    const rows = await env.db.select({ recut: bundle.recut, recutReason: bundle.recutReason, lengthMm: bundle.lengthMm }).from(bundle).where(eq(bundle.ageingRowId, rowId));
    const cut = rows.find((r) => r.lengthMm === 4_000)!;
    const full = rows.find((r) => r.lengthMm === 5_000)!;
    expect(cut).toMatchObject({ recut: true, recutReason: "Bend at one end" });
    // Not shorter than the trolley line: not a recut, and the reason is dropped.
    expect(full).toMatchObject({ recut: false, recutReason: null });
    const reg = await p.as("viewer").reports.recuts(RANGE);
    expect(reg.rows).toHaveLength(1);
    // 40 kg over 4 000 mm cut from 5 000 mm: 10 kg lost.
    expect(reg.rows[0]).toMatchObject({ lengthMm: 4_000, fromLengthMm: 5_000, weightG: kg(40), lossG: kg(10), reason: "Bend at one end" });
    expect(reg.totals).toMatchObject({ bundles: 1, lossG: kg(10) });
    expect((await q.owner.reports.recuts(RANGE)).rows).toHaveLength(0);
  }, SLOW);
});

const { pressPlant } = pressHelpers(() => env);
const ymdIst = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

describe("rejections (#30) and plan against actual (#53) with real runs", () => {
  test("a logged run on a released plan: planned against good weight, its QC reject and a pack reject in the register", async () => {
    const p = await pressPlant();
    const q = await pressPlant();
    const c = await p.castWith(kg(5_000));
    const a = await p.countingRun();
    await fillWorkedExample(p, a.runId, c.id, { planLineId: a.planLineIds[0] });
    await p.as("supervisor").press.runs.close({ id: a.runId });
    await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, rows: [{ quantity: 10, weightG: kg(10), lengthMm: 3_658 }], rejects: [{ pcs: 2, weightG: kg(2), reasonCode: "surface" }] });
    const range = { from: ymdIst(Date.now() - 86_400_000), to: ymdIst(Date.now() + 86_400_000) };

    const pa = await p.as("viewer").reports.planActual({ ...range, groupBy: "die" });
    expect(pa.rows).toHaveLength(1);
    // 100 pcs at 12 ft on a 12.000 copy = 1 200 kg planned; the worked example logs 234.2 kg good.
    expect(pa.rows[0]).toMatchObject({ plannedG: kg(1_200), actualG: kg(234.2), gapG: kg(234.2) - kg(1_200) });
    expect(pa.totals).toMatchObject({ plannedG: kg(1_200), actualG: kg(234.2) });
    expect((await q.owner.reports.planActual({ ...range, groupBy: "die" })).rows).toHaveLength(0);

    const rej = await p.as("viewer").reports.rejections(range);
    expect(rej.totals).toEqual({ entries: 2, pcs: 5, kgG: kg(9) });
    expect(rej.rows.map((r) => r.source).sort()).toEqual(["pack", "press"]);
    const press = rej.rows.find((r) => r.source === "press")!;
    expect(press).toMatchObject({ runId: a.runId, sectionId: a.sectionId, pcs: 3, kgG: kg(7) });
    expect(rej.byReason).toHaveLength(2);
    const onlyPack = await p.as("viewer").reports.rejections({ ...range, source: "pack" });
    expect(onlyPack.totals).toEqual({ entries: 1, pcs: 2, kgG: kg(2) });
    const onlySection = await p.as("viewer").reports.rejections({ ...range, sectionId: a.sectionId });
    expect(onlySection.rows.map((r) => r.runId)).toEqual([a.runId]);
    expect((await q.owner.reports.rejections(range)).totals.entries).toBe(0);
  }, SLOW);
});

describe("unpacked stock (#96)", () => {
  test("released trolley weight less what was packed, per section", async () => {
    setClock(NOON);
    const p = await sales.plant();
    const rowId = await trolleyRow(p.companyId, p.dieA, 30, 3_658);
    await env.db.run(sql`update ageing_row set kg_g = ${kg(120)} where id = ${rowId}`);
    await p.owner.bundle.createReceipt({ dieId: p.dieA, unit: "pcs", locationId: p.yard, ageingRowId: rowId, rows: [{ quantity: 10, weightG: kg(40), lengthMm: 3_658 }] });
    const u = await p.as("packer").reports.unpacked();
    expect(u.rows).toHaveLength(1);
    expect(u.rows[0]).toMatchObject({ sectionId: p.dieA, pcs: 20, kgG: kg(80) });
    expect(u.totals).toMatchObject({ pcs: 20, kgG: kg(80) });
  }, SLOW);
});
