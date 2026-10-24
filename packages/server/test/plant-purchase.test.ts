/**
 * PL-6: scrap purchase — vendors (aliases, merge), scrap items and grades, purchase lots with
 * party vs FC kanta, debit/credit notes with manager approval, scrap ledger postings, register
 * (spec P14, §5; digest Stages 1-2).
 *
 * Review Focus 2: a short-weighed lot without a D/C note can never be marked OK.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { approval, auditLog, dcNote, purchaseLot, stockLedger, vendor, vendorAlias } from "@orrn/db/schema";
import { and, eq, inArray } from "drizzle-orm";

import { can as canMe, type Action } from "../src/lib/permissions";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;
let setClock: (at: Date | null) => void;

beforeAll(async () => {
  env = await createTestEnv();
  setClock = (await import("../src/lib/clock")).setClockForTests;
});

afterEach(() => setClock(null));

afterAll(async () => {
  await env.dispose();
});

const can = (role: CompanyRole, action: Action) =>
  canMe({ company: { role }, isPlatformAdmin: false, platformRole: null }, action);

const ROLES: CompanyRole[] = [
  "owner", "admin", "manager", "office", "accountant", "supervisor", "packer",
  "foundry", "press", "storekeeper", "die_room", "operator", "viewer",
];

const KG = 1000;

/** A plant with locations, scrap masters (A+/A/B/C, standard items) and one vendor. */
async function plant(opts: { settings?: Record<string, unknown>; locations?: boolean } = {}) {
  const { companyId, users } = await env.seedCompany({ settings: opts.settings ?? {} });
  const owner = env.caller({ role: "owner", companyId });
  const manager = env.caller({ role: "manager", companyId });
  const office = env.caller({ role: "office", companyId });
  const operator = env.caller({ role: "operator", companyId });
  const storekeeper = env.caller({ role: "storekeeper", companyId });
  const admin = env.caller({ role: "admin", companyId });
  const accountant = env.caller({ role: "accountant", companyId });
  const packer = env.caller({ role: "packer", companyId });
  if (opts.locations !== false) await owner.stock.locations.seedDefaults();
  await manager.purchase.seedScrapDefaults();
  const items = (await manager.purchase.scrapItems.list()).items;
  const grades = (await manager.purchase.scrapGrades.list()).items;
  const v = await manager.vendor.create({ name: "Shree Ganesh Metals" });
  const itemId = items.find((i) => i.name === "IMP BELLING")!.id;
  const scrapLoc = opts.locations === false
    ? null
    : (await owner.stock.locations.list()).items.find((l) => l.code === "SCRAP")!;
  return {
    companyId, users, owner, manager, office, operator, storekeeper, admin, accountant, packer,
    items, grades, vendorId: v.id, itemId, scrapLocationId: scrapLoc?.id ?? null,
  };
}

type Plant = Awaited<ReturnType<typeof plant>>;

async function newLot(p: Plant, over: Record<string, unknown> = {}) {
  return p.storekeeper.purchase.lots.create({
    vendorId: p.vendorId,
    date: "2026-10-01",
    origin: "LOCAL",
    itemId: p.itemId,
    grade: "A",
    partyKgG: 10_000 * KG,
    fcKgG: 10_000 * KG,
    ratePaise: 18_500,
    billBook: "main",
    // Tests pass deliberately invalid values too; the server validates them.
    ...(over as object),
  });
}

async function lotRow(id: string) {
  const [row] = await env.db.select().from(purchaseLot).where(eq(purchaseLot.id, id));
  return row!;
}

async function ledgerFor(companyId: string) {
  return env.db
    .select()
    .from(stockLedger)
    .where(and(eq(stockLedger.companyId, companyId), eq(stockLedger.itemKind, "scrap_grade")));
}

async function scrapBalance(companyId: string) {
  const rows = await ledgerFor(companyId);
  return rows.reduce((s, r) => s + r.qtyG, 0);
}

async function approvalFor(noteId: string) {
  const [row] = await env.db.select().from(approval).where(eq(approval.subjectId, noteId));
  return row!;
}

// ---------------------------------------------------------------------------
// Review Focus 2
// ---------------------------------------------------------------------------

