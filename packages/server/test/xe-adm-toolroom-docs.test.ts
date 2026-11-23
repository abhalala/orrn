/**
 * XE parity lane ADM: tool room extras (#57 #58 #59 #60 #62) and the document register (#80).
 *
 * - A die copy that failed its receive inspection cannot be issued; a later pass clears it. The guard
 *   is in the issue's own INSERT too (an inspection failed between the read and the write).
 * - Die cost per kg is shown only to the people who see money, on the card and by maker.
 * - Tooling below its minimum is flagged on Today.
 * - Documents: register CRUD, file upload refused without R2, the purge keeps document files.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { dieInstance, dieMaker, pressLine, pressRun } from "@orrn/db/schema";
import { eq } from "drizzle-orm";

import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
}, 60_000);
afterAll(async () => {
  await env.dispose();
});

let runNo = 0;
async function plant(modules?: string[]) {
  const { companyId, users } = await env.seedCompany({ settings: { dieRoom: { newCopyOnTrial: false } }, ...(modules ? { modules } : {}) });
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  const sectionId = await env.seedDie(companyId, { series: "Domal", sectionCode: `T${Math.random().toString(36).slice(2, 7)}`, weightMinG: 5_900, weightMaxG: 6_200 });
  const lineId = crypto.randomUUID();
  await env.db.insert(pressLine).values({ id: lineId, companyId, code: "P1", name: "Press 1" });
  return { companyId, users, as, sectionId, lineId, dieRoom: as("die_room"), manager: as("manager") };
}
type Plant = Awaited<ReturnType<typeof plant>>;

async function queuedRun(p: Plant) {
  const id = crypto.randomUUID();
  runNo += 1;
  await env.db.insert(pressRun).values({ id, companyId: p.companyId, number: `PR-T${runNo}`, period: "2026-27", status: "queued", sectionId: p.sectionId, pressLineId: p.lineId });
  return id;
}

describe("receive inspection (#59) and die issue", () => {
  test("a failed copy is refused at issue; a later pass lets it go", async () => {
    const p = await plant();
    const copy = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    await expect(p.dieRoom.toolRoom.inspections.record({ subjectType: "die_copy", subjectId: copy.id, result: "fail" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Say what failed" });
    await p.dieRoom.toolRoom.inspections.record({ subjectType: "die_copy", subjectId: copy.id, result: "fail", notes: "Bearing chipped" });
    const run = await queuedRun(p);
    await expect(p.dieRoom.dieInstance.issues.issue({ dieInstanceId: copy.id, pressLineId: p.lineId, pressRunId: run })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `${copy.code} failed its receive inspection; it cannot be issued until it passes`,
    });
    expect((await p.dieRoom.toolRoom.copy({ dieInstanceId: copy.id })).inspection).toBe("fail");
    await p.dieRoom.toolRoom.inspections.record({ subjectType: "die_copy", subjectId: copy.id, result: "pass", notes: "Reworked" });
    await p.dieRoom.dieInstance.issues.issue({ dieInstanceId: copy.id, pressLineId: p.lineId, pressRunId: run });
    const history = await p.as("viewer").toolRoom.inspections.list({ subjectType: "die_copy", subjectId: copy.id });
    expect(history.map((h) => h.result).sort()).toEqual(["fail", "pass"]);
  });

  test("the guard is in the issue's own INSERT: a fail written after the read still stops it", async () => {
    const p = await plant();
    const copy = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const run = await queuedRun(p);
    const { dieCopyExtra } = await import("@orrn/db/schema");
    // Simulate the race: the row says fail, but the domain pre-check is bypassed by writing after a
    // pass was read. We assert the SQL guard alone by writing fail directly and checking nothing lands.
    await env.db.insert(dieCopyExtra).values({ dieInstanceId: copy.id, companyId: p.companyId, inspection: "fail" });
    await expect(p.dieRoom.dieInstance.issues.issue({ dieInstanceId: copy.id, pressLineId: p.lineId, pressRunId: run })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [row] = await env.db.select({ status: dieInstance.status }).from(dieInstance).where(eq(dieInstance.id, copy.id));
    expect(row!.status).toBe("available");
  });

  test("review S1: a late press entry refuses a copy that failed its receive inspection", async () => {
    const p = await plant();
    const copy = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const { assertLateEntryCopy } = await import("../src/lib/press");
    await expect(assertLateEntryCopy(env.db, p.companyId, { copyId: copy.id, run: null })).resolves.toMatchObject({ id: copy.id });
    await p.dieRoom.toolRoom.inspections.record({ subjectType: "die_copy", subjectId: copy.id, result: "fail", notes: "Bearing chipped" });
    await expect(assertLateEntryCopy(env.db, p.companyId, { copyId: copy.id, run: null })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `${copy.code} failed its receive inspection; it cannot be issued until it passes`,
    });
  });

  test("permission and tenancy", async () => {
    const a = await plant();
    const b = await plant();
    const copy = await a.dieRoom.dieInstance.create({ sectionId: a.sectionId });
    await expect(a.as("packer").toolRoom.inspections.record({ subjectType: "die_copy", subjectId: copy.id, result: "pass" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(b.dieRoom.toolRoom.inspections.record({ subjectType: "die_copy", subjectId: copy.id, result: "pass" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.dieRoom.toolRoom.copy({ dieInstanceId: copy.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("the die room module gates tool room writes", async () => {
    const p = await plant(["orders"]);
    await expect(p.dieRoom.toolRoom.tooling.create({ type: "bolster", code: "B-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("tooling items (#58) and low stock (#62)", () => {
  test("a new piece waits for inspection; pass puts it in store; fail marks it; hand moves are limited", async () => {
    const p = await plant();
    const b1 = await p.dieRoom.toolRoom.tooling.create({ type: "bolster", code: "B-1", size: "250 x 120", location: "Rack 3" });
    await expect(p.dieRoom.toolRoom.tooling.create({ type: "bolster", code: " b-1 " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(p.dieRoom.toolRoom.tooling.update({ id: b1.id, status: "in_use" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.dieRoom.toolRoom.inspections.record({ subjectType: "tooling", subjectId: b1.id, result: "pass" });
    await p.dieRoom.toolRoom.tooling.update({ id: b1.id, status: "in_use", location: "P1" });
    const l1 = await p.dieRoom.toolRoom.tooling.create({ type: "liner", code: "L-1" });
    await p.dieRoom.toolRoom.inspections.record({ subjectType: "tooling", subjectId: l1.id, result: "fail", notes: "Scored bore" });
    await expect(p.dieRoom.toolRoom.tooling.update({ id: l1.id, status: "in_store" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const list = await p.as("viewer").toolRoom.tooling.list();
    expect(list.map((r) => [r.code, r.status])).toEqual([
      ["B-1", "in_use"],
      ["L-1", "failed"],
    ]);
    await expect(p.as("packer").toolRoom.tooling.create({ type: "backer", code: "K-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await plant();
    await expect(other.dieRoom.toolRoom.tooling.update({ id: b1.id, notes: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await other.dieRoom.toolRoom.tooling.list()).toEqual([]);
  });

  test("a type below its minimum shows on Today for the die room", async () => {
    const p = await plant();
    await p.dieRoom.toolRoom.tooling.create({ type: "die_ring", code: "R-1", status: "in_store" });
    await p.dieRoom.toolRoom.minStock.set({ min: { die_ring: 2, liner: 0 } });
    expect(await p.dieRoom.toolRoom.shortfalls()).toEqual([{ type: "die_ring", held: 1, min: 2 }]);
    const today = await p.dieRoom.dashboard.today();
    expect(today.toolingShort).toEqual([{ type: "die_ring", held: 1, min: 2 }]);
    expect((await p.as("packer").dashboard.today()).toolingShort).toEqual([]);
    await p.dieRoom.toolRoom.tooling.create({ type: "die_ring", code: "R-2", status: "in_use" });
    expect(await p.dieRoom.toolRoom.shortfalls()).toEqual([]);
    await expect(p.as("office").toolRoom.minStock.set({ min: {} })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await plant();
    expect(await other.dieRoom.toolRoom.shortfalls()).toEqual([]);
  });
});

describe("die category (#57) and die cost (#60)", () => {
  test("the section's category shows on the copy card; cost per kg only for the people who see money", async () => {
    const p = await plant();
    const cat = await p.manager.masters.lists.create({ kind: "die_category", name: "Hollow", expectedLifeG: 30_000_000 });
    await p.dieRoom.toolRoom.sections.setCategory({ sectionId: p.sectionId, categoryId: cat.id });
    const maker = crypto.randomUUID();
    await env.db.insert(dieMaker).values({ id: maker, companyId: p.companyId, name: "Shree Dies", nameKey: "shree dies" });
    const copy = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    await env.db.update(dieInstance).set({ dieMakerId: maker }).where(eq(dieInstance.id, copy.id));
    await expect(p.dieRoom.toolRoom.cost.set({ dieInstanceId: copy.id, costPaise: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await p.manager.toolRoom.cost.set({ dieInstanceId: copy.id, costPaise: 15_000_000 });
    await env.db.insert(pressRun).values({ id: crypto.randomUUID(), companyId: p.companyId, number: "PR-C1", period: "2026-27", status: "logged", sectionId: p.sectionId, dieInstanceId: copy.id, goodG: 12_345_678 });

    const floor = await p.dieRoom.toolRoom.copy({ dieInstanceId: copy.id });
    expect(floor).toMatchObject({ category: { name: "Hollow", expectedLifeG: 30_000_000 }, seesCost: false, costPaise: null, costPerKgPaise: null, producedG: 12_345_678 });
    const mgr = await p.manager.toolRoom.copy({ dieInstanceId: copy.id });
    expect(mgr).toMatchObject({ seesCost: true, costPaise: 15_000_000, costPerKgPaise: 1215 });
    expect(await p.manager.toolRoom.cost.byMaker()).toEqual([{ makerId: maker, makerName: "Shree Dies", copies: 1, costPaise: 15_000_000, producedG: 12_345_678, costPerKgPaise: 1215 }]);
    await expect(p.dieRoom.toolRoom.cost.byMaker()).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Money never rides on the copy rows every role reads.
    const card = await p.as("viewer").dieInstance.get({ id: copy.id });
    expect(JSON.stringify(card)).not.toContain("15000000");

    const other = await plant();
    await expect(other.manager.toolRoom.cost.set({ dieInstanceId: copy.id, costPaise: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.dieRoom.toolRoom.sections.setCategory({ sectionId: p.sectionId, categoryId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.dieRoom.toolRoom.sections.setCategory({ sectionId: other.sectionId, categoryId: cat.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await other.manager.toolRoom.cost.byMaker()).toEqual([]);
  });
});

describe("document register (#80)", () => {
  test("add, list with review due, edit, retire; files refused without storage", async () => {
    const p = await plant();
    const office = p.as("office");
    const sop = await office.docs.create({ title: "Die change SOP", kind: "procedure", version: "3", reviewOn: "2000-01-01" });
    await office.docs.create({ title: "Customer spec 6063 T6", kind: "customer_spec", reviewOn: "2999-01-01" });
    await expect(office.docs.create({ title: "Bad", kind: "drawing", reviewOn: "2026-02-30" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const list = await p.as("packer").docs.list();
    expect(list.items.map((d) => [d.title, d.reviewDue])).toEqual([
      ["Die change SOP", true],
      ["Customer spec 6063 T6", false],
    ]);
    await office.docs.update({ id: sop.id, title: "Die change SOP", kind: "procedure", version: "4", reviewOn: null, active: false });
    expect((await office.docs.list()).items.map((d) => d.title)).toEqual(["Customer spec 6063 T6"]);
    await expect(office.docs.files.beginUpload({ documentId: sop.id, kind: "pdf", name: "sop.pdf", size: 1000, mime: "application/pdf" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(office.docs.files.url({ documentId: sop.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("permission and tenancy", async () => {
    const a = await plant();
    const b = await plant();
    await expect(a.as("packer").docs.create({ title: "X", kind: "other" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const doc = await a.as("manager").docs.create({ title: "ISO 9001 manual", kind: "procedure" });
    await expect(b.as("manager").docs.update({ id: doc.id, title: "Mine", kind: "other" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(b.as("manager").docs.files.url({ documentId: doc.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await b.as("manager").docs.list()).items).toEqual([]);
  });

  test("the orphan purge keeps a document's file and deletes an uncommitted one", async () => {
    const p = await plant();
    const { plantDocument } = await import("@orrn/db/schema");
    const { purgeOrphanDieFiles } = await import("../src/lib/dieFilesPurge");
    const kept = `${p.companyId}/dies/_docs/${crypto.randomUUID()}`;
    const orphan = `${p.companyId}/dies/_docs/${crypto.randomUUID()}`;
    await env.db.insert(plantDocument).values({ id: crypto.randomUUID(), companyId: p.companyId, title: "Drawing", kind: "drawing", r2Key: kept });
    const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const deleted: string[] = [];
    const bucket = {
      list: async () => ({ objects: [{ key: kept, uploaded: old }, { key: orphan, uploaded: old }], truncated: false }),
      delete: async (keys: string | string[]) => {
        deleted.push(...(Array.isArray(keys) ? keys : [keys]));
      },
    };
    const out = await purgeOrphanDieFiles(env.db, { bucket });
    expect(out.deleted).toBe(1);
    expect(deleted).toEqual([orphan]);
  });
});
