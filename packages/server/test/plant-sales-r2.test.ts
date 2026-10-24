/**
 * PL-8 fix round 2: the open findings of the spec and correctness re-reviews at c777685
 * (reviews/PL8-spec-r0.md S-1..S-3, m-1..m-4; reviews/PL8-correctness-r0.md I-1, m-1..m-3).
 * Uses test/sales-fixture.ts (same helpers as the other PL-8 files).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { approval, auditLog, customer, die, dispatchItem, salesOrder, user } from "@orrn/db/schema";
import { and, asc, eq } from "drizzle-orm";

import { createTestEnv, type TestEnv } from "./harness";
import { kg, NOON, salesHelpers, SLOW } from "./sales-fixture";

let env: TestEnv;
let setClock: (at: Date | null) => void;
let buildPlSnapshotV2: typeof import("../src/lib/packingListSnapshot").buildPlSnapshotV2;

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
  buildPlSnapshotV2 = (await import("../src/lib/packingListSnapshot")).buildPlSnapshotV2;
}, 60_000);
afterEach(() => setClock(null));
afterAll(async () => {
  await env.dispose();
});

const { plant, itemsOf, plRow, pendingOverdraw, dispatchRow } = salesHelpers(() => env);

/** @orrn/documents is a client package (it imports this one): load it by path, outside this package's type check. */
const DOCS_PATH = "../../documents/src/packing-list/index";
type Docs = {
  buildPackingListHtml(pl: never, code: string): string;
  buildPackingListXlsxBuffer(pl: never, code: string): Uint8Array;
  plGroupTitle(g: never, all?: never): string;
};
const docs = async () => (await import(DOCS_PATH)) as Docs;
const XLSX_PATH = "../../documents/node_modules/xlsx";
async function sheetRows(buf: Uint8Array): Promise<unknown[][]> {
  const XLSX = (await import(XLSX_PATH)) as {
    read(data: Uint8Array, opts: { type: "array" }): { Sheets: Record<string, unknown> };
    utils: { sheet_to_json<T>(sheet: unknown, opts: { header: 1; defval: null }): T[] };
  };
  const wb = XLSX.read(buf, { type: "array" });
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Packing list"]!, { header: 1, defval: null });
}

const refused = (e: { code?: string }) => `refused:${e.code}`;

describe("S-1 Range /12' on stored thousandths", () => {
  test("Range /12' is exact on stored thousandths (2.090 -> 2.1), for every kg/12ft from 0.5 to 9.0", () => {
    const item = (milli: number, i: number) => ({
      bundleId: `b${i}`, serial: `26I${1000 + i}`, quantity: 10, weightG: 25_000, lengthMm: 3_658, kgPer12ftMilli: milli,
      bundlePo: null, bundleGroupId: "g", groupLabel: null, dieId: "d", series: "12170", sectionCode: "12170", sectionName: "Domal", line: null,
    });
    const milliValues = Array.from({ length: 8_501 }, (_, i) => 500 + i);
    const snap = buildPlSnapshotV2({
      plNumber: "PL/2026-27/1", date: "2026-10-03", generatedAt: new Date(), generatedBy: "u",
      company: { id: "c", name: "FC", settings: null },
      dispatch: { code: "D1", status: "completed", shipDate: null, notes: null, completedAt: new Date(), vehicleNo: null, driverName: null, driverPhone: null, transporter: null, invoiceNumber: null, invoiceDate: null },
      customer: null,
      items: milliValues.map(item),
    });
    const wrong = snap.groups
      .flatMap((g) => g.rows)
      .filter((r) => r.range12ft !== Math.floor((r.kgPer12ftMilli! + 10) / 100) / 10)
      .map((r) => [r.kgPer12ftMilli, r.range12ft]);
    expect(wrong).toEqual([]);
  });

  test("a bundle stored at 2.090 kg/12ft prints band 2.1 on the completed PL", async () => {
    setClock(NOON);
    const p = await plant();
    // 10 pcs, 20.9 kg, 3,658 mm (12 ft): 2.090 kg/12ft.
    const d = await p.held(await p.pack(p.dieA, [{ kg: 20.9, pcs: 10, mm: 3_658 }]));
    await p.owner.dispatch.complete({ id: d });
    const snap = (await plRow(d))!.snapshot as { groups: { rows: { kgPer12ftMilli: number; range12ft: number }[] }[] };
    expect(snap.groups[0]!.rows[0]).toMatchObject({ kgPer12ftMilli: 2090, range12ft: 2.1 });
  }, SLOW);
});

