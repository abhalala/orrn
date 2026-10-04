/**
 * PL-4: die instances (the physical copies, "obliques"), weight readings, nitriding logs and the
 * approved tier re-rank (spec P4/P18, digest Stage 19).
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import {
  approval,
  auditLog,
  dieInstance,
  dieTierChange,
  dieWeightReading,
  nitridingLog,
} from "@orrn/db/schema";
import { and, asc, eq } from "drizzle-orm";

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

/** A plant with one section (band 1.600-1.700 kg per 12 ft) and its users. */
async function plant(band: { min: number; max: number } = { min: 1_600, max: 1_700 }) {
  const { companyId, users } = await env.seedCompany();
  const sectionId = await env.seedDie(companyId, { series: "Domal", sectionCode: "12170", weightMinG: band.min, weightMaxG: band.max });
  const owner = env.caller({ role: "owner", companyId });
  const dieRoom = env.caller({ role: "die_room", companyId });
  const manager = env.caller({ role: "manager", companyId });
  const press = env.caller({ role: "press", companyId });
  return { companyId, users, sectionId, owner, dieRoom, manager, press };
}

type Plant = Awaited<ReturnType<typeof plant>>;

async function newCopy(p: Plant, over: Record<string, unknown> = {}) {
  return p.dieRoom.dieInstance.create({ sectionId: p.sectionId, ...over });
}

async function instanceRow(id: string) {
  const [row] = await env.db.select().from(dieInstance).where(eq(dieInstance.id, id));
  return row!;
}

