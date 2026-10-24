/**
 * Die room masters: sections with alloy / temper defaults and owner (FP-DR-01/12/14), several bands
 * and the duplicate guard (FP-DR-02/03), kg/m import (FP-DR-02 rule 4), die files in R2 with signed
 * GETs and the press drawing (FP-DR-07/13), and the dev seed's die room demo.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, die, dieBand, dieFile, dieInstance, dieIssue, dieTierChange, dieWeightReading } from "@orrn/db/schema";
import { and, eq } from "drizzle-orm";

import { workersEnv } from "./env-mock";
import { createTestEnv, type CompanyRole, type TestEnv } from "./harness";

let env: TestEnv;
let files: typeof import("../src/lib/dieFiles");

/** In-memory stand-in for the R2 binding (put / get / delete). */
class FakeR2 {
  objects = new Map<string, { body: Uint8Array; httpMetadata?: Record<string, string> }>();
  async put(key: string, value: Uint8Array, opts?: { httpMetadata?: Record<string, string> }) {
    this.objects.set(key, { body: value, httpMetadata: opts?.httpMetadata });
    return { key };
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}
let r2: FakeR2;

beforeAll(async () => {
  env = await createTestEnv();
  files = await import("../src/lib/dieFiles");
});

afterEach(() => {
  r2 = new FakeR2();
  workersEnv.DIE_FILES = r2;
});

afterAll(async () => {
  delete workersEnv.DIE_FILES;
  await env.dispose();
});

const ROLES: CompanyRole[] = [
  "owner", "admin", "manager", "office", "accountant", "supervisor", "packer",
  "foundry", "press", "storekeeper", "die_room", "operator", "viewer",
];

async function plant(settings: Record<string, unknown> = {}) {
  r2 ??= new FakeR2();
  workersEnv.DIE_FILES = r2;
  const { companyId, users } = await env.seedCompany({ settings });
  const sectionId = await env.seedDie(companyId, { series: "Domal", sectionCode: "12170", weightMinG: 5_900, weightMaxG: 6_200, wallTenthMm: 12 });
  const as = (role: CompanyRole) => env.caller({ role, companyId });
  return { companyId, users, sectionId, as, manager: as("manager"), dieRoom: as("die_room"), viewer: as("viewer") };
}
type Plant = Awaited<ReturnType<typeof plant>>;

const base = { series: "Domal", dimensions: {}, weightMinG: 5_900, weightMaxG: 6_200 };
const b64 = (bytes: number, fill = 7) => Buffer.from(new Uint8Array(bytes).fill(fill)).toString("base64");

describe("sections (FP-DR-01/12/14)", () => {
  test("alloy and temper default from the plant settings; explicit values and null are kept", async () => {
    const p = await plant();
    const { id: a } = await p.manager.die.create({ ...base, sectionCode: "A1" });
    const { id: b } = await p.manager.die.create({ ...base, sectionCode: "B1", alloy: "6061", temper: null, profileKind: "hollow", cavityCount: 2, wallTenthMm: 12 });
    const q = await plant({ defaultAlloy: "6005", defaultTemper: "T5" });
    const { id: c } = await q.manager.die.create({ ...base, sectionCode: "C1" });
    const rows = await env.db.select().from(die).where(eq(die.companyId, p.companyId));
    expect(rows.find((r) => r.id === a)).toMatchObject({ alloy: "6063", temper: "T6", profileKind: null });
    expect(rows.find((r) => r.id === b)).toMatchObject({ alloy: "6061", temper: null, profileKind: "hollow", cavityCount: 2, wallTenthMm: 12 });
    expect((await env.db.select().from(die).where(eq(die.id, c)))[0]).toMatchObject({ alloy: "6005", temper: "T5" });
    // Update leaves the die room columns alone when omitted.
    await p.manager.die.update({ ...base, id: b, sectionCode: "B1", name: "renamed" });
    expect((await env.db.select().from(die).where(eq(die.id, b)))[0]).toMatchObject({ alloy: "6061", profileKind: "hollow", cavityCount: 2 });
  });

  test("owner must be a live customer of this plant; setting and clearing are audited", async () => {
    const p = await plant();
    const x = await plant();
    const foreign = await env.seedCustomer(x.companyId);
    await expect(p.manager.die.update({ ...base, id: p.sectionId, sectionCode: "12170", ownerCustomerId: foreign })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const cust = await env.seedCustomer(p.companyId);
    await p.manager.die.update({ ...base, id: p.sectionId, sectionCode: "12170", ownerCustomerId: cust });
    await p.manager.die.update({ ...base, id: p.sectionId, sectionCode: "12170", ownerCustomerId: null });
    const rows = await env.db.select().from(auditLog).where(and(eq(auditLog.subjectId, p.sectionId), eq(auditLog.action, "die_owner.set")));
    expect(rows.map((r) => r.meta)).toEqual([
      expect.objectContaining({ from: null, to: cust }),
      expect.objectContaining({ from: cust, to: null }),
    ]);
    const card = await p.viewer.die.get({ id: p.sectionId });
    expect(card).toMatchObject({ ownerCustomerId: null, ownerName: null, wallTenthMmEffective: 12, primaryKgPerMetre: { min: 1.613, max: 1.695 } });
  });
});

describe("bands and the duplicate guard (FP-DR-02/03)", () => {
  test("a second band with the same wall, min and max is CONFLICT naming the existing band; the primary band counts", async () => {
    const p = await plant();
    const primaryClash = await p.manager.die.bands
      .create({ sectionId: p.sectionId, wallTenthMm: 12, weightMinG: 5_900, weightMaxG: 6_200 })
      .catch((e: unknown) => e as { code: string; meta: Record<string, unknown> });
    expect(primaryClash).toMatchObject({ code: "CONFLICT" });
    expect(primaryClash.meta).toEqual({ existing: { sectionCode: "12170", series: "Domal", wallTenthMm: 12, weightMinG: 5_900, weightMaxG: 6_200, bandId: "primary" } });

    const { id: heavy } = await p.manager.die.bands.create({ sectionId: p.sectionId, wallTenthMm: 14, weightMinG: 6_200, weightMaxG: 6_600, label: "6.2-6.6" });
    const dup = await p.manager.die.bands
      .create({ sectionId: p.sectionId, wallTenthMm: 14, weightMinG: 6_200, weightMaxG: 6_600 })
      .catch((e: unknown) => e as { code: string; meta: { existing: Record<string, unknown> } });
    expect(dup).toMatchObject({ code: "CONFLICT", meta: { existing: { bandId: heavy, wallTenthMm: 14 } } });
    // Another wall or another range is a different band.
    await p.manager.die.bands.create({ sectionId: p.sectionId, wallTenthMm: 15, weightMinG: 6_200, weightMaxG: 6_600 });
    expect((await p.viewer.die.bands.list({ sectionId: p.sectionId })).bands).toHaveLength(2);
    expect(await env.db.select().from(auditLog).where(and(eq(auditLog.subjectId, heavy), eq(auditLog.action, "die_band.create")))).toHaveLength(1);

    // Editing a band onto another one, or the section's primary band onto a band, is the same conflict.
    const { id: third } = await p.manager.die.bands.create({ sectionId: p.sectionId, wallTenthMm: 16, weightMinG: 6_600, weightMaxG: 7_000 });
    await expect(p.manager.die.bands.update({ id: third, wallTenthMm: 14, weightMinG: 6_200, weightMaxG: 6_600 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p.manager.die.update({ ...base, id: p.sectionId, sectionCode: "12170", weightMinG: 6_200, weightMaxG: 6_600, wallTenthMm: 14 })).rejects.toMatchObject({ code: "CONFLICT", meta: { existing: { bandId: heavy } } });
    await expect(p.manager.die.bands.create({ sectionId: p.sectionId, wallTenthMm: 1, weightMinG: 7_000, weightMaxG: 6_000 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("a second copy on an existing band is always allowed (the add the buyer could not complete)", async () => {
    const p = await plant();
    const { id: heavy } = await p.manager.die.bands.create({ sectionId: p.sectionId, wallTenthMm: 14, weightMinG: 6_200, weightMaxG: 6_600 });
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId, bandId: heavy });
    const b = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId, bandId: heavy });
    const c = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    expect([a.code, b.code, c.code]).toEqual(["12170-1", "12170-2", "12170-3"]);
    const section = await p.viewer.die.get({ id: p.sectionId });
    expect(section.bands.find((x) => x.id === heavy)!.copyIds).toEqual([a.id, b.id]);
    expect(section.bands.find((x) => x.primary)!.copyIds).toEqual([c.id]);
    // A band of another section is not a choice.
    const other = await env.seedDie(p.companyId, { sectionCode: "4521" });
    const { id: foreign } = await p.manager.die.bands.create({ sectionId: other, wallTenthMm: 10, weightMinG: 12_000, weightMaxG: 14_000 });
    await expect(p.dieRoom.dieInstance.create({ sectionId: p.sectionId, bandId: foreign })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  test("retire: refused while a live copy is on the band or a lift to it waits; afterwards the slot is free again", async () => {
    const p = await plant();
    const { id: heavy } = await p.manager.die.bands.create({ sectionId: p.sectionId, wallTenthMm: 14, weightMinG: 6_200, weightMaxG: 6_600 });
    const a = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId, bandId: heavy });
    await expect(p.manager.die.bands.retire({ id: heavy })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await p.dieRoom.dieInstance.update({ id: a.id, status: "retired" });
    const b = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId, tierRank: 1 });
    await p.dieRoom.dieInstance.proposeTier({ dieInstanceId: b.id, lift: true, toBandId: heavy, reason: "x" });
    await expect(p.manager.die.bands.retire({ id: heavy })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await env.db.update(dieTierChange).set({ status: "rejected" }).where(eq(dieTierChange.toBandId, heavy));
    await p.manager.die.bands.retire({ id: heavy });
    expect((await env.db.select().from(dieBand).where(eq(dieBand.id, heavy)))[0]!.active).toBe(false);
    // Retired bands do not hold the key.
    await p.manager.die.bands.create({ sectionId: p.sectionId, wallTenthMm: 14, weightMinG: 6_200, weightMaxG: 6_600 });
    expect((await p.viewer.die.bands.list({ sectionId: p.sectionId, includeRetired: true })).bands).toHaveLength(2);
  });

  test("bands of another company are NOT_FOUND", async () => {
    const p = await plant();
    const x = await plant();
    const { id } = await x.manager.die.bands.create({ sectionId: x.sectionId, wallTenthMm: 14, weightMinG: 6_200, weightMaxG: 6_600 });
    await expect(p.manager.die.bands.retire({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.manager.die.bands.update({ id, wallTenthMm: 1, weightMinG: 1, weightMaxG: 2 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.manager.die.bands.create({ sectionId: x.sectionId, wallTenthMm: 1, weightMinG: 1, weightMaxG: 2 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("kg/m import (FP-DR-02 rule 4)", () => {
  test("kg per metre becomes grams per 12 ft (x 12 x 0.3048, nearest gram) before anything else", async () => {
    const p = await plant();
    const rows = [{ series: "SLIDING", sectionCode: "31220", dimensions: {}, weightMinKgPerM: 0.5, weightMaxKgPerM: 0.55 }];
    const check = await p.manager.die.validateImport(rows as never);
    expect(check.validRows[0]).toMatchObject({ weightMinG: 1_829, weightMaxG: 2_012 });
    await p.manager.die.processImport({ newRows: rows as never, updatedRows: [] });
    const [row] = await env.db.select().from(die).where(and(eq(die.companyId, p.companyId), eq(die.sectionCode, "31220")));
    expect(row).toMatchObject({ weightMinG: 1_829, weightMaxG: 2_012 });
    // The same weight given per 12 ft is the same section (duplicate on re-import).
    const again = await p.manager.die.validateImport([{ series: "SLIDING", sectionCode: "31220", dimensions: {}, weightMinG: 1_829, weightMaxG: 2_012 }]);
    expect(again.duplicates).toHaveLength(1);
  });
});

describe("die files and the press drawing (FP-DR-07/13)", () => {
  test("upload to R2 then the row; list; signed GET for 10 minutes; remove deletes both", async () => {
    const p = await plant();
    const copy = await p.dieRoom.dieInstance.create({ sectionId: p.sectionId });
    const photo = await p.dieRoom.dieInstance.files.add({ sectionId: p.sectionId, dieInstanceId: copy.id, kind: "image", filename: "12170-1.jpg", contentType: "image/jpeg", body: b64(1024) });
    expect(photo.key).toBe(`${p.companyId}/dies/${p.sectionId}/${photo.id}`);
    expect(r2.objects.get(photo.key)!.body.byteLength).toBe(1024);
    const [row] = await env.db.select().from(dieFile).where(eq(dieFile.id, photo.id));
    expect(row).toMatchObject({ kind: "image", bytes: 1024, dieInstanceId: copy.id, pressDrawing: false, r2Key: photo.key });
    expect(await p.viewer.dieInstance.files.list({ sectionId: p.sectionId })).toHaveLength(1);

    const signed = await p.viewer.dieInstance.files.url({ id: photo.id });
    const url = new URL(signed.url, "https://api.test");
    expect(url.pathname).toBe("/files/dies");
    expect(url.searchParams.get("key")).toBe(photo.key);
    const exp = Number(url.searchParams.get("exp"));
    expect(exp - Date.now()).toBeGreaterThan(9 * 60 * 1000);
    expect(exp - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    const sig = url.searchParams.get("sig")!;
    expect(await files.verifyDieFileUrl(photo.key, exp, sig)).toBe(true);
    // Tampered key, tampered expiry, or expired: refused.
    expect(await files.verifyDieFileUrl(`${p.companyId}/dies/${p.sectionId}/other`, exp, sig)).toBe(false);
    expect(await files.verifyDieFileUrl(photo.key, exp + 1, sig)).toBe(false);
    expect(await files.verifyDieFileUrl(photo.key, exp, sig, exp + 1)).toBe(false);

    await p.dieRoom.dieInstance.files.remove({ id: photo.id });
    expect(r2.objects.has(photo.key)).toBe(false);
    expect(await env.db.select().from(dieFile).where(eq(dieFile.id, photo.id))).toEqual([]);
    const actions = (await env.db.select().from(auditLog).where(eq(auditLog.subjectId, p.sectionId))).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["die_file.add", "die_file.remove"]));
  });

  test("one press drawing PDF per section: its key goes to die.drawing_key; a new one replaces it; removing clears it", async () => {
    const p = await plant();
    expect(await p.as("press").dieInstance.drawing({ sectionId: p.sectionId })).toEqual({ key: null, url: null, expiresAt: null });
    const first = await p.dieRoom.dieInstance.files.add({ sectionId: p.sectionId, kind: "pdf", filename: "12170.pdf", contentType: "application/pdf", body: b64(2048), pressDrawing: true });
    expect((await env.db.select().from(die).where(eq(die.id, p.sectionId)))[0]!.drawingKey).toBe(first.key);
    const second = await p.dieRoom.dieInstance.files.add({ sectionId: p.sectionId, kind: "pdf", filename: "12170-v2.pdf", contentType: "application/pdf", body: b64(2048), pressDrawing: true });
    expect((await env.db.select().from(die).where(eq(die.id, p.sectionId)))[0]!.drawingKey).toBe(second.key);
    const flags = await env.db.select({ id: dieFile.id, pd: dieFile.pressDrawing }).from(dieFile).where(eq(dieFile.sectionId, p.sectionId));
    expect(flags.filter((f) => f.pd).map((f) => f.id)).toEqual([second.id]);

    const drawing = await p.as("press").dieInstance.drawing({ sectionId: p.sectionId });
    expect(drawing.key).toBe(second.key);
    expect(drawing.url).toContain("/files/dies?");

    // Removing the old PDF leaves the drawing; removing the current one clears it.
    await p.dieRoom.dieInstance.files.remove({ id: first.id });
    expect((await env.db.select().from(die).where(eq(die.id, p.sectionId)))[0]!.drawingKey).toBe(second.key);
    await p.dieRoom.dieInstance.files.remove({ id: second.id });
    expect((await env.db.select().from(die).where(eq(die.id, p.sectionId)))[0]!.drawingKey).toBeNull();
  });

  test("limits and types: image 8 MB, PDF 25 MB; JPEG/PNG/WebP; CDR/DWG by extension; press drawing must be a PDF", async () => {
    const p = await plant();
    const add = (o: Record<string, unknown>) => p.dieRoom.dieInstance.files.add({ sectionId: p.sectionId, kind: "image", filename: "a.png", contentType: "image/png", body: b64(10), ...o } as never);
    await expect(add({ body: b64(8 * 1024 * 1024 + 1) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(add({ contentType: "image/gif" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(add({ kind: "pdf", contentType: "image/png" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(add({ kind: "pdf", contentType: "application/pdf", filename: "a.pdf", body: b64(25 * 1024 * 1024 + 1) })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(add({ kind: "dwg", filename: "a.cdr", contentType: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(add({ pressDrawing: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await add({ kind: "dwg", filename: "Hollow view.DWG", contentType: "application/octet-stream" });
    await add({ kind: "cdr", filename: "1x4.cdr", contentType: "" });
    expect(r2.objects.size).toBe(2);
  });

  test("a failed row write removes the uploaded object (no orphan bytes)", async () => {
    const p = await plant();
    const lonely = await env.seedDie(p.companyId, { sectionCode: "LONELY" });
    // The section disappears after the upload and before the row: the FK fails the batch.
    env.beforeNextBatch(() => env.db.delete(die).where(eq(die.id, lonely)));
    await expect(
      p.dieRoom.dieInstance.files.add({ sectionId: lonely, kind: "image", filename: "b.png", contentType: "image/png", body: b64(10) }),
    ).rejects.toThrow();
    expect([...r2.objects.keys()]).toEqual([]);
    expect(await env.db.select().from(dieFile).where(eq(dieFile.sectionId, lonely))).toEqual([]);
  });

  test("permissions, tenancy, and a stage without the bucket", async () => {
    const p = await plant();
    const x = await plant();
    for (const role of ROLES) {
      const attempt = p.as(role).dieInstance.files.add({ sectionId: p.sectionId, kind: "image", filename: "a.png", contentType: "image/png", body: b64(10) });
      if (["owner", "die_room", "manager", "admin"].includes(role)) await attempt;
      else await expect(attempt).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(p.as(role).dieInstance.files.list({ sectionId: p.sectionId })).resolves.toBeArray();
    }
    const xf = await x.dieRoom.dieInstance.files.add({ sectionId: x.sectionId, kind: "image", filename: "a.png", contentType: "image/png", body: b64(10) });
    await expect(p.viewer.dieInstance.files.url({ id: xf.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.dieRoom.dieInstance.files.remove({ id: xf.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.dieRoom.dieInstance.files.add({ sectionId: x.sectionId, kind: "image", filename: "a.png", contentType: "image/png", body: b64(10) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(p.viewer.dieInstance.drawing({ sectionId: x.sectionId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    // A key of another company can never be signed.
    await expect(files.signDieFileUrl({}, p.companyId, xf.key)).rejects.toMatchObject({ code: "NOT_FOUND" });

    delete workersEnv.DIE_FILES;
    await expect(p.dieRoom.dieInstance.files.add({ sectionId: p.sectionId, kind: "image", filename: "a.png", contentType: "image/png", body: b64(10) })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("dev seed: die room demo (idempotent)", () => {
  test("bands, copies with readings (one amber, one red), an owned section and one open issue survive a re-seed", async () => {
    const { user } = await import("@orrn/db/schema");
    for (const key of ["owner", "operator", "viewer", "office", "staff"]) {
      await env.db.insert(user).values({ id: `dev-user-${key}`, name: key, email: `${key}@orrn.local` }).onConflictDoNothing();
    }
    const seedPath = "../../../apps/server/src/dev-seed";
    const { seedDevData } = (await import(seedPath)) as {
      seedDevData: (db: TestEnv["db"], opts: { password: string }) => Promise<{ ok: boolean }>;
    };
    const companyId = "dev-company-orrn";
    const counts = async () => ({
      bands: (await env.db.select().from(dieBand).where(eq(dieBand.companyId, companyId))).length,
      copies: (await env.db.select().from(dieInstance).where(eq(dieInstance.companyId, companyId))).length,
      readings: (await env.db.select().from(dieWeightReading).where(eq(dieWeightReading.companyId, companyId))).length,
      openIssues: (await env.db.select().from(dieIssue).where(and(eq(dieIssue.companyId, companyId), eq(dieIssue.status, "issued")))).length,
    });
    expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
    const first = await counts();
    expect((await seedDevData(env.db, { password: "dev-seed-test" })).ok).toBe(true);
    expect(await counts()).toEqual(first);
    expect(first).toEqual({ bands: 1, copies: 5, readings: 8, openIssues: 1 });

    const { membership } = await import("@orrn/db/schema");
    const [m] = await env.db.select().from(membership).where(and(eq(membership.companyId, companyId), eq(membership.role, "owner")));
    const caller = env.callerForUser(m!.userId);
    const tee = (await caller.die.list({ search: "13090" })).items[0]!;
    expect(tee.worstTone).toBe("red"); // 13090-2 amber (+9.3 %), 13090-3 red on the heavy band (+10.3 %)
    const card = await caller.die.get({ id: tee.id });
    expect(card.copies.map((c) => [c.code, c.tone, c.position])).toEqual([
      ["13090-1", "green", "in"],
      ["13090-2", "amber", "above"],
      ["13090-3", "red", "above"],
    ]);
    const owned = (await caller.die.list({ search: "12230" })).items[0]!;
    expect(owned.ownerName).toBeString();
    const issued = await caller.dieInstance.issues.list({ status: "issued" });
    expect(issued.map((i) => [i.code, i.pressLineCode])).toEqual([["14701-1", "P1"]]);
  });
});