describe("S-2 / correctness I-1: the order link is decided again when its premise changes", () => {
  test("an order entered after the scan: completion past tolerance needs the override, and the line shows the kg after approval", async () => {
    setClock(NOON);
    const p = await plant();
    const serials = await p.pack(p.dieA, [{ kg: 500 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.customerId });
    await p.owner.dispatch.addBundlesBySerial({ id, serials });
    expect((await itemsOf(id)).map((i) => i.lineId)).toEqual([null]);
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]); // entered AFTER the scan
    await p.owner.dispatch.reserve({ id });
    const sup = p.as("supervisor");
    expect(await sup.dispatch.complete({ id }).then(() => "completed", refused)).toBe("refused:PRECONDITION_FAILED");
    expect((await itemsOf(id)).map((i) => i.lineId)).toEqual([o.lineIds[0]!]);
    const [req] = await pendingOverdraw(p.companyId, id);
    expect(req).toBeDefined();
    await p.as("manager").approval.decide({ id: req!.id, decision: "approved" });
    await sup.dispatch.complete({ id });
    expect(await p.lineOf(o.lineIds[0]!)).toMatchObject({ dispatchedG: kg(500), bakiG: 0, overG: kg(400) });
    // The relink is in the history.
    const audit = await env.db
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "dispatch.relink"), eq(auditLog.subjectId, id)));
    expect(audit.length).toBeGreaterThanOrEqual(1);
    expect(audit[0]!.meta).toMatchObject({ reason: "complete", links: [{ serial: serials[0], salesOrderLineId: o.lineIds[0] }] });
  }, SLOW);

  test("probe P1: a supervisor changes the customer to one with a 1,000 kg line, 2,000 kg cannot leave without a manager", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const sup = p.as("supervisor");
    const serials = await p.pack(p.dieA, [{ kg: 1000 }, { kg: 1000 }]);
    const { id } = await sup.dispatch.create({ customerId: p.otherCustomer });
    const scan = await sup.dispatch.addBundlesBySerial({ id, serials });
    expect(scan.linked).toEqual([]);
    await sup.dispatch.update({ id, customerId: p.customerId });
    // Both now meet the order: the first fills the line, the excess goes to the newest open line (R10).
    expect((await itemsOf(id)).map((i) => i.lineId)).toEqual([o.lineIds[0]!, o.lineIds[0]!]);
    await sup.dispatch.reserve({ id });
    expect(await sup.dispatch.complete({ id }).then(() => "completed", refused)).toBe("refused:PRECONDITION_FAILED");
    expect(await pendingOverdraw(p.companyId, id)).toHaveLength(1);
    expect((await p.lineOf(o.lineIds[0]!)).dispatchedG).toBe(0);
  }, SLOW);

  test("probe P1b: bundles packed for X, scanned under the wrong customer and corrected, count as made and sent for X", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 600 }]);
    const serials = await p.pack(p.dieA, [{ kg: 300 }, { kg: 300 }], o.lineIds[0]);
    const packer = p.as("packer");
    const { id } = await packer.dispatch.create({ customerId: p.otherCustomer });
    await packer.dispatch.addBundlesBySerial({ id, serials });
    await packer.dispatch.update({ id, customerId: p.customerId });
    await packer.dispatch.reserve({ id });
    await p.as("supervisor").dispatch.complete({ id });
    expect(await p.lineOf(o.lineIds[0]!)).toMatchObject({ producedG: kg(600), dispatchedG: kg(600), bakiG: 0 });
  }, SLOW);

  test("an office unlink on purpose stays unlinked at completion; linking again clears the mark", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const d = await p.held(await p.pack(p.dieA, [{ kg: 100 }, { kg: 100 }]));
    const [first, second] = await itemsOf(d);
    const office = p.as("office");
    await office.dispatch.linkItem({ itemId: first!.id, salesOrderLineId: null });
    await office.dispatch.linkItem({ itemId: second!.id, salesOrderLineId: null });
    await office.dispatch.linkItem({ itemId: second!.id, salesOrderLineId: o.lineIds[0]! });
    const marks = await env.db
      .select({ id: dispatchItem.id, line: dispatchItem.salesOrderLineId, by: dispatchItem.unlinkedBy })
      .from(dispatchItem)
      .where(eq(dispatchItem.dispatchId, d))
      .orderBy(asc(dispatchItem.id));
    const byId = new Map(marks.map((m) => [m.id, m]));
    expect(byId.get(first!.id)).toMatchObject({ line: null, by: p.users.office.id });
    expect(byId.get(second!.id)).toMatchObject({ line: o.lineIds[0], by: null });
    // The second item was unlinked again by mistake and nobody marked it: completion links it back.
    await env.db.update(dispatchItem).set({ salesOrderLineId: null }).where(eq(dispatchItem.id, second!.id));
    await p.owner.dispatch.complete({ id: d });
    expect((await itemsOf(d)).map((i) => [i.id, i.lineId]).sort()).toEqual(
      [[first!.id, null], [second!.id, o.lineIds[0]!]].sort() as never,
    );
    expect(await p.lineOf(o.lineIds[0]!)).toMatchObject({ dispatchedG: kg(100) });
  }, SLOW);

  test("a customer change drops the old customer's unlink marks and relinks for the new customer", async () => {
    setClock(NOON);
    const p = await plant();
    const own = await p.order([{ dieId: p.dieA, kg: 1000 }], { customerId: p.otherCustomer });
    const o = await p.order([{ dieId: p.dieA, kg: 1000 }]);
    const serials = await p.pack(p.dieA, [{ kg: 100 }]);
    const { id } = await p.owner.dispatch.create({ customerId: p.otherCustomer });
    await p.owner.dispatch.addBundlesBySerial({ id, serials });
    const [item] = await itemsOf(id);
    expect(item!.lineId).toBe(own.lineIds[0]!);
    await p.owner.dispatch.linkItem({ itemId: item!.id, salesOrderLineId: null });
    await p.owner.dispatch.update({ id, customerId: p.customerId });
    const [after] = await env.db
      .select({ line: dispatchItem.salesOrderLineId, by: dispatchItem.unlinkedBy })
      .from(dispatchItem)
      .where(eq(dispatchItem.id, item!.id));
    expect(after).toEqual({ line: o.lineIds[0]!, by: null });
  }, SLOW);

  test("write time: an order saved between the relink read and the completing write fails the completion (CONFLICT), nothing leaves", async () => {
    setClock(NOON);
    const p = await plant();
    const d = await p.held(await p.pack(p.dieA, [{ kg: 500 }]));
    let lineId = "";
    env.beforeNextBatch(async () => {
      lineId = (await p.order([{ dieId: p.dieA, kg: 100 }])).lineIds[0]!;
    });
    expect(await p.owner.dispatch.complete({ id: d }).then(() => "completed", refused)).toBe("refused:CONFLICT");
    expect((await dispatchRow(d)).status).toBe("reserved");
    // The retry links the bundle to the new line and asks for the override.
    expect(await p.owner.dispatch.complete({ id: d }).then(() => "completed", refused)).toBe("refused:PRECONDITION_FAILED");
    expect((await itemsOf(d)).map((i) => i.lineId)).toEqual([lineId]);
  }, SLOW);
});

