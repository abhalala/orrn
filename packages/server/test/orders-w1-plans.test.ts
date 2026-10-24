/**
 * W1-OP-S: press plans (FP-OP-11/12/13/15/16; specs §E2 "Press plan"; ledger D6), the planned /
 * pressed figures of the balance strip, late orders (FP-OP-18) and the suggested line.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, docSeries, pressLine, pressPlan, pressRun } from "@orrn/db/schema";
import { and, asc, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { FT12, FT18, opHelpers, setSectionOwner } from "./orders-w1-fixture";
import { kg, saveOrder, SLOW } from "./sales-fixture";

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

const { opPlant } = opHelpers(() => env);
const HOUR = 3_600_000;
const NOON = new Date("2026-10-20T06:30:00.000Z");

async function runsOf(planId: string) {
  return env.db.select().from(pressRun).where(eq(pressRun.planId, planId)).orderBy(asc(pressRun.number));
}

describe("FP-OP-13: plans.create / release / cancel / close", () => {
  test("release makes one queued run per plan die with PR numbers; the plan gets its PP number", async () => {
    setClock(NOON);
    const p = await opPlant();
    const s1 = await p.section();
    const s2 = await p.section();
    await p.copy(s1, { milli: 12_000 });
    await p.copy(s2, { milli: 12_000 });
    const o = await p.confirmedOrder([
      { sectionId: s1, pcs: 100 },
      { sectionId: s2, pcs: 50, mm: FT18 },
    ]);
    const plan = await p.as("office").plans.create({
      windowStart: NOON.getTime(),
      windowEnd: NOON.getTime() + 12 * HOUR,
      dies: [
        { sectionId: s1, urgent: true, lines: [{ salesOrderLineId: o.lineIds[0]!, pcs: 40 }] },
        { sectionId: s2, lines: [{ salesOrderLineId: o.lineIds[1]!, kgG: kg(100) }] },
      ],
    });
    expect(plan).toMatchObject({ number: "PP-1", period: "2026-27", status: "draft" });
    const got = await p.owner.plans.get({ id: plan.id });
    // 40 pcs x 12 ft at 12.000 = 480 kg; 100 kg at 12.000 x 18 ft = 100000 x 36576 / (5486 x 120000) -> 6 pcs.
    expect(got.lines.map((l) => [l.salesOrderLineId, l.pcs, l.kgG, l.cutLengthMm])).toEqual(
      expect.arrayContaining([
        [o.lineIds[0], 40, kg(480), FT12],
        [o.lineIds[1], 6, kg(100), FT18],
      ]),
    );
    expect(await runsOf(plan.id)).toHaveLength(0);

    const rel = await p.as("manager").plans.release({ id: plan.id });
    expect(rel.status).toBe("released");
    expect(rel.runs.map((r) => r.number)).toEqual(["PR-1", "PR-2"]);
    const runs = await runsOf(plan.id);
    expect(runs.map((r) => [r.number, r.status, r.sectionId, r.pressLineId, r.dieInstanceId])).toEqual([
      ["PR-1", "queued", s1, p.pressLineId, null],
      ["PR-2", "queued", s2, p.pressLineId, null],
    ]);
    const [row] = await env.db.select().from(pressPlan).where(eq(pressPlan.id, plan.id));
    expect(row).toMatchObject({ status: "released", pressLineId: p.pressLineId });
    const actions = (
      await env.db.select({ a: auditLog.action }).from(auditLog).where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.subjectId, plan.id)))
    ).map((r) => r.a);
    expect(actions.sort()).toEqual(["plan.create", "plan.release"]);
    const series = await env.db.select().from(docSeries).where(and(eq(docSeries.companyId, p.companyId), eq(docSeries.docType, "press_plan")));
    expect(series[0]).toMatchObject({ value: 1 });
    // Releasing twice is refused.
    await expect(p.owner.plans.release({ id: plan.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }, SLOW);

  test("window: at most 24 h and ending after it starts (create and release)", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    const t = Date.now();
    const dies = [{ sectionId: s, lines: [{ salesOrderLineId: o.lineIds[0]!, pcs: 5 }] }];
    await expect(p.owner.plans.create({ windowStart: t, windowEnd: t + 24 * HOUR + 1, dies })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.owner.plans.create({ windowStart: t, windowEnd: t, dies })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const ok = await p.owner.plans.create({ windowStart: t, windowEnd: t + 24 * HOUR, dies });
    // A window stretched after create (e.g. an edit) is refused at release.
    await env.db.update(pressPlan).set({ windowEnd: new Date(t + 30 * HOUR) }).where(eq(pressPlan.id, ok.id));
    await expect(p.owner.plans.release({ id: ok.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("24 hours") });
    expect(await runsOf(ok.id)).toHaveLength(0);
  }, SLOW);

  test("each line at most its planable kg (own plan left out at release); booking orders can't be planned", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]); // 120 kg
    const t = Date.now();
    await expect(
      p.owner.plans.create({ windowStart: t, windowEnd: t + HOUR, dies: [{ sectionId: s, lines: [{ salesOrderLineId: o.lineIds[0]!, kgG: kg(121) }] }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("left to plan") });
    const a = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + HOUR,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: o.lineIds[0]!, kgG: kg(80) }] }],
    });
    // A second draft for the rest: only 40 kg is left while the first plan stands.
    await expect(
      p.owner.plans.create({ windowStart: t, windowEnd: t + HOUR, dies: [{ sectionId: s, lines: [{ salesOrderLineId: o.lineIds[0]!, kgG: kg(41) }] }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const b = await p.owner.plans.create({ windowStart: t, windowEnd: t + HOUR, dies: [{ sectionId: s, lines: [{ salesOrderLineId: o.lineIds[0]!, kgG: kg(40) }] }] });
    // Release counts the other plan but not its own quantity.
    await p.owner.plans.release({ id: a.id });
    // Raise nothing: b still fits (40 + 80 = 120). Packing 10 kg meanwhile makes b too big.
    await p.pack(s, [{ kg: 10 }], o.lineIds[0]);
    await expect(p.owner.plans.release({ id: b.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const booking = await p.owner.orders.create({
      customerId: p.customerId,
      lines: [{ sectionId: s, cutLengthMm: FT12, kgG: kg(50) }],
    });
    const line = (await p.owner.orders.get({ id: booking.id })).lines[0]!.lineId;
    await expect(
      p.owner.plans.create({ windowStart: t, windowEnd: t + HOUR, dies: [{ sectionId: s, lines: [{ salesOrderLineId: line, kgG: kg(10) }] }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("confirm it") });
  }, SLOW);

  test("owner check on the preferred copy: another customer's pinned owned copy and an owned section with no pin are refused", async () => {
    const p = await opPlant();
    const s = await p.section();
    const owned = await p.copy(s, { milli: 12_000, ownerCustomerId: p.otherCustomer });
    // Confirm passes for the owner's own order; the plan for the owner releases.
    const theirs = await p.confirmedOrder([{ sectionId: s, pcs: 10, dieInstanceId: owned }], { customerId: p.otherCustomer });
    const t = Date.now();
    const okPlan = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + HOUR,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: theirs.lineIds[0]!, pcs: 5 }] }],
    });
    await expect(p.owner.plans.release({ id: okPlan.id })).resolves.toMatchObject({ status: "released" });

    // Section owned, our customer's order with a tier only (no pin): release says pick the copy.
    const s2 = await p.section();
    await p.copy(s2, { milli: 12_000 });
    const mine = await p.confirmedOrder([{ sectionId: s2, pcs: 10, tierRank: 1 }]);
    await setSectionOwner(env, s2, p.otherCustomer);
    const noPin = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + HOUR,
      dies: [{ sectionId: s2, lines: [{ salesOrderLineId: mine.lineIds[0]!, pcs: 5 }] }],
    });
    await expect(p.owner.plans.release({ id: noPin.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Pick the die copy" });

    // Our order pinned to the other customer's copy (the owner was set after confirm): FORBIDDEN naming the owner.
    const s3 = await p.section();
    const copy3 = await p.copy(s3, { milli: 12_000 });
    const pinned = await p.confirmedOrder([{ sectionId: s3, pcs: 10, dieInstanceId: copy3 }]);
    await setSectionOwner(env, s3, p.otherCustomer);
    const plan3 = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + HOUR,
      dies: [{ sectionId: s3, lines: [{ salesOrderLineId: pinned.lineIds[0]!, pcs: 5 }] }],
    });
    await expect(p.owner.plans.release({ id: plan3.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: expect.stringContaining("This die belongs to"),
    });
    expect(await runsOf(plan3.id)).toHaveLength(0);
  }, SLOW);

  test("FP-OP-15: other customers' open lines on the same die come back as warnings, not refusals", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const ours = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    const theirs = await p.confirmedOrder([{ sectionId: s, pcs: 20 }], { customerId: p.otherCustomer });
    const t = Date.now();
    const plan = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + HOUR,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: ours.lineIds[0]!, pcs: 10 }] }],
    });
    const rel = await p.owner.plans.release({ id: plan.id });
    expect(rel.warnings).toEqual([
      expect.objectContaining({ kind: "other_party_open_line", lineId: theirs.lineIds[0], customerId: p.otherCustomer, planableG: kg(240) }),
    ]);
  }, SLOW);

  test("press line: the only active line by default; two active lines need a pick", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    await env.db.insert(pressLine).values({ id: crypto.randomUUID(), companyId: p.companyId, code: "P2", name: "Press 2" });
    const t = Date.now();
    const dies = [{ sectionId: s, lines: [{ salesOrderLineId: o.lineIds[0]!, pcs: 5 }] }];
    const plan = await p.owner.plans.create({ windowStart: t, windowEnd: t + HOUR, dies });
    await expect(p.owner.plans.release({ id: plan.id })).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("press line") });
    await p.owner.plans.cancel({ id: plan.id });
    const picked = await p.owner.plans.create({ windowStart: t, windowEnd: t + HOUR, pressLineId: p.pressLineId, dies });
    await expect(p.owner.plans.release({ id: picked.id })).resolves.toMatchObject({ status: "released" });
  }, SLOW);

  test("cancel: draft any time; released only while every run is queued (runs voided); close once runs are done", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 100 }]);
    const t = Date.now();
    const mk = () =>
      p.owner.plans.create({ windowStart: t, windowEnd: t + HOUR, dies: [{ sectionId: s, lines: [{ salesOrderLineId: o.lineIds[0]!, pcs: 10 }] }] });

    const draft = await mk();
    await expect(p.owner.plans.close({ id: draft.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.owner.plans.cancel({ id: draft.id });
    expect((await p.owner.plans.get({ id: draft.id })).plan.status).toBe("cancelled");
    await expect(p.owner.plans.release({ id: draft.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const queued = await mk();
    await p.owner.plans.release({ id: queued.id });
    await p.owner.plans.cancel({ id: queued.id, reason: "Billets short" });
    expect((await runsOf(queued.id)).map((r) => r.status)).toEqual(["voided"]);

    const started = await mk();
    await p.owner.plans.release({ id: started.id });
    await env.db.update(pressRun).set({ status: "running" }).where(eq(pressRun.planId, started.id));
    await expect(p.owner.plans.cancel({ id: started.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.owner.plans.close({ id: started.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await env.db.update(pressRun).set({ status: "logged", goodG: kg(100) }).where(eq(pressRun.planId, started.id));
    await p.owner.plans.close({ id: started.id });
    expect((await p.owner.plans.get({ id: started.id })).plan.status).toBe("closed");

    await expect(p.as("supervisor").plans.create({ windowStart: t, windowEnd: t + HOUR, dies: [] })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const list = await p.as("press").plans.list({});
    expect(list.items.map((i) => i.status).sort()).toEqual(["cancelled", "cancelled", "closed"]);
  }, SLOW);

  test("write time: a run issued between read and write fails the cancel whole", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 100 }]);
    const t = Date.now();
    const plan = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + HOUR,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: o.lineIds[0]!, pcs: 10 }] }],
    });
    await p.owner.plans.release({ id: plan.id });
    env.beforeNextBatch(() => env.db.update(pressRun).set({ status: "die_issued" }).where(eq(pressRun.planId, plan.id)));
    await expect(p.owner.plans.cancel({ id: plan.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await p.owner.plans.get({ id: plan.id })).plan.status).toBe("released");
    expect((await runsOf(plan.id)).map((r) => r.status)).toEqual(["die_issued"]);
  }, SLOW);
});

describe("FP-OP-05: planned and pressed on the strip", () => {
  test("draft and released plans count as planned; a logged run moves it to pressed; packing takes it from pressed", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 100 }]); // 1,200 kg
    const strip = async () => (await p.owner.orders.balance({ orderId: o.id })).lines[0]!.strip;
    const t = Date.now();
    const plan = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + HOUR,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: o.lineIds[0]!, kgG: kg(500) }] }],
    });
    expect(await strip()).toMatchObject({ plannedG: kg(500), pressedG: 0, planableG: kg(700) });
    await p.owner.plans.release({ id: plan.id });
    expect(await strip()).toMatchObject({ plannedG: kg(500), planableG: kg(700) });
    await env.db.update(pressRun).set({ status: "logged", goodG: kg(480) }).where(eq(pressRun.planId, plan.id));
    expect(await strip()).toMatchObject({ plannedG: 0, pressedG: kg(480), planableG: kg(720) });
    await p.pack(s, [{ kg: 300 }], o.lineIds[0]);
    expect(await strip()).toMatchObject({ pressedG: kg(180), packedG: kg(300), producedG: kg(300), planableG: kg(720) });
    expect((await p.owner.plans.candidates({ sectionIds: [s] })).dies[0]).toMatchObject({ sectionId: s, planableG: kg(720) });
  }, SLOW);

  test("a voided run and a cancelled plan drop out of planned", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, pcs: 100 }]);
    const t = Date.now();
    const plan = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + HOUR,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: o.lineIds[0]!, kgG: kg(500) }] }],
    });
    await p.owner.plans.release({ id: plan.id });
    await env.db.update(pressRun).set({ status: "voided" }).where(eq(pressRun.planId, plan.id));
    expect((await p.owner.orders.balance({ orderId: o.id })).lines[0]!.strip).toMatchObject({ plannedG: 0, planableG: kg(1_200) });
    const draft = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + HOUR,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: o.lineIds[0]!, kgG: kg(200) }] }],
    });
    await p.owner.plans.cancel({ id: draft.id });
    expect((await p.owner.orders.balance({ orderId: o.id })).lines[0]!.strip).toMatchObject({ plannedG: 0 });
  }, SLOW);
});

describe("FP-OP-18 late orders and the suggested line", () => {
  test("late = confirmed / dispatching, baki left, ordered more than 15 days ago", async () => {
    setClock(NOON); // 2026-10-20 IST
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const old = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    await saveOrder(p.owner, { id: old.id, orderDate: "2026-10-04" }); // 16 days
    const edge = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    await saveOrder(p.owner, { id: edge.id, orderDate: "2026-10-05" }); // 15 days: not yet late
    const booking = await p.owner.orders.create({ customerId: p.customerId, orderDate: "2026-09-01", lines: [{ sectionId: s, cutLengthMm: FT12, kgG: kg(5) }] });
    const done = await p.confirmedOrder([{ sectionId: s, pcs: 1 }]);
    await saveOrder(p.owner, { id: done.id, orderDate: "2026-09-01" });
    const serials = await p.pack(s, [{ kg: 12 }], done.lineIds[0]);
    await p.owner.dispatch.complete({ id: await p.held(serials) });
    const late = await p.owner.orders.late({});
    expect(late.today).toBe("2026-10-20");
    expect(late.lines.map((l) => [l.orderId, l.daysOpen])).toEqual([[old.id, 16]]);
    expect(late.totals).toMatchObject({ lines: 1, bakiG: kg(120) });
    expect(booking.id).toBeTruthy();
  }, SLOW);

  test("suggested line: oldest open same customer + die + cut length, else customer + die; none for another customer", async () => {
    setClock(NOON);
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const older = await p.confirmedOrder([{ sectionId: s, pcs: 10, mm: FT12 }]);
    await saveOrder(p.owner, { id: older.id, orderDate: "2026-10-01" });
    const newer = await p.confirmedOrder([{ sectionId: s, pcs: 10, mm: FT18 }]);
    const exact = await p.owner.orders.suggestLine({ customerId: p.customerId, sectionId: s, cutLengthMm: FT18 });
    expect(exact).toMatchObject({ lineId: newer.lineIds[0], match: "die_and_length" });
    const byDie = await p.owner.orders.suggestLine({ customerId: p.customerId, sectionId: s, cutLengthMm: 6_000 });
    expect(byDie).toMatchObject({ lineId: older.lineIds[0], match: "die" });
    expect(await p.owner.orders.suggestLine({ customerId: p.otherCustomer, sectionId: s })).toBeNull();
  }, SLOW);
});
