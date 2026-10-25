/**
 * W2-FIXES-A (explorer wave 1 Highs; BACKLOG 34, 35, 36, 41):
 * - 34: a reallocation request carries what moves (serials, kg, from -> to, reason) for the
 *   approver, and the order timeline says "n bundles, kg, from -> to" for every move, including
 *   the approval's decision (never "0 bundles, 0.000 kg").
 * - 35: `dashboard.today` sends each role its own tiles, with the count each acts on.
 * - 36 / D29: a press line holds at most two issued copies (the running run's and one preheating); a third is refused.
 * - 41: `plans.update` refuses order lines on a die trial / sample plan.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { bundle, customer, dieInstance, dieIssue, pressLine, pressRun } from "@orrn/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

import { ROLE_TILES, todayTileKeys } from "../src/lib/todayTiles";
import { timelineMoveOf } from "../src/lib/reallocate";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";
import { opHelpers, type OpPlant } from "./orders-w1-fixture";
import { fillWorkedExample, pressHelpers } from "./press-w2-fixture";
import { kg, SLOW } from "./sales-fixture";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

const { opPlant } = opHelpers(() => env);

async function nameOf(customerId: string) {
  const [row] = await env.db.select({ name: customer.name }).from(customer).where(eq(customer.id, customerId));
  return row!.name;
}

async function idsOf(p: OpPlant, serials: string[]) {
  const rows = await env.db
    .select({ id: bundle.id })
    .from(bundle)
    .where(and(eq(bundle.companyId, p.companyId), inArray(bundle.serial, serials)))
    .orderBy(asc(bundle.serial));
  return rows.map((r) => r.id);
}

type Move = { count: number; kgG: number; from: unknown; to: unknown };
async function moves(p: OpPlant, orderId: string) {
  const t = await p.owner.orders.timeline({ id: orderId });
  return t.events
    .filter((e) => e.action === "order.reallocate")
    .map((e) => ({ status: (e.meta as { status: string }).status, move: e.move as Move, meta: e.meta as { bundles: number; kgG: number } }));
}

describe("BACKLOG 34: a move says what moves, from where to where", () => {
  test("57 kg in 3 bundles to plant stock: the timeline reads 3 bundles, 57.000 kg, KD's line -> plant stock", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, kgG: kg(500) }]);
    const serials = await p.pack(s, [{ kg: 19 }, { kg: 19 }, { kg: 19 }], o.lineIds[0]);
    const res = await p.as("office").orders.reallocate({ bundleIds: await idsOf(p, serials), toLineId: null, reason: "Line closed short" });
    expect(res).toMatchObject({ status: "applied", moved: 3, kgG: kg(57) });
    const [ev] = await moves(p, o.id);
    const party = await nameOf(p.customerId);
    expect(ev).toEqual({
      status: "applied",
      move: { count: 3, kgG: kg(57), from: [{ customerName: party, orderNumber: o.number, lineNo: 1 }], to: null },
      meta: expect.objectContaining({ bundles: 3, kgG: kg(57) }),
    });
  }, SLOW);

  test("another customer: the request carries serials, kg, from, to and reason; the approved decision shows 2 bundles, 220 kg (not 0)", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const a = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]);
    const b = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }], { customerId: p.otherCustomer });
    const serials = await p.pack(s, [{ kg: 100 }, { kg: 120 }], a.lineIds[0]);
    const res = await p.as("office").orders.reallocate({ bundleIds: await idsOf(p, serials), toLineId: b.lineIds[0]!, reason: "Party B is short" });
    expect(res.status).toBe("pending");
    const fromParty = await nameOf(p.customerId);
    const toParty = await nameOf(p.otherCustomer);
    const from = { customerName: fromParty, orderNumber: a.number, lineNo: 1 };
    const to = { customerName: toParty, orderNumber: b.number, lineNo: 1 };

    // What the manager sees in the inbox (approval.list is the inbox's read).
    const inbox = await p.as("manager").approval.list({ kind: "order_reallocate", status: "pending" });
    const req = inbox.items.find((i) => i.id === res.approvalId)!;
    expect(req.requestNote).toBe("Party B is short");
    const asked = (req.meta as { move: { count: number; kgG: number; from: unknown; to: unknown; bundles: { serial: string }[] } }).move;
    expect({ ...asked, bundles: [...asked.bundles].sort((x, y) => x.serial.localeCompare(y.serial)) }).toEqual({
      count: 2,
      kgG: kg(220),
      from: [from],
      to,
      bundles: [
        { serial: serials[0]!, weightG: kg(100), from },
        { serial: serials[1]!, weightG: kg(120), from },
      ].sort((x, y) => x.serial.localeCompare(y.serial)),
    });
    expect(JSON.stringify(req.meta)).not.toMatch(/rate|paise/i);

    await p.as("manager").approval.decide({ id: res.approvalId!, decision: "approved" });
    for (const orderId of [a.id, b.id]) {
      const evs = await moves(p, orderId);
      expect(evs.map((e) => [e.status, e.move])).toEqual([
        ["pending", { count: 2, kgG: kg(220), from: [from], to }],
        ["applied", { count: 2, kgG: kg(220), from: [from], to }],
      ]);
      expect(evs[1]!.meta).toMatchObject({ bundles: 2, kgG: kg(220) });
    }
  }, SLOW);

  test("a rejected move says what was asked; nothing moves", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const a = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]);
    const b = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }], { customerId: p.otherCustomer });
    const serials = await p.pack(s, [{ kg: 57 }], a.lineIds[0]);
    const res = await p.as("office").orders.reallocate({ bundleIds: await idsOf(p, serials), toLineId: b.lineIds[0]!, reason: "Ask" });
    await p.as("manager").approval.decide({ id: res.approvalId!, decision: "rejected", note: "Keep it for A" });
    const evs = await moves(p, a.id);
    expect(evs.map((e) => [e.status, e.move.count, e.move.kgG])).toEqual([
      ["pending", 1, kg(57)],
      ["rejected", 1, kg(57)],
    ]);
  }, SLOW);

  test("older rows: count and kg come from the row's own figures or the batch's transfers", () => {
    expect(timelineMoveOf({ status: "applied", bundles: 2, kgG: 5_000 }, undefined)).toEqual({ count: 2, kgG: 5_000, from: null, to: undefined });
    // An approval's decision written before the summary: only `moved`; the transfers fill kg.
    expect(timelineMoveOf({ status: "applied", moved: 1 }, { count: 1, kgG: 57_046 })).toEqual({ count: 1, kgG: 57_046, from: null, to: undefined });
    expect(timelineMoveOf(null, undefined)).toEqual({ count: 0, kgG: 0, from: null, to: undefined });
    // An old refusal carries only moved 0 and asked n: it says what was asked (kg unknown), never "0 bundles".
    expect(timelineMoveOf({ status: "rejected", moved: 0, asked: 3 }, undefined)).toMatchObject({ count: 3 });
    // An old applied decision where nothing could move still says 0: `asked` is never shown as moved.
    expect(timelineMoveOf({ status: "applied", moved: 0, asked: 3 }, undefined)).toMatchObject({ count: 0 });
  });
});

/** Copies with an open issue on a press line, sorted. */
async function openOn(lineId: string) {
  const rows = await env.db.select().from(dieIssue).where(and(eq(dieIssue.pressLineId, lineId), eq(dieIssue.status, "issued")));
  return rows.map((i) => i.dieInstanceId).sort();
}

