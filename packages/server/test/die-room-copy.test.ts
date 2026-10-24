/**
 * Die copy state machine (FP-DR-01/09), tier change and band lift by approval (FP-DR-10), the
 * customer-owned die and its exception flow (FP-DR-12), card fields (FP-DR-07), and the permission
 * matrix per role. Every transition, allowed and refused.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import {
  approval,
  auditLog,
  dieInstance,
  dieTierChange,
  location,
  nitridingLog,
  storeItem,
  storeTxn,
} from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;
let dieOwnerLib: typeof import("../src/lib/dieOwner");

beforeAll(async () => {
  env = await createTestEnv();
  dieOwnerLib = await import("../src/lib/dieOwner");
});

afterAll(async () => {
  await env.dispose();
});

const ROLES: CompanyRole[] = [
  "owner", "admin", "manager", "office", "accountant", "supervisor", "packer",
  "foundry", "press", "storekeeper", "die_room", "operator", "viewer",
];

async function plant() {
  const { companyId, users } = await env.seedCompany({ settings: { dieRoom: { newCopyOnTrial: false } } }); // these tests are about the rack; the trial flow has its own file
  const sectionId = await env.seedDie(companyId, { series: "Domal", sectionCode: "12170", weightMinG: 5_900, weightMaxG: 6_200, wallTenthMm: 12 });
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  return { companyId, users, sectionId, as, dieRoom: as("die_room"), manager: as("manager"), owner: as("owner"), admin: as("admin") };
}
type Plant = Awaited<ReturnType<typeof plant>>;

const copy = (p: Plant, over: Record<string, unknown> = {}) => p.dieRoom.dieInstance.create({ sectionId: p.sectionId, ...over });
async function row(id: string) {
  const [r] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, id));
  return r!;
}
const setStatus = (id: string, status: "in_use" | "at_maker" | "at_nitriding" | "retired" | "available") =>
  env.db.update(dieInstance).set({ status }).where(eq(dieInstance.id, id));
async function audits(subjectId: string, action: string) {
  return env.db.select().from(auditLog).where(and(eq(auditLog.subjectId, subjectId), eq(auditLog.action, action)));
}
const sectionInput = (p: Plant, over: Record<string, unknown> = {}) => ({
  id: p.sectionId, series: "Domal", sectionCode: "12170", weightMinG: 5_900, weightMaxG: 6_200, dimensions: {}, ...over,
});

describe("copy status (spec §E1 state machine)", () => {
  test("create -> available; in_use and at_maker cannot be typed; a new copy cannot start at nitriding", async () => {
    const p = await plant();
    const a = await copy(p);
    expect((await row(a.id)).status).toBe("available");
    for (const status of ["in_use", "at_maker"]) {
      await expect(copy(p, { status })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(p.dieRoom.dieInstance.update({ id: a.id, status } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await expect(copy(p, { status: "at_nitriding" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await row(a.id)).status).toBe("available");
  });

  test("card edits are refused while the copy is issued or at the maker", async () => {
    const p = await plant();
    const a = await copy(p);
    for (const status of ["in_use", "at_maker"] as const) {
      await setStatus(a.id, status);
      await expect(p.dieRoom.dieInstance.update({ id: a.id, rackNo: "R-4" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect((await row(a.id)).rackNo).toBeNull();
    }
  });

  test("retire only from the rack: refused from in_use, at_nitriding, at_maker; a retired copy stays retired", async () => {
    const p = await plant();
    const a = await copy(p);
    for (const status of ["in_use", "at_maker"] as const) {
      await setStatus(a.id, status);
      await expect(p.dieRoom.dieInstance.update({ id: a.id, status: "retired" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await setStatus(a.id, "at_nitriding");
    await expect(p.dieRoom.dieInstance.update({ id: a.id, status: "retired" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await setStatus(a.id, "available");
    await p.dieRoom.dieInstance.update({ id: a.id, status: "retired" });
    expect((await row(a.id)).status).toBe("retired");
    await expect(p.dieRoom.dieInstance.update({ id: a.id, status: "available" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("the card never moves a copy to or from nitriding: only nitridingOut / nitridingBack do, with their own audit", async () => {
    const p = await plant();
    const a = await copy(p);
    await expect(p.dieRoom.dieInstance.update({ id: a.id, status: "at_nitriding" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("nitriding"),
    });
    expect((await row(a.id)).status).toBe("available");
    await p.dieRoom.dieInstance.nitridingOut({ dieInstanceId: a.id });
    expect((await row(a.id)).status).toBe("at_nitriding");
    await expect(p.dieRoom.dieInstance.update({ id: a.id, status: "available" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Other card fields still save while it is away, and an unchanged status is no change.
    await p.dieRoom.dieInstance.update({ id: a.id, rackNo: "R-9", status: "at_nitriding" });
    expect(await row(a.id)).toMatchObject({ status: "at_nitriding", rackNo: "R-9" });
    await p.dieRoom.dieInstance.nitridingBack({ dieInstanceId: a.id });
    expect((await row(a.id)).status).toBe("available");
    expect(await audits(a.id, "nitriding.out")).toHaveLength(1);
    expect(await audits(a.id, "nitriding.back")).toHaveLength(1);
  });

  test("an issue that lands between read and write wins over a card edit", async () => {
    const p = await plant();
    const a = await copy(p);
    env.beforeNextBatch(() => setStatus(a.id, "in_use"));
    await expect(p.dieRoom.dieInstance.update({ id: a.id, rackNo: "R-1" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await row(a.id)).toMatchObject({ status: "in_use", rackNo: null });
  });

  test("card fields: bolster, backer, sub-bolster, rack, received, cavities default from the section", async () => {
    const p = await plant();
    await p.manager.die.update(sectionInput(p, { cavityCount: 2 }));
    const a = await copy(p, { bolster: "B-7", backerNo: "BK-2", subBolster: "SB-1", rackNo: "R-12", receivedAt: Date.UTC(2026, 9, 18) });
    expect(await row(a.id)).toMatchObject({ bolster: "B-7", backerNo: "BK-2", subBolster: "SB-1", rackNo: "R-12", cavityCount: 2 });
    expect((await row(a.id)).receivedAt).toEqual(new Date(Date.UTC(2026, 9, 18)));
    const b = await copy(p, { cavityCount: 4 });
    expect((await row(b.id)).cavityCount).toBe(4);
    await p.dieRoom.dieInstance.update({ id: b.id, rackNo: "R-1", cavityCount: null });
    expect(await row(b.id)).toMatchObject({ rackNo: "R-1", cavityCount: null });
    expect((await p.dieRoom.dieInstance.get({ id: b.id })).cavityCount).toBe(2); // null inherits the section
  });
});

describe("nitriding out and back (FP-DR-09)", () => {
  test("out: log + at_nitriding in one batch, HV sets the copy hardness; back: available", async () => {
    const p = await plant();
    const a = await copy(p);
    const out = await p.dieRoom.dieInstance.nitridingOut({
      dieInstanceId: a.id,
      hardness: 1_050,
      cr4: { openG: 5_000, usedG: 1_200, closeG: 3_800 },
    });
    expect(await row(a.id)).toMatchObject({ status: "at_nitriding", hardness: 1_050 });
    const [log] = await env.db.select().from(nitridingLog).where(eq(nitridingLog.id, out.id));
    expect(log).toMatchObject({ cr4UsedG: 1_200, cr4CloseG: 3_800, storeTxnId: null, hardness: 1_050 });
    expect(await audits(a.id, "nitriding.out")).toHaveLength(1);

    await expect(p.dieRoom.dieInstance.nitridingOut({ dieInstanceId: a.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.dieRoom.dieInstance.nitridingBack({ dieInstanceId: a.id, hardness: 1_080 });
    expect(await row(a.id)).toMatchObject({ status: "available", hardness: 1_080 });
    expect(await audits(a.id, "nitriding.back")).toHaveLength(1);
    await expect(p.dieRoom.dieInstance.nitridingBack({ dieInstanceId: a.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("close = open - used is enforced (throws, never clamps)", async () => {
    const p = await plant();
    const a = await copy(p);
    await expect(
      p.dieRoom.dieInstance.nitridingOut({ dieInstanceId: a.id, cr2: { openG: 1_000, usedG: 400, closeG: 700 } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await row(a.id)).status).toBe("available");
  });

  test("refused from in_use, at_maker, retired and while an issue is open; no log written", async () => {
    const p = await plant();
    for (const status of ["in_use", "at_maker", "retired"] as const) {
      const a = await copy(p);
      await setStatus(a.id, status);
      await expect(p.dieRoom.dieInstance.nitridingOut({ dieInstanceId: a.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(await env.db.select().from(nitridingLog).where(eq(nitridingLog.dieInstanceId, a.id))).toEqual([]);
    }
    const b = await copy(p);
    env.beforeNextBatch(() => setStatus(b.id, "in_use"));
    await expect(p.dieRoom.dieInstance.nitridingOut({ dieInstanceId: b.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await env.db.select().from(nitridingLog).where(eq(nitridingLog.dieInstanceId, b.id))).toEqual([]);
  });

  test("optional store draw: used grams leave the store as an MRS in the same batch; short stock refuses all of it", async () => {
    const p = await plant();
    const storeLoc = crypto.randomUUID();
    await env.db.insert(location).values({ id: storeLoc, companyId: p.companyId, code: "STORE", name: "Store", kind: "store" } as typeof location.$inferInsert);
    const itemId = crypto.randomUUID();
    await env.db.insert(storeItem).values({ id: itemId, companyId: p.companyId, name: "CR4", nameKey: "cr4", unit: "kg" });
    await p.as("storekeeper").store.receive({ itemId, qtyMilli: 2_000, grnRef: "CH-1" });

    const a = await copy(p);
    // 2.5 kg used, only 2 kg in the store: nothing lands.
    await expect(
      p.dieRoom.dieInstance.nitridingOut({ dieInstanceId: a.id, cr4: { openG: 3_000, usedG: 2_500, closeG: 500, storeItemId: itemId } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect((await row(a.id)).status).toBe("available");
    expect(await env.db.select().from(nitridingLog).where(eq(nitridingLog.dieInstanceId, a.id))).toEqual([]);

    const out = await p.dieRoom.dieInstance.nitridingOut({
      dieInstanceId: a.id,
      cr4: { openG: 3_000, usedG: 1_200, closeG: 1_800, storeItemId: itemId },
    });
    expect(out.storeTxnIds).toHaveLength(1);
    const [txn] = await env.db.select().from(storeTxn).where(eq(storeTxn.id, out.storeTxnIds[0]!));
    expect(txn).toMatchObject({ kind: "mrs", qtyMilli: 1_200, purpose: "nitriding", sourceType: "nitriding", sourceId: out.id });
    const [log] = await env.db.select().from(nitridingLog).where(eq(nitridingLog.id, out.id));
    expect(log!.storeTxnId).toBe(out.storeTxnIds[0]!);
  });
});

describe("tier change and band lift (FP-DR-10)", () => {
  async function lifted(p: Plant) {
    const { id: heavy } = await p.manager.die.bands.create({ sectionId: p.sectionId, wallTenthMm: 14, weightMinG: 6_200, weightMaxG: 6_600, label: "6.2-6.6" });
    const a = await copy(p, { tierRank: 1 });
    return { heavy, a };
  }

  test("lift: pending until a manager approves; then band, rank and tier_since change, the code does not", async () => {
    const p = await plant();
    const { heavy, a } = await lifted(p);
    const { tierChangeId, approvalId } = await p.dieRoom.dieInstance.proposeTier({ dieInstanceId: a.id, lift: true, toBandId: heavy, rank: 2, reason: "6.480 above band" });
    expect(await row(a.id)).toMatchObject({ bandId: null, tierRank: 1 });
    const [tc] = await env.db.select().from(dieTierChange).where(eq(dieTierChange.id, tierChangeId));
    expect(tc).toMatchObject({ status: "pending", isLift: true, fromBandId: null, toBandId: heavy, fromRank: 1, toRank: 2 });

    // The requester cannot approve; die room cannot approve at all.
    await expect(p.dieRoom.approval.decide({ id: approvalId, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.manager.approval.decide({ id: approvalId, decision: "approved" });
    const after = await row(a.id);
    expect(after).toMatchObject({ bandId: heavy, tierRank: 2, code: a.code, seqNo: a.seqNo });
    expect(after.tierSince).toBeInstanceOf(Date);

    // "Lifted to 6.2-6.6 on {date}" on the old (primary) band; the copy now sits on the heavy band.
    const section = await p.manager.die.get({ id: p.sectionId });
    const primary = section.bands.find((b) => b.primary)!;
    expect(primary.copyIds).not.toContain(a.id);
    expect(primary.liftedOut).toEqual([{ dieInstanceId: a.id, code: a.code, toBandId: heavy, toBand: "6.2-6.6", toWeightMinG: 6_200, toWeightMaxG: 6_600, at: expect.any(Date) }]);
    expect(section.bands.find((b) => b.id === heavy)!.copyIds).toEqual([a.id]);

    // Back to primary is toBandId null with lift.
    const back = await p.dieRoom.dieInstance.proposeTier({ dieInstanceId: a.id, lift: true, toBandId: null, reason: "re-cut" });
    await p.admin.approval.decide({ id: back.approvalId, decision: "approved" });
    expect(await row(a.id)).toMatchObject({ bandId: null, tierRank: 2 });
  });

  test("reject leaves the copy on the old band at the old rank", async () => {
    const p = await plant();
    const { heavy, a } = await lifted(p);
    const { approvalId } = await p.dieRoom.dieInstance.proposeTier({ dieInstanceId: a.id, lift: true, toBandId: heavy, reason: "x" });
    await p.manager.approval.decide({ id: approvalId, decision: "rejected" });
    expect(await row(a.id)).toMatchObject({ bandId: null, tierRank: 1 });
  });

  test("one pending proposal per copy (rank or lift); the lift target must be an active band of this section", async () => {
    const p = await plant();
    const { heavy, a } = await lifted(p);
    await p.dieRoom.dieInstance.proposeTier({ dieInstanceId: a.id, rank: 3, reason: "worn" });
    await expect(p.dieRoom.dieInstance.proposeTier({ dieInstanceId: a.id, lift: true, toBandId: heavy, reason: "x" })).rejects.toMatchObject({ code: "CONFLICT" });

    const b = await copy(p, { tierRank: 2 });
    const other = await env.seedDie(p.companyId, { sectionCode: "4521" });
    const { id: foreignBand } = await p.manager.die.bands.create({ sectionId: other, wallTenthMm: 10, weightMinG: 12_000, weightMaxG: 14_000 });
    await expect(p.dieRoom.dieInstance.proposeTier({ dieInstanceId: b.id, lift: true, toBandId: foreignBand, reason: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.dieRoom.dieInstance.proposeTier({ dieInstanceId: b.id, lift: true, toBandId: b.id, reason: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Lifting to the band it is already on, or a band without lift, is refused.
    await expect(p.dieRoom.dieInstance.proposeTier({ dieInstanceId: b.id, lift: true, toBandId: null, reason: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.dieRoom.dieInstance.proposeTier({ dieInstanceId: b.id, rank: 3, toBandId: heavy, reason: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // A retired band is not a target.
    await p.manager.die.bands.retire({ id: heavy });
    await expect(p.dieRoom.dieInstance.proposeTier({ dieInstanceId: b.id, lift: true, toBandId: heavy, reason: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await env.db.select().from(dieTierChange).where(and(eq(dieTierChange.dieInstanceId, b.id), eq(dieTierChange.status, "pending")))).toEqual([]);
  });

  test("a reading above the band opens no proposal by itself", async () => {
    const p = await plant();
    const a = await copy(p, { tierRank: 1 });
    await p.as("press").dieInstance.addReading({ dieInstanceId: a.id, kgPer12ftMilli: 6_480 });
    expect(await env.db.select().from(dieTierChange).where(and(eq(dieTierChange.dieInstanceId, a.id), eq(dieTierChange.status, "pending")))).toEqual([]);
  });
});

describe("customer-owned die (FP-DR-12)", () => {
  async function owned() {
    const p = await plant();
    const ownerCust = await env.seedCustomer(p.companyId);
    const other = await env.seedCustomer(p.companyId);
    await p.manager.die.update(sectionInput(p, { ownerCustomerId: ownerCust }));
    const a = await copy(p);
    return { p, ownerCust, other, a };
  }

  test("owner columns are set through masters.publish; die_room cannot set an owner (section or copy)", async () => {
    const p = await plant();
    const cust = await env.seedCustomer(p.companyId);
    await expect(p.dieRoom.die.update(sectionInput(p, { ownerCustomerId: cust }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(copy(p, { ownerCustomerId: cust })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const a = await copy(p);
    await expect(p.dieRoom.dieInstance.update({ id: a.id, ownerCustomerId: cust })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Manager may give one copy of a plant section to a customer (copy-owned).
    await p.manager.dieInstance.update({ id: a.id, ownerCustomerId: cust });
    expect((await row(a.id)).ownerCustomerId).toBe(cust);
    expect(await audits(a.id, "die_owner.set")).toHaveLength(1);
    await p.manager.die.update(sectionInput(p, { ownerCustomerId: cust }));
    expect(await audits(p.sectionId, "die_owner.set")).toHaveLength(1);
  });

  test("C2: under an owned section a copy cannot be given to someone else; a section owner clash with a copy owner is refused", async () => {
    const { p, ownerCust, other, a } = await owned();
    await expect(p.manager.dieInstance.update({ id: a.id, ownerCustomerId: other })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.manager.dieInstance.update({ id: a.id, ownerCustomerId: ownerCust });
    // Null on the copy inherits the section owner: it is not an opt-out to plant-owned.
    await p.manager.dieInstance.update({ id: a.id, ownerCustomerId: null });
    expect((await p.manager.dieInstance.get({ id: a.id })).owner).toMatchObject({ customerId: ownerCust, source: "section" });
    await p.manager.dieInstance.update({ id: a.id, ownerCustomerId: ownerCust });
    await p.manager.die.update(sectionInput(p, { ownerCustomerId: null }));
    await expect(p.manager.die.update(sectionInput(p, { ownerCustomerId: other }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const card = await p.manager.dieInstance.get({ id: a.id });
    expect(card.owner).toMatchObject({ customerId: ownerCust, source: "copy" });
  });

  test("pack for another party is refused naming the owner; an approved exception allows that customer + copy until closed", async () => {
    const { p, ownerCust, other, a } = await owned();
    const packCheck = () => dieOwnerLib.assertDieAllowed(env.db, p.companyId, { dieInstanceId: a.id, customerId: other, purpose: "pack" });
    const ownerName = (await p.manager.dieInstance.get({ id: a.id })).owner!.name!;
    await expect(packCheck()).rejects.toMatchObject({ code: "FORBIDDEN", message: `This die belongs to ${ownerName}`, meta: { ownerCustomerId: ownerCust, code: a.code } });
    await expect(dieOwnerLib.assertDieAllowed(env.db, p.companyId, { dieInstanceId: a.id, customerId: ownerCust, purpose: "pack" })).resolves.toMatchObject({ ok: true });

    const packer = p.as("packer");
    const { approvalId } = await packer.dieInstance.requestOwnerOverride({ dieInstanceId: a.id, customerId: other, purpose: "pack", note: "owner agreed by phone" });
    expect(await audits(a.id, "die_owner.request")).toHaveLength(1);
    // Pending is not a grant; a second request is refused naming the requester.
    await expect(packCheck()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.as("office").dieInstance.requestOwnerOverride({ dieInstanceId: a.id, customerId: other, purpose: "plan", note: "again" })).rejects.toMatchObject({ code: "CONFLICT" });
    // Packer and die room cannot approve.
    await expect(packer.approval.decide({ id: approvalId, decision: "approved" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await p.manager.approval.decide({ id: approvalId, decision: "approved" });
    const [granted] = await env.db.select().from(approval).where(eq(approval.id, approvalId));
    expect(granted!.meta).toMatchObject({ attemptedCustomerId: other, purpose: "pack", closedAt: null, grantedAt: expect.any(Number) });
    // One grant covers every purpose for that customer and copy, and only them.
    for (const purpose of ["plan", "press", "pack", "dispatch"] as const) {
      await expect(dieOwnerLib.assertDieAllowed(env.db, p.companyId, { dieInstanceId: a.id, customerId: other, purpose })).resolves.toMatchObject({ ok: true, viaGrant: true, grantId: approvalId });
    }
    const third = await env.seedCustomer(p.companyId);
    await expect(dieOwnerLib.assertDieAllowed(env.db, p.companyId, { dieInstanceId: a.id, customerId: third, purpose: "pack" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const b = await copy(p);
    await expect(dieOwnerLib.assertDieAllowed(env.db, p.companyId, { dieInstanceId: b.id, customerId: other, purpose: "pack" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A live grant refuses a duplicate request.
    await expect(packer.dieInstance.requestOwnerOverride({ dieInstanceId: a.id, customerId: other, purpose: "pack", note: "x" })).rejects.toMatchObject({ code: "CONFLICT" });

    // Close: die room and packer cannot; manager can, once.
    await expect(p.dieRoom.dieInstance.closeOwnerOverride({ approvalId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(packer.dieInstance.closeOwnerOverride({ approvalId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.manager.dieInstance.closeOwnerOverride({ approvalId });
    await expect(packCheck()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(p.manager.dieInstance.closeOwnerOverride({ approvalId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await audits(a.id, "die_owner.close")).toHaveLength(1);
  });

  test("a rejected request grants nothing; the check is readable without throwing", async () => {
    const { p, other, a } = await owned();
    const { approvalId } = await p.as("office").dieInstance.requestOwnerOverride({ dieInstanceId: a.id, customerId: other, purpose: "plan", note: "x" });
    await p.owner.approval.decide({ id: approvalId, decision: "rejected" });
    expect(await p.as("viewer").dieInstance.ownerCheck({ dieInstanceId: a.id, customerId: other, purpose: "plan" })).toMatchObject({ ok: false, block: "owned" });
    await expect(p.manager.dieInstance.closeOwnerOverride({ approvalId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("request refusals: a section id (pick the copy), plant-owned copy, the owner itself, unknown customer", async () => {
    const { p, ownerCust, other, a } = await owned();
    const office = p.as("office");
    await expect(office.dieInstance.requestOwnerOverride({ dieInstanceId: p.sectionId, customerId: other, purpose: "plan", note: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Pick the die copy" });
    await expect(office.dieInstance.requestOwnerOverride({ dieInstanceId: a.id, customerId: ownerCust, purpose: "plan", note: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const plantSection = await env.seedDie(p.companyId, { sectionCode: "4521" });
    const plantCopy = await p.dieRoom.dieInstance.create({ sectionId: plantSection });
    await expect(office.dieInstance.requestOwnerOverride({ dieInstanceId: plantCopy.id, customerId: other, purpose: "plan", note: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const x = await plant();
    const foreignCust = await env.seedCustomer(x.companyId);
    await expect(office.dieInstance.requestOwnerOverride({ dieInstanceId: a.id, customerId: foreignCust, purpose: "plan", note: "x" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Cross-company copy: NOT_FOUND.
    const xCopy = await x.dieRoom.dieInstance.create({ sectionId: x.sectionId });
    await expect(office.dieInstance.requestOwnerOverride({ dieInstanceId: xCopy.id, customerId: other, purpose: "plan", note: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("who may ask: order.manage, order.plan, press.run, bundle.pack, dispatch.create holders", async () => {
    const { p, other, a } = await owned();
    const askers = new Set<CompanyRole>(["owner", "office", "manager", "press", "supervisor", "packer", "admin", "operator"]);
    for (const role of ROLES) {
      const attempt = p.as(role).dieInstance.requestOwnerOverride({ dieInstanceId: a.id, customerId: other, purpose: "pack", note: role });
      if (askers.has(role)) {
        const { approvalId } = await attempt;
        await env.db.delete(approval).where(eq(approval.id, approvalId));
      } else {
        await expect(attempt).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    }
  });
});

describe("permission matrix", () => {
  test("per role: card / nitriding / tier (die_room + owner), card also masters; sections, bands and owners masters only", async () => {
    const p = await plant();
    for (const role of ROLES) {
      const c = p.as(role);
      const cardRoles = ["owner", "die_room", "manager", "admin"];
      const dieRoomOnly = ["owner", "die_room"];
      const masters = ["owner", "manager", "admin"];

      const created = c.dieInstance.create({ sectionId: p.sectionId, tierRank: 1 });
      if (cardRoles.includes(role)) await created;
      else await expect(created).rejects.toMatchObject({ code: "FORBIDDEN" });

      const a = await copy(p, { tierRank: 1 });
      const out = c.dieInstance.nitridingOut({ dieInstanceId: a.id });
      if (dieRoomOnly.includes(role)) {
        await out;
        await c.dieInstance.nitridingBack({ dieInstanceId: a.id });
      } else await expect(out).rejects.toMatchObject({ code: "FORBIDDEN" });

      const tier = c.dieInstance.proposeTier({ dieInstanceId: a.id, rank: 2, reason: "x" });
      if (dieRoomOnly.includes(role)) await tier;
      else await expect(tier).rejects.toMatchObject({ code: "FORBIDDEN" });

      const band = c.die.bands.create({ sectionId: p.sectionId, wallTenthMm: 100 + ROLES.indexOf(role), weightMinG: 1, weightMaxG: 2 });
      if (masters.includes(role)) await band;
      else await expect(band).rejects.toMatchObject({ code: "FORBIDDEN" });

      // Reads are open to every member.
      await expect(c.dieInstance.get({ id: a.id })).resolves.toBeObject();
      await expect(c.die.bands.list({ sectionId: p.sectionId })).resolves.toBeObject();
      await expect(c.dieInstance.runs({ dieInstanceId: a.id })).resolves.toEqual([]);
    }
  });
});