describe("oblique codes", () => {
  test("auto code {sectionCode}-{n}, n next per section, per-section counters independent", async () => {
    const p = await plant();
    const other = await env.seedDie(p.companyId, { sectionCode: "OTHER" });

    const a = await newCopy(p);
    const b = await newCopy(p);
    const c = await newCopy(p);
    expect(a.code).toBe(`12170-1`);
    expect(b.code).toBe(`12170-2`);
    expect(c.code).toBe(`12170-3`);
    expect([a.seqNo, b.seqNo, c.seqNo]).toEqual([1, 2, 3]);

    const o = await p.dieRoom.dieInstance.create({ sectionId: other });
    expect(o.code).toBe("OTHER-1");
    expect(o.seqNo).toBe(1);
  });

  test("the code is permanent: update cannot change it and a retired copy keeps its number", async () => {
    const p = await plant();
    const a = await newCopy(p);
    const b = await newCopy(p);
    await p.dieRoom.dieInstance.update({ id: a.id, status: "retired", supplier: "Acme" });
    const afterRetire = await newCopy(p);
    expect(afterRetire.seqNo).toBe(3);
    expect((await instanceRow(a.id)).code).toBe(a.code);
    expect((await instanceRow(b.id)).code).toBe(b.code);
    // `code` / `sectionId` are not inputs of update: zod strips them.
    await p.dieRoom.dieInstance.update({ id: a.id, ...({ code: "HACK-9", sectionId: "x" } as object) });
    expect((await instanceRow(a.id)).code).toBe(a.code);
    expect((await instanceRow(a.id)).sectionId).toBe(p.sectionId);
  });

  test("concurrent creates get distinct, gapless numbers", async () => {
    const p = await plant();
    const made = await Promise.all(Array.from({ length: 6 }, () => newCopy(p)));
    expect(made.map((m) => m.seqNo).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(made.map((m) => m.code)).size).toBe(6);
  });

  test("a create that loses a race still takes the next number (allocated at write time)", async () => {
    const p = await plant();
    await newCopy(p);
    env.beforeNextBatch(() => newCopy(p));
    const late = await newCopy(p);
    expect(late.seqNo).toBe(3);
  });

  test("the unique index backs it up: (section, n) cannot repeat", async () => {
    const p = await plant();
    const a = await newCopy(p);
    await expect(
      (async () => {
        await env.db.insert(dieInstance).values({
          id: crypto.randomUUID(),
          companyId: p.companyId,
          sectionId: p.sectionId,
          seqNo: a.seqNo,
          code: "dup",
        });
      })(),
    ).rejects.toThrow();
  });

  test("create validates the section: archived and deleted are refused, foreign is NOT_FOUND", async () => {
    const p = await plant();
    const archived = await env.seedDie(p.companyId, { status: "archived" });
    await expect(p.dieRoom.dieInstance.create({ sectionId: archived })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const gone = await env.seedDie(p.companyId, { deletedAt: new Date() });
    await expect(p.dieRoom.dieInstance.create({ sectionId: gone })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const other = await plant();
    await expect(p.dieRoom.dieInstance.create({ sectionId: other.sectionId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await env.db.select().from(dieInstance).where(eq(dieInstance.companyId, other.companyId))).toEqual([]);
  });

  test("die card fields are stored on create and changed by update; audit rows written", async () => {
    const p = await plant();
    const a = await newCopy(p, {
      supplier: "Hindalco Tools",
      trialKgPer12ftMilli: 1_650,
      hardness: 1_050,
      lifeG: 30_000_000,
      ftr: "ok",
      status: "in_use",
      notes: "first copy",
    });
    expect(await instanceRow(a.id)).toMatchObject({
      supplier: "Hindalco Tools",
      trialKgPer12ftMilli: 1_650,
      hardness: 1_050,
      lifeG: 30_000_000,
      ftr: "ok",
      status: "in_use",
      tierRank: null,
      createdBy: p.users.die_room.id,
    });
    const before = await instanceRow(a.id);
    await p.dieRoom.dieInstance.update({ id: a.id, hardness: 1_100, ftr: null, status: "at_nitriding" });
    const after = await instanceRow(a.id);
    expect(after).toMatchObject({ hardness: 1_100, ftr: null, status: "at_nitriding", supplier: "Hindalco Tools" });
    expect(after.serverSeq).toBeGreaterThan(before.serverSeq);

    const audits = await env.db.select().from(auditLog).where(eq(auditLog.subjectId, a.id));
    expect(audits.map((r) => r.action).sort()).toEqual(["die_instance.create", "die_instance.update"]);
    expect(audits.every((r) => r.companyId === p.companyId)).toBe(true);
  });

  test("a tier given at creation is the first, already-applied history row", async () => {
    const p = await plant();
    const a = await newCopy(p, { tierRank: 1 });
    expect(await instanceRow(a.id)).toMatchObject({ tierRank: 1 });
    expect((await instanceRow(a.id)).tierSince).toBeInstanceOf(Date);
    const hist = await env.db.select().from(dieTierChange).where(eq(dieTierChange.dieInstanceId, a.id));
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ fromRank: null, toRank: 1, status: "applied", approvalId: null });
    // No approval was needed for the first placement.
    expect(await env.db.select().from(approval).where(eq(approval.companyId, p.companyId))).toEqual([]);
  });

  test("list filters by section and status, pages, and is tenant scoped", async () => {
    const p = await plant();
    const other = await env.seedDie(p.companyId);
    const a = await newCopy(p, { status: "in_use" });
    await newCopy(p);
    await p.dieRoom.dieInstance.create({ sectionId: other });
    const x = await plant();
    await x.dieRoom.dieInstance.create({ sectionId: x.sectionId });

    const all = await p.owner.dieInstance.list({});
    expect(all.total).toBe(3);
    expect(all.items.every((i) => i.companyId === p.companyId)).toBe(true);
    const bySection = await p.owner.dieInstance.list({ sectionId: p.sectionId });
    expect(bySection.total).toBe(2);
    expect(bySection.items.map((i) => i.seqNo)).toEqual([1, 2]);
    const inUse = await p.owner.dieInstance.list({ status: "in_use" });
    expect(inUse.items.map((i) => i.id)).toEqual([a.id]);
    const page = await p.owner.dieInstance.list({ limit: 2, offset: 0 });
    expect(page.items).toHaveLength(2);
    expect(page.nextOffset).toBe(2);
    expect((await p.owner.dieInstance.list({ limit: 2, offset: 2 })).nextOffset).toBeNull();
  });
});

describe("weight readings", () => {
  test("first reading has no last; each next stores the previous reading as last", async () => {
    const p = await plant();
    const a = await newCopy(p);
    const r1 = await p.press.dieInstance.addReading({ dieInstanceId: a.id, kgPer12ftMilli: 1_650 });
    const r2 = await p.press.dieInstance.addReading({ dieInstanceId: a.id, kgPer12ftMilli: 1_662, pressRunId: "run-7" });
    const r3 = await p.press.dieInstance.addReading({ dieInstanceId: a.id, kgPer12ftMilli: 1_671 });
    expect(r1.lastKgPer12ftMilli).toBeNull();
    expect(r2.lastKgPer12ftMilli).toBe(1_650);
    expect(r3.lastKgPer12ftMilli).toBe(1_662);

    const rows = await env.db
      .select()
      .from(dieWeightReading)
      .where(eq(dieWeightReading.dieInstanceId, a.id))
      .orderBy(asc(dieWeightReading.readAt));
    expect(rows.map((r) => [r.kgPer12ftMilli, r.lastKgPer12ftMilli])).toEqual([
      [1_650, null],
      [1_662, 1_650],
      [1_671, 1_662],
    ]);
    expect(rows[1]).toMatchObject({ pressRunId: "run-7", createdBy: p.users.press.id, companyId: p.companyId });
    expect(new Set(rows.map((r) => r.readAt.getTime())).size).toBe(3);
  });

  test("another copy's readings do not leak into last", async () => {
    const p = await plant();
    const a = await newCopy(p);
    const b = await newCopy(p);
    await p.press.dieInstance.addReading({ dieInstanceId: a.id, kgPer12ftMilli: 1_600 });
    const rb = await p.press.dieInstance.addReading({ dieInstanceId: b.id, kgPer12ftMilli: 1_700 });
    expect(rb.lastKgPer12ftMilli).toBeNull();
  });

  test("race: a reading that lands between read and write becomes the previous one", async () => {
    const p = await plant();
    const a = await newCopy(p);
    await p.press.dieInstance.addReading({ dieInstanceId: a.id, kgPer12ftMilli: 1_640 });
    env.beforeNextBatch(() => p.press.dieInstance.addReading({ dieInstanceId: a.id, kgPer12ftMilli: 1_655 }));
    const late = await p.press.dieInstance.addReading({ dieInstanceId: a.id, kgPer12ftMilli: 1_660 });
    expect(late.lastKgPer12ftMilli).toBe(1_655);
    const rows = await env.db.select().from(dieWeightReading).where(eq(dieWeightReading.dieInstanceId, a.id));
    const ordered = rows.sort((x, y) => x.readAt.getTime() - y.readAt.getTime());
    expect(ordered.map((r) => r.kgPer12ftMilli)).toEqual([1_640, 1_655, 1_660]);
  });

  test("a retired copy takes no readings; a copy retired mid-request leaves no row", async () => {
    const p = await plant();
    const a = await newCopy(p);
    await p.dieRoom.dieInstance.update({ id: a.id, status: "retired" });
    await expect(p.press.dieInstance.addReading({ dieInstanceId: a.id, kgPer12ftMilli: 1_650 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const b = await newCopy(p);
    env.beforeNextBatch(() => p.dieRoom.dieInstance.update({ id: b.id, status: "retired" }));
    await expect(p.press.dieInstance.addReading({ dieInstanceId: b.id, kgPer12ftMilli: 1_650 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(await env.db.select().from(dieWeightReading).where(eq(dieWeightReading.companyId, p.companyId))).toEqual([]);
    const audits = await env.db.select().from(auditLog).where(eq(auditLog.action, "die_reading.add"));
    expect(audits.filter((r) => r.companyId === p.companyId)).toEqual([]);
  });

  test("validates the value", async () => {
    const p = await plant();
    const a = await newCopy(p);
    for (const bad of [0, -5, 1.5, 600_000]) {
      await expect(p.press.dieInstance.addReading({ dieInstanceId: a.id, kgPer12ftMilli: bad })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    }
  });
});

describe("nitriding log", () => {
  test("stores date, hardness and the four chemicals; close = open - used is enforced", async () => {
    const p = await plant();
    const a = await newCopy(p);
    const at = Date.UTC(2026, 8, 20, 6, 0, 0);
    const { id } = await p.dieRoom.dieInstance.addNitriding({
      dieInstanceId: a.id,
      nitridedAt: at,
      hardness: 1_020,
      cr4: { openG: 5_000, usedG: 800, closeG: 4_200 },
      cr2: { openG: 3_000, usedG: 0, closeG: 3_000 },
      k2s: { openG: 2_000, usedG: 150, closeG: 1_850 },
      caustic: { openG: 10_000, usedG: 1_000, closeG: 9_000 },
      notes: "batch 12",
    });
    const [row] = await env.db.select().from(nitridingLog).where(eq(nitridingLog.id, id));
    expect(row).toMatchObject({
      companyId: p.companyId,
      dieInstanceId: a.id,
      hardness: 1_020,
      cr4OpenG: 5_000,
      cr4UsedG: 800,
      cr4CloseG: 4_200,
      cr2CloseG: 3_000,
      k2sUsedG: 150,
      causticCloseG: 9_000,
      storeTxnId: null,
      notes: "batch 12",
      signedBy: p.users.die_room.id,
      createdBy: p.users.die_room.id,
    });
    expect(row!.nitridedAt.getTime()).toBe(at);

    const bad = (chem: object) => p.dieRoom.dieInstance.addNitriding({ dieInstanceId: a.id, ...chem });
    await expect(bad({ cr4: { openG: 5_000, usedG: 800, closeG: 4_300 } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(bad({ k2s: { openG: 100, usedG: 200, closeG: -100 } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(bad({ caustic: { openG: 100, usedG: 20 } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await env.db.select().from(nitridingLog).where(eq(nitridingLog.dieInstanceId, a.id))).toHaveLength(1);
  });

  test("chemicals are optional; the date defaults to now; the future is refused; retired is refused", async () => {
    const p = await plant();
    const a = await newCopy(p);
    setClock(new Date(Date.UTC(2026, 9, 3, 5, 0, 0)));
    const { id } = await p.dieRoom.dieInstance.addNitriding({ dieInstanceId: a.id, hardness: 990 });
    const [row] = await env.db.select().from(nitridingLog).where(eq(nitridingLog.id, id));
    expect(row!.nitridedAt.getTime()).toBe(Date.UTC(2026, 9, 3, 5, 0, 0));
    expect(row).toMatchObject({ cr4OpenG: null, causticCloseG: null });
    await expect(
      p.dieRoom.dieInstance.addNitriding({ dieInstanceId: a.id, nitridedAt: Date.UTC(2026, 9, 10) }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.dieRoom.dieInstance.update({ id: a.id, status: "retired" });
    await expect(p.dieRoom.dieInstance.addNitriding({ dieInstanceId: a.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  test("get returns the card with its latest nitriding, readings and tier history", async () => {
    const p = await plant();
    const a = await newCopy(p, { tierRank: 2 });
    await p.dieRoom.dieInstance.addNitriding({ dieInstanceId: a.id, hardness: 1_000, nitridedAt: Date.UTC(2026, 8, 1) });
    await p.dieRoom.dieInstance.addNitriding({ dieInstanceId: a.id, hardness: 1_040, nitridedAt: Date.UTC(2026, 8, 20) });
    await p.press.dieInstance.addReading({ dieInstanceId: a.id, kgPer12ftMilli: 1_650 });
    const card = await p.owner.dieInstance.get({ id: a.id });
    expect(card.instance).toMatchObject({ id: a.id, code: a.code, tierRank: 2 });
    expect(card.section).toMatchObject({ id: p.sectionId, weightMinG: 1_600, weightMaxG: 1_700 });
    expect(card.nitriding.map((n) => n.hardness)).toEqual([1_040, 1_000]);
    expect(card.readings.map((r) => r.kgPer12ftMilli)).toEqual([1_650]);
    expect(card.tierChanges).toHaveLength(1);
  });
});

describe("tier re-rank needs approval", () => {
  test("propose opens a pending approval; the rank changes only when it is approved", async () => {
    const p = await plant();
    const a = await newCopy(p, { tierRank: 1 });

    const prop = await p.dieRoom.dieInstance.proposeTier({ dieInstanceId: a.id, rank: 2, reason: "running heavy" });
    expect(await instanceRow(a.id)).toMatchObject({ tierRank: 1 });
    const [change] = await env.db.select().from(dieTierChange).where(eq(dieTierChange.id, prop.tierChangeId));
    expect(change).toMatchObject({ fromRank: 1, toRank: 2, status: "pending", reason: "running heavy", approvalId: null });
    const [appr] = await env.db.select().from(approval).where(eq(approval.id, prop.approvalId));
    expect(appr).toMatchObject({
      kind: "die_rerank",
      status: "pending",
      subjectId: prop.tierChangeId,
      companyId: p.companyId,
      requestedBy: p.users.die_room.id,
      requestNote: "running heavy",
    });
    expect(appr!.meta).toMatchObject({ dieInstanceId: a.id, fromRank: 1, toRank: 2, code: a.code });

    // Not decided yet: the rank still reads 1, also from the list and the card.
    expect((await p.owner.dieInstance.list({ sectionId: p.sectionId })).items[0]!.tierRank).toBe(1);

    const decided = await p.manager.approval.decide({ id: prop.approvalId, decision: "approved", note: "ok" });
    expect(decided.status).toBe("approved");
    const after = await instanceRow(a.id);
    expect(after.tierRank).toBe(2);
    expect(after.tierSince).toBeInstanceOf(Date);
    const [applied] = await env.db.select().from(dieTierChange).where(eq(dieTierChange.id, prop.tierChangeId));
    expect(applied).toMatchObject({ status: "applied", approvalId: prop.approvalId });
    expect(applied!.effectiveAt).toBeInstanceOf(Date);
    expect(after.serverSeq).toBe(applied!.serverSeq);

    const audits = await env.db.select().from(auditLog).where(eq(auditLog.subjectId, prop.approvalId));
    expect(audits.map((r) => r.action)).toEqual(["approval.approved"]);

    // The dated history now reads 1 (initial) then 2.
    const hist = await env.db
      .select()
      .from(dieTierChange)
      .where(eq(dieTierChange.dieInstanceId, a.id))
      .orderBy(asc(dieTierChange.createdAt), asc(dieTierChange.serverSeq));
    expect(hist.map((h) => [h.fromRank, h.toRank, h.status])).toEqual([
      [null, 1, "applied"],
      [1, 2, "applied"],
    ]);
  });

  test("a rejection leaves the rank alone and frees the copy for a new proposal", async () => {
    const p = await plant();
    const a = await newCopy(p, { tierRank: 1 });
    const prop = await p.dieRoom.dieInstance.proposeTier({ dieInstanceId: a.id, rank: 3, reason: "worn" });
    await p.manager.approval.decide({ id: prop.approvalId, decision: "rejected", note: "not yet" });
    expect(await instanceRow(a.id)).toMatchObject({ tierRank: 1 });
    const [change] = await env.db.select().from(dieTierChange).where(eq(dieTierChange.id, prop.tierChangeId));
    expect(change).toMatchObject({ status: "rejected", approvalId: prop.approvalId });
    expect(change!.effectiveAt).toBeNull();

    const again = await p.dieRoom.dieInstance.proposeTier({ dieInstanceId: a.id, rank: 3, reason: "worn, remeasured" });
    await p.owner.approval.decide({ id: again.approvalId, decision: "approved" });
    expect((await instanceRow(a.id)).tierRank).toBe(3);
  });

  test("an unranked copy can be proposed a first tier; the same tier or a second open proposal is refused", async () => {
    const p = await plant();
    const a = await newCopy(p);
    const prop = await p.dieRoom.dieInstance.proposeTier({ dieInstanceId: a.id, rank: 1, reason: "new die" });
    expect((await env.db.select().from(dieTierChange).where(eq(dieTierChange.id, prop.tierChangeId)))[0]!.fromRank).toBeNull();
    await expect(
      p.dieRoom.dieInstance.proposeTier({ dieInstanceId: a.id, rank: 2, reason: "again" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await p.manager.approval.decide({ id: prop.approvalId, decision: "approved" });
    await expect(
      p.dieRoom.dieInstance.proposeTier({ dieInstanceId: a.id, rank: 1, reason: "same" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const rows = await env.db.select().from(dieTierChange).where(eq(dieTierChange.dieInstanceId, a.id));
    expect(rows).toHaveLength(1);
  });

  test("two proposals racing for one copy: one wins, the other is CONFLICT, nothing dangles", async () => {
    const p = await plant();
    const a = await newCopy(p, { tierRank: 1 });
    env.beforeNextBatch(() => p.dieRoom.dieInstance.proposeTier({ dieInstanceId: a.id, rank: 2, reason: "first" }));
    await expect(
      p.dieRoom.dieInstance.proposeTier({ dieInstanceId: a.id, rank: 3, reason: "second" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const changes = await env.db.select().from(dieTierChange).where(eq(dieTierChange.dieInstanceId, a.id));
    expect(changes.filter((c) => c.status === "pending")).toHaveLength(1);
    const approvals = await env.db.select().from(approval).where(eq(approval.companyId, p.companyId));
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.subjectId).toBe(changes.find((c) => c.status === "pending")!.id);
  });

  test("two approvers racing apply the tier once", async () => {
    const p = await plant();
    const a = await newCopy(p, { tierRank: 1 });
    const prop = await p.dieRoom.dieInstance.proposeTier({ dieInstanceId: a.id, rank: 2, reason: "heavy" });
    env.beforeNextBatch(() => p.owner.approval.decide({ id: prop.approvalId, decision: "rejected" }));
    await expect(p.manager.approval.decide({ id: prop.approvalId, decision: "approved" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    // The loser's apply statements must not have fired.
    expect(await instanceRow(a.id)).toMatchObject({ tierRank: 1 });
    const [change] = await env.db.select().from(dieTierChange).where(eq(dieTierChange.id, prop.tierChangeId));
    expect(change!.status).toBe("rejected");
  });

  test("only die.rerank holders propose; only approvers decide; nobody approves their own proposal", async () => {
    const p = await plant();
    const a = await newCopy(p, { tierRank: 1 });
    const prop = await p.dieRoom.dieInstance.proposeTier({ dieInstanceId: a.id, rank: 2, reason: "x" });
    await expect(p.dieRoom.approval.decide({ id: prop.approvalId, decision: "approved" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // The owner holds die.rerank too, but may not approve what the owner proposed.
    const b = await newCopy(p, { tierRank: 1 });
    const ownProp = await p.owner.dieInstance.proposeTier({ dieInstanceId: b.id, rank: 2, reason: "mine" });
    await expect(p.owner.approval.decide({ id: ownProp.approvalId, decision: "approved" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await p.manager.approval.decide({ id: ownProp.approvalId, decision: "approved" });
    expect((await instanceRow(b.id)).tierRank).toBe(2);
    expect((await instanceRow(a.id)).tierRank).toBe(1);
  });

  test("approval.decide on other kinds is unchanged (no apply hook, no side effects)", async () => {
    const p = await plant();
    const id = crypto.randomUUID();
    await env.db.insert(approval).values({
      id,
      companyId: p.companyId,
      kind: "dc_note",
      subjectId: crypto.randomUUID(),
      requestedBy: p.users.office.id,
    });
    await expect(p.manager.approval.decide({ id, decision: "approved" })).resolves.toMatchObject({ status: "approved" });
    expect(await env.db.select().from(dieTierChange).where(eq(dieTierChange.companyId, p.companyId))).toEqual([]);
  });

  test("a die_rerank approval whose subject is missing decides cleanly and changes nothing", async () => {
    const p = await plant();
    const a = await newCopy(p, { tierRank: 1 });
    const id = crypto.randomUUID();
    await env.db.insert(approval).values({
      id,
      companyId: p.companyId,
      kind: "die_rerank",
      subjectId: crypto.randomUUID(),
      requestedBy: p.users.die_room.id,
    });
    await expect(p.manager.approval.decide({ id, decision: "approved" })).resolves.toMatchObject({ status: "approved" });
    expect(await instanceRow(a.id)).toMatchObject({ tierRank: 1 });
  });

  test("a foreign company's tier change cannot be applied through our approval", async () => {
    const mine = await plant();
    const theirs = await plant();
    const theirCopy = await theirs.dieRoom.dieInstance.create({ sectionId: theirs.sectionId, tierRank: 1 });
    const prop = await theirs.dieRoom.dieInstance.proposeTier({ dieInstanceId: theirCopy.id, rank: 2, reason: "x" });
    // A forged approval of ours pointing at their tier change.
    const id = crypto.randomUUID();
    await env.db.insert(approval).values({
      id,
      companyId: mine.companyId,
      kind: "die_rerank",
      subjectId: prop.tierChangeId,
      requestedBy: mine.users.die_room.id,
    });
    await mine.manager.approval.decide({ id, decision: "approved" });
    expect((await instanceRow(theirCopy.id)).tierRank).toBe(1);
    const [change] = await env.db.select().from(dieTierChange).where(eq(dieTierChange.id, prop.tierChangeId));
    expect(change!.status).toBe("pending");
  });
});

describe("drift", () => {
  async function seedReadings(p: Plant, id: string, values: number[]) {
    for (const v of values) await p.press.dieInstance.addReading({ dieInstanceId: id, kgPer12ftMilli: v });
  }

  test("per copy: latest, band position, trend over the last N readings; lightest first", async () => {
    const p = await plant({ min: 1_600, max: 1_700 });
    const a = await newCopy(p, { status: "in_use", tierRank: 2 }); // heavy, rising, above band
    const b = await newCopy(p, { status: "available", tierRank: 1 }); // in band, steady
    const c = await newCopy(p, { status: "available", tierRank: 3 }); // below band, falling
    const d = await newCopy(p); // no readings
    await seedReadings(p, a.id, [1_660, 1_680, 1_700, 1_730]);
    await seedReadings(p, b.id, [1_640, 1_641, 1_640]);
    await seedReadings(p, c.id, [1_620, 1_600, 1_580]);

    const out = await p.owner.dieInstance.drift({ sectionId: p.sectionId, readings: 3 });
    expect(out.section).toMatchObject({ id: p.sectionId, weightMinG: 1_600, weightMaxG: 1_700 });
    // Lightest latest reading first, copies with no reading last.
    expect(out.items.map((i) => i.code)).toEqual([c.code, b.code, a.code, d.code]);

    const byCode = new Map(out.items.map((i) => [i.code, i]));
    expect(byCode.get(a.code)).toMatchObject({
      latest: { kgPer12ftMilli: 1_730 },
      band: "above",
      offBandMilli: 30,
      trend: "heavier",
      deltaMilli: 50, // 1,730 - 1,680: only the last 3 readings count
      tierRank: 2,
    });
    expect(byCode.get(a.code)!.recent.map((r) => r.kgPer12ftMilli)).toEqual([1_680, 1_700, 1_730]);
    expect(byCode.get(b.code)).toMatchObject({ band: "in", offBandMilli: 0, trend: "steady", deltaMilli: 0 });
    expect(byCode.get(c.code)).toMatchObject({ band: "below", offBandMilli: -20, trend: "lighter", deltaMilli: -40 });
    expect(byCode.get(d.code)).toMatchObject({ latest: null, band: null, trend: "unknown", deltaMilli: null, recent: [] });
  });

  test("suggestFirst is the lightest IN-BAND copy that is not out for nitriding or retired", async () => {
    const p = await plant({ min: 1_600, max: 1_700 });
    const below = await newCopy(p, { status: "available" });
    const lightInBand = await newCopy(p, { status: "available" });
    const away = await newCopy(p, { status: "at_nitriding" });
    const heavier = await newCopy(p, { status: "in_use" });
    const retired = await newCopy(p, { status: "retired" });
    await seedReadings(p, below.id, [1_500]);
    await seedReadings(p, away.id, [1_610]); // would win, but is out at nitriding
    await seedReadings(p, lightInBand.id, [1_640]);
    await seedReadings(p, heavier.id, [1_690]);
    // Retired copies take no readings; seed one directly to prove they are excluded anyway.
    await env.db.insert(dieWeightReading).values({
      id: crypto.randomUUID(),
      companyId: p.companyId,
      dieInstanceId: retired.id,
      kgPer12ftMilli: 1_601,
      readAt: new Date(),
    });

    const out = await p.owner.dieInstance.drift({ sectionId: p.sectionId });
    expect(out.suggestFirst).toMatchObject({ dieInstanceId: lightInBand.id, code: lightInBand.code, kgPer12ftMilli: 1_640 });
    expect(out.items.map((i) => i.dieInstanceId)).not.toContain(retired.id);
    const withRetired = await p.owner.dieInstance.drift({ sectionId: p.sectionId, includeRetired: true });
    expect(withRetired.items.map((i) => i.dieInstanceId)).toContain(retired.id);
    expect(withRetired.suggestFirst!.dieInstanceId).toBe(lightInBand.id);
  });

  test("no copy in band: no suggestion; tie on weight prefers the better tier", async () => {
    const p = await plant({ min: 1_600, max: 1_700 });
    const a = await newCopy(p, { status: "available" });
    await seedReadings(p, a.id, [1_720]);
    expect((await p.owner.dieInstance.drift({ sectionId: p.sectionId })).suggestFirst).toBeNull();

    const b = await newCopy(p, { status: "available", tierRank: 2 });
    const c = await newCopy(p, { status: "available", tierRank: 1 });
    await seedReadings(p, b.id, [1_650]);
    await seedReadings(p, c.id, [1_650]);
    expect((await p.owner.dieInstance.drift({ sectionId: p.sectionId })).suggestFirst!.dieInstanceId).toBe(c.id);
  });

  test("scales past 100 copies with readings (bound-parameter chunking)", async () => {
    const p = await plant();
    const { pushChunkedInserts } = await import("../src/lib/atomic");
    const ids = Array.from({ length: 130 }, () => crypto.randomUUID());
    const stmts: Parameters<typeof pushChunkedInserts>[0] = [];
    pushChunkedInserts(
      stmts,
      (rows) => env.db.insert(dieInstance).values(rows),
      ids.map((id, i) => ({
        id,
        companyId: p.companyId,
        serverSeq: 0,
        sectionId: p.sectionId,
        seqNo: i + 1,
        code: `X-${i + 1}`,
        supplier: null,
        trialKgPer12ftMilli: null,
        hardness: null,
        lifeG: null,
        ftr: null,
        status: "available" as const,
        tierRank: null,
        tierSince: null,
        notes: null,
        createdBy: null,
      })),
    );
    pushChunkedInserts(
      stmts,
      (rows) => env.db.insert(dieWeightReading).values(rows),
      ids.flatMap((id, i) =>
        [0, 1, 2].map((k) => ({
          id: crypto.randomUUID(),
          companyId: p.companyId,
          serverSeq: 0,
          dieInstanceId: id,
          pressRunId: null,
          kgPer12ftMilli: 1_600 + i + k,
          lastKgPer12ftMilli: null,
          readAt: new Date(1_790_000_000_000 + i * 10_000 + k * 1_000),
          createdBy: null,
        })),
      ),
    );
    const { atomicBatch } = await import("../src/lib/atomic");
    await atomicBatch(env.db, stmts);

    const out = await p.owner.dieInstance.drift({ sectionId: p.sectionId, readings: 2 });
    expect(out.items).toHaveLength(130);
    expect(out.items[0]).toMatchObject({ code: "X-1", latest: { kgPer12ftMilli: 1_602 } });
    expect(out.items[0]!.recent).toHaveLength(2);
    expect(out.suggestFirst).toMatchObject({ code: "X-1" });
    expect((await p.owner.dieInstance.list({ limit: 200 })).total).toBe(130);
  });
});

describe("permissions", () => {
  test("each action follows the matrix for all 13 roles; reads are open to every member", async () => {
    const p = await plant();
    const target = await newCopy(p);
    const cases: { action: Action | Action[] | null; name: string; run: (api: ReturnType<TestEnv["caller"]>) => Promise<unknown> }[] = [
      { action: ["die.card", "masters.publish"], name: "create", run: (api) => api.dieInstance.create({ sectionId: p.sectionId }) },
      { action: ["die.card", "masters.publish"], name: "update", run: (api) => api.dieInstance.update({ id: target.id, notes: "n" }) },
      { action: "die.card", name: "addNitriding", run: (api) => api.dieInstance.addNitriding({ dieInstanceId: target.id }) },
      { action: "die.reading", name: "addReading", run: (api) => api.dieInstance.addReading({ dieInstanceId: target.id, kgPer12ftMilli: 1_650 }) },
      { action: null, name: "list", run: (api) => api.dieInstance.list({}) },
      { action: null, name: "get", run: (api) => api.dieInstance.get({ id: target.id }) },
      { action: null, name: "drift", run: (api) => api.dieInstance.drift({ sectionId: p.sectionId }) },
    ];
    for (const role of ROLES) {
      const api = env.caller({ role, companyId: p.companyId });
      for (const c of cases) {
        const allowed =
          c.action === null || [c.action].flat().some((a) => can(role, a));
        const res = c.run(api);
        if (allowed) await expect(res).resolves.toBeDefined();
        else await expect(res).rejects.toMatchObject({ code: "FORBIDDEN" });
      }
    }
    // proposeTier is die.rerank; one proposal per copy at a time, so use a fresh copy per role.
    for (const role of ROLES) {
      const copy = await newCopy(p, { tierRank: 1 });
      const res = env.caller({ role, companyId: p.companyId }).dieInstance.proposeTier({
        dieInstanceId: copy.id,
        rank: 2,
        reason: "r",
      });
      if (can(role, "die.rerank")) await expect(res).resolves.toBeDefined();
      else await expect(res).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("RP7: manager and admin create and edit die cards; operator and press are FORBIDDEN", async () => {
    const p = await plant();
    const made = await env.caller({ role: "manager", companyId: p.companyId }).dieInstance.create({
      sectionId: p.sectionId,
      supplier: "Acme",
    });
    expect(made.code).toBe("12170-1");
    await env.caller({ role: "admin", companyId: p.companyId }).dieInstance.update({ id: made.id, hardness: 1_000 });
    expect((await instanceRow(made.id)).hardness).toBe(1_000);
    for (const role of ["operator", "press", "supervisor", "viewer"] as const) {
      const api = env.caller({ role, companyId: p.companyId });
      await expect(api.dieInstance.create({ sectionId: p.sectionId })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(api.dieInstance.update({ id: made.id, notes: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    // Nitriding and tier proposals stay with the die room.
    await expect(
      env.caller({ role: "manager", companyId: p.companyId }).dieInstance.addNitriding({ dieInstanceId: made.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      env.caller({ role: "manager", companyId: p.companyId }).dieInstance.proposeTier({ dieInstanceId: made.id, rank: 1, reason: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("the matrix itself: die room cards/nitrides/re-ranks, press and supervisor read weights", () => {
    expect(ROLES.filter((r) => can(r, "die.card"))).toEqual(["owner", "die_room"]);
    expect(ROLES.filter((r) => can(r, "die.reading"))).toEqual(["owner", "supervisor", "press", "die_room"]);
    expect(ROLES.filter((r) => can(r, "die.rerank"))).toEqual(["owner", "die_room"]);
  });

  test("signed out is UNAUTHORIZED", async () => {
    await expect(env.caller(null).dieInstance.list({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("tenant isolation", () => {
  test("another company's ids are NOT_FOUND everywhere and nothing is written", async () => {
    const mine = await plant();
    const theirs = await plant();
    const theirCopy = await theirs.dieRoom.dieInstance.create({ sectionId: theirs.sectionId, tierRank: 1 });
    const before = await instanceRow(theirCopy.id);

    await expect(mine.dieRoom.dieInstance.get({ id: theirCopy.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(mine.dieRoom.dieInstance.update({ id: theirCopy.id, notes: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      mine.press.dieInstance.addReading({ dieInstanceId: theirCopy.id, kgPer12ftMilli: 1_650 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(mine.dieRoom.dieInstance.addNitriding({ dieInstanceId: theirCopy.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      mine.dieRoom.dieInstance.proposeTier({ dieInstanceId: theirCopy.id, rank: 2, reason: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(mine.owner.dieInstance.drift({ sectionId: theirs.sectionId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await mine.owner.dieInstance.list({ sectionId: theirs.sectionId })).items).toEqual([]);
    expect((await mine.owner.dieInstance.list({})).items).toEqual([]);

    expect(await instanceRow(theirCopy.id)).toEqual(before);
    expect(await env.db.select().from(dieWeightReading).where(eq(dieWeightReading.companyId, theirs.companyId))).toEqual([]);
    expect(await env.db.select().from(nitridingLog).where(eq(nitridingLog.companyId, theirs.companyId))).toEqual([]);
    expect(await env.db.select().from(dieTierChange).where(and(eq(dieTierChange.companyId, mine.companyId)))).toEqual([]);
  });
});