describe("BACKLOG 35: Today's tiles follow the role", () => {
  test("the role table: owner/manager everything, office orders/dispatch/stock/approvals, packer pack/stock, die room, press, foundry approvals, storekeeper store, viewer none", () => {
    expect(todayTileKeys("owner", [])).toEqual(["orders", "dieRoom", "press", "pack", "dispatch", "stock", "store", "approvals", "guides"]);
    expect(todayTileKeys("manager", [])).toEqual(todayTileKeys("owner", []));
    expect(todayTileKeys("admin", [])).toEqual(todayTileKeys("owner", []));
    expect(todayTileKeys("office", [])).toEqual(["orders", "dispatch", "stock", "approvals"]);
    expect(todayTileKeys("supervisor", [])).toEqual(["press", "pack", "dispatch", "approvals"]);
    // Foundry approves cast_close; the storekeeper works the store.
    expect(todayTileKeys("foundry", [])).toEqual(["approvals"]);
    expect(todayTileKeys("storekeeper", [])).toEqual(["store"]);
    expect(todayTileKeys("storekeeper", ["bundles"])).toEqual([]);
    expect(todayTileKeys("accountant", [])).toEqual([]);
    expect(todayTileKeys("packer", [])).toEqual(["pack", "stock"]);
    expect(todayTileKeys("die_room", [])).toEqual(["dieRoom"]);
    expect(todayTileKeys("press", [])).toEqual(["press"]);
    expect(todayTileKeys("viewer", [])).toEqual([]);
    // A module switched off takes its tiles away.
    expect(todayTileKeys("owner", ["bundles", "dispatches"])).toEqual(["pack", "dispatch", "stock", "approvals", "guides"]);
    expect(todayTileKeys("owner", ["store"])).toEqual(["store", "approvals", "guides"]);
    expect(Object.keys(ROLE_TILES)).toHaveLength(13);
  });

  test("dashboard.today sends each role its tiles and counts (orders open, runs to issue, queue, approvals waiting)", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const a = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }]);
    const b = await p.confirmedOrder([{ sectionId: s, kgG: kg(1_000) }], { customerId: p.otherCustomer });
    const serials = await p.pack(s, [{ kg: 50 }], a.lineIds[0]);
    await p.as("office").orders.reallocate({ bundleIds: await idsOf(p, serials), toLineId: b.lineIds[0]!, reason: "Ask" });
    const t = Date.now();
    const plan = await p.owner.plans.create({
      windowStart: t,
      windowEnd: t + 3_600_000,
      pressLineId: p.pressLineId,
      dies: [{ sectionId: s, lines: [{ salesOrderLineId: a.lineIds[0]!, kgG: kg(100) }] }],
    });
    await p.owner.plans.release({ id: plan.id });

    const tilesOf = async (role: CompanyRole) => (await p.as(role).dashboard.today()).tiles;
    expect(await tilesOf("owner")).toEqual([
      { key: "orders", count: 2 },
      { key: "dieRoom", count: 1 },
      { key: "press", count: 1 },
      { key: "pack", count: null },
      { key: "dispatch", count: 0 },
      { key: "stock", count: null },
      { key: "store", count: null },
      { key: "approvals", count: 1 },
      { key: "guides", count: null },
    ]);
    // Office cannot approve a move; its tile counts its own requests still waiting.
    expect(await tilesOf("office")).toEqual([
      { key: "orders", count: 2 },
      { key: "dispatch", count: 0 },
      { key: "stock", count: null },
      { key: "approvals", count: 1 },
    ]);
    // Foundry approves cast close-outs only: the move is not theirs, so nothing waits for them.
    expect(await tilesOf("foundry")).toEqual([{ key: "approvals", count: 0 }]);
    expect(await tilesOf("storekeeper")).toEqual([{ key: "store", count: null }]);
    expect(await tilesOf("die_room")).toEqual([{ key: "dieRoom", count: 1 }]);
    expect(await tilesOf("press")).toEqual([{ key: "press", count: 1 }]);
    expect(await tilesOf("packer")).toEqual([
      { key: "pack", count: null },
      { key: "stock", count: null },
    ]);
    expect(await tilesOf("viewer")).toEqual([]);
    // Supervisor approves press time only: the move is not theirs to decide.
    expect((await tilesOf("supervisor")).find((x) => x.key === "approvals")).toEqual({ key: "approvals", count: 0 });
  }, SLOW);
});

