/**
 * XE store (rows 69 to 73): indents, store purchase orders, GRNs against a PO with an over-receipt
 * tolerance, reorder levels, and valuation at the weighted average (`lib/storeValue.ts`). The valuation
 * tests run the same worked examples through the SQL (the store's own writes) and the domain functions.
 */
import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";

import { auditLog, storeIndent, storePo, storeTxn } from "@orrn/db/schema";
import { grnValuePaise, issueValuePaise, monthValuation } from "@orrn/domain";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

setDefaultTimeout(30_000);

let env: TestEnv;
let setClock: (at: Date | null) => void;
let storeIssueValuePaise: typeof import("../src/lib/storeValue").storeIssueValuePaise;

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
  storeIssueValuePaise = (await import("../src/lib/storeValue")).storeIssueValuePaise;
});

afterEach(() => setClock(null));

afterAll(async () => {
  await env.dispose();
});

const ROLES: CompanyRole[] = [
  "owner", "admin", "manager", "office", "accountant", "supervisor", "packer",
  "foundry", "press", "storekeeper", "die_room", "operator", "viewer",
];

const U = 1000;

async function plant() {
  const { companyId, users } = await env.seedCompany();
  const callers = Object.fromEntries(ROLES.map((role) => [role, env.caller({ role, companyId })])) as Record<
    CompanyRole,
    ReturnType<typeof env.caller>
  >;
  await callers.owner.stock.locations.seedDefaults();
  const flux = await callers.storekeeper.store.items.create({ name: "Cover flux", unit: "kg", category: "chemical" });
  const bearing = await callers.storekeeper.store.items.create({ name: "Roller bearing 6205", unit: "piece", category: "spare" });
  const v = await callers.manager.vendor.create({ name: "Shree Chemicals" });
  return { companyId, users, ...callers, fluxId: flux.id, bearingId: bearing.id, vendorId: v.id };
}
type Plant = Awaited<ReturnType<typeof plant>>;

async function auditActions(companyId: string) {
  return (await env.db.select().from(auditLog).where(eq(auditLog.companyId, companyId))).map((r) => r.action);
}

async function issuedPo(p: Plant, lines?: { itemId: string; qtyMilli: number; ratePaise: number; gstBp: number }[]) {
  const po = await p.office.store.po.create({
    vendorId: p.vendorId,
    deliveryDate: "2026-12-05",
    terms: "30 days credit",
    lines: lines ?? [
      { itemId: p.fluxId, qtyMilli: 100 * U, ratePaise: 8_000, gstBp: 1_800 },
      { itemId: p.bearingId, qtyMilli: 4 * U, ratePaise: 45_000, gstBp: 1_800 },
    ],
  });
  await p.office.store.po.issue({ id: po.id });
  const got = await p.office.store.po.get({ id: po.id });
  return { id: po.id, number: po.number, lines: got.lines };
}

// ---------------------------------------------------------------------------
// Row 69: indents
// ---------------------------------------------------------------------------