describe("S-3 dev seed", () => {
  test("the dev seed can be re-run after an order was entered on the demo company", async () => {
    for (const key of ["owner", "operator", "viewer", "office", "staff"]) {
      await env.db.insert(user).values({ id: `dev-user-${key}`, name: key, email: `${key}@orrn.local` }).onConflictDoNothing();
    }
    const seedPath = "../../../apps/server/src/dev-seed";
    const { seedDevData } = (await import(seedPath)) as {
      seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
    };
    const companyId = "dev-company-orrn";
    expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
    const owner = env.caller({ role: "owner", companyId });
    const [c] = await env.db.select({ id: customer.id }).from(customer).where(eq(customer.companyId, companyId)).limit(1);
    const [d] = await env.db.select({ id: die.id }).from(die).where(eq(die.companyId, companyId)).limit(1);
    await owner.orders.create({ customerId: c!.id, lines: [{ sectionId: d!.id, cutLengthMm: 3_658, kgG: 100_000 }] });
    expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
    expect(await env.db.select({ id: salesOrder.id }).from(salesOrder).where(eq(salesOrder.companyId, companyId))).toEqual([]);
  }, 120_000);
});

describe("minor findings", () => {
  test("m-1 listDispatches returns and searches the PL number, vehicle and invoice number", async () => {
    setClock(NOON);
    const p = await plant();
    const d = await p.held(await p.pack(p.dieA, [{ kg: 10 }]));
    await p.owner.dispatch.update({ id: d, vehicleNo: "GJ05AB1234", invoiceNumber: "INV/77" });
    const done = await p.owner.dispatch.complete({ id: d });
    const other = await p.owner.dispatch.create({ customerId: p.customerId });
    const all = await p.owner.dispatch.listDispatches({});
    expect(all.items.find((r) => r.id === d)).toMatchObject({ plNumber: done.plNumber, vehicleNo: "GJ05AB1234", invoiceNumber: "INV/77" });
    for (const search of [done.plNumber, "AB1234", "INV/77"]) {
      const hit = await p.owner.dispatch.listDispatches({ search });
      expect(hit.items.map((r) => r.id)).toEqual([d]);
    }
    expect((await p.owner.dispatch.listDispatches({ search: "INV/77" })).items.map((r) => r.id)).not.toContain(other.id);
  }, SLOW);

  test("m-2 / m-3 the v2 xlsx says '1 bundle' and the v2 print and xlsx carry the dispatch notes and ship date", async () => {
    setClock(NOON);
    const p = await plant();
    const serials = await p.pack(p.dieA, [{ kg: 10 }]);
    const { id } = await p.owner.dispatch.create({
      customerId: p.customerId,
      notes: "Deliver before 5 pm",
      shipDate: new Date("2026-10-05T06:30:00.000Z").getTime(),
    });
    await p.owner.dispatch.addBundlesBySerial({ id, serials });
    await p.owner.dispatch.reserve({ id });
    const done = await p.owner.dispatch.complete({ id });
    const snapshot = (await plRow(id))!.snapshot as never;
    const lib = await docs();
    const rows = await sheetRows(lib.buildPackingListXlsxBuffer(snapshot, done.plNumber));
    const texts = rows.flat().filter((c): c is string => typeof c === "string");
    expect(texts).toContain("1 bundle");
    expect(texts.some((t) => /^1 bundles$/.test(t))).toBe(false);
    const cell = (label: string) => rows.find((r) => r[0] === label)?.[1];
    expect(cell("Notes")).toBe("Deliver before 5 pm");
    expect(String(cell("Ship date"))).toContain("2026");
    const html = lib.buildPackingListHtml(snapshot, done.plNumber);
    expect(html).toContain("Deliver before 5 pm");
    expect(html).toContain("Ship date");
  }, SLOW);

  test("m-4 orders.create with the same clientRequestId returns the first order, never a second number", async () => {
    setClock(NOON);
    const p = await plant();
    const input = {
      customerId: p.customerId,
      clientRequestId: "req-1",
      lines: [{ sectionId: p.dieA, cutLengthMm: 3_658, kgG: kg(100) }],
    };
    const first = await p.owner.orders.create(input);
    const again = await p.owner.orders.create(input);
    expect(again).toEqual({ id: first.id, number: first.number, replayed: true });
    expect(first.replayed).toBe(false);
    const other = await p.owner.orders.create({ ...input, clientRequestId: "req-2" });
    expect(other.id).not.toBe(first.id);
    const rows = await env.db.select({ id: salesOrder.id }).from(salesOrder).where(eq(salesOrder.companyId, p.companyId));
    expect(rows).toHaveLength(2);
    // Keys are per company: another company may use the same key.
    const q = await plant();
    const theirs = await q.owner.orders.create({ ...input, customerId: q.customerId, lines: [{ sectionId: q.dieA, cutLengthMm: 3_658, kgG: kg(1) }] });
    expect(theirs.replayed).toBe(false);
  }, SLOW);

  test("correctness m-1 the overdraw meta and the PL group carry the order's FY period; a shared SO number prints it", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const d = await p.held(await p.pack(p.dieA, [{ kg: 200 }], o.lineIds[0]));
    await p.owner.dispatch.complete({ id: d }).catch(() => undefined);
    const [req] = await pendingOverdraw(p.companyId, d);
    expect((req!.meta as { lines: { orderPeriod: string }[] }).lines[0]!.orderPeriod).toBe("2026-27");

    const lib = await docs();
    const g = (period: string | null) =>
      ({ key: period ?? "x", salesOrderLineId: "l", orderNumber: "SO-3", orderPeriod: period, lineNo: 1, sectionCode: "12170", item: "Domal", finish: null, poNumber: null, rows: [], subtotal: { bundles: 0, pcs: 0, weightG: 0 } }) as never;
    const a = g("2025-26");
    const b = g("2026-27");
    expect(lib.plGroupTitle(a, [a] as never)).toBe("SO-3 / 1 · 12170 · Domal");
    expect(lib.plGroupTitle(a, [a, b] as never)).toBe("SO-3 (2025-26) / 1 · 12170 · Domal");
    expect(lib.plGroupTitle(b, [a, b] as never)).toBe("SO-3 (2026-27) / 1 · 12170 · Domal");
  }, SLOW);

  test("correctness m-2 a second Complete with the same figures keeps the request and records the second ask with its note", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const d = await p.held(await p.pack(p.dieA, [{ kg: 200 }], o.lineIds[0]));
    const sup = p.as("supervisor");
    await sup.dispatch.complete({ id: d, overdrawNote: "first ask" }).catch(() => undefined);
    const [req] = await pendingOverdraw(p.companyId, d);
    await p.as("office").dispatch.complete({ id: d, overdrawNote: "customer wants the full lorry" }).catch(() => undefined);
    const [still] = await pendingOverdraw(p.companyId, d);
    expect(still!.id).toBe(req!.id);
    expect(still!.requestNote).toBe("first ask");
    const asks = await env.db
      .select({ meta: auditLog.meta })
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "dispatch.overdraw.request"), eq(auditLog.subjectId, d)));
    expect(asks.map((a) => (a.meta as { note: string | null }).note).sort()).toEqual(["customer wants the full lorry", "first ask"]);
    expect(asks.some((a) => (a.meta as { repeat?: boolean; requestId?: string }).repeat === true && (a.meta as { requestId?: string }).requestId === req!.id)).toBe(true);
    void approval;
  }, SLOW);

  test("correctness m-3 orders.update with the serverSeq the editor read: a stale save answers CONFLICT and changes nothing", async () => {
    setClock(NOON);
    const p = await plant();
    const o = await p.order([{ dieId: p.dieA, kg: 100 }]);
    const office = p.as("office");
    const read = (await office.orders.get({ id: o.id })).order.serverSeq;
    const line = (kgG: number) => ({ id: o.lineIds[0]!, sectionId: p.dieA, cutLengthMm: 3_658, kgG });
    await office.orders.update({ id: o.id, serverSeq: read, lines: [line(kg(150))] });
    // The second editor read the same version and saves over the first one's change.
    expect(await office.orders.update({ id: o.id, serverSeq: read, lines: [line(kg(120))] }).then(() => "saved", refused)).toBe("refused:CONFLICT");
    expect((await p.lineOf(o.lineIds[0]!)).orderedG).toBe(kg(150));
    // Write time: a save that read the current version but loses to another save meanwhile.
    const now = (await office.orders.get({ id: o.id })).order.serverSeq;
    env.beforeNextBatch(() => office.orders.update({ id: o.id, note: "other save" }));
    expect(await office.orders.update({ id: o.id, serverSeq: now, lines: [line(kg(130))] }).then(() => "saved", refused)).toBe("refused:CONFLICT");
    expect((await p.lineOf(o.lineIds[0]!)).orderedG).toBe(kg(150));
    // Without a serverSeq the old behaviour stands (last save wins).
    await office.orders.update({ id: o.id, lines: [line(kg(140))] });
    expect((await p.lineOf(o.lineIds[0]!)).orderedG).toBe(kg(140));
  }, SLOW);
});