describe("BACKLOG 36 / D29: a press line holds the running copy and one more (preheating); a third is refused", () => {
  async function plant() {
    const { companyId } = await env.seedCompany({ settings: { dieRoom: { newCopyOnTrial: false } } });
    const sectionId = await env.seedDie(companyId, { series: "Domal", sectionCode: "12170", weightMinG: 5_900, weightMaxG: 6_200 });
    const lineId = crypto.randomUUID();
    await env.db.insert(pressLine).values({ id: lineId, companyId, code: "P1", name: "Press 1" });
    const dieRoom = env.caller({ role: "die_room", companyId });
    let n = 0;
    async function run() {
      n += 1;
      const id = crypto.randomUUID();
      await env.db
        .insert(pressRun)
        .values({ id, companyId, number: `PR-${n}`, period: "2026-27", status: "queued", sectionId, pressLineId: lineId });
      return id;
    }
    const issue = (dieInstanceId: string, pressRunId: string) => dieRoom.dieInstance.issues.issue({ dieInstanceId, pressLineId: lineId, pressRunId });
    return { companyId, sectionId, lineId, dieRoom, run, issue };
  }

  test("two copies go to one line before either run starts; the third is CONFLICT naming both, and nothing changes", async () => {
    const p = await plant();
    const [c1, c2, c3] = [
      await p.dieRoom.dieInstance.create({ sectionId: p.sectionId }),
      await p.dieRoom.dieInstance.create({ sectionId: p.sectionId }),
      await p.dieRoom.dieInstance.create({ sectionId: p.sectionId }),
    ];
    const [r1, r2, r3] = [await p.run(), await p.run(), await p.run()];
    const first = await p.issue(c1!.id, r1);
    await p.issue(c2!.id, r2);
    expect(await openOn(p.lineId)).toEqual([c1!.id, c2!.id].sort());
    await expect(p.issue(c3!.id, r3)).rejects.toMatchObject({
      code: "CONFLICT",
      message: `P1 already has ${c1!.code} (PR-1) and ${c2!.code} (PR-2). Take one back before issuing ${c3!.code}.`,
    });
    const [copy3] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, c3!.id));
    expect(copy3!.status).toBe("available");
    const [run3] = await env.db.select().from(pressRun).where(eq(pressRun.id, r3));
    expect(run3).toMatchObject({ status: "queued", dieInstanceId: null });
    expect(await env.db.select().from(dieIssue).where(eq(dieIssue.dieInstanceId, c3!.id))).toEqual([]);

    // Taking one back frees the slot.
    await p.dieRoom.dieInstance.issues.cancel({ id: first.id });
    await p.issue(c3!.id, r3);
    expect(await openOn(p.lineId)).toEqual([c2!.id, c3!.id].sort());
  });

  test("with one copy in the press, the refusal also offers its die out", async () => {
    const p = await plant();
    const [c1, c2, c3] = [
      await p.dieRoom.dieInstance.create({ sectionId: p.sectionId }),
      await p.dieRoom.dieInstance.create({ sectionId: p.sectionId }),
      await p.dieRoom.dieInstance.create({ sectionId: p.sectionId }),
    ];
    const [r1, r2, r3] = [await p.run(), await p.run(), await p.run()];
    await p.issue(c1!.id, r1);
    await env.db.update(pressRun).set({ status: "running", dieInAt: new Date() }).where(eq(pressRun.id, r1));
    await p.issue(c2!.id, r2);
    await expect(p.issue(c3!.id, r3)).rejects.toMatchObject({
      code: "CONFLICT",
      message: `P1 already has ${c1!.code} (PR-1) and ${c2!.code} (PR-2). Take one back, or record the die out of ${c1!.code}, before issuing ${c3!.code}.`,
    });
  });

  test("a copy whose run has its die out no longer counts toward the two (its log returns or carries it)", async () => {
    const p = await plant();
    const [c1, c2, c3] = [
      await p.dieRoom.dieInstance.create({ sectionId: p.sectionId }),
      await p.dieRoom.dieInstance.create({ sectionId: p.sectionId }),
      await p.dieRoom.dieInstance.create({ sectionId: p.sectionId }),
    ];
    const [r1, r2, r3] = [await p.run(), await p.run(), await p.run()];
    await p.issue(c1!.id, r1);
    await p.issue(c2!.id, r2);
    const t = Date.now();
    await env.db.update(pressRun).set({ status: "counting", dieInAt: new Date(t - 3_600_000), dieOutAt: new Date(t) }).where(eq(pressRun.id, r1));
    await p.issue(c3!.id, r3);
    const [run3] = await env.db.select().from(pressRun).where(eq(pressRun.id, r3));
    expect(run3).toMatchObject({ status: "die_issued", dieInstanceId: c3!.id });
  });

  test("race: two issues for the last slot; the one that lands second aborts and names the line", async () => {
    const p = await plant();
    const [c1, c2, c3] = [
      await p.dieRoom.dieInstance.create({ sectionId: p.sectionId }),
      await p.dieRoom.dieInstance.create({ sectionId: p.sectionId }),
      await p.dieRoom.dieInstance.create({ sectionId: p.sectionId }),
    ];
    const [r1, r2, r3] = [await p.run(), await p.run(), await p.run()];
    await p.issue(c1!.id, r1);
    // c2's issue lands between c3's read (one copy there) and c3's write.
    env.beforeNextBatch(() => p.issue(c2!.id, r2));
    await expect(p.issue(c3!.id, r3)).rejects.toMatchObject({
      code: "CONFLICT",
      message: `P1 took another copy meanwhile and now has ${c1!.code} (PR-1) and ${c2!.code} (PR-2); nothing was issued`,
    });
    expect(await openOn(p.lineId)).toEqual([c1!.id, c2!.id].sort());
    const [run3] = await env.db.select().from(pressRun).where(eq(pressRun.id, r3));
    expect(run3).toMatchObject({ status: "queued", dieInstanceId: null });
    const [copy3] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, c3!.id));
    expect(copy3!.status).toBe("available");
  });

  test("another line is not affected", async () => {
    const p = await plant();
    const other = crypto.randomUUID();
    await env.db.insert(pressLine).values({ id: other, companyId: p.companyId, code: "P2", name: "Press 2" });
    const [c1, c2, c3] = [
      await p.dieRoom.dieInstance.create({ sectionId: p.sectionId }),
      await p.dieRoom.dieInstance.create({ sectionId: p.sectionId }),
      await p.dieRoom.dieInstance.create({ sectionId: p.sectionId }),
    ];
    await p.issue(c1!.id, await p.run());
    await p.issue(c2!.id, await p.run());
    const r3 = crypto.randomUUID();
    await env.db
      .insert(pressRun)
      .values({ id: r3, companyId: p.companyId, number: "PR-X", period: "2026-27", status: "queued", sectionId: p.sectionId, pressLineId: other });
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c3!.id, pressLineId: other, pressRunId: r3 });
  });
});

