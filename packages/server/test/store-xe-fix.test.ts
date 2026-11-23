/**
 * XE store, CodeRabbit round 4 on PR #19: decisions read from the batch, GRN replay keys, the vendor
 * on issue, item levels against a racing unit change, the reorder indent at write time, reorder
 * coverage by PO lines, the short-close kind without `closed_by`, paged lists, and month rows that
 * carry only money.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { auditLog, storeIndent, storeItem, storePo, vendor } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

setDefaultTimeout(30_000);

let env: TestEnv;
let setClock: (at: Date | null) => void;

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
});

afterEach(() => {
  setClock(null);
  // A hook a test set up but the code under test never reached must not fire in a later test.
  env.beforeStatement(/^-- never --$/, async () => {});
});

afterAll(async () => {
  await env.dispose();
});

const ROLES: CompanyRole[] = ["owner", "admin", "manager", "office", "accountant", "storekeeper", "foundry", "viewer"];
const U = 1000;

async function plant() {
  const { companyId } = await env.seedCompany();
  const c = Object.fromEntries(ROLES.map((role) => [role, env.caller({ role, companyId })])) as Record<
    (typeof ROLES)[number],
    ReturnType<typeof env.caller>
  >;
  await c.owner.stock.locations.seedDefaults();
  const flux = await c.storekeeper.store.items.create({ name: "Cover flux", unit: "kg", category: "chemical" });
  const bearing = await c.storekeeper.store.items.create({ name: "Roller bearing 6205", unit: "piece", category: "spare" });
  const v = await c.manager.vendor.create({ name: "Shree Chemicals" });
  return { companyId, ...c, fluxId: flux.id, bearingId: bearing.id, vendorId: v.id };
}
type Plant = Awaited<ReturnType<typeof plant>>;

async function issuedPo(p: Plant, lines?: { itemId: string; qtyMilli: number; ratePaise: number; gstBp: number }[]) {
  const po = await p.office.store.po.create({
    vendorId: p.vendorId,
    lines: lines ?? [
      { itemId: p.fluxId, qtyMilli: 100 * U, ratePaise: 8_000, gstBp: 1_800 },
      { itemId: p.bearingId, qtyMilli: 4 * U, ratePaise: 45_000, gstBp: 1_800 },
    ],
  });
  await p.office.store.po.issue({ id: po.id });
  const got = await p.office.store.po.get({ id: po.id });
  return { id: po.id, number: po.number, lines: got.lines };
}

async function auditActions(companyId: string) {
  return (await env.db.select().from(auditLog).where(eq(auditLog.companyId, companyId))).map((r) => r.action);
}

describe("indent decision: the batch says whether it landed", () => {
  test("an order made from the indent right after the approval does not turn the approval into a refusal", async () => {
    const p = await plant();
    const ind = await p.foundry.store.indents.create({ department: "Foundry", lines: [{ itemId: p.fluxId, qtyMilli: 50 * U }] });
    // The old code re-read the row after the batch: an order made in that gap changed server_seq.
    env.beforeStatement(/^select "id" from "store_indent" where/, async () => {
      await p.office.store.po.create({
        vendorId: p.vendorId,
        indentId: ind.id,
        lines: [{ itemId: p.fluxId, qtyMilli: 50 * U, ratePaise: 8_000, gstBp: 0 }],
      });
    });
    const res = await p.manager.store.indents.approve({ id: ind.id });
    expect(res.status).toBe("approved");
    expect((await auditActions(p.companyId)).filter((a) => a === "store.indent.approve")).toHaveLength(1);
  });

  test("a decision that lost the race is refused with the status as it is now, and writes no audit row", async () => {
    const p = await plant();
    const ind = await p.foundry.store.indents.create({ department: "Foundry", lines: [{ itemId: p.fluxId, qtyMilli: 50 * U }] });
    env.beforeNextBatch(() => p.foundry.store.indents.cancel({ id: ind.id, reason: "Not needed" }));
    await expect(p.manager.store.indents.approve({ id: ind.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/is cancelled; it cannot be approved$/),
    });
    expect(await auditActions(p.companyId)).not.toContain("store.indent.approve");
  });
});

describe("GRN replay key", () => {
  test("a key reused with another PO line or another rejected quantity is refused; the exact resend replays after the order closes", async () => {
    const p = await plant();
    const po = await issuedPo(p, [{ itemId: p.fluxId, qtyMilli: 10 * U, ratePaise: 8_000, gstBp: 0 }]);
    const line = po.lines[0]!;
    const key = "grn-replay-1";
    const first = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U, poLineId: line.id, rejectedMilli: U, clientRequestId: key });
    expect((await p.office.store.po.get({ id: po.id })).po.status).toBe("closed");
    // The exact resend: same GRN back, though the order is now closed.
    const again = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U, poLineId: line.id, rejectedMilli: U, clientRequestId: key });
    expect(again).toMatchObject({ id: first.id, replayed: true });
    const conflict = { code: "CONFLICT", message: "This request id was already used for a different entry" };
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U, rejectedMilli: U, clientRequestId: key })).rejects.toMatchObject(conflict);
    await expect(
      p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U, poLineId: line.id, rejectedMilli: 2 * U, clientRequestId: key }),
    ).rejects.toMatchObject(conflict);
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U, poLineId: line.id, clientRequestId: key })).rejects.toMatchObject(conflict);
  });

  test("a GRN with no order replays with no rejected quantity, 0 and omitted alike, after its rate was set", async () => {
    const p = await plant();
    const key = "grn-replay-2";
    const first = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 3 * U, clientRequestId: key });
    await p.office.store.valuation.setGrnRate({ txnId: first.id, ratePaise: 9_000 });
    const again = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 3 * U, rejectedMilli: 0, clientRequestId: key });
    expect(again).toMatchObject({ id: first.id, replayed: true });
  });
});

describe("PO issue checks the vendor in the same UPDATE", () => {
  test("a vendor archived after the draft was made: issue refused as not confirmed, the order stays draft", async () => {
    const p = await plant();
    const po = await p.office.store.po.create({ vendorId: p.vendorId, lines: [{ itemId: p.fluxId, qtyMilli: U, ratePaise: 100, gstBp: 0 }] });
    env.beforeNextBatch(() => env.db.update(vendor).set({ status: "archived" }).where(eq(vendor.id, p.vendorId)));
    await expect(p.office.store.po.issue({ id: po.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Shree Chemicals is not a confirmed vendor",
    });
    expect((await p.office.store.po.get({ id: po.id })).po.status).toBe("draft");
    expect(await auditActions(p.companyId)).not.toContain("store.po.issue");
  });
});

describe("item levels against a racing unit change", () => {
  test("a level checked against kg does not land after the unit turned to pieces", async () => {
    const p = await plant();
    const { id } = await p.storekeeper.store.items.create({ name: "Loose shims", unit: "kg", category: "spare" });
    env.beforeNextBatch(() => p.storekeeper.store.items.update({ id, unit: "piece" }));
    await expect(p.storekeeper.store.items.update({ id, minMilli: 1_500 })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Loose shims changed; open it again",
    });
    const [row] = await env.db.select().from(storeItem).where(eq(storeItem.id, id));
    expect(row).toMatchObject({ unit: "piece", minMilli: null });
  });

  test("a unit change checked against no level does not land after a fractional level was set", async () => {
    const p = await plant();
    const { id } = await p.storekeeper.store.items.create({ name: "Loose washers", unit: "kg", category: "spare" });
    env.beforeNextBatch(() => p.storekeeper.store.items.update({ id, minMilli: 1_500 }));
    await expect(p.storekeeper.store.items.update({ id, unit: "piece" })).rejects.toMatchObject({ code: "CONFLICT" });
    const [row] = await env.db.select().from(storeItem).where(eq(storeItem.id, id));
    expect(row).toMatchObject({ unit: "kg", minMilli: 1_500 });
  });

  test("a unit change that clears the levels in the same request still lands; a rename is not held", async () => {
    const p = await plant();
    const { id } = await p.storekeeper.store.items.create({ name: "Loose pins", unit: "kg", category: "spare" });
    await p.storekeeper.store.items.update({ id, minMilli: 1_500, reorderMilli: 2_500 });
    await p.storekeeper.store.items.update({ id, unit: "piece", minMilli: null, reorderMilli: null });
    env.beforeNextBatch(() => p.storekeeper.store.items.update({ id, minMilli: 2 * U }));
    await p.storekeeper.store.items.update({ id, name: "Steel pins" });
    const [row] = await env.db.select().from(storeItem).where(eq(storeItem.id, id));
    expect(row).toMatchObject({ name: "Steel pins", unit: "piece", minMilli: 2 * U });
  });
});

describe("reorder indent at write time", () => {
  test("a GRN that lifts the stock past the minimum before the write: no indent, refused as not below", async () => {
    const p = await plant();
    await p.storekeeper.store.items.update({ id: p.fluxId, minMilli: 20 * U, reorderMilli: 50 * U });
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U });
    env.beforeNextBatch(() => p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 20 * U }));
    await expect(p.storekeeper.store.indents.fromReorder({ itemId: p.fluxId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Cover flux is not below its minimum",
    });
    expect(await env.db.select().from(storeIndent).where(eq(storeIndent.companyId, p.companyId))).toHaveLength(0);
  });

  test("stock that moved but stays below: the retry asks for the quantity from the stock as it is now", async () => {
    const p = await plant();
    await p.storekeeper.store.items.update({ id: p.fluxId, minMilli: 20 * U });
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U });
    env.beforeNextBatch(() => p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U }));
    const made = await p.storekeeper.store.indents.fromReorder({ itemId: p.fluxId });
    expect(made.existing).toBe(false);
    const got = await p.manager.store.indents.get({ id: made.id });
    // No reorder quantity: up to the minimum from 15 held.
    expect(got.lines.map((l) => l.qtyMilli)).toEqual([5 * U]);
  });
});

describe("reorder coverage follows the order's lines", () => {
  test("an item the order left out of an ordered indent stays reorderable; the item on the order is covered", async () => {
    const p = await plant();
    await p.storekeeper.store.items.update({ id: p.fluxId, minMilli: 20 * U });
    await p.storekeeper.store.items.update({ id: p.bearingId, minMilli: 2 * U });
    const ind = await p.foundry.store.indents.create({
      department: "Foundry",
      lines: [
        { itemId: p.fluxId, qtyMilli: 20 * U },
        { itemId: p.bearingId, qtyMilli: 2 * U },
      ],
    });
    await p.manager.store.indents.approve({ id: ind.id });
    let low = await p.storekeeper.store.belowMinimum();
    expect(low.items.map((i) => [i.itemId, i.indent?.indentId ?? null])).toEqual([
      [p.fluxId, ind.id],
      [p.bearingId, ind.id],
    ]);
    // The order buys only bearings.
    await p.office.store.po.create({ vendorId: p.vendorId, indentId: ind.id, lines: [{ itemId: p.bearingId, qtyMilli: 2 * U, ratePaise: 45_000, gstBp: 0 }] });
    low = await p.storekeeper.store.belowMinimum();
    expect(low.items.map((i) => [i.itemId, i.indent?.indentId ?? null])).toEqual([
      [p.fluxId, null],
      [p.bearingId, ind.id],
    ]);
    expect(await p.storekeeper.store.indents.fromReorder({ itemId: p.bearingId })).toMatchObject({ id: ind.id, existing: true });
    const flux = await p.storekeeper.store.indents.fromReorder({ itemId: p.fluxId });
    expect(flux.existing).toBe(false);
    expect(flux.id).not.toBe(ind.id);
  });
});

describe("short close by hand without closed_by", () => {
  test("the closing person deleted (closed_by null): the order still takes no delivery and is not offered", async () => {
    const p = await plant();
    const po = await issuedPo(p, [{ itemId: p.fluxId, qtyMilli: 10 * U, ratePaise: 8_000, gstBp: 0 }]);
    const line = po.lines[0]!;
    const g = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 4 * U, poLineId: line.id });
    await p.office.store.po.close({ id: po.id, note: "Vendor stopped this grade" });
    await env.db.update(storePo).set({ closedBy: null }).where(eq(storePo.id, po.id));
    expect((await p.storekeeper.store.po.openLines({ itemId: p.fluxId })).items).toEqual([]);
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U, poLineId: line.id })).rejects.toThrow(/is not open for deliveries/);
    // A GRN cancel runs the status sync: a hand-closed order keeps its status.
    await p.storekeeper.store.cancel({ txnId: g.id, reason: "Wrong challan" });
    expect((await p.office.store.po.get({ id: po.id })).po.status).toBe("closed");
  });

  test("an order closed by a full delivery still takes a top-up within the tolerance", async () => {
    const p = await plant();
    const po = await issuedPo(p, [{ itemId: p.fluxId, qtyMilli: 10 * U, ratePaise: 8_000, gstBp: 0 }]);
    const line = po.lines[0]!;
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U, poLineId: line.id });
    expect((await p.office.store.po.get({ id: po.id })).po.status).toBe("closed");
    expect((await p.storekeeper.store.po.openLines({ itemId: p.fluxId })).items.map((l) => l.roomMilli)).toEqual([500]);
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 500, poLineId: line.id });
  });
});

describe("paged lists", () => {
  test("indents and orders page newest first with a cursor; filters hold across pages; a bad cursor is refused", async () => {
    const p = await plant();
    const made: string[] = [];
    for (let i = 0; i < 5; i++) {
      setClock(new Date(Date.UTC(2026, 10, 1, 6, i)));
      made.push((await p.foundry.store.indents.create({ department: "Foundry", lines: [{ itemId: p.fluxId, qtyMilli: U }] })).id);
    }
    setClock(null);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 5; pages++) {
      const page = await p.manager.store.indents.list({ status: "open", limit: 2, cursor });
      seen.push(...page.items.map((r) => r.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual([...made].reverse());
    await expect(p.manager.store.indents.list({ limit: 2, cursor: "nope" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const pos: string[] = [];
    for (let i = 0; i < 3; i++) {
      pos.push((await p.office.store.po.create({ vendorId: p.vendorId, lines: [{ itemId: p.fluxId, qtyMilli: U, ratePaise: 1, gstBp: 0 }] })).id);
    }
    const a = await p.office.store.po.list({ vendorId: p.vendorId, status: "draft", limit: 2 });
    expect(a.items).toHaveLength(2);
    const b = await p.office.store.po.list({ vendorId: p.vendorId, status: "draft", limit: 2, cursor: a.nextCursor! });
    expect(b.nextCursor).toBeNull();
    expect([...a.items, ...b.items].map((r) => r.id).sort()).toEqual([...pos].sort());
    // Another plant reads none of them.
    const other = await plant();
    expect((await other.manager.store.indents.list({})).items).toEqual([]);
    expect((await other.office.store.po.list({})).items).toEqual([]);
  });

  test("open PO lines page oldest order first, line by line, and every open line is reachable", async () => {
    const p = await plant();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      setClock(new Date(Date.UTC(2026, 10, 2, 6, i)));
      const po = await issuedPo(p);
      ids.push(...po.lines.map((l) => l.id));
    }
    setClock(null);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let pages = 0; pages < 10; pages++) {
      const page = await p.storekeeper.store.po.openLines({ limit: 2, cursor });
      seen.push(...page.items.map((r) => r.lineId));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(ids);
    const fluxOnly = await p.storekeeper.store.po.openLines({ itemId: p.fluxId, limit: 2 });
    const rest = await p.storekeeper.store.po.openLines({ itemId: p.fluxId, limit: 2, cursor: fluxOnly.nextCursor! });
    expect([...fluxOnly.items, ...rest.items].every((l) => l.itemId === p.fluxId)).toBe(true);
    expect(fluxOnly.items.length + rest.items.length).toBe(3);
    await expect(p.viewer.store.po.openLines({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("GRNs waiting for a rate page newest first; the office reaches the oldest", async () => {
    const p = await plant();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      setClock(new Date(Date.UTC(2026, 10, 3, 6, i)));
      ids.push((await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U })).id);
    }
    setClock(null);
    const a = await p.office.store.valuation.pending({ limit: 2 });
    const b = await p.office.store.valuation.pending({ limit: 2, cursor: a.nextCursor! });
    expect([...a.items, ...b.items].map((r) => r.id)).toEqual([...ids].reverse());
    expect(b.nextCursor).toBeNull();
    // The no-input call the web made before still works.
    expect((await p.office.store.valuation.pending()).items).toHaveLength(3);
    await expect(p.storekeeper.store.valuation.pending({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("month report keeps rows that carry only money", () => {
  test("cancels and new entries net the quantity to 0 but not the money: the row and the totals keep it", async () => {
    const p = await plant();
    setClock(new Date(Date.UTC(2026, 8, 10, 6)));
    const g1 = await p.owner.store.receive({ itemId: p.fluxId, qtyMilli: U, ratePaise: 100 });
    const i1 = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "melt" });
    setClock(new Date(Date.UTC(2026, 9, 10, 6)));
    await p.storekeeper.store.cancel({ txnId: i1.id, reason: "Wrong item" });
    await p.storekeeper.store.cancel({ txnId: g1.id, reason: "Wrong item" });
    await p.owner.store.receive({ itemId: p.fluxId, qtyMilli: U, ratePaise: 300 });
    await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "melt" });
    setClock(null);
    const oct = await p.office.store.valuation.month({ month: "2026-10" });
    const flux = oct.items.find((i) => i.itemId === p.fluxId);
    expect(flux).toMatchObject({ openingMilli: 0, inMilli: 0, outMilli: 0, closingMilli: 0, inPaise: 200, outPaise: 200, closingPaise: 0 });
    expect(oct.totals).toMatchObject({ inPaise: 200, outPaise: 200 });
  });
});
