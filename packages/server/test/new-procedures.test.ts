import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { auditLog, bundle, bundleGroup, company, dispatch, dispatchItem, printLog } from "@orrn/db/schema";
import { and, eq, inArray } from "drizzle-orm";

import { dayWindow } from "../src/lib/dayWindow";
import { createTestEnv, type TestEnv } from "./harness";

let env: TestEnv;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.dispose();
});

const MIN = 60_000;
const uid = () => crypto.randomUUID();

describe("dayWindow", () => {
  test("Asia/Kolkata: local midnight to midnight as UTC ms", () => {
    // 2026-10-03T20:00Z is 01:30 IST on 4 Oct.
    const { startMs, endMs } = dayWindow("Asia/Kolkata", Date.parse("2026-10-03T20:00:00Z"));
    expect(new Date(startMs).toISOString()).toBe("2026-10-03T18:30:00.000Z");
    expect(new Date(endMs).toISOString()).toBe("2026-10-04T18:30:00.000Z");
  });

  test("just before and just after IST midnight land in different days", () => {
    const before = dayWindow("Asia/Kolkata", Date.parse("2026-10-03T18:29:59Z"));
    const after = dayWindow("Asia/Kolkata", Date.parse("2026-10-03T18:30:00Z"));
    expect(before.endMs).toBe(after.startMs);
  });

  test("respects DST (25-hour day in New York, 1 Nov 2026)", () => {
    const { startMs, endMs } = dayWindow("America/New_York", Date.parse("2026-11-01T12:00:00Z"));
    expect(new Date(startMs).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(new Date(endMs).toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });

  test("UTC", () => {
    const { startMs, endMs } = dayWindow("UTC", Date.parse("2026-10-03T23:59:59Z"));
    expect(new Date(startMs).toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(endMs - startMs).toBe(24 * 60 * MIN);
  });
});

describe("dashboard.today", () => {
  test("packed counts respect the Asia/Kolkata day and leave void bundles out (RP11); stock covers every status", async () => {
    const { companyId } = await env.seedCompany();
    const dieId = await env.seedDie(companyId);
    const { startMs } = dayWindow("Asia/Kolkata");
    const yesterday = await env.seedBundles(companyId, dieId, 2);
    const today = await env.seedBundles(companyId, dieId, 3);
    const gone = await env.seedBundles(companyId, dieId, 1, "void");
    await env.db
      .update(bundle)
      .set({ createdAt: new Date(startMs - 30 * MIN) })
      .where(inArray(bundle.id, yesterday.map((b) => b.id)));
    await env.db
      .update(bundle)
      .set({ createdAt: new Date(startMs + 10 * MIN) })
      .where(inArray(bundle.id, [...today, ...gone].map((b) => b.id)));

    const res = await env.caller({ role: "viewer", companyId }).dashboard.today();
    expect(res.timezone).toBe("Asia/Kolkata");
    // 3 available + 1 void created inside today's window; 25 kg each. Void is not packed (RP11).
    expect(res.packedToday).toEqual({ bundles: 3, weightG: 75_000 });
    expect(res.stock.available).toEqual({ bundles: 5, weightG: 125_000 });
    expect(res.stock.void).toEqual({ bundles: 1, weightG: 25_000 });
    expect(res.stock.reserved).toEqual({ bundles: 0, weightG: 0 });
    expect(res.stock.dispatched).toEqual({ bundles: 0, weightG: 0 });
  });

  test("honours settings.timezone", async () => {
    const { companyId } = await env.seedCompany({ settings: { timezone: "UTC" } });
    const dieId = await env.seedDie(companyId);
    const { startMs } = dayWindow("UTC");
    const [b] = await env.seedBundles(companyId, dieId, 1);
    await env.db
      .update(bundle)
      .set({ createdAt: new Date(startMs + MIN) })
      .where(eq(bundle.id, b!.id));
    const res = await env.caller({ role: "viewer", companyId }).dashboard.today();
    expect(res.timezone).toBe("UTC");
    expect(res.packedToday.bundles).toBe(1);
  });

  test("dispatched today, open dispatches, recent sessions, failed print jobs; other tenant ignored", async () => {
    const a = await env.seedCompany();
    const other = await env.seedCompany();
    const { startMs } = dayWindow("Asia/Kolkata");
    const inToday = new Date(startMs + 10 * MIN);
    const inYesterday = new Date(startMs - 30 * MIN);

    const dieA = await env.seedDie(a.companyId, { name: "Named Die" });
    const dieA2 = await env.seedDie(a.companyId, { series: "ZZ", sectionCode: "9" });
    const custA = await env.seedCustomer(a.companyId);
    const bundlesA = await env.seedBundles(a.companyId, dieA, 4, "dispatched");
    const openBundles = await env.seedBundles(a.companyId, dieA2, 2, "reserved");

    const mkDispatch = async (
      companyId: string,
      customerId: string,
      code: string,
      status: "draft" | "reserved" | "completed",
      completedAt: Date | null,
      bundleIds: string[],
    ) => {
      const id = uid();
      await env.db.insert(dispatch).values({ id, companyId, code, customerId, status, completedAt });
      await env.db
        .insert(dispatchItem)
        .values(bundleIds.map((bundleId) => ({ id: uid(), companyId, dispatchId: id, bundleId })));
      return id;
    };

    await mkDispatch(a.companyId, custA, "D-TODAY", "completed", inToday, bundlesA.slice(0, 2).map((b) => b.id));
    await mkDispatch(a.companyId, custA, "D-OLD", "completed", inYesterday, bundlesA.slice(2).map((b) => b.id));
    const openId = await mkDispatch(a.companyId, custA, "D-OPEN", "reserved", null, openBundles.map((b) => b.id));

    // Another tenant with activity today that must never be counted.
    const dieO = await env.seedDie(other.companyId);
    const custO = await env.seedCustomer(other.companyId);
    const bundlesO = await env.seedBundles(other.companyId, dieO, 5);
    await env.db.update(bundle).set({ createdAt: inToday }).where(inArray(bundle.id, bundlesO.map((b) => b.id)));
    await mkDispatch(other.companyId, custO, "D-OTHER", "completed", inToday, bundlesO.map((b) => b.id));

    await env.db
      .update(bundle)
      .set({ createdAt: inToday })
      .where(inArray(bundle.id, [...bundlesA, ...openBundles].map((b) => b.id)));

    // Today's packing sessions (bundle groups): created today + one yesterday.
    await env.db.update(bundleGroup).set({ createdAt: inToday }).where(eq(bundleGroup.companyId, a.companyId));
    const [oldGroupBundle] = await env.seedBundles(a.companyId, dieA2, 1);
    const [oldGroup] = await env.db
      .select({ groupId: bundle.groupId })
      .from(bundle)
      .where(eq(bundle.id, oldGroupBundle!.id));
    await env.db.update(bundleGroup).set({ createdAt: inYesterday }).where(eq(bundleGroup.id, oldGroup!.groupId));
    await env.db.update(bundle).set({ createdAt: inToday }).where(eq(bundle.id, oldGroupBundle!.id));

    // Print jobs: failed today (counted), failed yesterday, success today, other tenant failed today.
    const { labelTemplate, printerProfile } = await import("@orrn/db/schema");
    const mkPrintRefs = async (companyId: string) => {
      const templateId = uid();
      const profileId = uid();
      await env.db.insert(labelTemplate).values({ id: templateId, companyId, name: "T", schema: {} });
      await env.db
        .insert(printerProfile)
        .values({ id: profileId, companyId, name: "P", spoolPrinterId: "sp1", templateId });
      return { templateId, profileId };
    };
    const refsA = await mkPrintRefs(a.companyId);
    const refsO = await mkPrintRefs(other.companyId);
    const mkPrint = (companyId: string, refs: { templateId: string; profileId: string }, status: "failed" | "success", at: Date) =>
      env.db.insert(printLog).values({ id: uid(), companyId, ...refs, status, createdAt: at });
    await mkPrint(a.companyId, refsA, "failed", inToday);
    await mkPrint(a.companyId, refsA, "failed", inToday);
    await mkPrint(a.companyId, refsA, "failed", inYesterday);
    await mkPrint(a.companyId, refsA, "success", inToday);
    await mkPrint(other.companyId, refsO, "failed", inToday);

    const res = await env.caller({ role: "viewer", companyId: a.companyId }).dashboard.today();

    expect(res.dispatchedToday).toEqual({ dispatches: 1, weightG: 50_000 });
    // Completed dispatches are not open; the other plant's are never counted.
    expect(res.openDispatchCount).toBe(1);
    expect(res.openDispatches).toEqual([
      {
        id: openId,
        code: "D-OPEN",
        status: "reserved",
        customerName: expect.any(String),
        bundles: 2,
        weightG: 50_000,
      },
    ]);
    expect(res.recentSessions.length).toBe(2);
    expect(res.recentSessions.map((s) => s.dieLabel).sort()).toEqual(["Named Die", "ZZ 9"].sort());
    for (const s of res.recentSessions) {
      expect(s.bundles).toBeGreaterThan(0);
      expect(new Date(s.createdAt).getTime()).toBe(inToday.getTime());
    }
    expect(res.failedPrintJobs).toBe(2);
    // a's own bundles (4 + 2 + 1) all sit in today's window; the other tenant's 5 are not counted.
    expect(res.packedToday.bundles).toBe(7);
    const otherView = await env.caller({ role: "viewer", companyId: other.companyId }).dashboard.today();
    expect(otherView.dispatchedToday.dispatches).toBe(1);
    expect(otherView.packedToday.bundles).toBe(5);
    expect(otherView.failedPrintJobs).toBe(1);
    expect(otherView.recentSessions.length).toBe(1);
  });

  test("today's sessions count only bundles that are not void (RP11)", async () => {
    const { companyId } = await env.seedCompany();
    const dieId = await env.seedDie(companyId);
    const { startMs } = dayWindow("Asia/Kolkata");
    const rows = await env.seedBundles(companyId, dieId, 3);
    await env.db.update(bundle).set({ status: "void" }).where(eq(bundle.id, rows[0]!.id));
    await env.db.update(bundle).set({ createdAt: new Date(startMs + MIN) }).where(eq(bundle.companyId, companyId));
    await env.db
      .update(bundleGroup)
      .set({ createdAt: new Date(startMs + MIN) })
      .where(eq(bundleGroup.companyId, companyId));

    const res = await env.caller({ role: "viewer", companyId }).dashboard.today();
    expect(res.recentSessions).toHaveLength(1);
    expect(res.recentSessions[0]).toMatchObject({ bundles: 2, weightG: 50_000 });
    expect(res.packedToday).toEqual({ bundles: 2, weightG: 50_000 });
  });

  test("setup says which first steps are done: dies, customers, bundles, printers", async () => {
    const { labelTemplate, printerProfile, die, customer } = await import("@orrn/db/schema");
    const empty = await env.seedCompany();
    const caller = env.caller({ role: "viewer", companyId: empty.companyId });
    expect((await caller.dashboard.today()).setup).toEqual({
      dies: false,
      customers: false,
      bundles: false,
      printers: false,
    });

    // Another plant's rows never count.
    const other = await env.seedCompany();
    const otherDie = await env.seedDie(other.companyId);
    await env.seedCustomer(other.companyId);
    await env.seedBundles(other.companyId, otherDie, 1);
    const otherTemplate = uid();
    await env.db.insert(labelTemplate).values({ id: otherTemplate, companyId: other.companyId, name: "T", schema: {} });
    await env.db
      .insert(printerProfile)
      .values({ id: uid(), companyId: other.companyId, name: "P", spoolPrinterId: "sp", templateId: otherTemplate });
    expect((await caller.dashboard.today()).setup).toEqual({
      dies: false,
      customers: false,
      bundles: false,
      printers: false,
    });

    // Deleted dies, customers and printers are not a finished step.
    const goneDie = await env.seedDie(empty.companyId);
    await env.db.update(die).set({ deletedAt: new Date() }).where(eq(die.id, goneDie));
    const goneCustomer = await env.seedCustomer(empty.companyId);
    await env.db.update(customer).set({ deletedAt: new Date() }).where(eq(customer.id, goneCustomer));
    const template = uid();
    await env.db.insert(labelTemplate).values({ id: template, companyId: empty.companyId, name: "T", schema: {} });
    const goneProfile = uid();
    await env.db.insert(printerProfile).values({
      id: goneProfile,
      companyId: empty.companyId,
      name: "Gone",
      spoolPrinterId: "sp",
      templateId: template,
      deletedAt: new Date(),
    });
    expect((await caller.dashboard.today()).setup).toEqual({
      dies: false,
      customers: false,
      bundles: false,
      printers: false,
    });

    const dieId = await env.seedDie(empty.companyId);
    await env.seedCustomer(empty.companyId);
    await env.seedBundles(empty.companyId, dieId, 1, "void");
    await env.db
      .insert(printerProfile)
      .values({ id: uid(), companyId: empty.companyId, name: "Live", spoolPrinterId: "sp", templateId: template });
    // A void bundle still means the first bundles were packed.
    expect((await caller.dashboard.today()).setup).toEqual({
      dies: true,
      customers: true,
      bundles: true,
      printers: true,
    });
  });

  test("open dispatches are capped at 10, newest first", async () => {
    const { companyId } = await env.seedCompany();
    const customerId = await env.seedCustomer(companyId);
    const base = Date.now();
    for (let i = 0; i < 12; i++) {
      await env.db.insert(dispatch).values({
        id: uid(),
        companyId,
        code: `D-${String(i).padStart(2, "0")}`,
        customerId,
        status: "draft",
        createdAt: new Date(base + i * 1000),
      });
    }
    const res = await env.caller({ role: "viewer", companyId }).dashboard.today();
    expect(res.openDispatches.length).toBe(10);
    // The list is capped; the count is not (Today's Dispatch tile shows "12 open").
    expect(res.openDispatchCount).toBe(12);
    expect(res.openDispatches[0]!.code).toBe("D-11");
    expect(res.openDispatches[0]).toMatchObject({ bundles: 0, weightG: 0 });
  });
});

describe("bundle.getBySerial", () => {
  test("lower-case, padded input finds the bundle with the getBundle shape", async () => {
    const { companyId } = await env.seedCompany();
    const dieId = await env.seedDie(companyId);
    const [b] = await env.seedBundles(companyId, dieId, 1);
    const caller = env.caller({ role: "viewer", companyId });

    const bySerial = await caller.bundle.getBySerial({ serial: `  ${b!.serial.toLowerCase()} ` });
    const byId = await caller.bundle.getBundle({ id: b!.id });
    expect(bySerial.bundle.id).toBe(b!.id);
    expect(bySerial).toEqual(byId);
    expect(Object.keys(bySerial).sort()).toEqual(["activeDispatch", "bundle", "die", "events", "group"]);
  });

  test("other company's serial and unknown serials are NOT_FOUND", async () => {
    const a = await env.seedCompany();
    const b = await env.seedCompany();
    const dieB = await env.seedDie(b.companyId);
    const [bundleB] = await env.seedBundles(b.companyId, dieB, 1);
    const caller = env.caller({ role: "owner", companyId: a.companyId });
    await expect(caller.bundle.getBySerial({ serial: bundleB!.serial })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.bundle.getBySerial({ serial: "NOPE-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("company.updateSettings", () => {
  test("manager, operator and viewer are FORBIDDEN", async () => {
    const { companyId } = await env.seedCompany();
    for (const role of ["manager", "operator", "viewer"] as const) {
      await expect(
        env.caller({ role, companyId }).company.updateSettings({ lengthUnit: "inch" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  test("admin persists, merges into existing settings, audits, and auth.me reflects it", async () => {
    const { companyId } = await env.seedCompany({
      settings: { facilityLocation: "Plant 1", lengthUnit: "mm" },
    });
    const admin = env.caller({ role: "admin", companyId });

    const res = await admin.company.updateSettings({ lengthUnit: "inch", timezone: "America/New_York" });
    expect(res.settings).toEqual({
      facilityLocation: "Plant 1",
      lengthUnit: "inch",
      timezone: "America/New_York",
    });

    const me = await env.caller({ role: "viewer", companyId }).auth.me();
    expect(me.company?.settings).toMatchObject({
      facilityLocation: "Plant 1",
      lengthUnit: "inch",
      timezone: "America/New_York",
    });

    // partial update keeps the other keys
    const second = await admin.company.updateSettings({ timezone: "Asia/Kolkata" });
    expect(second.settings).toMatchObject({ lengthUnit: "inch", timezone: "Asia/Kolkata" });

    const audits = await env.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.companyId, companyId), eq(auditLog.action, "company.settings.update")));
    expect(audits.length).toBe(2);
    expect(audits[0]!.subjectId).toBe(companyId);

    const [row] = await env.db.select().from(company).where(eq(company.id, companyId));
    expect(row!.settings).toMatchObject({ lengthUnit: "inch", timezone: "Asia/Kolkata" });
  });

  test("bad timezone or length unit is BAD_REQUEST and nothing is written", async () => {
    const { companyId } = await env.seedCompany({ settings: { lengthUnit: "mm" } });
    const owner = env.caller({ role: "owner", companyId });
    await expect(owner.company.updateSettings({ timezone: "Mars/Olympus" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(owner.company.updateSettings({ timezone: "not a zone" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      owner.company.updateSettings({ lengthUnit: "cm" as never }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [row] = await env.db.select().from(company).where(eq(company.id, companyId));
    expect(row!.settings).toEqual({ lengthUnit: "mm" });
  });
});
