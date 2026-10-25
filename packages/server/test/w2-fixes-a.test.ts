/**
 * W2-FIXES-A (explorer wave 1 Highs; BACKLOG 34, 35, 36, 41):
 * - 34: a reallocation request carries what moves (serials, kg, from -> to, reason) for the
 *   approver, and the order timeline says "n bundles, kg, from -> to" for every move, including
 *   the approval's decision (never "0 bundles, 0.000 kg").
 * - 35: `dashboard.today` sends each role its own tiles, with the count each acts on.
 * - 36: two copies cannot sit on one press line (die issue).
 * - 41: `plans.update` refuses order lines on a die trial / sample plan.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { bundle, customer, dieInstance, dieIssue, pressLine, pressRun } from "@orrn/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";

import { ROLE_TILES, todayTileKeys } from "../src/lib/todayTiles";
import { timelineMoveOf } from "../src/lib/reallocate";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";
import { opHelpers, type OpPlant } from "./orders-w1-fixture";
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
  });
});

describe("BACKLOG 35: Today's tiles follow the role", () => {
  test("the role table: owner/manager everything, office orders/dispatch/approvals, packer pack/stock, die room, press, viewer none", () => {
    expect(todayTileKeys("owner", [])).toEqual(["orders", "dieRoom", "press", "pack", "dispatch", "stock", "approvals", "guides"]);
    expect(todayTileKeys("manager", [])).toEqual(todayTileKeys("owner", []));
    expect(todayTileKeys("office", [])).toEqual(["orders", "dispatch", "approvals"]);
    expect(todayTileKeys("packer", [])).toEqual(["pack", "stock"]);
    expect(todayTileKeys("die_room", [])).toEqual(["dieRoom"]);
    expect(todayTileKeys("press", [])).toEqual(["press"]);
    expect(todayTileKeys("viewer", [])).toEqual([]);
    // A module switched off takes its tiles away.
    expect(todayTileKeys("owner", ["bundles", "dispatches"])).toEqual(["pack", "dispatch", "stock", "approvals", "guides"]);
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
      { key: "approvals", count: 1 },
      { key: "guides", count: null },
    ]);
    // Office cannot approve a move; its tile counts its own requests still waiting.
    expect(await tilesOf("office")).toEqual([
      { key: "orders", count: 2 },
      { key: "dispatch", count: 0 },
      { key: "approvals", count: 1 },
    ]);
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

describe("BACKLOG 36: two copies cannot sit on one press line", () => {
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
    return { companyId, sectionId, lineId, dieRoom, run };
  }

  test("a second copy on the same line is CONFLICT and nothing changes; after the first is taken back it goes", async () => {
    const p = await plant();
    const c1 = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const c2 = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const r1 = await p.run();
    const r2 = await p.run();
    const first = await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c1.id, pressLineId: p.lineId, pressRunId: r1 });
    await expect(p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c2.id, pressLineId: p.lineId, pressRunId: r2 })).rejects.toMatchObject({
      code: "CONFLICT",
      message: `P1 already has ${c1.code} for PR-1. Take it back, or record its die out, before issuing ${c2.code}.`,
    });
    const [copy2] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, c2.id));
    expect(copy2!.status).toBe("available");
    const [run2] = await env.db.select().from(pressRun).where(eq(pressRun.id, r2));
    expect(run2).toMatchObject({ status: "queued", dieInstanceId: null });
    expect(await env.db.select().from(dieIssue).where(eq(dieIssue.dieInstanceId, c2.id))).toEqual([]);

    await p.dieRoom.dieInstance.issues.cancel({ id: first.id });
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c2.id, pressLineId: p.lineId, pressRunId: r2 });
    const open = await env.db.select().from(dieIssue).where(and(eq(dieIssue.pressLineId, p.lineId), eq(dieIssue.status, "issued")));
    expect(open.map((i) => i.dieInstanceId)).toEqual([c2.id]);
  });

  test("C43: once the first run's die is out, the next copy may go to the line (the run's log returns the first)", async () => {
    const p = await plant();
    const c1 = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const c2 = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const r1 = await p.run();
    const r2 = await p.run();
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c1.id, pressLineId: p.lineId, pressRunId: r1 });
    const t = Date.now();
    await env.db.update(pressRun).set({ status: "counting", dieInAt: new Date(t - 3_600_000), dieOutAt: new Date(t) }).where(eq(pressRun.id, r1));
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c2.id, pressLineId: p.lineId, pressRunId: r2 });
    const [run2] = await env.db.select().from(pressRun).where(eq(pressRun.id, r2));
    expect(run2).toMatchObject({ status: "die_issued", dieInstanceId: c2.id });
  });

  test("another line is not affected", async () => {
    const p = await plant();
    const other = crypto.randomUUID();
    await env.db.insert(pressLine).values({ id: other, companyId: p.companyId, code: "P2", name: "Press 2" });
    const c1 = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const c2 = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const r1 = await p.run();
    const r2 = crypto.randomUUID();
    await env.db
      .insert(pressRun)
      .values({ id: r2, companyId: p.companyId, number: "PR-X", period: "2026-27", status: "queued", sectionId: p.sectionId, pressLineId: other });
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c1.id, pressLineId: p.lineId, pressRunId: r1 });
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: c2.id, pressLineId: other, pressRunId: r2 });
  });
});

describe("BACKLOG 41: a trial or sample plan takes no order lines", () => {
  test("plans.update refuses adding an order line to a die_trial plan, with a sentence", async () => {
    const p = await opPlant();
    const s = await p.section();
    await p.copy(s, { milli: 12_000 });
    const o = await p.confirmedOrder([{ sectionId: s, kgG: kg(500) }]);
    const t = Date.now();
    for (const purpose of ["die_trial", "sample"] as const) {
      const plan = await p.owner.plans.create({ windowStart: t, windowEnd: t + 3_600_000, purpose, dies: [{ sectionId: s, lines: [] }] });
      await expect(p.owner.plans.update({ id: plan.id, add: [{ salesOrderLineId: o.lineIds[0]!, kgG: kg(100) }] })).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "A trial or sample plan takes no order lines",
      });
      const got = await p.owner.plans.get({ id: plan.id });
      expect(got.lines ?? []).toEqual([]);
    }
  }, SLOW);
});