describe("indents (row 69)", () => {
  test("raise, approve, make a PO from it; cancelling the PO puts the indent back to approved", async () => {
    const p = await plant();
    const ind = await p.foundry.store.indents.create({
      department: "Foundry",
      neededBy: "2026-12-01",
      reason: "Flux for the next casts",
      lines: [{ itemId: p.fluxId, qtyMilli: 50 * U }],
    });
    expect(ind.number).toMatch(/^IND-\d+$/);
    await expect(p.foundry.store.indents.approve({ id: ind.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.manager.store.indents.approve({ id: ind.id, note: "ok" });
    // Approving twice is refused with the status as it is now.
    await expect(p.admin.store.indents.approve({ id: ind.id })).rejects.toThrow(/is approved; it cannot be approved/);

    const po = await p.office.store.po.create({
      vendorId: p.vendorId,
      indentId: ind.id,
      lines: [{ itemId: p.fluxId, qtyMilli: 50 * U, ratePaise: 8_000, gstBp: 1_800 }],
    });
    expect(po.number).toMatch(/^PO-\d+$/);
    let got = await p.manager.store.indents.get({ id: ind.id });
    expect(got.indent.status).toBe("ordered");
    expect(got.po?.number).toBe(po.number);
    // An ordered indent cannot feed a second order.
    await expect(
      p.office.store.po.create({ vendorId: p.vendorId, indentId: ind.id, lines: [{ itemId: p.fluxId, qtyMilli: U, ratePaise: 1, gstBp: 0 }] }),
    ).rejects.toThrow(/only an approved indent becomes an order/);

    await p.office.store.po.cancel({ id: po.id, reason: "Vendor out of stock" });
    got = await p.manager.store.indents.get({ id: ind.id });
    expect(got.indent.status).toBe("approved");
    expect(got.indent.poId).toBeNull();
    const actions = await auditActions(p.companyId);
    for (const a of ["store.indent.create", "store.indent.approve", "store.po.create", "store.po.cancel"]) expect(actions).toContain(a);
  });

  test("reject needs a note; the raiser or an approver may cancel; others may not", async () => {
    const p = await plant();
    const mk = () => p.press.store.indents.create({ department: "Press", lines: [{ itemId: p.bearingId, qtyMilli: 2 * U }] });
    const a = await mk();
    await p.manager.store.indents.reject({ id: a.id, note: "Use the spare from the die room" });
    expect((await p.manager.store.indents.get({ id: a.id })).indent.status).toBe("rejected");
    await expect(p.manager.store.indents.cancel({ id: a.id, reason: "x" })).rejects.toThrow(/is rejected/);

    const b = await mk();
    await expect(p.storekeeper.store.indents.cancel({ id: b.id, reason: "not mine" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.press.store.indents.cancel({ id: b.id, reason: "Found one" });
    const c = await mk();
    await p.admin.store.indents.cancel({ id: c.id, reason: "Duplicate" });
    expect((await p.manager.store.indents.list({ status: "cancelled", limit: 10 })).items.map((i) => i.id).sort()).toEqual([b.id, c.id].sort());
  });

  test("lines are checked: whole pieces, no item twice, live items only", async () => {
    const p = await plant();
    await expect(
      p.foundry.store.indents.create({ department: "Foundry", lines: [{ itemId: p.bearingId, qtyMilli: 1_500 }] }),
    ).rejects.toThrow(/whole numbers/);
    await expect(
      p.foundry.store.indents.create({
        department: "Foundry",
        lines: [
          { itemId: p.fluxId, qtyMilli: U },
          { itemId: p.fluxId, qtyMilli: 2 * U },
        ],
      }),
    ).rejects.toThrow(/twice/);
    await expect(p.foundry.store.indents.create({ department: "Foundry", neededBy: "2026-02-30", lines: [{ itemId: p.fluxId, qtyMilli: U }] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("who may raise and read; another plant gets Not found", async () => {
    const p = await plant();
    for (const role of ["packer", "operator", "viewer", "accountant"] as const) {
      await expect(p[role].store.indents.create({ department: "X", lines: [{ itemId: p.fluxId, qtyMilli: U }] })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    await expect(p.viewer.store.indents.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ind = await p.storekeeper.store.indents.create({ department: "Store", lines: [{ itemId: p.fluxId, qtyMilli: U }] });
    const other = await plant();
    await expect(other.manager.store.indents.get({ id: ind.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.manager.store.indents.approve({ id: ind.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Another plant's item cannot go on an indent.
    await expect(other.storekeeper.store.indents.create({ department: "Store", lines: [{ itemId: p.fluxId, qtyMilli: U }] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

// ---------------------------------------------------------------------------
// Row 70: purchase orders
// ---------------------------------------------------------------------------

describe("purchase orders (row 70)", () => {
  test("draft, change, issue; money per line and totals; letterhead and vendor for the print", async () => {
    const p = await plant();
    const po = await p.office.store.po.create({
      vendorId: p.vendorId,
      lines: [{ itemId: p.fluxId, qtyMilli: 25 * U, ratePaise: 9_235, gstBp: 1_800 }],
    });
    await p.office.store.po.update({
      id: po.id,
      vendorId: p.vendorId,
      deliveryDate: "2026-12-10",
      terms: "Freight paid",
      note: null,
      lines: [
        { itemId: p.fluxId, qtyMilli: 25 * U, ratePaise: 9_235, gstBp: 1_800 },
        { itemId: p.bearingId, qtyMilli: 2 * U, ratePaise: 150_000, gstBp: 1_200 },
      ],
    });
    const got = await p.storekeeper.store.po.get({ id: po.id });
    expect(got.po.status).toBe("draft");
    expect(got.lines).toHaveLength(2);
    expect(got.totals).toEqual({ amountPaise: 530_875, gstPaise: 77_558, totalPaise: 608_433 });
    expect(got.vendor?.name).toBe("Shree Chemicals");
    expect(got.plant.name).toContain("Test Co");
    await p.office.store.po.issue({ id: po.id });
    await expect(p.office.store.po.update({ id: po.id, vendorId: p.vendorId, lines: [{ itemId: p.fluxId, qtyMilli: U, ratePaise: 1, gstBp: 0 }] })).rejects.toThrow(
      /is issued; it cannot be changed/,
    );
    await expect(p.office.store.po.issue({ id: po.id })).rejects.toThrow(/cannot be issued/);
    const list = await p.accountant.store.po.list({ status: "issued", limit: 10 });
    expect(list.items.map((i) => [i.number, i.amountPaise])).toEqual([[po.number, 530_875]]);
  });

  test("who may write and read; vendor must be confirmed; another plant gets Not found", async () => {
    const p = await plant();
    for (const role of ["storekeeper", "accountant", "supervisor", "viewer"] as const) {
      await expect(
        p[role].store.po.create({ vendorId: p.vendorId, lines: [{ itemId: p.fluxId, qtyMilli: U, ratePaise: 100, gstBp: 0 }] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(p.packer.store.po.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const draftVendor = await p.storekeeper.vendor.create({ name: "Unconfirmed Gas Co" });
    await expect(
      p.office.store.po.create({ vendorId: draftVendor.id, lines: [{ itemId: p.fluxId, qtyMilli: U, ratePaise: 100, gstBp: 0 }] }),
    ).rejects.toThrow(/not a confirmed vendor/);
    const po = await issuedPo(p);
    const other = await plant();
    await expect(other.office.store.po.get({ id: po.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.office.store.po.cancel({ id: po.id, reason: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      other.office.store.po.create({ vendorId: p.vendorId, lines: [{ itemId: other.fluxId, qtyMilli: U, ratePaise: 1, gstBp: 0 }] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await other.office.store.po.list()).items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Row 71: GRN against a PO
// ---------------------------------------------------------------------------

describe("GRN against a PO (row 71)", () => {
  test("receives at the PO rate, records rejected, moves the order to part received then closed", async () => {
    const p = await plant();
    const po = await issuedPo(p);
    const [fluxLine, bearingLine] = po.lines;
    const g1 = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 60 * U, rejectedMilli: 2 * U, poLineId: fluxLine!.id, grnRef: "CH-11" });
    let got = await p.office.store.po.get({ id: po.id });
    expect(got.po.status).toBe("part_received");
    const [row] = await env.db.select().from(storeTxn).where(eq(storeTxn.id, g1.id));
    expect(row).toMatchObject({ ratePaise: 8_000, valuePaise: 480_000, rejectedMilli: 2 * U, poLineId: fluxLine!.id });
    // Room left: 100 + 5 % = 105 kg, 60 in → 45 kg.
    const open = await p.storekeeper.store.po.openLines({ itemId: p.fluxId });
    expect(open.items.map((l) => l.roomMilli)).toEqual([45 * U]);
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 46 * U, poLineId: fluxLine!.id })).rejects.toThrow(
      /Over the order: PO-\d+ line 1 takes at most 45 more kg/,
    );
    // Within tolerance: 45 kg more (105 of 100) is accepted.
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 45 * U, poLineId: fluxLine!.id });
    expect((await p.office.store.po.get({ id: po.id })).po.status).toBe("part_received");
    const g3 = await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 4 * U, poLineId: bearingLine!.id, ratePaise: 44_000 });
    got = await p.office.store.po.get({ id: po.id });
    expect(got.po.status).toBe("closed");
    expect(got.po.closedAt).not.toBeNull();
    expect(got.po.closedBy).toBeNull();
    expect(got.grns).toHaveLength(3);
    // A typed rate wins over the PO rate.
    const [r3] = await env.db.select().from(storeTxn).where(eq(storeTxn.id, g3.id));
    expect(r3).toMatchObject({ ratePaise: 44_000, valuePaise: 176_000 });
    // A closed order takes nothing more; cancelling a GRN opens it again.
    await expect(p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: U, poLineId: bearingLine!.id })).rejects.toThrow(/not open for deliveries/);
    await p.storekeeper.store.cancel({ txnId: g3.id, reason: "Wrong size" });
    got = await p.office.store.po.get({ id: po.id });
    expect(got.po.status).toBe("part_received");
    expect(got.po.closedAt).toBeNull();
  });

  test("wrong item, draft order and another plant's line are refused; a GRN without a PO works as before", async () => {
    const p = await plant();
    const draft = await p.office.store.po.create({ vendorId: p.vendorId, lines: [{ itemId: p.fluxId, qtyMilli: 10 * U, ratePaise: 100, gstBp: 0 }] });
    const draftLine = (await p.office.store.po.get({ id: draft.id })).lines[0]!;
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U, poLineId: draftLine.id })).rejects.toThrow(/not open for deliveries/);
    const po = await issuedPo(p);
    await expect(p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: U, poLineId: po.lines[0]!.id })).rejects.toThrow(/for another item/);
    const other = await plant();
    await expect(other.storekeeper.store.receive({ itemId: other.fluxId, qtyMilli: U, poLineId: po.lines[0]!.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const plain = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 3 * U });
    const [row] = await env.db.select().from(storeTxn).where(eq(storeTxn.id, plain.id));
    expect(row).toMatchObject({ ratePaise: null, valuePaise: 0, poLineId: null, rejectedMilli: null });
  });

  test("the tolerance is a plant setting; 0 refuses any over-receipt; only publishers set it", async () => {
    const p = await plant();
    expect(await p.storekeeper.store.settings.get()).toEqual({ poOverReceiptBp: 500 });
    await expect(p.storekeeper.store.settings.setPoTolerance({ bp: 0 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.manager.store.settings.setPoTolerance({ bp: 0 });
    expect(await p.office.store.settings.get()).toEqual({ poOverReceiptBp: 0 });
    const po = await issuedPo(p);
    await expect(p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 100 * U + 1, poLineId: po.lines[0]!.id })).rejects.toThrow(/Over the order/);
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 100 * U, poLineId: po.lines[0]!.id });
    expect(await auditActions(p.companyId)).toContain("store.settings.update");
  });

  test("an order with goods in cannot be cancelled, only closed short", async () => {
    const p = await plant();
    const po = await issuedPo(p);
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U, poLineId: po.lines[0]!.id });
    await expect(p.office.store.po.cancel({ id: po.id, reason: "x" })).rejects.toThrow(/cannot be cancelled/);
    await expect(p.storekeeper.store.po.close({ id: po.id, note: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.office.store.po.close({ id: po.id, note: "Rest not needed" });
    const got = await p.office.store.po.get({ id: po.id });
    expect(got.po).toMatchObject({ status: "closed", closeNote: "Rest not needed" });
    expect(got.po.closedBy).not.toBeNull();
    // A GRN cancelled after a short close leaves the order closed.
    const grn = got.grns[0]!;
    await p.storekeeper.store.cancel({ txnId: grn.id, reason: "Returned" });
    expect((await p.office.store.po.get({ id: po.id })).po.status).toBe("closed");
  });

  test("two racing GRNs cannot both take the last room (guard in the INSERT)", async () => {
    const p = await plant();
    await p.manager.store.settings.setPoTolerance({ bp: 0 });
    const po = await issuedPo(p, [{ itemId: p.fluxId, qtyMilli: 10 * U, ratePaise: 100, gstBp: 0 }]);
    const lineId = po.lines[0]!.id;
    const results = await Promise.allSettled([
      p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 7 * U, poLineId: lineId }),
      p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 7 * U, poLineId: lineId }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = await env.db.select().from(storeTxn).where(and(eq(storeTxn.companyId, p.companyId), eq(storeTxn.poLineId, lineId)));
    expect(rows.reduce((s, r) => s + r.qtyMilli, 0)).toBe(7 * U);
  });
});

// ---------------------------------------------------------------------------
// Row 72: reorder levels
// ---------------------------------------------------------------------------

describe("reorder levels (row 72)", () => {
  test("below minimum shows with the ask; make indent once, then the same indent comes back", async () => {
    const p = await plant();
    await p.storekeeper.store.items.update({ id: p.fluxId, minMilli: 20 * U, reorderMilli: 50 * U });
    await p.storekeeper.store.items.update({ id: p.bearingId, minMilli: 2 * U, reorderMilli: null });
    await expect(p.storekeeper.store.items.update({ id: p.bearingId, minMilli: 1_500 })).rejects.toThrow(/whole numbers/);
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U });
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 3 * U });
    let low = await p.storekeeper.store.belowMinimum();
    expect(low.items).toEqual([
      { itemId: p.fluxId, name: "Cover flux", unit: "kg", balanceMilli: 5 * U, minMilli: 20 * U, askMilli: 50 * U, indent: null },
    ]);
    const made = await p.storekeeper.store.indents.fromReorder({ itemId: p.fluxId });
    expect(made.existing).toBe(false);
    const again = await p.storekeeper.store.indents.fromReorder({ itemId: p.fluxId });
    expect(again).toMatchObject({ id: made.id, existing: true });
    low = await p.storekeeper.store.belowMinimum();
    expect(low.items[0]!.indent).toMatchObject({ indentId: made.id, status: "open" });
    const got = await p.manager.store.indents.get({ id: made.id });
    expect(got.indent).toMatchObject({ department: "Store", reason: "Below minimum", source: "reorder" });
    expect(got.lines.map((l) => l.qtyMilli)).toEqual([50 * U]);
    await expect(p.storekeeper.store.indents.fromReorder({ itemId: p.bearingId })).rejects.toThrow(/not below its minimum/);
    await expect(p.foundry.store.indents.fromReorder({ itemId: p.fluxId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.viewer.store.belowMinimum()).rejects.toMatchObject({ code: "FORBIDDEN" });
    const balances = await p.manager.store.balances();
    expect(balances.items.find((i) => i.id === p.fluxId)).toMatchObject({ minMilli: 20 * U, reorderMilli: 50 * U });
  });
});

// ---------------------------------------------------------------------------
// Row 73: valuation
// ---------------------------------------------------------------------------

describe("valuation (row 73)", () => {
  test("worked example: SQL issue values equal the domain's, and the last issue empties the value", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U, ratePaise: 10_000 });
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U, ratePaise: 20_000 });
    let heldQ = 20 * U;
    let heldV = grnValuePaise(10 * U, 10_000) + grnValuePaise(10 * U, 20_000);
    for (const q of [5 * U, 3_333, 7_777]) {
      const want = issueValuePaise(heldQ, heldV, q);
      const out = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: q, purpose: "melt" });
      const [row] = await env.db.select().from(storeTxn).where(eq(storeTxn.id, out.id));
      expect(row!.valuePaise).toBe(want);
      expect(await storeIssueValuePaise(env.db, p.companyId, out.id)).toBe(want);
      heldQ -= q;
      heldV -= want;
    }
    const v = await p.manager.store.valuation.items();
    const flux = v.items.find((i) => i.id === p.fluxId)!;
    expect(flux).toMatchObject({ heldMilli: heldQ, valuePaise: heldV, noRate: false });
    const last = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: heldQ, purpose: "other" });
    expect(await storeIssueValuePaise(env.db, p.companyId, last.id)).toBe(heldV);
    expect((await p.manager.store.valuation.items()).items.find((i) => i.id === p.fluxId)).toMatchObject({ heldMilli: 0, valuePaise: 0, avgRatePaise: null });
  });

  test("no rate values at 0 and shows; exchange keeps the value; cancelled issue returns its value", async () => {
    const p = await plant();
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 4 * U, ratePaise: 50_000 });
    await p.storekeeper.store.receive({ itemId: p.bearingId, qtyMilli: 4 * U });
    let b = (await p.accountant.store.valuation.items()).items.find((i) => i.id === p.bearingId)!;
    expect(b).toMatchObject({ heldMilli: 8 * U, valuePaise: 200_000, avgRatePaise: 25_000, noRate: true });
    const ex = await p.storekeeper.store.exchange({ itemId: p.bearingId, qtyOutMilli: U, qtyInMilli: U });
    const legs = await env.db.select().from(storeTxn).where(eq(storeTxn.exchangeId, ex.exchangeId));
    expect(legs.find((l) => l.kind === "mrs")!.valuePaise).toBe(25_000);
    expect(legs.find((l) => l.kind === "grn")!.valuePaise).toBe(25_000);
    b = (await p.accountant.store.valuation.items()).items.find((i) => i.id === p.bearingId)!;
    expect(b.valuePaise).toBe(200_000);
    const out = await p.storekeeper.store.issue({ itemId: p.bearingId, qtyMilli: 2 * U, purpose: "maintenance" });
    expect(await storeIssueValuePaise(env.db, p.companyId, out.id)).toBe(50_000);
    await p.storekeeper.store.cancel({ txnId: out.id, reason: "Not used" });
    expect(await storeIssueValuePaise(env.db, p.companyId, out.id)).toBe(0);
    b = (await p.accountant.store.valuation.items()).items.find((i) => i.id === p.bearingId)!;
    expect(b.valuePaise).toBe(200_000);
    // The helper is plant-scoped and only values issues.
    const other = await plant();
    expect(await storeIssueValuePaise(env.db, other.companyId, out.id)).toBe(0);
    const grn = legs.find((l) => l.kind === "grn")!;
    expect(await storeIssueValuePaise(env.db, p.companyId, grn.id)).toBe(0);
    expect(await storeIssueValuePaise(env.db, p.companyId, "nope")).toBe(0);
  });

  test("month-end report equals the domain's monthValuation over the same rows, on the plant's month", async () => {
    const p = await plant();
    const ist = (d: number, h = 12) => new Date(Date.UTC(2026, 9, d, h - 5, 30)); // October 2026, IST wall clock
    setClock(new Date(Date.UTC(2026, 8, 28, 6)));
    const before = await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 10 * U, ratePaise: 10_000 });
    setClock(ist(3));
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 5 * U, ratePaise: 16_000 });
    setClock(ist(5));
    await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: 4 * U, purpose: "melt" });
    setClock(ist(6));
    const back = await p.storekeeper.store.issue({ itemId: p.fluxId, qtyMilli: U, purpose: "melt" });
    setClock(ist(7));
    await p.storekeeper.store.cancel({ txnId: back.id, reason: "Returned" });
    // 1 Nov 00:10 IST is still 31 Oct in UTC: it belongs to November on the plant's calendar.
    setClock(new Date(Date.UTC(2026, 9, 31, 18, 40)));
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: 2 * U, ratePaise: 10_000 });
    setClock(null);

    const r = await p.office.store.valuation.month({ month: "2026-10" });
    const rows = await env.db.select().from(storeTxn).where(eq(storeTxn.companyId, p.companyId));
    const want = monthValuation(
      rows.map((t) => ({ kind: t.kind, qtyMilli: t.qtyMilli, valuePaise: t.valuePaise, createdAt: t.createdAt.getTime(), cancelledAt: t.cancelledAt?.getTime() ?? null })),
      r.from,
      r.to,
    );
    const flux = r.items.find((i) => i.itemId === p.fluxId)!;
    expect(flux).toMatchObject(want);
    expect(flux).toMatchObject({ openingMilli: 10 * U, openingPaise: 100_000, inMilli: 5 * U, inPaise: 80_000, outMilli: 4 * U, closingMilli: 11 * U });
    expect(r.totals.closingPaise).toBe(flux.closingPaise);
    expect(rows.find((t) => t.id === before.id)!.valuePaise).toBe(100_000);
    const nov = await p.office.store.valuation.month({ month: "2026-11" });
    expect(nov.items.find((i) => i.itemId === p.fluxId)).toMatchObject({ openingMilli: 11 * U, inMilli: 2 * U, closingMilli: 13 * U });
    await expect(p.office.store.valuation.month({ month: "2026-13" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("only store.value roles read money; another plant sees only its own items", async () => {
    const p = await plant();
    for (const role of ["storekeeper", "supervisor", "foundry", "viewer"] as const) {
      await expect(p[role].store.valuation.items()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(p[role].store.valuation.month({ month: "2026-10" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await p.storekeeper.store.receive({ itemId: p.fluxId, qtyMilli: U, ratePaise: 100 });
    const other = await plant();
    const ids = (await other.manager.store.valuation.items()).items.map((i) => i.id);
    expect(ids).not.toContain(p.fluxId);
  });
});

describe("module gate", () => {
  test("with store off, indent and PO writes are refused", async () => {
    const { companyId } = await env.seedCompany({ modules: ["bundles"] });
    const manager = env.caller({ role: "manager", companyId });
    await expect(manager.store.indents.create({ department: "X", lines: [{ itemId: "x", qtyMilli: U }] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(manager.store.po.cancel({ id: "x", reason: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await env.db.select().from(storeIndent).where(eq(storeIndent.companyId, companyId))).toHaveLength(0);
    expect(await env.db.select().from(storePo).where(eq(storePo.companyId, companyId))).toHaveLength(0);
  });
});
