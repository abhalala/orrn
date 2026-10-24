/**
 * W1-OP-W review round 1 (server side): `plans.list` dies / kg per plan (I-3), the other open
 * lines on a plan's dies (`plans.openLinesForDies`, BACKLOG rank 30 / FP-OP-15) and editing a
 * draft plan (`plans.update`, add / remove lines; refused once released).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, customer, pressPlanDie } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { FT12, FT18, opHelpers, setSectionOwner } from "./orders-w1-fixture";
import { kg, SLOW } from "./sales-fixture";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { opPlant } = opHelpers(() => env);
const HOUR = 3_600_000;

async function nameOf(customerId: string) {
  const [row] = await env.db.select({ name: customer.name }).from(customer).where(eq(customer.id, customerId));
  return row!.name;
}

describe("I-3: plans.list counts each plan's own dies and kg", () => {
  test("two plans: each row carries its own die count and kg (not 0 dies, 0.000 kg)", async () => {
    const p = await opPlant();
    const s1 = await p.section();
    const s2 = await p.section();
    await p.copy(s1, { milli: 12_000 });
    await p.copy(s2, { milli: 12_000 });
    const o = await p.confirmedOrder([
      { sectionId: s1, pcs: 100 },
      { sectionId: s2, pcs: 100 },
    ]);
    const t = Date.now();
    const a = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + HOUR,
      dies: [
        { sectionId: s1, lines: [{ salesOrderLineId: o.lineIds[0]!, pcs: 10 }] },
        { sectionId: s2, lines: [{ salesOrderLineId: o.lineIds[1]!, pcs: 20 }] },
      ],
    });
    const b = await p.owner.plans.create({
      windowStart: t + 2 * HOUR,
      windowEnd: t + 3 * HOUR,
      dies: [{ sectionId: s1, lines: [{ salesOrderLineId: o.lineIds[0]!, kgG: kg(60) }] }],
    });
    await p.owner.plans.release({ id: b.id });
    const list = await p.as("press").plans.list({});
    const byId = new Map(list.items.map((i) => [i.id, i]));
    // 10 pcs x 12 ft @ 12.000 = 120 kg; 20 pcs = 240 kg.
    expect(byId.get(a.id)).toMatchObject({ dies: 2, kgG: kg(360) });
    expect(byId.get(b.id)).toMatchObject({ dies: 1, kgG: kg(60), status: "released" });
  }, SLOW);
});

describe("rank 30 / FP-OP-15: plans.openLinesForDies", () => {
  test("every open line on those dies with party, SO number, PO, length, planable kg and pcs; a plan's own lines left out", async () => {
    const p = await opPlant();
    const s = await p.section();
    const other = await p.section();
    await p.copy(s, { milli: 12_000 });
    await p.copy(other, { milli: 12_000 });
    const ours = await p.confirmedOrder([{ sectionId: s, pcs: 10 }], { poNumber: "PO-OURS" });
    const theirs = await p.confirmedOrder(
      [
        { sectionId: s, pcs: 20 },
        { sectionId: s, pcs: 30, mm: FT18 },
      ],
      { customerId: p.otherCustomer, poNumber: "PO-THEIRS" },
    );
    await p.confirmedOrder([{ sectionId: other, pcs: 5 }]); // another die: never listed
    const t = Date.now();
    const plan = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + HOUR,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: ours.lineIds[0]!, pcs: 10 }] }],
    });

    const res = await p.as("viewer").plans.openLinesForDies({ dieIds: [s], planId: plan.id });
    expect(res.more).toBe(false);
    const theirName = await nameOf(p.otherCustomer);
    expect(res.lines).toEqual([
      expect.objectContaining({
        lineId: theirs.lineIds[0],
        lineNo: 1,
        orderId: theirs.id,
        orderNumber: theirs.number,
        orderPeriod: expect.any(String),
        poNumber: "PO-THEIRS",
        customerId: p.otherCustomer,
        customerName: theirName,
        sectionId: s,
        cutLengthMm: FT12,
        planableG: kg(240),
        planablePcs: 20,
        ownerName: null,
        ownerBlocked: false,
      }),
      expect.objectContaining({ lineId: theirs.lineIds[1], cutLengthMm: FT18, planablePcs: 30 }),
    ]);
    // Without a plan, the line on the plan is listed too (with what is left to plan: nothing here, so it is left out).
    const all = await p.owner.plans.openLinesForDies({ dieIds: [s] });
    expect(all.lines.map((l) => l.lineId).sort()).toEqual([...theirs.lineIds].sort());
    // excludeLineIds drops lines the client already has in its draft.
    const fewer = await p.owner.plans.openLinesForDies({ dieIds: [s], excludeLineIds: [theirs.lineIds[0]!] });
    expect(fewer.lines.map((l) => l.lineId)).toEqual([theirs.lineIds[1]!]);
  }, SLOW);

  test("owned die: another party's line is flagged with the owner's name; the owner's own line is not", async () => {
    const p = await opPlant();
    const s = await p.section();
    const copy = await p.copy(s, { milli: 12_000 });
    const mine = await p.confirmedOrder([{ sectionId: s, pcs: 10, dieInstanceId: copy }]);
    const theirs = await p.confirmedOrder([{ sectionId: s, pcs: 10, dieInstanceId: copy }], { customerId: p.otherCustomer });
    await setSectionOwner(env, s, p.otherCustomer);
    const res = await p.owner.plans.openLinesForDies({ dieIds: [s] });
    const by = new Map(res.lines.map((l) => [l.lineId, l]));
    const ownerName = await nameOf(p.otherCustomer);
    expect(by.get(mine.lineIds[0]!)).toMatchObject({ ownerBlocked: true, ownerName, ownerCustomerId: p.otherCustomer });
    expect(by.get(theirs.lineIds[0]!)).toMatchObject({ ownerBlocked: false, ownerName, ownerCustomerId: p.otherCustomer });
  }, SLOW);
});

describe("plans.pressLines", () => {
  test("active press lines of the plant, for the plan's press pick", async () => {
    const p = await opPlant();
    const lines = await p.as("viewer").plans.pressLines();
    expect(lines).toEqual([{ id: p.pressLineId, code: "P1", name: "Press 1" }]);
  }, SLOW);
});

describe("plans.update: add / remove lines on a draft plan", () => {
  test("adds a line under its die (a new die when the plan has none), removes a line, drops an emptied die; audited", async () => {
    const p = await opPlant();
    const s1 = await p.section();
    const s2 = await p.section();
    await p.copy(s1, { milli: 12_000 });
    await p.copy(s2, { milli: 12_000 });
    const a = await p.confirmedOrder([{ sectionId: s1, pcs: 10 }]);
    const b = await p.confirmedOrder([{ sectionId: s1, pcs: 20 }], { customerId: p.otherCustomer });
    const c = await p.confirmedOrder([{ sectionId: s2, pcs: 5 }]);
    const t = Date.now();
    const plan = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + HOUR,
      dies: [{ sectionId: s1, lines: [{ salesOrderLineId: a.lineIds[0]! }] }],
    });
    const before = await p.owner.plans.get({ id: plan.id });

    const res = await p.as("office").plans.update({
      id: plan.id,
      serverSeq: before.plan.serverSeq,
      add: [{ salesOrderLineId: b.lineIds[0]! }, { salesOrderLineId: c.lineIds[0]!, pcs: 2 }],
    });
    expect(res).toMatchObject({ id: plan.id, status: "draft", added: 2, removed: 0 });
    const got = await p.owner.plans.get({ id: plan.id });
    expect(got.dies.map((d) => d.sectionId)).toEqual([s1, s2]);
    // b: everything planable (20 pcs = 240 kg); c: 2 pcs = 24 kg.
    expect(got.lines.map((l) => [l.salesOrderLineId, l.pcs, l.kgG])).toEqual(
      expect.arrayContaining([
        [a.lineIds[0], 10, kg(120)],
        [b.lineIds[0], 20, kg(240)],
        [c.lineIds[0], 2, kg(24)],
      ]),
    );
    const listed = await p.owner.plans.list({});
    expect(listed.items.find((i) => i.id === plan.id)).toMatchObject({ dies: 2, kgG: kg(384) });

    // Remove c: its die goes with it.
    await p.owner.plans.update({ id: plan.id, remove: [c.lineIds[0]!] });
    const after = await p.owner.plans.get({ id: plan.id });
    expect(after.dies.map((d) => d.sectionId)).toEqual([s1]);
    expect(after.lines.map((l) => l.salesOrderLineId).sort()).toEqual([a.lineIds[0]!, b.lineIds[0]!].sort());
    const dieRows = await env.db.select().from(pressPlanDie).where(eq(pressPlanDie.pressPlanId, plan.id));
    expect(dieRows).toHaveLength(1);

    const audits = await env.db
      .select({ a: auditLog.action, meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.subjectId, plan.id), eq(auditLog.action, "plan.update")));
    expect(audits).toHaveLength(2);
    expect(audits.map((r) => r.meta)).toEqual(
      expect.arrayContaining([expect.objectContaining({ added: [b.lineIds[0], c.lineIds[0]].sort(), removed: [] })]),
    );
  }, SLOW);

  test("refusals: released plan, over planable, a line already on it, a line not on it, removing every line, a stale serverSeq", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const a = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]); // 120 kg
    const b = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    const t = Date.now();
    const plan = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + HOUR,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: a.lineIds[0]!, pcs: 5 }] }],
    });
    await expect(p.owner.plans.update({ id: plan.id, add: [{ salesOrderLineId: b.lineIds[0]!, kgG: kg(121) }] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("left to plan"),
    });
    await expect(p.owner.plans.update({ id: plan.id, add: [{ salesOrderLineId: a.lineIds[0]! }] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("already on this plan"),
    });
    await expect(p.owner.plans.update({ id: plan.id, remove: [b.lineIds[0]!] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("not on this plan"),
    });
    await expect(p.owner.plans.update({ id: plan.id, remove: [a.lineIds[0]!] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("cancel the plan"),
    });
    await expect(p.owner.plans.update({ id: plan.id, serverSeq: -1, add: [{ salesOrderLineId: b.lineIds[0]! }] })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(p.as("supervisor").plans.update({ id: plan.id, add: [{ salesOrderLineId: b.lineIds[0]! }] })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await p.owner.plans.release({ id: plan.id });
    await expect(p.owner.plans.update({ id: plan.id, add: [{ salesOrderLineId: b.lineIds[0]! }] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Only a draft plan"),
    });
  }, SLOW);

  test("owner gate: adding another party's line on an owned die is refused with the owner's name", async () => {
    const p = await opPlant();
    const s = await p.section();
    const copy = await p.copy(s, { milli: 12_000 });
    const theirs = await p.confirmedOrder([{ sectionId: s, pcs: 10, dieInstanceId: copy }], { customerId: p.otherCustomer });
    const mine = await p.confirmedOrder([{ sectionId: s, pcs: 10, dieInstanceId: copy }]);
    await setSectionOwner(env, s, p.otherCustomer);
    const t = Date.now();
    const plan = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + HOUR,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: theirs.lineIds[0]! }] }],
    });
    const ownerName = await nameOf(p.otherCustomer);
    await expect(p.owner.plans.update({ id: plan.id, add: [{ salesOrderLineId: mine.lineIds[0]! }] })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: `This die belongs to ${ownerName}`,
    });
    expect((await p.owner.plans.get({ id: plan.id })).lines).toHaveLength(1);
  }, SLOW);

  test("write time: a line planned elsewhere between read and write fails the update whole", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const a = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    const b = await p.confirmedOrder([{ sectionId: s, pcs: 10 }]);
    const t = Date.now();
    const plan = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + HOUR,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: a.lineIds[0]! }] }],
    });
    env.beforeNextBatch(() =>
      p.owner.plans.create({ windowStart: t, windowEnd: t + HOUR, dies: [{ sectionId: s, lines: [{ salesOrderLineId: b.lineIds[0]! }] }] }),
    );
    await expect(p.owner.plans.update({ id: plan.id, add: [{ salesOrderLineId: b.lineIds[0]! }] })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await p.owner.plans.get({ id: plan.id })).lines).toHaveLength(1);
  }, SLOW);
});
