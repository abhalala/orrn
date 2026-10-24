/**
 * W1-PK-W server support: what the pack, stock and dispatch screens read. Stock filters (customer,
 * order, plant stock, hollow / solid / semi, packed date), the Yards view, `previewLines`, the label
 * sheet, `/b` detail extras, `packingList.list` per customer and the `reallocation_pending` scan outcome.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { bundle, cast, die, dieInstance, melt } from "@orrn/db/schema";
import { and, eq, inArray } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { kg, NOON, salesHelpers, SLOW } from "./sales-fixture";

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

const { plant } = salesHelpers(() => env);

async function idsOf(companyId: string, serials: string[]) {
  const rows = await env.db
    .select({ id: bundle.id, serial: bundle.serial })
    .from(bundle)
    .where(and(eq(bundle.companyId, companyId), inArray(bundle.serial, serials)));
  return serials.map((s) => rows.find((r) => r.serial === s)!.id);
}

describe("stock filters: the Lengths, Yards and Bundles tabs agree", () => {
  test("customer, sales order, plant stock, profile kind and packed date narrow every view, with server totals by kind", async () => {
    setClock(NOON);
    const p = await plant();
    const mineO = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const theirO = await p.order([{ dieId: p.dieA, kg: 1000 }], { customerId: p.otherCustomer });
    const mine = await p.pack(p.dieA, [{ kg: 100 }, { kg: 110 }], mineO.lineIds[0]);
    const theirs = await p.pack(p.dieA, [{ kg: 120 }], theirO.lineIds[0]);
    const plantS = await p.pack(p.dieB, [{ kg: 50 }, { kg: 60 }]);
    await p.owner.orders.reallocate({ bundleIds: await idsOf(p.companyId, plantS), toLineId: null, reason: "Plant stock" });
    await env.db.update(die).set({ profileKind: "hollow" }).where(eq(die.id, p.dieA));
    await env.db.update(die).set({ profileKind: "solid" }).where(eq(die.id, p.dieB));

    const serialsOf = async (input: Parameters<typeof p.owner.bundle.listBundles>[0]) =>
      (await p.owner.bundle.listBundles({ limit: 100, ...input })).items.map((b) => b.serial).sort();

    expect(await serialsOf({})).toEqual([...mine, ...theirs, ...plantS].sort());
    expect(await serialsOf({ customerId: p.customerId })).toEqual([...mine].sort());
    expect(await serialsOf({ customerId: p.otherCustomer })).toEqual([...theirs].sort());
    expect(await serialsOf({ customerId: p.customerId, salesOrderId: mineO.id })).toEqual([...mine].sort());
    expect(await serialsOf({ salesOrderId: theirO.id })).toEqual([...theirs].sort());
    expect(await serialsOf({ plantStock: true })).toEqual([...plantS].sort());
    expect(await serialsOf({ profileKind: "solid" })).toEqual([...plantS].sort());
    expect(await serialsOf({ profileKind: "semi" })).toEqual([]);

    // Totals and hollow / solid / semi come from the server over the whole filter.
    const all = await p.owner.bundle.listBundles({ limit: 1 });
    expect(Number(all.total)).toBe(5);
    expect(all.kindTotals.hollow).toEqual({ bundles: 3, pcs: 30, weightG: kg(330) });
    expect(all.kindTotals.solid).toEqual({ bundles: 2, pcs: 20, weightG: kg(110) });
    expect(all.kindTotals.semi.bundles).toBe(0);

    const lengths = await p.owner.stock.byDieLength({ customerId: p.customerId });
    expect(lengths.items.map((i) => [i.dieId, i.bundles, i.weightG])).toEqual([[p.dieA, 2, kg(210)]]);
    expect(lengths.totals).toEqual({ bundles: 2, pcs: 20, weightG: kg(210) });
    expect(lengths.kindTotals.hollow.bundles).toBe(2);
    const plantOnly = await p.owner.stock.byDieLength({ plantStock: true });
    expect(plantOnly.totals.bundles).toBe(2);

    // Packed date: both ends inclusive on the company calendar (NOON is 3 Oct 2026 IST).
    expect((await p.owner.bundle.listBundles({ packedFrom: "2026-10-03", packedTo: "2026-10-03", limit: 1 })).total).toBe(5);
    expect((await p.owner.bundle.listBundles({ packedFrom: "2026-10-04", limit: 1 })).total).toBe(0);
    expect((await p.owner.bundle.listBundles({ packedTo: "2026-10-02", limit: 1 })).total).toBe(0);
  }, SLOW);

  test("stock.byYard: a card per yard with its figures, the top sections, bundles with no yard, and the same filters", async () => {
    setClock(NOON);
    const p = await plant();
    const yards = (await p.owner.stock.locations.list()).items.filter((l) => l.kind === "yard");
    const y2 = yards.find((y) => y.code === "Y2")!.id;
    const mineO = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const a = await p.pack(p.dieA, [{ kg: 100 }, { kg: 100 }], mineO.lineIds[0]);
    const b = await p.pack(p.dieB, [{ kg: 70 }]);
    await p.owner.stock.move({ bundleIds: await idsOf(p.companyId, [b[0]!]), toLocationId: y2 });
    // Legacy stock with no yard recorded.
    const [legacy] = await p.pack(p.dieB, [{ kg: 30 }]);
    await env.db.update(bundle).set({ locationId: null }).where(and(eq(bundle.companyId, p.companyId), eq(bundle.serial, legacy!)));
    // A void bundle and a dispatched one are not stock.
    const [gone] = await p.pack(p.dieA, [{ kg: 999 }]);
    await p.owner.bundle.transitionStatus({ id: (await idsOf(p.companyId, [gone!]))[0]!, toStatus: "void", reason: "damaged" });

    const view = await p.owner.stock.byYard();
    const y1row = view.yards.find((y) => y.code === "Y1")!;
    expect(y1row).toMatchObject({ bundles: 2, weightG: kg(200), pcs: 20, sections: 1, reserved: 0 });
    expect(y1row.top.map((s) => [s.dieId, s.bundles])).toEqual([[p.dieA, 2]]);
    expect(view.yards.find((y) => y.code === "Y2")).toMatchObject({ bundles: 1, weightG: kg(70) });
    // Every yard is listed, empty ones too.
    expect(view.yards.map((y) => y.code)).toEqual(expect.arrayContaining(["Y1", "Y2", "Y3", "Y4", "Y5", "Y6"]));
    expect(view.yards.find((y) => y.code === "Y3")).toMatchObject({ bundles: 0, weightG: 0 });
    expect(view.unplaced).toMatchObject({ locationId: null, bundles: 1, weightG: kg(30) });
    expect(view.totals).toEqual({ bundles: 4, pcs: 40, weightG: kg(300) });

    const mineOnly = await p.owner.stock.byYard({ customerId: p.customerId });
    expect(mineOnly.totals.bundles).toBe(2);
    expect(mineOnly.unplaced).toBeNull();
    // The yard filter is for the other tabs: a yard view of one yard would hide the rest.
    expect((await p.owner.stock.byYard({ locationId: y2 })).totals.bundles).toBe(4);
  }, SLOW);
});

describe("previewLines and the label sheet", () => {
  test("previewLines answers each line exactly as previewLine does, in order", async () => {
    setClock(NOON);
    const p = await plant();
    await env.db.update(die).set({ weightMinG: 2_000, weightMaxG: 2_200 }).where(eq(die.id, p.dieA));
    const lines = [
      { lengthMm: 3_658, weightG: 22_802, pcs: 10 },
      { lengthMm: 3_658, weightG: 20_500, pcs: 10 },
      { lengthMm: 3_658, weightG: 18_000, pcs: 10 },
    ];
    const many = await p.owner.bundle.previewLines({ dieId: p.dieA, lines });
    expect(many.lines).toHaveLength(3);
    for (const [i, l] of lines.entries()) {
      const one = await p.owner.bundle.previewLine({ dieId: p.dieA, lengthMm: l.lengthMm, weightG: l.weightG, pcs: l.pcs });
      expect(many.lines[i]).toEqual(one);
    }
    expect(many.lines.map((l) => l.position)).toEqual(["above", "in", "below"]);
    await expect(p.owner.bundle.previewLines({ dieId: "nope", lines })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.owner.bundle.previewLines({ dieId: p.dieA, lines: [] })).rejects.toThrow();
  }, SLOW);

  test("labelSheet: the printed label's figures for a session, void bundles left out, logo flag snapshotted", async () => {
    setClock(NOON);
    const p = await plant();
    await p.owner.customer.update({ id: p.customerId, name: "Party One", bundleNumberPolicy: "lifelong" });
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const res = await p.owner.bundle.createReceipt({
      dieId: p.dieA,
      unit: "pcs",
      locationId: p.yard,
      salesOrderLineId: o.lineIds[0],
      showLogo: false,
      rows: [
        { quantity: 10, weightG: kg(30), lengthMm: 3_658 },
        { quantity: 10, weightG: kg(31), lengthMm: 3_658 },
        { quantity: 10, weightG: kg(32), lengthMm: 3_658 },
      ],
    });
    const sheet0 = await p.owner.bundle.labelSheet({ groupId: res.groupId });
    expect(sheet0.labels.map((l) => l.bundleId).sort()).toEqual(res.bundles.map((b) => b.id).sort());
    const first = res.bundles[0]!;
    await p.owner.bundle.transitionStatus({ id: res.bundles[2]!.id, toStatus: "void", reason: "damaged" });
    const sheet = await p.owner.bundle.labelSheet({ groupId: res.groupId });
    expect(sheet.labels).toHaveLength(2);
    const label = sheet.labels.find((l) => l.bundleId === first.id)!;
    expect(label).toMatchObject({
      serial: first.serial,
      partyNo: first.partyNo,
      showLogo: false,
      sectionCode: expect.any(String),
      weightG: kg(30),
      pieces: 10,
      lengthMm: 3_658,
      kgPer12ftMilli: first.kgPer12ftMilli,
      salesOrder: `${o.number}/1`,
    });
    expect(label.qr).toContain(`/b/${first.serial}`);
    expect(sheet.company.name).toBe("Fourcubes Aluminium Pvt Ltd");
    // Serial order, and a few bundles by id work too.
    const some = await p.owner.bundle.labelSheet({ bundleIds: [res.bundles[1]!.id, first.id] });
    expect(some.labels.map((l) => l.serial)).toEqual([first.serial, res.bundles[1]!.serial].sort((a, b) => a.localeCompare(b, "en", { numeric: true })));
    await expect(p.owner.bundle.labelSheet({ groupId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.owner.bundle.labelSheet({} as never)).rejects.toThrow();
    // Another company's bundles are never on the sheet.
    const other = await plant();
    expect((await other.owner.bundle.labelSheet({ bundleIds: [first.id] })).labels).toEqual([]);
  }, SLOW);
});

describe("/b detail: location, who did it, copy, cast, order", () => {
  test("getBySerial names the yard, the actor of each event, the die copy, the cast and the order line", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 500 }]);
    const copyId = crypto.randomUUID();
    await env.db.insert(dieInstance).values({ id: copyId, companyId: p.companyId, sectionId: p.dieA, seqNo: 1, code: "A-1" });
    const castId = crypto.randomUUID();
    await env.db.insert(cast).values({ id: castId, companyId: p.companyId, number: "K31", period: "2026-10", year: 2026, month: 10, seq: 31, alloy: "6063", openedAt: NOON });
    await env.db.insert(melt).values({
      id: crypto.randomUUID(), companyId: p.companyId, castId, seq: 1, alloy: "6063", preheatStartAt: NOON, chargingStartAt: NOON, chargingEndAt: NOON,
      castingStartAt: NOON, castingEndAt: NOON, ldoStartTenthIn: 0, ldoEndTenthIn: 0, inputG: kg(1000), logsPcs: 10, logsLengthMm: 6_000,
      logsG: kg(950), outputG: kg(950), lossG: kg(50), lossBp: 500, allowedBurnG: kg(30),
    });
    const res = await p.owner.bundle.createReceipt({
      dieId: p.dieA, unit: "pcs", locationId: p.yard, salesOrderLineId: o.lineIds[0], dieInstanceId: copyId, castId,
      rows: [{ quantity: 10, weightG: kg(30), lengthMm: 3_658 }],
    });
    const serial = res.bundles[0]!.serial;
    const d = await p.owner.bundle.getBySerial({ serial });
    expect(d.location).toMatchObject({ code: "Y1" });
    expect(d.dieCopy).toEqual({ id: copyId, code: "A-1" });
    expect(d.cast).toEqual({ id: castId, number: "K31" });
    expect(d.order).toMatchObject({ orderNumber: o.number, lineNo: 1 });
    expect(d.packedFor).toBeNull();
    expect(d.range12ft).not.toBeNull();
    expect(d.events.map((e) => e.actorName)).toEqual([expect.any(String)]);
    expect(d.events[0]!.actorName).not.toBe("");

    // Moved to plant stock: the order line it was packed for stays on the page.
    await p.owner.orders.reallocate({ bundleIds: [res.bundles[0]!.id], toLineId: null, reason: "Plant stock" });
    const after = await p.owner.bundle.getBySerial({ serial });
    expect(after.order).toBeNull();
    expect(after.packedFor).toMatchObject({ orderNumber: o.number, lineNo: 1 });
  }, SLOW);
});

describe("packing lists per customer, and the reallocation scan outcome", () => {
  test("packingList.list: customerId narrows it, combinable leaves folded lists out, each row has dispatch, bundles and kg", async () => {
    setClock(NOON);
    const p = await plant();
    const a = await p.pack(p.dieA, [{ kg: 100 }, { kg: 110 }]);
    const b = await p.pack(p.dieA, [{ kg: 50 }]);
    const c = await p.pack(p.dieB, [{ kg: 70 }]);
    const d1 = await p.held(a);
    const d2 = await p.held(b);
    const d3 = await p.held(c, p.otherCustomer);
    for (const id of [d1, d2, d3]) await p.owner.dispatch.complete({ id });

    const mine = await p.owner.packingList.list({ customerId: p.customerId });
    expect(mine.total).toBe(2);
    expect(mine.items.map((l) => [l.customerId, l.bundleCount, l.weightG]).sort()).toEqual(
      [
        [p.customerId, 2, kg(210)],
        [p.customerId, 1, kg(50)],
      ].sort(),
    );
    expect(mine.items.every((l) => l.dispatchCode.length > 0 && l.customerName.length > 0)).toBe(true);
    expect((await p.owner.packingList.list({ customerId: p.otherCustomer })).total).toBe(1);
    expect((await p.owner.packingList.list({})).total).toBe(3);

    const combined = await p.as("supervisor").packingList.combine({ ids: mine.items.map((l) => l.id) });
    const afterCombinable = await p.owner.packingList.list({ customerId: p.customerId, combinable: true });
    expect(afterCombinable.items.map((l) => l.id)).toEqual([combined.id]);
    expect(afterCombinable.items[0]).toMatchObject({ bundleCount: 3, weightG: kg(260) });
  }, SLOW);

  test("a bundle waiting on a reallocation approval is refused by the scan with its own outcome", async () => {
    setClock(NOON);
    const p = await plant();
    const a = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const b = await p.order([{ dieId: p.dieA, kg: 1000 }], { customerId: p.otherCustomer });
    const [s] = await p.pack(p.dieA, [{ kg: 40 }], a.lineIds[0]);
    const res = await p.as("office").orders.reallocate({ bundleIds: await idsOf(p.companyId, [s!]), toLineId: b.lineIds[0]!, reason: "Party B is short" });
    expect(res.status).toBe("pending");
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    const scan = await p.as("operator").dispatch.scan({ id, serials: [s!] });
    expect(scan.results.map((r) => r.outcome)).toEqual(["reallocation_pending"]);
    expect(scan.refused.map((r) => r.code)).toEqual(["reallocation_pending"]);
    expect(scan.unavailable).toEqual([expect.objectContaining({ serial: s!, code: "reallocation_pending" })]);
    expect(scan.added).toEqual([]);
    // The single add refuses with the same machine code.
    await expect(
      p.as("operator").dispatch.addBundle({ id, bundleId: (await idsOf(p.companyId, [s!]))[0]! }),
    ).rejects.toMatchObject({ cause: { refusal: { code: "reallocation_pending" } } });
  }, SLOW);
});