describe("Review Focus 2: no short-weighed lot is OK without a D/C note", () => {
  test("short beyond tolerance and no note: OK is refused, nothing posted", async () => {
    const p = await plant();
    // 10,000 kg billed, 9,900 kg on the FC kanta: 1 % short, tolerance 0.5 %.
    const lot = await newLot(p, { fcKgG: 9_900 * KG });
    await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "unload" });
    await expect(p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await lotRow(lot.id)).status).toBe("unload");
    expect(await ledgerFor(p.companyId)).toEqual([]);
    // Straight from booking is refused too.
    const lot2 = await newLot(p, { fcKgG: 9_000 * KG });
    await expect(p.storekeeper.purchase.lots.advance({ id: lot2.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("a pending debit note on the weight lets it go OK; the posting is the FC kg", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_900 * KG });
    const note = await p.office.purchase.dcNotes.create({
      lotId: lot.id,
      type: "debit",
      reason: "weight",
      kgDiffG: 100 * KG,
      boriDeductionG: 0,
      note: "short at FC kanta",
    });
    expect(note.number).toBe("DCN-1");
    expect((await approvalFor(note.id)).status).toBe("pending");
    await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" });
    const row = await lotRow(lot.id);
    expect(row.status).toBe("ok");
    expect(row.locationId).toBe(p.scrapLocationId);
    const rows = await ledgerFor(p.companyId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      voucherType: "purchase_lot",
      voucherId: lot.id,
      line: 1,
      itemKind: "scrap_grade",
      locationId: p.scrapLocationId,
      qtyG: 9_900 * KG,
    });
  });

  test("a rejected note, a credit note or a grade note does not count", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_800 * KG });
    const n1 = await p.office.purchase.dcNotes.create({
      lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 200 * KG, boriDeductionG: 0, note: "x",
    });
    await p.manager.approval.decide({ id: n1.approvalId, decision: "rejected", note: "reweigh" });
    await expect(p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const n2 = await p.office.purchase.dcNotes.create({
      lotId: lot.id, type: "credit", reason: "weight", kgDiffG: 200 * KG, boriDeductionG: 0, note: "x",
    });
    await p.manager.approval.decide({ id: n2.approvalId, decision: "approved" });
    await expect(p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const n3 = await p.office.purchase.dcNotes.create({
      lotId: lot.id, type: "debit", reason: "grade", kgDiffG: 0, boriDeductionG: 0, amountPaise: 50_000, note: "B not A",
    });
    await p.manager.approval.decide({ id: n3.approvalId, decision: "approved" });
    await expect(p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await ledgerFor(p.companyId)).toEqual([]);
  });

  test("race: the note is rejected after OK read it — the OK write does not land", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_000 * KG });
    const note = await p.office.purchase.dcNotes.create({
      lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 1_000 * KG, boriDeductionG: 0, note: "x",
    });
    env.beforeNextBatch(() => p.manager.approval.decide({ id: note.approvalId, decision: "rejected" }));
    await expect(p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await lotRow(lot.id)).status).toBe("booking");
    expect(await ledgerFor(p.companyId)).toEqual([]);
  });

  test("race: FC kg is corrected to short after OK read it — the OK write does not land", async () => {
    const p = await plant();
    const lot = await newLot(p);
    env.beforeNextBatch(() => p.storekeeper.purchase.lots.update({ id: lot.id, fcKgG: 9_000 * KG }));
    await expect(p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await lotRow(lot.id)).status).toBe("booking");
    expect(await ledgerFor(p.companyId)).toEqual([]);
  });

  test("weights cannot change under a live weight note; a lot cannot be OK without FC kg", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_000 * KG });
    await p.office.purchase.dcNotes.create({
      lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 1_000 * KG, boriDeductionG: 0, note: "x",
    });
    await expect(p.storekeeper.purchase.lots.update({ id: lot.id, fcKgG: 8_000 * KG })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const unweighed = await newLot(p, { fcKgG: undefined });
    await expect(p.storekeeper.purchase.lots.advance({ id: unweighed.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("within tolerance: exactly 0.5 % short is OK without a note; 1 g more is not; heavier is OK", async () => {
    const p = await plant();
    const edge = await newLot(p, { partyKgG: 10_000 * KG, fcKgG: 9_950 * KG });
    await p.storekeeper.purchase.lots.advance({ id: edge.id, to: "ok" });
    const over = await newLot(p, { partyKgG: 10_000 * KG, fcKgG: 9_950 * KG - 1 });
    await expect(p.storekeeper.purchase.lots.advance({ id: over.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const heavy = await newLot(p, { partyKgG: 10_000 * KG, fcKgG: 10_200 * KG });
    await p.storekeeper.purchase.lots.advance({ id: heavy.id, to: "ok" });
    expect(await scrapBalance(p.companyId)).toBe(9_950 * KG + 10_200 * KG);
  });
});

// ---------------------------------------------------------------------------
// Ruling RP8: weight notes must cover the shortfall beyond tolerance
// ---------------------------------------------------------------------------

describe("RP8: the weight notes must cover the shortfall beyond tolerance", () => {
  // 10,000 kg billed, 9,000 kg on the FC kanta: 1,000 kg short, 50 kg tolerance → notes must cover 950 kg.
  const weightNote = (p: Plant, lotId: string, kgDiffG: number, type: "debit" | "credit" = "debit") =>
    p.office.purchase.dcNotes.create({ lotId, type, reason: "weight", kgDiffG, boriDeductionG: 0, note: "x" });

  test("a note smaller than the shortfall beyond tolerance keeps OK blocked; a covering one unlocks", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_000 * KG });
    const small = await weightNote(p, lot.id, 949 * KG + 999);
    await expect(p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("950 kg"),
    });
    const reg = await p.office.purchase.register({ from: "2026-10-01", to: "2026-10-31" });
    expect(reg.lots[0]).toMatchObject({ hasWeightNote: true, noteCoversShort: false, flag: "short_without_note" });
    await p.manager.approval.decide({ id: small.approvalId, decision: "rejected" });
    await weightNote(p, lot.id, 950 * KG);
    await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" });
    expect(await scrapBalance(p.companyId)).toBe(9_000 * KG);
  });

  test("two partial notes that sum to cover unlock (one approved, one pending)", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_000 * KG });
    const n1 = await weightNote(p, lot.id, 500 * KG);
    await p.manager.approval.decide({ id: n1.approvalId, decision: "approved" });
    await expect(p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await weightNote(p, lot.id, 450 * KG);
    await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" });
    expect((await lotRow(lot.id)).status).toBe("ok");
  });

  test("rejected notes and credit notes do not count toward the cover", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_000 * KG });
    const n1 = await weightNote(p, lot.id, 500 * KG);
    await p.manager.approval.decide({ id: n1.approvalId, decision: "approved" });
    const n2 = await weightNote(p, lot.id, 450 * KG);
    await p.manager.approval.decide({ id: n2.approvalId, decision: "rejected" });
    const n3 = await weightNote(p, lot.id, 450 * KG, "credit");
    await p.manager.approval.decide({ id: n3.approvalId, decision: "approved" });
    await expect(p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await ledgerFor(p.companyId)).toEqual([]);
  });

  test("race: the note that completed the cover is rejected after OK read it — the OK write does not land", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_000 * KG });
    const n1 = await weightNote(p, lot.id, 500 * KG);
    await p.manager.approval.decide({ id: n1.approvalId, decision: "approved" });
    const n2 = await weightNote(p, lot.id, 450 * KG);
    env.beforeNextBatch(() => p.manager.approval.decide({ id: n2.approvalId, decision: "rejected" }));
    await expect(p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await lotRow(lot.id)).status).toBe("booking");
    expect(await ledgerFor(p.companyId)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tolerance from settings
// ---------------------------------------------------------------------------

describe("D/C tolerance (settings.dcTolerancePct, basis points)", () => {
  test("default is 50 bp; a company setting of 200 bp lets 1.5 % short through", async () => {
    const p = await plant({ settings: { dcTolerancePct: 200 } });
    const lot = await newLot(p, { fcKgG: 9_850 * KG });
    await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" });
    const lot2 = await newLot(p, { fcKgG: 9_799 * KG });
    await expect(p.storekeeper.purchase.lots.advance({ id: lot2.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("company.updateSettings sets it (validated, audited); a note snapshots it", async () => {
    const p = await plant();
    await expect(p.admin.company.updateSettings({ dcTolerancePct: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.admin.company.updateSettings({ dcTolerancePct: 10_001 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.admin.company.updateSettings({ dcTolerancePct: 1.5 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.office.company.updateSettings({ dcTolerancePct: 100 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const res = await p.admin.company.updateSettings({ dcTolerancePct: 100 });
    expect(res.settings.dcTolerancePct).toBe(100);
    const lot = await newLot(p, { fcKgG: 9_900 * KG });
    await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" });
    const lot2 = await newLot(p, { fcKgG: 9_000 * KG });
    const note = await p.office.purchase.dcNotes.create({
      lotId: lot2.id, type: "debit", reason: "weight", kgDiffG: 1_000 * KG, boriDeductionG: 0, note: "x",
    });
    const [row] = await env.db.select().from(dcNote).where(eq(dcNote.id, note.id));
    expect(row!.toleranceBp).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Lots: numbers, states, validation
// ---------------------------------------------------------------------------

describe("purchase lots", () => {
  test("LOT-n numbers from the series; booking → unload → ok; no going back", async () => {
    const p = await plant();
    const a = await newLot(p);
    const b = await newLot(p);
    expect([a.number, b.number]).toEqual(["LOT-1", "LOT-2"]);
    expect(a.status).toBe("booking");
    await p.storekeeper.purchase.lots.advance({ id: a.id, to: "unload" });
    await expect(p.storekeeper.purchase.lots.advance({ id: a.id, to: "unload" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await p.storekeeper.purchase.lots.advance({ id: a.id, to: "ok" });
    await expect(p.storekeeper.purchase.lots.advance({ id: a.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(p.storekeeper.purchase.lots.advance({ id: a.id, to: "unload" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await ledgerFor(p.companyId)).length).toBe(1);
    const got = await p.office.purchase.lots.get({ id: a.id });
    expect(got.lot.number).toBe("LOT-1");
    expect(got.lot.vendorName).toBe("Shree Ganesh Metals");
    expect(got.lot.gradeCode).toBe("A");
  });

  test("two concurrent OKs post exactly once", async () => {
    const p = await plant();
    const lot = await newLot(p);
    const results = await Promise.allSettled([
      p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" }),
      p.operator.purchase.lots.advance({ id: lot.id, to: "ok" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await ledgerFor(p.companyId)).toHaveLength(1);
    expect(await scrapBalance(p.companyId)).toBe(10_000 * KG);
  });

  test("validation: grade and item must be active masters; weights and rates positive; bill book", async () => {
    const p = await plant();
    await expect(newLot(p, { grade: "Z" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(newLot(p, { partyKgG: 0 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(newLot(p, { ratePaise: -1 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(newLot(p, { billBook: "xx" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(newLot(p, { date: "2026-13-40" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(newLot(p, { photoUrls: ["not a url"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const lot = await newLot(p, { grade: "a+", billBook: "wb", drossBp: 450, vehicleNo: "GJ 06 AB 1234", photoUrls: ["https://x.test/a.jpg"] });
    const row = await lotRow(lot.id);
    expect(row.billBook).toBe("wb");
    expect(row.drossBp).toBe(450);
    expect(row.photoUrls).toEqual(["https://x.test/a.jpg"]);
    // Deactivated item is refused.
    await p.manager.purchase.scrapItems.update({ id: p.itemId, active: false });
    await expect(newLot(p)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("OK needs an active scrap store location", async () => {
    const p = await plant({ locations: false });
    const lot = await newLot(p);
    await expect(p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await lotRow(lot.id)).status).toBe("booking");
  });

  test("after OK, stock fields are locked but rate / bill no / dross stay editable", async () => {
    const p = await plant();
    const lot = await newLot(p);
    await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" });
    await expect(p.storekeeper.purchase.lots.update({ id: lot.id, fcKgG: 9_000 * KG })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(p.storekeeper.purchase.lots.update({ id: lot.id, grade: "B" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await p.storekeeper.purchase.lots.update({ id: lot.id, ratePaise: 19_000, partyBillNo: "INV-77", drossBp: 300 });
    const row = await lotRow(lot.id);
    expect(row.ratePaise).toBe(19_000);
    expect(row.partyBillNo).toBe("INV-77");
  });
});

// ---------------------------------------------------------------------------
// D/C notes, approval and the ledger
// ---------------------------------------------------------------------------

describe("D/C notes and scrap ledger postings", () => {
  test("note approved before OK: the lot posts FC kg minus bori", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_900 * KG });
    const note = await p.office.purchase.dcNotes.create({
      lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 100 * KG, boriDeductionG: 40 * KG, note: "20 bori × 2 kg",
    });
    await p.manager.approval.decide({ id: note.approvalId, decision: "approved" });
    const [row] = await env.db.select().from(dcNote).where(eq(dcNote.id, note.id));
    expect(row!.status).toBe("approved");
    expect(row!.decidedAt).not.toBeNull();
    // Default amount = (kg diff + bori) × rate.
    expect(row!.amountPaise).toBe(140 * 18_500);
    await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" });
    expect(await scrapBalance(p.companyId)).toBe(9_860 * KG);
  });

  test("note approved after OK: a dc_note row takes the bori off; rejected posts nothing", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_900 * KG });
    const note = await p.office.purchase.dcNotes.create({
      lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 100 * KG, boriDeductionG: 30 * KG, note: "x",
    });
    await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" });
    expect(await scrapBalance(p.companyId)).toBe(9_900 * KG);
    await p.manager.approval.decide({ id: note.approvalId, decision: "approved" });
    const rows = await ledgerFor(p.companyId);
    expect(rows.find((r) => r.voucherType === "dc_note")).toMatchObject({
      voucherId: note.id,
      qtyG: -30 * KG,
      locationId: p.scrapLocationId,
      itemRef: rows[0]!.itemRef,
    });
    expect(await scrapBalance(p.companyId)).toBe(9_870 * KG);

    const lot2 = await newLot(p, { fcKgG: 9_900 * KG });
    const note2 = await p.office.purchase.dcNotes.create({
      lotId: lot2.id, type: "debit", reason: "weight", kgDiffG: 100 * KG, boriDeductionG: 30 * KG, note: "x",
    });
    await p.storekeeper.purchase.lots.advance({ id: lot2.id, to: "ok" });
    await p.manager.approval.decide({ id: note2.approvalId, decision: "rejected" });
    expect(await scrapBalance(p.companyId)).toBe(9_870 * KG + 9_900 * KG);
    const [n2] = await env.db.select().from(dcNote).where(eq(dcNote.id, note2.id));
    expect(n2!.status).toBe("rejected");
  });

  test("the losing approver of a race changes nothing (no double posting)", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_900 * KG });
    const note = await p.office.purchase.dcNotes.create({
      lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 100 * KG, boriDeductionG: 30 * KG, note: "x",
    });
    await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" });
    env.beforeNextBatch(() => p.admin.approval.decide({ id: note.approvalId, decision: "approved" }));
    await expect(p.manager.approval.decide({ id: note.approvalId, decision: "approved" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await ledgerFor(p.companyId)).filter((r) => r.voucherType === "dc_note")).toHaveLength(1);
  });

  test("note rules: one pending note per lot; bori below FC kg; not on a cancelled lot; requester cannot approve", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_900 * KG });
    await expect(
      p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 0, boriDeductionG: 0, note: "x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 0, boriDeductionG: 9_900 * KG, note: "x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const n1 = await p.office.purchase.dcNotes.create({
      lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 100 * KG, boriDeductionG: 0, note: "x",
    });
    await expect(
      p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 100 * KG, boriDeductionG: 0, note: "x" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p.office.approval.decide({ id: n1.approvalId, decision: "approved" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // Owner raised → owner cannot approve own note.
    const lot2 = await newLot(p, { fcKgG: 9_900 * KG });
    const n2 = await p.owner.purchase.dcNotes.create({
      lotId: lot2.id, type: "debit", reason: "weight", kgDiffG: 100 * KG, boriDeductionG: 0, note: "x",
    });
    await expect(p.owner.approval.decide({ id: n2.approvalId, decision: "approved" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const lot3 = await newLot(p);
    await p.storekeeper.purchase.lots.cancel({ id: lot3.id, reason: "truck did not come" });
    await expect(
      p.office.purchase.dcNotes.create({ lotId: lot3.id, type: "debit", reason: "weight", kgDiffG: 1, boriDeductionG: 0, note: "x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Weight note needs an FC weight.
    const unweighed = await newLot(p, { fcKgG: undefined });
    await expect(
      p.office.purchase.dcNotes.create({ lotId: unweighed.id, type: "debit", reason: "weight", kgDiffG: 1, boriDeductionG: 0, note: "x" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("cancelling an OK lot reverses its postings (incl. the D/C deduction); manager only", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_900 * KG });
    const note = await p.office.purchase.dcNotes.create({
      lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 100 * KG, boriDeductionG: 30 * KG, note: "x",
    });
    await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" });
    await p.manager.approval.decide({ id: note.approvalId, decision: "approved" });
    await expect(p.storekeeper.purchase.lots.cancel({ id: lot.id, reason: "wrong entry" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await p.manager.purchase.lots.cancel({ id: lot.id, reason: "wrong entry" });
    const rows = await ledgerFor(p.companyId);
    expect(rows).toHaveLength(4);
    const reversals = rows.filter((r) => r.voucherType === "purchase_lot_cancel");
    expect(reversals).toHaveLength(2);
    for (const r of reversals) {
      const orig = rows.find((o) => o.id === r.reversalOf)!;
      expect(r.qtyG).toBe(-orig.qtyG);
      expect(r.locationId).toBe(orig.locationId);
    }
    expect(await scrapBalance(p.companyId)).toBe(0);
    const row = await lotRow(lot.id);
    expect(row.status).toBe("cancelled");
    expect(row.cancelReason).toBe("wrong entry");
    await expect(p.manager.purchase.lots.cancel({ id: lot.id, reason: "again" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("an OK lot whose scrap was already drawn cannot be cancelled (stock would go negative)", async () => {
    const p = await plant();
    const lot = await newLot(p);
    await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" });
    const [posted] = await ledgerFor(p.companyId);
    // Simulate a melt draw (PL-5) of 4 t from this item+grade at the scrap yard.
    await env.db.insert(stockLedger).values({
      id: crypto.randomUUID(),
      companyId: p.companyId,
      voucherType: "opening",
      voucherId: "melt-sim",
      line: 1,
      itemKind: "scrap_grade",
      itemRef: posted!.itemRef,
      locationId: posted!.locationId,
      qtyG: -4_000 * KG,
      postedAt: new Date(),
    });
    await expect(p.manager.purchase.lots.cancel({ id: lot.id, reason: "x" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await lotRow(lot.id)).status).toBe("ok");
  });

  test("scrapStock shows kg by item and grade at the scrap yard", async () => {
    const p = await plant();
    await p.storekeeper.purchase.lots.advance({ id: (await newLot(p)).id, to: "ok" });
    await p.storekeeper.purchase.lots.advance({ id: (await newLot(p, { fcKgG: 9_960 * KG })).id, to: "ok" });
    await p.storekeeper.purchase.lots.advance({ id: (await newLot(p, { grade: "B" })).id, to: "ok" });
    const stock = await p.office.purchase.scrapStock();
    const a = stock.items.find((s) => s.gradeCode === "A")!;
    expect(a).toMatchObject({ itemName: "IMP BELLING", qtyG: 19_960 * KG });
    expect(stock.items.find((s) => s.gradeCode === "B")!.qtyG).toBe(10_000 * KG);
  });
});

// ---------------------------------------------------------------------------
// Vendors: aliases, drafts, merge
// ---------------------------------------------------------------------------

describe("vendors", () => {
  test("names and aliases resolve by normalised key; duplicates are refused", async () => {
    const p = await plant();
    const kd = await p.manager.vendor.create({ name: "K.D. METALS", aliases: ["KD Metal"], gstin: "24abcde1234f1z5" });
    expect(kd.status).toBe("active");
    expect((await p.office.vendor.resolve({ text: "kd metal" }))?.id).toBe(kd.id);
    expect((await p.office.vendor.resolve({ text: "K D Metals" }))?.id).toBe(kd.id);
    expect(await p.office.vendor.resolve({ text: "nobody" })).toBeNull();
    await expect(p.manager.vendor.create({ name: "kd-metals" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p.manager.vendor.create({ name: "K D METAL" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p.manager.vendor.create({ name: "Bad GST", gstin: "123" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const other = await p.manager.vendor.create({ name: "Patel Traders" });
    await expect(p.manager.vendor.addAlias({ vendorId: other.id, alias: "KD metal" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(p.manager.vendor.addAlias({ vendorId: other.id, alias: "kdmetals" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const alias = await p.manager.vendor.addAlias({ vendorId: other.id, alias: "PATEL TRADING CO" });
    expect((await p.office.vendor.resolve({ text: "patel trading co." }))?.id).toBe(other.id);
    await p.manager.vendor.removeAlias({ id: alias.id });
    expect(await p.office.vendor.resolve({ text: "patel trading co." })).toBeNull();
    const list = await p.office.vendor.list({ q: "kd" });
    expect(list.items.map((v) => v.id)).toEqual([kd.id]);
    const got = await p.office.vendor.get({ id: kd.id });
    expect(got.vendor.gstin).toBe("24ABCDE1234F1Z5");
    expect(got.aliases.map((a) => a.alias)).toEqual(["KD Metal"]);
  });

  test("yard staff create a draft vendor inline; a manager confirms it; lots can use a draft vendor", async () => {
    const p = await plant();
    const v = await p.operator.vendor.create({ name: "New Kabadi Wala" });
    expect(v.status).toBe("draft");
    await newLot(p, { vendorId: v.id });
    await expect(p.operator.vendor.confirm({ id: v.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.operator.vendor.update({ id: v.id, city: "Rajkot" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.manager.vendor.confirm({ id: v.id });
    const [row] = await env.db.select().from(vendor).where(eq(vendor.id, v.id));
    expect(row!.status).toBe("active");
    // Archived vendors take no new lots.
    await p.manager.vendor.update({ id: v.id, status: "archived" });
    await expect(newLot(p, { vendorId: v.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("merge moves lots and aliases to the keeper; merged names become aliases", async () => {
    const p = await plant();
    const keep = await p.manager.vendor.create({ name: "K.D. METALS" });
    const dup1 = await p.manager.vendor.create({ name: "KD Metal", aliases: ["KD MTL"] });
    const dup2 = await p.operator.vendor.create({ name: "K D Metal Works" });
    const l1 = await newLot(p, { vendorId: dup1.id });
    const l2 = await newLot(p, { vendorId: dup2.id });
    const l3 = await newLot(p, { vendorId: keep.id });
    await expect(p.office.vendor.merge({ keepId: keep.id, mergeIds: [dup1.id] })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(p.manager.vendor.merge({ keepId: keep.id, mergeIds: [keep.id] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const res = await p.manager.vendor.merge({ keepId: keep.id, mergeIds: [dup1.id, dup2.id] });
    expect(res).toMatchObject({ keepId: keep.id, merged: 2, lotsMoved: 2 });
    for (const id of [l1.id, l2.id, l3.id]) expect((await lotRow(id)).vendorId).toBe(keep.id);
    const aliases = await env.db.select().from(vendorAlias).where(eq(vendorAlias.vendorId, keep.id));
    expect(aliases.map((a) => a.alias).sort()).toEqual(["K D Metal Works", "KD MTL", "KD Metal"]);
    const merged = await env.db.select().from(vendor).where(inArray(vendor.id, [dup1.id, dup2.id]));
    for (const m of merged) expect(m).toMatchObject({ status: "merged", mergedIntoId: keep.id });
    expect((await p.office.vendor.resolve({ text: "kd metal" }))?.id).toBe(keep.id);
    // Merged vendors take no new lots and cannot be merged again.
    await expect(newLot(p, { vendorId: dup1.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.manager.vendor.merge({ keepId: keep.id, mergeIds: [dup1.id] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    // The register lists every lot under the keeper.
    const reg = await p.office.purchase.register({ from: "2026-10-01", to: "2026-10-31", vendorId: keep.id });
    expect(reg.lots).toHaveLength(3);
    const [audit] = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "vendor.merge")));
    expect(audit).toBeDefined();
  });

  test("merge keeps going through chains: a vendor merged earlier into a merged vendor follows", async () => {
    const p = await plant();
    const a = await p.manager.vendor.create({ name: "Alpha Scrap" });
    const b = await p.manager.vendor.create({ name: "Alpha Scraps" });
    const c = await p.manager.vendor.create({ name: "Alfa Scrap" });
    await p.manager.vendor.merge({ keepId: b.id, mergeIds: [c.id] });
    await p.manager.vendor.merge({ keepId: a.id, mergeIds: [b.id] });
    const [rowC] = await env.db.select().from(vendor).where(eq(vendor.id, c.id));
    expect(rowC!.mergedIntoId).toBe(a.id);
    expect((await p.office.vendor.resolve({ text: "Alfa Scrap" }))?.id).toBe(a.id);
  });

  test("merge of 50 vendors stays under the D1 parameter cap", async () => {
    const p = await plant();
    const keep = await p.manager.vendor.create({ name: "Keeper" });
    const ids: string[] = [];
    for (let i = 0; i < 50; i += 1) ids.push((await p.manager.vendor.create({ name: `Dup ${i}`, aliases: [`Dup alias ${i}`] })).id);
    for (const id of ids.slice(0, 5)) await newLot(p, { vendorId: id });
    const res = await p.manager.vendor.merge({ keepId: keep.id, mergeIds: ids });
    expect(res.merged).toBe(50);
    expect(res.lotsMoved).toBe(5);
    const aliases = await env.db.select().from(vendorAlias).where(eq(vendorAlias.vendorId, keep.id));
    expect(aliases).toHaveLength(100);
   }, 60_000);
});

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

describe("purchase register", () => {
  test("lots with D/C notes, payable kg, amounts, and the short-without-note flag", async () => {
    const p = await plant();
    const ok = await newLot(p, { date: "2026-10-01" });
    const short = await newLot(p, { date: "2026-10-02", fcKgG: 9_900 * KG });
    const shortNoNote = await newLot(p, { date: "2026-10-03", fcKgG: 9_000 * KG });
    await newLot(p, { date: "2026-09-30" }); // outside the range
    const cancelled = await newLot(p, { date: "2026-10-04" });
    await p.storekeeper.purchase.lots.cancel({ id: cancelled.id, reason: "x" });
    const note = await p.office.purchase.dcNotes.create({
      lotId: short.id, type: "debit", reason: "weight", kgDiffG: 100 * KG, boriDeductionG: 20 * KG, note: "x",
    });
    await p.manager.approval.decide({ id: note.approvalId, decision: "approved" });
    await p.storekeeper.purchase.lots.advance({ id: ok.id, to: "ok" });
    await p.storekeeper.purchase.lots.advance({ id: short.id, to: "ok" });

    const reg = await p.accountant.purchase.register({ from: "2026-10-01", to: "2026-10-31" });
    expect(reg.lots.map((l) => l.number)).toEqual([ok.number, short.number, shortNoNote.number]);
    const s = reg.lots.find((l) => l.id === short.id)!;
    expect(s.notes).toHaveLength(1);
    expect(s).toMatchObject({
      shortG: 100 * KG,
      shortBeyondTolerance: true,
      hasWeightNote: true,
      // party 10,000 − (100 + 20) debit = 9,880 kg payable
      payableKgG: 9_880 * KG,
      amountPaise: 9_880 * 18_500,
      stockKgG: 9_880 * KG,
    });
    const n = reg.lots.find((l) => l.id === shortNoNote.id)!;
    expect(n).toMatchObject({ shortBeyondTolerance: true, hasWeightNote: false, flag: "short_without_note" });
    expect(reg.totals).toMatchObject({
      lots: 3,
      partyKgG: 30_000 * KG,
      fcKgG: 28_900 * KG,
      debitKgG: 120 * KG,
      creditKgG: 0,
      shortWithoutNote: 1,
    });
    const withCancelled = await p.office.purchase.register({ from: "2026-10-01", to: "2026-10-31", includeCancelled: true });
    expect(withCancelled.lots).toHaveLength(4);
    await expect(p.packer.purchase.register({ from: "2026-10-01", to: "2026-10-31" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(p.office.purchase.register({ from: "2026-10-31", to: "2026-10-01" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("a register over 150 lots stays under the D1 parameter cap", async () => {
    const p = await plant();
    for (let i = 0; i < 150; i += 1) {
      const lot = await newLot(p, { fcKgG: 9_800 * KG });
      if (i % 2 === 0) {
        await p.office.purchase.dcNotes.create({
          lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 200 * KG, boriDeductionG: 0, note: "x",
        });
      }
    }
    const reg = await p.office.purchase.register({ from: "2026-10-01", to: "2026-10-31" });
    expect(reg.lots).toHaveLength(150);
    expect(reg.lots.filter((l) => l.notes.length === 1)).toHaveLength(75);
    expect(reg.totals.shortWithoutNote).toBe(75);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe("tenant isolation", () => {
  test("another company's vendor, item, lot and note ids are NOT_FOUND", async () => {
    const a = await plant();
    const b = await plant();
    const lotB = await newLot(b, { fcKgG: 9_000 * KG });
    const noteB = await b.office.purchase.dcNotes.create({
      lotId: lotB.id, type: "debit", reason: "weight", kgDiffG: 1_000 * KG, boriDeductionG: 0, note: "x",
    });
    await expect(newLot(a, { vendorId: b.vendorId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(newLot(a, { itemId: b.itemId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(a.storekeeper.purchase.lots.advance({ id: lotB.id, to: "ok" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(a.storekeeper.purchase.lots.update({ id: lotB.id, ratePaise: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(a.manager.purchase.lots.cancel({ id: lotB.id, reason: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(a.office.purchase.lots.get({ id: lotB.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      a.office.purchase.dcNotes.create({ lotId: lotB.id, type: "debit", reason: "weight", kgDiffG: 1, boriDeductionG: 0, note: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(a.manager.approval.decide({ id: noteB.approvalId, decision: "approved" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(a.manager.vendor.merge({ keepId: a.vendorId, mergeIds: [b.vendorId] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(a.manager.vendor.merge({ keepId: b.vendorId, mergeIds: [a.vendorId] })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(a.manager.vendor.addAlias({ vendorId: b.vendorId, alias: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(a.manager.vendor.update({ id: b.vendorId, city: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(a.office.vendor.get({ id: b.vendorId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(a.manager.purchase.scrapItems.update({ id: b.itemId, active: false })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Same names in both companies are fine (keys are per company), and lists never cross.
    await a.manager.vendor.create({ name: "K.D. METALS" });
    await b.manager.vendor.create({ name: "K.D. METALS" });
    expect((await a.office.vendor.list({})).items.every((v) => v.companyId === a.companyId)).toBe(true);
    expect((await a.office.purchase.lots.list({})).items).toEqual([]);
    expect((await a.office.purchase.dcNotes.list({})).items).toEqual([]);
    expect((await a.office.purchase.register({ from: "2026-01-01", to: "2026-12-31" })).lots).toEqual([]);
    expect(await a.office.vendor.resolve({ text: b.vendorId })).toBeNull();
    const [noteRow] = await env.db.select().from(dcNote).where(eq(dcNote.id, noteB.id));
    expect(noteRow!.status).toBe("pending");
  });

  test("deleting a company removes its purchase rows (cascade)", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_000 * KG });
    await p.office.purchase.dcNotes.create({
      lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 1_000 * KG, boriDeductionG: 0, note: "x",
    });
    await p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" });
    const { company } = await import("@orrn/db/schema");
    await env.db.delete(company).where(eq(company.id, p.companyId));
    expect(await env.db.select().from(purchaseLot).where(eq(purchaseLot.companyId, p.companyId))).toEqual([]);
    expect(await env.db.select().from(vendor).where(eq(vendor.companyId, p.companyId))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Permission matrix
// ---------------------------------------------------------------------------

describe("permission matrix", () => {
  test("lots.create ⇔ purchase.receipt; dcNotes.create ⇔ purchase.dcnote; merge ⇔ masters.publish", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_000 * KG });
    for (const role of ROLES) {
      const api = env.caller({ role, companyId: p.companyId });
      const create = newLot({ ...p, storekeeper: api });
      if (can(role, "purchase.receipt")) await expect(create).resolves.toMatchObject({ status: "booking" });
      else await expect(create).rejects.toMatchObject({ code: "FORBIDDEN" });

      const note = api.purchase.dcNotes.create({
        lotId: lot.id, type: "credit", reason: "grade", kgDiffG: 0, boriDeductionG: 0, amountPaise: 100, note: role,
      });
      if (can(role, "purchase.dcnote")) {
        const made = await note;
        // Close it so the next role can raise one (one pending note per lot).
        await (role === "manager" ? p.admin : p.manager).approval.decide({ id: made.approvalId, decision: "rejected" });
      } else {
        await expect(note).rejects.toMatchObject({ code: "FORBIDDEN" });
      }

      const masters = api.purchase.scrapGrades.create({ code: `G${role.slice(0, 3).toUpperCase()}${ROLES.indexOf(role)}` });
      if (can(role, "masters.publish")) await expect(masters).resolves.toBeDefined();
      else await expect(masters).rejects.toMatchObject({ code: "FORBIDDEN" });

      const v = api.vendor.create({ name: `Vendor of ${role}` });
      const mayCreate = can(role, "masters.publish") || can(role, "masters.draft") || can(role, "purchase.receipt");
      if (mayCreate) {
        await expect(v).resolves.toMatchObject({ status: can(role, "masters.publish") ? "active" : "draft" });
      } else {
        await expect(v).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    }
    expect(can("office", "purchase.dcnote")).toBe(true);
    expect(can("accountant", "purchase.dcnote")).toBe(false);
  });

  test("accountant reads the register and notes; packer and press cannot read purchase data", async () => {
    const p = await plant();
    const accountant = env.caller({ role: "accountant", companyId: p.companyId });
    await expect(accountant.purchase.dcNotes.list({})).resolves.toBeDefined();
    await expect(accountant.purchase.lots.list({})).resolves.toBeDefined();
    for (const role of ["packer", "press"] as const) {
      const api = env.caller({ role, companyId: p.companyId });
      await expect(api.purchase.lots.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(api.vendor.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // Scrap masters are readable by everyone (the foundry charges by grade).
    const foundry = env.caller({ role: "foundry", companyId: p.companyId });
    expect((await foundry.purchase.scrapGrades.list()).items.map((g) => g.code)).toEqual(["A+", "A", "B", "C"]);
  });
});

// ---------------------------------------------------------------------------
// Fix round 1: amounts never leak, bori limits, write-time guards, caps
// ---------------------------------------------------------------------------

describe("fix round 1", () => {
  test("approval.list shows a packer no weights, money or note text for a dc_note; the approver reads them from dcNotes.get", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_900 * KG });
    const note = await p.office.purchase.dcNotes.create({
      lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 100 * KG, boriDeductionG: 20 * KG, note: "20 bori, ₹18,500",
    });
    const stored = await approvalFor(note.id);
    expect(Object.keys(stored.meta).sort()).toEqual(["lotId", "lotNumber", "number", "reason", "type"]);
    // A forged/older request carrying figures is redacted for non-readers anyway.
    await env.db
      .update(approval)
      .set({ meta: { ...stored.meta, amountPaise: 1, partyKgG: 2, kgDiffG: 3 } })
      .where(eq(approval.id, stored.id));
    for (const role of ["packer", "press", "foundry", "die_room"] as const) {
      const list = await env.caller({ role, companyId: p.companyId }).approval.list({ kind: "dc_note" });
      const item = list.items.find((i) => i.subjectId === note.id)!;
      expect(item.requestNote).toBeNull();
      expect(Object.keys(item.meta).sort()).toEqual(["lotId", "lotNumber", "number", "reason", "type"]);
      await expect(env.caller({ role, companyId: p.companyId }).purchase.dcNotes.get({ id: note.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    const managerView = (await p.manager.approval.list({ kind: "dc_note" })).items.find((i) => i.subjectId === note.id)!;
    expect(managerView.requestNote).toBe("20 bori, ₹18,500");
    const detail = await p.manager.purchase.dcNotes.get({ id: note.id });
    expect(detail.note).toMatchObject({ kgDiffG: 100 * KG, boriDeductionG: 20 * KG, amountPaise: 120 * 18_500 });
    expect(detail.lot).toMatchObject({ partyKgG: 10_000 * KG, fcKgG: 9_900 * KG, ratePaise: 18_500 });
    expect(detail).toMatchObject({ shortG: 100 * KG, toleranceBp: 50, uncoveredShortG: 50 * KG, noteCoversShort: true });
    const other = await plant();
    await expect(other.manager.purchase.dcNotes.get({ id: note.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("bori only on debit notes, needs FC kg, and all live bori stays below FC kg", async () => {
    const p = await plant();
    const lot = await newLot(p, { partyKgG: 1_000 * KG, fcKgG: 1_000 * KG });
    await expect(
      p.office.purchase.dcNotes.create({ lotId: lot.id, type: "credit", reason: "weight", kgDiffG: 0, boriDeductionG: 10 * KG }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const n1 = await p.office.purchase.dcNotes.create({
      lotId: lot.id, type: "debit", reason: "grade", kgDiffG: 0, boriDeductionG: 600 * KG,
    });
    await p.manager.approval.decide({ id: n1.approvalId, decision: "approved" });
    await expect(
      p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "grade", kgDiffG: 0, boriDeductionG: 600 * KG }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "grade", kgDiffG: 0, boriDeductionG: 399 * KG });
    const unweighed = await newLot(p, { fcKgG: undefined });
    await expect(
      p.office.purchase.dcNotes.create({ lotId: unweighed.id, type: "debit", reason: "grade", kgDiffG: 0, boriDeductionG: 1 * KG }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("race: FC kg lowered after the note read the lot — the bori note does not land", async () => {
    const p = await plant();
    const lot = await newLot(p, { partyKgG: 1_000 * KG, fcKgG: 1_000 * KG });
    env.beforeNextBatch(() => p.storekeeper.purchase.lots.update({ id: lot.id, fcKgG: 500 * KG }));
    await expect(
      p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "grade", kgDiffG: 0, boriDeductionG: 600 * KG }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await env.db.select().from(dcNote).where(eq(dcNote.lotId, lot.id))).toEqual([]);
    expect(await env.db.select().from(approval).where(eq(approval.companyId, p.companyId))).toEqual([]);
  });

  test("race: FC kg cleared after a weight note read the lot — the note does not land", async () => {
    const p = await plant();
    const lot = await newLot(p, { fcKgG: 9_000 * KG });
    env.beforeNextBatch(() => p.storekeeper.purchase.lots.update({ id: lot.id, fcKgG: null }));
    await expect(
      p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 1_000 * KG, boriDeductionG: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await env.db.select().from(dcNote).where(eq(dcNote.lotId, lot.id))).toEqual([]);
  });

  test("a live bori note locks the weights even on a grade note", async () => {
    const p = await plant();
    const lot = await newLot(p);
    await p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "grade", kgDiffG: 0, boriDeductionG: 10 * KG });
    await expect(p.storekeeper.purchase.lots.update({ id: lot.id, fcKgG: 9_000 * KG })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(p.storekeeper.purchase.lots.update({ id: lot.id, partyKgG: 11_000 * KG })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("OK refuses a lot whose approved bori would leave no stock", async () => {
    const p = await plant();
    const lot = await newLot(p, { partyKgG: 1_000 * KG, fcKgG: 1_000 * KG });
    // A note row from before the guard existed (or written around it).
    await env.db.insert(dcNote).values({
      id: crypto.randomUUID(), companyId: p.companyId, number: "DCN-X", period: "2026-27", lotId: lot.id,
      type: "debit", reason: "grade", boriDeductionG: 1_000 * KG, toleranceBp: 50, status: "approved",
    });
    await expect(p.storekeeper.purchase.lots.advance({ id: lot.id, to: "ok" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await ledgerFor(p.companyId)).toEqual([]);
  });

  test("caps: party ≤ 100 t, rate ≤ ₹10,000/kg, kg diff ≤ party", async () => {
    const p = await plant();
    await expect(newLot(p, { partyKgG: 100_000_001 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(newLot(p, { ratePaise: 1_000_001 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await newLot(p, { partyKgG: 100_000_000, fcKgG: 100_000_000, ratePaise: 1_000_000 });
    const lot = await newLot(p, { partyKgG: 1_000 * KG, fcKgG: 900 * KG });
    await expect(
      p.office.purchase.dcNotes.create({ lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 1_000 * KG + 1, boriDeductionG: 0 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("merging into a draft keeper is refused; removing an alias is audited once", async () => {
    const p = await plant();
    const draft = await p.operator.vendor.create({ name: "Draft Keeper" });
    const dup = await p.manager.vendor.create({ name: "Draft Keepers", aliases: ["DK"] });
    await expect(p.manager.vendor.merge({ keepId: draft.id, mergeIds: [dup.id] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await p.manager.vendor.confirm({ id: draft.id });
    expect((await p.manager.vendor.merge({ keepId: draft.id, mergeIds: [dup.id] })).merged).toBe(1);
    const [alias] = await env.db.select().from(vendorAlias).where(eq(vendorAlias.alias, "DK"));
    await Promise.allSettled([
      p.manager.vendor.removeAlias({ id: alias!.id }),
      p.admin.vendor.removeAlias({ id: alias!.id }),
    ]);
    const audits = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, p.companyId), eq(auditLog.action, "vendor.alias.remove")));
    expect(audits).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Dev seed
// ---------------------------------------------------------------------------

describe("dev seed: scrap purchase", () => {
  test("vendors with aliases, ten lots, one short lot with an approved D/C note; ledger = register; re-runnable", async () => {
    const { user } = await import("@orrn/db/schema");
    for (const key of ["owner", "operator", "viewer", "office", "dieroom", "staff"]) {
      await env.db.insert(user).values({ id: `dev-user-${key}`, name: key, email: `${key}@orrn.local` });
    }
    const seedPath = "../../../apps/server/src/dev-seed";
    const { seedDevData } = (await import(seedPath)) as {
      seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
    };
    const companyId = "dev-company-orrn";
    for (let run = 0; run < 2; run += 1) {
      expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
      const owner = env.caller({ role: "owner", companyId });
      expect((await owner.vendor.list({})).total).toBe(8);
      expect((await owner.vendor.resolve({ text: "KD Metal" }))?.name).toBe("K.D. Metals");
      const reg = await owner.purchase.register({ from: "2020-01-01", to: "2099-12-31" });
      expect(reg.lots).toHaveLength(10);
      expect(reg.totals.shortWithoutNote).toBe(0);
      const short = reg.lots.filter((l) => l.shortBeyondTolerance);
      expect(short).toHaveLength(1);
      expect(short[0]!.notes.map((n) => n.status)).toEqual(["approved"]);
      // Scrap ledger = what the register says is in stock.
      expect(await scrapBalance(companyId)).toBe(reg.totals.stockKgG);
      expect(reg.totals.stockKgG).toBeGreaterThan(0);
    }
    // The app continues the seeded books.
    const owner = env.caller({ role: "owner", companyId });
    const items = (await owner.purchase.scrapItems.list()).items;
    const v = (await owner.vendor.resolve({ text: "Gulf Alloys" }))!;
    const lot = await owner.purchase.lots.create({
      vendorId: v.id, itemId: items[0]!.id, grade: "A", partyKgG: 1_000 * KG, fcKgG: 900 * KG, ratePaise: 20_000,
    });
    // Seeded lots span the last 18 days, so near 1 April some sit in the previous FY's series.
    const period = (await lotRow(lot.id)).period;
    const seededInPeriod = (await env.db.select().from(purchaseLot).where(eq(purchaseLot.companyId, companyId))).filter(
      (l) => l.period === period && l.id !== lot.id,
    ).length;
    expect(lot.number).toBe(`LOT-${seededInPeriod + 1}`);
    const note = await owner.purchase.dcNotes.create({
      lotId: lot.id, type: "debit", reason: "weight", kgDiffG: 100 * KG, boriDeductionG: 0,
    });
    const [noteRow] = await env.db.select().from(dcNote).where(eq(dcNote.id, note.id));
    const seededNotes = (await env.db.select().from(dcNote).where(eq(dcNote.companyId, companyId))).filter(
      (n) => n.period === noteRow!.period && n.id !== note.id,
    ).length;
    expect(note.number).toBe(`DCN-${seededNotes + 1}`);
  });
});