describe("D29 with real runs: running copy + preheating copy, and the C43 carry", () => {
  const { pressPlant } = pressHelpers(() => env);

  test("running run's copy + one for a later run go; a third is refused; at close the copy still carries to the next run of its die", async () => {
    const p = await pressPlant();
    const cast = await p.castWith(kg(500));
    const sectionId = await p.section();
    const a = await p.queuedRun({ sectionId });
    const b = await p.queuedRun({ sectionId }); // next run of a's die: C43 carries a's copy here
    const c = await p.queuedRun(); // another die, preheating while a runs
    const d = await p.queuedRun();
    const press = p.as("press").press.runs;
    await p.issue(a.runId, a.copyId);
    await press.start({ id: a.runId });
    await p.issue(c.runId, c.copyId);
    await expect(p.issue(d.runId, d.copyId)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("Take one back, or record the die out of") });

    await press.stop({ id: a.runId });
    await press.count({ id: a.runId });
    await fillWorkedExample(p, a.runId, cast.id);
    expect(await p.as("supervisor").press.runs.close({ id: a.runId })).toMatchObject({ issue: "carried", carriedTo: { id: b.runId } });
    const [runB] = await env.db.select().from(pressRun).where(eq(pressRun.id, b.runId));
    expect(runB).toMatchObject({ status: "die_issued", dieInstanceId: a.copyId });
    // The line holds exactly two: the carried copy (for b) and the preheating one (for c).
    expect(await openOn(p.pressLineId)).toEqual([a.copyId, c.copyId].sort());
    await expect(p.issue(d.runId, d.copyId)).rejects.toMatchObject({ code: "CONFLICT" });
  }, SLOW);
});

describe("BACKLOG 41: a trial or sample plan takes no order lines", () => {
  test("plans.update and plans.create refuse order lines on a die_trial, sample or other plan, with one sentence", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, kgG: kg(500) }]);
    const t = Date.now();
    for (const purpose of ["die_trial", "sample", "other"] as const) {
      const plan = await p.owner.plans.create({ windowStart: t, windowEnd: t + 3_600_000, purpose, dies: [{ sectionId: s, lines: [] }] });
      await expect(p.owner.plans.update({ id: plan.id, add: [{ salesOrderLineId: o.lineIds[0]!, kgG: kg(100) }] })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Only a production plan takes order lines",
      });
      await expect(
        p.owner.plans.create({ windowStart: t, windowEnd: t + 3_600_000, purpose, dies: [{ sectionId: s, lines: [{ salesOrderLineId: o.lineIds[0]!, kgG: kg(100) }] }] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Only a production plan takes order lines" });
      const got = await p.owner.plans.get({ id: plan.id });
      expect(got.lines ?? []).toEqual([]);
    }
  }, SLOW);
});

